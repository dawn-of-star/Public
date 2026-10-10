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
// ★★★ 2025（用户裁定）：统一的科学计数法 `1.00e308`（`sci()`）
//   ⚠️ 从 `./format.js` 取，**不能**从 `./ui.js` 取 —— `ui.js` 已 import 本文件，
//      反向 import 会成循环依赖 ✗（见 format.js 的头注）
import { sci } from "./format.js";
import {
  BASE, BREAK_INFINITY, CRUNCH_AT_LABEL, DE_UPGRADES, DREAM_BY_ID, INFINITY_UPGRADES, INFINITY_ORDER, QUANTUM, REPEATABLE,
  VOID_UPGRADES, ZPE_ENGINE, crunchThreshold, piecewiseDeCost, dreamUpgradeEffects, infinityPointGain,
  infinityRateMult, infinityStartLog10, infinityUpgradeCost, infinityUpgradeOwned,
  quantumPerPair, quantumStepMult, quantumToIPGain, quantumZpeRequirement,
  tierMilestonesDone, DE_SPAN, deGrowthRate, deEngineLevelBonus, matterSpanMult, zpeEngineCost, zpeEngineCountFreqUnlocked, matterTotalExponent,
  zpeEngineAffordableIn, zpeEngineLevel, zpeEngineTotalCost, zpeEngineUnlocked,
  eternityPointGain, canEternity, icIpJumpMult, ipDoubleMult, ipDoubleAffordableIn, ipDoubleCostFor, hasCollapse, INFINITY_CHALLENGES, quantumZpeMultBonus, ETERNITY, COLLAPSE,
  // ★★★ 2025：永恒升级「永恒增幅」（第三层设计稿 33~35 行）——
  //   效果唯一入口 `epMultFactor`（`doEternity` 用它放大 EP 收益）
  //   价格唯一入口 `epMultPriceAt` / `epMultAffordableIn`（`buyEpMult` 用）
  epMultFactor, epMultPriceAt, epMultAffordableIn, ETERNITY_UPGRADES,
  // ★ 2025：页面「曾经解锁过」的永久记录（第一次永恒后保持解锁；见 config.js 的说明）
  markPageUnlocked,
  // ★★★ 2025：永恒成功时要把**全部**页面打点（见 `doEternity` 的说明）
  PAGE_KEYS,
  // ★ 2025：永恒里程碑（设计稿 36~44 行；按永恒次数解锁）
  hasEternityMilestone } from "./config.js";
import {
  D, bigCrunchGain, canBigCrunch, checkDeMilestones, checkQuantumMilestones, checkZpeMilestones, collapseUnlocked,
  clampToAffordable, conversion, darkEnergyGainPerConversion, darkEnergyRate, deUpgradeCost, effectiveTraps,
  entropyRate, floorDiv, geometricSum, globalMultiplier, isAutoAcquire,
  // ★ 2025：`matterCoeff` 的唯一实现在 formulas.js（它与 matterRate 共用，防「显示≠实发」）
  // ⚠️ `climbFactor` / `overloadFactor` / `particleRate` 本文件仍在用（tick 与显示）——
  //    改这一行时别连带删掉（我第一版就删了 ⇒ 守卫当场报 3 个 ReferenceError ✗）
  matterCoeff, matterRate, climbFactor, overloadFactor, particleRate, particleTimeBoost, repeatableCost, trapCost, voidUpgradeCost,
  zpeMultiplier, zpeRate } from "./formulas.js";
import { addLevel, awardDream, deLevelOf, levelOf, pushLevelLog, pushLog,
  // ★★★ 2025（用户裁定）：量子的日志节点 = 纯 ×5 序列（1/5/25/125/625…）
  isQuantumLogLevel } from "./state.js";
// ══════════════════════════════════════════════════════════
// 系数（供闭式解用）
// ══════════════════════════════════════════════════════════
// ★★★ 2025：`matterCoeff` **已搬到 `formulas.js`**（唯一入口）——
//   它原来在这里、而 `matterRate()` 在 formulas.js 里各算一遍基础产出
//   ⇒ 项目因此踩过 **4 次「显示 ≠ 实发」**（最近一次：`v3` 少了 `voidBoostMult` ⇒ 差 2.09e6 ✗）
//   ⇒ 现在两边共用同一个函数，结构上不可能再分叉 ✓
//   ⚠️ 这里**重新导出**它以保持既有调用方（`tools/zpe-matter-lab.mjs` 等）不受影响 ✓
export { matterCoeff } from "./formulas.js";

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

  // ★★ 2025「步首快照」（**用户点破本质之后**才放对位置）：
  //
  //   本质：**量子是阶梯函数**（每捕获一次跳 +2），而引擎的公式全假设一切平滑 ✗
  //     ⇒ 离散跳变量被塞进"连续积分"的速率里 ⇒ 显示（步首值）与实发（整步）必然分叉 ✗
  //       实测：`consistency` 报物质偏 ~100% ✗
  //
  //   修法（按用户的描述）：**让阶梯的取值固定在这一步的开头** ✓
  //     · tick **开头**设快照 ⇒ 本 tick 的所有速率都读它 ✓
  //     · 显示是 tick **之前**算的，读的正是同一个 `state.quantum` ⇒ 一致 ✓✓
  //     · 捕获照旧在 tick **末尾**原子写回 ⇒ 下一步的快照自然变新值 ✓
  //
  //   ⚠️ 我前三次都错了：① 快照放在 `advance`（该测试**直接调 tick**，走不到 ✗）
  //      ②③ 去搬动**捕获**的时序（该动的是**读取**，不是捕获 ✗）
  state.quantumFrozen = state.quantum;
  try {
    return tickBody(state, dt);
  } finally {
    delete state.quantumFrozen;
  }
}

/** tick 的主体（拆出来只为把「步首快照」用 try/finally 包住 ✓） */
function tickBody(state, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;



  // ★ ∞ 层 ④「无限长河」的计量口径：本次无限已经过去了多少秒。
  //   用 dt 累加而不是读 wall clock —— 离线结算（advance）走的是同一个 tick，
  //   所以挂机 4 小时回来，这段时间也会被如实计入。
  state.infinityElapsed = (state.infinityElapsed ?? 0) + dt;

  // ★★★ 2025（用户裁定）：**本轮时长** `runElapsed` —— 收手判据用它（按时间收手）。
  //   ⚠️ 不能复用 `infinityElapsed`：那个被「无限长河」的 30 分钟上限**截断**过
  //      （见上面 `cap` 那几行）⇒ 用它当收手判据会失真 ✗
  state.runElapsed = (state.runElapsed ?? 0) + dt;

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
        .mul(ipDoubleMult(state));
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
  // ★ 量子 → 粒子获得的**时变增幅**（替代 R 的那个杠杆；2025 用户方案）
  //
  //   `粒子获得 ×= g(t)`，`g = 10^(b·**本轮已过时间**)` —— 用户选甲：时间每轮重置，
  //   否则堆叠会让时间失去意义（第二次大坍缩起瞬间到顶）。
  //   ⚠️ `g` **必须随时间增长**：常数倍率只平移高度，到不了 1e308
  //      （这正是当年 perPair=200 也跨不到顶的原因）。
  //   ⚠️ 粒子在**环外**（`effectiveTraps` 不读粒子）⇒ 不进环，S 判据安全。
  //   ⚠️ 与 `formulas.js` 的 `particleRate()` **必须同项**（显示 == 实发）。
  particleGain = particleGain.mul(particleTimeBoost(state));
  state.resources.entropy = entropy;
  state.stats.totalEntropy = state.stats.totalEntropy.add(eGain);

  // ── 2. 粒子 & 物质（闭式解 + 量子的指数项）──
  // ★★ 2025：传入**本片的粒子数** `P0` —— 过载的触发量是「未削减的速率」`P0 × coeff`，
  //   而 `matterCoeff` 需要它才能算出这个速率（`state.resources.particle` 此刻还是旧值）。
  const k = matterCoeff(state, P0);
  const c = particleGain.div(dt); // 本片的等效粒子速率
  state.resources.particle = P0.add(particleGain);

  let matterGain = k.mul(P0.mul(dt).add(c.mul((dt * dt) / 2)));

  // ★ 旧「量子 → 指数成长速率 R」那一项**已删除**（2025 用户决定：取消 R 机制）。
  //
  //   它原本是 `dM/dt += M·R·ln10`，让物质在时间里指数增长（`d(log10 M)/dt = R`）。
  //   取消的理由：R 是**速率常数**，只能改速度、改不了形状 ⇒ 可玩性窄（见 PROGRESSION.md §0.6）。
  //   替代：**粒子获得的时变增幅**（上面的 `particleTimeBoost`）——
  //   同样给"时间里指数增长"，但落在**粒子线**上，而且增幅本身随里程碑与档位成长 ✓
  // ★★ 2025：R（量子给的指数成长速率）**已彻底删除**。物质不再有 `M·R·ln10` 那一项。
  //   承重机制改为两层：
  //     · 引擎之前：**粒子获得的时变增幅**（`particleTimeBoost`，见上）
  //     · 引擎之后：**暗能量自增长 a(DE) → 跨度层 (DE/DE₀)^k**
  //   实测删 R 后物质**仍能撞到 1e308**（第一次大坍缩 10.52h，×1.75 目标 13.39h）✓

  // ★★ 2025：**过载 / 爬升不在这里乘** —— 它们已经含在 `matterCoeff(state, P0)` 里
  //   （用户裁定「有且只影响获得速率」⇒ 落点在系数上，唯一入口）。
  //   ⚠️ 踩过：这里原来又乘了一次 `overloadFactor` / `climbFactor` ⇒ **平方** ⇒
  //      `consistency.mjs` 报「matterRate 误差 2.32%」✗
  //   ⇒ 现在 `matterGain = k × (闭式积分项)`，衰减只出现一次 ✓

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

  // ── 4b. ★ 暗能量的**自增长**（替代 R 的那一位；2025 用户方案）──
  //
  //   `dDE/dt = a(DE)·DE` ⇒ `d(log10 DE)/dt = a(DE)` —— 暗能量在**时间里指数增长**，
  //   只需跨 50 阶就能靠跨度层把物质撬到 1e308（`1e50^6.1651 = 1e308`）。
  //
  //   ⚠️ 用户选定的开关（方案 B，符合直觉）：**必须先解锁 ZPE 引擎**才开启。
  //
  //   ★★ 2025「开根削弱」（用户方案，专治破∞→永恒那段 runaway ✗）：
  //      原来等级给的是**线性**倍率 `1 + 0.1×等级` ✗
  //      ⇒ 与 IP 深度复利 `IP ≈ 10^(0.035·x)`、跨度层 `DE^k` 乘在一起后，
  //        `dx/dt ∝ x`（x = 超出上限的阶数 ⇒ 物质的 log 本身指数爆炸 ✗，
  //        等级 1021 时 log 翻倍时间只有 18 秒 ✗，见 tools/post-break-runaway-lab.mjs）
  //      ⇒ 改成 **开根**：`1 + 0.1×√等级` ✓
  //        数学效果：`dx/dt ∝ √x` ⇒ `x ∝ t²`（**多项式**，不是指数 ✗）
  //        ⇒ 越到后期越自我减速 ✓（等级 1021 时倍率从 ×103 降到 ×4.2 ✓）
  if (state.zpeEngineUnlocked) {
    const lv = zpeEngineLevel(state).toNumber();
    const engineMult = deEngineLevelBonus(lv);
    const a = deGrowthRate(state, engineMult);          // 阶/秒（随 DE 衰减但有下限）
    const deSelf = state.darkEnergy.max(1).mul(a).mul(Math.LN10).mul(dt);
    state.darkEnergy = state.darkEnergy.add(deSelf);
    state.darkEnergy = state.darkEnergy.max(0);   // ★ 每帧统一夹住 ≥0（否则任何扣款扣成负数 ⇒ log10(负数)=NaN ⇒ 全链坏死 ✗）
    if (String(state.darkEnergy).includes("NaN")) state.darkEnergy = D(1);   // ★ NaN 守卫：NaN 无法被 max 救回 ⇒ 直接重置 ✓
    state.darkEnergyTotal = state.darkEnergyTotal.add(deSelf);
  }

  // ── 5. 里程碑 ──
  for (const m of checkZpeMilestones(state)) {
    pushLog(state, `🏆 达成虚空里程碑：${m.desc}`);
    awardDream(state, `zpeMs:${m.id}`, m.desc);
  }
  // ★★ 2025 补：**量子里程碑的检查从来没被调用过** ✗✗
  //   ⇒ qm1~qm7 在真实引擎里全是死的（b 的加成、档位加速、qm4/qm5/qm7 全不生效）
  //   ⇒ 教训：单元级断言（直接调 `checkQuantumMilestones`）**抓不到"没接线"** ✗
  //     已补一条**集成级**断言（见 tools/stage-timing.mjs 的里程碑检查）
  for (const m of checkQuantumMilestones(state)) {
    pushLog(state, `🏆 达成量子里程碑：${m.desc}`);
    awardDream(state, `qm:${m.id}`, m.desc);
  }
  for (const m of checkDeMilestones(state)) {
    pushLog(state, `🏆 达成暗能量里程碑：${m.desc}`);
    awardDream(state, `deMs:${m.id}`, m.desc);
    if (m.id === "dm0") {
      state.phaseTransmuterUnlocked = true;
      markPageUnlocked(state, "de");         // ★ 永久解锁记录（永恒后不再上锁）
      pushLog(state, "🌌 相变仪已解锁！");
    }
  }

  // ── 6. 历史最高物质（第四层解锁条件 + 坍缩进度）──
  if (state.resources.matter.gt(state.peakMatter)) {
    state.peakMatter = state.resources.matter;
  }
  // ★★ 2025：物质首次摸到 1e25 ⇒ 「量子」页面永久解锁（**独立于 peakMatter**，
  //   否则永恒把 peakMatter 清零后整排标签会重新上锁 ✗ —— 用户实测反馈就是这个）
  if (state.peakMatter.gte(COLLAPSE.unlockMatter) && markPageUnlocked(state, "quantum")) {
    pushLog(state, "⚛ 量子涨落已解锁！");
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


  // ── 11. 捕获的**登记**在 `phaseQuantumCapture` 里完成（写回留到**下一个 tick 的开头** ✓）──

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
    const need = quantumZpeRequirement(state.quantumPairs, quantumStepMult(state), state);
    if (state.zpe.lt(need)) break;
    state.quantumPairs = state.quantumPairs.add(1);
    state.quantumPairsTotal = state.quantumPairsTotal.add(1);
    state.quantum = state.quantum.add(quantumPerPair(state));
    if (state.quantum.gt(state.peakQuantumRun ?? 0)) state.peakQuantumRun = state.quantum;
    // ★★★ 2025（用户裁定）：「顺手优化下量子的日志输出，
    //   每 **1/5/25/125/625**（以此类推）对量子输出」
    //   ⚠️ 原来是**每对都写一条** ⇒ 一局几百对就把 #log-panel 刷爆、
    //      把真正重要的事件（大坍缩 / 里程碑）冲走 ✗
    //   ⚠️ 判据用 `isQuantumLogLevel`（**纯 ×5 序列**），
    //      **不是** `isKeyLevel`（那是 ×5/×2 交替，给重复购买升级用的）—— 语义不同，别混 ✗
    //   ⚠️ `quantumPairs` 是 Decimal ⇒ 先 `toNumber()`（超 1e18 时 toNumber 给近似值，
    //      而我们的序列上界也是 1e18 ⇒ 边界处也不会误判 ✓）
    if (isQuantumLogLevel(state.quantumPairs.toNumber())) {
      pushLog(state, `⚛ 捕获第 ${state.quantumPairs.toString()} 对量子（门槛 ${sci(need)} ZPE）`);
    }
    // ★★ 2025：**捕获量子会重置 ZPE**（设计稿第 39 行「量子获取时不再重置 zpe」的**前提**）。
    //   在此之前这个重置**根本没实现** —— 那么 em3 就成了一条永远为真的空条目 ✗
    //   ⇒ 先把重置实现出来，再由 **em3** 豁免它（「不再重置」= 增量式升级 ✓）。
    //   ⚠️ 重置后**必须 `break`**：`need` 是按 `quantumPairs` 算的，ZPE 归零后本轮不可能再捕获，
    //      继续循环只会空转（`state.zpe.lt(need)` 下一轮就成立了，其实安全，但 `break` 语义更清楚）。
    if (!hasEternityMilestone(state, "em3")) {
      state.zpe = D(0);
      pushLog(state, "⚛ 捕获量子：ZPE 已重置（em3 后不再重置）");
      break;
    }
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
  markPageUnlocked(state, "infinity");   // ★ 永久解锁记录（永恒后不再上锁）
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
  // ★★ 2025「步首快照」（用户要求，修"显示 ≠ 实发"）：
  //   短步（≤ 30 秒）里所有"量子派生"的读取都走 `qOf()` ⇒ 冻结在步首的值 ✓
  //   长步（离线结算）**不冻结** —— 否则几小时的量子进展会被拉平 ✗
  //   ⚠️ 只设**影子字段** `quantumFrozen`，**绝不覆盖** `state.quantum` 的累计 ✓
  //      （第一版草稿就是覆盖 state ⇒ 会把量子累计抹掉 ✗，已废弃）
  const FREEZE_MAX_S = 30;
  const freeze = remaining <= FREEZE_MAX_S;
  if (freeze) state.quantumFrozen = state.quantum;
  try {
    for (let i = 0; i < chunks; i++) tick(state, dt);
  } finally {
    if (freeze) delete state.quantumFrozen;
  }
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
  markPageUnlocked(state, "void");       // ★ 永久解锁记录（永恒后不再上锁）
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
  if (cost.darkEnergy) state.darkEnergy = state.darkEnergy.sub(cost.darkEnergy).max(0);   // ★ 夹住 ≥0：否则 log10(负数) = NaN ⇒ 整条链坏死 ✗

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
  state.darkEnergy = D(1);   // ★ 不能归零：log10(0) = -Infinity ⇒ 下游 NaN ⇒ 全链冻结 ✗
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
  // ★ IC（无限挑战）：条件只有"抵达无限"⇒ 大坍缩即视为通过（第三种设计稿 ✓）
  icCompleteOnCrunch(state);

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
  // ★ 2025：**本轮时长也归零**（收手判据按时间 ⇒ 必须每轮重置）
  state.runElapsed = 0;

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
  // ★ cm1 / cm4（新 8 条坍缩里程碑）：无限后的开局赠礼（重置之后、返回之前 ✓）
  if (hasCollapse(state, "cm1")) {
    state.resources.particle = Decimal.max(D(state.resources.particle ?? 0), D(10));
    state.resources.matter = Decimal.max(D(state.resources.matter ?? 0), D(10));
  }
  if (hasCollapse(state, "cm4")) {
    state.quantum = Decimal.max(D(state.quantum ?? 0), D(4));
  }

  // crunch NaN guard: the DE reset path can leave a poisoned value; restore it here   if (String(state.darkEnergy).includes("NaN") || state.darkEnergy.lt(0)) state.darkEnergy = D(1);
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
  // ★ 门槛：跨度层开关（「门槛压平」）只在**打破无限之后**可买。
  //   这是"何时可以买"的硬门槛，与价格（"多久买得起"）**解耦** ——
  //   所以价格以后在 10 / 50 / 128 之间怎么调，都不会让它在打破无限前被买到。
  if (id === "thresholdFlat" && !state.brokenInfinity) {
    return { ok: false, cost: D(0), level: state.ipDoubleLevel ?? D(0) };
  }
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
    // ★ 2025：**基准不再在这里记** —— 它改由"解锁 ZPE 引擎"时记录（见 unlockZpeEngine）。
    //   原因：引擎把 `a(DE)` 打开 ⇒ DE 从引擎到手就开始指数增长；
    //   若等到买这个开关时才记基准，而那时 DE 早已撞上 1e50 ⇒ 跨度乘数 ≈ 1 ⇒ 白买 ✗
    if ((state.spanDeBase ?? D(0)).lte(0)) {
      // 兜底：若玩家在引擎解锁前就买到它（不该发生），仍记一次，避免乘数恒 1
      state.spanDeBase = (state.darkEnergy ?? D(0)).max(1);
    }
    pushLog(state, `∞ 购买「${cfg.name}」：量子门槛步长 ×20 → ×10（量子数翻倍）`);
    pushLog(state, `★ 跨度层已开启：基准 = ${sci(state.spanDeBase)}` +
      `（引擎到手时记录），物质产出按 (DE / 基准)^k 放大（k 由量子个数给，封顶 ${DE_SPAN.kMax}）`);
  } else if (id === "pairBoost") {
    state.pairBoostBought = true;
    pushLog(state, `∞ 购买「${cfg.name}」：每次捕获 2 → 3 个量子`);
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
    pushLog(state, `∞ 购买「${cfg.name}」：每次大坍缩后以 ${sci(Decimal.pow(10, cfg.startLog10))} 物质开局`);
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

/**
 * ★ 2025：**① 无限增幅「买满」**（用户要求它像升级中心里的可重复升级那样带买满按钮）。
 *
 * 与主升级的 `buyRepeatable(max=true)` 同套路：
 *   ① 用闭式探针 `ipDoubleAffordableIn()` 问"能买几级"（分段等比，O(段数)）
 *   ② 用 `ipDoubleCostFor()` 算这 k 级的**总价**（与探针同源 ✓）
 *   ③ 一次扣款、一次写日志（只在关键等级节点，避免一帧刷几百条）
 *
 * ⚠️ 不复用 `buyInfinityUpgrade` 的循环：那样会每级写一条日志 + 扣一次款 ✗
 *    （① 在后期一买就是几百级，逐级调用会把日志面板刷爆 —— 项目里踩过同类坑。）
 */
export function buyIpDoubleMax(state) {
  const before = (state.ipDoubleLevel ?? D(0)).toNumber();
  const k = ipDoubleAffordableIn(before, state.infinityPoints);
  if (!(k > 0)) return 0;
  const total = ipDoubleCostFor(state, k);
  if (state.infinityPoints.lt(total)) return 0;      // 兜底：探针与总价必须同源
  state.infinityPoints = state.infinityPoints.sub(total);
  state.ipDoubleLevel = D(before).add(k);
  pushLevelLog(state, INFINITY_UPGRADES.ipDouble.name, before, before + k);
  return k;
}

// ══════════════════════════════════════════════════════════
// ★★★ 2025 新实现（第三层设计稿 33~35 行）：**永恒升级「永恒增幅」**
// ══════════════════════════════════════════════════════════
// 设计稿：「永恒升级面板：将最终获得的永恒点 *5（价格初始 1ep，每次购买后 *5）」
//
// ⚠️ 与 `ipDouble` 一样：价格与效果**各只有一处实现**（config.js 的
//   `epMultPriceAt` / `epMultFactor`）⇒ 显示与实发不可能脱节 ✓
// ⚠️ 它**不随永恒重置**（永恒升级的性质）⇒ `doEternity` 里不清 `epMultLevel` ✓

/**
 * 买 `k` 级「永恒增幅」（`k` 省略 = 买满）。
 * @returns {number} 实际买到的级数（0 = 一级都买不起）
 */
export function buyEpMult(state, k = null) {
  const before = Math.max(0, Number(state.epMultLevel ?? 0) || 0);
  const cfg = ETERNITY_UPGRADES.epMult;
  if (!cfg) return 0;
  let want;
  if (k == null) {
    // 买满（闭式）：池子能买几级
    want = epMultAffordableIn(before, state.eternityPoints);
  } else {
    want = Math.max(0, Number(k) || 0);
  }
  if (!(want > 0)) return 0;
  // 总价：**与 `epMultAffordableIn` 用同一个几何和公式**（等比数列 ⇒ 无浮点漂移）✓
  //   `first·(g^k − 1)/(g − 1)`　（g = costMult = 5）
  const g = new Decimal(cfg.costMult);
  const first = epMultPriceAt(before);
  const total = first.mul(g.pow(want).sub(1)).div(g.sub(1));
  if (state.eternityPoints.lt(total)) return 0;        // 兜底：探针与总价必须一致
  state.eternityPoints = state.eternityPoints.sub(total);
  state.epMultLevel = before + want;
  pushLevelLog(state, cfg.name, before, before + want);
  return want;
}

// ══════════════════════════════════════════════════════════
// ★ 永恒（手动触发；门槛 = 无限点 1e280，用户指定）
// ══════════════════════════════════════════════════════════

/**
 * ★★ 2025 em1（永恒里程碑 1）：「每次永恒后保留非重复购买的无限升级（每 2 次永恒保留 1 个）」
 *
 * 保留几个 = `floor(永恒次数 / 2)`（用**本次永恒之后**的次数，见调用点）。
 * 保留哪些 = 取 `INFINITY_ORDER` 里**非重复购买**条目的**末尾 N 个** ——
 *   该数组大体按"从便宜到贵"排列 ⇒ 末尾就是**最贵**的 ⇒ 保留价值最高（越贵越难重新买回）✓
 *
 * ⚠️ 必须**幂等**：它只把对应标记设 `true`，不清任何东西（`doEternity` 会先全清再调它）。
 * @returns {string[]} 本次保留的升级 id（供日志/自检）
 */
export function applyEternityRetention(state) {
  const count = Math.floor((state.eternityCount ?? 0) / 2);
  if (count <= 0) return [];
  const singles = INFINITY_ORDER.filter((id) => !INFINITY_UPGRADES[id]?.repeatable);
  const kept = [];
  // ⚠️ 每次**全新分配**这两个容器：调用点（`doEternity`）刚把 `startBought`/`speedBought` 清成 `{}`，
  //    所以这里不需要判重；直接写即可（幂等：重复调用的结果相同 ✓）
  state.startBought = state.startBought ?? {};
  state.speedBought = state.speedBought ?? {};
  for (const id of singles.slice(-count)) {
    // 各条一次性升级的**真实标记字段** —— 口径与 `infinityUpgradeOwned()`（config.js）逐条对应，
    // 改这里必须同步改那里（两处不一致 = "买了却没生效"类 bug 的经典成因 ✗）
    if (id === "thresholdFlat") state.thresholdFlatBought = true;
    else if (id === "pairBoost") state.pairBoostBought = true;
    else if (id === "ipFromQuantum") state.infinityFromQuantumBought = true;
    else if (id === "ipToZpe") state.ipToZpeBought = true;
    else if (id === "ipToTransmuter") state.ipToTransmuterBought = true;
    else if (id === "ipTime") state.ipTimeBought = true;
    else if (id.startsWith("start")) state.startBought[id] = true;
    else if (id.startsWith("rate")) state.speedBought[id] = true;
    else continue;                                     // 未知 id：不静默算作保留
    kept.push(id);
  }
  return kept;
}

/**
 * 永恒一次（**手动**，项目里刻意没有"到门槛自动触发"）。
 *
 * AD 同源：永恒点 = `floor(5^(log10(IP)/308 − 0.7))`，并重置 ∞ 层及其以下的一切。
 *
 * 重置 / 保留（与 `#panel-eternity` 的可视清单**逐条对应**：改一处必须改两处）：
 *   · 归零：物质 / 粒子 / 熵 / 熵阱 · 三条主升级 · ZPE / 暗能量 / 量子 ·
 *          无限点 · 全部 ∞ 升级（含铸币、加速器）· 大坍缩次数（档位归零）· ZPE 引擎
 *   · 保留：**梦想系统（梦想点 / 梦想升级 / 成就账本）** · 永恒点与永恒次数 · 日志与统计
 *
 * ⚠️ **奖励目前是占位**（暗物质要换新机制），所以第二次永恒**不会更快** ——
 *    这是占位期的已知代价，等奖励定下来再平衡（见 `docs/IP-ECONOMY.md`）。
 */
export function doEternity(state) {
  if (!canEternity(state)) return null;

  const gained = eternityPointGain(state.infinityPoints).mul(epMultFactor(state));
  const ipBefore = state.infinityPoints;
  state.eternityPoints = (state.eternityPoints ?? D(0)).add(gained);
  // ★★ 2025：**累计 EP** —— em5 的读数源（只增不减；见 state.js 的字段说明）
  state.eternityPointsTotal = (state.eternityPointsTotal ?? D(0)).add(gained);
  state.eternityCount = (state.eternityCount ?? 0) + 1;

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025（用户实测报告 + 用户裁定）：**永恒后补齐「曾经解锁过」的记录**
  // ══════════════════════════════════════════════════════════
  // 用户原话：「永恒次数若 > 1 则解锁永恒前所有页面」
  //   但用户后来给了截图，证明真正的语义是「**永恒之前解锁过的所有页面**」
  //   —— 那必然包含"永恒"这一页本身 ⇒ 判据是"**至少永恒过一次**"即 `count > 0` ✓
  //
  // 病根（用户截图：无限/永恒两页显示"待推进"）：
  //   `markPageUnlocked` 只在**解锁那一刻**打点，而这些页面是"本轮的实时条件"
  //   （无限页判 `brokenInfinity`、量子页判 `peakMatter ≥ 1e25`、永恒页判 `eternityCount > 0`）
  //   ⇒ 永恒把 IP / 大坍缩 / peakMatter 全清零 ⇒ `live` 变假
  //   ⇒ 若 `pageUnlocked` 记录是空的（旧档，或那一刻没打点成功）
  //     ⇒ `perma` 也是假 ⇒ 页面**退回"待推进"** ✗
  //
  // ⇒ 修法：**永恒成功这一刻**，把全部 `PAGE_KEYS` 打点（能走到永恒 = 这些页面必然都解锁过）
  //   ✓ 自愈：用户当前那个"记录为空"的档，**再永恒一次就自动补上**
  //   ✓ 且此后存档里就有记录了 ⇒ 刷新 / 后续永恒都不会再退回 ✓
  //   ⚠️ 放在 `eternityCount + 1` **之后**（打点与计数同源，不会漏掉第一次）
  for (const k of PAGE_KEYS) markPageUnlocked(state, k);

  // ── ∞ 层归零 ──
  state.infinityPoints = D(0);
  state.ipDoubleLevel = D(0);
  state.ipToZpeBought = false;
  state.ipToTransmuterBought = false;
  state.ipTimeBought = false;
  state.infinityFromQuantumBought = false;
  state.thresholdFlatBought = false;
  state.pairBoostBought = false;
  state.startBought = {};
  state.speedBought = {};
  state.brokenInfinity = false;
  state.ipTimeAccrued = 0;
  state.infinityElapsed = 0;
  // 档位 / 量子（铸币与坍缩加速器已删除）
  state.bigCrunchCount = D(0);
  state.peakQuantumRun = D(0);
  state.quantum = D(0);
  state.quantumPairs = D(0);
  // ZPE 引擎（它在 ∞ 层之下）
  state.zpeEngineUnlocked = false;
  state.zpeEngineLevel = D(0);

  // ── 虚拟系统整体归零（★ 用户明确：**除梦想系统外，一切重置**）──
  //   虚空升级（v1~v9）、ZPE 里程碑、暗能量里程碑、暗能量升级等级、相变仪解锁：
  //   全部属于"进度"，永恒一律归零。**只留梦想系统**（梦想点 / 梦想升级 / 成就账本）。
  for (const k of Object.keys(state.voidUpgrades ?? {})) state.voidUpgrades[k] = false;
  for (const k of Object.keys(state.zpeMilestones ?? {})) state.zpeMilestones[k] = false;
  for (const k of Object.keys(state.deMilestones ?? {})) state.deMilestones[k] = false;
  for (const k of Object.keys(state.deUpgradeLevels ?? {})) state.deUpgradeLevels[k] = D(0);
  state.phaseTransmuterUnlocked = false;
  // （自动化不是独立字段：`isAutoAcquire()` 由 v9 / ZPE 里程碑推导 ⇒ 上面清掉它们就自动失效）

  // ── 无限层以下的资源与升级：复用大坍缩的重置 ──
  resetForCollapse(state);
  state.deAccum = D(0);
  state.zpeAccumulator = D(0);
  state.peakMatter = D(0);

  // ★★ 2025 em1：**在各层都清空之后**，按里程碑把"保留的 ∞ 升级"补回来。
  //   ⚠️ 必须放在 `resetForCollapse` **之后** —— 它内部会读 `startBought` 抬高开局物质
  //      （`infinityStartLog10`）。若先补回，这一轮会白送一次 1e150 级起点 ✗
  const retained = hasEternityMilestone(state, "em1") ? applyEternityRetention(state) : [];
  if (retained.length) {
    pushLog(state, `⏳ em1：保留 ${retained.length} 个非重复 ∞ 升级（${retained.map((id) => INFINITY_UPGRADES[id]?.name ?? id).join("、")}）`);
  }

  pushLog(state, `⏳ 永恒第 ${state.eternityCount} 次：无限点 ${sci(ipBefore)} → ` +
    `获得 ${gained.toString()} 永恒点（共 ${state.eternityPoints.toString()}）`);
  pushLog(state, "⏳ 已重置除梦想系统外的一切（虚空 / 里程碑 / ∞ 层及以下）；永恒点保留");
  return { eternityPoints: gained, count: state.eternityCount };
}

// ★★ 2025：**坍缩加速器已整个删除**（用户裁定 —— "否则会对机制解读有极大污染"）
//   原落点在这里：`accelAffordable()` / `buyAccel()` 两个导出函数。
//   它属于"IP → 成长速率"的平行环，且与「速率解放」「档位 rate 里程碑」共用
//   `infinityRateMult` 入口 ⇒ 界面上分不清谁在起作用。详见 config.js 的说明。

// ══════════════════════════════════════════════════════════
// ★ 无限铸币（**设计未冻结：用户保留最终修改权**）
// ══════════════════════════════════════════════════════════

/** 铸币还能买几级（**闸门优先**：档位放行 ∩ 买得起） */



// ══════════════════════════════════════════════════════════
// ★ ZPE 引擎（打破无限后 · 虚空系统子页）
// ══════════════════════════════════════════════════════════

/**
 * 解锁 ZPE 引擎。
 *
 * ★ 2025 用户决定：**解锁节点提前** —— 条件从「10 无限点」改为「**1 次大坍缩**」，
 *   并且**送 1 级等级**（当作第一次无限的里程碑奖励）。
 *
 * 为什么：`a(DE)`（暗能量指数增长）是挂在引擎上的 ⇒ 引擎越早到手，
 *   DE 的自增长就越早开始（实测从 7.73h 提前到 2.05h，省 5.7 小时）✓
 *
 * ★ 同时记录**跨度基准 `spanDeBase`**：引擎到手这一刻的 DE 水位。
 *   跨度乘数 = `(DE / 此刻的 DE)^k`，所以"引擎到手 → 买到门槛压平"期间的 DE 增长
 *   会被**完整**换算成跨度 ✓（开关仍是「门槛压平」，两者必须分开，见 config 注释）
 */
export function unlockZpeEngine(state) {
  if (zpeEngineUnlocked(state)) return false;
  // 条件：至少大坍缩过 1 次（不再花无限点）
  if ((state.bigCrunchCount ?? D(0)).lt(1)) return false;
  state.zpeEngineUnlocked = true;
  markPageUnlocked(state, "zpe");        // ★ 永久解锁记录（永恒后不再上锁）
  // 送 1 级（里程碑奖励）
  state.zpeEngineLevel = (state.zpeEngineLevel ?? D(0)).max(1);
  // 跨度基准：记下此刻的暗能量水位（只记一次）
  if ((state.spanDeBase ?? D(0)).lte(0)) {
    state.spanDeBase = (state.darkEnergy ?? D(0)).max(1);
  }
  awardDream(state, "zpeEngine", "解锁 ZPE 引擎");
  pushLog(state, "⚙ 第一次大坍缩的里程碑奖励：解锁「ZPE 引擎」并赠送 1 级");
  pushLog(state, `⚙ 暗能量自增长已开启（基准 = ${sci(state.spanDeBase)}）；` +
    "之后可以拿无限点买等级，等级同时给四条加成（加法区 / 产出与倍率 / 计数频率与量子 / 暗能量倍率）");
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
  // ★ 跨过 ③ 的解锁线时，单独说清楚
  //   ⚠️ 2025：另一条 ①「抬公式指数」**已废弃**（改成加法区加成 ✓），
  //      所以这里不再播报 10 级的旧机制 ✗
  if (before < ZPE_ENGINE.countFreqLevel && before + k >= ZPE_ENGINE.countFreqLevel) {
    pushLog(state, `⚙ ZPE 引擎 ${ZPE_ENGINE.countFreqLevel} 级：ZPE 倍率开始吃「计数频率」加成`);
  }
  return k;
}

/** 无限升级当前的「效果」文本数值（UI 与自检共用，保证从公式推导） */
export function infinityUpgradeEffect(state, id) {
  const ip = state.infinityPoints ?? D(0);
  const cfg = INFINITY_UPGRADES[id];
  if (id === "ipDouble") {
    // ★★ 2025：**必须走唯一入口** `ipDoubleMult()`，不许在这里手写 `pow(effectMult, 等级)` ✗
    //   踩过：这里曾手写 `Decimal.pow(cfg.effectMult, level)`，而实发侧 `ipDoubleMult()`
    //   当时是**线性** `1+0.10×等级` ⇒ 100 级时**显示比实发大 1.2e29 倍** ✗
    //   （项目明令禁止的"显示 ≠ 实发"；而且是**两处各写一遍**的经典成因。）
    //   现在实发与显示共用这一条公式 ⇒ 换成什么形态都自动同步 ✓
    return { mult: ipDoubleMult(state) };
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
    const mult = ipDoubleMult(state);
    const perSecond = mult.div(INFINITY_UPGRADES.ipTime.secondsPerPoint);
    const elapsed = state.infinityElapsed ?? 0;
    return {
      perSecond,
      perHour: perSecond.mul(3600),
      accrued: state.ipTimeBought ? D(state.ipTimeAccrued ?? 0) : D(0),
      /** 单次无限最多能拿到的那笔（= 上限 ÷ 60 × 3^①） */
      capGain: cap == null ? null : perSecond.mul(cap),
      /** 已经过了上限 → 本轮不再进账，界面提示"该收了" */
      capped: cap != null && elapsed >= cap };
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
    conversion: { threshold, output } };
}

// ══════════════════════════════════════════════════════════
// 无限挑战（IC）—— 第三种设计稿（用户 2025）
//   · 条件只有"抵达无限" ⇒ 挑战激活期间完成一次大坍缩即通过
//   · 熵需求 ×5^(k+1)（由 formulas.conversion 读 icEntropyMult）
//   · 通过 ⇒ 无限点余额跃升一段（固定常数，只有 7 步 ⇒ 判据安全）
// ══════════════════════════════════════════════════════════
export function startInfinityChallenge(state, k) {
  if (!state.brokenInfinity) return { ok: false, reason: "需先打破无限" };
  if (k > state.ic.completed) return { ok: false, reason: "必须按顺序完成" };
  if (state.ic.active != null) return { ok: false, reason: "已在进行中" };
  // 用户 2025：挑战开始时**先做一次大坍缩**（否则会借当前进度直接爬到 inf ✗）
  doBigCrunch(state);
  // ★ 用户 2025：IC 开始时把资源**削弱到 1**（每次挑战都从"一根线"重爬 ✓）
  state.resources.entropy = D(1);
  state.resources.particle = D(1);
  state.resources.matter = D(1);
  state.resources.traps = D(1);
  state.zpe = D(1);
  state.quantum = D(1);
  state.quantumPairs = D(0);
  state.darkEnergy = D(1);


  state.ic.active = k;
  pushLog(state, ` 开始无限挑战 ${k + 1}／${INFINITY_CHALLENGES.max}（熵需求 ×${Math.pow(INFINITY_CHALLENGES.entMult, k + 1)}）`);
  return { ok: true };
}

export function abandonInfinityChallenge(state) {
  if (state.ic.active == null) return { ok: false };
  state.ic.active = null;
  pushLog(state, " 放弃当前无限挑战");
  return { ok: true };
}

/** 大坍缩时判定 IC：通过 ⇒ completed+1、余额跃升一段、回到非挑战态 */
export function icCompleteOnCrunch(state) {
  const k = state.ic?.active;
  if (k == null) return null;
  const jump = icIpJumpMult();
  state.infinityPoints = D(state.infinityPoints ?? 0).mul(jump);
  state.ic.completed = Math.max(state.ic.completed, k + 1);
  state.ic.active = null;
  pushLog(state, ` 无限挑战 ${k + 1} 通过 ⇒ 无限点跃升一段（×${sci(Decimal.pow(10, INFINITY_CHALLENGES.ipJumpOrders))}）`);
  return { completed: state.ic.completed, jump };
}
