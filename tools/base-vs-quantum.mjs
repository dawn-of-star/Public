/**
 * tools/base-vs-quantum.mjs —— 量出「基础产率」与「量子项」在 e25→e308 这段里的真实比重。
 *
 * 它回答的是一个反复出现的设计问题：
 *   **「给产率加个指数 / 加个大倍率」能不能加速这段爬升？**
 * 答案是**不能**，而且原因不是"数值不够大"，是结构性的：
 *
 *   1. 量子项 `M×R×ln10` 从**环外**直接给物质加速，所以环（粒子）不跟物质一起涨 ——
 *      实测 L物质 25 → 308，而 L粒子 只从 13.8 涨到 24.1（停在 1e20~1e24）。
 *   2. 于是基础项的对数斜率 `s_base ∝ 粒子 / 物质`，随深度**按 1/物质 衰减**：
 *      9.6e-3 → 1.8e-229。
 *   3. 结论：任何"对粒子取 n 次方"或"给基础项乘常数 K"的升级都追不上 ——
 *      所需指数 ≈ L物质/L粒子（1.8 → 12.8，**随深度增长**），乘性加成更是抬高常数倍后被衰减吃掉。
 *
 * ⚠️ 另一个陷阱：如果那个指数落在**反馈环里**（每绕一圈再取一次 ^k），
 *    log10 会变成 `k^轮数` 的双指数 —— 「^1.002 很弱」只在它作用于**末端量**时成立。
 *
 * 用法：node tools/base-vs-quantum.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import {
  advance, buyDeUpgrade, buyDreamUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick,
} from "../src/engine.js";
import { climbFactor, matterRate } from "../src/formulas.js";
import {
  DE_UPGRADES, DREAM_UPGRADES, REPEATABLE, VOID_UPGRADES, infinityRateMult, quantumGrowthRate,
} from "../src/config.js";

const ln10 = Math.LN10;
const lg = (d) => (d.gt(0) ? d.log10().toNumber() : -Infinity);
const f = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : "—");
const check = process.argv.includes("--check");

// ── 跑一个贪心玩家，在若干刻度上取样 ──
const s = newState();
for (let i = 0; i < 10; i++) doClick(s);

const marks = [25, 50, 100, 150, 200, 250, 300, 308];
let mi = 0, t = 0;
const rows = [];
while (mi < marks.length && t < 6 * 3600) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
  for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);
  advance(s, 0.5);
  t += 0.5;

  const L = lg(s.resources.matter);
  if (L >= marks[mi]) {
    const M = s.resources.matter;
    const cf = climbFactor(s).toNumber();
    const R = quantumGrowthRate(s.quantum, infinityRateMult(s)).toNumber();
    // ★ 基础项必须**清零量子后直接读**：用减法会被量子项吃掉（浮点抵消，14 位有效数字不够）
    const qSave = s.quantum;
    s.quantum = new Decimal(0);
    const baseRaw = matterRate(s).div(cf);
    s.quantum = qSave;
    const sBase = baseRaw.div(M.mul(ln10)).toNumber();
    const Lp = lg(s.resources.particle);
    rows.push({ L, Lp, q: s.quantum.toNumber(), R, sBase, ratio: R / sBase, need: L / Lp, t });
    mi++;
  }
}

const a = rows[0], b = rows[rows.length - 1];
console.log("=".repeat(112));
console.log("基础产率 vs 量子项（真实引擎 + 贪心玩家；基础项 = 清零量子后直接读）");
console.log("=".repeat(112));
console.log(`  ${"L物质".padEnd(9)} ${"L粒子".padEnd(9)} ${"量子".padEnd(6)} ${"s_base".padEnd(13)} ${"R".padEnd(9)} ${"R/s_base".padEnd(12)} ${"追平所需粒子指数".padEnd(18)} 时刻`);
for (const r of rows) {
  console.log(`  ${f(r.L, 1).padEnd(9)} ${f(r.Lp, 1).padEnd(9)} ${String(r.q).padEnd(6)} ` +
    `${(r.sBase > 0 ? r.sBase.toExponential(2) : "0").padEnd(13)} ${f(r.R).padEnd(9)} ` +
    `${(r.ratio > 1e5 ? r.ratio.toExponential(1) : f(r.ratio, 1)).padEnd(12)} ` +
    `${("粒子^" + f(r.need, 1)).padEnd(18)} ${(r.t / 60).toFixed(1)}min`);
}

console.log();
console.log("  ① 粒子不跟物质涨（量子项在环外）：L物质 " + f(a.L, 0) + " → " + f(b.L, 0) +
  "，L粒子 只 " + f(a.Lp, 1) + " → " + f(b.Lp, 1));
console.log("  ② 基础项相对贡献 ∝ 粒子/物质，按 1/物质衰减：R/s_base " + f(a.ratio, 1) + " → " + b.ratio.toExponential(1));
console.log("  ③ 于是「产率类升级」（含对产率取方）追不上：所需指数 ≈ L物质/L粒子 = " + f(a.need, 1) + " → " + f(b.need, 1) + "（随深度增长）");
console.log();
console.log("  ④ 若指数落在**反馈环里**（每绕一圈再取 ^k）：L_n = k^n·L_0 —— 轮数的指数（双指数）");
for (const k of [1.002, 1.01, 1.05]) {
  console.log(`     k=${k}：` + [100, 500, 1000].map((n) => `${n} 轮后 ×${f(Math.pow(k, n), 2)}`).join("   "));
}

if (check) {
  console.log();
  console.log("=".repeat(112));
  console.log("定点断言");
  console.log("=".repeat(112));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(40)} ${detail}`);
  };
  const deep = rows.find((r) => r.L >= 100) ?? rows[rows.length - 1];
  ck("深处基础项远弱于量子项（>1e10 倍）", deep.ratio > 1e10,
    `L=${f(deep.L, 1)}：R/s_base = ${deep.ratio.toExponential(1)}`);
  ck("粒子不随物质爆炸（停在 1e25 以下）", b.Lp < 25, `L粒子 = ${f(b.Lp, 1)}（物质 ${f(b.L, 0)}）`);
  ck("量子项斜率 = R 且稳定", Math.abs(deep.R - 0.143) < 0.02 && Math.abs(a.R - b.R) < 0.02,
    `${f(a.R)} → ${f(b.R)} 阶/秒`);
  ck("所需指数随深度增长", b.need > a.need * 3, `粒子^${f(a.need, 1)} → 粒子^${f(b.need, 1)}`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
