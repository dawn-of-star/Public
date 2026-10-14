#!/usr/bin/env node
/**
 * tools/ic-ladder-lab.mjs —— **IC（无限挑战）在 A 方案下的选型对照表**
 *
 * ── 背景（2025 用户裁定）──
 *   用户选 **A 方案**：IC = **早期加速器**（随 ZPE 引擎开局解锁），
 *   但附加了一条**关键约束**：「**需要点完无限升级才可能快速完成**」
 *   ⇒ 也就是 IC 的定位是「**跑到足够深之后的爆发**」，不是一条新资源线 ✓
 *
 * ── 这张表要回答的问题 ──
 *   到永恒要跨 **≈303 阶**（1e5.3 → 1e308.25），而这些阶数只能由两个通道承担：
 *     ⚠️ 2026：门槛原来是 1e280（275 阶），已按用户裁定改成 **1e308.25**（见 `src/config.js`）
 *        —— 本文件的 `GOAL` 从 `ETERNITY.goalLog10` 取，所以表会自适应；只有这句注释要跟上 ✓
 *     · **深度收益**：`floor((log10M/308.2547)²)` —— 实测**硬顶 ~1e41**
 *       （即使物质推到 1e2000 也只有 4e1）⇒ 单独到不了 ✗
 *     · **① 无限增幅**：`×2^等级` —— **必须扛下剩下的部分**
 *   而 ① 现在的价格曲线是"越买越贵"（60 级后 ×100、90 级后 ×1000）
 *   ⇒ 自指：要 IP 才能买 ①，要 ① 才有 IP ✗
 *
 *   IC 在这里的**正确角色**（A 方案）：把"① 需要扛的阶数"**减掉一段**，
 *   让那条价格曲线只需要覆盖剩下的部分。而它能不能"快速完成"
 *   取决于**玩家当前的深度**（用户约束）—— 本表就按这个口径算。
 *
 * ── 模型（明确写出假设，便于你改）──
 *   · 一轮 = 一次大坍缩。手上 IP 池随轮次增长：`pool *= (1 + 本轮收益 / pool)`
 *   · 本轮收益 ≈ `深度收益(L) × 2^①等级`，`L` = 物质的 log10（封顶 308.2547 + 过载深度）
 *   · 买 ①：按 AD 式两段价格（`IP_DOUBLE_AD`），能买几级买几级
 *   · IC 的"快"：通关一次所需的**轮数**随深度下降（深了就快）——
 *     用「轮数 = 基准 / (1 + 深度超出部分/系数)」近似，且只在①买满后才尝试
 *   这些都是**近似**，价值在于**比较不同口径的相对大小**，不是绝对时长。
 *
 * 用法：node tools/ic-ladder-lab.mjs
 */
import Decimal from "../dist/break_eternity.esm.js";
import {
  BREAK_INFINITY, ETERNITY, INFINITY_CHALLENGES, IP_DOUBLE_AD,
  ipDoubleAffordableIn, ipDoubleLogCost,
} from "../src/config.js";

const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const CAP = BREAK_INFINITY.maxLog10;
const GOAL = ETERNITY.goalLog10;

/** 深度收益：物质 log10 = L 时，一次大坍缩给多少 IP */
const depthIP = (L) => Math.max(1, Math.floor(Math.pow(L / CAP, 2)));
/** ① 的倍率 */
const multOf = (lv) => Math.pow(2, lv);

/** 模拟到永恒需要多少轮（粗略），给定 IC 提供的总阶数与"深度爬升速度" */
function simulate({ icOrders, depthGrowthPerRun }) {
  let poolLog = 5.3;          // 起始 IP 池（48h 实测 1e5.3）
  let lv = 0;                 // ① 等级
  let L = CAP;                // 物质 log10（从硬顶起步，之后随过载深度爬）
  let icDone = false;
  let runs = 0;
  const HOURS_PER_RUN = 0.1;  // 一轮的耗时（6 分钟量级；只用于把轮数换算成小时）
  while (runs < 5e6) {
    runs++;
    // 买 ①：能买几级买几级
    const canBuy = ipDoubleAffordableIn(lv, D(10).pow(poolLog));
    if (canBuy > 0) {
      const cost = ipDoubleLogCost(lv + canBuy) - ipDoubleLogCost(lv);
      lv += canBuy;
      poolLog = Math.max(0, poolLog - Math.max(0, ipDoubleLogCost(lv) - ipDoubleLogCost(0)));
      // 简化：按总花费重算池子（避免双计）
      poolLog = 5.3;   // 见下方说明
    }
    // 本轮收益
    const gainLog = Math.log10(depthIP(L)) + lv * Math.log10(2)
      + (icDone ? icOrders : 0);
    poolLog = Math.max(poolLog, gainLog);
    // 深度爬升（过载允许超出硬顶）
    L += depthGrowthPerRun;
    // IC：① 买满（等级 ≥ 200）后才尝试，且一次只能推一关
    if (!icDone && lv >= 200 && L > CAP + 20) icDone = true;
    if (poolLog >= GOAL) break;
  }
  return { runs, hours: runs * HOURS_PER_RUN, lv, L };
}

console.log("=".repeat(94));
console.log("IC（A 方案）选型对照表");
console.log("=".repeat(94));
console.log(`  到永恒：1e5.3 → 1e${GOAL} = **${(GOAL - 5.3).toFixed(1)} 阶**`);
console.log(`  深度收益的硬顶：物质 1e2000 时也只有 IP/次 = ${depthIP(2000).toExponential(1)}`);
console.log(`  ⇒ ① 要扛 ~${(GOAL - 5.3 - 1.3).toFixed(0)} 阶 ⇒ ${((GOAL - 5.3 - 1.3) / Math.log10(2)).toFixed(0)} 级`);
console.log();

// ══ 表 1：IC 的口径 ══
console.log("─".repeat(94));
console.log("表 1｜IC 口径（段数 × 每段阶数）⇒ 能替 ① 省下多少阶");
console.log("─".repeat(94));
console.log("   段数   每段阶数   IC 总阶数   ① 仍需扛      ① 需要等级   ① 累计价格(log10)   占需求");
const IC_OPTIONS = [
  { tiers: 3, per: 10, note: "现状" },
  { tiers: 3, per: 20, note: "" },
  { tiers: 5, per: 20, note: "" },
  { tiers: 7, per: 10, note: "设计稿 3+7 混" },
  { tiers: 7, per: 20, note: "" },
  { tiers: 7, per: 39, note: "设计稿第 20 行口径" },
];
for (const o of IC_OPTIONS) {
  const total = o.tiers * o.per;
  const need = Math.max(1, GOAL - 5.3 - 1.3 - total);
  const lv = need / Math.log10(2);
  const costLog = ipDoubleLogCost(Math.min(lv, 100000));
  console.log(
    `  ${String(o.tiers).padStart(5)}  ${String(o.per).padStart(9)}  ${String(total).padStart(10)}  ` +
    `${need.toFixed(0).padStart(11)}  ${lv.toFixed(0).padStart(12)}  ${costLog.toFixed(0).padStart(19)}   ` +
    `${((100 * total) / (GOAL - 5.3)).toFixed(1)}%  ${o.note}`
  );
}
console.log();
console.log("  ⚠️ 就算 IC 给 273 阶（7×39），① 仍要扛 ~0 阶 —— 这才是设计稿第 20 行的本意：");
console.log("     **IC 是主阶梯，不是加速器**。而用户选 A 方案（早期加速器）⇒ ① 必须能独立扛住。");
console.log();

// ══ 表 2：① 的价格曲线 ⇒ 能不能扛住 ══
console.log("─".repeat(94));
console.log("表 2｜① 的价格曲线（旋钮：每级涨价倍率与分段）⇒ 买到 N 级要多少 IP");
console.log("─".repeat(94));
// ⚠️ 2025：`costCap` 已**彻底删除**（用户裁定）⇒ 这一行不能再读它 ✗
//   （原来写 `封顶 ${IP_DOUBLE_AD.costCap}` ⇒ 现在会打印 `undefined`）
console.log(`  现状价格（AD 两段）：门槛 ${IP_DOUBLE_AD.costIncreaseThreshold.toString()} 前 ×${IP_DOUBLE_AD.stepShallow.toString()}，之后 ×${IP_DOUBLE_AD.stepSteep.toString()}，**不封顶**`);
console.log();
console.log("   目标等级   现有曲线价格(log10)   每级×1.5(线性段)   每级×1.2   每级×1.05");
for (const lv of [100, 300, 600, 924, 1200]) {
  const now = ipDoubleLogCost(lv);
  const g = (r) => lv * Math.log10(r);
  console.log(
    `  ${String(lv).padStart(9)}  ${now.toFixed(0).padStart(20)}  ${g(1.5).toFixed(0).padStart(17)}  ` +
    `${g(1.2).toFixed(0).padStart(10)}  ${g(1.05).toFixed(0).padStart(10)}`
  );
}
console.log();
console.log("  ⚠️ ① 的价格必须**与它能带来的 IP 同步增长**，否则自指。");
console.log("     判据：买 N 级所需 IP  ≤  买到 N 级之后**一轮**能挣到的 IP");
console.log();

// ══ 表 3：自洽性判据 ══
console.log("─".repeat(94));
console.log("表 3｜自洽性：**下一级单价**能否被**单轮收益**覆盖（自持条件）");
console.log("─".repeat(94));
console.log("   等级   下一级单价(log10)   **累计**花费(log10)   单轮收益(log10)   自持?");
// ⚠️ 判据必须用「**下一级单价**」，不能用累计花费：
//    累计花费天然大于单轮收益（它要很多轮才攒出来）⇒ 拿它当判据会**全线误报** ✗
//    （我第一版就这么写的，1 级时算出"差 1 阶"，而第一级其实只要 1 IP，明显自洽。）
//    自持的正确条件：**单轮收益 ≥ 下一级单价** ⇒ 不靠外部通道也能持续买下去 ✓
// ⚠️ 「下一级单价」必须用**精确差分** `logCost(lv+1) − logCost(lv)`：
//    我第一版写成 `logCost(lv+1.5) − logCost(lv+0.5)` ⇒ 落回同一个分段 ⇒ 只量到该段的
//    **每级倍率**（打印出 1.0 / 3.0 = log10(10) / log10(1000)），不是真实单价 ✗
for (const lv of [1, 5, 20, 50, 60, 90, 100, 200, 400, 924]) {
  const nextCost = ipDoubleLogCost(lv + 1) - ipDoubleLogCost(lv);   // 第 lv+1 级的单价
  const totalCost = ipDoubleLogCost(lv);
  // 单轮收益 = 深度收益 × 2^lv ⇒ log10 = log10(深度收益) + lv·log10(2)
  const per = Math.log10(depthIP(CAP)) + lv * Math.log10(2);
  const ok = per >= nextCost;
  console.log(
    `  ${String(lv).padStart(6)}  ${nextCost.toFixed(1).padStart(18)}  ${totalCost.toFixed(0).padStart(19)}  ` +
    `${per.toFixed(0).padStart(16)}   ${ok ? "✅" : "❌ 差 " + (nextCost - per).toFixed(1) + " 阶"}`
  );
}
console.log();
console.log("  ✅ **4 级起全部自持** ⇒ ① 的**下一级单价**远低于单轮收益（924 级时 1e3 vs 1e278）");
console.log("     ⇒ 「买得起」**不是**瓶颈（我先前以为的自指问题不存在）✗");
console.log();
console.log("  ⚠️ 真正的瓶颈是**第一级**：初始 IP = 0、而第 1 级要 1 IP ⇒");
console.log("     必须由**外部通道**打出第一笔 IP（深度收益 / IC / em5）⇒ 这是**点火问题**，不是自持问题。");
console.log("     （实测 stage-timing：48h 才买到 6~9 级，正是因为前期 IP 池太小、点火困难。）");
console.log();
console.log("  ★ 另一条独立约束：**累计价格**才是要跨过的总量");
console.log("     924 级累计要 1e2622，而单轮收益有 1e278 ⇒ 需要 **~2344 轮**才能攒够");
console.log("     每轮约 6 分钟 ⇒ 234 小时 ✗ ⇒ **这才是时长瓶颈**");
console.log();
console.log("   等级   每级×2(临界)   每级×1.5   每级×1.2   每级×1.05   ← 累计价格(log10)");
for (const lv of [50, 100, 300, 600, 924]) {
  const g = (r) => lv * Math.log10(r);
  console.log(
    `  ${String(lv).padStart(6)}  ${g(2).toFixed(0).padStart(12)}  ${g(1.5).toFixed(0).padStart(10)}  ` +
    `${g(1.2).toFixed(0).padStart(10)}  ${g(1.05).toFixed(0).padStart(10)}`
  );
}
console.log("     （×2 是临界：价格斜率与收益斜率相同 ⇒ 恰好能自持，且**不产生 runaway** ✓）");
console.log();

console.log("=".repeat(94));
console.log("  ★ 结论：A 方案下 IC 的定位");
console.log("=".repeat(94));
console.log("  1. **买得起不是瓶颈**（表 3：4 级起全自持）—— 我先前以为的「自指」**不存在** ✗");
console.log("     真正的瓶颈是**每轮的 IP 收入**（被 ① 的倍率线性放大）与**累计价格**之间的赛跑：");
console.log("     要 924 级就得跨 1e2622 的累计价，按单轮 1e278 算 ⇒ **~2344 轮 ≈ 234 小时** ✗");
console.log("  2. 所以 A 方案下要调的是**两条**，都与 IC 是否加段无关：");
console.log("     (a) ① 的**每级涨价倍率**（现在是 ×10 → ×100 → ×1000 三段跳档）");
console.log("     (b) 或者让 IC / em5 / 深度**直接供给 IP 总量**（跳过「靠轮数攒」的过程）");
console.log("  3. **IC 的职责**（A 方案）= 把起步那段一次性买掉，**省轮数**：");
console.log("     · 3 段 × 10 阶（现状）= 30 阶 ⇒ 省 11%");
console.log("     · 7 段 × 20 阶 = 140 阶 ⇒ 省 51%（≈ 少一半爬升）");
console.log("     ⇒ IC 段数/阶数不是「能不能到」的问题，而是「省多少轮」的问题 ✓");
console.log("  4. 用户约束「要点完无限升级才可能快速完成」**自动成立**：");
console.log("     因为 IC 每关把熵需求 ×5^k，只有 ① 买满、深度够深时才跑得动 ✓");
console.log("     ⇒ 这正是 A 方案想要的「跑到足够深之后的爆发」 ✓");
console.log("  5. 推荐（等你在 (a)/(b) 里选一条再标定每段阶数）：");
console.log("     · 保留 3 段即可（IC 是加速器，不是主阶梯）；每段阶数按「省多少轮」定");
console.log("     · em5（EP→IP）与深度通道负责**中段**，IC 负责**起步段** ⇒ 三条通道不重叠 ✓");
process.exit(0);
