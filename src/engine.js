/**
 * engine.js —— 推进与动作
 *
 * 两块内容：
 *   1. tick / advance —— 时间推进（含离线闭式解）
 *   2. 各种购买动作
 *
 * ── 为什么 tick 能用闭式解 ──
 *
 * 关键观察：**粒子产出速率不依赖粒子数或物质数**。
 *   dP/dt = particleRate(state)          ← 只依赖 等级/ZPE/暗能量
 *   dM/dt = particle × matterCoeff(state) ← 对 P 是线性的
 *
 * 所以在一个时间片内（系数视为常数）可以精确积分：
 *   P(t) = P0 + c·t
 *   M(t) = M0 + k·(P0·t + c·t²/2)
 *
 * 这比逐 tick 模拟快无数倍，也是 SPEC §5.2 要求的。
 */

import Decimal from "../dist/break_eternity.esm.js";
import {
  BASE, BREAK_INFINITY, CRUNCH_AT_LABEL, DE_UPGRADES, DREAM_BY_ID, INFINITY_UPGRADES, QUANTUM, REPEATABLE,
  VOID_UPGRADES, ZPE_ENGINE, crunchThreshold, piecewiseDeCost, dreamUpgradeEffects, infinityPointGain,
  infinityRateMult, infinityStartLog10, infinityUpgradeCost, infinityUpgradeOwned,
  quantumGrowthRate, quantumPerPair, quantumStepMult, quantumToIPGain, quantumZpeRequirement,
  tierMilestonesDone, zpeEngineCost, zpeEngineCountFreqUnlocked,
  zpeEngineAffordableIn, zpeEngineExpBonus, zpeEngineLevel, zpeEngineTotalCost, zpeEngineUnlocked,
  CRUNCH_ACCEL, accelCost, accelLevel, accelMaxLevel, coinageAffordableIn, coinageCap, coinageCost, coinageLevel, coinageTotalCost,
} from "./config.js";
import {
  D, bigCrunchGain, canBigCrunch, checkDeMilestones, checkZpeMilestones, collapseUnlocked,
  clampToAffordable, conversion, darkEnergyGainPerConversion, darkEnergyRate, deUpgradeCost, effectiveTraps,
  entropyRate, floorDiv, geometricSum, globalMultiplier, isAutoAcquire,
  kindProduct, matterRate, climbFactor, overloadFactor, particleRate, repeatableCost, trapCost, voidUpgradeCost,
  zpeMultiplier, zpeRate,
} from "./formulas.js";
import { addLevel, awardDream, deLevelOf, levelOf, pushLevelLog, pushLog } from "./state.js";
// ══════════════════════════════════════════════════════════
// 系数（供闭式解用）
// ══════════════════════════════════════════════════════════

/**
 * 物质系数 k：dM/dt = k × P。
 * matterRate 依赖 P，但 k 不依赖 —— 闭式解需要的是 k。
 */
export function matterCoeff(state) {
  const mb = kindProduct(state, "matterMul");
  let zf = D(1);
  if (state.zpeMilestones.m3) {
    const factor = state.voidUpgrades.v9 ? 1.0 : 0.5;
    zf = D(1).add(zpeMultiplier(state).sub(1).mul(factor));
  }
  const v3 = state.voidUpgrades.v3 ? D(1.5) : D(1);
  return D(BASE.matterPerParticle)
    .mul(mb)
    .mul(globalMultiplier(state))
    .mul(zf)
    .mul(v3);
}

// ══════════════════════════════════════════════════════════
// 单步推进
// ══════════════════════════════════════════════════════════

/**
 * 推进 dt 秒。
 *
 * @param {object} state
 * @param {number} dt  秒。调用方负责分段（见 advance）
 */
export function tick(state, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;

  // ★ ∞ 层 ④「无限长河」的计量口径：本次无限已经过去了多少秒。
  //   用 dt 累加而不是读 wall clock —— 离线结算（advance）走的是同一个 tick，
  //   所以挂机 4 小时回来，这段时间也会被如实计入。
  state.infinityElapsed = (state.infinityElapsed ?? 0) + dt;

  // ★ ④ 是**实时**产点的（对齐 AD 的 ipGen：被动产点，不是结算时一次性给）。
  //   每帧按 `1/60 × 3^①等级` 进账，但**只计本次无限的前 30 分钟** ——
  //   和改之前的总量完全一致（`min(耗时, 1800) ÷ 60 × 3^①`），只是拆成每帧发。
  //   好处：挂机时点就在账上，不必等大坍缩；"单次 30 分钟"变成屏幕上的实时数字。
  if (state.ipTimeBought) {
    const cap = INFINITY_UPGRADES.ipTime.capSeconds ?? Infinity;
    const before = Math.min(state.infinityElapsed - dt, cap);   // 本帧之前的可计时长
    const after = Math.min(state.infinityElapsed, cap);         // 本帧之后
    if (after > before) {
      const gain = D(after - before)
        .div(INFINITY_UPGRADES.ipTime.secondsPerPoint)
        .mul(Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, state.ipDoubleLevel ?? 0));
      state.infinityPoints = state.infinityPoints.add(gain);
      // 本次无限"实时累计了多少"（仅供日志与界面显示；上限 = 30 分钟那笔）
      state.ipTimeAccrued = (state.ipTimeAccrued ?? 0) + gain.toNumber();
    }
  }

  const P0 = state.resources.particle;

  // ── 1. 熵产出，然后转成粒子 ──
  const eGain = entropyRate(state).mul(dt);
  let entropy = state.resources.entropy.add(eGain);
  const { threshold, output } = conversion(state);

  let particleGain = D(0);
  if (entropy.gte(threshold)) {
    // ★ 原稿是 while (entropy >= threshold) 逐次扣减 —— 后期一 tick 转几万次会卡死。
    //   改成除法一次算完，O(1)。
    //   （原来这里有一个旧量子升级「余量回收」的分支，整套系统已删除。）
    //
    // ⚠️ 必须用 floorDiv，不能写 `entropy.div(threshold).floor()`：
    //    Decimal 的 div 只有 ~15 位有效数字，商会被四舍五入抬到整数上，
    //    floor 就多一格，余量变成负数（实测「余 -0.001953125」）。
    //    见 formulas.js 的 floorDiv 注释。
    const times = floorDiv(entropy, threshold);
    entropy = entropy.sub(times.mul(threshold));
    // 兜底：即使 floorDiv 后仍有极小的负余量，也不许存负数
    if (entropy.lt(0)) entropy = D(0);
    particleGain = times.mul(output);
  }
  state.resources.entropy = entropy;
  state.stats.totalEntropy = state.stats.totalEntropy.add(eGain);

  // ── 2. 粒子 & 物质（闭式解 + 量子的指数项）──
  const k = matterCoeff(state);
  const c = particleGain.div(dt); // 本片的等效粒子速率
  state.resources.particle = P0.add(particleGain);

  let matterGain = k.mul(P0.mul(dt).add(c.mul((dt * dt) / 2)));

  // ★ 量子涨落 → **指数成长项**
  //
  //   为什么需要它（结构性问题）：
  //     上面的 `k·P` 链最终是 `M'' ∝ log(M)`（熵阱数量 ∝ log 物质），
  //     于是 M 随时间**多项式**增长，`d(log10 M)/dt` 一直衰减。
  //     乘任何倍率 C 只能给 `log10(M)` 加一个**常数**，改不了形式 ——
  //     实测 perPair=200（倍率 ×2401）也走不到 1e308。
  //
  //   这里补一个**正比于 M** 的项，让成长变成指数：
  //     `d(log10 M)/dt = R(q)`  =>  `dM/dt = R·ln10·M`
  //   R 由量子数决定，上限 0.05 阶/秒 -> 283 阶约 1.6 小时。
  //
  //   ⚠️ 它**必须**带 R 的钳制。当年「直接边」（P ∝ M）跑飞就是因为
  //      速率 `√(k·j) ∝ 全局加成` 无上限，几十个数量级一瞬间就过去了。
  const gRate = quantumGrowthRate(state.quantum, infinityRateMult(state));
  if (gRate.gt(0)) {
    matterGain = matterGain.add(
      state.resources.matter.mul(gRate).mul(Math.LN10).mul(dt),
    );
  }

  // ★ 过载（软上限）：打破无限之后不再有硬顶，超拐点后按 `2^(−超出 / halvingOrders)` 减速。
  //   与 formulas.js 的 matterRate 用**同一个函数**（display == 实际）。
  const ov = overloadFactor(state);
  if (ov.lt(1)) matterGain = matterGain.mul(ov);
  // ★ 爬升形状（路线 1）：让 e25→e308.25 从直线变 log 形。同样与 matterRate 同源。
  const cf = climbFactor(state);
  if (cf.lt(1)) matterGain = matterGain.mul(cf);

  state.resources.matter = state.resources.matter.add(matterGain);

  // ── 3. ZPE ──
  const zGain = zpeRate(state).mul(dt);
  state.zpe = state.zpe.add(zGain);
  state.zpeTotal = state.zpeTotal.add(zGain);

  // ── 4. 暗能量（相变仪解锁后）──
  //
  // ★ 唯一入口原则：这里**必须**调用 darkEnergyRate()，
  //   也就是界面显示的那个函数。不允许在引擎里重算一遍。
  //
  //   踩过：dm4b 最初只加进 darkEnergyRate()，而引擎用 zpeAccumulator
  //   自己算（走 darkEnergyGainPerConversion）—— 于是效果变成死代码：
  //   界面数字变了、实际产出一点没变。玩家反馈「还是涨不动」。
  //
  //   顺带修掉一个精度问题：老的累加器用 `floor(acc/1e8)` 量化，
  //   dt 大时会丢掉余数；直接乘 dt 是连续的，更准。
  if (state.phaseTransmuterUnlocked) {
    const deGain = darkEnergyRate(state).mul(dt);
    state.darkEnergy = state.darkEnergy.add(deGain);
    state.darkEnergyTotal = state.darkEnergyTotal.add(deGain);
  }

  // ── 5. 里程碑 ──
  for (const m of checkZpeMilestones(state)) {
    pushLog(state, `🏆 达成虚空里程碑：${m.desc}`);
    awardDream(state, `zpeMs:${m.id}`, m.desc);
  }
  for (const m of checkDeMilestones(state)) {
    pushLog(state, `🏆 达成暗能量里程碑：${m.desc}`);
    awardDream(state, `deMs:${m.id}`, m.desc);
    if (m.id === "dm0") {
      state.phaseTransmuterUnlocked = true;
      pushLog(state, "🌌 相变仪已解锁！");
    }
  }

  // ── 6. 历史最高物质（第四层解锁条件 + 坍缩进度）──
  if (state.resources.matter.gt(state.peakMatter)) {
    state.peakMatter = state.resources.matter;
  }

  // ── 7. 相变仪进度（只为显示那个环，不改实际转换）──
  //     实际转换是连续除法（zpeRate/1e8），这里维护一个
  //     「距离下一次 1e8 ZPE 还差多少」的累加器，纯粹给玩家看。
  if (collapseUnlocked(state) || state.phaseTransmuterUnlocked) {
    const th = D(BASE.darkEnergyThreshold);
    const acc = state.deAccum.add(zpeRate(state).mul(dt));
    // Decimal 没有 mod，用 acc - floor(acc/th)*th（floorDiv 防舍入，见 formulas.js）
    state.deAccum = acc.lt(th) ? acc : acc.sub(floorDiv(acc, th).mul(th));
    if (state.deAccum.lt(0)) state.deAccum = D(0);
  }

  // ── 8. 层间重置（**由外到内**）──
  phaseResets(state);

  // ── 9. 层内奖励 ──
  phaseQuantumCapture(state);

  // ── 10. 自动化 ──
  if (state.voidUpgrades.v9) autoAcquire(state);
  autoAcquireDream(state);   // 独立于 v9，见函数注释

  return state;
}

/**
 * ══════════════════════════════════════════════════════════
 * 层结构（重构后显式化）
 * ══════════════════════════════════════════════════════════
 *
 *   第 0 层  熵 → 粒子 → 物质     生产环
 *   第 1 层  ZPE                   由熵阱产出
 *   第 2 层  暗能量                 由 ZPE 相变而来
 *   第 3 层  临界坍缩 → 暗物质/量子   层内阶梯（自动）
 *   第 4 层  大坍缩   → 无限点       层间重置（强制/手动）
 *
 * **重置顺序必须由外到内**：外层一重置，内层的判定自然失效，
 * 不会出现「内层刚发的奖励被同帧的外层重置抹掉」。
 *
 * 踩过的坑（用户发现）：原来是「量子捕获 → 临界坍缩 → 大坍缩」，
 * 而量子捕获会抬高 globalMultiplier → 物质涨得更快 → 触发大坍缩
 * → 同一帧内把刚捕获的量子抹掉。**自我抵消**。
 */

/**
 * 阶段：层间重置。**由外到内**。
 *
 * ★ 「临界坍缩阶梯」已整个删除，所以现在只有一层重置：大坍缩。
 *   第三层（量子涨落）**不重置任何东西** —— 它只给量子，量子再给指数成长速率。
 *   （原来的顺序坑：量子捕获 → 临界坍缩 → 大坍缩，同一帧内刚捕获的量子被抹掉。
 *     现在没有内层重置，这个坑从结构上消失了。）
 */
function phaseResets(state) {
  // ── 大坍缩（唯一的重置）──
  //    未打破无限时物质硬顶在 1e308.25，到顶**强制**触发；
  //    打破后上限解除，改由玩家手动（见 doBigCrunch 的调用方）。
  if (!state.brokenInfinity) {
    const cap = crunchThreshold();
    if (state.resources.matter.gte(cap)) {
      state.resources.matter = cap;   // 硬顶：不许超过
      doBigCrunch(state);
    }
  }
}

/**
 * 阶段：层内奖励 —— 量子涨落捕获。
 *
 * 门槛 `1e10 × 10^已捕获对数`，满足即自动捕获一对（+2 量子）。
 *
 * ⚠️ 必须排在 phaseResets **之后**：
 *    捕获会抬高 globalMultiplier，进而加快物质增长；
 *    如果排在重置之前，同一帧内刚捕获的量子会被大坍缩抹掉。
 */
function phaseQuantumCapture(state) {
  if (!collapseUnlocked(state)) return;
  for (let guard = 0; guard < 200; guard++) {
    const need = quantumZpeRequirement(state.quantumPairs, quantumStepMult(state));
    if (state.zpe.lt(need)) break;
    state.quantumPairs = state.quantumPairs.add(1);
    state.quantumPairsTotal = state.quantumPairsTotal.add(1);
    state.quantum = state.quantum.add(quantumPerPair(state));   // 涨落增幅会把它从 2 提到 3
    // ★ 记录"本次无限内的最大量子数"（量子铸币的收益基数；大坍缩时归零）
    if (state.quantum.gt(state.peakQuantumRun ?? 0)) state.peakQuantumRun = state.quantum;
    pushLog(
      state,
      `⚛ 捕获第 ${state.quantumPairs.toString()} 对量子（门槛 1e${need.log10().toFixed(0)} ZPE）`,
    );
  }
}

/**
 * 打破无限（花无限点）。
 * 之后物质上限解除，大坍缩改为手动，收益随深度增长。
 */
export function breakInfinity(state) {
  if (state.brokenInfinity) return false;
  const cost = D(BREAK_INFINITY.unlockCost);
  if (state.infinityPoints.lt(cost)) return false;
  state.infinityPoints = state.infinityPoints.sub(cost);
  state.brokenInfinity = true;
  pushLog(state, "💠 打破无限！物质上限解除，大坍缩改为手动，收益随深度增长");
  awardDream(state, "breakInfinity", "打破无限");
  return true;
}

// ══════════════════════════════════════════════════════════
// 离线推进
// ══════════════════════════════════════════════════════════

/**
 * 推进 seconds 秒（可以很长）。
 *
 * 分段是为了让 ZPE 增长带来的 zpeMultiplier 变化被跟上 ——
 * 片内系数是常数，所以片内是精确积分，只有跨片的系数更新是近似的。
 */
export function advance(state, seconds, chunkSeconds = 5) {
  let remaining = Math.min(seconds, BASE.offlineCapSeconds);
  const chunks = Math.max(1, Math.ceil(remaining / chunkSeconds));
  const dt = remaining / chunks;
  for (let i = 0; i < chunks; i++) tick(state, dt);
  return state;
}

// ══════════════════════════════════════════════════════════
// 动作
// ══════════════════════════════════════════════════════════

/** 点击给熵 */
export function doClick(state) {
  let gain = D(BASE.clickGain);
  // m1：+10
  if (state.zpeMilestones.m1) gain = gain.add(10);
  // v7：×5
  if (state.voidUpgrades.v7) gain = gain.mul(5);
  state.resources.entropy = state.resources.entropy.add(gain);
  state.stats.clicks += 1;
  return gain;
}

/**
 * 购买可重复升级。
 *
 * ⚠️ 买满**必须用闭式解**，不能循环。
 *
 * 这是踩过两次的坑：原稿用 `while (entropy >= threshold)` 逐次扣减，
 * 我批评过它；结果自己在这里写了 `for (i < affordableCount())` ——
 * 而 affordableCount 在量子倍率起来之后能到 **1e7**，
 * 于是每帧跑上千万次循环，整个模拟直接卡死。
 *
 * 几何级数的前 n 项和：`firstCost × (r^n - 1) / (r - 1)`
 *
 * @param {boolean} max true = 一次买满
 * @returns {number} 实际买到的级数
 */
export function buyRepeatable(state, id, max = false) {
  const cfg = REPEATABLE[id];
  if (!cfg) return 0;

  // ★ v9 + m2 之后进入「自动获取」模式：由 tick 里的 autoAcquire 统一处理。
  //   这里必须直接返回，否则手动点击会**绕过扣款白送等级**
  //   （autoAcquire 已经加过一遍，玩家再点一下就是双倍）。
  if (isAutoAcquire(state, "upgrade")) return 0;

  const n = max ? affordableCount(state, id) : 1;
  if (n <= 0) return 0;

  const r = cfg.costMult;
  const first = repeatableCost(state, id);
  const pool = state.resources[cfg.currency];

  // 闭式解求总价：等比数列前 n 项和。
  // ★ 反推出来的 n 可能因为 log/div 的舍入多 1 格，先下调到真买得起的档位 ——
  //   否则「买满」按钮会静默什么都不做（pool.lt(total) -> return 0）。
  const k = max ? clampToAffordable(first, r, pool, n) : 1;
  const total = geometricSum(first, r, k);
  if (pool.lt(total)) return 0;
  state.resources[cfg.currency] = pool.sub(total);

  const before = levelOf(state, id).toNumber();
  addLevel(state, id, k);
  // ★ 只在关键节点写日志（1/5/10/50/100…）：自动获取模式一帧买几百级，逐级写会刷爆
  pushLevelLog(state, cfg.name, before, before + k);
  if (cfg.firstRewardDream && !state.firstPurchase[id]) {
    state.firstPurchase[id] = true;
    state.dreamPoints = state.dreamPoints.add(1);
    pushLog(state, `💭 首次购买「${cfg.name}」，获得 1 梦想点`);
  }
  return k;
}

/**
 * 等比价格 + 给定资源池 ⇒ 买得起几个（闭式解，O(1)）。
 *
 * 抽出来是为了让「三条主升级」「∞ 层①」「ZPE 引擎等级」共用同一套算法 ——
 * 复制粘贴迟早会在某一份里忘记 `clampToAffordable` 的浮点兜底。
 */
export function affordableFromPool(firstCost, r, pool, cap = 1e7) {
  if (!(r > 1)) return 0;
  if (pool.lt(firstCost)) return 0;
  // n = floor( log_r( pool×(r-1)/firstCost + 1 ) )
  const ratio = pool.mul(r - 1).div(firstCost).add(1);
  const n = ratio.log(r).floor().toNumber();
  if (!Number.isFinite(n) || n <= 0) return 0;
  // ★ 显示/购买的数量也必须是「真的买得起」的数量（log 同样有舍入）
  return Math.min(clampToAffordable(firstCost, r, pool, Math.min(n, cap)), cap);
}

/** 还能买几个（闭式解，O(1)） */
export function affordableCount(state, id) {
  const cfg = REPEATABLE[id];
  if (!cfg) return 0;
  return affordableFromPool(repeatableCost(state, id), cfg.costMult, state.resources[cfg.currency]);
}

/**
 * 购买熵阱。买满同样用**闭式解**，理由见 buyRepeatable。
 *
 * 熵阱价格是 `0.1 × r^n`，也是等比数列：
 *   `first × (r^k - 1)/(r - 1) <= 物质`  =>  `k = floor(log_r(物质×(r-1)/first + 1))`
 */
export function buyTrap(state, max = false) {
  const auto = isAutoAcquire(state, "trap");
  const r = BASE.trapCostMult;
  const pool = state.resources.matter;

  const first = trapCost(state);
  if (pool.lt(first)) return 0;

  let k = 1;
  if (max) {
    if (r <= 1) {
      k = Math.min(1e7, floorDiv(pool, first).toNumber());
    } else {
      const ratio = pool.mul(r - 1).div(first).add(1);
      k = Math.floor(ratio.log(r).toNumber());
      if (!Number.isFinite(k) || k < 1) k = 1;
      // ★ 反推的 k 可能多一格（见 formulas.js 的 clampToAffordable）
      k = clampToAffordable(first, r, pool, Math.min(k, 1e7));
    }
    if (!Number.isFinite(k) || k < 1) k = 1;
    k = Math.min(k, 1e7);
  }

  if (!auto) {
    const total = geometricSum(first, r, k);
    if (pool.lt(total)) return 0;
    state.resources.matter = pool.sub(total);
  }
  state.resources.traps = state.resources.traps.add(k);
  return k;
}

/** 购买虚空升级 */
export function buyVoidUpgrade(state, id) {
  const cfg = VOID_UPGRADES[id];
  if (!cfg || state.voidUpgrades[id]) return false;

  // ★ 先把**两项**价格都验完再扣款。
  //   老写法是「先扣梦想点 -> 再查 ZPE」，如果 ZPE 不够就直接 return false，
  //   扣掉的梦想点不会退回来（白扣）。现在 v9 的 ZPE 价格是 0 所以碰不到，
  //   但只差一条带 dream + zpe 双价的升级就会踩上。
  const cost = voidUpgradeCost(state, id);
  if (cfg.costDream && state.dreamPoints.lt(cfg.costDream)) return false;
  if (cost.gt(0) && state.zpe.lt(cost)) return false;
  // ★ **门槛**（不是价格）：v9 要求 ZPE 到 1e8 才解锁 —— 原稿逻辑，见 config 的 `requireZpe`。
  //   用户确认「v9 不改，故意设计的」，所以这里只挡"太早买"，不扣 ZPE。
  if (cfg.requireZpe != null && state.zpe.lt(cfg.requireZpe)) return false;

  if (cfg.costDream) state.dreamPoints = state.dreamPoints.sub(cfg.costDream);
  if (cost.gt(0)) state.zpe = state.zpe.sub(cost);

  state.voidUpgrades[id] = true;
  pushLog(state, `⚡ 购买虚空升级「${cfg.name}」`);
  awardDream(state, `void:${id}`, `虚空升级「${cfg.name}」`);

  if (cfg.rewardDream) {
    state.dreamPoints = state.dreamPoints.add(1);
    pushLog(state, "💭 获得 1 梦想点（虚空升级奖励）");
  }
  return true;
}

/** 购买暗能量升级 */
export function buyDeUpgrade(state, id) {
  const cfg = DE_UPGRADES[id];
  if (!cfg) return false;
  const lv = deLevelOf(state, id);
  if (cfg.maxLevel != null && lv.gte(cfg.maxLevel)) return false;

  const cost = deUpgradeCost(state, id);
  if (cost.dream && state.dreamPoints.lt(cost.dream)) return false;
  if (cost.matter && state.resources.matter.lt(cost.matter)) return false;
  if (cost.particle && state.resources.particle.lt(cost.particle)) return false;
  if (cost.zpe && state.zpe.lt(cost.zpe)) return false;
  if (cost.darkEnergy && state.darkEnergy.lt(cost.darkEnergy)) return false;

  if (cost.dream) state.dreamPoints = state.dreamPoints.sub(cost.dream);
  if (cost.matter) state.resources.matter = state.resources.matter.sub(cost.matter);
  if (cost.particle) state.resources.particle = state.resources.particle.sub(cost.particle);
  if (cost.zpe) state.zpe = state.zpe.sub(cost.zpe);
  if (cost.darkEnergy) state.darkEnergy = state.darkEnergy.sub(cost.darkEnergy);

  state.deUpgradeLevels[id] = lv.add(1);
  pushLevelLog(state, cfg.name, lv.toNumber(), lv.add(1).toNumber());

  if (cfg.firstRewardDream && !state.deFirstPurchase[id]) {
    state.deFirstPurchase[id] = true;
    state.dreamPoints = state.dreamPoints.add(1);
    pushLog(state, `💭 首次购买「${cfg.name}」，获得 1 梦想点`);
  }
  return true;
}

// ══════════════════════════════════════════════════════════
// v9 的「达到阈值自动获取」
// ══════════════════════════════════════════════════════════

/**
 * 自动购买某个暗能量升级（由梦想点升级解锁）。
 *
 * ⚠️ 同样用**闭式解**，不写循环。这两个升级的价格都是等比数列：
 *   高效相变   100 × r^等级          (r = costMult)
 *   真空加速   10^等级
 * 前 k 级总价 = base × (r^k - 1)/(r - 1)
 * 反解    k  = floor(log_r(资源 × (r-1)/base + 1))
 *
 * @returns {number} 实际买到的级数
 */
function autoBuyDeUpgrade(state, id) {
  const cfg = DE_UPGRADES[id];
  if (!cfg) return 0;
  const lv = deLevelOf(state, id);
  const d = dreamUpgradeEffects(state);

  let r, base, pool, isParticle, isDarkEnergy = false;
  if (id === "phaseShift") {
    r = d.phaseShiftCostMult;
    base = D(cfg.baseCost ?? 100).mul(Decimal.pow(r, lv));
    pool = state.resources.particle;
    isParticle = true;
  } else if (id === "vacuumAccel") {
    r = 10;
    base = Decimal.pow(10, lv);
    pool = state.zpe;
    isParticle = false;
  } else if (id === "convOutput") {
    // 凝聚斜率：等比数列，价格 = baseCost × costMult^等级，烧暗能量
    r = cfg.costMult;
    base = D(cfg.baseCost).mul(Decimal.pow(r, lv));
    pool = state.darkEnergy;
    isParticle = false;
    isDarkEnergy = true;
  } else if (id === "deGainBase") {
    // 相变增幅：**分段价格**（×3 -> ×1.5 -> ×2），没有单一公比。
    // 用有界的逐级累加 —— 每一级只调一次 O(1) 的 piecewiseDeCost，
    // 而且上限 200 级封死，所以是常数代价（不像当年那个无界的 while）。
    pool = state.darkEnergy;
    let k2 = 0;
    let acc = D(0);
    for (let i = 0; i < 200; i++) {
      const one = piecewiseDeCost(cfg.baseCost, lv.add(k2));
      if (pool.lt(acc.add(one))) break;
      acc = acc.add(one);
      k2++;
    }
    if (k2 < 1) return 0;
    state.darkEnergy = pool.sub(acc);
    state.deUpgradeLevels[id] = lv.add(k2);
    pushLevelLog(state, cfg.name, lv.toNumber(), lv.add(k2).toNumber());
    return k2;
  } else {
    return 0;   // 其他升级价格形态不同，不支持自动
  }

  if (r <= 1 || pool.lt(base)) return 0;

  let k = Math.floor(pool.mul(r - 1).div(base).add(1).log(r).toNumber());
  if (!Number.isFinite(k) || k < 1) return 0;
  k = Math.min(k, 1e6);

  // 浮点误差兜底：算出来的总价可能略微超过资源（抽到 formulas.js 里了）
  k = clampToAffordable(base, r, pool, k);
  const total = geometricSum(base, r, k);
  if (pool.lt(total)) return 0;

  if (isDarkEnergy) state.darkEnergy = pool.sub(total);
  else if (isParticle) state.resources.particle = pool.sub(total);
  else state.zpe = pool.sub(total);

  state.deUpgradeLevels[id] = lv.add(k);
  pushLevelLog(state, cfg.name, lv.toNumber(), lv.add(k).toNumber());
  return k;
}

/**
 * v9 的「达到阈值自动获取」。
 *
 * m2（升级价格折扣）和 m5（熵阱价格折扣）在 v9 之后从「打折」升级成「免费」：
 * 资源达到折后阈值就直接加等级，不扣钱。
 *
 * ⚠️ 同样用**闭式解**，不要写 `for (guard < 50)` ——
 *    那个循环在后期每帧都会被跑满，而且一次只能买 50 级，
 *    买得起 1e7 级时要等几十万帧。（和 buyRepeatable / buyTrap 同一类坑。）
 */
function autoAcquire(state) {
  if (isAutoAcquire(state, "upgrade")) {
    for (const id of Object.keys(REPEATABLE)) {
      const cfg = REPEATABLE[id];
      const n = affordableCount(state, id);
      if (n <= 0) continue;
      const before = levelOf(state, id).toNumber();
      addLevel(state, id, n);
      pushLevelLog(state, cfg.name, before, before + n);
      if (cfg.firstRewardDream && !state.firstPurchase[id]) {
        state.firstPurchase[id] = true;
        state.dreamPoints = state.dreamPoints.add(1);
      }
    }
  }
  if (isAutoAcquire(state, "trap")) {
    buyTrap(state, true);
  }
}

/**
 * 梦想点升级带来的自动化：自动购买暗能量升级。
 *
 * ⚠️ **必须独立于 v9 调用。**
 *    最初我把它塞进了 `autoAcquire()`，而那个函数只在 `voidUpgrades.v9`
 *    为真时才跑 —— 于是买了梦想点自动化却什么都不发生（实测等级一直是 0）。
 *    梦想点和虚空升级是两条独立的系统，不该互相门控。
 */
function autoAcquireDream(state) {
  for (const id of dreamUpgradeEffects(state).autoBuyDe) {
    autoBuyDeUpgrade(state, id);
  }
}

// ══════════════════════════════════════════════════════════
// 第四层：临界坍缩
// ══════════════════════════════════════════════════════════

/**
 * 坍缩时的重置范围。
 *
 * **保留**（跨坍缩的永久进度）：
 *   · 虚空系统：虚空升级 / ZPE 里程碑
 *   · 暗物质工程：暗能量里程碑 / 暗能量升级
 *   · 梦想点（成就）/ 暗物质 / 量子 / 量子升级
 *
 * **重置**：物质 / 粒子 / 熵 / 熵阱 / 三条升级等级 / ZPE 余额 / 暗能量余额
 *
 * 量子升级「惯性」可以把 ZPE 与暗能量的余额也保留下来。
 */
/**
 * 重置下层资源。**只有大坍缩会调用它**（临界坍缩已经不重置任何东西了）。
 *
 * （原来有个 `qe.keepZpeDe` 参数来自旧量子升级「惯性」——整套系统已删除，
 *   所以 ZPE/暗能量现在**总是**被清空。）
 */
function resetForCollapse(state) {
  // ★ ∞ 层「起点跃迁」：把物质起点从 0 抬到 1e{startLog10}（没买就是 0，行为不变）。
  //   只抬**起点**，不碰上限 —— 所以它缩短的是距离，不是改形。
  const startLog = infinityStartLog10(state);
  state.resources.matter = startLog > 0 ? Decimal.pow(10, startLog) : D(0);
  state.resources.particle = D(0);
  state.resources.entropy = D(0);
  state.resources.traps = D(0);
  for (const id of Object.keys(REPEATABLE)) state.levels[id] = D(0);
  state.zpe = D(0);
  state.darkEnergy = D(0);
  // 累积器无论如何都清（它是「本轮进度」，不是资产）
  //
  // ★ 这里原来清的是 `state.zpeAccumulator` —— 那是**旧模型的死字段**，
  //   全项目只有「新建 / 序列化 / 这一行」碰它，界面读的是 `state.deAccum`。
  //   于是相变环的进度在大坍缩后**留了下来**，和「本轮进度归零」的意图相反。
  //   两个都清：deAccum 是活的，zpeAccumulator 留给旧存档一个干净的默认值。
  state.deAccum = D(0);
  state.zpeAccumulator = D(0);
}

// ★ `doCollapse`（临界坍缩）已整个移除 —— 用户决定：暗物质不应存在。
//
//   它原本是「物质跨过阈值(×1e5 递进) -> 领暗物质 -> 全局加成 ×10^DM」的阶梯。
//   被删的理由是**形式性**的，不是调参问题：
//     基础成长 `M'' ∝ log(M)`，乘任何倍率 C 只能得到
//     `log10(M) ∝ 2·log10(t) + 常数(C)` —— 只平移常数项。
//     `10^DM` 累积到 1e560，把曲线平移了几百个数量级，
//     280 个数量级因此挤在 3 秒内跨过。
//
//   现在由**量子涨落**（`quantumGrowthRate`）提供 `∝ M` 的指数项，
//   1e25 -> 1e308.25 实测 1.76 小时。
//
//   `state.collapseThreshold` / `collapseCount` / `darkMatter` 字段也已从 state 删除。

/**
 * 大坍缩：物质到达 1e308.25（= log10(Number.MAX_VALUE)，JS 双精度上限，
 * 也正是 AD「首次无限」的触发点）。
 *
 * 给无限点，重置下层资源。**梦想点永不重置；量子会被重置**（用户明确）。
 */
export function doBigCrunch(state) {
  if (!canBigCrunch(state)) return null;

  // ★ ∞ 层：大坍缩只发**深度部分**（④ 耗时收益已在 tick 里实时发过，这里再发就是重复发放）。
  //   ⚠️ 必须走 `bigCrunchGain()` 这个**唯一数据源** —— 它含 ① 的加成、铸币倍率、量子铸币。
  //      老写法自己算 `infinityPointGain × 3^①`，于是"界面显示"与"实际发放"会脱节。
  const ip = bigCrunchGain(state);
  const depthIP = ip.sub(quantumToIPGain(state));     // 纯深度部分（日志/显示用）
  const elapsed = state.infinityElapsed ?? 0;
  const timeAccrued = state.ipTimeAccrued ?? 0;       // 本轮实时累计（显示/日志用）

  state.infinityPoints = state.infinityPoints.add(ip);
  state.bigCrunchCount = state.bigCrunchCount.add(1);
  resetForCollapse(state);
  // ④ 的计时器与实时累计归零：下一次无限从 0 开始重新累计
  state.infinityElapsed = 0;
  state.ipTimeAccrued = 0;

  // ★ 量子**会被大坍缩重置**。
  //   `quantumPairs`（门槛进度）也必须一起清 —— 否则门槛会退回 1e10，
  //   玩家可以靠反复坍缩刷量子。
  //   `quantumPairsTotal` 是累计统计量，保留。
  state.quantum = D(0);
  state.peakQuantumRun = D(0);       // ★ 量子铸币的基数随量子一起归零
  state.quantumPairs = D(0);

  // ★ 阈值文案从 config 取（CRUNCH_AT_LABEL），不要手写 "1e308.25" ——
  //   手写的那个和实际用的 log10(Number.MAX_VALUE) = 1e308.2547 差 0.25 个数量级。
  pushLog(state, `🌌 大坍缩！物质触及 ${CRUNCH_AT_LABEL} 上限，获得 ${ip.toString()} 无限点（共 ${state.infinityPoints.toString()}）`);
  if (timeAccrued > 0) {
    pushLog(state, `🌊 无限长河：本次无限 ${fmtSeconds(elapsed)} 期间实时进账 ${timeAccrued.toExponential(2)} 点` +
      `（超出 ${Math.round((INFINITY_UPGRADES.ipTime.capSeconds ?? 0) / 60)} 分钟的部分不再产点）`);
  }
  // ⚠️ 这里曾经有一行 `pushLog(... 量子 +${q.toString()} ...)`，以及
  //    `return { infinityPoints: ip, quantum: q }` —— 但 v3 量子模型
  //    已经删掉了「大坍缩给量子」，`q` 这个变量不复存在。
  //    结果 doBigCrunch **每次都抛 ReferenceError**，大坍缩彻底不可用。
  //
  //    所有工具都没抓到，因为没有一个是「跑一遍大坍缩」的：
  //      dom-smoke 永远到不了 1e308 / audit 不调用它 /
  //      dead-code-audit 查的是 config 的 id，不是变量引用。
  //    教训：**删一个功能时，要连带删掉它对外的返回值、日志、接口。**
  pushLog(state, `💭 梦想点保留（${state.dreamPoints.toString()} 点）`);
  awardDream(state, "bigcrunch", "首次大坍缩");
  // ⚠️ 返回值的 `infinityPoints` 是**本次实际发放**的点数（现在只有深度部分）；
  //    耗时部分（④）已经在 tick 里实时发过了，`timeIPAccrued` 只是它的累计值，供日志/界面用。
  return { infinityPoints: ip, depthIP, timeIPAccrued: D(timeAccrued) };
}

/** 耗时的短显示（日志用，纯展示，不参与运算） */
function fmtSeconds(sec) {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
}

/**
 * 购买梦想点一次性升级（量子页）。
 *
 * 为什么在量子页：暗物质工程三个升级里只有第一个（梦想烬灭虚无）烧梦想点，
 * 后两个只烧粒子和 ZPE，导致梦想点中后期没有去处。这两个升级把它接回来。
 *
 * ⚠️ 量子页的这两条**不随大坍缩重置**（梦想点本身也不重置）。
 */
export function buyDreamUpgrade(state, id) {
  const d = DREAM_BY_ID[id];
  if (!d || state.dreamUpgrades[id]) return false;
  if (state.dreamPoints.lt(d.cost)) return false;
  state.dreamPoints = state.dreamPoints.sub(d.cost);
  state.dreamUpgrades[id] = true;
  pushLog(state, `💭 购买梦想点升级「${d.name}」（消耗 ${d.cost} 梦想点）`);
  awardDream(state, `dreamUp:${id}`, `梦想点升级「${d.name}」`);
  return true;
}


// ══════════════════════════════════════════════════════════
// ★ ∞ 层：无限升级（用无限点购买，不随大坍缩重置）
// ══════════════════════════════════════════════════════════

/**
 * 购买无限升级（统一入口）。
 *
 * ⚠️ 价格一律走 `infinityUpgradeCost()`（config 里的唯一数据源），
 *    界面显示的也是它 —— 这样"显示 vs 实际"不可能脱节。
 *
 * @returns {{ok: boolean, cost: Decimal, level: Decimal}} 供 UI/自检读取
 */
export function buyInfinityUpgrade(state, id) {
  const cfg = INFINITY_UPGRADES[id];
  if (!cfg) return { ok: false, cost: D(0), level: state.ipDoubleLevel ?? D(0) };
  if (!cfg.repeatable && infinityUpgradeOwned(state, id)) {
    return { ok: false, cost: D(0), level: state.ipDoubleLevel ?? D(0) };
  }
  const cost = infinityUpgradeCost(state, id);
  if (state.infinityPoints.lt(cost)) {
    return { ok: false, cost, level: state.ipDoubleLevel ?? D(0) };
  }
  state.infinityPoints = state.infinityPoints.sub(cost);

  if (id === "ipDouble") {
    const before = (state.ipDoubleLevel ?? D(0)).toNumber();
    state.ipDoubleLevel = (state.ipDoubleLevel ?? D(0)).add(1);
    // ★ 只在关键节点写日志（① 在贪心自动买法里一帧能连买好几级）
    pushLevelLog(state, cfg.name, before, before + 1);
  } else if (id === "thresholdFlat") {
    state.thresholdFlatBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：量子门槛步长 ×20 → ×10（量子数翻倍）`);
  } else if (id === "pairBoost") {
    state.pairBoostBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：每次捕获 2 → 3 个量子`);
  } else if (id === "unspentBoost") {
    state.unspentBoostBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：a区 产率开始吃未花无限点（封顶 ×${cfg.maxMult}）`);
  } else if (id === "ipFromQuantum") {
    state.infinityFromQuantumBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：每次大坍缩额外按本次最大量子数给点（q²）`);
  } else if (id === "ipToZpe") {
    state.ipToZpeBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：ZPE 倍率开始吃无限点数量`);
  } else if (id === "ipToTransmuter") {
    state.ipToTransmuterBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：相变仪开始吃无限点数量`);
  } else if (id === "ipTime") {
    state.ipTimeBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：每次无限额外按耗时给点（每 ${cfg.secondsPerPoint} 秒 1 点）`);
  } else if (cfg.startLog10 != null) {
    // 起点跃迁：每档都是"开局物质 = 该档深度"，取最高的一档生效
    state.startBought = { ...(state.startBought ?? {}), [id]: true };
    pushLog(state, `∞ 购买「${cfg.name}」：每次大坍缩后以 1e${cfg.startLog10} 物质开局`);
  } else if (cfg.rateMult != null) {
    state.speedBought = { ...(state.speedBought ?? {}), [id]: true };
    pushLog(state, `∞ 购买「${cfg.name}」：量子成长速率上限 ×${cfg.rateMult}（当前 ×${infinityRateMult(state).toFixed(3)}）`);
  }
  // ★ 无限升级也属于「不涉及梦想点系统」的加成 ⇒ **首次**购买任意一条给 1 梦想点。
  //   和虚空/暗能量升级同源：用 awardDream 去重（它自己记 dreamAwarded，重复买不会再发）。
  //   对可重复的 ① 来说就是"第一次买它的那一级"。
  awardDream(state, `inf:${id}`, `首次购买无限升级「${cfg.name}」`);
  return { ok: true, cost, level: state.ipDoubleLevel ?? D(0) };
}

/** 坍缩加速器还能买几级（受**效果硬上限**约束） */
export function accelAffordable(state) {
  const room = accelMaxLevel() - accelLevel(state);
  if (room <= 0) return 0;
  return Math.min(
    affordableFromPool(accelCost(state), CRUNCH_ACCEL.costGrowth, state.infinityPoints, room),
    room,
  );
}

/**
 * 买「坍缩加速器」等级（`max = true` 买满）。
 *
 * 效果是**乘成长速率**（见 config：一次大坍缩的耗时与速率严格成反比），
 * 所以它省的是"每次大坍缩要爬多久"—— 24h 档压到 18h 就靠它。
 * 硬上限 `accelMaxLevel()`（效果 ×2）保证它不会变成第二个 runaway。
 */
export function buyAccel(state, max = false) {
  const lv = accelLevel(state);
  const room = accelMaxLevel() - lv;
  if (room <= 0) return 0;
  const first = accelCost(state);
  const r = CRUNCH_ACCEL.costGrowth;
  let k = max ? affordableFromPool(first, r, state.infinityPoints, room) : (state.infinityPoints.gte(first) ? 1 : 0);
  k = Math.min(k, room);
  if (k < 1) return 0;
  const total = geometricSum(first, r, k);
  if (state.infinityPoints.lt(total)) return 0;
  state.infinityPoints = state.infinityPoints.sub(total);
  state.accelLevel = D(lv).add(k);
  pushLevelLog(state, "坍缩加速器", lv, lv + k);
  if (lv + k >= accelMaxLevel()) {
    pushLog(state, `⏩ 坍缩加速器已到顶（×${CRUNCH_ACCEL.maxMult}）—— 每次大坍缩的耗时已减半`);
  }
  return k;
}

// ══════════════════════════════════════════════════════════
// ★ 无限铸币（**设计未冻结：用户保留最终修改权**）
// ══════════════════════════════════════════════════════════

/** 铸币还能买几级（**闸门优先**：档位放行 ∩ 买得起） */
export function coinageAffordable(state) {
  return coinageAffordableIn(state, state.infinityPoints);
}

/**
 * 买铸币等级（`max = true` 买满）。
 *
 * 铁律（模型实测的教训）：
 *   1. **硬性受档位闸门约束** —— `等级 ≤ capPerCrunch × 大坍缩次数`；
 *      闸门是这条线唯一的节流阀，且**不许**和别的循环用加法耦合。
 *   2. 价格走**分段软上限**（用户指定：影响永恒阶段的东西必须有极强软上限），
 *      所以"买满"不能沿用单一公比的 `geometricSum`。
 *   3. 日志守关键节点（自动买法一帧能连买几十级）。
 */
export function buyCoinage(state, max = false) {
  const room = coinageCap(state) - coinageLevel(state).toNumber();
  if (room <= 0) return 0;
  const pool = state.infinityPoints;
  const n = max ? coinageAffordable(state) : (pool.gte(coinageCost(state)) ? 1 : 0);
  if (n <= 0) return 0;

  const before = coinageLevel(state).toNumber();
  const k = Math.min(n, room);
  const total = coinageTotalCost(before, before + k);
  if (pool.lt(total)) return 0;
  state.infinityPoints = state.infinityPoints.sub(total);
  state.coinageLevel = coinageLevel(state).add(k);

  pushLevelLog(state, "无限铸币", before, before + k);
  // 跨过"闸门放行上限"时提示一次（玩家需要知道该去大坍缩了）
  const capNow = coinageCap(state);
  if (before < capNow && before + k >= capNow) {
    pushLog(state, `🪙 铸币已买满本档（${capNow} 级）—— 再想提升上限就得**大坍缩**一次`);
  }
  return k;
}

// ══════════════════════════════════════════════════════════
// ★ ZPE 引擎（打破无限后 · 虚空系统子页）
// ══════════════════════════════════════════════════════════

/** 解锁 ZPE 引擎（10 无限点，一次性） */
export function unlockZpeEngine(state) {
  if (zpeEngineUnlocked(state)) return false;
  if (state.infinityPoints.lt(ZPE_ENGINE.unlockCostIp)) return false;
  state.infinityPoints = state.infinityPoints.sub(ZPE_ENGINE.unlockCostIp);
  state.zpeEngineUnlocked = true;
  awardDream(state, "zpeEngine", "解锁 ZPE 引擎");
  pushLog(state, `⚙ 解锁「ZPE 引擎」：之后可以拿无限点买等级，等级同时给三条加成`);
  return true;
}

/** ZPE 引擎还能买几级（分段几何的闭式解，见 config.zpeEngineAffordableIn） */
export function zpeEngineAffordable(state) {
  if (!zpeEngineUnlocked(state)) return 0;
  return zpeEngineAffordableIn(state, state.infinityPoints);
}

/**
 * 买 ZPE 引擎等级（`max=true` 买满）。
 *
 * 三条机制都由等级驱动（见 config 的 ZPE_ENGINE）：
 *   · ② 产出倍率 `(1+0.1×等级)²` —— 解锁即有
 *   · ③ 倍率吃「计数频率」     —— 等级 ≥ 5
 *   · ① 抬高倍率公式的指数     —— 等级 ≥ 10
 * 所以跨过 5 / 10 级时要给一条**明确的**日志（规则变了，玩家必须知道）。
 *
 * ⚠️ 价格是**分段几何**（软上限）：10 级后每级涨价 ×20，100 级后再 ^1.3，1000 级后再 ^1.8。
 *    所以这里不能再用"单一公比"的 geometricSum —— 直接用段内闭式算出 k 与总价。
 */
export function buyZpeEngineLevel(state, max = false) {
  if (!zpeEngineUnlocked(state)) return 0;
  const lv0 = zpeEngineLevel(state);
  const before = lv0.toNumber();
  const k = max ? zpeEngineAffordable(state) : (state.infinityPoints.gte(zpeEngineCost(state)) ? 1 : 0);
  if (k < 1) return 0;

  // 总价 = 从当前级买到 before+k 级的分段累加（log 空间求差即可）
  const total = zpeEngineTotalCost(before, before + k);
  if (state.infinityPoints.lt(total)) return 0;
  state.infinityPoints = state.infinityPoints.sub(total);

  state.zpeEngineLevel = lv0.add(k);

  // 等级本身也守"只在关键节点写日志"的规矩
  pushLevelLog(state, "ZPE 引擎", before, before + k);
  // ★ 跨过 ③ / ① 的解锁线时，单独说清楚
  if (before < ZPE_ENGINE.countFreqLevel && before + k >= ZPE_ENGINE.countFreqLevel) {
    pushLog(state, `⚙ ZPE 引擎 ${ZPE_ENGINE.countFreqLevel} 级：ZPE 倍率开始吃「计数频率」加成（指数 2.0 → 3.7）`);
  }
  if (before < ZPE_ENGINE.expLevel && before + k >= ZPE_ENGINE.expLevel) {
    pushLog(state, `⚙ ZPE 引擎 ${ZPE_ENGINE.expLevel} 级：ZPE 倍率公式的指数开始提升` +
      `（+${ZPE_ENGINE.expPerLevel}/级，封顶 +${ZPE_ENGINE.expMax}）`);
  }
  return k;
}

/** 无限升级当前的「效果」文本数值（UI 与自检共用，保证从公式推导） */
export function infinityUpgradeEffect(state, id) {
  const ip = state.infinityPoints ?? D(0);
  const cfg = INFINITY_UPGRADES[id];
  if (id === "ipDouble") {
    return { mult: Decimal.pow(cfg.effectMult, state.ipDoubleLevel ?? 0) };
  }
  if (id === "ipToZpe") {
    return { bonus: D(INFINITY_UPGRADES.ipToZpe.perIp).mul(state.ipToZpeBought ? ip : 0) };
  }
  if (id === "ipToTransmuter") {
    return { mult: D(1).add(D(INFINITY_UPGRADES.ipToTransmuter.perIp).mul(state.ipToTransmuterBought ? ip : 0)) };
  }
  if (id === "ipTime") {
    // ④ 是**实时**产点的：给出 每秒速率 / 本次已实时累计 / 单次上限那一笔 / 是否已封顶
    const cap = INFINITY_UPGRADES.ipTime.capSeconds;
    const mult = Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, state.ipDoubleLevel ?? 0);
    const perSecond = mult.div(INFINITY_UPGRADES.ipTime.secondsPerPoint);
    const elapsed = state.infinityElapsed ?? 0;
    return {
      perSecond,
      perHour: perSecond.mul(3600),
      accrued: state.ipTimeBought ? D(state.ipTimeAccrued ?? 0) : D(0),
      /** 单次无限最多能拿到的那笔（= 上限 ÷ 60 × 3^①） */
      capGain: cap == null ? null : perSecond.mul(cap),
      /** 已经过了上限 → 本轮不再进账，界面提示"该收了" */
      capped: cap != null && elapsed >= cap,
    };
  }
  if (cfg?.startLog10 != null) {
    return { startLog10: cfg.startLog10, activeLog10: infinityStartLog10(state) };
  }
  if (cfg?.rateMult != null) {
    return { totalMult: infinityRateMult(state) };
  }
  return {};
}

// ══════════════════════════════════════════════════════════
// 派生显示值（UI 用，也可用于无头测试）
// ══════════════════════════════════════════════════════════

export function snapshot(state) {
  const { threshold, output } = conversion(state);
  return {
    entropy: state.resources.entropy,
    particle: state.resources.particle,
    matter: state.resources.matter,
    traps: state.resources.traps,
    dreamPoints: state.dreamPoints,
    zpe: state.zpe,
    darkEnergy: state.darkEnergy,
    globalMultiplier: globalMultiplier(state),
    zpeMultiplier: zpeMultiplier(state),
    entropyRate: entropyRate(state),
    particleRate: particleRate(state),
    matterRate: matterRate(state),
    zpeRate: zpeRate(state),
    effectiveTraps: effectiveTraps(state),
    conversion: { threshold, output },
  };
}
