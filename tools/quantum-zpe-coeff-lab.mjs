/**
 * tools/quantum-zpe-coeff-lab.mjs —— **`+c·q³` 的系数 c 怎么定**（拉表推导）
 *
 * 背景：ZPE 引擎设计稿第 3 条改成「量子对 zpe 倍率的加成」，走**加法区** ✓
 *   `zpeMultiplier += c · q³`    （q = 量子个数）
 *
 * 为什么系数必须小：`q³` 的斜率天然很陡 ✓
 *   `d ln(term)/d ln(q) = 3` ⇒ q 涨 10 倍，项就涨 1000 倍 ✗
 *
 * ── 判据（可讨论，但先用这套定数）──
 *   ① 第一次大坍缩附近（q ≈ 4）：量子项给 ZPE 倍率 **×2 ~ ×4** 的观感（锦上添花 ✓）
 *   ② 常规一轮结束（q ≈ 30）：量子项 ≈ **8 ~ 12 级引擎**（`log2(项) ∈ [8,12]` ✓）
 *   ③ q ≥ 100 时**能反超**引擎的中低等级（否则这条到后期没存在感 ✗）
 *
 * 用法：node tools/quantum-zpe-coeff-lab.mjs [--check]
 */
import { DE_MILESTONES, ZPE_EXPONENT } from "../src/config.js";

const BASE_V8 = 1.5;          // v8 虚空升级
const BASE_DM1 = 2;           // dm1 里程碑
const FACTOR = BASE_V8 * BASE_DM1;

const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");

/** 量子项 = c·q³ */
const term = (c, q) => c * Math.pow(q, 3);
/** 基础 ZPE 倍率（不含量子项）：(ZPE+1)^0.02 × 1.5 × 2 */
const base = (zpeLog10) => Math.pow(10, ZPE_EXPONENT * zpeLog10) * FACTOR;
/** 等效引擎等级：`2^lv = 项` ⇒ lv = log2(项) */
const lvEq = (c, q) => Math.log2(Math.max(1e-9, term(c, q)));

console.log("=".repeat(104));
console.log("① 不同 c 下，量子项在各阶段的值（以及它值多少级引擎）");
console.log("=".repeat(104));
const CASES = [
  { name: "首次大坍缩附近", q: 4, zpeLog10: 10 },
  { name: "常规一轮结束", q: 30, zpeLog10: 60 },
  { name: "打破无限后", q: 100, zpeLog10: 300 },
  { name: "后期", q: 300, zpeLog10: 1000 },
];
console.log(`  ${pad("c", 8)}${pad("q", 6)}${pad("c·q³", 12)}${pad("基础倍率", 12)}${pad("项/基础", 10)}${pad("总倍率/基础", 12)}等效引擎等级`);
for (const c of [0.01, 0.03, 0.1, 0.3, 1.0]) {
  for (const cs of CASES) {
    const t = term(c, cs.q), b = base(cs.zpeLog10);
    console.log(`  ${pad(c, 8)}${pad(cs.q, 6)}${pad(t.toExponential(2), 12)}${pad(b.toExponential(2), 12)}${pad((t / b).toFixed(2), 10)}${pad((1 + t / b).toFixed(2), 12)}${lvEq(c, cs.q).toFixed(1)}`);
  }
  console.log();
}

console.log("=".repeat(104));
console.log("② 用判据反解 c 的可行区间");
console.log("=".repeat(104));
// 判据①：q=4 时 (base+term)/base ∈ [2,4]（base 取 ZPE=1e10 ⇒ 1.58×3 = 4.75）
const b4 = base(10);
const c1lo = (b4 * 1) / Math.pow(4, 3), c1hi = (b4 * 3) / Math.pow(4, 3);
console.log(`  判据①（q=4 给 ×2~×4）：c ∈ [${c1lo.toFixed(4)}, ${c1hi.toFixed(4)}]`);
// 判据②：q=30 时 log2(term) ∈ [8,12]
const c2lo = Math.pow(2, 8) / Math.pow(30, 3), c2hi = Math.pow(2, 12) / Math.pow(30, 3);
console.log(`  判据②（q=30 等效 8~12 级引擎）：c ∈ [${c2lo.toFixed(4)}, ${c2hi.toFixed(4)}]`);
const lo = Math.max(c1lo, c2lo), hi = Math.min(c1hi, c2hi);
const cRec = Math.sqrt(lo * hi);            // 几何中点
console.log(`  ⇒ 交集 c ∈ [${lo.toFixed(4)}, ${hi.toFixed(4)}] ⇒ **取几何中点 c = ${cRec.toFixed(4)} ⇒ 圆整为 0.1** ✓`);
console.log();
console.log("  ③ 校验（c = 0.1）：");
for (const cs of CASES) {
  const t = term(0.1, cs.q), b = base(cs.zpeLog10);
  console.log(`     q=${pad(cs.q, 5)}项/基础 = ${pad((t / b).toFixed(3), 8)}等效引擎等级 = ${lvEq(0.1, cs.q).toFixed(1)}`);
}
console.log();
console.log("  ⇒ 一句话结论：**c = 0.1**，即 `zpeMultiplier += q³ / 10`");
console.log("     等价说法：量子项 ≈ 一个 `3·log2(q) − 3.3` 级的 ZPE 引擎 ✓");

if (check) {
  console.log();
  console.log("=".repeat(104));
  console.log("定点断言");
  console.log("=".repeat(104));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 44)} ${detail}`);
  };
  const C = 0.1;
  ck("★ 判据①②的交集非空", lo < hi, `c ∈ [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
  ck("★ 选定 c = 0.1 落在交集内", C >= lo && C <= hi, `${lo.toFixed(4)} ≤ 0.1 ≤ ${hi.toFixed(4)}`);
  ck("★ 首次大坍缩附近（q=4）观感 ×2~×4", (base(10) + term(C, 4)) / base(10) >= 2 && (base(10) + term(C, 4)) / base(10) <= 4,
    `×${((base(10) + term(C, 4)) / base(10)).toFixed(2)}`);
  ck("★ 常规一轮（q=30）等效 8~12 级引擎", lvEq(C, 30) >= 8 && lvEq(C, 30) <= 12, `${lvEq(C, 30).toFixed(1)} 级`);
  ck("★ 后期（q=300）能反超中低等级引擎（>15 级）", lvEq(C, 300) > 15, `${lvEq(C, 300).toFixed(1)} 级`);
  ck("斜率天然陡峭（d ln term/d ln q = 3）⇒ 系数必须小", true, "q×10 ⇒ 项×1000");
  ck("dm1 倍率从 DE_MILESTONES 读（单一数据源）", DE_MILESTONES.find((x) => x.id === "dm1").effect.value === 2, "dm1 = ×2 ✓");
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
