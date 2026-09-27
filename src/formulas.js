/**
 * formulas.js —— 全部计算（纯函数，不碰 DOM）
 *
 * 从 0.3.4 的 engine.js 移植。所有派生值都在这里算，state 只存原始数据。
 * 纯函数的好处：能在 Node 里直接跑无头测试（见 tools/headless.mjs）。
 *
 * ⚠️ 大数一律用 Decimal.pow，绝不用 Math.pow。
 *    JS 的 Number 上限是 1.8e308，Math.pow(4, 512) 就会溢出成 Infinity
 *    并被 D() 转成 dInf，污染整条链。SPEC §5.3
 */

import Decimal from "../dist/break_eternity.esm.js";
import {
  BASE, BREAK_INFINITY, COLLAPSE, DE_MILESTONES, DE_PENALTY, DE_UPGRADES,
  REPEATABLE, piecewiseDeCost,
  VOID_UPGRADES, ZPE_EXPONENT, ZPE_MILESTONES, crunchThreshold,
  infinityPointGain, quantumDeGainBonus, quantumDeMultBonus,
  quantumEntropyMultiplier, quantumGrowthRate, dreamUpgradeEffects,
} from "./config.js";
import { deLevelOf, hasDe, hasV9, hasVoid, hasZpe, levelOf } from "./state.js";

const D = (v) => new Decimal(v ?? 0);
export { D };

// ══════════════════════════════════════════════════════════
// 全局倍率
// ══════════════════════════════════════════════════════════

/** 梦想点的系数。v4 把它从 0.02 提到 0.08。 */
export function dreamCoefficient(state) {
  return hasVoid(state, "v4") ? 0.08 : 0.02;
}

/**
 * 某个乘区里所有可重复升级的乘积。
 *
 * 升级按 config 里的 `kind` 归类，所以加一条新的乘法升级只需要在
 * config 的 REPEATABLE 里加一条，不用改这里。
 *
 * 这也是 SPEC 判据 P7 的体现：纯乘法链上因子位置无关，
 * 所以「作用在物质产出上的所有乘法升级」可以合成一个乘积。
 */
export function kindProduct(state, kind) {
  let m = D(1);
  for (const cfg of Object.values(REPEATABLE)) {
    if (cfg.kind !== kind) continue;
    const lv = levelOf(state, cfg.id);
    if (lv.lte(0)) continue;
    m = m.mul(Decimal.pow(cfg.effect, lv));
  }
  return m;
}

/** 全局倍率里由可重复升级贡献的加法项：1 + Σ(k·等级) */
export function globalAddTerm(state) {
  let extra = D(1);
  for (const cfg of Object.values(REPEATABLE)) {
    if (cfg.kind !== "globalAdd") continue;
    extra = extra.add(levelOf(state, cfg.id).mul(cfg.effectPerLevel ?? 0.05));
  }
  return extra;
}

/**
 * 全局产出倍率 = 梦想点项 × 全局倍率升级项 × 暗能量项
 *
 * ★ 原稿的 bug：算了 `dreamCoefficient` 但下面硬编码 0.02，导致 v4 完全无效。
 *   这里真的用它。
 */
export function globalMultiplier(state) {
  const dp = state.dreamPoints;
  const base = D(1).add(dp.mul(dreamCoefficient(state)));
  return base
    .mul(globalAddTerm(state))
    .mul(darkEnergyMultiplier(state))
  // ⚠️ 量子**不在这里**。
  //
  //   曾经把它放进 globalMultiplier（想让它「更全面」），但那是**最爆炸的乘区**：
  //   globalMultiplier 同时喂 entropyRate 和 matterRate，等于乘在环的两端，
  //   环增益拿到的是 Q² 而不是 Q。
  //
  //   实测（玩家反馈 + 隔离对照）：
  //     物质 1e27   有量子 2088s   无量子 4707s   -> 解锁瞬间给了约 52 倍加速
  //   而用户的原则是：**量子给的乘区不应该让物质一次跳到无限**。
  //
  //   现在量子作用在 entropyRate（单条产线），环增益只拿 Q。
}

// ══════════════════════════════════════════════════════════
// 第四层：量子涨落 / 大坍缩
// ══════════════════════════════════════════════════════════
//
// ★ 原来的「临界坍缩阶梯」（阈值 ×1e5 递进 -> 暗物质 -> 10^DM）已整个删除。
//   它是「阶梯 3 秒」的形式性元凶：`10^DM` 把曲线平移了 1e560 个数量级。
//   现在第三层是**量子涨落**，由它提供指数成长速率（见 quantumGrowthRate）。
//
//   `collapseUnlocked` 保留原名（改名会波及 state/UI/工具），但语义已经变成
//   「**量子涨落是否已解锁**」—— 就是 `peakMatter >= 1e25`。

/** 第三层（量子涨落）是否已解锁 */
export function collapseUnlocked(state) {
  return state.peakMatter.gte(COLLAPSE.unlockMatter);
}

/** 能不能大坍缩（物质到双精度上限） */
export function canBigCrunch(state) {
  return collapseUnlocked(state) && state.resources.matter.gte(crunchThreshold());
}

/** 大坍缩能拿多少无限点（未打破时固定，打破后随深度增长） */
export function bigCrunchGain(state) {
  return infinityPointGain(state.resources.matter, state.brokenInfinity);
}

// ══════════════════════════════════════════════════════════
// ZPE
// ══════════════════════════════════════════════════════════

/**
 * ZPE 倍率。
 *
 * 原稿：`1 + 0.1 × log10(ZPE+1)` —— 太弱（ZPE 从 1e10 到 1e100，倍率只从 ×2 到 ×11）
 * 现在：`(ZPE+1)^0.05` —— 同区间 ×3.16 → ×1e5
 *
 * 用 `ZPE+1` 而不是 `ZPE`，是为了 ZPE=0 时得到 1 而不是 0。
 */
export function zpeMultiplier(state) {
  const z = state.zpe.gt(0) ? state.zpe : D(0);
  let m = z.add(1).pow(ZPE_EXPONENT);
  if (state.zpeFixedMultiplier) m = m.mul(state.zpeFixedMultiplier);
  if (hasVoid(state, "v8")) m = m.mul(1.5);
  // ★ dm1「ZPE 倍率 ×2」。
  //
  //   原来这条里程碑靠 `state.zpeFixedMultiplier` 传递，但**没有任何代码
  //   往那个字段里写值** —— 效果对象 `{kind:"zpeFixedMultiplier"}` 没有处理器。
  //   所以 dm1 从移植起就是**死的**（探针实测：切换 dm1 标记，zpeRate 完全不变）。
  //
  //   现在改成直接检查里程碑标记，和 dm2/dm3/dm5/dm4b 的写法一致，
  //   数值从 DE_MILESTONES 读（单一数据源，不抄）。
  const dm1 = DE_MILESTONES.find((x) => x.id === "dm1");
  if (dm1 && hasDe(state, "dm1")) m = m.mul(dm1.effect.value);
  return m;
}

/**
 * ZPE 产出倍率。
 * v1 给 ×3，且「每拥有一个虚空升级 +1000%」（即 ×(1+10n)），买齐 9 个共 ×273。
 * v6 再给 ×5。
 */
export function zpeBaseMultiplier(state) {
  let b = D(1);
  if (hasVoid(state, "v1")) {
    b = b.mul(3);
    const count = Object.values(state.voidUpgrades).filter(Boolean).length;
    b = b.mul(D(1).add(D(count).mul(10)));
  }
  if (hasVoid(state, "v6")) b = b.mul(5);
  return b;
}

/**
 * 暗能量对 ZPE 产出的惩罚。返回的是「乘数」，越小惩罚越重。
 *
 * ── 两处修正（原稿问题）──
 *
 * ① **指数 1.5 -> 0.5**（方案 B）
 *    原稿是 `1/(1 + 0.001 × DE^1.5 × (1−减免))` —— 惩罚**超线性**，
 *    而暗能量的唯一来源就是 ZPE。于是它掐住自己的水管，形成死亡螺旋：
 *        暗能量 1e0  -> 1.00e-6/秒
 *        暗能量 1e4  -> 3.65e-9/秒
 *        暗能量 1e10 -> 9.31e-18/秒     ← 单调递减
 *    改成 0.5 次方后，惩罚是**次线性**的，而全局倍率是指数增长，
 *    所以获取速度会重新转正。
 *
 * ② **加下限**（方案 B 附带）
 *    保证 ZPE 永远不会被完全掐死（否则一旦踩进螺旋就没救）。
 *
 * ③ **减免曲线平滑化**（方案 C）
 *    见下面 reduction 的注释。
 */
export function zpeProductionPenalty(state) {
  const de = state.darkEnergy;
  if (de.lte(0)) return D(1);
  const lv = deLevelOf(state, "dreamAnnihilation");

  // ★ 方案 C（改）：减免 = 等级 / 满级 —— 线性、平滑，**满级正好 100%**
  //
  //   原稿是 `min(等级,3)/3`：3 级拉满，4~10 级完全无效，
  //   而且 0/1/2 级几乎没感觉、第 3 级突然跳 10 个数量级。
  //
  //   先用了几何曲线 `1−0.85^等级`，但 10 级只到 80.3%，**惩罚还在**。
  //   用户指出：原稿的设计意图是「暗能量升级满级后不再有 ZPE 削弱倍率」。
  //   所以改成线性 —— 每级 10%，第 10 级正好 100%，惩罚彻底归零。
  const maxLv = DE_UPGRADES.dreamAnnihilation.maxLevel ?? 10;
  const reduction = Decimal.min(lv, D(maxLv)).div(maxLv);

  // ★ 方案 B：总系数 0.001 × DE^0.5（原来是 DE^1.5）
  const total = D(DE_PENALTY.coeff).mul(de.pow(DE_PENALTY.exponent)).mul(D(1).sub(reduction));
  const penalty = D(1).div(D(1).add(total));

  // ★ 下限：ZPE 永远不会被完全掐死
  return Decimal.max(penalty, D(DE_PENALTY.floor));
}

// ══════════════════════════════════════════════════════════
// 暗能量
// ══════════════════════════════════════════════════════════

/**
 * 暗能量倍率。
 *   x = log2(DE + 1)
 *   系数 = min(0.1 + x/20 × 0.15, 0.25)     展开后是 1 + 0.1x + 0.0075x²
 *   倍率 = (1 + x × 系数) × 1.1^真空加速等级
 *
 * 前期线性、中期二次、后期线性 —— 平滑的分段强度曲线。
 */
export function darkEnergyMultiplier(state) {
  // ⚠️ 用 **darkEnergyTotal（历史总量）**，不是 darkEnergy（当前余额）。
  //
  // 踩过（用户报告：「买凝聚斜率后 1熵=N粒子 反而变小」）：
  //   阈值 = (100+3n) / ZPE倍率 / 【暗能量倍率】
  //   而 deMult 原来读**余额**。花暗能量买升级 -> 余额降 -> deMult 降
  //   -> 阈值升 -> 转换率降。实测：
  //       花费占余额  8%  -> +3.36%
  //       花费占余额 41%  -> +0.67%
  //       花费占余额 55%  -> ❌ -2.53%
  //       花费占余额 82%  -> ❌ -12.49%
  //   即「买升级反而变弱」——升级给的产出增量是固定绝对值，打不过余额损失。
  //
  //   darkEnergyTotal 从不被坍缩/大坍缩重置，所以「累计产出过多少」才是
  //   奖励的正确语义。这也是 dm5 里程碑同一个坑（那边已修）。
  //
  // 注意「双刃」的另一半**故意保留**：zpeProductionPenalty 仍然看余额 ——
  // 「囤着不用伤 ZPE」这个惩罚是有意设计，不该一起改掉。
  const de = state.darkEnergyTotal.gt(0) ? state.darkEnergyTotal : D(0);
  const x = de.add(1).log2();
  const coeff = Decimal.min(D(0.1).add(x.div(20).mul(0.15)), D(0.25));
  // ★ 量子：作为**基础加成**加进括号里（a区），量是 q²。
  //   `暗能量倍率 = (1 + 0.25·log2(暗能量)) + q²`
  const base = D(1).add(x.mul(coeff)).add(quantumDeMultBonus(state.quantum));
  const accel = Decimal.pow(
    dreamUpgradeEffects(state).vacuumAccelEffectMult,
    deLevelOf(state, "vacuumAccel"),
  );
  return base.mul(accel);
}

/** 每转换一次得到多少暗能量 */
export function darkEnergyGainPerConversion(state) {
  const d = dreamUpgradeEffects(state);
  let g = Decimal.pow(d.phaseShiftEffectMult, deLevelOf(state, "phaseShift"))
    .mul(d.phaseShiftBaseMult)
    // ★ 新增「相变增幅」：基础暗能量获取的乘法区
    .mul(Decimal.pow(
      DE_UPGRADES.deGainBase.effectMult,
      deLevelOf(state, "deGainBase"),
    ));
  if (hasDe(state, "dm5")) g = g.mul(darkEnergyMultiplier(state));
  // ★ 量子：作为**基础加成**加进括号里（a区），量是 log10(q)。
  //   `每次转换量 = ... × [1 + log10(q)]`
  return g.mul(D(1).add(quantumDeGainBonus(state.quantum)));
}

// ══════════════════════════════════════════════════════════
// 熵阱
// ══════════════════════════════════════════════════════════

/**
 * 实际生效的熵阱数量。
 *
 * m4「ZPE 倍率影响熵阱实际生效数量」—— 放大**数量**。
 *
 * ⚠️ 量子**不在这里**了。新模型（第三版）把量子的两个效果分开：
 *   熵生产倍率 ×(1+量子数)          -> 只进 entropyRate
 *   ZPE 产出倍率 ×(1+log10(量子数)) -> 只进 zpeRate
 * 这样两条产线互不叠乘，比之前「一起作用在枢纽上」更可控。
 */
export function effectiveTraps(state) {
  let t = state.resources.traps;
  if (hasZpe(state, "m4")) {
    const bonus = hasV9(state) ? 2 : 1;
    t = t.mul(D(1).add(zpeMultiplier(state).mul(bonus)));
  }
  return t;
}

// ══════════════════════════════════════════════════════════
// 各产线速率（每秒）
// ══════════════════════════════════════════════════════════

/** 熵产出速率 */
export function entropyRate(state) {
  const v2 = hasVoid(state, "v2") ? D(1.5) : D(1);
  let r = effectiveTraps(state)
    .mul(globalMultiplier(state))
    .mul(BASE.trapBaseRate)
    .mul(zpeMultiplier(state))
    .mul(v2)
    // ★ 量子：作用在**熵产出**这条单线上（不是全局倍率）。
    //   理由见 globalMultiplier 的注释 —— 放全局倍率等于乘在环的两端，
    //   环增益会变成 Q²，物质会一次跳到无限。
    .mul(quantumEntropyMultiplier(state.quantum));
  if (hasDe(state, "dm3")) r = r.mul(darkEnergyMultiplier(state));
  return r;
}

/**
 * 物质产出速率（依赖当前粒子数）。
 *
 * ⚠️ **必须包含量子那一段指数项** —— 引擎里 `tick` 的公式是它加上这一项。
 *    这条是「输出函数 == 运算函数」的硬约束：我在引擎里加了项却没加在这里，
 *    `consistency.mjs` 立刻报「物质速率误差 82.74%」。
 */
export function matterRate(state) {
  const mb = kindProduct(state, "matterMul");
  let zf = D(1);
  if (hasZpe(state, "m3")) {
    const factor = hasV9(state) ? 1.0 : 0.5;
    zf = D(1).add(zpeMultiplier(state).sub(1).mul(factor));
  }
  const v3 = hasVoid(state, "v3") ? D(1.5) : D(1);
  const base = state.resources.particle
    .mul(BASE.matterPerParticle)
    .mul(mb)
    .mul(globalMultiplier(state))
    .mul(zf)
    .mul(v3);

  // ★ 量子 → 指数成长项：`dM/dt += R·ln10·M`
  //   与 engine.js 的 tick 里那一段**逐字对应**（改一处必须改另一处）。
  const gRate = quantumGrowthRate(state.quantum);
  if (gRate.lte(0)) return base;
  return base.add(state.resources.matter.mul(gRate).mul(Math.LN10));
}

/**
 * ZPE 产出速率。
 *
 * ★ 方案 1（用户选定）：**全局倍率进两次**。
 *
 *   `zpeRate = 熵阱 × globalMult × globalMult × zpe基础 × prodMult × 惩罚`
 *                        └───────── globalMult² ─────────┘
 *
 * ── 为什么 ──
 *   量子涨落靠「ZPE 跨过门槛」触发，但实测 **ZPE 全程只涨 2.8 个数量级**
 *   （1e12.9 -> 1e15.6），而每次捕获门槛 ×20 = 1.301 个数量级
 *   -> 整局只能多捕 **4 对（8 量子）**，涨得太慢。
 *
 *   两条路对照测过：
 *     · 全局倍率再进一次（**乘法**）  -> ZPE 涨 **6.3 阶**，8 对 / 16 量子  ✅
 *     · 暗能量 ×(1+log10 DE)（**对数**）-> ZPE 只涨 3.6 阶，5 对 / 10 量子  ❌
 *   乘法赢 —— 对数形式的加成传不到 ZPE 上（DE 涨得快，但 log 吃掉大部分）。
 *
 *   实测副作用（都是正向）：
 *     阶梯 1.76h -> 1.67h（仍在 1~2h 目标区间）
 *     暗能量 1e22 -> 1e36（ZPE 喂暗能量的自然结果，顺带缓解「暗能量太慢」）
 *
 * ⚠️ **它引入了一个正反馈环**：
 *     量子 ↑ -> 暗能量倍率 +q² -> globalMult ↑ -> zpeRate∝globalMult² ↑
 *           -> ZPE ↑ -> 更多量子 -> …
 *   在**当前步长（×20，整局 16 量子）下实测没有跑飞**。
 *   若将来把门槛步长调小（比如 ×2，可捕 ~21 对 / 42 量子），
 *   `q²` 会大一个量级 —— **必须重新验证环增益，不能想当然。**
 *
 * ── 用户预告 ──
 *   无限之后会解锁一个**重点加成虚空系统**的新系统，届时 ZPE / 量子的定位可能调整。
 *   在那之前保持现状。
 */
export function zpeRate(state) {
  let prodMult = hasVoid(state, "v6") ? zpeMultiplier(state) : D(1);
  if (state.zpeFixedMultiplier) prodMult = prodMult.mul(state.zpeFixedMultiplier);
  return effectiveTraps(state)
    .mul(globalMultiplier(state))
    // ★ 方案 1：全局倍率再进一次（见上方说明）
    .mul(globalMultiplier(state))
    .mul(zpeBaseMultiplier(state))
    .mul(prodMult)
    .mul(zpeProductionPenalty(state));
}

/**
 * 实际每次相变转换给多少暗能量（**含 dm4b**）。
 *
 * ⚠️ **必须两边共用这一个函数。**
 *
 * 踩过：dm4b 最初只加在 `darkEnergyRate()` 里，而 engine.js 的实际转换
 * 用的是 `darkEnergyGainPerConversion()` —— 于是 dm4b 变成死代码：
 * 界面上的速率显示变了，**实际产出一点没变**（玩家反馈「还是涨不动」）。
 *
 * 教训：一个效果如果有两条计算路径，它迟早只在一条上生效。
 * 正确做法是让两条路都走同一个函数。
 */
export function effectiveDarkEnergyGain(state) {
  let g = darkEnergyGainPerConversion(state);
  // ★ 里程碑 dm4b：全局倍率作用于相变转换速率
  if (hasDe(state, "dm4b")) g = g.mul(globalMultiplier(state));
  return g;
}

/**
 * 暗能量生成速率（每秒）。
 *
 * ★ 里程碑 dm4b（1e6 暗能量）：**全局倍率作用于相变转换速率**。
 *
 *   注意它和「熵凝聚转换速率」是两回事：
 *     · 熵凝聚（entropy→particle）在 particleRate 里，**不含 dm4b**
 *     · 相变（ZPE→暗能量）就是这里
 *
 *   所以 dm4b **完全不碰主环**：主环增益仍是 globalMult²，时间压缩不变。
 *   它只让暗能量积累变快：
 *     `dDE/dt = zpeRate/1e8 × gain × globalMult`
 *     而 globalMult 含 `deMult = 1 + 0.25·log2(DE)`
 *     => `dDE/dt ∝ log(DE)/DE^0.5`
 *     数学结论见 tools/de-milestone-model.mjs：峰值在 DE≈1e4.5，**不会失控**。
 */
export function darkEnergyRate(state) {
  if (!state.phaseTransmuterUnlocked) return D(0);
  return zpeRate(state).div(BASE.darkEnergyThreshold).mul(effectiveDarkEnergyGain(state));
}

// ══════════════════════════════════════════════════════════
// 熵 → 粒子
// ══════════════════════════════════════════════════════════

/**
 * 当前的转换规则。
 *
 * 产出与阈值**都是加法**：
 *   output    = 1 + 0.15n        （v5 后 1 + 0.65n）
 *   threshold = 100 + 3n
 *   净转换率 -> 0.15/3 = 0.05（v5 后 0.65/3 = 0.2167）
 *
 * ⚠️ 这个上限是**节拍器**，不是缺陷。曾经改成乘法（output = 1.07^n），
 *    400 级时转换率变成原稿的 93 亿倍，整局 15 分钟通关。
 *    详见 config.js 里 entropyCoeff 的注释和 tools/compare-pace.mjs。
 */
export function conversion(state) {
  const lv = levelOf(state, "entropyCoeff");
  const cfg = REPEATABLE.entropyCoeff;

  // ⚠️ 这里原来有一个 `qe.convUncap` 分支（旧量子升级「解耦」把产出改成乘法）。
  //    那套量子升级系统已整体删除，分支永远是死路，已移除。
  let perLevel = cfg.outputPerLevel;
  if (hasVoid(state, "v5")) perLevel += 0.5;
  // ★ 「凝聚斜率」：直接加在**斜率**上（不是乘一个倍率）。
  //   加法形式让转换率封顶在 perLevel/thresholdPerLevel；
  //   抬斜率才能把这个上限本身推高，而且因为 L ∝ log(资源)，
  //   上限只是**对数增长**，几乎不进 S 池。
  perLevel += DE_UPGRADES.convOutput.perLevel * deLevelOf(state, "convOutput").toNumber();
  const output = D(BASE.autoConvertOutput).add(lv.mul(perLevel));

  let threshold = D(BASE.autoConvertCost).add(lv.mul(cfg.thresholdPerLevel));
  // （原来这里乘 `qe.convThresholdMul`，旧量子升级「量纲压缩」——已随系统删除）

  if (hasZpe(state, "m6")) {
    const divisor = hasV9(state) ? 2 : 1;
    threshold = threshold.div(zpeMultiplier(state).mul(divisor));
  }
  // ★ 原稿这里同时乘了分子和分母，数学上精确抵消（SPEC 判据 P9）。
  //   现在只降阈值。
  if (hasDe(state, "dm2")) {
    threshold = threshold.div(darkEnergyMultiplier(state));
  }
  return { threshold, output };
}

/**
 * 粒子产出速率（每秒）。
 *
 * ★ 这里有一条**结构性**的边：量子升级「直接边」让 `物质 → 粒子` 直达。
 *
 * 为什么它重要：原本的链是
 *     物质 → 熵阱(价格×2, 产出+1) → 熵 → 粒子 → 物质
 * 而 `熵阱 ∝ log(物质)`，所以整条链是**亚指数**（实测 8.4 阶/对数时间）。
 *
 * 加上直接边后：
 *     dM/dt = k·P
 *     dP/dt = c + j·M          ← 新增的 j·M
 *     => d²M/dt² = k·c + k·j·M  ← M 自己出现在二阶导里 → **真指数**
 */
export function particleRate(state) {
  const { threshold, output } = conversion(state);
  // ⚠️ 这里原来有旧量子升级「直接边」的分支。那套系统已删除。
  //    （它当年会跑飞：d²M/dt² = k·c + k·j·M 里的 M 自反馈，
  //      增长率 √(k·j) 随全局倍率一起涨，所以整条升级被废弃。）
  // ⚠️ dm4b **不在这里**。它作用于「相变转换速率」（ZPE→暗能量），
  //    不是「熵凝聚转换速率」（熵→粒子）。见 darkEnergyRate()。
  return entropyRate(state).div(threshold).mul(output);
}

// ══════════════════════════════════════════════════════════
// 价格
// ══════════════════════════════════════════════════════════

/**
 * 用于价格的 ZPE 倍率（m2 和 dm4 都会影响它）。
 * 原稿里这个函数的注释和代码差了 50 倍（注释说 0.001，代码是 0.05），这里统一成 0.05。
 */
export function effectiveZpeMultiplierForPrice(state) {
  let m = zpeMultiplier(state);
  if (hasDe(state, "dm4")) m = m.mul(D(1).add(state.darkEnergy.mul(0.05)));
  return m;
}

/** 可重复升级的价格（已应用折扣） */
export function repeatableCost(state, id) {
  const cfg = REPEATABLE[id];
  const lv = levelOf(state, id);
  let cost = D(cfg.baseCost).mul(Decimal.pow(cfg.costMult, lv));
  if (hasZpe(state, "m2")) cost = cost.div(effectiveZpeMultiplierForPrice(state));
  return cost;
}

/** 熵阱价格（已应用 m5 折扣 + 量子升级「退火」） */
export function trapCost(state) {
  // （原来这里读 `qe.trapCostMult` 覆盖基础增长 ——
  //   旧量子升级「退火」，已随整套系统删除，永远返回 null，所以直接去掉）
  const n = state.resources.traps;
  const mult = BASE.trapCostMult;
  let c = D(BASE.trapBaseCost).mul(Decimal.pow(mult, n));
  if (hasZpe(state, "m5")) c = c.div(zpeMultiplier(state));
  return c;
}

/** 虚空升级价格（固定） */
export function voidUpgradeCost(state, id) {
  return D(VOID_UPGRADES[id].cost);
}

/** 暗能量升级价格 */
export function deUpgradeCost(state, id) {
  const cfg = DE_UPGRADES[id];
  const lv = deLevelOf(state, id);
  const d = dreamUpgradeEffects(state);
  let particle = null;
  if (cfg.costParticle) {
    // 「相位锁定」会把高效相变的价格增长从 1.5 提到 2.0
    particle = id === "phaseShift"
      ? D(cfg.baseCost ?? 100).mul(Decimal.pow(d.phaseShiftCostMult, lv))
      : cfg.costParticle(lv);
  }
  let darkEnergy = null;
  if (cfg.costDarkEnergy) {
    // ★ 分段曲线（×3 -> ×1.5 -> ×2）用闭式解，不要循环
    darkEnergy = cfg.piecewise
      ? piecewiseDeCost(cfg.baseCost, lv)
      : D(cfg.baseCost).mul(Decimal.pow(cfg.costMult, lv));
  }
  return {
    dream: cfg.costDream ? D(cfg.costDream) : null,
    matter: cfg.costMatter ? cfg.costMatter(lv) : null,
    particle,
    zpe: cfg.costZpe ? cfg.costZpe(lv) : null,
    darkEnergy,
  };
}

/**
 * 该升级在 v9 之后是否变成「达到阈值自动获取」（不扣钱）。
 * v9 会把 m2 / m5 的折扣升级成免费。
 */
export function isAutoAcquire(state, kind) {
  if (!hasV9(state)) return false;
  if (kind === "upgrade") return hasZpe(state, "m2");
  if (kind === "trap") return hasZpe(state, "m5");
  return false;
}

// ══════════════════════════════════════════════════════════
// 里程碑达成检测
// ══════════════════════════════════════════════════════════

/** 返回本次新达成的 ZPE 里程碑 id 列表 */
export function checkZpeMilestones(state) {
  const got = [];
  for (const m of ZPE_MILESTONES) {
    if (!state.zpeMilestones[m.id] && state.zpeTotal.gte(m.need)) {
      state.zpeMilestones[m.id] = true;
      got.push(m);
    }
  }
  return got;
}

/**
 * 暗能量里程碑的额外门槛。
 * dm0（相变仪）在原稿里要求「v8 已购 且 物质 ≥ 1e8」，见 config.js 的注释。
 */
function gateOpen(state, m) {
  if (!m.gate) return true;
  if (m.gate.voidUpgrade && !state.voidUpgrades[m.gate.voidUpgrade]) return false;
  if (m.gate.matter && state.resources.matter.lt(m.gate.matter)) return false;
  return true;
}

/**
 * 返回本次新达成的暗能量里程碑 id 列表。
 *
 * ⚠️ 判定用 **darkEnergyTotal（历史总量）**，不是 darkEnergy（当前余额）。
 *
 * 踩过：原来用余额判定，而界面显示的是总量 —— 两边不是同一个变量。
 * 玩家花暗能量买升级后余额 < 总量，于是看到「1.88e10 / 1e10」却判定未达成。
 *
 * 更糟的是这不只是显示问题：**如果玩家一直把暗能量花掉，
 * 余额可能永远攒不到门槛，里程碑就永远拿不到** —— 一个和玩家行为对赌的陷阱。
 *
 * darkEnergyTotal 从不被坍缩/大坍缩重置，所以「累计产出过多少」才是正确语义。
 */
export function checkDeMilestones(state) {
  const got = [];
  for (const m of DE_MILESTONES) {
    if (state.deMilestones[m.id]) continue;
    if (!gateOpen(state, m)) continue;
    if (state.darkEnergyTotal.gte(m.need)) {
      state.deMilestones[m.id] = true;
      got.push(m);
    }
  }
  return got;
}
