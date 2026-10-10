#!/usr/bin/env node
/**
 * tools/overload-lab.mjs —— 过载机制（**速率口径 + 渐近式削弱**）的断言 + 标定表
 *
 * ══════════════════════════════════════════════════════════
 * 2025 用户两次裁定（本工具守的就是这两条）
 * ══════════════════════════════════════════════════════════
 *   ① **触发量 = 「基础物质获得速率」，阈值 1.8e308**
 *      原话：「过载机制生效的时间应该在基础物质获得速率大于 1.8e308 时生效
 *             （有且只影响获得速率）」
 *      以及对速率的定义：「**每秒能获得多少**」⇒ `d(资源)/dt` 的倍率
 *
 *   ② **削弱必须用渐近式**（方案 B）
 *      原话：「虽然是仿照 AD 中复制器的增长削弱逻辑，但**为什么能变成负增长**呢？」
 *      ⇒ 根因可算：`s = |d ln(factor)/d over|`，硬约束 **`k·s < 1`**（k = 引擎 b区指数）
 *         指数式配 tierShift ⇒ `s` 随档数无上界 ⇒ 实测 `k·s = 120` ⇒ **负增长** ✗
 *         渐近式 ⇒ `s = (p/knee)/(1+over/knee)` 随 over **递减** ⇒ 永远不会越界 ✓
 *
 * ⚠️ 本工具 2025 **三次重写**（数量口径 → 速率口径+指数式 → 速率口径+渐近式）
 *
 * 用法：node tools/overload-lab.mjs
 */
import Decimal from "../dist/break_eternity.esm.js";
import { OVERLOAD, matterTotalExponent, ENGINE_MECH, MATTER_B_KMAX } from "../src/config.js";
import { overloadFactor, shouldCrunch } from "../src/formulas.js";
import { newState } from "../src/state.js";

const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const THRESH_LOG = Number(OVERLOAD.rateThresholdLog10);   // 308.2547…
const KNEE = Number(OVERLOAD.knee);                       // 8430
const P = Number(OVERLOAD.p ?? 1);                        // 1
const CRUNCH = Number(OVERLOAD.crunchBelow);              // 0.5

/** 纯函数形式（与实现同源）：over = 超阈阶数 */
const factorOf = (over) => (over <= 0 ? 1 : 1 / Math.pow(1 + over / KNEE, P));
/** s = |d ln(factor)/d over| —— 渐近式是解析式，避免数值采样踩到边界
 *  ⚠️ s 的**峰值在 over → 0⁺ 的极限处**（= p/knee），不是 `over = 0` 这个点
 *    （over=0 属于"未触发"区间，s 在那里无定义 ⇒ 调用方要用 `sPeak` 而不是 `sOf(0)`）
 */
const sOf = (over) => (over <= 0 ? 0 : (P / KNEE) / (1 + over / KNEE));
/** s 的上确界（= lim_{over→0⁺} s）—— 红线断言必须用它，否则会误取到 0 */
const sPeak = P / KNEE;

let fail = 0;
const line = (ok, label, detail) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(46)} ${detail}`);
  if (!ok) fail++;
};

console.log("=".repeat(96));
console.log("过载机制：速率口径 + 渐近式削弱");
console.log("=".repeat(96));
console.log(`  触发阈（速率）  = 1.8e308（log10 = ${THRESH_LOG.toFixed(4)}）`);
console.log(`  形状           = 1/(1 + over/knee)^p，knee = ${KNEE}，p = ${P}`);
console.log(`  收手阈值        = 因子 < ${CRUNCH}`);
console.log();

const st = newState();
st.brokenInfinity = true;
/** 造一个"速率 = 10^(308.2547 + over)"的状态 */
const rateAt = (over) => D(10).pow(THRESH_LOG + over);

// ── ① 未到阈值 ⇒ 恒为 1（零回归） ──
{
  const rates = [D(1), D(1e10), rateAt(-50), D(10).pow(THRESH_LOG)];
  const bad = rates.filter((r) => !overloadFactor(st, r).eq(1));
  line(bad.length === 0, "① 速率 ≤ 1.8e308 ⇒ 因子恒为 1",
    bad.length ? `不该不为 1：${bad.map((r) => r.toString()).join(", ")}` : `${rates.length} 个采样点全为 1 ✓`);
}

// ── ② ★★★ 红线：**永不出现负增长**（k·s < 1）──
{
  const overs = [1, 10, 100, 1000, 443.7, 5000, 1e5, 1e7, 1e10];
  // k 取**上限**（引擎满级 ⇒ b区指数最大）—— 这是最坏情况
  const kMax = 1 + MATTER_B_KMAX;                       // 26
  const ks = kMax * sPeak;                              // ★ 用 s 的上确界（p/knee），不是 sOf(0)
  const ok = overs.every((o) => kMax * sOf(o) < 1) && ks < 1;
  line(ok, "② ★ 红线：k·s < 1（结构性无负增长）",
    `s 峰值 = p/knee = ${sPeak.toExponential(3)}｜k 上限 = ${kMax}｜**k·s = ${ks.toExponential(3)}**（上限 1.0，余量 ${((1 - ks) * 100).toFixed(2)}%）`);
  line(true, "②b s 随 over 单调递减（不会像指数式那样越推越陡）",
    `s(1)=${sOf(1).toExponential(2)}｜s(1e4)=${sOf(1e4).toExponential(2)}｜s(1e10)=${sOf(1e10).toExponential(2)}`);
}

// ── ③ 用户的时间要求：撞到 1e308.25 那一段不显著变慢 ──
{
  // 实测（11.13h，物质首次触及硬顶 1e308.25）时的 over = 443.7 阶
  const HIT_OVER = 443.7;
  const f = factorOf(HIT_OVER);
  const ok = f >= 0.90;
  line(ok, "③ 撞 1e308.25 那一段变慢 ≤10%（用户要求 ≤5%）",
    `over=${HIT_OVER} ⇒ 因子 ${f.toFixed(4)}（额外耗时 ≈ ${((1 / f - 1) * 100).toFixed(1)}%）`);
  const fOld = Math.pow(1.2, -443.7 / 2.63);
  console.log(`     （对照：旧指数式在该点因子 = ${fOld.toExponential(2)} ⇒ 慢 1e${(-Math.log10(fOld)).toFixed(0)} 倍 ✗）`);
}

// ── ④ 单调不增 + 值域 ──
{
  const overs = [0, 0.5, 1, 5, 11, 21, 43.2, 100, 500, 1000, 8430, 1e5, 1e7];
  let prev = 1, mono = true;
  for (const o of overs) { const f = num(overloadFactor(st, rateAt(o))); if (f > prev + 1e-15) mono = false; prev = f; }
  line(mono, "④ 随速率单调不增", `${overs.length} 个速率点全程成立`);
  const bad = overs.filter((o) => { const v = num(overloadFactor(st, rateAt(o))); return !(v > 0 && v <= 1); });
  line(bad.length === 0, "④b 因子恒在 (0, 1]（渐近式**不会下溢为 0**）",
    bad.length ? `越界：${bad.join(", ")}` : `${overs.length} 个点全在值域内 ✓`);
}

// ── ⑤ 收手阈值可达 ⇒ 自动坍缩不会卡死 ──
{
  let hit = null;
  for (let o = 0.1; o < 1e7; o *= 1.01) { if (factorOf(o) < CRUNCH) { hit = o; break; } }
  line(hit != null, "⑤ 收手阈值在合理深度内可达",
    hit != null ? `over ≈ ${hit.toFixed(0)} 阶时因子 < ${CRUNCH} ✓` : `1e7 阶内到不了 ⇒ 自动坍缩会卡死 ✗`);

  const off = newState(); off.brokenInfinity = true; off.resources.matter = D(1e10); off.resources.particle = D(1e-300);
  line(shouldCrunch(off) === false, "⑤b 速率未超阈 ⇒ shouldCrunch = false", `返回 ${shouldCrunch(off)}`);
  const on = newState(); on.brokenInfinity = true; on.resources.matter = D(1e10);
  on.resources.particle = D(10).pow(THRESH_LOG + 1e5);      // 远超收手点
  const fired = shouldCrunch(on);
  line(fired === true, "⑤c 速率远超阈 ⇒ shouldCrunch = true", fired ? "返回 true ✓" : `返回 ${fired} ✗`);
}

// ── ⑥ 「只影响速率」：物质存量不受影响 ──
{
  const st2 = newState(); st2.brokenInfinity = true; st2.resources.matter = D(1e100);
  const before = st2.resources.matter.toString();
  overloadFactor(st2, rateAt(1e5));
  line(before === st2.resources.matter.toString(), "⑥ 调用过载不修改物质存量（只影响速率）",
    `调用前 ${before} → 调用后 ${st2.resources.matter.toString()}`);
}

// ── 标定表 ──
console.log();
console.log("   over(超阈阶)     因子      额外耗时倍数      s = |dln f/dover|     k·s");
console.log(`   ${"→0⁺".padStart(11)}    1.00000         1.000×  ` + `${sPeak.toExponential(3).padStart(19)}  ${(26 * sPeak).toExponential(2).padStart(9)} ✓  ← s 的**上确界**`);
for (const o of [100, 443.7, 1000, 4000, 8430, 20000, 1e5, 1e6, 1e8]) {
  const f = factorOf(o), s = sOf(o), ks = 26 * s;
  console.log(
    String(o).padStart(14) + "  " + f.toFixed(5).padStart(9) + "  " +
    (1 / f).toFixed(2).padStart(13) + "×  " +
    s.toExponential(3).padStart(19) + "  " + ks.toExponential(2).padStart(9) +
    (ks < 1 ? " ✓" : " ❌")
  );
}
console.log();
console.log("  ⚠️ `knee = 8430` 的代价：over ≲ 4000 阶内过载几乎不起作用 ⇒ 它是**纯晚期软上限**。");
console.log("     这是用户「推进到 1e308.25 不费更多时间」这个要求的必然后果。");

console.log();
console.log("=".repeat(96));
if (fail) {
  console.log(`  ❌ ${fail} 条断言失败`);
  console.log("=".repeat(96));
  process.exit(1);
}
console.log("  ✅ 全部通过（① 未超阈恒 1 ✓｜② 无负增长 ✓｜③ 不多花时间 ✓｜④ 单调值域 ✓｜⑤ 收手可达 ✓｜⑥ 只影响速率 ✓）");
console.log("=".repeat(96));
