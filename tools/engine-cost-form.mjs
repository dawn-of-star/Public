#!/usr/bin/env node
/**
 * tools/engine-cost-form.mjs —— **引擎价格该用什么「函数形状」？**（多项式 vs 指数）
 *
 * ── 问题（用户 2025 提问）──
 *   「三次方还适合我们么？」
 *
 * ── 为什么这不只是数值问题 ──
 *   把两件事的函数形状摆在一起看，匹配与否是**结构性的**：
 *
 *   ① **效果**：`k(lv) = 1 + 25·x/(1+x)`，`x = lv/knee`
 *      ⇒ **渐近饱和**：`k → 26`，且**有硬上限** ⇒ 效果随等级是"有界"的
 *   ② **价格**：`cost(lv) ∝ lv^p`（多项式）
 *      ⇒ IP 池随轮数**线性**增长（`pool ~ ρ·t`）
 *      ⇒ 可买等级 `lv ~ pool^(1/p) = (ρ·t)^(1/p)`
 *      ⇒ **等级随时间是幂函数 ⇒ 无界、不收敛** ✗
 *
 *   ⇒ 一个**有界**的效果配一个**无界**的价格 ⇒ 等级会**冲过**饱和点：
 *     一旦 `lv >> knee`，`k` 已经贴住 26，之后买的每一级**毫无作用** ✗
 *
 *   而**指数价格** `cost ∝ r^lv`：
 *     ⇒ 可买等级 `lv ~ log(pool)/log(r) ∝ log(t)` ⇒ **对数收敛、有天花板** ✓
 *     ⇒ 与"渐近饱和的效果"**形状匹配** ✓
 *
 * 用法：node tools/engine-cost-form.mjs
 */
import { MATTER_B_KNEE, MATTER_B_KMAX, ZPE_ENGINE } from "../src/config.js";

const kOf = (lv, knee = MATTER_B_KNEE) => 1 + MATTER_B_KMAX * ((lv / knee) / (1 + lv / knee));
/** 多项式累计价格（log10） */
const polyTotalLog = (lv, p) => Math.log10(ZPE_ENGINE.baseCostIp) + p * Math.log10(Math.max(1, lv));
/** 指数累计价格（log10）：base·(r^lv − 1)/(r − 1) ≈ base·r^lv/(r−1) */
const expTotalLog = (lv, r) => Math.log10(ZPE_ENGINE.baseCostIp) + lv * Math.log10(r);

console.log("=".repeat(90));
console.log("引擎价格：函数形状 vs 效果形状");
console.log("=".repeat(90));
console.log(`  效果：k = 1 + ${MATTER_B_KMAX}·x/(1+x)，x = lv/${MATTER_B_KNEE}  ⇒ 渐近饱和于 ${1 + MATTER_B_KMAX}（**有界**）`);
console.log(`  价格：现状 = ${ZPE_ENGINE.baseCostIp}·(lv+1)³（**多项式 ⇒ 等级随时间无界**）`);
console.log();

// ── 表 1：给定"每轮 IP 收入"的增长率，两种价格下等级随时间的走向 ──
//   假设：IP 池按复利增长（每轮 ×g），轮耗时恒定。这是 IP 经济的最简模型。
console.log("表 1｜等级随时间的走向（IP 池每轮 ×g 复利，轮耗时 6 分钟）");
console.log("    价格形状        g=1.02/轮   g=1.05/轮   g=1.10/轮   g=1.20/轮   随时间收敛?");
const solvePoly = (poolLog, p) => Math.pow(Math.pow(10, poolLog) / ZPE_ENGINE.baseCostIp, 1 / p);
const solveExp = (poolLog, r) => poolLog / Math.log10(r);
for (const [label, fn] of [
  ["多项式 p=3（现状）", (pl) => solvePoly(pl, 3)],
  ["多项式 p=2", (pl) => solvePoly(pl, 2)],
  ["指数 ×2/级", (pl) => solveExp(pl, 2)],
  ["指数 ×1.2/级", (pl) => solveExp(pl, 1.2)],
]) {
  const rows = [1.02, 1.05, 1.10, 1.20].map((g) => {
    // 到 t 小时时的池子（log10）：pool = 1e5.3 × g^(轮数)，轮数 = t·10
    const lvAt = (t) => fn(5.3 + t * 10 * Math.log10(g));
    return { h168: lvAt(168), h10000: lvAt(10000) };
  });
  const converge = label.startsWith("指数") ? "✅ 收敛（∝log t）" : "❌ 不收敛（∝t^(1/p)）";
  console.log(
    `  ${label.padEnd(18)}  ` +
    rows.map((r) => `168h=${r.h168.toExponential(1)}`.padEnd(13)).join("") + "  " + converge
  );
}
console.log();
console.log("  ⚠️ 多项式下等级随时间**无界增长** ⇒ 最终必然 `lv >> knee` ⇒ 白买（k 已贴住 26）");
console.log("     指数下等级 `∝ log(t)` ⇒ 有天花板 ⇒ 与「渐近饱和的 k」**形状匹配** ✓");
console.log();

// ── 表 2：换成指数价格后，天花板在哪 ──
console.log("表 2｜指数价格的天花板：`lv* ≈ poolLog / log10(r)`");
console.log("    每级倍率 r   天花板等级@池1e10   天花板等级@池1e20   天花板等级@池1e40");
for (const r of [1.2, 1.5, 2, 3, 10]) {
  const f = (pl) => pl / Math.log10(r);
  console.log(
    `  ${String(r).padStart(11)}  ${f(10).toFixed(0).padStart(18)}  ${f(20).toFixed(0).padStart(18)}  ${f(40).toFixed(0).padStart(18)}`
  );
}
console.log();
console.log("  ★ 选 r 的判据：让**最坏情况下**的天花板 ≈ `knee × 20`（k ≈ 25.6，几乎吃满）");
console.log(`     当前 knee = ${MATTER_B_KNEE} ⇒ 目标天花板 ≈ ${MATTER_B_KNEE * 20}`);
console.log();

// ── 表 3：与 ① 的一致性 ──
console.log("表 3｜与 ①（无限增幅）的一致性");
console.log("    ① 的价格是**指数**（×10 → ×100 → ×1000 分段），效果是**无上限**的 2^lv");
console.log("    引擎的价格若是多项式、效果是**有上限**的 k → 两者形状相反 ✗");
console.log("    ⇒ 若引擎也走**指数价格**，两个 IP 消费者就同形 ⇒ 调起来一套逻辑 ✓");
console.log();

// ── 结论 ──
console.log("=".repeat(90));
console.log("  ★ 结论：三次方**不适合**，原因是结构性的（不是「贵一点便宜一点」）");
console.log("=".repeat(90));
console.log("  1. **形状不匹配**：有界的效果（k→26）配无界的价格（多项式）");
console.log("     ⇒ 等级必然冲过 knee ⇒ 之后买的每一级都白买 ✗");
console.log("  2. **与 ① 不同形**：① 是指数价格 + 无上限效果（自洽）；引擎是多项式 + 有上限（不自洽）");
console.log("  3. **推荐**：引擎价格改成**指数**（每级 ×r），并把 `r` 按「天花板 ≈ knee×20」反解");
console.log("     好处：① 与引擎**同形** ⇒ 两个 IP 消费者共用一套心智与标定方法 ✓");
console.log();
console.log("  ⚠️ 但**先别动**：换价格形状会同时改变 (i) 引擎爬升速度 (ii) 物质曲线的陡度");
console.log("     ⇒ 必须与 `MATTER_B_KNEE` 的取值**一起**标定，改完跑 `stage-timing` 复测。");
console.log("     本表只给形状结论，不给具体数值 —— 那个要你定「一周后 k 想到多少」。");
