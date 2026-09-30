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
  /**
   * ⚠️ localStorage 的键**刻意不跟着游戏改名**（游戏已改名「空想增量」）：
   *    改了键 = 浏览器里的老存档立刻读不到。要改就得配一次迁移读取。
   */
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
// ZPE 引擎（打破无限后 · 虚空系统子页）
// ══════════════════════════════════════════════════════════

/**
 * ZPE 引擎：拿**无限点**买等级，等级同时喂三条机制。
 *
 * 设计推导见 [`docs/ZPE-ENGINE.md`](../../docs/ZPE-ENGINE.md)。三条机制各自改方程的哪一项：
 *   ① 抬 `ZPE_EXPONENT`（= 抬自反馈指数 a，改**形状**）—— 等级 10 解锁，每级 +0.002，封顶 +0.03
 *   ② `zpeRate × (1 + perLevel×等级)²`（= 抬常数速率，改**快慢**）—— 解锁即有
 *   ③ `zpeMultiplier ×= 计数频率项`（= 把已有成长接进来）—— 等级 5 解锁
 *
 * ⚠️ **唯一红线**：`a = (ZPE_EXPONENT + ① 的加成) × (倍率在产出里出现的次数 ≈ 1.74~2) < 1`。
 *    封顶时 a = 0.05 × 2 = 0.10，离红线很远（`tools/zpe-engine-lab.mjs --check` 会断言）。
 *
 * 为什么等级用无限点买（而不是 ZPE）：IP 的长期曲线是**线性**的（60 × 3^① 点/小时），
 * 于是等级 ∝ 时间 ⇒ `(1+kv)²` ∝ t² ⇒ **ZPE ∝ t³**，是一条"越来越快"的形状；
 * 而且**不碰 a**（a 只看 ZPE 的幂次）。用 ZPE 买的话等级 ∝ log(ZPE)，只给多项式提速。
 */
export const ZPE_ENGINE = {
  /** 解锁价（用户指定：10 无限点） */
  unlockCostIp: 10,
  /** 第一级价格 */
  baseCostIp: 5,
  /**
   * ★ **极强软上限**（用户指定）：等级越高，每级涨价倍率按段跳。
   *
   *   | 等级区间 | 每级涨价倍率 | 说明 |
   *   |---|---|---|
   *   | 0 ~ 10    | ×2           | 正常段 |
   *   | > 10      | ×2 **再 ×10** = ×20 | 「大于 10 引擎价格增长 ×10」 |
   *   | > 100     | 再 **^1.3** = ×49.1 | 「大于 100 再多 ^1.3」 |
   *   | > 1000    | 再 **^1.8** = ×218.6 | 「大于 1000 再多 ^1.8」 |
   *
   *   为什么要它：模型（`tools/ip-economy-lab.mjs`）证明「只要等级能用 IP 批量买入，
   *   300 阶会在几分钟内冲完」。所以引擎等级必须**在数值上就贵到不可批量**，
   *   而不是靠"少给点效果"来节流 —— 这就是软上限的作用。
   *
   *   ⚠️ 每段都是一次**乘性跳变**，所以实测曲线是：10 级前很便宜（5→5120 点），
   *      11 级起每级贵一个量级，20 级就已经是 `5×2^10×20^10 ≈ 5e16` 点。
   *      想调就改这里的 `growth`（工具里 `--cost` 会打印价格表）。
   */
  costSegments: [
    { from: 0, growth: 2 },
    { from: 10, growth: 2 * 10 },
    { from: 100, growth: Math.pow(2 * 10, 1.3) },
    { from: 1000, growth: Math.pow(2 * 10, 1.8) },
  ],
  /** ② 每级给 `(1 + perLevel×等级)²` 的产出倍率 */
  perLevel: 0.1,
  /** ③ 从这一级起，ZPE 倍率开始吃「计数频率」 */
  countFreqLevel: 5,
  /** ① 从这一级起，每级给倍率公式 +expPerLevel 的指数 */
  expLevel: 10,
  expPerLevel: 0.002,
  /** ① 的指数加成上限（安全线：0.05 × 2 = 0.10 ≪ 1） */
  expMax: 0.03,
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
export const COINAGE = {
  /** 第 1 级价格（无限点） */
  baseCostIp: 1e4,
  /** 每级涨价倍率 */
  growth: 2,
  /** 每级让无限点收入 ×这个数（m） */
  effectPerLevel: 2.5,
  /** ★ 档位闸门：每次大坍缩放行几级 */
  capPerCrunch: 30,
  /**
   * ★ 价格的**极强软上限**（用户指定：「若会影响永恒阶段务必加入极强的软上限」）。
   *
   * 作用范围刻意选在**设计需求之外**：铸币本体被档位闸门卡住（24 档 × 30 = 720 级），
   * 所以软上限从第 900 级才开始咬 —— 它只负责"永远别想无限买"，
   * 不干扰 24 小时档的正常推进。
   */
  costSegments: [
    { from: 0, growth: 2 },
    { from: 900, growth: 2 * 10 },
    { from: 1200, growth: Math.pow(2 * 10, 1.5) },
  ],
};

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
export const IP_DOUBLE_SOFT_CAP = [
  { from: 0, growth: 10 },
  { from: 60, growth: 10 * 10 },
  { from: 90, growth: Math.pow(10 * 10, 1.5) },
];

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

/** ① 的**下一级价格**（log10，分段闭式） */
export function ipDoubleLogCost(level) {
  const n = Math.max(0, Number(level) || 0);
  let lg = Math.log10(INFINITY_UPGRADES.ipDouble.firstCost);
  for (let i = 0; i < IP_DOUBLE_SOFT_CAP.length; i++) {
    const from = IP_DOUBLE_SOFT_CAP[i].from;
    const to = i + 1 < IP_DOUBLE_SOFT_CAP.length ? IP_DOUBLE_SOFT_CAP[i + 1].from : Infinity;
    if (n <= from) break;
    const cnt = Math.min(n, to) - from;
    if (cnt > 0) lg += cnt * Math.log10(IP_DOUBLE_SOFT_CAP[i].growth);
  }
  return lg;
}

/** ① 的等级上限探针：给定无限点池能买到几级（分段闭式，O(段数)） */
export function ipDoubleAffordableIn(level, poolDecimal) {
  let lv = Math.max(0, Number(level) || 0);
  let pool = poolDecimal;
  let total = 0;
  const segs = IP_DOUBLE_SOFT_CAP;
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    if (lv >= to) continue;
    const g = segs[i].growth;
    const start = Math.max(lv, from);
    const first = new Decimal(10).pow(ipDoubleLogCost(start));
    if (pool.lt(first)) break;
    const k = pool.mul(g - 1).div(first).add(1).log(g).floor().toNumber();
    if (!Number.isFinite(k) || k <= 0) break;
    const segLen = to === Infinity ? k : to - start;
    const span = Math.min(k, segLen);
    pool = pool.sub(first.mul(new Decimal(g).pow(span).sub(1)).div(g - 1));
    total += span;
    lv = start + span;
    if (span < segLen) break;
  }
  return total;
}

/** 铸币等级上限（**档位闸门**：大坍缩次数 × 每档放行级数） */
export function coinageCap(state) {
  const crunches = state.bigCrunchCount ?? 0;
  const n = crunches instanceof Decimal ? crunches.toNumber() : Number(crunches) || 0;
  // ★ 每档上限随**档位里程碑**爬升（这就是"档数压缩"的实现方式）
  return Math.floor(n * coinageCapPerCrunch(state));
}

/** 铸币等级 */
export function coinageLevel(state) {
  const lv = state.coinageLevel ?? 0;
  return lv instanceof Decimal ? lv : new Decimal(lv);
}

/** 铸币对**所有无限点收入**的倍率：`m^等级` */
export function coinageMult(state) {
  return new Decimal(COINAGE.effectPerLevel).pow(coinageLevel(state));
}

/** 铸币第 N 级的价格（log10，分段软上限） */
export function coinageLogCost(level) {
  const n = Math.max(0, Number(level) || 0);
  let lg = Math.log10(COINAGE.baseCostIp);
  for (let i = 0; i < COINAGE.costSegments.length; i++) {
    const from = COINAGE.costSegments[i].from;
    const to = i + 1 < COINAGE.costSegments.length ? COINAGE.costSegments[i + 1].from : Infinity;
    if (n <= from) break;
    const cnt = Math.min(n, to) - from;
    if (cnt > 0) lg += cnt * Math.log10(COINAGE.costSegments[i].growth);
  }
  return lg;
}

/** 铸币下一级价格 */
export function coinageCost(state) {
  return new Decimal(10).pow(coinageLogCost(coinageLevel(state).toNumber()));
}

/**
 * 铸币能买几级（**同时受档位闸门与软上限约束**）。
 * 闸门优先：`min(闸门剩余, 池子买得起的级数)`。
 */
export function coinageAffordableIn(state, poolDecimal) {
  const lv = coinageLevel(state).toNumber();
  const room = coinageCap(state) - lv;
  if (room <= 0) return 0;
  let pool = poolDecimal;
  let total = 0;
  let cur = lv;
  const segs = COINAGE.costSegments;
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    if (cur >= to) continue;
    const g = segs[i].growth;
    const start = Math.max(cur, from);
    const first = new Decimal(10).pow(coinageLogCost(start));
    if (pool.lt(first)) break;
    const k = pool.mul(g - 1).div(first).add(1).log(g).floor().toNumber();
    if (!Number.isFinite(k) || k <= 0) break;
    const segLen = to === Infinity ? k : to - start;
    const span = Math.min(k, segLen, room - total);
    if (span <= 0) break;
    pool = pool.sub(first.mul(new Decimal(g).pow(span).sub(1)).div(g - 1));
    total += span;
    cur = start + span;
    if (span < segLen || total >= room) break;
  }
  return total;
}

/** 铸币总价（从 from 买到 to，Decimal） */
export function coinageTotalCost(from, to) {
  let total = new Decimal(0);
  const segs = COINAGE.costSegments;
  for (let i = 0; i < segs.length; i++) {
    const segFrom = segs[i].from;
    const segTo = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    const lo = Math.max(from, segFrom);
    const hi = Math.min(to, segTo);
    if (hi <= lo) continue;
    const g = segs[i].growth;
    const first = new Decimal(10).pow(coinageLogCost(lo));
    total = total.add(first.mul(new Decimal(g).pow(hi - lo).sub(1)).div(g - 1));
  }
  return total;
}

/**
 * ★ 档位里程碑（挂在**大坍缩次数**上）
 *
 * 设计意图（用户定的 24h → 18h）：
 *   总时长 = 档数 × 每次大坍缩耗时，而**每档兑现的阶数由 `capPerCrunch` 决定**。
 *   所以"档数压缩"不是把档数直接改小，而是**让每档上限随进度爬升**：
 *   30 → 33 → 36 → 41 → 46 ⇒ 同样的 306 阶需要的档数变少 ⇒ 阶梯自然压缩到 ~18 档。
 *
 * 另外两条：
 *   · `rate` —— 成长速率里程碑（每次大坍缩更快，与「速率解放」「坍缩加速器」共用一个入口）；
 *   · `lube` —— **量子润滑（保守版）**：把量子门槛步长从 ×20 缓到 ×19.5。
 *     判据：`tools/crunch-speed-lab.mjs` 的 ⑦ 行显示"量子不足"惩罚很重（36.9h），
 *     所以先给一点点缓和；若实测仍然严重，再按用户说的"回到原方案"（给更多）。
 */
export const TIER_MILESTONES = [
  { at: 3, id: "tm-cap1", kind: "cap", value: 3, desc: "铸币每档上限 +3（30 → 33）" },
  { at: 6, id: "tm-rate1", kind: "rate", value: 1.05, desc: "成长速率 ×1.05" },
  { at: 9, id: "tm-cap2", kind: "cap", value: 3, desc: "铸币每档上限 +3（→ 36）" },
  { at: 12, id: "tm-lube", kind: "lube", value: 0.5, desc: "量子润滑：门槛步长 ×20 → ×19.5" },
  { at: 15, id: "tm-rate2", kind: "rate", value: 1.05, desc: "成长速率 ×1.05（累计 ×1.1025）" },
  { at: 18, id: "tm-cap3", kind: "cap", value: 5, desc: "铸币每档上限 +5（→ 41）" },
  { at: 24, id: "tm-cap4", kind: "cap", value: 5, desc: "收尾：铸币每档上限 +5（→ 46）" },
];

/** 已解锁的档位里程碑（大坍缩次数 ≥ at） */
export function tierMilestonesDone(state) {
  const n = state.bigCrunchCount instanceof Decimal ? state.bigCrunchCount.toNumber() : Number(state.bigCrunchCount) || 0;
  return TIER_MILESTONES.filter((m) => n >= m.at);
}

/** 铸币**每档上限**（基础 30 + 里程碑累加）—— 档数压缩就是靠它 */
export function coinageCapPerCrunch(state) {
  let cap = COINAGE.capPerCrunch;
  for (const m of tierMilestonesDone(state)) if (m.kind === "cap") cap += m.value;
  return cap;
}

/** 档位里程碑给的成长速率倍率（并入 infinityRateMult，保持单一入口） */
export function tierRateMult(state) {
  let m = 1;
  for (const x of tierMilestonesDone(state)) if (x.kind === "rate") m *= x.value;
  return m;
}

/** 档位里程碑给的"量子润滑"：门槛步长的额外倍率（1 = 无缓和） */
export function tierQuantumStepMult(state) {
  let k = 1;
  for (const m of tierMilestonesDone(state)) if (m.kind === "lube") k *= 1 - m.value / QUANTUM.zpeCostGrowth / 2;
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
  /** 门槛：与物质上限同一个数字（AD 的 eternityGoal 也是 1.79e308 ≈ 这个值） */
  goalLog10: Math.log10(Number.MAX_VALUE),
  /** 底数 5 */
  base: 5,
  /** 公式除数 308（AD 用整数 308，不是 308.25） */
  divisor: 308,
  /** 指数偏移 0.7 */
  offset: 0.7,
};

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
export function zpeEngineLogCost(level) {
  const n = Math.max(0, Number(level) || 0);
  let lg = Math.log10(ZPE_ENGINE.baseCostIp);
  const segs = ZPE_ENGINE.costSegments;
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    if (n <= from) break;
    const cnt = Math.min(n, to) - from;
    if (cnt > 0) lg += cnt * Math.log10(segs[i].growth);
  }
  return lg;
}

/** ZPE 引擎是否已解锁 */
export function zpeEngineUnlocked(state) {
  return state.zpeEngineUnlocked === true;
}

/** 引擎等级（没解锁就是 0） */
export function zpeEngineLevel(state) {
  const lv = state.zpeEngineLevel ?? 0;
  return lv instanceof Decimal ? lv : new Decimal(lv);
}

/** 下一级的价格（无限点）。解锁本身走 unlockCostIp，不算在这里。 */
export function zpeEngineCost(state) {
  return new Decimal(10).pow(zpeEngineLogCost(zpeEngineLevel(state).toNumber()));
}

/**
 * 从 `from` 买到 `to` 的总价（**Decimal**，分段闭式）。
 *
 * ⚠️ 段与段之间是**相加**（同一笔钱买多级），不是相乘 —— 第一版我把每段的和取 log
 *    再相加，那等于把各段乘起来（价格虚高几个量级）。这里用 Decimal 相加。
 */
export function zpeEngineTotalCost(from, to) {
  let total = new Decimal(0);
  const segs = ZPE_ENGINE.costSegments;
  for (let i = 0; i < segs.length; i++) {
    const segFrom = segs[i].from;
    const segTo = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    const lo = Math.max(from, segFrom);
    const hi = Math.min(to, segTo);
    if (hi <= lo) continue;
    const g = segs[i].growth;
    const cnt = hi - lo;
    const first = new Decimal(10).pow(zpeEngineLogCost(lo));   // 段内第一级的价格
    total = total.add(first.mul(new Decimal(g).pow(cnt).sub(1)).div(g - 1));
  }
  return total;
}

/**
 * 从当前等级起，给定无限点池**最多能买几级**（分段几何的闭式解，O(段数)）。
 *
 * 每段内的反解就是标准等比公式：
 *   `k = floor( log_g( 1 + pool·(g−1)/cost_at_seg_start ) )`
 * 花了多少也从同一公式算（避免再逐级累加）。
 */
export function zpeEngineAffordableIn(state, poolDecimal) {
  if (!zpeEngineUnlocked(state)) return 0;
  const segs = ZPE_ENGINE.costSegments;
  let lv = zpeEngineLevel(state).toNumber();
  let pool = poolDecimal;
  let total = 0;

  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = i + 1 < segs.length ? segs[i + 1].from : Infinity;
    if (lv >= to) continue;                       // 这一段的等级已经买完
    const g = segs[i].growth;
    const start = Math.max(lv, from);
    const first = new Decimal(10).pow(zpeEngineLogCost(start));   // 本段第一级的价格
    if (pool.lt(first)) break;
    // k = floor( log_g( pool·(g−1)/first + 1 ) )
    const k = pool.mul(g - 1).div(first).add(1).log(g).floor().toNumber();
    if (!Number.isFinite(k) || k <= 0) break;
    // ⚠️ span 最多到**本段末尾**；判定"钱够不够"要比 segLen，不是比 k ——
    //    第一版写成 `span < k` 就 break，于是池子再大也只能买满第一段（10 级）。
    const segLen = to === Infinity ? k : to - start;
    const span = Math.min(k, segLen);
    // 本段花掉：first × (g^span − 1)/(g − 1)
    const spent = first.mul(new Decimal(g).pow(span).sub(1)).div(g - 1);
    pool = pool.sub(spent);
    total += span;
    lv = start + span;
    if (span < segLen) break;                      // 本段买不满 → 钱不够了，停
  }
  return total;
}

/** ② 引擎对 ZPE 产出的倍率：`(1 + 0.1×等级)²` */
export function zpeEngineProdMult(state) {
  if (!zpeEngineUnlocked(state)) return new Decimal(1);
  const lv = zpeEngineLevel(state);
  const base = new Decimal(1).add(lv.mul(ZPE_ENGINE.perLevel));
  return base.mul(base);
}

/** ① 引擎给 `zpeMultiplier` 公式指数加多少（等级 10 起，封顶 expMax） */
export function zpeEngineExpBonus(state) {
  if (!zpeEngineUnlocked(state)) return 0;
  const lv = zpeEngineLevel(state).toNumber();
  if (lv < ZPE_ENGINE.expLevel) return 0;
  return Math.min((lv - ZPE_ENGINE.expLevel + 1) * ZPE_ENGINE.expPerLevel, ZPE_ENGINE.expMax);
}

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
    desc: "梦想点的全局加成系数：每点 +2% → +8%",
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
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}（花粒子）`,
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
      desc: (lv) => `每次暗能量转换的量 ×${new Decimal(M).pow(lv).toFixed(2)}（花暗能量）`,
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
    desc: "自动购买「高效相变」",
    effect: { kind: "autoBuy", deUpgrade: "phaseShift" },
  },
  {
    id: "autoVacuum",
    name: "加速自动化",
    cost: 1,
    target: "vacuumAccel",
    desc: "自动购买「真空加速」",
    effect: { kind: "autoBuy", deUpgrade: "vacuumAccel" },
  },
  // ★ 新增两条：覆盖前面的暗能量升级 4（相变增幅）和 5（凝聚斜率）。
  //   用户要求：梦想点经济要覆盖全部五条暗能量升级。
  {
    id: "autoDeGainBase",
    name: "增幅自动化",
    cost: 1,
    target: "deGainBase",
    desc: "自动购买「相变增幅」",
    effect: { kind: "autoBuy", deUpgrade: "deGainBase" },
  },
  {
    id: "autoConvOutput",
    name: "斜率自动化",
    cost: 1,
    target: "convOutput",
    desc: "自动购买「凝聚斜率」",
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
};

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
  unspentBoost: "matter",
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
  bigCrunchMatter: `1e${Math.log10(Number.MAX_VALUE).toFixed(4)}`,

  /** 大坍缩给多少无限点 */
  infinityPointsPerCrunch: 1,
};

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
   *
   * ── 为什么是 0.147 而不是 0.05（路线 1）──
   *   0.05 配上"斜率恒定"就是一条**直线**：每 25 阶都是 8.5 分钟，玩家感受是节拍器。
   *   现在抬到 0.147，并由 `CLIMB` 让斜率随深度递减 ——
   *   总时长几乎不变（96.7 → 100.2 分钟），但形状变成 **log 形**：
   *     前 25 阶 3.1 分钟，最后 58 阶 23.9 分钟。
   *   0.147 是按 `L = knee + D·log2(1 + ln2·R₀·t/D)` 反解出来的（t = 100 分钟）。
   *   想调就改这个数 + `CLIMB.halvingOrders`，然后跑 `tools/pace-model.mjs` 复算。
   */
  growthRateMax: 0.147,
  /** 达到上限一半时所需的量子数（越小越慷慨）。0.5 时阶梯段约 1.75 小时 */
  growthRateHalf: 0.5,
  /** 每对给几个量子（用户设定：一对） */
  perPair: 2,

};

/**
 * 爬升形状（路线 1）：让 `e25 → e308.25` 那段从直线变成 log 形。
 *
 *   `R_eff = R(q) · 2^(−(L − knee)/halvingOrders)`      （L ≤ knee 时恒为 1）
 *
 * knee = 25 = 量子层解锁点（`COLLAPSE.unlockMatter` 的对数）——
 * 所以 **e25 之前那 6 分钟完全不受影响**（那段由基础环决定，本来就不走量子项）。
 *
 * ⚠️ 必须和 `QUANTUM.growthRateMax` **一起**调：只改一个总时长就会漂。
 *    参数表与定点断言见 `tools/pace-model.mjs`（--check / --sweep）。
 *    实测（_sim 沙盒，非本仓库）：直线 97.6 分钟 → log 形 105.1 分钟。
 */
export const CLIMB = {
  /** 拐点（阶）：从这一阶开始衰减。直接取量子层解锁点（1e25 → 25），单一数据源 */
  knee: Math.log10(Number(COLLAPSE.unlockMatter)),
  /** 每多少阶速率减半 */
  halvingOrders: 100,
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
/**
 * @param {Decimal|number} quantum
 * @param {Decimal|number} [rateMult=1] ∞ 层「速率解放」对**上限**的倍率
 *        （用倍率而不是绝对值，这样最终 R₀ 定成多少都不必重算升级数值）
 */
export function quantumGrowthRate(quantum, rateMult = 1) {
  const q = quantum instanceof Decimal ? quantum : new Decimal(quantum ?? 0);
  if (q.lte(0)) return new Decimal(0);
  const max = new Decimal(QUANTUM.growthRateMax).mul(rateMult);
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
/** 量子门槛的**总倍率**（单一数据源：档位里程碑的"量子润滑" × 门槛压平升级） */
export function quantumStepMult(state) {
  const flat = state.thresholdFlatBought ? 0.5 : 1;   // ×20 → ×10
  return tierQuantumStepMult(state) * flat;
}

/** 每次捕获得到几个量子（涨落增幅：2 → 3） */
export function quantumPerPair(state) {
  return state.pairBoostBought ? 3 : QUANTUM.perPair;
}

/** 未花无限点 → a区 产率倍率（AD unspentBonus 同源，**硬封顶**见 unspentBoost.maxMult） */
export function unspentBoostMult(state) {
  if (!state.unspentBoostBought) return new Decimal(1);
  const ip = state.infinityPoints ?? 0;
  const n = ip instanceof Decimal ? ip : new Decimal(ip);
  const m = new Decimal(1).add(n.div(2).pow(1.5));
  const cap = new Decimal(INFINITY_UPGRADES.unspentBoost.maxMult ?? 1e3);
  return m.gt(cap) ? cap : m;
}

export function quantumZpeRequirement(pairs, lubeMult = 1) {
  const n = pairs instanceof Decimal ? pairs : new Decimal(pairs ?? 0);
  // 用户设定的「再 ×2」并进底数：10 × 2 = 20；lubeMult 是「量子润滑」的缓和倍率
  const step = new Decimal(QUANTUM.zpeCostGrowth).mul(QUANTUM.zpeCostExtraNerf ?? 1).mul(lubeMult);
  return new Decimal(QUANTUM.zpeBaseCost).mul(Decimal.pow(step, n));
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
  ipExponent: 2,
};

/** 大坍缩阈值的显示字符串（和实际值同源，不会脱节） */
export const CRUNCH_AT_LABEL = `1e${BREAK_INFINITY.maxLog10.toFixed(4)}`;

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
  /** 超出拐点后，每多少阶速率减半 */
  halvingOrders: 10,
  /** 每个量子把拐点往上推迟多少阶（log10(1.01)，即「每量子 +1%」） */
  quantumDelayPerQuantum: 0.00432137,
};

/** 过载拐点（阶）—— 物质超过它就开始减速 */
export function overloadThreshold(state) {
  const q = state.quantum instanceof Decimal ? state.quantum : new Decimal(state.quantum ?? 0);
  return new Decimal(BREAK_INFINITY.maxLog10).add(q.mul(OVERLOAD.quantumDelayPerQuantum));
}

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
  /** ① 无限点收益 ×3/级（可重复；首价 1，每级 ×10，效果 ×3） */
  ipDouble: {
    id: "ipDouble",
    name: "无限增幅",
    repeatable: true,
    firstCost: 1,
    costMult: 10,
    effectMult: 3,
    zone: "ip",
    desc: "每次无限的无限点收益 ×3",
  },

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
  /** 门槛压平：量子门槛步长 ×20 → ×10（原稿候选 11；现在能放大 q² 收益） */
  thresholdFlat: {
    id: "thresholdFlat",
    name: "门槛压平",
    cost: 50,
    desc: "量子门槛步长 ×20 → ×10",
    zone: "dm",
  },
  /** 涨落增幅：每对量子 +2 → +3（原稿候选 10） */
  pairBoost: {
    id: "pairBoost",
    name: "涨落增幅",
    cost: 5,
    desc: "每对量子 2 → 3",
    zone: "dm",
  },
  /**
   * 未花 IP 加产率（原稿候选 15，AD `unspentBonus` 同源）：a区 产率按**未花无限点**提升。
   *
   * ⚠️ **必须有硬上限**（用户指定：影响永恒阶段的东西要有极强软上限）。
   *    AD 原式 `(IP/2)^1.5 + 1` 单独看很危险：IP 到 1e308 时它是 1e462，
   *    物质爬升会被瞬间抹平（整条 24h 阶梯失去意义）。所以这里**封顶 ×1000**：
   *    它只在"攒铸币种子"的那几个小时里起作用，之后恒定 —— 定位是**种子**，不是 runaway。
   */
  unspentBoost: {
    id: "unspentBoost",
    name: "沉潜蓄能",
    cost: 5,
    desc: "a区产率 按未花无限点 ×(1+(IP/2)^1.5)，封顶 ×1000",
    zone: "matter",
    maxMult: 1000,
  },
  ipFromQuantum: {
    id: "ipFromQuantum",
    name: "量子铸币",
    cost: 100,
    desc: "大坍缩收益 +本次最大量子数²",
    zone: "ip",
  },
  ipToZpe: {
    id: "ipToZpe",
    name: "零点耦合",
    cost: 1,
    perIp: 1,
    zone: "zpe",
    desc: "ZPE 倍率 += 无限点数量",
  },

  /** ③ 无限点 → 相变仪转换速率（ZPE → 暗能量） */
  ipToTransmuter: {
    id: "ipToTransmuter",
    name: "相变超频",
    cost: 1,
    perIp: 0.5,
    zone: "de",
    desc: "相变仪速率 ×(1 + 无限点×0.5)",
  },

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
    desc: "每秒实时获得「1 ÷ 60」点（吃 ① 的加成），单次最多计 30 分钟",
  },

  // ══════════════════════════════════════════════════════════
  // ★ 加速「e25 → e308.25」那一段的两条线
  //
  //   为什么要专门为这一段加升级：这段的斜率 = 量子成长速率 R（被 growthRateMax 钳制），
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
   * 速率解放 I~IV：抬高量子成长速率的**上限**（`QUANTUM.growthRateMax`）的倍率。
   *
   * ⚠️ 用**百分比**而不是绝对值，这样最终 R₀ 定成多少都自动跟随 ——
   *    避免"改了 knee/D 以后这几条升级的数值全要重算"。
   */
  rate110: { id: "rate110", name: "速率解放 I", cost: 10, rateMult: 1.10, zone: "dm", desc: "量子成长速率上限 ×1.10" },
  rate121: { id: "rate121", name: "速率解放 II", cost: 100, rateMult: 1.10, zone: "dm", desc: "量子成长速率上限 ×1.10" },
  rate139: { id: "rate139", name: "速率解放 III", cost: 1000, rateMult: 1.15, zone: "dm", desc: "量子成长速率上限 ×1.15" },
  rate167: { id: "rate167", name: "速率解放 IV", cost: 10000, rateMult: 1.20, zone: "dm", desc: "量子成长速率上限 ×1.20" },
};

/**
 * 无限升级的展示顺序（UI 与自检共用）。
 * UI 会把它排成 2×n 网格，所以顺序就是格子顺序（左→右、上→下）。
 */
export const INFINITY_ORDER = [
  "ipFromQuantum", "thresholdFlat", "pairBoost", "unspentBoost",
  "ipDouble", "ipToZpe",
  "ipToTransmuter", "ipTime",
  "start50", "start100",
  "start150", "start200",
  "rate110", "rate121",
  "rate139", "rate167",
];


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
 *    **规矩：加新升级必须同时改这里**（`tools/coinage-lab.mjs` 有对应断言）。
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
  if (id === "unspentBoost") return state.unspentBoostBought === true;
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
 * ★ 坍缩加速器（可重复，花无限点）—— **直接买时间的那条升级**
 *
 * 依据 `tools/crunch-speed-lab.mjs` 的结论：一次大坍缩的耗时
 *   `t = ∫ dL / (R · climb(L) · overload(L))`
 * 与成长速率 `R` **严格成反比**（断言钉住"R 提升 k 倍 ⇒ 耗时 ÷k"）。
 * 所以"让每次大坍缩更快"的正确写法就是**乘 R**，而不是去动爬升形状。
 *
 * ⚠️ 它是 IP 侧循环，所以**必须自带上限**（用户指定：影响永恒阶段的东西要有极强软上限）：
 *    这里用的是**硬上限**（而不是价格软上限）—— 效果最大 ×2（≈ 每次省一半时间），
 *    因为它的存在意义是"把 24h 档压到 18h"，而不是当第二个 runaway。
 *    需要 18h 档时：`×1.35`（约 15 级）；满级 ×2 是留给后续内容的余量。
 */
export const CRUNCH_ACCEL = {
  /** 第 1 级价格（无限点） */
  baseCostIp: 1e3,
  /** 每级涨价 */
  costGrowth: 3,
  /** 每级让成长速率 ×1.02（≈ 每次都快 2%） */
  perLevel: 0.02,
  /** ★ 效果硬上限：速率最多 ×2（≈ 耗时最多减半） */
  maxMult: 2,
};

/** 坍缩加速器等级（效果封顶后等级也不再涨） */
export function accelLevel(state) {
  const lv = state.accelLevel ?? 0;
  const n = lv instanceof Decimal ? lv.toNumber() : Number(lv) || 0;
  return Math.min(n, accelMaxLevel());
}

/** 效果封顶对应的等级：`1.02^N = 2` */
export function accelMaxLevel() {
  return Math.ceil(Math.log(CRUNCH_ACCEL.maxMult) / Math.log(1 + CRUNCH_ACCEL.perLevel));
}

/** 加速器对**成长速率**的倍率（1 ~ maxMult） */
export function accelMult(state) {
  return Math.min(Math.pow(1 + CRUNCH_ACCEL.perLevel, accelLevel(state)), CRUNCH_ACCEL.maxMult);
}

/** 下一级价格 */
export function accelCost(state) {
  return new Decimal(CRUNCH_ACCEL.baseCostIp).mul(Decimal.pow(CRUNCH_ACCEL.costGrowth, accelLevel(state)));
}

/**
 * 无限升级「速率解放」（`rateMult`）的**合并倍率** = ∞ 层已买的档位 × 坍缩加速器。
 *
 * ★ 单一数据源：`quantumGrowthRate(量子, infinityRateMult(state))` 是唯一的入口，
 *   所以任何"改成长速率"的机制都必须并进这里，不许各写各的（否则会漏乘）。
 */
export function infinityRateMult(state) {
  let m = new Decimal(1);
  for (const cfg of Object.values(INFINITY_UPGRADES)) {
    if (cfg.rateMult == null) continue;
    if ((state.speedBought ?? {})[cfg.id] === true) m = m.mul(cfg.rateMult);
  }
  return m.mul(accelMult(state)).mul(tierRateMult(state));
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
  if (!state.ipTimeBought) return new Decimal(0);
  // ★ 同样吃铸币倍率（④「无限长河」也是无限点收入）
  return Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, state.ipDoubleLevel ?? 0)
    .mul(coinageMult(state))
    .div(INFINITY_UPGRADES.ipTime.secondsPerPoint);
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
  if (!state.ipTimeBought) return new Decimal(0);
  const cap = timeIPCapSeconds();
  const counted = cap === Infinity ? seconds : Math.min(seconds, cap);
  return new Decimal(counted).div(INFINITY_UPGRADES.ipTime.secondsPerPoint)
    .mul(Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, state.ipDoubleLevel ?? 0));
}
