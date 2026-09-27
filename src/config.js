/**
 * ══════════════════════════════════════════════════════════════
 * 乘区定义（基础公式）—— **这是全项目的最高约束**
 * ══════════════════════════════════════════════════════════════
 *
 *   最终显示数值 = { [ 上一轮运算值 × a区 ] ^ b区 } × c区
 *
 *   ┌─ a区 = **加法池 × 乘法池**
 *   │        不带「最终」二字的所有加成。加法和乘法都在这里混乘。
 *   │        例：梦想点 `(1 + dp×0.02)`、粒子升级 `(1 + Σ等级×0.05)`、
 *   │            物质速率 `× 1.0625^等级`、虚空 v2 `× 1.5`、暗物质 `× 10^DM`
 *   │
 *   ├─ b区 = **指数区** —— 把**一个已经算好的倍率取幂**（不是把因子乘进去）
 *   │        ⚠️ 关键区别：
 *   │            `× m^等级` 是**因子**（每级乘 m）      -> a区
 *   │            `× 10^DM`  是**因子**                -> a区
 *   │            `(ZPE+1)^0.02` 产出的是**一个倍率**   -> a区
 *   │            **把上面那个倍率整体再取幂**          -> **b区** ✅
 *   │
 *   │        第一个成员：「无限升级4」——把现有的 zpeMultiplier 整体取 `^1.048`
 *   │            现有 = (ZPE+1)^0.02 × (v8?1.5) × (dm1?2)
 *   │            3.5e12 ZPE 时 = 5.346（用户看到的 5.35）-> ^1.048 = 5.794
 *   │            高 ZPE 时更明显：1e100 时 300 -> 394
 *   │        现状：**尚未实现**（无限升级系统还没做）
 *   │
 *   └─ c区 = **带「最终」二字**的加成（最终倍数加成）
 *            现状：只有量子一条（熵生产 `×(1+q)`）。
 *
 * ── 已存在的「对值取幂」三处（形式上是 b区，但都没被当作 b区命名）──
 *   · `zpeMultiplier = (ZPE+1)^0.02`       产出倍率，被当 a区因子用
 *   · `zpeProductionPenalty` 里的 `DE^0.5`  产出惩罚倍率
 *   · `infinityPointGain` 里的 `深度^2`      产出无限点数量（不是倍率）
 *   这三处要不要正式归入 b区，等无限升级系统定案时一起处理。
 *
 * ── 历史误会 ──
 *   曾经把「代码里出现 pow() 」当成 b区越界，那是**语法判据**。
 *   实际上价格的 `r^等级`、升级的 `m^等级`、资源的 `10^DM` 全都是 a区的因子。
 */
export const ZONE_RULES = {
  a: { name: "加法池 × 乘法池", hasFinalWord: false, raisesWholeValue: false },
  b: { name: "指数区", hasFinalWord: false, raisesWholeValue: true },
  c: { name: "最终倍数加成", hasFinalWord: true, raisesWholeValue: false },
};

/**
 * config.js —— 全部内容与数值（唯一数据源）
 *
 * 从 0.3.4 的 state.js + engine.js 移植，内容见 docs/RESCUE-034-CONTENT.md
 *
 * 设计原则：
 *   1. 这里只有**数据**，没有逻辑。所有计算在 formulas.js。
 *   2. 效果用「声明式」描述（kind + 参数），不用回调函数。
 *      好处：能在 Node 里直接遍历检查，也能自动生成 UI。
 *   3. 所有大数用 Decimal 或字符串，不用 JS number 存大值。
 */

import Decimal from "../dist/break_eternity.esm.js";

// ══════════════════════════════════════════════════════════
// 基础常数
// ══════════════════════════════════════════════════════════

export const BASE = {
  /** 点击一次给多少熵 */
  clickGain: 10,

  /** 熵 → 粒子：基础阈值与产出 */
  autoConvertCost: 100,
  autoConvertOutput: 1,

  /** 粒子 → 物质：每个粒子每秒产多少物质 */
  matterPerParticle: 0.1,

  /** 熵阱：每个每秒产多少熵；用物质购买；价格增长 */
  trapBaseRate: 1,
  trapBaseCost: 0.1,
  trapCostMult: 2,

  /** 每累积这么多 ZPE，换 1 暗能量 */
  darkEnergyThreshold: 1e8,

  /** 离线结算上限（秒）。SPEC §5.2 */
  offlineCapSeconds: 4 * 3600,

  /** 主循环间隔（毫秒）。SPEC §5.1：改速度要乘在产出上，不要改这个 */
  tickMs: 50,

  /** 存档 key */
  saveKey: "cosmos-origin-034",
  saveVersion: 2,
};

/**
 * 全局常量：ZPE 倍率的幂次。
 *
 * 原稿是 `1 + 0.1·log10(Z)`（对数）。实测标定：
 *
 *   ZPE       原稿       Z^0.02     Z^0.05
 *   1e10      x2.00      x1.58      x3.16
 *   1e30      x4.00      x3.98  ←   x31.6      （0.02 在这里和原稿几乎相等）
 *   1e100     x11.0      x100       x1e5
 *
 * 0.02 在 1e30 处和原稿精确吻合，早期还略弱一点 —— 用来贴近原稿节奏。
 * 用 tools/compare-pace.mjs 和 tools/baseline-034.mjs 复测。
 */
export const ZPE_EXPONENT = 0.02;

// ══════════════════════════════════════════════════════════
// 三条可重复升级
// ══════════════════════════════════════════════════════════

export const REPEATABLE = {
  /**
   * 全局倍率。用粒子买，价格 ×2，效果 ×1.1/级。
   * S 贡献 = log(1.1)/log(2) = 0.1375
   */
  particleBoost: {
    id: "particleBoost",
    name: "全局倍率",
    /** kind 决定它进哪个乘区，formulas.js 按 kind 汇总 */
    kind: "globalAdd",
    currency: "particle",
    baseCost: 1,
    costMult: 2,
    effect: 1.1,
    /** 仿射系数：实际效果是 `1 + 0.05×等级`（不是 1.1^等级） */
    effectPerLevel: 0.05,
    /**
     * ⚠️ 效果文本由 `ui.js` 的 `effectText()` 从公式推导，**不要在这里写死**。
     *    曾经写成 `×1.1^等级`，而实现是 `1 + 0.05×等级` —— 100 级时
     *    卡片显示 ×13780、实际 ×6，差 2000 倍。
     */
    firstRewardDream: true,
  },

  /**
   * 物质速率。用物质买，价格 ×1.5，效果 ×1.125/级。
   * S 贡献 = log(1.125)/log(1.5) = 0.2905
   */
  matterBoost: (() => {
    const M = 1.0625;
    return {
      id: "matterBoost",
      name: "物质速率",
      kind: "matterMul",
      currency: "matter",
      baseCost: 5,
      costMult: 1.5,
      effect: M,
      firstRewardDream: true,
    };
  })(),

  /**
   * 熵凝聚。用粒子买。★ 结构最特殊的一条。
   *
   * 产出是**加法**的：output = 1 + 0.15n
   * 阈值也是**加法**的：threshold = 100 + 3n
   *   => 净转换率 = (1+0.15n)/(100+3n) -> 0.15/3 = 0.05（硬上限）
   *
   * ⚠️ 这个上限**不是 bug，是节拍器**。
   *
   * 曾经把它改成乘法（output = 1.07^n），结果在 400 级时转换率是原稿的
   * **93 亿倍**，整局 15 分钟就通关了（见 tools/compare-pace.mjs 的实测）。
   *
   * 原稿的设计意图是：
   *   Tier 0 的升级**有界**（转换率最大 4.7×），
   *   无界增长交给 Tier 1/2（ZPE 倍率、暗能量倍率）。
   * 这才是 S = 0.428 安全的原因 —— 加法项不进乘法池。
   *
   * 所以这里保持加法。买满 400 级也只有 4.69×，玩家自然会停止购买。
   */
  entropyCoeff: {
    id: "entropyCoeff",
    name: "熵凝聚",
    kind: "convAdd",
    currency: "particle",
    baseCost: 5,
    costMult: 1.5,
    /** 产出增量 / 级（加法）。极限转换率 = 产出增量 / 阈值增量 */
    outputPerLevel: 0.15,
    /** 阈值增量 / 级（加法） */
    thresholdPerLevel: 3,
    firstRewardDream: true,
  },
};

// ══════════════════════════════════════════════════════════
// 9 个虚空升级（全部一次性，固定价格）
// ══════════════════════════════════════════════════════════

export const VOID_UPGRADES = {
  v1: {
    id: "v1",
    name: "虚空过载",
    cost: "20000",
    // ★ 文案已改：原描述只写「ZPE 产出 ×3」，严重低估
    desc: "ZPE 产出 ×3。此外每拥有一个虚空升级，ZPE 产出额外 +1000%（可叠加）",
    rewardDream: true,
    // 效果在 formulas.js 里实现（见 zpeBaseMultiplier）
    note: "买下后立刻 ×33，买齐 9 个共 ×273",
  },
  v2: {
    id: "v2",
    name: "熵流加速",
    cost: "50000",
    desc: "熵产出 ×1.5",
    rewardDream: true,
  },
  v3: {
    id: "v3",
    name: "物质重组",
    cost: "100000",
    desc: "粒子→物质 ×1.5",
    rewardDream: true,
  },
  v4: {
    id: "v4",
    name: "虚空共鸣",
    cost: "300000",
    // ★ 文案已改：原描述是「系数从 0.02 → 0.08」，玩家看不懂系数是什么
    desc: "梦想点的全局倍率加成从 每点 +2% 提升到 每点 +8%",
    rewardDream: true,
    note: "原稿此条完全无效（dreamCoefficient 写了没人读），已修",
  },
  v5: {
    id: "v5",
    name: "凝聚升华",
    cost: "1000000",
    // ★ 恢复原稿效果：每级产出增量 +0.5（0.15 -> 0.65）
    //   极限转换率从 0.05 提到 0.2167（4.3 倍），是**有界**的提升 —— 安全。
    desc: "熵凝聚每级产出增量 +0.5（极限转换率 0.05 → 0.2167）",
    rewardDream: true,
  },
  v6: {
    id: "v6",
    name: "虚空汲取",
    cost: "3000000",
    // ★ 文案补全：原描述只写「ZPE 产出 ×5」
    desc: "ZPE 产出 ×5，且此后 ZPE 倍率也会影响 ZPE 产出",
    rewardDream: true,
  },
  v7: {
    id: "v7",
    name: "超光速引擎",
    cost: "10000000",
    desc: "手动点击获得 ×5 熵（10 → 50 熵/次）",
    rewardDream: true,
  },
  v8: {
    id: "v8",
    name: "虚空永恒",
    cost: "80000000",
    desc: "ZPE 倍率 ×1.5",
    rewardDream: true,
  },
  v9: {
    id: "v9",
    name: "传承启迪",
    // 实际消耗 1 梦想点
    costDream: 1,
    cost: "0",
    desc: "所有里程碑效果翻倍；熵凝聚/升级价格/熵阱价格的折扣改为「达到阈值自动获取」（不再扣钱）",
    rewardDream: false,
  },
};

// ══════════════════════════════════════════════════════════
// 6 个 ZPE 里程碑（阈值触发，永久）
// ══════════════════════════════════════════════════════════

export const ZPE_MILESTONES = [
  {
    id: "m1",
    need: "10",
    desc: "手动点击熵 +10",
    effect: { kind: "clickGainAdd", value: 10 },
  },
  {
    id: "m2",
    need: "100",
    desc: "所有升级价格 ÷ ZPE 倍率",
    effect: { kind: "upgradePriceDivZpe" },
  },
  {
    id: "m3",
    need: "500",
    // ★ 文案已改：原描述写「粒子和物质」，实际只影响物质
    desc: "ZPE 倍率以一半效率影响物质产出",
    effect: { kind: "matterZpeFactor", ratio: 0.5 },
  },
  {
    id: "m4",
    need: "1000",
    desc: "ZPE 倍率影响熵阱的实际生效数量",
    effect: { kind: "effectiveTraps", bonus: 1 },
  },
  {
    id: "m5",
    need: "10000",
    desc: "购买熵阱价格 ÷ ZPE 倍率",
    effect: { kind: "trapPriceDivZpe" },
  },
  {
    id: "m6",
    need: "1e8",
    desc: "熵凝聚阈值 ÷ ZPE 倍率",
    effect: { kind: "convThresholdDivZpe" },
  },
];

// ══════════════════════════════════════════════════════════
// 6 个暗能量里程碑
// ══════════════════════════════════════════════════════════

export const DE_MILESTONES = [
  {
    id: "dm0",
    need: "0",
    /**
     * ⚠️ 这不是「暗能量 ≥ 0」就解锁的。
     * 原稿把它绑在一个手动按钮上，门槛是 **v8 已购 且 物质 ≥ 1e8**：
     *     UI.btnUnlockTransmuter.addEventListener('click', () => {
     *         if (hasV8 && matter.gte(new Decimal(1e8))) { ... }
     *     });
     * 移植时如果漏掉这个门槛，整个第三层会在第 0 秒就开着 ——
     * 实测会让通关速度快 6 倍。所以这里显式建模。
     */
    gate: { voidUpgrade: "v8", matter: "1e8" },
    desc: "解锁相变仪（需要「虚空永恒 v8」+ 1e8 物质）",
    effect: { kind: "unlockTransmuter" },
  },
  {
    id: "dm1",
    need: "10",
    desc: "ZPE 倍率 ×2",
    effect: { kind: "zpeFixedMultiplier", value: 2 },
  },
  {
    id: "dm2",
    need: "100",
    // ★ 文案与效果都已改：原稿分子分母同时放大，数学上精确抵消
    desc: "暗能量降低熵凝聚阈值（÷ 暗能量倍率）",
    effect: { kind: "convThresholdDivDe" },
  },
  {
    id: "dm3",
    need: "1000",
    // ★ 文案已改：原描述写「ZPE 速度」，实际加成的是熵产出
    desc: "暗能量倍率额外加成熵产出",
    effect: { kind: "entropyMulDe" },
  },
  {
    id: "dm4",
    need: "10000",
    desc: "ZPE 折扣倍率额外 ×(1 + 暗能量 × 0.05)",
    effect: { kind: "priceDiscountDeBonus", ratio: 0.05 },
  },
  {
    id: "dm4b",
    need: "1000000",
    /**
     * ★ 大胆的一次性解锁：**全局倍率作用于相变转换速率**（1e6 暗能量生效）。
     *
     * ⚠️ 是「相变转换」（ZPE→暗能量，见 darkEnergyRate），
     *    不是「熵凝聚转换」（熵→粒子，见 particleRate）。
     *    我第一版放错了位置，描述也写成了熵凝聚 —— 两处都已修正。
     *
     * 效果链条：
     *   dDE/dt = zpeRate/1e8 × gain × globalMult
     *   而 globalMult 里与 DE 相关的只有 deMult = 1 + 0.25·log2(DE)
     *   => dDE/dt ∝ log(DE) / DE^0.5
     *
     * ⚠️ 数学结论（tools/de-milestone-model.mjs）：
     *   · **不会失控** —— 速率在 DE ≈ 1e4.5 达到峰值后回落，对数项输给 DE^0.5
     *   · 提速 4~9×，且随 DE 增大而增大（1e30 时 25.9×）
     *   · **完全不碰主环**：主环增益仍是 globalMult²，时间压缩不变
     *   · 门槛从 5e6 降到 1e6，是为了在峰值附近就生效（5e6 比峰值晚 2.2 个数量级）
     */
    desc: "全局倍率作用于相变转换速率（ZPE → 暗能量）",
    effect: { kind: "globalToConversion" },
  },
  {
    id: "dm5",
    need: "1e10",
    desc: "暗能量倍率也会加速暗能量自身的生成",
    effect: { kind: "deGainMulDe" },
  },
];

// ══════════════════════════════════════════════════════════
// 3 个暗能量升级
// ══════════════════════════════════════════════════════════

/**
 * 暗能量对 ZPE 的惩罚参数（★ 双刃机制）。
 *
 * 惩罚乘数 = `max( 1 / (1 + coeff × 暗能量^exponent × (1−减免)) , floor )`
 *
 * 历史：原稿是 `coeff=0.001, exponent=1.5`，**超线性**，形成死亡螺旋
 *       （暗能量越多 -> ZPE 越少 -> 暗能量涨得越慢）。已改为 0.5。
 */
export const DE_PENALTY = {
  coeff: 0.001,
  /** 原来是 1.5，改成 0.5 拆掉死亡螺旋 */
  exponent: 0.5,
  /** 梦想烬灭虚无每级的减免 = `1 − 0.85^等级` */
  dreamReductionBase: 0.85,
  /** 惩罚下限：ZPE 永远不会被完全掐死 */
  floor: 1e-9,
};

/**
 * 分段价格增长（基础暗能量获取升级用）。
 *
 * 用户设定：每次购买 ×3；价格超过 1e10 后改 ×1.5；超过 1e308 后改 ×2。
 *
 * ⚠️ **必须用闭式解，不能循环。** 从 1e10 涨到 1e308 在 ×1.5 下是 1693 级，
 *    循环写法在后期每帧要跑上千次 —— 和 buyRepeatable / buyTrap 同一类坑。
 *
 * 三段：
 *   ① ×3  直到价格 ≥ 1e10      -> 共 a 级
 *   ② ×1.5 直到价格 ≥ 1e308    -> 共 b 级
 *   ③ ×2  之后无限延续
 *
 * 注意 S 判据：单条升级的 S = `log(m)/log(r)`，取**当前那一级的 r**。
 * 所以这段曲线里 **r=1.5 是 S 最贵的一段**（r 越小 S 越大）。
 */
export const PIECEWISE = { p1: 1e10, p2: 1e308, r1: 3, r2: 1.5, r3: 2 };

/** 分段价格：第 lv 级的价格（O(1) 闭式解） */
export function piecewiseDeCost(base, lv) {
  // config.js 里没有 D() 辅助函数（那是 state.js 的），所以直接用 new Decimal
  const dec = (v) => (v instanceof Decimal ? v : new Decimal(v));
  const B = dec(base);
  const { p1, p2, r1, r2, r3 } = PIECEWISE;
  const P1 = dec(p1), P2 = dec(p2);
  const n = lv instanceof Decimal ? lv.toNumber() : Number(lv);
  if (!(n > 0)) return B;

  // ① 第一段要几级才到 P1
  const a = B.gte(P1) ? 0 : Math.ceil(P1.div(B).log(r1).toNumber());
  if (n <= a) return B.mul(Decimal.pow(r1, n));
  const pA = B.mul(Decimal.pow(r1, a));          // 第一段结束时的价格

  // ② 第二段要几级才到 P2
  const b = pA.gte(P2) ? 0 : Math.ceil(P2.div(pA).log(r2).toNumber());
  if (n <= a + b) return pA.mul(Decimal.pow(r2, n - a));
  const pB = pA.mul(Decimal.pow(r2, b));         // 第二段结束时的价格

  // ③ 之后 ×r3
  return pB.mul(Decimal.pow(r3, n - a - b));
}

/**
 * 分段曲线对 S 的贡献。
 * 由**最小的 r**（= 最贵的那段）支配，因为 S = log(m)/log(r)。
 */
export function piecewiseSContribution(m) {
  const worstR = Math.min(PIECEWISE.r1, PIECEWISE.r2, PIECEWISE.r3);
  return Math.log(m) / Math.log(worstR);
}

export const DE_UPGRADES = {
  dreamAnnihilation: {
    id: "dreamAnnihilation",
    name: "梦想烬灭虚无",
    maxLevel: 10,
    /** 价格：1 梦想点 + 10^(10+等级) 物质 */
    costDream: 1,
    costMatter: (lv) => new Decimal(10).pow(new Decimal(10).add(lv)),
    /**
     * ★ 方案 C（改）：减免 = **等级 / 满级**（线性，平滑，满级正好 100%）。
     *
     *   原稿是「每级抵消 1/3，3 级满」—— 4~10 级完全无效，且第 3 级跳崖。
     *   先用了几何曲线（10 级 80.3%），但用户指出原稿意图是
     *   **满级后不再有 ZPE 削弱倍率**，所以改成线性：每级 10%，第 10 级 100%。
     */
    desc: (lv) => {
      const max = 10;
      const r = Math.min(lv / max, 1) * 100;
      const next = Math.min((lv + 1) / max, 1) * 100;
      return lv >= max
        ? "已满级：暗能量对 ZPE 的削弱完全移除"
        : `削弱暗能量对 ZPE 的惩罚 ${r.toFixed(0)}%（下一级 ${next.toFixed(0)}%）`;
    },
    firstRewardDream: true,
  },
  /**
   * 高效相变的 m 从 1.5 削到 1.13 —— S 贡献 0.5850 -> 0.3014。
   *
   * 用 IIFE 把倍率存进局部常量，`desc` 闭包引用它，
   * 这样**描述不可能和 effectMult 脱节**（踩过手写字符串的坑）。
   */
  phaseShift: (() => {
    const M = 1.5;    // ★ 方案 A：恢复原稿的 1.5（这就是「暗能量获取」）
    const R = 4;      // ★ 方案 A：价格增长 1.5 -> 4，把 r 抬到 m 之上
    return {
      id: "phaseShift",
      name: "高效相变",
      maxLevel: null,
      baseCost: 100,
      costParticle: (lv) => new Decimal(100).mul(new Decimal(R).pow(lv)),
      costMult: R,
      effectMult: M,
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}`,
      firstRewardDream: true,
    };
  })(),
  vacuumAccel: (() => {
    const M = 1.12;
    return {
      id: "vacuumAccel",
      name: "真空加速",
      maxLevel: null,
      costZpe: (lv) => new Decimal(10).pow(lv),
      costMult: 10,
      effectMult: M,
      desc: (lv) => `暗能量倍率 ×${new Decimal(M).pow(lv).toFixed(2)}`,
      firstRewardDream: true,
    };
  })(),

  /**
   * ★ 新增 ①：基础暗能量获取（b 区乘法）。
   *
   * 价格用**分段曲线**（见 PIECEWISE）：×3 -> ×1.5(>1e10) -> ×2(>1e308)。
   * 消耗**暗能量**。
   */
  deGainBase: (() => {
    /**
     * ★ m 从 1.05 提到 1.10（用户反馈：36 级只有 ×5.79，期望 ≥30）。
     *
     *    1.05^36 = 5.79   -> 1.10^36 = 30.91  ✅ 命中目标
     *
     * ⚠️ S 代价：`S = log(m)/log(r)`，而分段曲线的 r 由**最小的那段**支配
     *    （min(3, 1.5, 2) = 1.5）。所以：
     *       m=1.05 -> S 贡献 0.1203 -> 总 S 0.6115
     *       m=1.10 -> S 贡献 0.2351 -> 总 S 0.7263   ← 现在
     *    仍然远低于 1，安全；但超过了原先 0.5 的目标值。
     *
     *    如果嫌 S 太高：把 ×1.5 那段抬到 ×2，同样的 m 能省 42% 的 S
     *    （1.10 时 0.2351 -> 0.1375，总 S 降到 0.6538）。
     *
     * ✅ 安全性：这条效果的下游是**对数**的 ——
     *    暗能量获取 ×m^L -> 暗能量增长 -> deMult = 1+0.25·log2(DE) 只按对数涨。
     *    所以把 m 调高不会引起跑飞，只会让暗能量更快到位。
     */
    const M = 1.10;
    return {
      id: "deGainBase",
      name: "相变增幅",
      maxLevel: null,
      baseCost: 10,
      /** 用分段闭式解代替固定 costMult */
      piecewise: true,
      effectMult: M,
      costDarkEnergy: true,
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}`,
      firstRewardDream: true,
    };
  })(),

  /**
   * ★ 新增 ②：转换产出（熵凝聚的**产出斜率**）。
   *
   * 现有转换是加法形式：`产出 = 1 + 0.15n`（v5 后 +0.65n），
   * 所以转换率 `产出/阈值` 在 n→∞ 时会**封顶**。乘一个倍率只能抬高上限，仍会封顶。
   *
   * 这条升级改的是**斜率**：每级让产出增量 +0.05。
   *   `产出 = 1 + (0.15 + 0.5·v5 + 0.05·L) × n`
   *   `转换率上限 = (0.15 + 0.5 + 0.05L)/3 = 0.2167 + 0.0167L`
   *
   * 于是上限随 L **线性**增长，而 `L ∝ log(资源)` —— 整体是对数增长，
   * **几乎不进 S 池**。而且它正好让「1 熵 = N 粒子」这个显示成真。
   *
   * 消耗**暗能量**。
   */
  convOutput: (() => {
    const PER_LEVEL = 0.05;
    return {
      id: "convOutput",
      name: "凝聚斜率",
      maxLevel: null,
      baseCost: 100,
      costMult: 2,
      costDarkEnergy: true,
      /** 每级给产出增量加多少 */
      perLevel: PER_LEVEL,
      desc: (lv) => {
        const inc = 0.15 + 0.5 + PER_LEVEL * lv;   // 假设 v5 已买
        return `熵凝聚每级产出增量 +${(PER_LEVEL * lv).toFixed(2)}（转换率上限 ${(inc / 3).toFixed(3)}）`;
      },
      firstRewardDream: true,
    };
  })(),
};

// ══════════════════════════════════════════════════════════
// 梦想点一次性升级（量子页）
// ══════════════════════════════════════════════════════════

/**
 * 梦想点一次性升级（量子页）。
 *
 * 为什么放在量子页：暗物质工程的三个升级里，第一个（梦想烬灭虚无）
 * 本来就用梦想点计价。后两个（高效相变 / 真空加速）原本只烧粒子和 ZPE，
 * 于是梦想点在中后期**没有去处**。这两个把它们接进梦想点经济。
 *
 * 定位：**自动化**。买了之后对应的暗能量升级会自动购买，
 * 玩家不用再手点（对齐 v9 的「达到阈值自动获取」）。
 */
export const DREAM_UPGRADES = [
  {
    id: "autoPhase",
    name: "相变自动化",
    cost: 1,
    target: "phaseShift",
    desc: "自动购买「高效相变」（只要粒子够就买，不需要手动点击）",
    effect: { kind: "autoBuy", deUpgrade: "phaseShift" },
  },
  {
    id: "autoVacuum",
    name: "加速自动化",
    cost: 1,
    target: "vacuumAccel",
    desc: "自动购买「真空加速」（只要 ZPE 够就买，不需要手动点击）",
    effect: { kind: "autoBuy", deUpgrade: "vacuumAccel" },
  },
  // ★ 新增两条：覆盖前面的暗能量升级 4（相变增幅）和 5（凝聚斜率）。
  //   用户要求：梦想点经济要覆盖全部五条暗能量升级。
  {
    id: "autoDeGainBase",
    name: "增幅自动化",
    cost: 1,
    target: "deGainBase",
    desc: "自动购买「相变增幅」（只要暗能量够就买，不需要手动点击）",
    effect: { kind: "autoBuy", deUpgrade: "deGainBase" },
  },
  {
    id: "autoConvOutput",
    name: "斜率自动化",
    cost: 1,
    target: "convOutput",
    desc: "自动购买「凝聚斜率」（只要暗能量够就买，不需要手动点击）",
    effect: { kind: "autoBuy", deUpgrade: "convOutput" },
  },
];

export const DREAM_BY_ID = Object.fromEntries(DREAM_UPGRADES.map((d) => [d.id, d]));

/**
 * 汇总已购梦想点升级的效果。
 *
 * ⚠️ 默认值必须从 DE_UPGRADES 读，**不能硬编码**。
 *
 * 踩过：这里曾写死 `phaseShiftEffectMult: 1.5`，而 DE_UPGRADES 的 effectMult
 * 后来被削到 1.13 —— 于是「没买升级」的基准值变成错的，S 判据算出 1.19（实际 0.50）。
 *
 * 统一原则：**任何派生值都从唯一数据源算，不抄。**
 */
export function dreamUpgradeEffects(state) {
  const s = state ?? {};
  const out = {
    phaseShiftCostMult: DE_UPGRADES.phaseShift.costMult,
    phaseShiftEffectMult: DE_UPGRADES.phaseShift.effectMult,
    phaseShiftBaseMult: 1,
    vacuumAccelEffectMult: DE_UPGRADES.vacuumAccel.effectMult,
    /** 需要自动购买的暗能量升级 id 列表 */
    autoBuyDe: [],
  };
  for (const d of DREAM_UPGRADES) {
    if (!s.dreamUpgrades?.[d.id]) continue;
    const e = d.effect;
    if (e.kind === "autoBuy") out.autoBuyDe.push(e.deUpgrade);
  }
  return out;
}

// ══════════════════════════════════════════════════════════
// 自检：数值层的 S 判据（SPEC §2.4 / P10）
// ══════════════════════════════════════════════════════════

/**
 * 计算耦合判据 S = Σ log(m)/log(r)。
 *
 * ⚠️ 只有 **kind = "matterMul" / "globalMul"（指数形式 m^等级）** 才计入。
 *
 * 三种不计入的情况：
 *   · kind = "globalAdd" —— 效果是 `1 + k·等级`，**仿射（线性）**，不是乘法。
 *     累计效果 = (1 + 0.05n)，线性增长。它的贡献是 log(log I) 级，
 *     对 S 的影响是 0。原稿的 particleBoost 就是这种。
 *   · kind = "convAdd"  —— 加法产出 + 加法阈值，净转换率有硬上限。
 *   · 一次性升级 / 里程碑 —— 没有「等级」，不构成反馈环。
 *
 * S < 1 才是安全的。当前只有 matterBoost 一条计入。
 */
/**
 * 可重复乘法升级的耦合判据。
 *
 * ⚠️ **必须用运行时生效的值，不能用 config 里的静态值。**
 *
 * 这个函数踩过两次同一个坑：
 *   ① 只统计 REPEATABLE，漏掉暗能量的可重复升级
 *      -> phaseShift 的 r = m = 1.5（贡献 1.000）一直没被检查到
 *   ② 统计了，但读的是静态 cfg 值，没理会梦想点升级的覆盖
 *      -> 买了「相位锁定」之后 S 仍显示 0.5002，实际已经是 0.375
 *
 * 一个「检查」如果检查的不是运行时真值，它就等于没检查。
 *
 * @param {object} [state] 传入则计入梦想点升级的覆盖；不传则用基础值
 */
export function computeS(state) {
  // 不传 state 就用「什么都没买」的基准值 —— 同样从 dreamUpgradeEffects 推导
  const d = dreamUpgradeEffects(state);
  const parts = [];

  // ① 三条可重复升级
  for (const cfg of Object.values(REPEATABLE)) {
    if (cfg.kind === "convAdd" || cfg.kind === "globalAdd") continue;
    parts.push({ id: cfg.id, m: cfg.effect, r: cfg.costMult, kind: cfg.kind });
  }

  // ② 暗能量里**可重复**的升级
  for (const cfg of Object.values(DE_UPGRADES)) {
    if (cfg.maxLevel != null) continue;       // 有上限 = 有限次，不计入
    if (!cfg.costMult && !cfg.piecewise) continue;
    // ★ **必须有 effectMult 才算「乘法型」**。
    //   「凝聚斜率」改的是产出**斜率**（加法），没有 effectMult ——
    //   最初忘了这条判断，于是它被当成乘法升级塞进 S，m=undefined -> S=NaN。
    //   审计立刻抓到了（D4 项）。注释里写"不进 S 池"是不够的，得在代码里执行。
    if (!cfg.effectMult) continue;
    const m = cfg.id === "phaseShift"
      ? d.phaseShiftEffectMult
      : cfg.id === "vacuumAccel" ? d.vacuumAccelEffectMult : cfg.effectMult;
    let r = cfg.costMult;
    // ★ 分段曲线（piecewise）对 S 的贡献由**最小的 r** 支配，
    //   因为单条升级的 S = log(m)/log(当前那一级的 r)，r 越小 S 越大。
    if (cfg.piecewise) r = Math.min(PIECEWISE.r1, PIECEWISE.r2, PIECEWISE.r3);
    parts.push({ id: cfg.id, m, r, kind: "deUpgrade" });
  }

  // ③ 「凝聚斜率」改的是**产出斜率**，不是乘法倍率，所以不进 S 池。
  //    上限 = (0.15+0.5+0.05L)/3 随 L 线性增长，而 L ∝ log(资源) —— 对数增长。
  //    （这条要显式写出来，否则以后有人会以为它被漏掉了。）

  let S = 0;
  for (const p of parts) S += Math.log(p.m) / Math.log(p.r);
  return { S, parts };
}

/** 只统计第四层（zone = dm）的贡献，用来控制新层的预算 */
export function computeTier4S() {
  const all = computeS();
  return {
    total: all.S,
    tier4: all.parts.filter((p) => ZONE_OF[p.id] === "dm")
      .reduce((s, p) => s + Math.log(p.m) / Math.log(p.r), 0),
  };
}

// ══════════════════════════════════════════════════════════
// 作用乘区（UI 用颜色区分）
// ══════════════════════════════════════════════════════════

/**
 * 每个升级「作用在哪个乘区」。
 *
 * 为什么值得用颜色标出来：SPEC 判据 P7 说「纯乘法链上乘法因子位置无关」，
 * 但玩家看不出来。给同一乘区的升级上同一个颜色，玩家一眼就能知道
 * 「这两条是叠在同一个位置上的」——这正是判断「是否重复」的直觉来源。
 *
 * 六个乘区对应经济链上的六个位置：
 *   物质 → 熵阱 → ZPE ──> 熵 ──(转换)──> 粒子 ──> 物质
 *                              ↑                        │
 *                              └────────────────────────┘
 */
export const ZONES = {
  entropy: { name: "熵产出", cn: "熵", color: "#64dd17" },
  particle: { name: "粒子转换", cn: "粒子", color: "#00bcd4" },
  matter: { name: "物质产出", cn: "物质", color: "#ff9800" },
  zpe: { name: "真空零点能", cn: "ZPE", color: "#2fa6f7" },
  de: { name: "暗能量", cn: "暗能量", color: "#b388ff" },
  global: { name: "全局乘区", cn: "全局", color: "#ffd600" },
  /**
   * 第三层：量子涨落。红色主色调。
   *
   * ⚠️ 原来这一格叫「暗物质」（`10^DM`），那个体系已整个删除 ——
   *    `10^DM` 只能给 `log10(M)` 加常数，把曲线平移了几百个数量级，
   *    导致 280 个数量级在 3 秒内跨过（见 engine.js 的说明）。
   *    现在它代表**量子加成**：熵生产 ×(1+q)、指数成长速率 R(q)。
   *
   * 红色在 AMOLED 黑底上对比度最强，保留作为「最高一层」的视觉标识。
   */
  dm: { name: "量子加成", cn: "量子", color: "#ff3b30" },
  /**
   * 梦想点体系 —— **虹色**。
   *
   * 它不是一个产出乘区，而是「成就货币」的加成集合：
   *   · 梦想点 → 全局倍率的基础加成（`1 + dp×0.02`）
   *   · 4 条自动化（相变 / 加速 / 增幅 / 斜率）
   *   · 梦想烬灭虚无、传承启迪（烧梦想点的升级）
   * 用户要求：凡涉及梦想点的都用虹色标识。
   * `rainbow: true` 让图例渲染成**流动渐变色块**，而不是单一 `color`。
   */
  dream: { name: "梦想加成", cn: "梦想", rainbow: true },
};

/** 每个 id 属于哪个乘区 */
export const ZONE_OF = {
  // 可重复升级
  particleBoost: "global",   // 全局产出
  matterBoost: "matter",     // 只影响物质
  entropyCoeff: "particle",  // 熵→粒子的转换
  // 虚空升级
  v1: "zpe",        // ZPE 产出
  v2: "entropy",    // 熵产出
  v3: "matter",     // 粒子→物质
  v4: "global",     // 梦想点的全局倍率
  v5: "particle",   // 熵凝聚
  v6: "zpe",        // ZPE 产出
  v7: "entropy",    // 点击熵
  v8: "zpe",        // ZPE 倍率
  v9: "global",     // 里程碑总开关
  // ZPE 里程碑
  m1: "entropy",    // 点击熵
  m2: "global",     // 升级价格
  m3: "matter",     // 物质产出
  m4: "entropy",    // 熵阱有效数量（同时影响 ZPE，但标主要作用）
  m5: "matter",     // 熵阱价格
  m6: "particle",   // 熵凝聚阈值
  // 暗能量里程碑
  dm0: "de",
  dm1: "zpe",
  dm2: "particle",  // 熵凝聚阈值
  dm3: "entropy",   // 熵产出
  dm4: "global",    // ZPE 折扣
  dm5: "de",
  // 暗能量升级
  dreamAnnihilation: "de",
  phaseShift: "de",
  vacuumAccel: "de",
};

export function zoneOf(id) {
  return ZONES[ZONE_OF[id]] ?? ZONES.global;
}

// ══════════════════════════════════════════════════════════
// 第四层：临界坍缩（红色）
// ══════════════════════════════════════════════════════════

/**
 * 设计推导（这一步的数值是算出来的，不是拍的）：
 *
 *   坍缩阈值  T_n = 1e25 × 10^(10n)      每档 ×1e10
 *   暗物质    DM_n = 10n                 每次 +10
 *   全局倍率  M    = 10^DM
 *
 *   验算：M_n = 10^(10n)，而 T_n = 1e25 × 10^(10n) = 1e25 × M_n
 *   => **每轮只需要把「基础曲线」推到 1e25，剩下的全部由倍率承担。**
 *      所以每轮耗时恒定，是个能自持的循环。
 *
 *   目标 1e308.25（= log10(Number.MAX_VALUE)，即 JS 双精度上限，
 *   也正是 AD「首次无限」的触发点）：
 *       需要 M = 1e283.25 -> DM = 283.25 -> **29 次坍缩**
 *
 * ⚠️ 关键：**1e25 是每轮的固定距离**，所以 S 杠杆（第四层的乘法升级）
 *    决定的是「一轮多快」，而不是「能到多高」。高度由倍率负责。
 */
export const COLLAPSE = {
  /** 解锁第四层（量子涨落）需要的物质 */
  unlockMatter: "1e25",

  /** 大坍缩阈值 = log10(Number.MAX_VALUE) = 308.2547... */
  bigCrunchMatter: `1e${Math.log10(Number.MAX_VALUE).toFixed(4)}`,

  /** 大坍缩给多少无限点 */
  infinityPointsPerCrunch: 1,
};

// ══════════════════════════════════════════════════════════
// ★ 已移除：暗物质 + 临界坍缩阶梯（用户决定）
// ══════════════════════════════════════════════════════════
//
// 原来的第三层是「临界坍缩阶梯」：
//   物质跨过阈值(×1e5 递进) -> 领一份暗物质 -> 全局倍率 ×10^DM
//
// 它被整个删掉，原因有两层：
//
// ── ① 暗物质倍率的形式是错的 ──
//   `10^DM` 每级 +10，56 级累积到 `1e560`。基础成长的形状是
//   `M'' ∝ log(M)`（熵阱数量 ∝ log 物质），乘一个倍率 C 只能得到
//   `log10(M) ∝ 2·log10(t) + 常数(C)` —— **只平移常数项，改不了形状**。
//   于是 `1e560` 的常数项把整条曲线平移了几百个数量级，
//   280 个数量级在 3 秒内跨过。**这不是调节参数能修的，是形式问题。**
//
// ── ② 量子涨落现在承担了整条成长曲线 ──
//   见 `quantumGrowthRate()`：它给物质一个 **∝ M 的项**，让成长变成指数，
//   速率被钳制在 0.05 数量级/秒以内。
//   实测：1e25 -> 1e308.25 = **1.76 小时**，曲线平滑。
//
// 所以现在的层结构是：
//   第 0 层  熵 -> 粒子 -> 物质
//   第 1 层  ZPE
//   第 2 层  暗能量
//   第 3 层  **量子涨落**（ZPE 门槛捕获量子 -> 指数成长速率）★ 原「临界坍缩」的位置
//   第 4 层  大坍缩 -> 无限点（唯一的重置）

// ══════════════════════════════════════════════════════════
// 量子（Quantum）—— 极稀有货币
// ══════════════════════════════════════════════════════════

/**
 * 「量子涨落捕获」的配置。
 *
 * 门槛 ×10 递增本身就是刹车：ZPE 每涨 10 倍才能多捕一对。
 * 对比前两版（直接边 / 永久累积），它们的增长是**指数**的，所以都炸了。
 */
export const QUANTUM = {
  /** 第一对量子的 ZPE 门槛 */
  zpeBaseCost: 1e10,
  /** 每捕获一对，下一对的门槛 ×这个数 */
  zpeCostGrowth: 10,
  /** ★ 用户新增的削弱：在 ×10 的基础上**再 ×2**（合起来每次 ×20） */
  zpeCostExtraNerf: 2,
  /**
   * ★ 量子 → 指数成长速率的**上限**（数量级/秒）。
   *   283 阶 ÷ 0.05 = 5660 秒 = 1.57 小时（目标区间 1~2 小时）。
   */
  growthRateMax: 0.05,
  /** 达到上限一半时所需的量子数（越小越慷慨）。0.5 时阶梯段约 1.75 小时 */
  growthRateHalf: 0.5,
  /** 每对给几个量子（用户设定：一对） */
  perPair: 2,

};

/**
 * 量子 → **指数成长速率**（单位：数量级/秒）。
 *
 * ══════════════════════════════════════════════════════════
 * 为什么需要这个（结构性问题，不是调参问题）
 * ══════════════════════════════════════════════════════════
 *   基础成长是 `M'' ∝ log(M)`（因为熵阱数量 ∝ log(物质)），
 *   于是 `M` 随时间**多项式**增长，`d(log10 M)/dt` 持续衰减。
 *
 *   乘进任何倍率 `C` 只能把系数放大：
 *       `log10(M) ∝ 2·log10(t) + 常数(C)`
 *   —— **只加一个常数，改不了曲线的形式。**
 *   实测：`perPair=200`（量子 2400 个，倍率 ×2401）也走不到 1e308。
 *
 *   要「1e25 → 1e308.25 平滑 1~2 小时」，成长必须是**指数**的：
 *       `d(log10 M)/dt = R`   （R 为常数）
 *
 * ── 形态 ──
 *   `R(q) = Rmax × q / (q + half)`
 *     · q=0    -> 0
 *     · q=half -> Rmax/2
 *     · q→∞    -> Rmax（平滑趋近，永不超出）
 *
 *   283 个数量级 ÷ Rmax：
 *     Rmax = 0.05 -> 5660 秒 = 1.57 小时   ← 落在「>1h 且 <2h」的目标区间
 *     Rmax = 0.08 -> 3538 秒 = 0.98 小时
 *     Rmax = 0.04 -> 7075 秒 = 1.97 小时
 *
 *   `half` 决定「量子要多少才推得动」：half 越小越慷慨（用户说升级区可以慷慨）。
 */
export function quantumGrowthRate(quantum) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(0);
  const max = new Decimal(QUANTUM.growthRateMax);
  const half = new Decimal(QUANTUM.growthRateHalf);
  return max.mul(q).div(q.add(half));
}

/**
 * 下一对量子的 ZPE 门槛：`1e10 × (10 × 2)^已捕获对数 = 1e10 × 20^n`。
 *
 * ── 递进结构 ──
 *   · `zpeCostGrowth = 10`：每次捕获门槛 ×10
 *   · `zpeCostExtraNerf = 2`：**再 ×2**（用户新增的削弱）→ 合起来每次 ×20
 *
 * 为什么必须是**几何递进**（固定倍率 > 1）：
 *   它把量子数锁在 `log(ZPE)` 上。若改成线性，量子数会变成 `ZPE / 1e10` 级别
 *   （ZPE=1e100 时 1e90 个量子），`×(1+q)` 直接爆炸。
 *
 * 削弱对比（ZPE = 1e100 时）：
 *   ×10  递进 -> 90 对 -> 180 量子
 *   ×20  递进 -> 64 对 -> 128 量子   ← 现在
 *   ×100 递进 -> 32 对 ->  64 量子
 */
export function quantumZpeRequirement(pairs) {
  const n = pairs instanceof Decimal ? pairs : new Decimal(pairs ?? 0);
  // 用户设定的「再 ×2」并进底数：10 × 2 = 20
  const step = new Decimal(QUANTUM.zpeCostGrowth).mul(QUANTUM.zpeCostExtraNerf ?? 1);
  return new Decimal(QUANTUM.zpeBaseCost).mul(Decimal.pow(step, n));
}

/**
 * 量子 → **熵生产的最终倍率**（基础公式**最外层**的 `× 最终倍数加成`）。
 *
 * 形式 `1 + q`：线性，基于当前持有的量子量。
 * 它本身无界，但**量子会被大坍缩重置**，所以单周期内 q 有上限，不跨周期膨胀。
 */
export function quantumEntropyMultiplier(quantum) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(1);
  return q.add(1);
}

/**
 * 量子 → **暗能量倍率的「基础加成」**（a区）。
 *
 * 用户定义：**当前持有的量子量 ²**，作为加进基础的加成。
 *     `暗能量倍率 = (1 + 0.25·log2(暗能量)) + q²`
 *
 * 注意返回的是**加成量**（加到括号里），不是倍率 —— 所以 q=0 时返回 0。
 * 给平方的理由：量子量本身很小（一轮几十个），平方后才有量级感。
 */
export function quantumDeMultBonus(quantum) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(0);
  return q.mul(q);
}

/**
 * 量子 → **暗能量获取的「基础加成」**（a区）。
 *
 * 用户定义：**当前持有的量子量取对数**，作为加进基础的加成。
 *     `每次转换量 = 高效相变 × 1.25^... × [1 + log10(q)]`
 *
 * 对数让它天然温和：量子从 10 涨到 1000（100 倍），加成只从 1 涨到 3。
 * 返回的是**加成量**，所以 q≤1 时返回 0。
 */
export function quantumDeGainBonus(quantum) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(1)) return new Decimal(0);
  return q.log10();
}


// （旧函数 `quantumGain(matterLog10)` 已删除：量子改为按阈值累积，
//   见上方 `quantumGainForCollapse` / `quantumGainForCrunch`。）



/** 汇总已购量子升级的效果 */

// ★ `darkMatterMultiplier(10^DM)` 已移除 —— 暗物质体系整个删除。
//   它是「阶梯 3 秒」的形式性元凶（把曲线平移 1e560 个数量级）。
//   现在由 `quantumGrowthRate()` 提供指数成长速率。

/**
 * 「打破无限」—— 仿 AD 的 Break Infinity。
 *
 * 三个阶段：
 *   ① 未打破：物质被**硬顶**在 `crunchAt`，到顶**强制**大坍缩，收益固定 `firstCrunchIP`
 *              （对应 AD 的第一次 Infinity，你没法突破 1.79e308）
 *   ② 花 `unlockCost` 无限点买下「打破无限」
 *   ③ 已打破：上限解除，物质可以继续涨；大坍缩改为**手动**，
 *              收益随深度连续增长 —— 这就是「超过 e308.25 迎来削弱」：
 *              跑得越深收益越高，但**每多一个数量级的收益递减**。
 *              玩家要在「多跑一会儿」和「赶紧收」之间选。
 */
export const BREAK_INFINITY = {
  /**
   * 大坍缩阈值 = log10(Number.MAX_VALUE) = 308.2547…
   *
   * ⚠️ 阈值必须用 `Decimal.pow(10, MAX_LOG10)` 构造，**不能用字符串 `"1e308.2547"`**。
   *    break_eternity 的字符串解析只认**整数**指数 ——
   *    `new Decimal("1e308.2547")` 会静默变成 `1e308`，白丢 0.25 个数量级。
   *    （这就是又一处「显示 vs 实际」不符：界面写 1e308.2547，代码实际用 1e308。）
   */
  maxLog10: Math.log10(Number.MAX_VALUE),

  /** 首次大坍缩的固定收益 */
  firstCrunchIP: 1,

  /** 买下「打破无限」要多少无限点 */
  unlockCost: 1,

  /**
   * 突破后的收益公式：`floor(base × (log10(物质) / log10(MAX))^exponent)`
   *
   * exponent = 2 时：
   *   1e308  -> 1       （还没突破，和固定收益持平）
   *   1e616  -> 4
   *   1e1000 -> 10
   *   1e3000 -> 94
   */
  ipBase: 1,
  ipExponent: 2,
};

/** 大坍缩阈值的显示字符串（和实际值同源，不会脱节） */
export const CRUNCH_AT_LABEL = `1e${BREAK_INFINITY.maxLog10.toFixed(4)}`;

/** 大坍缩能拿多少无限点 */
export function infinityPointGain(matter, broken) {
  const m = matter instanceof Decimal ? matter : new Decimal(matter ?? 0);
  if (!broken) return new Decimal(BREAK_INFINITY.firstCrunchIP);
  const maxLog = Math.log10(Number.MAX_VALUE);
  const depth = m.gt(0) ? m.log10().div(maxLog) : new Decimal(0);
  if (depth.lte(0)) return new Decimal(BREAK_INFINITY.firstCrunchIP);
  return Decimal.max(
    1,
    depth.pow(BREAK_INFINITY.ipExponent).mul(BREAK_INFINITY.ipBase).floor(),
  );
}

/** 大坍缩阈值（Decimal）—— 用 pow 构造，保住小数指数 */
export function crunchThreshold() {
  return Decimal.pow(10, BREAK_INFINITY.maxLog10);
}

/**
 * 无限点 → 效果（暂定，用户说之后再调）。
 * 现在是纯计数 + 解锁「打破无限」。
 */
export function infinityPointEffect(ip) {
  const n = ip instanceof Decimal ? ip : new Decimal(ip ?? 0);
  return { count: n };
}
