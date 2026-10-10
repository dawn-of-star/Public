/**
 * ══════════════════════════════════════════════════════════════
 * 乘区定义（基础公式）—— **这是全项目的最高约束**
 * ══════════════════════════════════════════════════════════════
 *
 * ── 规范形态 ──
 *
 *   资源_next = { [ 资源_prev + (1 × 乘法区) + 加法区 ] ^ 指数区 } × 最终倍率区
 *
 *   a区 = 加法区 + 乘法区   「1 ×」里的 1 是各层的**基准常数**
 *                           （BASE.trapBaseRate / matterPerParticle /
 *                            autoConvertOutput / clickGain …），不是可有可无的写法
 *   b区 = 指数区            对 `{...}` **整体**取幂
 *   c区 = 最终倍率区        由**词条**判定：描述里带「最终」二字的加成/减益都算这一层
 *
 * ── 代码现状：四条必须记住的实现事实（改动前先读这四条）──
 *
 *   ① **a区作用在增量上**：`gain = 1 × 乘法区 + 加法区`，`资源 += gain × dt`。
 *      加法和乘法在 a区里混乘（例：梦想点 `(1 + dp×0.02)`、粒子升级
 *      `(1 + Σ等级×0.05)`、物质速率 `× 1.0625^等级`、虚空 v2 `× 1.5`）。
 *
 *   ② **b区当前恒等于 1** —— 运行路径上没有任何一层对 `{...}` 整体取幂。
 *      这是**刻意的**：对值取幂会把曲线从「平移」改成「改形」，增益过于给力，
 *      所以**前期加成一律不碰 b区**。想加 b区成员时，必须重新验 S 判据和环增益。
 *
 *   ③ **c区乘的是增量，不是 `{资源_prev + 增量}`**：
 *          实现： 资源_next = 资源_prev + gain × 最终倍率区
 *          规范： 资源_next = (资源_prev + gain) × 最终倍率区
 *      两者只在「存量不被清空」的层上不等价。熵这一层等价（熵每 tick 被转换扣空，
 *      存量只剩余数）；**将来把 c区 用到物质 / ZPE / 暗能量之前必须先定死这一点** ——
 *      差的就是 `资源_prev × 最终倍率区` 这一项，那才是会跑飞的存量放大。
 *
 *   ④ **物质层的量子项是「等价写法的 b区」**，只是被记在 a区的加法端：
 *          engine.js：`matterGain += M × R(q) × ln10 × dt`
 *          等价于   ：`M_next = M × (1 + R·ln10·dt) = M ^ (1 + R·ln10·dt / ln M)`
 *      指数略大于 1（且随 `ln M` 衰减）→ `d(log10 M)/dt = R(q)`，
 *      即「每秒固定阶数」的真指数成长。它是当前**唯一**改形成长的机制。
 *
 * ── 公式覆盖不到的第四个动作（别硬塞进 a/b/c）──
 *   · 交换 / 扣费：熵 → 粒子要扣 `times × threshold`；购买要扣价
 *   · 跨层重置：大坍缩把物质/粒子/熵/熵阱/ZPE/暗能量/量子归零
 *   所以「上一轮资源」不是无条件继承的 —— 这条公式只描述**生产**那一步。
 *
 * ── c区成员登记（靠词条，不靠颜色）──
 *   现在只有一条：量子 → 熵生产 `×(1+q)`（见 quantumEntropyMultiplier）。
 *   乘区配色（ZONES / ZONE_OF）里**没有** c区，它由描述里的「最终」二字标识，
 *   所以界面上必须把这个词写出来（量子面板写的就是「最终倍率」），
 *   否则玩家无法区分它和 a区的加成。
 *
 * ── 形式上是 b区、但不是（三处 pow 的归类）──
 *   判据是**底数是什么**（详见 tools/zone-audit.mjs）：
 *     · `Decimal.pow(常量, 等级/数量)` → 一个**因子** → a区
 *     · `值.pow(指数)` 且**包住整个 `{...}`** → b区 ✅（现在没有）
 *   现存三处「对值取幂」产出的都是 a区的东西：
 *     · `zpeMultiplier = (ZPE+1)^0.02`        产出倍率，被当 a区因子用
 *     · `zpeProductionPenalty` 里的 `DE^0.5`   产出惩罚倍率
 *     · `infinityPointGain` 里的 `深度^2`       产出无限点**数量**（不是倍率）
 *
 * ── 历史误会 ──
 *   曾经把「代码里出现 pow() 」当成 b区越界，那是**语法判据**。
 *   实际上价格的 `r^等级`、升级的 `m^等级`、资源的 `10^DM` 全都是 a区的因子。
 */
export const ZONE_RULES = {
  a: { name: "加法池 × 乘法池", hasFinalWord: false, raisesWholeValue: false },
  /** ⚠️ 当前**恒为 1**：刻意不实现（见上面第 ② 条） */
  b: { name: "指数区", hasFinalWord: false, raisesWholeValue: true },
  /** 由词条判定；当前唯一成员是量子 `×(1+q)`，且作用在**增量**上（见第 ③ 条） */
  c: { name: "最终倍数加成", hasFinalWord: true, raisesWholeValue: false } };

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
  /**
   * ⚠️ localStorage 的键**刻意不跟着游戏改名**（游戏已改名「空想增量」）：
   *    改了键 = 浏览器里的老存档立刻读不到。要改就得配一次迁移读取。
   */
  saveKey: "cosmos-origin-034",
  saveVersion: 2 };

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
// ZPE 引擎（打破无限后 · 虚空系统子页）
// ══════════════════════════════════════════════════════════

/**
 * ZPE 引擎：拿**无限点**买等级，等级同时喂三条机制。
 *
 * 设计推导见 [`docs/ZPE-ENGINE.md`](../../docs/ZPE-ENGINE.md)。
 * ★ **2025 设计稿（用户）已替换原三条**：
 *   ① `zpeMultiplier` 的**加法区额外倍率**：每级 +`addPerLevel`（**不再抬指数** ✗）
 *   ② 每级：**ZPE 产出 ×10**、**ZPE 倍率 ×2**（乘算）
 *   ③ `zpeMultiplier` 吃「计数频率」（等级 ≥ countFreqLevel），且
 *   ④（写在 `darkEnergyMultiplier` 里）**引擎倍率也作用在暗能量倍率上** ⇒ 与 ③ 闭合成环，
 *      环增益已验算 ≈ 9.9e-4 ≪ 1（因为暗能量倍率对暗能量是**对数**依赖 ✓）
 *
 * ⚠️ 旧参数（`expLevel` / `expPerLevel` / `expMax` / `perLevel`）**已废弃**：
 *    保留只为兼容旧存档与工具，不再参与计算（`()` 恒返回 0 ✓）
 *    旧红线 `a = (0.02 + ①) × 1.74 < 1` 因此自动满足（① 不再加指数 ✓）
 *
 * 为什么等级用无限点买（而不是 ZPE）：IP 的长期曲线是**线性**的（60 × 3^① 点/小时），
 * 于是等级 ∝ 时间 ⇒ 产出随时间的幂次由 ② 决定；而且**不碰自反馈指数 a**（a 只看 ZPE 的幂次）。
 * 用 ZPE 买的话等级 ∝ log(ZPE)，只给多项式提速。
 */
/**
 * ★ 第三种设计稿（用户 2025）· **无限挑战（IC）**
 *
 *   · 条件：**只有"抵达无限"**（用户裁定）⇒ 本实现里 = 在挑战激活期间完成一次大坍缩
 *   · 难度：熵→粒子的熵需求 ×5，每完成一次再 ×5（最高 ×78125 = 完成 7 次）
 *   · 奖励：完成后**无限点余额跃升一段**（每段 = 36.89 个数量级）
 *       1e50 → 1e86.89 → … → 1e308.25（第 7 段正好触及永恒门槛）
 *   · 安全：跳跃因子是**固定常数**、只有 7 步 ⇒ 不构成指数链（判据安全）
 */
/**
 * ★ 第三种设计稿（用户 2025）· 新 **8 条坍缩里程碑**
 *   （替代旧的 TIER_MILESTONES；方案 A：新 8 条完全替换旧 7 条）
 *
 *   用户裁定：② 计数频率「系数翻倍」（0.05 -> 0.10）、④「直接给 4 量子」
 *   ⚠️ ①④⑦ 的落点需要动 doBigCrunch 的收尾与 quantumZpeRequirement 的签名
 *      ⇒ 这两处留待同批接线（本轮先接 ②③⑤⑥ 四条）
 */
/**
 * ★ 八条「无限后的坍缩里程碑」—— **逐条来自用户的原始设计稿**
 *   （`C:\Users\25187\Desktop\第三层设计.txt` 第 5~13 行，用户 2025 指定）
 *
 *   `at` = 需要的大坍缩次数（每次大坍缩推一个）。第 1 条在**首次无限**时立刻达成 ✓
 *   八条的落点全部已接线（哪个函数读它，见每条后面的注释）。
 */
export const COLLAPSE_MILESTONES = [
  { at: 1, id: "cm1", desc: "无限后以 10 粒子 + 10 物质开局" },                 // engine.js doBigCrunch 末尾
  { at: 2, id: "cm2", desc: "计数频率每级系数翻倍（0.05 → 0.10）" },           // formulas.js countFreqAddTerm
  { at: 3, id: "cm3", desc: "熵到粒子的初始转换比 100:1 → 50:1" },             // formulas.js conversion（阈值 ×0.5）
  { at: 4, id: "cm4", desc: "无限后以 4 量子开局" },                           // engine.js doBigCrunch 末尾
  { at: 5, id: "cm5", desc: "相变仪转换速率随持有无限点增幅（对数，倍增而减缓）" }, // formulas.js conversion + transmuterIpMult
  { at: 6, id: "cm6", desc: "量子每对获得数量 +1" },                           // config.js quantumPerPair
  { at: 7, id: "cm7", desc: "量子获得公式重做（前期更多、后期更难）" },          // config.js quantumZpeRequirement（1e8 / ×22）
  { at: 8, id: "cm8", desc: "基于游玩时间的全局倍率额外加成（对数）" },         // config.js playTimeBonus
];

/** 该坍缩里程碑是否已达成（按已大坍缩次数） */
export function hasCollapse(state, id) {
  const m = COLLAPSE_MILESTONES.find((x) => x.id === id);
  if (!m) return false;
  return Number(state?.bigCrunchCount ?? 0) >= m.at;
}

/** ⑤ 相变仪随持有 IP 的倍率（对数 ⇒ 倍增而减缓；封顶防失控） */
export const TRANSMUTER_IP = { coeff: 0.5, cap: 100 };
export function transmuterIpMult(state) {
  if (!hasCollapse(state, "cm5")) return 1;
  const ip = Math.max(0, (state?.infinityPoints ?? 0).toNumber());
  const v = 1 + TRANSMUTER_IP.coeff * Math.log10(1 + ip);
  return Math.min(v, TRANSMUTER_IP.cap);
}

/** ⑧ 游玩时间的全局加成（对数 ⇒ 次线性；字段缺失时返回 1 ✓ 安全） */
export const TIME_BONUS = { coeff: 0.1 };
export function playTimeBonus(state) {
  if (!hasCollapse(state, "cm8")) return 1;
  const sec = Number(state?.stats?.playTimeSec ?? state?.playTimeSec ?? 0) || 0;
  if (sec <= 0) return 1;
  return 1 + TIME_BONUS.coeff * Math.log10(1 + sec / 60);
}

export const INFINITY_CHALLENGES = {
  max: 3,                       // ★ 2025 用户重排：**降为可选挑战**（3 关 ✓ 主线时长改由引擎/深度承重 ✓）
  entMult: 5,                       // 每完成一次，熵需求再 ×5
  ipJumpOrders: 10,                  // ★ 重排：每关只是"**加成**"（+10 阶 ✓ 可调 ✓）—— 主线 IP 由深度提供 ✓
};

/** 当前挑战的熵需求倍率：未激活 ⇒ 1（零回归） */
export function icEntropyMult(state) {
  const k = state?.ic?.active;
  if (k == null) return 1;
  if (k === 0) return 1;                       // ★ 入门关：熵需求**不削弱**（×1 ✓ 用户 2025）
  return Math.pow(INFINITY_CHALLENGES.entMult, k);
}

/** 完成一次挑战 ⇒ 无限点余额跃升一段（返回跃升倍率，供日志用） */
export function icIpJumpMult() {
  return new Decimal(10).pow(INFINITY_CHALLENGES.ipJumpOrders);
}

export const VOID_BOOST = { coeff: 0.1 };

/**
 * ★★ 2025：**「曾经解锁过」的页面记录**（用户裁定：第一次永恒后相关页面保持解锁）
 *
 * ── 问题 ──
 *   各面板的解锁判定**几乎全建立在会被重置的值上** ——
 *   · 量子 / 无限面板 = `collapseUnlocked(state)` = **`peakMatter ≥ 1e25`**
 *   · 暗能量面板     = `phaseTransmuterUnlocked`
 *   · ZPE 引擎面板   = `zpeEngineUnlocked`
 *   · 虚空面板       = 由 `v1` 等虚空升级推导
 *   而 `doEternity()` 会把上面这些**一并清零** ⇒ 永恒后整排标签重新上锁 ✗
 *   （用户玩完第一轮实测反馈：「我们应该在第一次永恒后保持相关页面的解锁状态」）
 *
 * ── 做法 ──
 *   把**解锁**与**数值**彻底解耦：
 *   · `state.pageUnlocked[key]` = 曾经解锁过（**永不重置**，`doEternity` 不碰它）
 *   · 读取方一律走 `pageUnlocked(state, key)`；解锁那一刻调 `markPageUnlocked(state, key)`
 *   ⚠️ **不要在 UI / formulas 里直接读那些易失字段判解锁** ✗（这正是本 bug 的成因）
 *
 * `key` 取值（与面板一一对应）：
 *   `void` 虚空科技 · `zpe` ZPE 引擎 · `de` 暗能量 · `quantum` 量子涨落 ·
 *   `infinity` 无限 · `eternity` 永恒
 *
 * ⚠️ **加新页面时必须同步这里** —— 漏一个就会出现"该页永恒后仍上锁"的 bug
 *   （踩过：`eternity` 第一版就漏了，用户实测反馈「我的永恒页面也被重置了」✗）
 */
export const PAGE_KEYS = ["void", "zpe", "de", "quantum", "infinity", "eternity"];

/** 该页面是否已解锁过（**永久**：第一次达成后就一直为真） */
export function pageUnlocked(state, key) {
  if (!state) return false;
  return state.pageUnlocked?.[key] === true;
}

/**
 * 记录某页面已解锁（幂等）。
 * @returns {boolean} 是否是**本次新解锁**（true ⇒ 调用方可以写一条日志）
 */
export function markPageUnlocked(state, key) {
  if (!state) return false;
  if (!state.pageUnlocked) state.pageUnlocked = {};
  if (state.pageUnlocked[key] === true) return false;
  state.pageUnlocked[key] = true;
  return true;
}

export const ZPE_ENGINE = {
  // ⚠️ 原来这里有个 `unlockCostIp: 10`（"解锁价 10 无限点"）—— **已删除**：
  //   解锁条件 2025 就改成了「**1 次大坍缩**」（里程碑奖励，不花无限点，还送 1 级），
  //   见 `engine.js` 的 `unlockZpeEngine()`。这个字段从此**没有任何读取方** ⇒ 是死数据 ✓
  //   （留着它的害处：注释还在说"用户指定：10 无限点"，与实现相反 ⇒ 读代码的人会被误导 ✗）
  /**
   * **第一级价格**（= 指数价格的 `c0`）。
   *
   * ★★★ 2025 **终稿**（用户裁定）：`5`。价格形状改成**指数** `c0 · r^L`（见 `costGrowth`）。
   *
   *   ⚠️ 本字段曾被我（2025 本会话）一路降到 **1e-5**（5 → 0.001 → 1e-4 → 1e-5），
   *      理由是"让 168h 达到 2000 级" —— **只看了一个目标、没看首价** ⇒
   *      界面出现"0.1 的价格"（用户当场指出），且 1e28 池能买到 **2.4 亿级** ✗
   *   ⚠️ 而且**幂次价格下"首价可读"与"满级卡住"不可兼得**：
   *      要让 1e28 池恰好买 ~2000 级，反解出 `base ≈ 2.5e15` ⇒ 1 级价就是 2.5e15 ✗
   *   ⇒ 改成指数后，首价是**独立可读**的数（= 5），而级数由 `log(池)` 控制 ✓
   *
   *   标定：**1e28 池 ≈ 100 级**（用户裁定）⇒ `5·(r^100−1)/(r−1) = 1e28` ⇒ `r = 1.872483` ✓
   */
  baseCostIp: 5,
  /**
   * ★★★ **每级涨价倍率**（指数价格的 `r`）—— 用户裁定的"价格步长不短"就落在这里。
   *
   *   `cost(L) = baseCostIp · costGrowth^L`（L = 当前等级，买的是第 L+1 级）
   *   ⇒ **每级固定 ×1.60**（不是"每级加一点"）⇒ 步长恒定、可预期 ✓
   *
   *   ── 各池子对应的级数（标定结果）──
   *   | IP 池 | 能买级数 |
   *   |---|---|
   *   | 1e10 | 44 |
   *   | 1e20 | 71 |
   *   | **1e28** | **100** ← 用户裁定的锚点 |
   *   | 1e40 | 144 |
   *   | 1e100 | 364 |
   *   ⇒ 全程落在 0~350 的**可读范围**（不再是 2.4 亿）✓
   *
   *   ⚠️ 调大 `r` ⇒ 更陡 ⇒ 同样池子买到更少级；调小则相反。
   *      改它**不影响**首价（首价恒 = `baseCostIp`）✓
   */
  costGrowth: 1.872483,
  /**
   * ★★★ **引擎加成对「量子加成」的每级增速**（用户裁定：方案**乙** = `1.22`）。
   *
   *   `engineBonusMult = bonusGrowth^等级` —— 乘在 5 条量子加成上（见 `engineBonusMult`）。
   *
   *   ── 为什么**不等于** `costGrowth`（我第一版就是那么做的，结果 12h 冻结 ✗）──
   *     实测量级：
   *       · 每级加成 ×B ⇒ 收入 +log10(B) 阶（因为 k 杠杆 ≈ +46 阶/级，见下）
   *       · 价格每级 ×`costGrowth` ⇒ **需要** 收入 +0.272 阶/级
   *     ⇒ 若 `B = costGrowth = 1.872`（+0.272 阶）⇒ **收入与价格恰好持平**
   *       ⇒ 数值一偏就成**正反馈** ⇒ 实测 **12 小时冲到 819 级后彻底冻结**（IP 池、量子、等级全不动）✗
   *     ⇒ 取 `B = 1.22`（+0.087 阶）⇒ 收入比价格**慢 3 倍**
   *       ⇒ 推进是**渐进的**：买一级看得见收益，但追不上价格 ⇒ 不会一步到位 ✓
   *
   *   ⚠️ 标定依据（实测）：
   *     · `k` 杠杆：a区 ≈ 1e4126 @深度 1e8744，k 每级 +0.0113 ⇒ rate 每级 +46 阶
   *     · 但"每级加成 ×B"直接乘在**量子加成**上 ⇒ 收入 +log10(B) 阶（不再走 k）
   *     · 所以 `B` 与 `log10` 后就是"每级收入增量"，与价格的 0.272 直接可比较 ✓
   */
  bonusGrowth: 1.22,
  /**
   * ★★★ **方案甲**（用户裁定）：引擎加成的**基准级** ——
   *   `engineBonusMult(lv) = Σprice(0→lv) / Σprice(0→bonusBaseLevel)`
   *
   *   取 1：乘数从第 1 级起算（1 级 ⇒ ×1，2 级 ⇒ 约 ×1.87…）
   *   ⚠️ 若它让引擎"起步就爆"（因为 116 级时的累计价是 2.4e27 倍），
   *      就把这个数**抬到引擎的自然停滞点**（≈116）⇒ 那时乘数从 ×1 开始长。
   *      （这是一个**可选旋钮**：值越大 ⇒ 乘数起步越小、越晚发力）
   */
  bonusBaseLevel: 1,
  /**
   * ★ 2025 已废弃：下面这段"分段软上限"（`0~10 ×2 / >10 ×20 / >100 ×49 / >1000 ×219`）
   *   是**三次方时代的旧设计**，已被指数价格整体取代 ⇒ **无任何读取方** ✗
   *   （保留这段文字只为说明来历；真正的价格见 `zpeEngineCost` / `zpeEngineTotalCost`
   *     / `zpeEngineAffordableIn` 三个同源函数。）
   *
   *   | 等级区间 | 每级涨价倍率 | 说明 |
   *   |---|---|---|
   *   | 0 ~ 10    | ×2           | 正常段 |
   *   | > 10      | ×2 **再 ×10** = ×20 | 「大于 10 引擎价格增长 ×10」 |
   *   | > 100     | 再 **^1.3** = ×49.1 | 「大于 100 再多 ^1.3」 |
   *   | > 1000    | 再 **^1.8** = ×218.6 | 「大于 1000 再多 ^1.8」 |
   */
  // ⚠️ `addPerLevel`（① 每级 +1）**已删除**：① 改成饱和式后不再"每级加固定值"，
  //   参数移到 `ENGINE_MECH.add`（`A` / `knee`）✓
  // ⚠️ ② 的旧参数（`(1 + perLevel×等级)²`）也已删除（2025 设计稿改过两次形状）。

  /** ③ 从这一级起，ZPE 倍率开始吃「计数频率」 */
  countFreqLevel: 5,
  /** ⚠️ 废弃（2025 设计稿把 ① 改成加法区）：① 原来从这一级起给倍率公式加指数 */
  /** ① 的指数加成上限（安全线：0.05 × 2 = 0.10 ≪ 1） */
};

/**
 * ★ 无限铸币（**设计未冻结：用户保留最终修改权**）
 *
 * 用户批注：「铸币系统一看就很影响设计，虽然强力。我的建议是保留对这一设计的最终修改权。」
 *
 * ── 它是什么 ──
 *   可重复升级，花**无限点**买，效果是把**所有无限点收入**乘以 `m^等级`。
 *   价格也是等比：`baseCostIp × r^等级`。于是
 *       p = log(m)/log(r)
 *   `p < 1` 收敛（追不上）、`p = 1` 每小时固定阶数、`p > 1` 超临界（有限时间奇点）。
 *   本项目取 `p = 1.32 > 1`：**先慢后冲**，这是唯一能在几十小时内跨 306 阶的形态。
 *
 * ── 为什么必须有"档位闸门"（关键，模型实测的教训）──
 *   只要某个循环能用无限点**批量买入**，池子一大它就会瞬间买几百级、当场放大收入。
 *   所以铸币等级**硬性**受 `capPerCrunch × 大坍缩次数` 限制：
 *   每次大坍缩才放行一批，节奏就由"每次大坍缩要多久"决定（见 `docs/IP-ECONOMY.md`）。
 *
 *   ⚠️ 闸门**不许**和别的循环用加法耦合。模型里曾经把上限写成
 *      `引擎等级 + 档位×增量`，结果引擎等级一跑飞就把闸门整体顶开（12/22/32 拟合结果一模一样）。
 *
 * ── 拟合结果（`tools/ip-economy-lab.mjs`）──
 *   `capPerCrunch = 30` + ① 每档 +2 级 → 实测 **24.0 小时 / 24 档**，每档兑现 **12.73 阶**
 *   （设计值 `306 ÷ 24 = 12.75`）。
 */
/**
 *   —— 它原先只通过「深度复利 IP 公式」（已换成 AD 型 ✗）与「无限长河」（已停产 ✗）生效。
 *   本定义**暂时保留**（41 处工具断言仍直接调用它 ✓ 删定义会连带一大片 ✗）；
 *   等"清理批次"一起删（那时连工具断言一并处理 ✓）。
 *   ⇒ 它现在**不影响任何数值** ✓（界面条目也已隐藏 ✓）
 */


/**
 * ★ 无限增幅（①，`INFINITY_UPGRADES.ipDouble`）的价格**软上限**。
 *
 * 用户指定：「若会影响永恒阶段务必加入极强的软上限」。
 * ① 的效果是 `收入 ×3^等级`、价格 `10^等级` —— 单独看是**收敛**的（`p = 0.477`），
 * 但池子一大就能**批量买几百级**：模型实测 `A ≈ log10(池子/9)`，
 * 于是「池子变大 → 一次买光 → 收入 ×3^A」形成池驱动的爆走。
 *
 * 拟合需要的量级是 **A ≈ 50**（24 档 × 每档 +2 级），所以软上限从第 60 级起咬：
 * 60 级前完全不干扰设计，之后每级涨价 ×100、再 ^1.5 —— 1e308 点也只能买到 60 多级。
 */
// ⚠️ 2025 **已删除** `IP_DOUBLE_SOFT_CAP`（分段 `×10 / ×100 / ×10^3`）——
//   用户终稿裁定：「**同 AD 中 ip 倍增价格逻辑，且不再更改**」
//   ⇒ 价格改由 `IP_DOUBLE_AD` 驱动（两段等比：门槛前 ×10、门槛后 ×1e10、封顶 1e300）
//   ⇒ 旧数组的三个字段（`from`/`growth`）已无读取方，整段删除（避免两套价格并存 ✗）

/**
 * 「量子铸币」的实际收益：`floor(本次无限最大量子数²)`。
 * 没买这条就是 0（所以它是"买断才有"的一次性收益）。
 */
export function quantumToIPGain(state) {
  if (!state.infinityFromQuantumBought) return new Decimal(0);
  const q = state.peakQuantumRun ?? 0;
  const n = q instanceof Decimal ? q : new Decimal(q);
  return n.mul(n).floor();
}

/**
 * ① 的**下一级价格**（log10）。
 *
 * ★★★ 2025（用户裁定）：「无限增幅的初始价格不应该就是 1 无限点（购买时 1 级）么？
 *   然后每 2 级为 10 无限点花费，3 级 100 点（以此类推）」
 *   ⇒ 价格序列：`1（第1级）→ 1（第2级）→ 10 → 100 → 1000 …`
 *     即第 1 级 **1 点**（开局买得起），第 2 级 1 点，之后每级 ×10 ✓
 *
 *   ⚠️ 原实现（照抄 AD）是 `10^(count+1)` ⇒ 首价 **10** ⇒ 用户报
 *      「无限增幅开局买不了？…打破无限本身也要 128 点」⇒ 10 点开局确实难凑 ✗
 *   ⚠️ 门槛之后仍是 AD 的 `门槛 × 1e10^超出`（用户：「后续的阈值我不管你，因为符合预期」）✓
 */
export function ipDoubleLogCost(level) {
  const n = Math.max(0, Number(level) || 0);
  // ★ 第 1 级（count=0）：固定 1 点（用户裁定）
  if (n <= 0) return 0;                                                // 10^0 = 1 ✓
  const inc = IP_DOUBLE_AD.purchasesAtIncrease;
  // ★ 第 2 级起：`10^(n−1)` ⇒ n=1→1、n=2→10、n=3→100 …（与用户给的序列一致 ✓）
  if (n < inc) return Math.log10(10) * (n - 1);
  const thr = IP_DOUBLE_AD.costIncreaseThreshold.log10().toNumber();
  return thr + (n - inc) * Math.log10(1e10);                           // AD: 门槛 × 1e10^超出
}

/**
 * ① 的**真实单级价格**（Decimal）。
 *
 * ⚠️ 为什么必须单独有它（不能到处写 `10^ipDoubleLogCost(lv)`）：
 *   上面的 log 形式**表达不了第 1 级的 1 点**（`10^0 = 1` 恰好对，但
 *   `ipDoubleAffordableIn` 里还要拿"本级价格"做等比数列求和，写两遍必错 ✗）
 *   ⇒ 单一实现，求和处一律调它 ✓
 */
export function ipDoublePriceAt(level) {
  const n = Math.max(0, Number(level) || 0);
  // 第 1 级固定 1 点；其余走 `10^log`（`n=0` 时 log 也是 0 ⇒ 1，两条一致 ✓）
  return new Decimal(10).pow(ipDoubleLogCost(n));
}

/**
 * ★★★ 2025 终稿（用户裁定 **方案甲**）：**引擎等级对「量子加成」的乘数**。
 *
 *   ── 形状：与「引擎累计价」同速（不是与等级同速）──
 *     `engineBonusMult(lv) = Σprice(0→lv) / Σprice(0→基准级)`
 *
 *   ── 为什么不是 `bonusGrowth^等级`（我上一版，实测失败 ✗）──
 *     那版每级只给 ×1.22（`ZPE_ENGINE.bonusGrowth`），而价格每级 ×1.872
 *     ⇒ **收入涨得比价格慢** ⇒ 引擎停在 116 级再也买不起（实测：每轮收入 1e30 vs 下一级价 1e32）✗
 *
 *   ── 为什么"与累计价同速"能自付（这是甲的核心）──
 *     买下一级要付 `price(lv)`；而付完之后乘数变成 `Σ(0→lv+1)/Σ(0→基准)`
 *     ⇒ 乘数**相对**增加 `1 + price(lv)/Σ(0→lv)` —— 恰好是"你刚付掉的那笔占累计的比例"
 *     ⇒ 收入按同比例上升 ⇒ **这一笔买卖恰好自付** ⇒ 等级可以一路涨 ✓
 *
 *   ── 用户提醒的代价（2025 原话）──
 *     「越过满速阈值后，后续生效的强度和等级的比例，需要更多等级才能 = 未越过阈值时的比例」
 *     即：价格是**指数**的（`×costGrowth`/级）⇒ 后期**每级越来越贵**，
 *     而乘数按累计价同速涨 ⇒ **同等"强度增量"需要越来越多的等级** ✓ 这是有意的（软上限语义）。
 *
 *   ── 落点：**乘在量子加成上**（用户裁定"全部"）──
 *     量子 → 熵 / 暗能量倍率 / 暗能量获得 / ZPE加法区 / IP 收入 五条**全部**乘它。
 *     ⚠️ 但**不在 `config.js` 的 5 个函数体内乘**（它们只收 `quantum` 参数、拿不到 state；
 *        且在体内乘会让 `audit.mjs` 的 `quantumDeMultBonus(q)===10000` 类断言失效、
 *        并污染 UI 量子面板的显示）⇒ 在 `formulas.js` 的**调用处**乘 ✓
 */
export function engineBonusMult(state) {
  const lv = Math.max(0, Number(state?.zpeEngineLevel ?? 0) || 0);
  const base = Math.max(1, Number(ZPE_ENGINE.bonusBaseLevel ?? 1) || 1);
  if (lv <= base) return new Decimal(1);           // 低于基准级 ⇒ 恒 1（零回归 ✓）
  const denom = zpeEngineTotalCost(0, base);
  if (!denom.gt(0)) return new Decimal(1);
  return zpeEngineTotalCost(0, lv).div(denom);
}

/**
 * ① 的等级上限探针：给定池子能买几级。
 *
 * ★★★ 2025 重写（用户裁定改了首价序列之后）：
 *   用户的价格序列是 `1 → 1 → 10 → 100 → …` —— **第 1 级 1 点是个特例**
 *   （`10^(n−1)` 在 n=0 处是 0.1，不是 1）⇒ 任何"纯等比闭式"都会错。
 *   ⚠️ 我在这里**错了两次**（先 `/9` 后 `/90`，再想用 `/9` 反解 k）——
 *      根因都是"把带特例的序列当成纯等比" ✗
 *
 *   ⇒ 现在改成**两段式**，不再推导新公式：
 *     ① **解析求上界** `kUB`（把序列当纯等比 `10^(n−1)`，首项取本级价格）—— 只会**高估**
 *     ② 从 `kUB` **逐级阶梯回退**直到累计价 ≤ 池子 ⇒ **保证精确** ✓
 *       回退步数：首价有偏差时最多差 1~2 级 ⇒ 实际上近 O(1) ✓
 *     （步长 ≤ 30 级，`ipDoublePriceAt` 是幂运算，开销可忽略）
 */
export function ipDoubleAffordableIn(level, poolDecimal) {
  const lv0 = Math.max(0, Number(level) || 0);
  const inc = IP_DOUBLE_AD.purchasesAtIncrease;
  const cap = IP_DOUBLE_AD.costCap;
  // ── 第 1 段：只用"门槛以下"的池子（照抄 AD 的 `clampMax(costIncreaseThreshold)`）──
  let pool = poolDecimal;
  let lv = lv0;
  let total = 0;
  if (lv < inc) {
    const usable = Decimal.min(pool, IP_DOUBLE_AD.costIncreaseThreshold);
    const upper = Math.max(0, inc - lv);
    // ① 解析上界：把序列当纯等比（首项 A = 本级价/10，比值 10）
    //    A·(10^k − 1)/9 ≤ usable ⇒ 10^k ≤ usable·9/A + 1
    const A = ipDoublePriceAt(lv).div(10);
    let k = A.gt(0) && usable.gte(ipDoublePriceAt(lv))
      ? usable.mul(9).div(A).add(1).log10().floor().toNumber()
      : 0;
    k = Math.max(0, Math.min(k, upper));
    // ② 阶梯回退到真实可行值（**精确**：逐级用真价格累加）
    while (k > 0) {
      let sum = new Decimal(0);
      for (let i = 0; i < k; i++) sum = sum.add(ipDoublePriceAt(lv + i));
      if (sum.lte(usable)) { pool = pool.sub(sum); total += k; lv += k; break; }
      k--;
    }
  }
  // ── 第 2 段（陡指数 ×1e10）── 直到封顶；这一段是**纯等比**，闭式即可 ✓
  if (lv >= inc) {
    const first = ipDoublePriceAt(lv);
    const g = new Decimal(1e10);
    if (pool.gte(first) && first.lt(cap)) {
      const k = pool.mul(g.sub(1)).div(first).add(1).log10().div(10).floor().toNumber();
      const beforeCap = Math.max(0, Math.ceil(
        cap.log10().sub(ipDoubleLogCost(lv)).div(10).toNumber()));
      const span = Math.max(0, Math.min(k, beforeCap));
      // 同样做一次**精确校验**（封顶边界处闭式会偏 ✓）
      let ok = span;
      while (ok > 0) {
        let sum = new Decimal(0);
        for (let i = 0; i < ok; i++) sum = sum.add(ipDoublePriceAt(lv + i).min(cap));
        if (sum.lte(pool)) break;
        ok--;
      }
      total += ok;
    }
  }
  return total;
}

/**
 * ① 从当前级买 `k` 级的**总价**。
 *
 * ★★★ 2025（用户裁定改了首价序列）：**不再手抄等比求和**，改为
 *   **逐级累加 `ipDoublePriceAt`**（单一实现 ✓）。
 *
 *   ── 为什么放弃"分段等比公式"（原来那套）──
 *     它把序列形状（`10^(n+1)`）**又抄了一遍**（`div(9)` / `g=10` / 段边界），
 *     而首价一改（`10^(n−1)`）就得同步改三处系数 ⇒ 我当场就把 `div(9)` 抄错了 ✗
 *     （"同一个公式写两遍 ⇒ 显示/计算脱节"是这个项目的**头号病根**）
 *   ── 代价 ──
 *     只能在**需要具体总价**时用（例：UI 显示"买满要花多少"）。
 *     而"能买几级"走 `ipDoubleAffordableIn`（解析闭式，快）⇒ 两条路各司其职 ✓
 *     `k` 在这里只可能来自"买满按钮刚算出的级数"（≤ 门槛级数），量级很小 ✓
 */
export function ipDoubleCostFor(state, k) {
  const n = Math.max(0, Number(k) || 0);
  if (n <= 0) return new Decimal(0);
  const lv = Math.max(0, Number(state?.ipDoubleLevel ?? 0) || 0);
  const cap = IP_DOUBLE_AD.costCap;
  let total = new Decimal(0);
  for (let i = 0; i < n; i++) {
    const c = ipDoublePriceAt(lv + i);
    if (c.gte(cap)) break;                 // 撞封顶 ⇒ 后面不再涨（与 AD 的 costCap 同义）
    total = total.add(c);
  }
  return total;
}

/** 铸币等级上限（**档位闸门**：大坍缩次数 × 每档放行级数） */


/** 铸币等级 */


/** 铸币对**所有无限点收入**的倍率：`m^等级` */


/** 铸币第 N 级的价格（log10，分段软上限） */


/** 铸币下一级价格 */


/**
 * 铸币能买几级（**同时受档位闸门与软上限约束**）。
 * 闸门优先：`min(闸门剩余, 池子买得起的级数)`。
 */


/** 铸币总价（从 from 买到 to，Decimal） */


/**
 * ★ 档位里程碑（挂在**大坍缩次数**上）
 *
 * 设计意图（用户定的 24h → 18h）：
 *   总时长 = 档数 × 每次大坍缩耗时，而**每档兑现的阶数由 `capPerCrunch` 决定**。
 *   所以"档数压缩"不是把档数直接改小，而是**让每档上限随进度爬升**：
 *   30 → 33 → 36 → 41 → 46 ⇒ 同样的 306 阶需要的档数变少 ⇒ 阶梯自然压缩到 ~18 档。
 *
 * 另外两条：
 *   · `rate` —— 成长速率里程碑（每次大坍缩更快，与「速率解放」共用一个入口 `infinityRateMult`）；
 *   · `lube` —— **量子润滑（保守版）**：把量子门槛步长从 ×20 缓到 ×19.5。
 *     判据：`tools/crunch-speed-lab.mjs` 的 ⑦ 行显示"量子不足"惩罚很重（36.9h），
 *     所以先给一点点缓和；若实测仍然严重，再按用户说的"回到原方案"（给更多）。
 */
export const TIER_MILESTONES = [
  /**
   * ⚠️ 2025：原来 7 条里有 **4 条是 `kind:"cap"`（"铸币每档上限 +N"）** ——
   *   铸币整个删除后它们是**死数据**（`cap` 没有任何读取方），
   *   而 UI 会把 `desc` 原样显示给玩家 ⇒ 面板上写着"铸币每档上限 +3"这种不存在的机制 ✗
   *   ⇒ 用户要求"赶紧把无限子页面的东西改了" ⇒ 这 4 条改成**已经接线**的 `lube`：
   *     `tierQuantumStepMult()` 里 `k = 1 − Σ(value/20)/2` —— 把量子门槛步长从 ×20 缓到 ×19.5 那一族，
   *     落在「打破无限 → 永恒」那段的承重机制上（量子来得更早 ⇒ 跨度幂 k 与 b 都更早起来）✓
   */
  { at: 3, id: "tm-lube1", kind: "lube", value: 0.5, desc: "量子润滑：门槛步长 ×20 → ×19.5" },
  { at: 6, id: "tm-rate1", kind: "rate", value: 1.05, desc: "成长速率 ×1.05" },
  { at: 9, id: "tm-lube2", kind: "lube", value: 0.5, desc: "量子润滑：门槛步长再缓一档（→ ×19.0）" },
  { at: 12, id: "tm-lube3", kind: "lube", value: 0.5, desc: "量子润滑：门槛步长再缓一档（→ ×18.5）" },
  { at: 15, id: "tm-rate2", kind: "rate", value: 1.05, desc: "成长速率 ×1.05（累计 ×1.1025）" },
  { at: 18, id: "tm-lube4", kind: "lube", value: 0.5, desc: "量子润滑：门槛步长再缓一档（→ ×18.0）" },
  { at: 24, id: "tm-lube5", kind: "lube", value: 0.5, desc: "收尾：量子润滑再来一档（→ ×17.5）" },
];

/** 已解锁的档位里程碑（大坍缩次数 ≥ at） */
export function tierMilestonesDone(state) {
  const n = state.bigCrunchCount instanceof Decimal ? state.bigCrunchCount.toNumber() : Number(state.bigCrunchCount) || 0;
  return TIER_MILESTONES.filter((m) => n >= m.at);
}

/** 铸币**每档上限**（基础 30 + 里程碑累加）—— 档数压缩就是靠它 */


/** 档位里程碑给的成长速率倍率（并入 infinityRateMult，保持单一入口） */
export function tierRateMult(state) {
  let m = 1;
  for (const x of tierMilestonesDone(state)) if (x.kind === "rate") m *= x.value;
  return m;
}

/** 档位里程碑给的"量子润滑"：门槛步长的额外倍率（1 = 无缓和） */
export function tierQuantumStepMult(state) {
  let k = 1;
  for (const m of tierMilestonesDone(state)) if (m.kind === "lube") k *= 1 - m.value / (state && hasCollapse(state, "cm7") ? 22 : QUANTUM.zpeCostGrowth) / 2;
  return k;
}

/**
 * ★ 永恒层（先占位：只有门槛与永恒点公式，内容待设计）
 *
 * 永恒点公式**照 AD 抄**（`src/core/secret-formula/multiplier-tab/eternity-points.js`）：
 *
 *   AD: `DC.D5.pow( log10(maxIP) / (308 − Pelle) − 0.7 )`
 *   即  **永恒点 = floor( 5^(log10(IP)/308 − 0.7) )**
 *
 * 代入门槛验算：`5^(308.25/308 − 0.7) = 5^0.3008 = 1.62` → floor = **1 点** ✓
 * （AD 第一次永恒也正好给 1 点，手感一致。）
 *
 * ⚠️ 两条与物质层**刻意不同**的地方（用户指定）：
 *   1. 永恒点只由 **无限点**决定，与物质深度无关；
 *   2. **没有**「到 1e308.25 强制坍缩」那种硬顶机制 —— 永恒是**手动**触发的，
 *      到了门槛不会自己重置（强制坍缩只存在于物质层）。
 */
export const ETERNITY = {
  /**
   * 门槛：**无限点 1e280** —— 用户指定（比 AD 的 1.79e308 更早解锁「永恒」按钮）。
   *
   * 为什么提前不破坏收益公式：`5^(280/308 − 0.7) = 1.40 → floor = 1`，
   * 与在 1e308.25 处（1.62 → 1）**同样是 1 点**。所以提前只是让玩家早点看到按钮，
   * 不改 AD 同源的那条曲线。
   */
  goalLog10: 280,
  /** 底数 5 */
  base: 5,
  /** 公式除数 308（AD 用整数 308，不是 308.25） */
  divisor: 308,
  /** 指数偏移 0.7 */
  offset: 0.7 };

/** 能不能永恒（门槛 = 无限点 1e280） */
export function canEternity(state) {
  return (state.infinityPoints ?? 0).gte(new Decimal(10).pow(ETERNITY.goalLog10));
}

// ══════════════════════════════════════════════════════════
// ★★★ 2025 新实现（第三层设计稿 33~35 行）：**永恒升级面板**
// ══════════════════════════════════════════════════════════
// 设计稿原文：
//   「永恒升级面板：将最终获得的永恒点 *5（价格初始 1ep，每次购买后 *5）」
//
// ⚠️ 实现纪律（本项目最贵的一课）：**价格与效果各只有一处实现**
//   · 价格 → `epMultPriceAt(level)`（唯一入口；UI 与实发都调它）
//   · 效果 → `epMultFactor(state)`（唯一入口；`doEternity` 与 UI 都调它）
//   同一条公式写两遍 ⇒ 就是"显示 ≠ 实发"的头号成因 ✗（本项目已踩过 4 次）
// ══════════════════════════════════════════════════════════
export const ETERNITY_UPGRADES = {
  /**
   * `epMult`：**最终获得的永恒点 ×5/级**（可重复购买）。
   *
   * · 效果：`5^等级`（乘在 `eternityPointGain` 的**最终结果**上 —— 设计稿说"最终获得的"）
   * · 价格：`1 × 5^等级`（初始 1ep ⇒ 第 1 级 1ep、第 2 级 5ep、第 3 级 25ep…）
   *   与 AD 的永恒升级同形（初始 1、每买一次 ×5）✓
   */
  epMult: {
    id: "epMult",
    name: "永恒增幅",
    repeatable: true,
    /** 效果底数（每级 ×5） */
    effectMult: 5,
    /** 价格底数（每级 ×5） */
    costMult: 5,
    /** 初始价格（1 永恒点） */
    baseCost: 1,
    /** 价格封顶（防 `5^等级` 溢出成 Infinity ⇒ 与 ipDouble 同一套保护） */
    costCap: new Decimal("1e300"),
    desc: "最终获得的永恒点 ×5/级",
  },
};

/**
 * `epMult` 的**下一级价格**（唯一的实现 ✓）。
 *
 * ⚠️ 2025 修正**浮点漂移**：原来用 `Decimal.pow(5, n)` 逐级算 ⇒
 *   n=2 时给 `25.000000000000007`（5² 的 Decimal 实现有误差）✗
 *   价格是玩家天天看的数字，`25.000000000000007` 不能忍 ⇒
 *   改成 `5^n` 的**整数幂**：`n` 是整数且 ≤ 数百 ⇒ 直接 `Math.pow` 得到精确值，
 *   只有 n 大到超过安全整数范围时才退回 Decimal。
 */
export function epMultPriceAt(level) {
  const n = Math.max(0, Number(level) || 0);
  const cfg = ETERNITY_UPGRADES.epMult;
  // `5^300 ≈ 1e209` ⇒ n 在 0~300 内都是精确可表示的整数幂（Math.pow 对整数底数/指数精确）
  if (n <= 320) {
    const v = cfg.baseCost * Math.pow(cfg.costMult, n);
    return new Decimal(v).gt(cfg.costCap) ? cfg.costCap : new Decimal(v);
  }
  const p = new Decimal(cfg.baseCost).mul(new Decimal(cfg.costMult).pow(n));
  return p.gt(cfg.costCap) ? cfg.costCap : p;
}

/**
 * `epMult` 的**当前效果**（唯一的实现 ✓）—— 未买恒 1（零回归 ✓）。
 *
 * ⚠️ 同样修**浮点漂移**（与 `epMultPriceAt` 同一个病）：
 *   `Decimal.pow(5, 2)` 给 `25.000000000000007` ✗ —— 而这是玩家看的倍率数字。
 *   等级是整数且实际到不了几百 ⇒ 用精确的整数幂 ✓
 */
export function epMultFactor(state) {
  const lv = Math.max(0, Number(state?.epMultLevel ?? 0) || 0);
  if (lv <= 0) return new Decimal(1);
  if (lv <= 320) return new Decimal(Math.pow(ETERNITY_UPGRADES.epMult.effectMult, lv));
  const v = new Decimal(ETERNITY_UPGRADES.epMult.effectMult).pow(lv);
  return v.isFinite() ? v : new Decimal(Number.MAX_VALUE);
}

/** 给定池子能买几级 `epMult`（闭式：`1·(5^k − 1)/4 ≤ pool`） */
export function epMultAffordableIn(level, poolDecimal) {
  const n = Math.max(0, Number(level) || 0);
  const cfg = ETERNITY_UPGRADES.epMult;
  const g = Number(cfg.costMult);
  const first = epMultPriceAt(n);
  const pool = poolDecimal instanceof Decimal ? poolDecimal : new Decimal(poolDecimal ?? 0);
  if (!pool.gte(first)) return 0;
  // Σ first·(g^k − 1)/(g − 1) ≤ pool  ⇒  g^k ≤ pool·(g−1)/first + 1
  const k = pool.mul(g - 1).div(first).add(1).log10().div(Math.log10(g)).floor().toNumber();
  if (!Number.isFinite(k) || k < 1) return 0;
  // 封顶保护：价格撞 costCap 后不再涨 ⇒ 后面的级数没有意义，截断
  const capLv = Math.max(0, Math.floor(cfg.costCap.log10().toNumber() / Math.log10(g)) + 1);
  return Math.max(0, Math.min(k, capLv - n));
}

/**
 * ★★ 2025：**永恒里程碑**（用户设计稿 `第三层设计.txt` 第 36~44 行，逐条对应）
 *
 * ── 解锁条件 ──
 *   **按永恒次数**（用户 2025 裁定）：`need` = 需要永恒几次。
 *   所以第 N 次永恒之后，前 N 条一起生效。
 *
 * ── 现状（2025 本轮）──
 *   用户指定的范围：「**先做能完整落地的，剩下的先做个占位**」。
 *   · 已完整落地：`em1` `em3` `em6`
 *   · 占位（`pending: true`）：`em2`（等 Neko）/ `em4`（等暗物质）/ `em5` `em7` `em8`
 *
 * ⚠️ **不要只加条目不加 `pending`** —— `tools/eternity-lab.mjs` 会断言
 *   "标了 pending 的条目必须在 UI 上显示为待办"，避免玩家以为拿到了却没效果 ✗
 */
export const ETERNITY_MILESTONES = [
  {
    id: "em1",
    need: 1,
    desc: "每次永恒后保留非重复购买的无限升级（每 2 次永恒保留 1 个）",
    /**
     * 保留几个非重复 ∞ 升级 = `floor(永恒次数 / 2)`。
     * 选取规则：按 `INFINITY_ORDER` 的**倒序**（该数组大体是从便宜到贵）⇒ 保留**最贵**的那些，
     * 因为越贵的越难重新买回来、保留价值越高。
     */
    effect: { kind: "retainInfinity", per: 2 } },
  {
    id: "em2",
    need: 2,
    desc: "neko 系统提供的全局加成效果翻倍",
    pending: true,
    pendingWhy: "neko / 好感度系统尚未上线（设计稿第 23、38 行）" },
  {
    id: "em3",
    need: 3,
    desc: "宇宙涨落获得量子时不再重置 ZPE",
    pending: false },
  {
    id: "em4",
    need: 4,
    desc: "优化暗能量获取公式，并解锁暗物质与第二个相变仪",
    pending: true,
    pendingWhy: "暗物质 / 第二个相变仪尚未实现（设计稿第 50~52 行）" },
  {
    id: "em5",
    need: 5,
    desc: "永恒点数量能倍增无限点数量",
    effect: { kind: "ipMultByEpLog" } },
  {
    id: "em6",
    need: 6,
    desc: "熵到粒子的熵消耗再除以 1.2",
    effect: { kind: "entropyCostDiv", value: 1.2 } },
  {
    id: "em7",
    need: 7,
    desc: "无限挑战将基于最快无限速度自动依次完成 7 次（无视条件）",
    pending: true,
    pendingWhy: "无限挑战目前是 3 关且需手动；「按最快无限速度自动完成」依赖 IC 阶梯定稿（见 INFINITY_CHALLENGES）" },
  {
    id: "em8",
    need: 8,
    desc: "解锁永恒自动化页面",
    pending: true,
    pendingWhy: "永恒自动化页面尚未实现（设计稿第 44 行）" },
];

/**
 * 该永恒里程碑是否已达成（`eternityCount >= need`）。
 *
 * 注意与 `pageUnlocked` 的区别：那是**页面**解锁的永久记录；这里是**里程碑达成**。
 * 两者都永不重置，但判定源不同（这里读永恒次数，永恒次数本来就永久保留 ✓）。
 */
export function hasEternityMilestone(state, id) {
  const m = ETERNITY_MILESTONES.find((x) => x.id === id);
  if (!m) return false;
  return (state?.eternityCount ?? 0) >= m.need;
}

/** 已达成且**已实装**的永恒里程碑（`pending` 的不算，供效果读取方使用） */
export function eternityMilestonesActive(state) {
  return ETERNITY_MILESTONES.filter((m) => !m.pending && hasEternityMilestone(state, m.id));
}

/** 永恒里程碑的显示顺序（UI 与 lab 共用） */
export const ETERNITY_MILESTONE_ORDER = ETERNITY_MILESTONES.map((m) => m.id);

/**
 * ★★ 2025 em5：**永恒点倍增无限点** —— `IP 收益 ×(1 + log10(累计永恒点))`
 *
 * ── 口径选择（用户 2025 裁定：**口径④**）──
 *   设计稿只写「永恒点数量能倍增无限点数量」，没写公式。候选里：
 *     · ① `M ×= 累计EP`      ⇒ **发散反馈环** ✗
 *     · ② `M ×= 10^累计EP`   ⇒ 第 22 轮就溢出 `Infinity` ✗
 *     · ④ `M ×= (1+log10(累计EP))` ⇒ 每轮增长因子**有界**（趋于常数）⇒ 只是指数增长 ✓
 *   实测（`tools/eternity-lab.mjs --check` 有断言）：
 *     IP 越深 → EP 越多 → M 越大 → 下一轮更深 是**闭环**，
 *     而 `EP = 5^(log10(IP)/308−0.7)` 提供了阻尼（IP 每 ×10，EP 只涨 ~1.1%）。
 *     ①② 的增长率会**逐轮递增**（双指数）⇒ 环失控；④ 的增长率有界 ⇒ 安全。
 *
 * ⚠️ 读的是 **`eternityPointsTotal`（累计）**，不是当前持有 ——
 *   否则买永恒升级花掉 EP 会让这个加成反复丢失（见 state.js 的字段说明）。
 * ⚠️ 有界性来源：`1 + log10(x)` 随 x 只**对数**增长 ⇒ 不进 runaway 池 ✓
 */
export function em5IpMult(state) {
  if (!hasEternityMilestone(state, "em5")) return new Decimal(1);
  const total = state?.eternityPointsTotal ?? new Decimal(0);
  const l = total.gt(1) ? total.log10() : new Decimal(0);
  return new Decimal(1).add(l.max(0));
}

/**
 * 本次永恒能拿多少永恒点（纯函数，UI 与断言共用）。
 *
 * @param {Decimal} infinityPoints
 * @returns {Decimal} 不到门槛就是 0
 */
export function eternityPointGain(infinityPoints) {
  if (infinityPoints.lt(new Decimal(10).pow(ETERNITY.goalLog10))) return new Decimal(0);
  const ep = new Decimal(ETERNITY.base).pow(
    infinityPoints.log10().div(ETERNITY.divisor).sub(ETERNITY.offset),
  ).floor();
  return ep.lt(1) ? new Decimal(1) : ep;   // 门槛处正好 1 点，兜底防止浮点掉到 0
}

/**
 * 引擎价格的 **log10**（分段几何，闭式）。
 *
 * 分段的意义：每段内是等比数列，段与段之间是**乘性跳变**，所以整体仍是闭式 ——
 * 「买满」不需要逐级循环。
 */

/** ZPE 引擎是否已解锁 */
export function zpeEngineUnlocked(state) {
  return state.zpeEngineUnlocked === true;
}

/** 引擎等级（没解锁就是 0） */
export function zpeEngineLevel(state) {
  const lv = state.zpeEngineLevel ?? 0;
  return lv instanceof Decimal ? lv : new Decimal(lv);
}

/**
 * 下一级的价格（无限点）。**解锁本身不花无限点**（走「1 次大坍缩」里程碑，见 engine.js）。
 *
 * ★★★ 2025 **价格形状重设计（用户裁定）**：三次方 → **指数**。
 *
 *   ── 为什么必须换成指数 ──
 *     旧式 `base·(L+1)³` 的**累计价 ∝ L⁴** ⇒ `级数 ∝ 池^0.25`
 *     ⇒ 池子每涨 4 阶，能买的级数就**翻倍** ⇒ 永远追不上 ⇒ 实测买到 **2.4 亿级** ✗
 *     而且"首价可读"与"满级价格刚好卡住"**在幂次形状下不可兼得**：
 *       要让 1e28 池恰好只买 ~2000 级，反解出 `base ≈ 2.5e15` ⇒ **1 级价 2.5e15** ✗
 *   ⇒ 指数：`级数 ∝ log(池)` ⇒ 池涨 8 阶、级数只涨几百 ⇒ **步长真正被控制住** ✓
 *     而且首价就是一个**独立可读**的数（= `baseCostIp`），不会变成 1e-5 ✗
 *
 *   ── 标定（用户裁定：**1e28 池 ≈ 100 级**）──
 *     `cost(L) = c0 · r^L`（L = 当前等级 ⇒ 第 L+1 级）
 *     累计到 100 级：`c0·(r^100 − 1)/(r − 1) = 1e28`
 *     取 `c0 = 5` ⇒ 反解 `r = 1.60`
 *     ⇒ 1e28 池 → **100 级**｜1e40 池 → 144 级｜1e100 池 → 342 级 ✓（全程可读）
 */
export function zpeEngineCost(state) {
  const c0 = new Decimal(ZPE_ENGINE.baseCostIp);
  const r = new Decimal(ZPE_ENGINE.costGrowth);
  return c0.mul(r.pow(zpeEngineLevel(state)));
}

/**
 * 从 `from` 买到 `to` 的总价（**Decimal**，等比闭式）。
 *
 * ⚠️ 段与段之间是**相加**（同一笔钱买多级），不是相乘 —— 第一版我把每段的和取 log
 *    再相加，那等于把各段乘起来（价格虚高几个量级）。这里用 Decimal 相加。
 *
 * 等比求和：`c0 · r^from · (r^(to−from) − 1) / (r − 1)`
 */
export function zpeEngineTotalCost(from, to) {
  const c0 = new Decimal(ZPE_ENGINE.baseCostIp);
  const r = new Decimal(ZPE_ENGINE.costGrowth);
  const a = new Decimal(from), b = new Decimal(to);
  const n = b.sub(a);
  if (n.lte(0)) return new Decimal(0);
  return c0.mul(r.pow(a)).mul(r.pow(n).sub(1)).div(r.sub(1));
}

/**
 * 从当前等级起，给定无限点池**最多能买几级**（等比闭式反解）。
 *
 * 反解：`pool ≥ c0·r^lv·(r^k − 1)/(r − 1)`
 *   ⇒ `k = floor( log_r( 1 + pool·(r−1) / (c0·r^lv) ) )`
 */
export function zpeEngineAffordableIn(state, poolDecimal) {
  if (!zpeEngineUnlocked(state)) return 0;
  const c0 = new Decimal(ZPE_ENGINE.baseCostIp);
  const r = new Decimal(ZPE_ENGINE.costGrowth);
  const lv = zpeEngineLevel(state);
  if (poolDecimal.lte(0)) return 0;
  // 1 + pool·(r−1)/(c0·r^lv)
  const inner = poolDecimal.mul(r.sub(1)).div(c0.mul(r.pow(lv))).add(1);
  if (inner.lte(1)) return 0;
  const k = inner.log10().div(r.log10()).floor();
  return k.max(0).toNumber();
}

/**
 * ② 引擎对 ZPE 产出的倍率。
 *
 * ★★ 2025「甲方案」（用户选定）：**全部改多项式**。
 *
 *   原案「每级 ×10」（`10^等级` ✗）在"破∞时已 944 级"的起跑线上**是几秒钟走完** ✗
 *   （拉表：`tools/` 的两方案对照 ⇒ 封顶到 3 级都还是 0.00h ✗）
 *   根因（数学判据）：**任何指数形式**（`10^等级` / `2^等级` / `2^√等级` ✗）都会让
 *     `∫dx/FORM(x)` 收敛 ⇒ **有限时间爆炸** ✗；只有**多项式**（线性/开根）发散 ⇒ 安全 ✓
 *   ⇒ 改成 `1 + 0.01·√等级`（开根 ✓，与倍率项同一族）
 */
/**
 * 第三种设计稿（用户 2025）· 引擎机制的**第 5 条**：
 *   「zpe 引擎将基于自身提供的倍数，提升**前 8 个虚空升级的效果**」
 *
 *   voidBoostMult = 1 + VOID_BOOST.coeff × log10(引擎倍率)
 *
 * 为什么用**对数**（不是直接乘）：
 *   · 引擎倍率现在最大可达 ~1e75（三次方价格下，等级 ~9.46e76）
 *   · 若线性乘进虚空升级 ⇒ 立刻重演 runaway（判据不允许指数链）
 *   · 对数 ⇒ 1e75 只给 ×(1 + 0.1×75) ≈ ×8.5 —— 强、有界、判据安全
 *   · 引擎未解锁/等级 0 ⇒ 倍率 = 1 ⇒ log10 = 0 ⇒ boost = 1 ⇒ **零回归**
 */
export function voidBoostMult(state) {
  const m = zpeEngineMultBonus(state);
  const lg = m.lte(1) ? 0 : m.log10().toNumber();
  return 1 + VOID_BOOST.coeff * Math.max(0, lg);
}

/**
 * ★★ 2025（用户裁定）：**引擎的每条机制各有「内部终点」** —— 引擎整体无上限，但内部机制各自封顶。
 *
 *   用户原话：「**没有终点，但内部的机制可以拥有终点**（这也就是为什么引擎并不像 AD 中星系
 *   直接单纯增幅计数频率强度那样只有一个机制，而是多个机制）」
 *
 *   ⇒ 也就是：每条机制走**饱和式** `1 + A·x/(1+x)`（`x = 等级/knee`），
 *     各自的 `knee` **错开** ⇒ 形成"早期吃①、中期吃②、后期吃⑤"的**排期** ✓
 *     这正是"多机制"相对 AD 单机制的优势：不会所有加成同时饱和。
 *
 *   ⚠️ ①④ 原来是**线性**（`1+lv` / `1+0.1lv`，真无界）⇒ 本次改成饱和式。
 *     ②②b 原来是开根（`1+0.0X·√lv`，增长极慢、2000 级才 1e0.16/1e0.51 ⇒ 名义机制）
 *     ⇒ 本次把系数提到可感知量级。
 */
export const ENGINE_MECH = {
  /** ① ZPE 倍率**加法区**：`1 + A·x/(1+x)`，`x = 等级/knee`
   *  ★ H3（2025 终稿）：knee `200 → 20` —— 与 `MATTER_B_KNEE = 100` 的标度对齐
   *    （100 级时 ① 充满 `100/20 / (1+100/20) = 83.3%` ⇒ 机制已有实质强度 ✓）*/
  add: { A: 200, knee: 20 },
  /** ② ZPE **产出倍率**：开根（本身即"实际到顶"形状） */
  prod: { coeff: 0.02 },
  /** ②b ZPE/暗能量**乘算倍率**：开根 */
  mult: { coeff: 0.15 },
  /** ④ **暗能量自增长**倍率：`1 + A·x/(1+x)`；比 ① 敏感 ⇒ knee 更晚、A 更小
   *  ★ H3：knee `500 → 40`（100 级时充满 71.4%）*/
  de: { A: 20, knee: 40 },
};

/** 饱和式辅助：`1 + A·x/(1+x)`，x = lv/knee */
function saturate(A, lv, knee) {
  const x = Math.max(0, lv) / Math.max(1e-9, knee);
  return new Decimal(1).add(new Decimal(A).mul(x / (1 + x)));
}

export function zpeEngineProdMult(state) {
  if (!zpeEngineUnlocked(state)) return new Decimal(1);
  const lv = effectiveEngineLevel(state);            // ★ 唯一入口（IC 修饰器可压低 ✓）
  // ② 产出倍率 —— 开根形状（增长极慢 ⇒ 天然"实际到顶"）
  return new Decimal(1).add(lv.pow(0.5).mul(ENGINE_MECH.prod.coeff));
}

/**
 * ① 引擎给 `zpeMultiplier` 的**加法区额外倍率**（a区）。
 *
 * ★ 2025 设计稿（用户）第 1 条：**不再抬公式指数**（旧版 `+0.002/级` ✗），
 *   改成"加法区的额外倍率" —— 与「零点耦合」同一写法：`m = m.add(项)` ✓
 *
 * ★★ 2025 二次修订：改成**饱和式** `1 + A·x/(1+x)`（见 `ENGINE_MECH` 的说明）——
 *   原来是 `等级 × 1`（线性 ⇒ 真无界 ✗），与"内部机制可以有终点"的主张冲突。
 */
export function zpeEngineAddBonus(state) {
  if (!zpeEngineUnlocked(state)) return new Decimal(0);
  const lv = effectiveEngineLevel(state).toNumber();
  if (!Number.isFinite(lv) || lv <= 0) return new Decimal(0);
  // 返回的是「加法项」= 饱和值 − 1（调用方是 `m = m.add(...)`）
  return saturate(ENGINE_MECH.add.A, lv, ENGINE_MECH.add.knee).sub(1);
}

/**
 * ②b 引擎给 `zpeMultiplier` 与**暗能量倍率**的**乘算倍率**（同一函数两处用 ✓）。
 *
 * ★★ 2025「甲方案」：原案「每级 ×2」⇒ `2^等级` ✗ —— 与 `10^等级` 同一个病：
 *   指数形式 ⇒ 积分收敛 ⇒ **有限时间爆炸** ✗（拉表：等级 276 时 ×1e83 ✗）
 *   ⇒ 改成 `1 + 0.05·√等级`（开根 ✓）
 *     系数 0.05 由「破∞ → 永恒 = 6 小时」的目标反解得出 ✓
 *     （见 `tools/post-break-engine-lab.mjs` 与两方案对照表）
 */
export function zpeEngineMultBonus(state) {
  if (!zpeEngineUnlocked(state)) return new Decimal(1);
  const lv = effectiveEngineLevel(state);            // ★ 唯一入口（IC 修饰器可压低 ✓）
  // ②b 乘算倍率 —— 开根形状（同 ② 的理由）
  return new Decimal(1).add(lv.pow(0.5).mul(ENGINE_MECH.mult.coeff));
}

/**
 * ③ 暗能量倍率对 ZPE 倍率的影响（**带指数**，用户设计稿第 3 条）。
 *
 * `zpeMultiplier ×= 暗能量倍率 ^ 1.03`（初始指数 1.03，**上限待用户定** ✓）
 *
 * ⚠️⚠️ 这构成一个**反馈环**：`引擎倍率 → 暗能量倍率 →（^1.03）→ ZPE 倍率 → ZPE → …`
 *   与 `ZPE 倍率 ^0.02` 那条自反馈**耦合** ⇒ 必须一起验算环增益 < 1 ✗
 *   见 `tools/zpe-engine-lab.mjs` 的 `a < 1` 安全线（那里已把这条指数算进去）。
 */



/** ③ 是否已解锁（等级 ≥ countFreqLevel） */
export function zpeEngineCountFreqUnlocked(state) {
  return zpeEngineUnlocked(state) && zpeEngineLevel(state).toNumber() >= ZPE_ENGINE.countFreqLevel;
}

// ══════════════════════════════════════════════════════════
// 三条可重复升级
// ══════════════════════════════════════════════════════════

export const REPEATABLE = {
  /**
   * 计数频率。用粒子买，价格 ×2，效果 ×1.1/级。
   * S 贡献 = log(1.1)/log(2) = 0.1375
   */
  particleBoost: {
    id: "particleBoost",
    name: "计数频率",
    /** kind 决定它进哪个乘区，formulas.js 按 kind 汇总 */
    kind: "countFreqAdd",
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
    firstRewardDream: true },

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
      firstRewardDream: true };
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
    firstRewardDream: true } };

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
    note: "买下后立刻 ×33，买齐 9 个共 ×273" },
  v2: {
    id: "v2",
    name: "熵流加速",
    cost: "50000",
    desc: "熵产出 ×1.5",
    rewardDream: true },
  v3: {
    id: "v3",
    name: "物质重组",
    cost: "100000",
    desc: "粒子→物质 ×1.5",
    rewardDream: true },
  v4: {
    id: "v4",
    name: "虚空共鸣",
    cost: "300000",
    // ★ 文案已改：原描述是「系数从 0.02 → 0.08」，玩家看不懂系数是什么
    desc: "梦想点的全局加成系数：每点 +2% → +8%",
    rewardDream: true,
    note: "原稿此条完全无效（dreamCoefficient 写了没人读），已修" },
  v5: {
    id: "v5",
    name: "凝聚升华",
    cost: "1000000",
    // ★ 恢复原稿效果：每级产出增量 +0.5（0.15 -> 0.65）
    //   极限转换率从 0.05 提到 0.2167（4.3 倍），是**有界**的提升 —— 安全。
    desc: "熵凝聚每级产出增量 +0.5（极限转换率 0.05 → 0.2167）",
    rewardDream: true },
  v6: {
    id: "v6",
    name: "虚空汲取",
    cost: "3000000",
    // ★ 文案补全：原描述只写「ZPE 产出 ×5」
    desc: "ZPE 产出 ×5，且此后 ZPE 倍率也会影响 ZPE 产出",
    rewardDream: true },
  v7: {
    id: "v7",
    name: "超光速引擎",
    cost: "10000000",
    desc: "手动点击获得 ×5 熵（10 → 50 熵/次）",
    rewardDream: true },
  v8: {
    id: "v8",
    name: "虚空永恒",
    cost: "80000000",
    desc: "ZPE 倍率 ×1.5",
    rewardDream: true },
  v9: {
    id: "v9",
    name: "传承启迪",
    // 消耗 1 梦想点 + **门槛** 1e8 ZPE（见下方 requireZpe）
    costDream: 1,
    /**
     * ⚠️ **门槛**（不是价格）：ZPE 到 1e8 才允许购买。
     *
     * 原稿就是这么写的（`legacy/index.html` 的 `void-cost-v9`：「1 梦想点 + 1e8 ZPE」）。
     * 用户明确「v9 不改，故意设计的」⇒ `cost` 仍是 `"0"`（**不扣** ZPE），
     * 只保留"到 1e8 才解锁"这条门槛；加它的唯一目的是不让它开局 4 秒被买走
     * （实测它曾把 ZPE 在 7 分钟内推到 1e15，让 `tools/stage-timing.mjs` 的时长读数失真）。
     */
    requireZpe: 1e8,
    cost: "0",
    desc: "所有里程碑效果翻倍；熵凝聚/升级价格/熵阱价格的折扣改为「达到阈值自动获取」（不再扣钱）",
    rewardDream: false } };

// ══════════════════════════════════════════════════════════
// 6 个 ZPE 里程碑（阈值触发，永久）
// ══════════════════════════════════════════════════════════

export const ZPE_MILESTONES = [
  {
    id: "m1",
    need: "10",
    desc: "手动点击熵 +10",
    effect: { kind: "clickGainAdd", value: 10 } },
  {
    id: "m2",
    need: "100",
    desc: "所有升级价格 ÷ ZPE 倍率",
    effect: { kind: "upgradePriceDivZpe" } },
  {
    id: "m3",
    need: "500",
    // ★ 文案已改：原描述写「粒子和物质」，实际只影响物质
    desc: "ZPE 倍率以一半效率影响物质产出",
    effect: { kind: "matterZpeFactor", ratio: 0.5 } },
  {
    id: "m4",
    need: "1000",
    desc: "ZPE 倍率影响熵阱的实际生效数量",
    effect: { kind: "effectiveTraps", bonus: 1 } },
  {
    id: "m5",
    need: "10000",
    desc: "购买熵阱价格 ÷ ZPE 倍率",
    effect: { kind: "trapPriceDivZpe" } },
  {
    id: "m6",
    need: "1e8",
    desc: "熵凝聚阈值 ÷ ZPE 倍率",
    effect: { kind: "convThresholdDivZpe" } },
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
    effect: { kind: "unlockTransmuter" } },
  {
    id: "dm1",
    need: "10",
    desc: "ZPE 倍率 ×2",
    effect: { kind: "zpeFixedMultiplier", value: 2 } },
  {
    id: "dm2",
    need: "100",
    // ★ 文案与效果都已改：原稿分子分母同时放大，数学上精确抵消
    desc: "暗能量降低熵凝聚阈值（÷ 暗能量倍率）",
    effect: { kind: "convThresholdDivDe" } },
  {
    id: "dm3",
    need: "1000",
    // ★ 文案已改：原描述写「ZPE 速度」，实际加成的是熵产出
    desc: "暗能量倍率额外加成熵产出",
    /**
     * ⚠️ **声明与实现分居两处**（历史遗留）：
     *   这里的 `kind` 只是**元数据**，全项目没有任何消费者；
     *   真正的效果硬编码在 `formulas.js` 的 `entropyRate()`：
     *       `if (hasDe(state, "dm3")) r = r.mul(darkEnergyMultiplier(state));`
     *   守卫：`tools/zpe-matter-lab.mjs` 的断言会验证"dm3 生效 ⇒ 熵产出 ×暗能量倍率"
     *   （把"声明了但没人验"变成"有断言"）。
     *   想彻底统一，就把各 kind 都改成 `kind → handler` 的表驱动 —— 但那是一次独立重构。
     */
    effect: { kind: "entropyMulDe" } },
  {
    id: "dm4",
    need: "10000",
    desc: "ZPE 折扣倍率额外 ×(1 + 暗能量 × 0.05)",
    effect: { kind: "priceDiscountDeBonus", ratio: 0.05 } },
  {
    id: "dm4b",
    need: "1000000",
    /**
     * ★ 大胆的一次性解锁：**全局加成作用于相变转换速率**（1e6 暗能量生效）。
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
    desc: "全局加成作用于相变转换速率（ZPE → 暗能量）",
    effect: { kind: "globalToConversion" } },
  {
    id: "dm5",
    need: "1e10",
    desc: "暗能量倍率也会加速暗能量自身的生成",
    effect: { kind: "deGainMulDe" } },
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
  floor: 1e-9 };

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
    firstRewardDream: true },
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
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}（花粒子）`,
      firstRewardDream: true };
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
      firstRewardDream: true };
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
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}（花暗能量）`,
      firstRewardDream: true };
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
      /**
       * ★ 描述必须**从实际公式推导**，不能假设 v5 已买。
       *
       *   踩过：旧描述写死 `0.15 + 0.5 + 0.05L`（假设 v5），没买 v5 时显示的
       *   "转换率上限"比真实值高 —— 又是「显示 vs 实际」那类问题。
       *   所以这里接收 `state`（UI 会传），按实际是否买了 v5 算。
       */
      desc: (lv, state) => {
        const v5 = state?.voidUpgrades?.v5 ? 0.5 : 0;
        const inc = 0.15 + v5 + PER_LEVEL * lv;
        return `熵凝聚每级产出增量 +${(PER_LEVEL * lv).toFixed(2)}` +
          `（转换率上限 ${(inc / 3).toFixed(3)}${v5 ? "" : "，未含 v5"}）`;
      },
      firstRewardDream: true };
  })() };

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
    desc: "自动购买「高效相变」",
    effect: { kind: "autoBuy", deUpgrade: "phaseShift" } },
  {
    id: "autoVacuum",
    name: "加速自动化",
    cost: 1,
    target: "vacuumAccel",
    desc: "自动购买「真空加速」",
    effect: { kind: "autoBuy", deUpgrade: "vacuumAccel" } },
  // ★ 新增两条：覆盖前面的暗能量升级 4（相变增幅）和 5（凝聚斜率）。
  //   用户要求：梦想点经济要覆盖全部五条暗能量升级。
  {
    id: "autoDeGainBase",
    name: "增幅自动化",
    cost: 1,
    target: "deGainBase",
    desc: "自动购买「相变增幅」",
    effect: { kind: "autoBuy", deUpgrade: "deGainBase" } },
  {
    id: "autoConvOutput",
    name: "斜率自动化",
    cost: 1,
    target: "convOutput",
    desc: "自动购买「凝聚斜率」",
    effect: { kind: "autoBuy", deUpgrade: "convOutput" } },
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
    autoBuyDe: [] };
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
 *   · kind = "countFreqAdd" —— 效果是 `1 + k·等级`，**仿射（线性）**，不是乘法。
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
    if (cfg.kind === "convAdd" || cfg.kind === "countFreqAdd") continue;
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
      .reduce((s, p) => s + Math.log(p.m) / Math.log(p.r), 0) };
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
  /**
   * **全局加成**里的「计数频率」那一项（`1 + 0.05×等级`）。
   *
   * ⚠️ 命名踩过的坑：这一格原来叫「全局乘区」，而真正**全局**的东西是
   *    `全局加成 = 梦想点项 × 计数频率项 × 暗能量项` 这个乘积本身（同时喂熵与物质两条线）。
   *    把「计数型的那个升级」和「全局乘积」混用一个名字，就是歧义来源。
   *    现在：**计数频率 = 那个升级**（青色），**全局加成 = 乘积**（金色，见下）。
   */
  countfreq: { name: "计数频率", cn: "计数频率", color: "#26a69a" },
  /**
   * **真·全局加成**：作用于所有产出线的那个乘积的组成部分（目前是 `v4` 抬梦想点系数）。
   *
   * 顶部有专门的「全局加成」槽显示它的分解，所以这里的色只是给它一个身份。
   */
  global: { name: "全局加成", cn: "全局", color: "#ffd600" },
  /**
   * **价格修正**：不产生产出，改的是「买得起 / 买多贵 / 要不要钱」。
   *
   * 原来这四条（`m2` 升级价格、`dm4` ZPE 折扣、`v9` 里程碑总开关）被塞在「全局乘区」里，
   * 语义上是错的 —— 它们跟产率链没有乘法关系。
   */
  cost: { name: "价格修正", cn: "价格", color: "#90a4ae" },
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
   * ∞ 层自己的位置：**无限点收益**。
   *
   * ①「无限增幅」和 ④「无限长河」都不作用在产率链上，而是作用在无限点本身上。
   * ⚠️ 原来和「全局」共用金色 —— 违反「同色 = 同位置」，现在改成品红。
   */
  ip: { name: "无限点收益", cn: "无限点", color: "#ff4d94" },
  /**
   * 梦想点体系 —— **虹色**。
   *
   * 它不是一个产出乘区，而是「成就货币」的加成集合：
   *   · 梦想点 → 全局加成里的梦想点项（`1 + dp×0.02`）
   *   · 4 条自动化（相变 / 加速 / 增幅 / 斜率）
   *   · 梦想烬灭虚无、传承启迪（烧梦想点的升级）
   * 用户要求：凡涉及梦想点的都用虹色标识。
   * `rainbow: true` 让图例渲染成**流动渐变色块**，而不是单一 `color`。
   */
  dream: { name: "梦想加成", cn: "梦想", rainbow: true },
  /**
   * ★★★ 2025 新增：**永恒点收益**（第三层设计稿 33~35 行的永恒升级）。
   *
   * 为什么不复用 `ip`：`ip` 是**无限点**、这一格是**永恒点** ——
   *   不同层的资源共用颜色，会让玩家以为"永恒升级也影响无限点" ✗
   * 颜色：`global` 是亮金 #ffd600、`ip` 是玫红；
   *   永恒取**琥珀** #ffab00（金色家族里，但一眼能与前两者区分）✓
   */
  eternity: { name: "永恒点收益", cn: "永恒点", color: "#ffab00" } };

/** 每个 id 属于哪个乘区 */
export const ZONE_OF = {
  // 可重复升级
  particleBoost: "countfreq", // ★ 就是「计数频率」本身：1 + 0.05×等级
  matterBoost: "matter",     // 只影响物质
  entropyCoeff: "particle",  // 熵→粒子的转换
  // 虚空升级
  v1: "zpe",        // ZPE 产出
  v2: "entropy",    // 熵产出
  v3: "matter",     // 粒子→物质
  v4: "global",     // ★ 抬「梦想点项」的系数 —— 真·全局（那个乘积的因子之一）
  v5: "particle",   // 熵凝聚
  v6: "zpe",        // ZPE 产出
  v7: "entropy",    // 点击熵
  v8: "zpe",        // ZPE 倍率
  v9: "cost",       // ★ 价格修正：达到阈值自动获取（等价于价格 0）
  // ZPE 里程碑
  m1: "entropy",    // 点击熵
  m2: "cost",       // ★ 价格修正：升级价格
  m3: "matter",     // 物质产出
  m4: "entropy",    // 熵阱有效数量（同时影响 ZPE，但标主要作用）
  m5: "matter",     // 熵阱价格
  m6: "particle",   // 熵凝聚阈值
  // 暗能量里程碑
  dm0: "de",
  dm1: "zpe",
  dm2: "particle",  // 熵凝聚阈值
  dm3: "entropy",   // 熵产出
  dm4: "cost",      // ★ 价格修正：ZPE 折扣
  dm4b: "de",       // ★ 漏登记过：全局加成作用于**相变转换**（ZPE→暗能量）
  dm5: "de",
  // 暗能量升级
  //
  // ⚠️ 五条都要在这里登记，否则卡片拿不到乘区色（`zoneOf` 会回退成默认色，
  //    看起来像"加成区不对"）。踩过：deGainBase / convOutput 漏登记。
  //
  //   dreamAnnihilation / phaseShift / vacuumAccel / deGainBase —— 都在**暗能量**这条线上
  //   （phaseShift 与 deGainBase 位置相同：都乘"每次转换的量"，只是花粒子 vs 花暗能量）
  //   convOutput —— 改的是**熵凝聚的产出斜率**，落在粒子转换那条线
  dreamAnnihilation: "de",
  phaseShift: "de",
  vacuumAccel: "de",
  deGainBase: "de",
  convOutput: "particle",
  // ∞ 层：无限升级（按"加成落在哪个位置"给色 —— ①④ 落在无限点本身，② 落 ZPE，③ 落相变仪，
  //   起点跃迁改的是物质存量起点，速率解放改的是量子成长速率上限）
  ipDouble: "ip",
  ipTime: "ip",
  // ★ 量子铸币：**落点是无限点**（它的输入是量子，但加成的落点在 ∞ 层）——
  //   按项目规矩「只看加成位置而不看职责位置」⇒ 登记为 `ip`，不是 `quantum`。
  ipFromQuantum: "ip",
  //   ⚠️ 量子相关的东西用 `dm` 这一格（ZONES 里没有 `quantum` 键；量子页的红色就是它）
  thresholdFlat: "dm",
  pairBoost: "dm",
  ipToZpe: "zpe",
  ipToTransmuter: "de",
  start50: "matter",
  start100: "matter",
  start150: "matter",
  start200: "matter",
  rate110: "dm",
  rate121: "dm",
  rate139: "dm",
  rate167: "dm",
  // 梦想点一次性升级（量子页）——它们**就是梦想系统本身**，所以归 dream 乘区（虹色）。
  // 漏登记过：这四条曾经没有乘区，卡片只能靠硬编码的 `zone-dm` 上红色，语义是错的。
  autoPhase: "dream",
  autoVacuum: "dream",
  autoDeGainBase: "dream",
  autoConvOutput: "dream",
  // ── 静态按钮用的 id（2025 补登记）──
  //
  // ⚠️ 判据仍然是**只看"加成作用的位置"**（与上面 50 个 id 同一套规矩），不是看它属于哪个页面。
  //   这四条之前没有 id（按钮在 index.html 里硬编码颜色）⇒ 现在让它们走同一个 `applyZone` ✓
  /** 熵阱：直接给熵产出（价格入口，但加成落点是熵） */
  trap: "entropy",
  /** ZPE 引擎升格：产出/倍率落 ZPE；b区那条落在物质（按"主要落点"取 zpe，与 m4 同一处理方式） */
  zpeEngine: "zpe",
  /** 相变仪（解锁 + 转换速率）：ZPE → 暗能量，落点就是暗能量 */
  transmuter: "de",
  /** 大坍缩：把它攒的**物质深度**换成**无限点** ⇒ 落点是无限点本身（同 ①④） */
  bigcrunch: "ip",
  /** 打破无限：解开物质硬顶，让大坍缩收益继续随深度增长 ⇒ 同样落在无限点收益上 */
  breakInfinity: "ip",
  /**
   * ★★★ 2025 新登记（第三层设计稿 33~35 行）：永恒升级「永恒增幅」。
   *
   * 落点判据（与上面同一套规矩：**只看加成作用的位置**）：
   *   它乘的是「**最终获得的永恒点**」⇒ 落点就是**永恒点本身**。
   * ⚠️ `ZONES` 里目前**没有** `eternity` 乘区（这一层刚开，之前没有可上色的东西）
   *   ⇒ 沿用 `ip`（无限点收益）那一格？**不行** —— 那是无限点，不是永恒点，语义不同 ✗
   *   ⇒ 这里新增 `eternity` 乘区（见 `ZONES`），颜色取金色家族的深金，与 ∞（ip）区分开 ✓
   */
  epMult: "eternity" };

export function zoneOf(id) {
  return ZONES[ZONE_OF[id]] ?? ZONES.global;
}

// ══════════════════════════════════════════════════════════
// ★★★ 2025 新实现（`docs/NEKO.md` §7 / §10）：**好感度系统**
// ══════════════════════════════════════════════════════════
// ⚠️ 关键定位（NEKO.md §7 明写）：**好感度是游戏的原生系统**，
//   **不接入 N.E.K.O SDK 也照常开发** —— 所以这一整块（数值 / 道具 / UI）
//   都是纯游戏内实现，**不依赖任何外部进程** ✓
//   接入 SDK 后只额外开放一条"猫娘可主动调控"的通道（本文件不涉及）。
//
// 规格（NEKO.md §7 / §10 原文）：
//   · 范围：初始 **0**、**±100**、**正值可超 100**
//   · 门槛效果：好感度 **> 25 / > 50 / > 75** 时全局加成 **^1.002 / ^1.005 / ^1.015**
//     三档**叠乘** ⇒ 全开时指数 = `1.002 × 1.005 × 1.015 = 1.022093015`
//   · 边界：**每 5 分钟波动 < 8 点**（接入 SDK 后 < 16 点）
//   · **负面好感度不影响游戏进程**（所以指数只向上偏，`< 0` 时恒 1）
//   · 安全性（NEKO.md §7 已算过）：本作「环增益总和 < 1」判据当前 **0.7263**；
//     三档全叠也只有 **0.7423** ⇒ **留有余量** ✓（所以**不需要**额外的软上限）
export const NEKO = {
  /** 好感度下限 / 上限（`max` 是"软展示"上限，正值允许超过它 ✓） */
  min: -100,
  max: 100,
  /** 三档门槛（**严格大于** —— NEKO.md 写的是 `> 25` 等）*/
  tiers: [
    { need: 25, pow: 1.002 },
    { need: 50, pow: 1.005 },
    { need: 75, pow: 1.015 },
  ],
  /** 波动上限（每 5 分钟）：原生 / 接入 SDK 后 */
  driftWindowSec: 300,
  driftMax: 8,
  driftMaxSdk: 16,
};

/**
 * 好感度给出的**全局加成指数**（唯一入口 ✓）。
 *
 * `全局加成 ^= 本函数`。三档**叠乘**（NEKO.md §7「叠乘」）。
 * ⚠️ 未达门槛 / 好感度为负 ⇒ 恒 **1**（负面不影响游戏进程 ✓）
 */
export function nekoGlobalExponent(state) {
  const a = Number(state?.nekoAffinity ?? 0) || 0;
  if (!(a > NEKO.tiers[0].need)) return 1;          // ≤25（含负数）⇒ 无加成 ✓
  let e = 1;
  for (const t of NEKO.tiers) if (a > t.need) e *= t.pow;
  return e;
}

/**
 * 好感度的**写入通道**（唯一的写入点 ✓ —— 与「只走既有购买函数」同一套纪律）。
 *
 * · 夹到 `[NEKO.min, NEKO.max]`（正值允许超过 `max`？⇒ **不允许**：`max` 就是硬上限 100，
 *   NEKO.md 的"正值可超 100"指的是**档位判定**不受 100 限制，而数值本身要封顶防爆）
 *   ⚠️ 这一点我按"安全优先"实现：封顶 100。若你要"可超 100 的数值"，告诉我改 `max` ✓
 * · `5 分钟波动 < 8`（`NEKO.driftMax`）—— 用 `state.nekoDriftStamps` 记录最近窗口内的累计变化
 *   ⚠️ 边界由**调用方**（道具 / SDK 通道）负责限流；本函数只保证**单次写入**不越界
 * @returns {number} 实际变化量（可能小于请求量，被窗口预算削减）
 */
export function addNekoAffinity(state, delta, { sdk = false, now = Date.now() } = {}) {
  if (!state) return 0;
  const cur = Number(state.nekoAffinity ?? 0) || 0;
  const want = Number(delta) || 0;
  if (want === 0) return 0;
  // ── 窗口预算：最近 `driftWindowSec` 内所有写入的**绝对值之和** ≤ driftMax ──
  const budget = sdk ? NEKO.driftMaxSdk : NEKO.driftMax;
  const winMs = NEKO.driftWindowSec * 1000;
  const stamps = (Array.isArray(state.nekoDriftStamps) ? state.nekoDriftStamps : [])
    .filter((s) => Array.isArray(s) && s.length === 2 && now - s[0] < winMs);
  const used = stamps.reduce((a, s) => a + Math.abs(Number(s[1]) || 0), 0);
  const room = Math.max(0, budget - used);
  let applied = want;
  if (Math.abs(want) > room) applied = Math.sign(want) * room;      // 削减到窗口剩余额度
  if (applied === 0) { state.nekoDriftStamps = stamps; return 0; }
  const next = Math.max(NEKO.min, Math.min(NEKO.max, cur + applied));
  const real = next - cur;                                          // 封顶后真实变化
  state.nekoAffinity = next;
  if (real !== 0) stamps.push([now, real]);
  state.nekoDriftStamps = stamps;
  return real;
}

/** 距离下一档还差多少（UI 用；已全开返回 null） */
export function nekoNextTier(state) {
  const a = Number(state?.nekoAffinity ?? 0) || 0;
  for (const t of NEKO.tiers) if (!(a > t.need)) return t;
  return null;
}

// ══════════════════════════════════════════════════════════
// ★★★ 2025（`docs/NEKO.md` §6）：**猫娘的动作白名单**
// ══════════════════════════════════════════════════════════
// §6 原文的三条**硬约束**（也是本项目的既有判据）：
//   ① **阶段白名单**：动作只能作用于玩家**已经到达**的阶段（不会替玩家越过门槛）
//   ② **只走既有购买函数**：不自己写扣款逻辑（踩过"自动化与手动双倍发放"的坑）
//   ③ **限流 + 幂等**：每 tick 最多 N 次动作；重复调用同一动作不叠加
//
// ⚠️ 另外一条（§6 末尾）：**猫娘驱动的自动化不花游戏内的梦想点**，
//   也不占用玩家已买的自动化升级槽位 ⇒ 它是**独立通道**，不是"替玩家买升级" ✓
//
// 这个对象是**纯数据**：动作名 → 说明。真正的派发在 `neko.js`（那里才知道引擎函数）。
// 放在 config 是为了让 UI / 文档 / 断言**共用同一份清单**（不许各写一份 ✗）。
export const NEKO_ACTIONS = {
  buyRepeatable: "买三条主升级（走同一个购买函数）",
  buyVoidUpgrade: "买虚空升级",
  buyDeUpgrade: "买暗能量升级",
  buyInfinityUpgrade: "买无限升级（含 ① 无限增幅）",
  doBigCrunch: "大坍缩",
  doEternity: "永恒",
  /** 猫娘的自动化通道（**不消耗梦想点**、不占玩家槽位 —— §6 末尾） */
  setAuto: "开关自动化",
};

/**
 * 每个 tick 最多接受多少条动作（§6 的"限流"）。
 * ⚠️ 取用户指定的量级（"每 tick 最多 N 次"）⇒ 8 条；超出的**丢掉并计数**，
 *   不报错（对面是 LLM，不该因为多发了几条就整批失败）✓
 */
export const NEKO_MAX_ACTIONS_PER_TICK = 8;

/** 派发动作的结果形状（`NEKO.md` §4 的 `ResultPublisher` 要用） */
export const NEKO_ACTION_RESULT = {
  OK: "ok",
  UNKNOWN: "unknown_action",
  THROTTLED: "throttled",
  REJECTED: "rejected",
};

// ══════════════════════════════════════════════════════════
// ★★★ 2025（设计稿第 27 行 / 用户裁定）：**主面板的折叠分组**
// ══════════════════════════════════════════════════════════
// 设计稿原文：「…**升级中心 / 点击获取熵 / 各项加成比例都合并为主面板页面下**
//              （这些页面在自动化后玩家不会在意的）」
// 用户裁定：「我要是用户估计会倾向于 **b 方案**（可折叠）—— 建议有个**下拉条**，
//            同时下拉条中有个**复选框**以确认**记住展开状态**」
//
// ⚠️ 默认值 = **收起**（设计稿的理由是"自动化后玩家不会在意的" ⇒ 默认不占屏幕）
export const UI_FOLDS = {
  manual: {
    id: "manual",
    title: "手动操作",
    /** 默认是否展开（**未勾"记住"**时永远用这个值） */
    defaultOpen: false,
    /**
     * "记住展开状态"的存储键。
     * ⚠️ **放 localStorage 而不是存档**：
     *   它是**设备偏好**（同一存档在手机/PC 上可以有不同的默认），
     *   而且不该让"折叠了一下"触发存档写入 ⇒ 与 `BASE.saveKey` **分开** ✓
     */
    rememberKey: "kongxiang.ui.fold.manual",
  },
};

// ══════════════════════════════════════════════════════════
// ★★★ 2025（`NEKO.md` §10 原文）：**好感度道具**
// ══════════════════════════════════════════════════════════
// 设计稿原文（§10）：
//   「好感度系统有一些道具，免费的猫条，需要**当前所有物质**购买的棒棒糖
//     与**所有 zpe**换取的猫爪。」
//
// ⚠️ 用户裁定：「**先按照目前的要求做，不管平衡性**」
//   ⇒ 稿子里怎么写就怎么做，**不做套利分析、不加冷却、不改成比例消耗** ✓
//   ⚠️ 稿子末尾提到的套利风险（"在重置前买等于免费；ZPE 也会自己长回来"）
//      **已知但本轮不处理** —— 它由 §7 的**波动窗口**天然兜住一部分
//      （每 5 分钟全部道具合计只能给 `< 8` 点好感度 ⇒ 刷不出爆发）✓
//
// ⚠️ **稿子没写的两个数，是我补的**（必须标出来，不能假装是稿子的）：
//   · 各道具**给多少好感度** —— 稿子只说"有道具"，没说增量
//     ⇒ 我按"越贵给越多"补：猫条 1 / 棒棒糖 3 / 猫爪 5
//   · 猫爪**是否连 ZPE 的持有量一起清** —— 稿子说"换取"⇒ 实现成**清零** ✓
export const NEKO_ITEMS = {
  /** 免费猫条：稿子明写"免费" ⇒ 唯一成本是**波动窗口预算**（§7 每 5 分钟 < 8 点） */
  catFood: {
    id: "catFood", name: "猫条", gain: 1,
    costText: "免费",
    /** 买得起吗（**不扣**，真正的扣款在 `useNekoItem` 里 —— 只走那一个入口 ✓） */
    can: () => true,
  },
  /** 棒棒糖：消耗**当前所有物质**（稿子原文） */
  lollipop: {
    id: "lollipop", name: "棒棒糖", gain: 3,
    costText: "当前所有物质",
    can: (s) => (s?.resources?.matter ?? new Decimal(0)).gt(0),
  },
  /** 猫爪：换取**当前所有 ZPE**（稿子原文） */
  paw: {
    id: "paw", name: "猫爪", gain: 5,
    costText: "当前所有 ZPE",
    can: (s) => (s?.zpe ?? new Decimal(0)).gt(0),
  },
};

/**
 * 使用一个好感度道具（**唯一入口** ✓）。
 *
 * 纪律：
 *   · 扣款与好感度写入**都在这里**（不许别处再写一遍 ⇒ "双倍发放"是本项目踩过的坑）✓
 *   · 好感度写入走 `addNekoAffinity`（**唯一写入点**）⇒ 天然受 §7 的波动窗口限制 ✓
 *     ⚠️ 因此可能出现"资源扣了、好感度没加满"——那是**设计如此**（窗口预算），
 *        函数返回**真实增量**让 UI 能如实显示 ✓
 * @returns {{ok:boolean, gain:number, reason?:string}} gain = **实际**加了多少好感度
 */
export function useNekoItem(state, id) {
  const it = NEKO_ITEMS[id];
  if (!it) return { ok: false, gain: 0, reason: "未知道具" };
  if (!it.can(state)) return { ok: false, gain: 0, reason: `需要：${it.costText}` };
  // ── 先问窗口预算：**一点都加不了就别扣资源**（否则玩家白丢物质/ZPE ✗）──
  const room = nekoDriftRoom(state, false);
  if (room <= 0) return { ok: false, gain: 0, reason: "窗口额度已用完（每 5 分钟 < 8 点）" };
  // ── 扣款 ──
  //   ⚠️ config.js 里没有 `D()` 辅助（那是 `state.js` 的）⇒ 用 `new Decimal(0)` ✓
  if (id === "lollipop") state.resources.matter = new Decimal(0);
  else if (id === "paw") state.zpe = new Decimal(0);
  // ── 加好感度（唯一写入点）──
  const gain = addNekoAffinity(state, it.gain);
  return { ok: true, gain };
}

/** 当前波动窗口还剩多少额度（UI 用；`sdk` = 接入后的放宽档） */
export function nekoDriftRoom(state, sdk = false, now = Date.now()) {
  const budget = sdk ? NEKO.driftMaxSdk : NEKO.driftMax;
  const winMs = NEKO.driftWindowSec * 1000;
  const stamps = Array.isArray(state?.nekoDriftStamps) ? state.nekoDriftStamps : [];
  const used = stamps
    .filter((s) => Array.isArray(s) && s.length === 2 && now - s[0] < winMs)
    .reduce((a, s) => a + Math.abs(Number(s[1]) || 0), 0);
  return Math.max(0, budget - used);
}

// ══════════════════════════════════════════════════════════
// 第四层：临界坍缩（红色）
// ══════════════════════════════════════════════════════════

/**
 * 设计推导（这一步的数值是算出来的，不是拍的）：
 *
 *   坍缩阈值  T_n = 1e25 × 10^(10n)      每档 ×1e10
 *   暗物质    DM_n = 10n                 每次 +10
 *   全局加成  M    = 10^DM
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
  // ★★★ 2025（用户裁定）：统一科学计数法 —— 原 `1e308.2547` 有歧义（看着像 e 后跟小数）✗
  bigCrunchMatter: "1.80e308",

  /** 大坍缩给多少无限点 */
  infinityPointsPerCrunch: 1 };

// ══════════════════════════════════════════════════════════
// ★ 已移除：暗物质 + 临界坍缩阶梯（用户决定）
// ══════════════════════════════════════════════════════════
//
// 原来的第三层是「临界坍缩阶梯」：
//   物质跨过阈值(×1e5 递进) -> 领一份暗物质 -> 全局加成 ×10^DM
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
//   2025：R（`quantumGrowthRate`）已删除 —— 该职责改由「粒子时变增幅」承担，
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
   * ★★ 2025 新增：**捕获档位的累进因子**（过载新语义，用户裁定选项 C）
   *
   *   门槛(pairs) = base × step^pairs × **captureTierFactor^(pairs²/2)**
   *
   *   · `= 1` ⇒ **完全退化为原来的纯几何**（零回归 ✓，默认值就是 1）
   *   · `> 1` ⇒ 每捕获一对，下一次的门槛**步长本身被抬高** ⇒ 超几何增长
   *     ⇒ 实现设计稿行 12「**越靠后越难获取**」与 AD 复制器
   *     「每超一档 ⇒ 该档难度 ×固定因子」的累进语义（见 `quantumZpeRequirement` 的注释）
   *
   *   ⚠️ 它是**指数上的平方** ⇒ 对 late-game 影响极大，标定时必须**小步**调
   *     （1.001 这种量级就会在 pairs=100 时贡献 1.001^5000 ≈ 148 倍）。
   *   标定方法与实测表见 `tools/quantum-curve.mjs`；
   *   改完必须重跑 `tools/stage-timing.mjs`（它给出 48h 的 IP 落点）。
   */
  captureTierFactor: 1,
  /**
   * ★ 2025 备注：这里原来有 `growthRateMax: 0.147` / `growthRateHalf: 0.5` 两个常数，
   *   用来做「量子 → 指数成长速率 R」的饱和式。**R 已彻底删除**（见 docs/R-REPLACEMENT.md §12），
   *   所以这两个常数与它们的解释（"为什么是 0.147"）一并移除 ✓
   *   现在量子经 `√q` 影响两处：粒子增幅速率 `b`（`DE_SPAN.b0` 一族）与跨度幂 `k` ✓
   *   0.147 是按 `L = knee + D·log2(1 + ln2·R₀·t/D)` 反解出来的（t = 100 分钟）。
   *   想调就改这个数 + `CLIMB.halvingOrders`，然后跑 `tools/pace-model.mjs` 复算。
   */
  // ★★ 2025：`growthRateMax` / `growthRateHalf` **已删除**（R 退休）。
  //   原先"量子越多 R 越高、上限 0.147"的饱和式不再存在；
  //   量子改经 `√q` 影响 `b`（粒子增幅速率）与跨度幂 `k`。
  /** 达到上限一半时所需的量子数（越小越慷慨）。0.5 时阶梯段约 1.75 小时 */

  /** 每对给几个量子（用户设定：一对） */
  perPair: 2 };

/**
 * 爬升形状（路线 1）：让 `e25 → e308.25` 那段从直线变成 log 形。
 *
 *   `R_eff = R(q) · 2^(−(L − knee)/halvingOrders)`      （L ≤ knee 时恒为 1）
 *
 * knee = 25 = 量子层解锁点（`COLLAPSE.unlockMatter` 的对数）——
 * 所以 **e25 之前那 6 分钟完全不受影响**（那段由基础环决定，本来就不走量子项）。
 *
 * ⚠️ 2025：R 退休后，这段时长的旋钮改成 `DE_SPAN.b0` 与 `bMax`（粒子增幅速率）。
 *    参数表与定点断言见 `tools/pace-model.mjs`（--check / --sweep）。
 *    实测（_sim 沙盒，非本仓库）：直线 97.6 分钟 → log 形 105.1 分钟。
 */
export const CLIMB = {
  /** 拐点（阶）：从这一阶开始衰减。直接取量子层解锁点（1e25 → 25），单一数据源 */
  knee: Math.log10(Number(COLLAPSE.unlockMatter)),
  /** 每多少阶速率减半 */
  halvingOrders: 100 };

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
/**
 * @param {Decimal|number} quantum
 * @param {Decimal|number} [rateMult=1] ∞ 层「速率解放」对**上限**的倍率
 *        （用倍率而不是绝对值，这样最终 R₀ 定成多少都不必重算升级数值）
 */
// ★★ 2025：`quantumGrowthRate()` **已彻底删除**（用户决定取消 R 机制）。
//   物质不再有 `M·R·ln10` 这一项；承重机制改为
//     · 引擎之前：粒子获得的时变增幅 `particleTimeBoost()`（`b` 由量子 √q 与里程碑给）
//     · 引擎之后：暗能量自增长 `deGrowthRate()` → 跨度层 `matterSpanMult()`
//   原先"改成长速率"的三个旋钮（∞速率解放 / 坍缩加速器 / 档位 rate 项）改挂 `b`
//   —— 它们的唯一汇总入口仍是 `infinityRateMult()` ✓
//   实测（删 R 后真实引擎）：物质**仍能撞到 1e308**，第一次大坍缩 10.52h（目标 13.39h）✓

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
/** 量子门槛的**总倍率**（单一数据源：档位里程碑的"量子润滑" × 门槛压平 × 量子里程碑 qm5） */
export function quantumStepMult(state) {
  const flat = state.thresholdFlatBought ? 0.5 : 1;   // ×20 → ×10
  // ★ 量子里程碑 qm5：再 ×20 → ×18（= ×0.9），见 docs/QUANTUM-MILESTONES.md
  const qm = state.quantumMilestones?.qm5 ? 0.9 : 1;
  return tierQuantumStepMult(state) * flat * qm;
}

/** 每次捕获得到几个量子（涨落增幅：2 → 3） */
export function quantumPerPair(state) {
  const base = state.pairBoostBought ? 3 : QUANTUM.perPair;   // ★ cm6：每对 +1（见下一行）
  return base + (hasCollapse(state, "cm6") ? 1 : 0);
}

/**
 * ★★ 2025：**`unspentBoost`（沉潜蓄能）已整个删除**（用户裁定 + `TODO.md` A 段早就列了它）
 *
 * 原效果：`a区产率 ×(1 + 未花无限点/2)`，硬封顶 ×1000。删除理由：
 *   · 它是 **IP → 产率** 的平行环（和铸币 / 坍缩加速器同一类），不推动物质形状；
 *   · 「未花无限点」这个口径与现在 **IP 主阶梯（量子铸币 q²）** 的经济不匹配；
 *   · 它的 1.5 次方版曾经是 runaway 源（2025 改成线性才压住）——留着一个需要专门封顶的机制不值当。
 *
 * ⚠️ **历史教训必须留着**（项目规矩：踩过的坑写在注释里，它们是防回退的唯一记录）：
 *   它是「**显示 ≠ 实发**」的**第三例** —— 当时 `unspentBoostMult` 只加在
 *   `formulas.js` 的 `matterRate()` 里，而 `engine.js` 的 `matterCoeff()` 没有它
 *   ⇒ **界面显示有加成、引擎不发放** ✗
 *   前两例：铸币倍率只在界面生效；`dm4b` 只加在 `darkEnergyRate()` 里。
 *   ⇒ 现在的守卫：`tools/zpe-matter-lab.mjs --check` 有"物质系数 ≡ 显示产出/粒子"的等价断言，
 *     且 `matterCoeff()` 与 `matterRate()` **逐项同源**。
 */

export function quantumZpeRequirement(pairs, lubeMult = 1, state = null) {
  const n = pairs instanceof Decimal ? pairs : new Decimal(pairs ?? 0);
  // 用户设定的「再 ×2」并进底数：10 × 2 = 20；lubeMult 是「量子润滑」的缓和倍率
  const step = new Decimal((state && hasCollapse(state, "cm7") ? 22 : QUANTUM.zpeCostGrowth)).mul(QUANTUM.zpeCostExtraNerf ?? 1).mul(lubeMult);
  let base = new Decimal((state && hasCollapse(state, "cm7") ? 1e8 : QUANTUM.zpeBaseCost)).mul(Decimal.pow(step, n));

  // ══════════════════════════════════════════════════════════
  // ★★ 2025：**过载新语义 —— 「阈值本身被抬高」**（用户裁定，选项 C）
  // ══════════════════════════════════════════════════════════
  // 用户的原话与依据：「过载机制，应该是**类似 AD 中复制器的增长阈值**」。
  //   AD 原文（`src/core/replicanti.js`）：
  //     increases = (amount.log10() − cap.log10()) / ReplicantiGrowth.scaleLog10
  //     interval  = interval × scaleFactor ^ increases
  //   ⇒ AD 是「**每超一个固定 OoM 步长 ⇒ 该档难度 ×固定因子**」，是**按档累进**的语义，
  //     而不是单纯的连续速率惩罚。
  //
  // 我们的落地：把累进放在**捕获门槛**上（对应设计稿行 12
  //   「重新优化量子的获得公式，这将使其前期获得更多的量子（**越靠后越难获取**）」）——
  //   每捕获一对，**下一次的门槛步长本身**就被抬高一点 ⇒ 门槛成为**超几何**：
  //       门槛(pairs) = base × step^pairs × F^(pairs²/2)
  //   等价写法 `F^(pairs²)`（常数折进 F）。为什么用 `pairs²` 而不是 `pairs`：
  //     · `pairs` 只是把几何的底数调大（= 改 step），**没有"档"的概念** ✗
  //     · `pairs²` 让**每一档都比上一档更陡** ⇒ 这才是"阈值本身被抬高" ✓
  //
  // ⚠️ 标定：`QUANTUM.captureTierFactor = 1` 时**完全退化为原来的纯几何**（零回归 ✓）。
  //    实测标定表见 `tools/quantum-curve.mjs`；调它之后必须重跑 `tools/stage-timing.mjs`。
  const F = QUANTUM.captureTierFactor ?? 1;
  if (F > 1) {
    // pairs² / 2 —— Decimal 的指数走 log10，避免大数下溢
    const exp = n.mul(n).div(2);
    if (exp.gt(0)) base = base.mul(Decimal.pow(F, exp));
  }
  return base;
}

/**
 * 量子 → **熵生产的最终倍率**（**c区**的一个成员）。
 *
 * 形式 `1 + q`：线性，基于当前持有的量子量。
 * 它本身无界，但**量子会被大坍缩重置**，所以单周期内 q 有上限，不跨周期膨胀。
 *
 * ⚠️ 两个实现事实（改这一条之前先看）：
 *   · 它是**目前唯一**的 c区成员 —— c区靠描述里的「最终」二字登记，
 *     所以界面上这一条写的是「最终倍率」（index.html 的量子面板）。
 *   · 它乘的是**本 tick 的增量**（entropyRate 的乘法链里一环），
 *     不是 `{存量 + 增量}`。熵这一层两种写法等价（熵进来就被阈值转换扣空），
 *     但**别的层若要用 c区，先回 config.js 顶部第 ③ 条定死语义**。
 */
/** ★ 同上：`bonus` = 引擎账（可选第二参）。见 `quantumZpeMultBonus` 的说明。 */
export function quantumEntropyMultiplier(quantum, bonus = null) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  const v = q.lte(0) ? new Decimal(1) : q.add(1);
  return bonus ? v.mul(bonus) : v;
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
/** ★ 同上：`bonus` = 引擎账（可选第二参）。见 `quantumZpeMultBonus` 的说明。 */
export function quantumDeMultBonus(quantum, bonus = null) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(0);
  const v = q.mul(q);
  return bonus ? v.mul(bonus) : v;
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
/** ★ 同上：`bonus` = 引擎账（可选第二参）。见 `quantumZpeMultBonus` 的说明。 */
export function quantumDeGainBonus(quantum, bonus = null) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(1)) return new Decimal(0);
  const v = q.log10();
  return bonus ? v.mul(bonus) : v;
}


// （旧函数 `quantumGain(matterLog10)` 已删除：量子改为按阈值累积，
//   见上方 `quantumGainForCollapse` / `quantumGainForCrunch`。）



/** 汇总已购量子升级的效果 */

// ══════════════════════════════════════════════════════════
// ★ 跨度层（2025 用户方案）：暗能量把物质"撬"到 inf
// ══════════════════════════════════════════════════════════
/**
 * 用户定的形状（docs/R-REPLACEMENT.md）：
 *
 * ```
 * ① 暗能量以 a(DE) 指数增长，跨到 1e50（软上限）
 * ② 量子给"幂"：k = min(1 + c·√q, 6.1651)
 * ③ 物质产出 ×= (DE / DE₀)^k   ⇒  DE 到 1e50 时物质撞 1e308（inf）
 * ```
 *
 * `kMax = 6.1651 = log10(1e308.2547) / 50` —— 把暗能量的 50 阶放大到 308.25 阶。
 * **封顶是必需的**：不封顶时 q=150 会给出 k≈7.33 ⇒ 物质**早于** DE 到顶、软上限形同虚设。
 *
 * 安全性（b区解禁的依据）：这个幂只作用在**环的输出侧**（ZPE→DE→物质），
 * 不参与「熵阱 ↔ ZPE」那个环 ⇒ S 判据不受影响。
 * ⚠️ 千万不要把它接回 ZPE / 熵阱 / 全局加成 —— 那会重现"环增益 Q²、物质一次跳无限"的旧问题。
 */
/**
 * ★ 量子里程碑（2025 草案；7 条）
 *
 * 键在**累计量子对数**上（`quantumPairsTotal`，大坍缩不清零）——
 * 当前量子数每轮归零，键在它上面会形同虚设（见 docs/QUANTUM-MILESTONES.md §0）。
 * **永恒会把它们全部清除**（用户指定：与"除梦想系统外一切重置"一致）。
 *
 * 效果分两类：`kind: "b"` 给粒子增幅速率乘算加成；`kind: "a"` 给引擎段（`a(DE)`）；
 * `kind: "gate"` 改量子门槛步长；`kind: "k"` 给跨度幂。`qm2` 是"开启档位加速"的开关。
 */
export const QUANTUM_MILESTONES = [
  { id: "qm1", need: 1, kind: "b", value: 1.10, desc: "粒子增幅速率 ×1.10" },
  { id: "qm2", need: 3, kind: "tierAccel", value: 1.4, desc: "开启档位加速：每档位 ×1.40（值与 DE_SPAN.tierAccel 保持一致）" },
  { id: "qm3", need: 8, kind: "b", value: 1.10, desc: "粒子增幅速率 ×1.10" },
  { id: "qm4", need: 20, kind: "a", value: 1.25, desc: "暗能量自增长速率 ×1.25" },
  { id: "qm5", need: 50, kind: "gate", value: 18, desc: "量子门槛步长 ×20 → ×18" },
  { id: "qm6", need: 120, kind: "b", value: 1.15, desc: "粒子增幅速率 ×1.15" },
  { id: "qm7", need: 300, kind: "bMax", value: 1.25, desc: "粒子增幅速率的封顶 ×1.25（0.02 → 0.025）" },
];

/**
 * ★ 粒子增幅（替代 R 的那一位）的基础参数。
 *
 * `粒子获得 ×= 10^(b · 本轮已过时间)`，`b = b0·(1+√q/10)·里程碑×档位加速`，封顶 `bMax`。
 * 数值来源：`tools/quantum-particle-lab.mjs` 反解（×1.75 标尺：
 * 第一次大坍缩 13.39h ⇒ b0 ≈ 0.00413）；档位 ×1.06 由阶梯算术给出（24 档 ≈ 90h）。
 *
 * ⚠️ 粒子在**环外**（实测 `effectiveTraps` 不读粒子）⇒ 这个杠杆不进环，S 判据安全。
 * ⚠️ `bMax` 是**硬封顶**（用户既有要求：影响永恒阶段的东西必须有极强软上限）。
 */
export const DE_SPAN = {
  /** 标定系数：q = 100 时 k 恰好 = kMax */
  kCoeff: 0.516509,
  /** 封顶 = log10(物质硬顶) / log10(暗能量软上限) = 308.2547 / 50 */
  kMax: 6.1651,
  /** 暗能量软上限（阶） */
  deSoftCapLog10: 50,
  /**
   * ★ 粒子增幅速率 `b` 的基准（阶/秒）：由 `quantum-particle-lab` 反解 ——
   *   第一次大坍缩 = 7.653h × 1.75 = 13.39h（q≈30、已达成 qm1 ×1.10）✓
   */
  b0: 0.033500,
  /** ★ 粒子增幅速率的硬封顶（阶/秒）。⚠️ 这个封顶把打破无限前的阶梯锁成"3 次深坍缩" */
  /** qm7 对阈值的放宽倍率（见 bThresholdOf） */
  qm7BMaxMult: 1.25,
  /**
   * ★★ 2025：`b` 的封顶改成**阈值软上限**（用户选定）——
   *
   *   低于阈值：原样通过
   *   超过阈值：`b = 阈值 + 超出 · 2^(−超出/跨度)`   ← **与过载同一族的形状**（有界、平滑、可调）
   *
   * 为什么不用硬封顶：用户要求"第一次无限缩到 1h" ⇒ 需要 `b ≈ 0.08`
   *   （1h 跨 283 阶），而硬封顶 0.02 在结构上做不到 ✗
   *   软上限则"允许冲上去、但在远处收紧"✓ 既满足 1h，又保住"不许 runaway"的意图 ✓
   */
  bSoftKnee: 0.13,
  /** 软上限的压紧跨度（越大越宽松） */
  bSoftSpan: 0.09,
  bMax: 0.02,
  /**
   * ★ 档位加速系数：`qm2` 达成后每档位乘它。
   *
   * ⚠️ 数值由**数值反解**给出，我最初手算是 1.06、**错了**：
   *   `1.06^24 = 4.05` ⇒ 24 档只花 62.6h，比 ×1.75 标尺（89.86h）快 1.44× ✗
   *   反解结果 **1.0209** ⇒ 合计 89.86h ✓（`quantum-particle-lab` §④ 有断言）
   */
  tierAccel: 1.10,
  /**
   * ★ 暗能量的指数增长速率常数（**替代 R 的那一位**）。
   *
   * `dDE/dt = a(DE)·DE` ⇒ `d(log10 DE)/dt = a(DE)`，即 log 空间里的斜率。
   * `a(DE)` 随当前暗能量**衰减**（软上限）但**有下限**（用户第 3 条：不会停摆）。
   *
   * ★ 数值 2025 修正（引擎提前到第一次大坍缩之后）：
   *   a(DE) 从**引擎到手**那一刻就开始跑，所以 a0 必须按
   *   「引擎到手 → 买到门槛压平（打破无限）」的**整段时长**标定，而不是按一次大坍缩 ✗
   *   整段 ≈ 10h ⇒ a0 = 50 / 36000 ≈ **0.00139 阶/秒** ✓
   *   （旧值 0.00621 会让 DE 在 3.41h 就撞 1e50 ⇒ 买开关时基准≈上限 ⇒ 跨度层白买 ✗
   *     断言见 `tools/infinity-ladder-lab.mjs`）
   *
   * ⚠️ 由 **ZPE 引擎**负责放大它（用户声明：引擎主负责打破无限→永恒这一段）。
   */
  a0: 0.003112,
  /** 衰减拐点（阶）：低于它不衰减 */
  aKnee: 30,
  /** 每多少阶减半 */
  aHalving: 8,
  /** 下限（占 a0 的比例）：保证永不停摆 */
  aFloor: 0.15,
  // ⚠️ 这三个字段 **已删除**（2025 引擎机制重做，用户裁定 A 方案）：
  //   `engineLevelCoeff` / `prodLevelCoeff` / `multLevelCoeff`
  //   ⇒ 全部搬到 `ENGINE_MECH`（`add` / `prod` / `mult` / `de`），因为
  //     ①④ 从"线性"改成了**饱和式**、②②b 的系数也重新标定过了 ✓
};

/**
 * 暗能量的指数增长速率 `a(DE)`：随当前暗能量衰减，但**不低于下限**。
 *
 * ⚠️ 这是**替代 R** 的那一位（`R` 是"物质 log 的斜率"，`a` 是"暗能量 log 的斜率"）。
 *    接线时要注意：它必须落在**环的输出侧**（ZPE→DE），不许接回熵阱/ZPE/全局加成。
 */
/**
 * ★★ 2025「开根削弱」：ZPE 引擎等级对**暗能量自增长**的倍率。
 *
 *   线性（旧）  `1 + 0.1×等级`        ⇒ 与深度复利 + 跨度层相乘 ⇒ **指数 runaway** ✗
 *   开根（新）  `1 + 0.1×√等级`       ⇒ `dx/dt ∝ √x` ⇒ x ∝ t²（多项式 ✓，自我减速 ✓）
 *
 *   数值对照：等级 100 ⇒ 旧 ×11 ／ 新 ×2 ｜ 等级 1021 ⇒ 旧 ×103 ／ 新 ×4.2 ✓
 *   见 `tools/post-break-runaway-lab.mjs`（拉表 + 断言）。
 */
export function deEngineLevelBonus(level) {
  const lv = Math.max(0, level ?? 0);
  if (!Number.isFinite(lv) || lv <= 0) return 1;
  // ★★ 2025 二次修订：改成**饱和式**（见 `ENGINE_MECH`）。
  //   原来 `1 + 0.1×等级` 是线性 ⇒ 真无界 ✗ 与"内部机制可以有终点"冲突。
  //   ⇒ `1 + A·x/(1+x)`，x = lv/knee；A=20 ⇒ 极限 ×21 ✓
  const { A, knee } = ENGINE_MECH.de;
  const x = lv / Math.max(1e-9, knee);
  return 1 + A * (x / (1 + x));
}

export function deGrowthRate(state, engineMult = 1) {
  const L = Math.max(0, (state.darkEnergy ?? new Decimal(1)).max(1).log10().toNumber());
  const decay = L > DE_SPAN.aKnee ? Math.pow(2, -(L - DE_SPAN.aKnee) / DE_SPAN.aHalving) : 1;
  const a = Math.max(DE_SPAN.a0 * DE_SPAN.aFloor, DE_SPAN.a0 * decay);
  // ★ 量子里程碑 qm4：暗能量自增长速率 ×1.25（见 docs/QUANTUM-MILESTONES.md）
  const qm = state.quantumMilestones?.qm4 ? 1.25 : 1;
  return a * qm * Math.max(0, engineMult);
}

/**
 * 粒子增幅速率的**封顶**（硬上限）。
 *
 * ★ 量子里程碑 qm7 放宽它：`0.02 → 0.025`（×1.25）。
 *
 * ⚠️ 为什么 qm7 不改成别的：它原来是"跨度幂 k +0.25"，但**构造上就是死的** ——
 *   实测：q = 100 时 k 已经到封顶 6.1651，而 qm7 要 **300** 累计对数 ⇒ 拿到它时永远加不进去 ✗
 *   而 `bMax` 是**真正卡住阶梯**的那个约束（`infinity-ladder-lab`：
 *   N≥4 需要 b ≥ 0.0236 > 0.02 ⇒ 数学上做不到）⇒ 放宽它才有意义 ✓
 */
/** 档位加速倍率的**软上限拐点**：低于它原样通过（设计要求"≤24 档 ≈ ×9.85"完整保留 ✓） */
const TIER_ACCEL_KNEE = 12;
/** 档位加速软上限的跨度（上界 = 拐点 + 它 = ×18） */
const TIER_ACCEL_SOFT_SPAN = 6;
/**
 * ★ 2025 B1 修复：档位加速倍率必须**有界**。
 *
 * 原式 `Math.pow(tierAccel, tiers)` 直接吃**无界的**大坍缩次数：
 *   · 设计要求只在 ~24 档内成立（`1.10^24 ≈ 9.85`）；
 *   · 而破∞后坍缩会 runaway（TODO B3"坍缩刷屏"，实测 7448 次）⇒ `1.10^7448 = Infinity`
 *   ⇒ `b = Infinity` ⇒ `softCapB` 里 `over/span = Infinity` 与 `1 + Infinity` 相除
 *     ⇒ **NaN** ⇒ 粒子/物质全链冻结（stage-timing 的 `物质=1eNaN`，B1）✗
 *
 * 用与 `softCapB` **同族**的单调软上限压住（有界 = knee + span ✓ 平滑 ✓ 不减 ✓）。
 * `∞` 由此落成有限值，不再产生 NaN ✓
 */
export function tierAccelMult(state) {
  if (!state.quantumMilestones?.qm2) return 1;
  const tiers = Math.max(0, (state.bigCrunchCount ?? 0).toNumber ? (state.bigCrunchCount).toNumber() : Number(state.bigCrunchCount ?? 0));
  const raw = Math.pow(DE_SPAN.tierAccel, tiers);
  if (!Number.isFinite(raw)) return TIER_ACCEL_KNEE + TIER_ACCEL_SOFT_SPAN;
  if (raw <= TIER_ACCEL_KNEE) return raw;
  const over = raw - TIER_ACCEL_KNEE;
  return TIER_ACCEL_KNEE + over / (1 + over / TIER_ACCEL_SOFT_SPAN);
}

/**
 * ★★ 2025 B7：**b 的软上限随引擎等级放开**（拆掉「效果封顶」✗）
 *
 * ── 为什么必须改（实测现场）──
 *   原式上界恒等于 `knee + span = 0.22`（与引擎无关）⇒ 是**效果封顶** ✗
 *   实测：把引擎倍数从 1 拉到 1e12（12 个数量级），`softCapB` 之后的 b
 *   只从 0.0335 涨到 0.22（**6.6 倍**）✗
 *   ⇒ 引擎的乘法被自己的软上限吃掉 ⇒ **引擎当不了「打破无限 → 永恒」的主推进** ✗
 *     （用户定位：引擎 ≈ AD 的星系 / 接手复制器的辅助职责 ⇒ 它必须真的能放大产出）
 *
 * ── 改法（用户 2025 决策）──
 *   用户要的是**成本曲线**控节奏，**不要效果封顶**（与 AD 一致：AD 封价格、不封效果）
 *   ⇒ knee 与 span **按同一倍率一起放大**（保持同族形状 ⇒ 单调 ✓ 平滑 ✓ 有界 ✓）
 *   ⇒ 上界 = `mult × (knee + span)`，随引擎等级线性增长
 *
 * ── 为什么倍率取 `1 + 0.5×等级`（**待标定，但形状是对的**）──
 *   · 拉到 b ≈ 6.2e3 阶/秒（≈ 一轮走完 283 阶 ⇒ 单轮够拿 1e280 量级）需要约 1.24e4 级；
 *   · 该倍率下 1.24e4 级 ⇒ 上界 ≈ 1240（够），而 1 万级 ⇒ 5580（有余量）；
 *   · 系数 `0.5` 是**唯一的旋钮**：调大 ⇒ 更早放开（更快到顶，但更接近 runaway）；
 *   · ⚠️ 它**不是**自由参数：要按 `docs/TODO.md` B7 的表标定（目标 = 54.05h 到 1e280 基础值）。
 *
 * ⚠️ 本函数只影响**上界**，不影响拐点以下的线性段 ⇒ 前期手感零回归 ✓
 * ⚠️ 必须走 `effectiveEngineLevel()`（唯一入口）—— 否则 IC 挑战修饰器会被绕过 ✗（显示≠实发）
 */
export const B_CAP_PER_LEVEL = 0.5;
export function bCapMult(state) {
  const lv = effectiveEngineLevel(state).toNumber();
  if (!Number.isFinite(lv)) return 1;
  return 1 + B_CAP_PER_LEVEL * Math.max(0, lv);
}

/**
 * ★★ 2025 B8：**物质层的 b区（指数区）成员 —— 由引擎等级控制**
 *
 * ── 为什么是这里（用户给的框架 + 用户裁定）──
 *   规范：`资源_next = { [ … ] ^ 指数区 } × 最终倍率区`
 *   用户裁定两条：
 *     ① "IP 全部来自**基础物质**（基础公式），**不看升级** ✗"
 *        ⇒ 要跨到永恒的 IP，必须让**基础公式的输入（物质深度）**变大，
 *          而不是再加一个 IP 升级（那会变成 IP→IP 平行环，违反 `PROGRESSION §0.3` 骨架）
 *     ② "b区 的成员**由引擎控制**"
 *        ⇒ 引擎的落点从「抬 ZPE 产出」升级为「改物质曲线的**形状**」
 *
 * ── 数学为什么这样才够（我前面几轮的核心结论）──
 *   a区（乘法）只改**高度**：`log10(物质)` 的斜率仍由 b 钉住（= 2.17 阶/秒）
 *     ⇒ 54 小时最多 `2.17×194580 = 4.2e5` 阶 ⇒ 看似够，
 *       但**每轮都被大坍缩清零**，实际峰值只推进 2 阶/小时 ⇒ 永远到不了 ✗
 *   b区（指数）改**斜率**：`总量 = base^k` ⇒ `d log10(总量)/dt = k · d log10(base)/dt`
 *     ⇒ **斜率被放大 k 倍** ⇒ 这才是"用升级撬动基础物质"的正统位置 ✓
 *
 * ── 判据：**必须同时单调、有界**（项目既有红线）──
 *   · 单调 ⇒ 引擎等级越高越强（不许出现"越买越弱"）
 *   · 有界 ⇒ **不许 runaway**：`k` 若继续随等级无界增长，
 *     `d log10(N)/dt = b·k` 会随 t 二次增长 ⇒ 有限时间奇点 ✗（与 ZPE 的 `a≥1` 同一个病）
 *   ⇒ 用**单调饱和**形状：`k = 1 + kMax·x/(1+x)`，`x = 等级/knee`
 *     （与 `softCapB` / `effectiveDarkEnergyLog10` 同一族，项目里已有三处用这个形状）
 *
 * ── 标定 ──
 *   · `kMax = 25`：反解自"到 1e280 基础 IP 需 `log10(物质) ≈ 8.65e4` 阶"
 *     （`k ≈ 25` 时，约 2 小时内即可跨完；k=1 时永远到不了）
 *   · `knee = 2000`：约 2000 级吃到 `kMax` 的一半（`k ≈ 13`）
 *   ⚠️ 两个常数都是**待标定**的旋钮，但形状（单调饱和）是硬要求 ✓
 *
 * ⚠️ 安全性说明（为什么它**不进** S 池）：物质不在「熵阱 ↔ ZPE」那个主环里，
 *   所以对物质取幂不会放大环增益。这条与 R 当年被删的理由不同 ——
 *   R 是**速率常数**（只改速度、改不了形状 ⇒ 可玩性窄），b区 改的是形状 ✓
 */
/**
 * ★★★ 2025 终稿（用户裁定，H2）：**b区指数 k 的标度**。
 *
 *   目标：物质到 **1e95000** ⇒ IP = 1e308.25（见 `docs/TODO.md` H 段）
 *   实测（表二，`runSeconds=300`）：**k ≈ 5.95 正好命中目标**
 *     k=5.9 ⇒ 单轮 IP 1e276.3（差 32 阶）
 *     k=6.0 ⇒ 单轮 IP 1e380.8（超 72.6 阶）
 *   ⇒ 满值只需 **6**（原来的 26 毫无意义：k=8/10/14 只是数字更大、无新意义）
 *
 *   标度：`k(lv) = 1 + KMAX·x/(1+x)`，`x = lv/KNEE`
 *     KNEE = 100 ⇒ 100 级 ⇒ k = 3.5｜300 级 ⇒ 4.76｜1000 级 ⇒ 5.55｜趋近 6
 *     （与用户裁定 C「1e28 池 ≈ 100 级」对齐：那时 k 已到一半以上 ⇒ 机制有实质强度 ✓）
 */
export const MATTER_B_KNEE = 100;
export const MATTER_B_KMAX = 5;
export function matterTotalExponent(state) {
  const lv = effectiveEngineLevel(state).toNumber();
  if (!Number.isFinite(lv) || lv <= 0) return 1;
  const x = lv / MATTER_B_KNEE;
  return 1 + MATTER_B_KMAX * (x / (1 + x));
}

export function bThresholdOf(state) {
  const qm = state.quantumMilestones?.qm7 ? DE_SPAN.qm7BMaxMult : 1;
  return DE_SPAN.bSoftKnee * qm * bCapMult(state);
}

/**
 * ★ 阈值软上限：把原始 `b_raw` 压成实际生效的 `b`。
 *
 *   `b ≤ 阈值`  ⇒ 原样
 *   `b > 阈值`  ⇒ `阈值 + 超出 / (1 + 超出/跨度)`   ← 有界（上限 = 阈值 + 跨度）
 *
 * 与「过载」同一族的形状 ✓（`2^(−超出/x)` 的单调化版本）—— 项目里已有多处用这个形状。
 * ★ 2025 B7：拐点与跨度都乘 `bCapMult()` ⇒ **上界随引擎等级放开** ✓（不再是效果封顶）
 */
export function softCapB(bRaw, state) {
  const cap = bCapMult(state);
  const knee = bThresholdOf(state);
  const span = DE_SPAN.bSoftSpan * cap;
  // ★ 2025 B1：非有限入参守卫 —— 原式在 `bRaw = Infinity` 时
  //   `over/span = Infinity`、`1 + over/span = Infinity` ⇒ Infinity/Infinity = **NaN** ⇒
  //   粒子/物质全链被污染（stage-timing 的 `物质=1eNaN`）。这里直接给上界 ✓
  if (!Number.isFinite(bRaw)) return knee + span;
  if (bRaw <= knee) return bRaw;
  const over = bRaw - knee;
  return knee + over / (1 + over / span);   // ★ 单调递增 ✓ 上界 knee+span ✓（旧式 x·2^(-x/span) 会在 x>1.44·span 后**反向下降** ✗）
}

/**
 * ★ 2025「步首快照」的统一入口：**量子个数**的读取。
 *
 * 为什么需要它：`advance` 把时间按 5 秒切 chunk，每 chunk 调一次 tick ✗
 *   而量子是**阈值跳变**量（捕获一次 +2）⇒ 后面的 chunk 会用上跳变后的 q，
 *   界面显示的却是起始 q ⇒ "显示 == 实发"分叉（实测物质偏 41% ✗）
 *   ⇒ 短步（≤30s）里由 `advance` 设 `state.quantumFrozen`，
 *     所有"量子派生"的读取都走这里 ⇒ 整步用**同一个 q** ✓
 *   ⚠️ 它只冻结**读取**，不动 `state.quantum` 的累计 ✓（第一版草稿就是错在覆盖 state ✗）
 *   ⚠️ 长步（离线）**不冻结**：否则离线几小时的量子进展会被拉平 ✗
 */
export function qOf(state) {
  return state.quantumFrozen ?? state.quantum ?? new Decimal(0);
}

/**
 * ★ 2025 设计稿修订：**量子对 ZPE 倍率的加成**（加法区）。
 *
 * 形制照抄 `darkEnergyMultiplier` 里的 `+q²`（同一个"量子作为基础加成加进括号里"的先例 ✓）
 * ⇒ 走**加法区**，相对漂移极小 ⇒ 不破坏"显示 == 实发" ✓
 *
 * ⚠️ **数值待定**（用户：得算数据）—— 现在给三种候选，用 `--q` 参数切换：
 *   "2"  ⇒ `+q²`   （与暗能量倍率同款：起步猛、后期被引擎的 2^等级 盖过）
 *   "3"  ⇒ `+q³`   （中后期也有存在感）
 *   "exp"⇒ `×2^q`  （指数，后期极强 ✗ 有失控风险，**不推荐**）
 */
export const QUANTUM_ZPE_MODE = "3";   // ★ 用户 2025 选定 +q³（后续会有额外加成弥补，画饼 ✓）
/**
 * ★ `q³` 的**系数**（数学公式拉表得出，见 `tools/quantum-zpe-coeff-lab.mjs`）。
 *
 * 判据：① q≈4（首次大坍缩附近）给 ZPE 倍率 ×2~×4 的观感
 *       ② q≈30（常规一轮）等效 8~12 级引擎（`log2(c·q³)`）
 * 反解：① ⇒ c ∈ [0.0743, 0.2229]；② ⇒ c ∈ [0.0095, 0.1517]
 *       ⇒ 交集 [0.0743, 0.1517] ⇒ 几何中点 0.106 ⇒ **圆整 0.1** ✓
 * 等价说法：量子项 ≈ 一个 `3·log2(q) − 3.3` 级的 ZPE 引擎 ✓
 * ⚠️ 斜率天然陡（q×10 ⇒ 项×1000）⇒ 系数必须小 ✓
 */
export const QUANTUM_ZPE_COEFF = 0.1;

/**
 * ★★★ 2025：`bonus` = 引擎账（`engineBonusMult(state)`）——**可选第二参**。
 *
 *   ── 为什么要有它（否则"显示 ≠ 实发"）──
 *     用户裁定：量子给的 5 条加成**全部**要吃引擎倍率（`engineBonusMult`）。
 *     我第一版把它乘在 `formulas.js` 的**调用处**（为了不动 `audit.mjs` 的老断言）✗
 *     后果（实测）：**量子面板显示 +21600，而实发 +1e36**（差 1e31.7 ✗✗）
 *   ⇒ 修法：**账乘在函数体内**，显示与实发**共用这一个函数** ✓
 *     面板调用时同样传 `engineBonusMult(state)` ⇒ 显示 == 实发 ✓
 *
 *   ⚠️ 不传 `bonus` ⇒ 退化为"纯量子给的部分"（老断言 `quantumDeMultBonus(q)===10000`
 *      因此仍然成立 ✓；也方便 lab 单独测量子那一层）
 */
export function quantumZpeMultBonus(quantum, bonus = null) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(0);
  let v;
  if (QUANTUM_ZPE_MODE === "exp") v = new Decimal(2).pow(q).sub(1);
  else if (QUANTUM_ZPE_MODE === "3") v = q.pow(3).mul(QUANTUM_ZPE_COEFF);
  else v = q.pow(2);
  return bonus ? v.mul(bonus) : v;
}

/** 跨度幂 k：由**量子个数**的开根给出，封顶 `DE_SPAN.kMax` */
export function matterSpanExponent(state) {
  // ⚠️ config.js 没有 `D()` 辅助函数（那是 state.js 的），直接用 new Decimal
  const q = Math.max(0, (state.quantum ?? new Decimal(0)).toNumber());
  const raw = 1 + DE_SPAN.kCoeff * Math.sqrt(q);
  return Math.min(raw, DE_SPAN.kMax);
}

/**
 * 跨度乘数 `(DE / DE₀)^k`。**未买「门槛压平」时恒为 1**。
 *
 * ⚠️ 2025 起"基准"与"开关"是**两件事**（之前我用 `spanDeBase > 0` 兼任开关，需求变了）：
 *   · **基准 `DE₀`**：在 **ZPE 引擎到手时**记录（引擎把 `a(DE)` 打开，DE 从那一刻起指数增长）
 *   · **开关**：`thresholdFlatBought`（无限升级「门槛压平」，需先打破无限）
 *   ⇒ 这样"引擎到手 → 买到开关"期间 DE 的增长**全部**被换算成跨度 ✓
 *   （否则若在买开关时才记基准、而 DE 早已撞到 1e50 ⇒ 跨度乘数 ≈ 1 ⇒ 跨度层白买 ✗）
 */
export function matterSpanMult(state) {
  if (!state.thresholdFlatBought) return new Decimal(1);      // 开关：门槛压平
  const base = state.spanDeBase ?? new Decimal(0);
  if (base.lte(0)) return new Decimal(1);
  const de = state.darkEnergy ?? new Decimal(0);
  if (de.lte(base)) return new Decimal(1);
  // ★ 方案乙：改用**有效量**（越 1e50 后渐近饱和 ✓ 见 DE_EFF_CAP ✓）
  const dEff = Decimal.pow(10, effectiveDarkEnergyLog10(state));
  return dEff.div(base).pow(matterSpanExponent(state));
}

/**
 * 汇总已购量子升级的效果（占位标题保留）
 */

// ★ `darkMatterMultiplier(10^DM)` 已移除 —— 暗物质体系整个删除。
//   它是「阶梯 3 秒」的形式性元凶（把曲线平移 1e560 个数量级）。
//   现在由「粒子时变增幅」（`particleTimeBoost`）与「暗能量跨度层」提供。

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

  /**
   *
   * ⚠️ **实测重解过**（R 删除之后）：
   *   · 模型初值 0.035 是在"R 还在"时按"每次超出 43 阶"反解的；
   *   · 真实引擎（60h 仿真）实测：打破无限用了 **14 次**坍缩（每次 ~9 IP）
   *     ⇒ 真实的"超出阶数"只有 **~27 阶**（贪心策略收得更早，不是 43）✗
   *   · ⚠️ 我按 "要 42 IP/次" 反解成 `c ≈ 0.060` 并实测 —— **结果更慢**（50h 只有 4 次坍缩、
   *     IP 才 1e1.70）✗ ⇒ **已回退到 0.035**（实测基线：60h / 14 次 / 57.97h 达成）✓
   *     教训：**"IP/次"不是唯一变量** —— 多出来的 IP 会被策略花在起点跃迁/速率解放上，
   *     从而改变物质爬升与坍缩节奏。想调这一段，模型必须**把"IP 花在哪"也建进去** ✗
   *     （`infinity-ladder-lab` 目前只看"IP/次"，**不足以**预测这一段）
   *
   * 为什么必须加：IP/次 恒为 1 ⇒ 128 IP 要 128 次大坍缩 ⇒ 与"慢速大坍缩"（R 已退休）冲突 ✗
   */
  /** ★ 深度软上限（用户方案 c / 甲档）：超出 knee 的部分被 `2^(−超出/跨度)` 压紧，上界 = knee + span/ln2 */

  /**
   * 买下「打破无限」要多少无限点。
   *
   * ⚠️ 128 是**刻意的**：这一层的设计意图是「让玩家多次无限来攒无限点」，
   *    所以门槛要落在大约 3~5 次无限才能攒到的位置。
   *    每次无限的基础收益是 `firstCrunchIP = 1`，所以光靠大坍缩本体是攒不到的 ——
   *    真正的收入来自「无限长河」（④，按耗时给点）和「无限增幅」（①，收益翻倍）。
   *    实测（tools/infinity-sim.mjs）：约 5 次无限 / 8~9 小时可买下。
   */
  unlockCost: 128,

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
  ipExponent: 2 };

/** 大坍缩阈值的显示字符串（和实际值同源，不会脱节） */
export const CRUNCH_AT_LABEL = (() => {
  // ★★★ 2025（用户裁定）：**统一科学计数法为 `1.00e308`**
  //   ⚠️ 原来是 `1e${maxLog10.toFixed(4)}` = **`1e308.2547`** —— 这个写法**是错的/误导的**：
  //     它的意思是 `10^308.2547` = **1.7977e308**，但字面看着像"e 后面跟了个小数" ✗
  //   ⇒ 规范写法 = `1.80e308`（尾数 × 10 的整数次幂）✓
  const v = Decimal.pow(10, BREAK_INFINITY.maxLog10);
  const exp = Math.floor(BREAK_INFINITY.maxLog10);
  const mant = v.div(Decimal.pow(10, exp)).toNumber();
  return `${mant.toFixed(2)}e${exp}`;
})();

// ══════════════════════════════════════════════════════════
// 过载（打破无限之后的**软上限**）
// ══════════════════════════════════════════════════════════

/**
 * 未打破无限时，物质被**硬顶**在 1e308.2547，到顶强制大坍缩（保持原样）。
 * 打破之后不再有硬顶，改走**过载**：超过拐点后，物质产出速率每 `halvingOrders` 阶减半。
 *
 *   `d(log10 M)/dt = R(q) · 2^(−(L − 拐点)/halvingOrders)`
 *
 * ── 为什么必须是"软"的 ──
 *   硬顶会让"再深一点"变成不可能，于是任何"用无限点买的东西去抬上限"的设计
 *   都会掉进自指闭环：`cap = f(IP(cap))` 只有两种结局 —— 卡死（f 次线性）
 *   或刀刃爆炸（f 超线性）。软上限把"能不能过去"换成"过去得有多慢"：
 *     · 进度永远有一点，不存在死锁；
 *     · 深度按 `ΔL = D·log2(1 + ln2·R·t/D)` 随时间**对数增长**（D = halvingOrders）；
 *     · 实测（_sim 沙盒）：D=10 → +43 阶/次、约 6 分钟；D=20 → +87 阶/次、约 8.4 分钟。
 *
 * ── 量子推迟拐点 ──
 *   `拐点 = 308.2547 + 每量子推迟阶数 × 量子数`
 *   0.00432137 = log10(1.01)，即「每量子稳定 1%」的等价写法。
 *   拐点越高，能推得越深（收益侧的无限点也随深度增长）。
 *   ⚠️ 注意这里只乘**当前量子数**：大坍缩会把量子清零，所以每轮都要重新累积。
 */
export const OVERLOAD = {
  /**
   * ★★★ 2025（用户裁定）：**过载的触发门槛 = 「基础物质获得速率」**，不是物质数量。
   *
   *   用户原话：「过载机制生效的时间应该在**基础物质获得速率大于 1.8e308** 时生效
   *             （**有且只影响获得速率**）」
   *   以及对速率的定义：「**每秒能获得多少**」⇒ 就是 `d(资源)/dt` 的倍率。
   *
   *   ⚠️ 旧实现用 `matter.log10() > 拐点(308.25 + 0.00432×量子)` 判触发 —— 那是**数量**口径 ✗
   *      （那个"拐点"原本是给"物质到顶强制大坍缩"用的，被借来当过载触发点）
   */
  rateThreshold: new Decimal(Number.MAX_VALUE),   // = 1.7976931348623157e308
  /**
   * 上式的 **log10 预计算值**（= 308.2547…）。
   *
   * ⚠️ 判定必须在**对数域**做：物质获得速率是 Decimal，实测 168h 已达 **1e1943** ⇒
   *   若把 rate 转成普通 number（或 `Number(...)`）比较 → **溢出成 Infinity**
   *   ⇒ 判定恒为"超阈"、因子恒为极小 ✗（我第一版就踩了这个）
   *   ⇒ 统一用 `rate.log10()` 与这个常数量级比 ✓
   */
  rateThresholdLog10: new Decimal(Number.MAX_VALUE).log10(),

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 二次重做（用户裁定 **方案 B**）：**渐近式**削弱因子
  // ══════════════════════════════════════════════════════════
  // ── 为什么必须从「指数式」换成「渐近式」──
  //   用户质疑：「虽然是仿照 AD 中复制器的增长削弱逻辑，但**为什么能变成负增长**呢？」
  //   ⇒ 完全正确，而且能算出根因：
  //     `s = |d ln(factor)/d over|`，硬约束 **`k·s < 1`**（k = 引擎的 b区指数）
  //     · 旧指数式 `1.2^(−over/2.63)` 配 `tierShift` ⇒ `s = (ln1.2/2.63)·(1+0.25·档数)`
  //       **随档数无上界增长** ⇒ 实测 over=5000 时 `s = 8.72`、`k·s = 120` ≫ 1
  //       ⇒ **速率随 base 上升而下降** = 负增长 ✗（用户感觉到的就是这个）
  //     · 渐近式 `1/(1+over/knee)^p` ⇒ `s = (p/knee)/(1+over/knee)` **随 over 递减**
  //       ⇒ 只要 `p/knee < 1/k` 就**永远**不越界 ✓（与 over 无关，结构性安全）
  //
  //   ⚠️ AD 的真正做法是因子乘在 **interval**（时间）上（`scaleFactor = 1.2 > 1` ⇒ 变慢），
  //      而我们乘在 **rate**（数量）上 ⇒ **同一个公式、一个让「变慢」一个让「变少」**。
  //      渐近式的作用就是把"变少"压回"变慢"（因子有下界、速率与 base 同阶增长）✓
  //
  // ── knee = 8430 的依据（这是可算的，不是拍的）──
  //   用户要求：「获取 ip 的公式中 ip 大于 e308.25 时，**推进到那个点不费更多时间**」
  //   实测（物质首次触及硬顶 1e308.25 的现场，11.13h）：
  //       物质 = 1e533.8｜**速率 = 1e751.9**｜`over` = 751.9 − 308.2547 = **443.7 阶**
  //       旧指数式在该点的因子 = **1.66e−47** ⇒ 那一段被砍掉 47 个数量级 ✗
  //   ⇒ 要"不多花时间"就得 `因子(over=443.7) ≈ 1` ⇒ `knee ≫ 443.7`
  //     目标「最多慢 5%」（因子 ≥ 0.95）⇒ `knee ≥ 443.7 × 0.95/0.05 = 8430` ✓ **方案 B**
  //   ⇒ 附带好处：`k·s = k·p/knee = 26/8430 = 0.0031`（上限 1.0）⇒ **余量 99.7%** ✓
  //
  //   ⚠️ 代价（必须记住）：过载在 `over ≲ 4000` 阶内几乎不起作用 ⇒ 它变成**纯晚期软上限**。
  //      前期/中期完全不拦 —— 这是"不多花时间"这个要求必然带来的。
  knee: 8430,
  /** 幂指数 `p`。取 1 使 `p/knee = 1.19e-4` 极小 ⇒ 安全性最大化（`p` 越大越陡） */
  p: 1,
  /**
   * ★ **自动坍缩的过载阈值**（`overloadFactor` 低于它就认为"这一轮跑够了"）。
   *
   *   ⚠️ **必须与 knee 一起标定**：渐近式的因子有**下界 0**、但下降极慢
   *     ⇒ 若 `crunchBelow` 定得太小（比如 0.05），要 over = 19·knee = 1.6e5 阶才到
   *     ⇒ 自动坍缩可能**永远不触发** ⇒ 卡住 ✗
   *   ⇒ 由 `tools/overload-lab.mjs` 断言「在合理深度内一定可达」✓
   *     实测该点的 over 在数百~数千量级，故取 0.5（over = knee = 8430 阶处到达）
   */
  crunchBelow: 0.5,
  /**
   * ★★★ 2025（用户裁定）：**本轮时长上限（秒）—— 收手判据改成「按时间」**。
   *
   *   ── 为什么必须挪掉「按速率」──
   *     `k`（b区指数）直接放大 rate ⇒ 按 rate 收手时 `k↑` ⇒ **更早收手** ⇒ 深度变浅
   *     ⇒ "k 越大 = 越快但收入越低"，**方向反了** ✗
   *     （实测：k 每 +1 ⇒ 收手深度 **−3646 阶** ⇒ 收入 −11.84 阶）
   *   ── 按时间收手后 ──
   *     `k↑` ⇒ 同样时间内推进更深 ⇒ 深度↑ ⇒ 收入↑ ⇒ **k 变成纯收益** ✓
   *     而且它让用户要的机制成立：「**基于最快的一次无限时间**给量子加成」
   *     （k↑ ⇒ 更快 ⇒ T_best 更小 ⇒ 加成更高 ⇒ 正反馈，但被这个时间上限钉住 ⇒ 不发散 ✓）
   *
   *   ⚠️ 这是**基线值**。用户要的机制会让它随 `T_best` 变化（见 `QUANTUM_SPEED`）。
   *   ⚠️ 旧的 rate 判据在 `shouldCrunch` 里**保留为兜底**（时间到不了时仍能收手 ⇒ 不卡死）。
   */
  runSeconds: 300,

  // ══════════════════════════════════════════════════════════
  // ★ 2025 已删除的字段（用户裁定「该拆掉的就拆」）
  // ══════════════════════════════════════════════════════════
  //   `factor: 1.2`        —— AD 的 scaleFactor；渐近式不用它（改由 knee 定形状）
  //   `halvingOrders: 2.63`—— 指数式的步长；正是负增长的来源（s 随档数无上界）
  //   `tierShift: 0.25`    —— 分档累进；在渐近式里**只会把 s 推陡** ⇒ 纯有害 ✗
  //   `stepOrders: 10`     —— tierShift 的档长，随之删除
  //   `quantumDelayPerQuantum` —— 旧"数量拐点随量子推迟"的参数；触发量已改成速率，无读取方
};

/**
 * 打破无限后的物质上限（阶）—— **只是显示用的口径**。
 *
 * ⚠️ ★★★ 2025：**过载的触发量已改成「速率」**（见 `OVERLOAD.rateThreshold`）⇒
 *   本函数**不再参与过载判定**，只留给界面显示"打破后物质能推到哪里"。
 *   它**不再随量子推迟** —— `quantumDelayPerQuantum` 是数量口径的遗留，已删除
 *   （速率口径下"量子把拐点往上推"没有对应物）。
 *
 * ⚠️ 待办：它与 `BREAK_INFINITY.maxLog10` 只差一个"量子推迟"，而现在那个推迟没了
 *   ⇒ 本函数已**完全等于常量** ⇒ 应当整体删除、调用方直接用 `BREAK_INFINITY.maxLog10`。
 *   删它会牵动 `ui.js` 与 `crunch-speed-lab` / `de-span-lab` / `infinity-ladder-lab` 三个工具
 *   ⇒ 本轮先不删，记为待办。**它们现在都还在读它，别单独删**。
 */
export function overloadThreshold(state) {
  return new Decimal(BREAK_INFINITY.maxLog10);
}

// ⚠️ 2025 已删除：`overloadUsedOver(over)`（"每超一档 ⇒ 阈值被抬高"的分档累进）
//   删除理由：它是**负增长的直接来源** —— `s = |d ln(factor)/d over|` 随档数无上界增长，
//   实测 over=5000 时 `k·s = 120` ≫ 1 ⇒ 速率随 base 上升而下降 ✗
//   渐近式（`OVERLOAD.knee`）的 `s` 随 over **递减** ⇒ 结构性安全 ✓
//   详见 config.js 的 `OVERLOAD` 注释与本文件 `OVERLOAD.knee` 的标定说明。

// ══════════════════════════════════════════════════════════
// ∞ 层：无限升级（全部用无限点购买，不随大坍缩重置）
// ══════════════════════════════════════════════════════════

/**
 * 四个无限升级。效果的计算全部在 formulas.js / engine.js，
 * 这里只放**数据**（价格 + 效果参数 + 描述），和别的层一个规矩。
 *
 * ── 为什么这一层要有 ④「无限长河」──
 *   大坍缩本体的收益是 `floor((log10M / 308.2547)²)`，而物质被硬顶在 1e308.2547，
 *   所以**每次无限恰好 1 个无限点**，而一次无限又要 ≥ 94 分钟（R 被钳在 0.05 阶/秒）。
 *   光靠它，攒 128 点要 200 小时 —— 整层不可达。
 *   ④ 把一部分收入改成**按耗时**给（与深度无关），于是：
 *     · 每次无限都能稳拿一笔，攒门槛只需要几次无限；
 *     · 单位时间的收入是常数 `60 × 2^①等级` 点/小时，不随深度膨胀，
 *       这条环因此天然稳定（详细推导见 RESPONSES/设计讨论）。
 *
 * ── ④ 的读法 ──
 *   每 60 秒累计 1 点（连续结算，不是每秒跳一次）。所以
 *     「一次 104 分钟的无限」= 104 点；「一次 5 分钟的无限」= 5 点。
 *   两者**每小时都是 60 点**（再乘 ① 的倍率）—— 收快收慢收益相同，
 *   想强制「多次无限」的话需要给 ④ 加耗时上限（当前没加，属待定项）。
 */
export const INFINITY_UPGRADES = {
  /**
   * ① 无限增幅 —— **最终乘区**（乘在所有 IP 来源之后）
   *
   * ★★ 2025 用户裁定：形态**照抄 AD 源码** `InfinityUpgrade.ipMult` ⇒ 效果 `×2/级`（= `2^等级`）。
   *   唯一的实现在 `ipDoubleMult()`；显示侧（engine.js 的 `infinityUpgradeEffect`、
   *   ui.js 的收入明细）**都必须调它** ⇒ 防止再出现"显示 ≠ 实发"✗
   *
   *   职责：负责「1e280 基础值 → 1e308.25」那 **28.25 阶**（需 93.8 级）。
   *   节流：**只封价格、不封效果**（见 `IP_DOUBLE_AD`），与 AD 的 `costCap` 同思路。
   *
   *   ⚠️ 价格 `firstCost/costMult` 是在"线性版"时代标定的（首价 1、每级 ×10），
   *      换成 `2^等级` 后**必须重新标定**（否则 24 档阶梯会被 IP 侧打穿）——
   *      实测数据见 `tools/stage-timing.mjs`。
   */
  ipDouble: {
    id: "ipDouble",
    name: "无限增幅",
    repeatable: true,
    firstCost: 1,
    costMult: 10,
    /** ★ = AD 的 `DC.D2`（效果底数，`ipDoubleMult()` 与 `ipDoubleLogCost()` 共用） */
    effectMult: 2,
    zone: "ip",
    desc: "无限点收益 ×2/级（最终乘区：乘在所有来源之后）" },

  /** ② 无限点数量 → ZPE 倍率的**加法区**（a区） */
  /**
   * ★ 量子铸币（用户提案）：**单次 100 无限点**，之后每次大坍缩额外获得
   *   `floor(本次无限最大量子数 ^ 2)` 点无限点。
   *
   * 为什么需要它（诊断依据，`tools/stage-timing.mjs --profile`）：
   *   打破无限后 ④ 收入只有 540~1620 点/小时，而铸币起步价 1e4 ⇒ **24 小时买不到一级铸币**，
   *   阶梯的"种子"根本攒不出来。这一条把「ZPE → 量子 → 无限点」接通，
   *   正好补上种子（实测 q≈83 时给 6889 点 ≈ 起步价量级）。
   *
   * 安全性：q 的成长受量子门槛（每次 ×20）限制，`q ≈ 2·log20(ZPE)` ——
   *   所以 q² 只随 log²(ZPE) 增长，**是种子而不是 runaway**（q=138 时也才 1.9e4）。
   */
  /**
   * 门槛压平：量子门槛步长 ×20 → ×10（原稿候选 11；现在能放大 q² 收益）
   *
   * ★ 2025 追加职责：它同时是**跨度层的开关**（用户方案，见 docs/R-REPLACEMENT.md §11）。
   *   买下时记下当时的暗能量水位 `state.spanDeBase`，此后
   *   `物质产出 ×= (DE / spanDeBase)^k`，其中 `k = min(1 + c·√q, 6.1651)`。
   *
   *   为什么用它当开关：它是 ∞ 层升级 ⇒ 天然"打破无限之后"（早期不激活）；
   *   而且它本身就是量子相关的升级，与"k 由量子给"语义一致。
   *
   * ⚠️ 价格与门槛是**两个独立旋钮**：
   *   · 价格（现 128 IP）只影响"多久买得起"；
   *   · 门槛 `brokenInfinity`（在 `buyInfinityUpgrade` 里强制）保证"何时**可以**买"。
   *   用户仍在权衡价格（10 / 50 / 128），但门槛语义与价格无关 ⇒ 先上后调。
   */
  thresholdFlat: {
    id: "thresholdFlat",
    name: "门槛压平",
    cost: 128,
    desc: "量子门槛步长 ×20 → ×10，并开启跨度层",
    zone: "dm" },
  /** 涨落增幅：每对量子 +2 → +3（原稿候选 10） */
  pairBoost: {
    id: "pairBoost",
    name: "涨落增幅",
    cost: 5,
    desc: "每对量子 2 → 3",
    zone: "dm" },
  /**
   * 未花 IP 加产率（原稿候选 15，AD `unspentBonus` 同源）：a区 产率按**未花无限点**提升。
   *
   * ⚠️ **必须有硬上限**（用户指定：影响永恒阶段的东西要有极强软上限）。
   *    AD 原式 `(IP/2)^1.5 + 1` 单独看很危险：IP 到 1e308 时它是 1e462，
   *    物质爬升会被瞬间抹平（整条 24h 阶梯失去意义）。所以这里**封顶 ×1000**：
   *    它只在"攒铸币种子"的那几个小时里起作用，之后恒定 —— 定位是**种子**，不是 runaway。
   */
  // ⚠️ `unspentBoost`（沉潜蓄能）已整条删除（2025 用户裁定）—— 见上方 `unspentBoostMult` 的删除说明
  ipFromQuantum: {
    id: "ipFromQuantum",
    name: "量子铸币",
    cost: 100,
    desc: "大坍缩收益 +本次最大量子数²",
    zone: "ip" },
  ipToZpe: {
    id: "ipToZpe",
    name: "零点耦合",
    cost: 1,
    perIp: 1,
    zone: "zpe",
    desc: "ZPE 倍率 += 无限点数量" },

  /** ③ 无限点 → 相变仪转换速率（ZPE → 暗能量） */
  ipToTransmuter: {
    id: "ipToTransmuter",
    name: "相变超频",
    cost: 1,
    perIp: 0.5,
    zone: "de",
    desc: "相变仪速率 ×(1 + 无限点×0.5)" },

  /** ④ 每次无限的**耗时**换成无限点（每 60 秒 1 点） */
  ipTime: {
    id: "ipTime",
    name: "无限长河",
    cost: 3,
    /** 每多少秒给 1 点 */
    secondsPerPoint: 60,
    /**
     * 耗时上限（秒）：**1800 = 30 分钟**。
     *
     * 为什么要它：没有上限时"收快收慢每小时都是 60 点"，速度类升级（速率解放/起点跃迁）
     * 对 IP 收入完全没有意义。加上限后 `IP/小时 = 60 × 3^① × min(T,1800)/T`：
     *   · 单次 ≤ 30 分钟 → 吃满；
     *   · 单次 100 分钟（现状）→ 只有 30%。
     * 于是"把单次无限压进 30 分钟"变成明确目标（AD 的同类做法也是给上限而不是无限膨胀）。
     * 沙盒实测代价很小：打破无限 4.1h → 4.8h。
     */
    capSeconds: 1800,
    zone: "ip",
    desc: "每秒实时获得「1 ÷ 60」点（吃 ① 的加成），单次最多计 30 分钟" },

  // ══════════════════════════════════════════════════════════
  // ★ 加速「e25 → e308.25」那一段的两条线
  //
  //   为什么要专门为这一段加升级：这段原先的斜率 = R（已退休）—— 现在它们抬的是 `b`（粒子增幅速率）。
  //   而 a区 的产率升级对它完全无效（基础环比指数项小 1e200 倍，实测过）。
  //   所以只有两个真杠杆：**抬 R 的上限** 与 **缩短距离（抬高开局物质）**。
  //   量化（tools/infinity-sim.mjs / _sim 沙盒对齐过）：
  //     · 速率类：`t ∝ 1/R₀`，每 +10% → 单次无限 −9%
  //     · 起点类：从 1e25 提到 1e200 → 单次无限 −39%（在爬升衰减开启后）
  // ══════════════════════════════════════════════════════════

  /**
   * 起点跃迁 I~IV：**每次大坍缩之后**以指定的物质开局（AD `skipReset*` 的同源设计）。
   *
   * ⚠️ 只抬高"起点"，不改变上限 —— 所以它不改形，只缩短距离。
   *    数值用**绝对深度**（1e50/1e100/1e150/1e200），与最终的爬升衰减参数无关。
   */
  start50: { id: "start50", name: "起点跃迁 I", cost: 20, startLog10: 50, zone: "matter", desc: "每次大坍缩后以 1e50 物质开局" },
  start100: { id: "start100", name: "起点跃迁 II", cost: 40, startLog10: 100, zone: "matter", desc: "每次大坍缩后以 1e100 物质开局" },
  start150: { id: "start150", name: "起点跃迁 III", cost: 80, startLog10: 150, zone: "matter", desc: "每次大坍缩后以 1e150 物质开局" },
  start200: { id: "start200", name: "起点跃迁 IV", cost: 300, startLog10: 200, zone: "matter", desc: "每次大坍缩后以 1e200 物质开局" },

  /**
   * 速率解放 I~IV：抬 `b`（粒子增幅速率）的倍率 —— R 退休前它们抬的是 R 的上限。
   *
   * ⚠️ 用**百分比**而不是绝对值，这样最终 R₀ 定成多少都自动跟随 ——
   *    避免"改了 knee/D 以后这几条升级的数值全要重算"。
   */
  rate110: { id: "rate110", name: "速率解放 I", cost: 10, rateMult: 1.10, zone: "dm", desc: "粒子增幅速率 b ×1.10" },
  rate121: { id: "rate121", name: "速率解放 II", cost: 100, rateMult: 1.10, zone: "dm", desc: "粒子增幅速率 b ×1.10" },
  rate139: { id: "rate139", name: "速率解放 III", cost: 1000, rateMult: 1.15, zone: "dm", desc: "粒子增幅速率 b ×1.15" },
  rate167: { id: "rate167", name: "速率解放 IV", cost: 10000, rateMult: 1.20, zone: "dm", desc: "粒子增幅速率 b ×1.20" } };

/**
 * 无限升级的展示顺序（UI 与自检共用）。
 * UI 会把它排成 2×n 网格，所以顺序就是格子顺序（左→右、上→下）。
 */
export const INFINITY_ORDER = [
  "ipFromQuantum", "thresholdFlat", "pairBoost",
  "ipDouble", "ipToZpe",
  "ipToTransmuter", "ipTime", 
  "start50", "start100",
  "start150", "start200",
  "rate110", "rate121",
  "rate139", "rate167",
];


/** 大坍缩能拿多少无限点 */
export function infinityPointGain(matter, broken, state = null) {
  const m = matter instanceof Decimal ? matter : new Decimal(matter ?? 0);
  if (!broken) return new Decimal(BREAK_INFINITY.firstCrunchIP);
  const maxLog = Math.log10(Number.MAX_VALUE);
  const depth = m.gt(0) ? m.log10().div(maxLog) : new Decimal(0);
  if (depth.lte(0)) return new Decimal(BREAK_INFINITY.firstCrunchIP);
  /**
   * ★ 深度复利（2025 用户方案，见 docs/PROGRESSION.md 与 tools/infinity-ladder-lab.mjs）：
   *
   * `IP = floor( (L/308.2547)² · 10^(c·(L − 过载拐点)) )`
   *
   * · 前半是**现状**（G3 的"故意设计"内核保留：IP **只来自深度**）✓
   * · 后半是新增的**深度复利**：过载解除硬顶后，越推越深 ⇒ 每阶 ×10^c ✓
   * · `c ≈ 0.035` 由模型反解（让 128 IP 落在 **3 次**深坍缩内）——
   *   而"3 次"不是拍脑袋：`b` 的硬封顶 0.02 使 N≥4 在数学上做不到 ✓
   *
   * 为什么必须加它：IP/次 恒为 1 时，128 IP 要 **128 次**大坍缩，
   * 与"×1.75 标尺 + 慢速大坍缩"**根本冲突**（`infinity-ladder-lab` 有断言）。
   */
  const excess = m.log10().sub(BREAK_INFINITY.maxLog10).max(0).toNumber();
  // ★★ 2025（用户方案 c，甲档）：**深度软上限** —— 治"一次坍缩直接通关" ✗
  //
  //   病：破∞后上限解除 ⇒ excess 可以无限涨（实测能到 8800 阶 ✗）
  //       ⇒ 单轮 IP = 10^(0.0035×8800) = 1e308 ⇒ **一次坍缩越过永恒门槛** ✗（实测 16 秒 ✗）
  //   药：超出 knee 的部分按**同族形状**压紧（与「过载」同一个 `2^(−超出/跨度)` ✓）
  //       excess_eff = knee + (excess−knee)·2^(−(excess−knee)/span)   上界 = knee + span/ln2 ✓
  //   效果：单轮 IP **被封顶** ⇒ 次数 = 门槛/单轮收益 ⇒ 次数与时长都可控 ✓
  //       `knee=10 / span=20` ⇒ 上界 ≈ 38.9 阶 ⇒ 单轮 ≈ 1e0.14 ⇒ 约 **2267 次 × 11 秒 ≈ 6.9 h** ✓
  //       （拉表见 `tools/post-break-runaway-lab.mjs` 的同族表 + 本轮对话的 (c) 表 ✓）
  //   ⚠️ 浅挖（excess ≤ knee）**完全不受影响** ✓ ⇒ 破∞前的经济与手感一字未动 ✓
  // ★ 2025：**深度复利已删除**（D6 废弃 ✗）—— IP 回到基线 `floor((L/308.2547)²)`，
  // ★ 2025 用户要求：与 **AD 源码**保持基本一致（game.js:86 `gainedInfinityPoints`）
  //    AD:  IP = floor( 10^( log10(maxAM) / div − 0.75 ) × 乘数们 )   div 默认 308、可被来源压低
  //    我们: 同一形状 ✓ 除数走 `ipDivisor(state)` ✓（保留未来升级"调用与影响"的权力 ✓）
  const div = (state && typeof ipDivisor === "function") ? ipDivisor(state) : BREAK_INFINITY.maxLog10;
  const L = m.log10();
  return Decimal.pow(10, L.div(div).sub(0.75)).mul(BREAK_INFINITY.ipBase ?? 1).floor().max(1);
}

/** 大坍缩阈值（Decimal）—— 用 pow 构造，保住小数指数 */
export function crunchThreshold() {
  return Decimal.pow(10, BREAK_INFINITY.maxLog10);
}

/**
 * 无限点 → 效果（暂定，用户说之后再调）。
 * 现在是纯计数 + 解锁「打破无限」+ 四个无限升级（见 INFINITY_UPGRADES）。
 */
export function infinityPointEffect(ip) {
  const n = ip instanceof Decimal ? ip : new Decimal(ip ?? 0);
  return { count: n };
}

/**
 * 无限升级的价格（**唯一数据源**）。
 *
 * UI 显示的和引擎扣的必须走这一个函数 —— 这是 consistency.mjs 的硬要求，
 * 也是「显示 vs 实际」那类 bug 的唯一防法。
 *
 * @returns {Decimal} 价格（可重复升级按当前等级算）
 */
export function infinityUpgradeCost(state, id) {
  const cfg = INFINITY_UPGRADES[id];
  if (!cfg) return new Decimal(0);
  if (cfg.repeatable) {
    // ★ ①「无限增幅」走**分段软上限**（用户指定：影响永恒阶段的东西必须有极强软上限）。
    //   60 级前与老的 `10^等级` 完全一致；之后每级涨价 ×100、再 ^1.5。
    const lv = state.ipDoubleLevel ?? new Decimal(0);
    return new Decimal(10).pow(ipDoubleLogCost(lv.toNumber()));
  }
  return new Decimal(cfg.cost ?? 0);
}

/** 该无限升级已经买了吗（可重复的返回等级 > 0） */
/**
 * 这条 ∞ 升级**买过没有**。
 *
 * ⚠️ 踩过的坑（本轮）：加一次性升级时只写了购买分支的 `state.xxxBought = true`，
 *    **忘了在这里登记** ⇒ `buyInfinityUpgrade` 的"已买就不再卖"判断失效，
 *    同一升级会被**无限次重复购买**（每次 5/50/100 IP）。
 *    实测后果：打破无限后的 IP 池永远停在个位数（钱全被重复购买吃掉），
 *    "种子"永远攒不出来 —— 整条阶梯因此卡死。
 */
export function infinityUpgradeOwned(state, id) {
  const cfg = INFINITY_UPGRADES[id];
  if (!cfg) return false;
  if (cfg.repeatable) return (state.ipDoubleLevel ?? new Decimal(0)).gt(0);
  if (cfg.startLog10 != null) return (state.startBought ?? {})[id] === true;
  if (cfg.rateMult != null) return (state.speedBought ?? {})[id] === true;
  if (id === "ipToZpe") return state.ipToZpeBought === true;
  if (id === "ipToTransmuter") return state.ipToTransmuterBought === true;
  if (id === "ipTime") return state.ipTimeBought === true;
  if (id === "ipFromQuantum") return state.infinityFromQuantumBought === true;
  if (id === "thresholdFlat") return state.thresholdFlatBought === true;
  if (id === "pairBoost") return state.pairBoostBought === true;
  return false;
}

/**
 * 「起点跃迁」当前生效的开局深度（对数）。没买就是 0（= 从 0 开始，原样）。
 * 取**已买里最高的一档**（它们是递进的，不是相加的）。
 */
export function infinityStartLog10(state) {
  let best = 0;
  for (const cfg of Object.values(INFINITY_UPGRADES)) {
    if (cfg.startLog10 == null) continue;
    if ((state.startBought ?? {})[cfg.id] === true && cfg.startLog10 > best) best = cfg.startLog10;
  }
  return best;
}

/** 「速率解放」对量子成长速率上限的总倍率（各档相乘） */
/**
 * ★★ 2025：**坍缩加速器（CRUNCH_ACCEL）已整个删除**（用户裁定）
 *
 * 用户理由（原话）：「原则上坍缩加速机制也不该在这里。我的结论是直接删。
 *                  否则会对机制解读有极大污染」
 *
 * 它原本是"花无限点直接买时间"（每级成长速率 ×1.02、硬封顶 ×2），
 * 与同一批被删的机制同源：
 *   · 它是 **IP → 成长速率** 的平行环（和铸币 IP→IP 一样，不推动物质）；
 *   · 它的叙事（"把 24h 档压到 18h"）是**旧标尺**（×1.75）时代的产物，
 *     而正确标尺是 `AD WR × 1.0526`（见 PROGRESSION §2.0）⇒ 叙事本身已失据；
 *   · 与「速率解放」「档位 rate 里程碑」**共用一个入口**（infinityRateMult），
 *     三者在界面上无法分辨"谁在起作用" ⇒ 机制解读被污染。
 *
 * 移除后 `infinityRateMult` = ∞ 层「速率解放」各档 × 档位 rate 里程碑（`tierRateMult`）。
 */

/**
 * 无限升级「速率解放」（`rateMult`）的**合并倍率** = ∞ 层已买的档位 × 档位 rate 里程碑。
 *
 * ★ 单一数据源：`infinityRateMult(state)` 是"改速率"类机制的**唯一**入口（R 退休后它改的是 `b`），
 *   所以任何"改成长速率"的机制都必须并进这里，不许各写各的（否则会漏乘）。
 */
export function infinityRateMult(state) {
  let m = new Decimal(1);
  for (const cfg of Object.values(INFINITY_UPGRADES)) {
    if (cfg.rateMult == null) continue;
    if ((state.speedBought ?? {})[cfg.id] === true) m = m.mul(cfg.rateMult);
  }
  return m.mul(tierRateMult(state));
}

/**
 * ④「无限长河」的**实时**产点速率（点/秒）。
 *
 * 设计参考：AD 的同类升级（`ipGen` / 被动产点）是**实时生成**的，不是每次结算时一次性给。
 * 所以这里也改成实时：`tick` 每帧按这个速率进账，**总量公式不变**
 * （单次无限累计 = `min(耗时, 上限) ÷ 60 × 3^①等级`）。
 *
 * 好处：挂机期间点就在账上（不必等大坍缩才入账），
 * 而且"把单次压进 30 分钟"这个目标从"结算时才算"变成屏幕上的实时数字。
 */
export function timeIPPerSecond(state) {
  // ★ 用户 2025 裁定：**无限长河停产**（本函数只留壳 ✓ 效果等同删除 ✗）
  //   破∞后的 IP 改由**无限挑战（8 关，每关 +38.53 阶）**提供 ✓
  // ⏸ 待定 → 2025 用户解冻 ✓（保留用户定的**上限 1 IP/分钟** ✓）
  const raw = ipDoubleMult(state)
    .div(INFINITY_UPGRADES.ipTime.secondsPerPoint);
  return Decimal.min(raw, new Decimal(1).div(60));   // 上限 1 IP/分钟 ✓
}

/** ④ 单次无限的**可计时长上限**（秒）：超出部分不产点 —— 它是给"速度"定的靶子 */
export function timeIPCapSeconds() {
  return INFINITY_UPGRADES.ipTime.capSeconds ?? Infinity;
}

/**
 * ④ 单次无限（按耗时）**应得的总量** —— 实时进账的就是这个总量，只是拆成每帧发。
 *
 * ⚠️ 保留它是为了让工具/断言能直接验"总量"。**大坍缩不再调用它**
 *    （那时耗时部分早已实时发完，再发一次就是重复发放）。
 */
export function timeInfinityPointGain(state, seconds) {
  // ★ 用户 2025 最终裁定：**无限长河整体废弃** ⇒ 本函数同样停产（tick 走的就是它 ✗）
  if (!state.ipTimeBought) return new Decimal(0);
  // ⏸ 待定 → 解冻 ✓（同上限 ✓）
  const rawTotal = new Decimal(counted).div(INFINITY_UPGRADES.ipTime.secondsPerPoint)
    .mul(ipDoubleMult(state));
  return Decimal.min(rawTotal, new Decimal(counted).div(60));   // 1 IP/分钟 ✓
}

  //   增长改由**无限挑战（IC）**提供（第三层设计稿 ✓）

// ══════════════════════════════════════════════════════════
// ★ 无限点公式的**除数（div）**—— 保留"调用与影响"的权力（用户 2025 明确要求 ✓）
//
//   对齐 AD 源码（game.js:86 `gainedInfinityPoints`）：
//       const div = new Decimal(Effects.min(308, Achievement(103), TimeStudy(111))).toNumber();
//   ⇒ AD 的机制是：**多个来源各自给出一个候选除数，取其中最小者** ✓
//
//   本函数照搬这个机制 ✓：
//       ipDivisor(state) = min(基准 308.2547, 各来源候选值...)
//   ⇒ 未来的升级/里程碑只要往 `IP_DIVISOR_SOURCES` 里加一条候选 ✓ 即可生效 ✓
//      （不需要改公式、不需要改调用点 —— 这就是"保留调用与影响权力"的落地 ✓）
//
//   ⚠️ 目前所有候选都**未接线**（pending ✓）⇒ ipDivisor 恒等于基准 308.2547
//      ⇒ 零回归 ✓（公式现状不受任何影响 ✓）
// ══════════════════════════════════════════════════════════

/** 各来源给出的候选除数（越小 ⇒ 同样物质给越多 IP ✓）。pending 表示尚未接线。 */
export const IP_DIVISOR_SOURCES = [
  // { id: "em1", when: (s) => hasEternityMilestone(s, "em1"), value: 250, pending: true },
  // { id: "upg-x", when: (s) => hasUpgrade(s, "x"), value: 210, pending: true },
];

/** ★ 无限点公式的除数（唯一入口 ✓ 未来所有相关升级都改这里 ✓） */
export function ipDivisor(state) {
  let best = BREAK_INFINITY.maxLog10;                     // 基准 = log10(Number.MAX_VALUE) = 308.2547 ✓
  for (const src of IP_DIVISOR_SOURCES) {
    if (src.pending) continue;
    let ok = false;
    try { ok = !!src.when(state); } catch { ok = false; }
    if (ok) best = Math.min(best, src.value);
  }
  return best;
}

/** 供工具/界面直接问"这个来源现在生效吗" ✓ */
export function ipDivisorBreakdown(state) {
  const rows = [{ id: "base", value: BREAK_INFINITY.maxLog10, active: true }];
  for (const src of IP_DIVISOR_SOURCES) {
    let ok = false;
    if (!src.pending) { try { ok = !!src.when(state); } catch { ok = false; } }
    rows.push({ id: src.id, value: src.value, active: ok, pending: !!src.pending });
  }
  return { divisor: ipDivisor(state), rows };
}

// ══════════════════════════════════════════════════════════
// ★ IC 挑战修饰器（用户 2025）
//   「引擎不清零，但第一个 IC 里引擎的**生效等级恒为 1**」
//   ⇒ 玩家在 IC#1 内必须靠"几乎没引擎"的状态重爬到无限 ✓
//   ⇒ 其它关不受影响 ✓ 非挑战态不受影响 ✓（零回归 ✓）
//
//   实现要点：引擎的**等级本身不清零**（照用户的裁定 ✓），只在**读取生效值时**被压到 1 ✓
//   所以任何"看引擎效果"的地方都必须走 effectiveEngineLevel(state) ✓（唯一入口 ✓）
// ══════════════════════════════════════════════════════════
export const IC_MODS = {
  // 关序号（0 = 第一关）⇒ 修饰器
  // ★ 用户 2025 选 β：挪到**第 5 关**（那时引擎本已很强 ⇒ 削弱才有意义 ✓）
  4: { engineLevel: 1, desc: "引擎生效等级恒为 1（无引擎修行关）" } };

/** 本关的修饰器（无则 null ✓） */
export function icMod(state) {
  const k = state?.ic?.active;
  if (k == null) return null;
  return IC_MODS[k] ?? null;
}

/** ★ 引擎的**生效等级**（唯一入口 ✓）：挑战修饰器可把它压到 1 ✓ */
export function effectiveEngineLevel(state) {
  const raw = zpeEngineLevel(state).max(0);
  const mod = icMod(state);
  if (mod && mod.engineLevel != null) return new Decimal(Math.min(raw.toNumber(), mod.engineLevel));
  return raw;
}

// ══════════════════════════════════════════════════════════
// ★ 无限增幅（ipDouble）—— 2025 用户方案甲：**从 ×2/级 改成线性 +10%/级** ✓
//   ×2/级 会形成 "IP → 买等级 → IP 翻倍 → 更多 IP" 的**指数反馈环** ✗
//   （探针实测：破∞后 44 秒走完 1e10 → 1e308 ✗；关引擎/调 k/调价格都不影响 ✗）
//   线性 ⇒ 多项式 ⇒ 判据安全 ✓；破∞前它仍是主要 IP 引擎 ✓（配合长河 1 IP/分钟 ✓）
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ★★★ 2025 **终稿**（用户裁定）：`ipDouble` **照抄 AD 的 ipMult**，不再改动
// ══════════════════════════════════════════════════════════
// 用户原话：「**同 AD 中 ip 倍增价格逻辑，且不再更改**」+「1: 就这样，不再做任何修改（终稿）」
//
// ── AD 原文（`src/core/infinity-upgrades.js`，逐行核对过）──
//   ```
//   // 132-135: "The repeatable 2xIP upgrade has an odd cost structure -
//   //   it follows a shallow exponential (step *10) up to e3M, at which point
//   //   it follows a steeper one (step *1e10) up to e6M before finally hardcapping."
//   get cost() {
//     if (purchaseCount >= purchasesAtIncrease)
//       return costIncreaseThreshold.times(Decimal.pow(costIncrease, purchaseCount - purchasesAtIncrease));
//     return Decimal.pow(costIncrease, purchaseCount + 1);
//   }
//   get purchasesAtIncrease() { return this.config.costIncreaseThreshold.log10() - 1; }
//   get costIncrease() { return hasIncreasedCost ? 1e10 : 10; }
//   // costCap: DC.E6E6 ｜ costIncreaseThreshold: DC.E3E6
//   effect: () => DC.D2.pow(player.IPMultPurchases)     // ← **2^购买次数**
//   ```
//
// ⇒ 我们照抄这三条：**基础价 10、步长 ×10、门槛后步长 ×1e10、封顶 1e6e6、效果 2^等级**
//
// ⚠️ 与 AD 的一处**必要偏差**（必须记下，不假装没有）：
//   AD 的门槛 `1e3e6` / 封顶 `1e6e6` 建立在 AD 自己的 IP 经济上（它能到 1e3000000）。
//   我们的 IP 池实测在 **1e19 ~ 1e28** ⇒ 照抄门槛会让此升级**永远只买到 27 级**（`10^28`）
//   ⇒ 效果只有 ×2^27 = 1.3e8，够不到它该负责的那 **28.25 阶**（1e280 → 1e308.25）✗
//   ⇒ 用户第 1 条裁定"就这样、终稿"= **保持 ×2/级 不动**；
//     门槛/封顶这两个**纯价格参数**按我们的经济量级重设（这符合"同 AD 的**价格逻辑**"，
//     因为逻辑是"浅指数 → 门槛 → 陡指数 → 封顶"，不是那几个具体数字）✓
//   ⇒ 取 `costIncreaseThreshold = 1e6`、`costCap = 1e300`：
//      · 1e6 之前：步长 ×10 ⇒ `10^(L+1)` ⇒ 到 L=5 花 1e6
//      · 1e6 之后：步长 ×1e10 ⇒ 每级 +10 阶
//      · 1e300 封顶 ⇒ L≈35 封顶 ⇒ 2^35 = 3.4e10 ⇒ 约 9.5 阶
//     ⚠️ 9.5 阶 < 28.25 阶 ⇒ **单靠它仍不够**（与线性版同一个结论：它只是"最终乘区"的一环，
//        剩下的大头必须来自深度收益/引擎）。这条**不是新问题**，是待解决的数值问题。
export const IP_DOUBLE_AD = {
  base: new Decimal(10),                    // AD: `costIncrease = 10`（浅指数段）
  stepShallow: new Decimal(10),             // AD: 步长 ×10  ← **用户裁定：每级 ×10**
  stepSteep: new Decimal(1e10),             // AD: 门槛后步长 ×1e10
  // ★★★ 2025 修正（用户报告：「6 级准备买 7 级要 1e16」）——
  //   **原来的 1e6 门槛太低，让"陡段"从第 5 级就开始** ✗
  //   实测（`ipDoubleCost`，门槛=1e6 ⇒ purchasesAtIncrease=5）：
  //     L0~5 ⇒ 1e1 / 1e2 / 1e3 / 1e4 / 1e5 / 1e6   ← 浅段（每级 ×10 ✓）
  //     L6   ⇒ **1e16**（不是 1e7！）← 已进陡段：`10^6 × 1e10^1`
  //     L7   ⇒ 1e26｜L8 ⇒ 1e36                 ← 每级 ×1e10
  //   ⇒ 用户看到的 1e16 是**照 AD 公式的正确输出**，错的是**门槛值**（AD 用 1e3e6，
  //     我上一轮擅自改成 1e6，导致浅段只有 5 级）✗
  //   改动：门槛 1e6 → **1e31**（⇒ 浅段到第 30 级，每级 ×10，与用户预期一致）
  //     L6 ⇒ 1e7 ✓｜L20 ⇒ 1e21 ✓｜L29 ⇒ 1e30 ✓｜L30 起进陡段
  costIncreaseThreshold: new Decimal("1e31"),
  costCap: new Decimal("1e320"),            // 跟着抬高（否则封顶又太早 ⇒ 浅段被截断）
  get purchasesAtIncrease() { return this.costIncreaseThreshold.log10().toNumber() - 1; },
};

/**
 * 下一级价格。
 *
 * ★★★ 2025（用户裁定）：**必须与 `ipDoublePriceAt` 同源**。
 *   原来这里写死 `stepShallow^(count+1)`（= AD 的 `10^(count+1)`）⇒ 首价 **10** ✗
 *   用户裁定首价应为 **1**（"购买时 1 级"），序列 `1 → 1 → 10 → 100 → 1000 …`
 *   ⇒ 本函数改为**直接调 `ipDoublePriceAt`**（单一实现，两处不会再脱节 ✓）
 *   ⚠️ 踩过同一类坑多次：「显示 ≠ 实发」几乎都源于**同一个公式写了两遍**。
 */
export function ipDoubleCost(state) {
  const count = Math.max(0, Number(state?.ipDoubleLevel ?? 0) || 0);
  return ipDoublePriceAt(count);
}

/** 效果 —— 照抄 AD 的 `effect: () => DC.D2.pow(player.IPMultPurchases)`（×2/级） */
export function ipDoubleMult(state) {
  const lv = Math.max(0, Number(state?.ipDoubleLevel ?? 0) || 0);
  return new Decimal(2).pow(lv);
}

// ══════════════════════════════════════════════════════════
// ★★ 暗能量**有效量**软上限（用户 2025 方案乙，起点 = 1e50 阶 ✓）
//   为什么不是"削速率"：速率被按比例削弱后仍是天文数字 ⇒ 一秒冲过几百阶 ✗
//   所以改为削**量**：  log10(DE_eff) = knee + span·(1 − 2^(−(log10 DE − knee)/span))
//     形状：单调递增 ✓ 上界 = knee + span ✓ 平滑 ✓（cap-monotonic-lab 的模板可直接断言 ✓）
//   ★ 关键：物质最多 ≈ (1e(50+span)/base)^k ⇒ **span 就是"破∞→永恒能走多远"的总闸** ✓
//   ⚠️ 必须保证仍能到 1e308.25（否则永恒不可达 ✗）：(50+span−baseLog)×6.1651 ≥ 308.2547
// ══════════════════════════════════════════════════════════
export const DE_EFF_CAP = { kneeLog10: 300, span: 60 };   // ⏸ 暂等效关闭（knee 高于可达 DE ⇒ 不生效 ✓）待定位第二个限制器 ✓

export function effectiveDarkEnergyLog10(state) {
  const de = state?.darkEnergy ?? new Decimal(0);
  if (de.lte(0)) return 0;
  const dlg = de.log10().toNumber();
  const { kneeLog10: knee, span } = DE_EFF_CAP;
  if (dlg <= knee) return dlg;
  return knee + span * (1 - Math.pow(2, -(dlg - knee) / span));
}
