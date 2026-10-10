#!/usr/bin/env node
/**
 * tools/quantum-tier-lab.mjs —— **量子捕获门槛的累进标定表 + 断言**
 *
 * ── 为什么需要它 ──
 *   2025 用户裁定「过载」改成 **AD 复制器那套「每超一档 ⇒ 该档难度 ×固定因子」**的累进语义
 *   （见 `config.js` 的 `quantumZpeRequirement()` 注释）。
 *   AD 原文（`src/core/replicanti.js`）：
 *     increases = (amount.log10() − cap.log10()) / ReplicantiGrowth.scaleLog10
 *     interval  = interval × scaleFactor ^ increases
 *
 *   落地旋钮是 `QUANTUM.captureTierFactor`，形式：
 *       门槛(pairs) = base × step^pairs × captureTierFactor^(pairs²/2)
 *
 *   ⚠️ 它是**指数上的平方** ⇒ 手感极敏感：`1.001` 在 pairs=100 就已贡献 ~148 倍。
 *     所以必须有一张表能一眼看出"某取值在 pairs=50/120/200 把门槛推到多少"。
 *
 * ── 断言（进 `npm test` 批跑）──
 *   ① `captureTierFactor = 1` ⇒ **完全退化为纯几何**（零回归，硬要求）
 *   ② `> 1` ⇒ 门槛**逐对严格递增**，且**每对增幅单调不减**
 *      （"越靠后越难"必须真的成立 —— 不能出现某一档反而变便宜）
 *   ③ 门槛永远是**有限正数**（Infinity / NaN = 大数下溢的老坑）
 *   ④ 实现 == 注释里的理论式（防"注释写的和代码做的不一样"）
 */
import Decimal from "../dist/break_eternity.esm.js";
import { QUANTUM, quantumZpeRequirement } from "../src/config.js";

const base = Number(QUANTUM.zpeBaseCost ?? 1e10);
const step = Number(QUANTUM.zpeCostGrowth ?? 10) * Number(QUANTUM.zpeCostExtraNerf ?? 1);
const F = Number(QUANTUM.captureTierFactor ?? 1);

/** 纯几何参照（= 加累进之前的实现） */
const pure = (p) => new Decimal(base).mul(Decimal.pow(step, p));
/** 注释里的理论式（实现必须与它一致） */
const theory = (p) => {
  const b = new Decimal(base).mul(Decimal.pow(step, p));
  return F > 1 ? b.mul(Decimal.pow(F, new Decimal(p).mul(p).div(2))) : b;
};

let fail = 0;
const line = (ok, label, detail) => {
  console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(28)} ${detail}`);
  if (!ok) fail++;
};

console.log("=".repeat(76));
console.log("量子捕获门槛：累进标定表（过载「阈值本身被抬高」）");
console.log("=".repeat(76));
console.log(`  zpeBaseCost=${base.toExponential(0)}｜步长=${step}｜captureTierFactor=${F}`);
console.log();

// ── ① F=1 ⇒ 纯几何（零回归）──
if (F === 1) {
  const ps = [0, 1, 10, 50, 120, 200];
  const bad = ps.filter((p) => !quantumZpeRequirement(p).eq(pure(p)));
  line(bad.length === 0, "① F=1 ⇒ 退化为纯几何",
    bad.length ? `不一致于 pairs=${bad.join(", ")}` : `${ps.length} 个采样点与旧实现逐位相等`);
} else {
  console.log(`  ⏭ ① F=1 ⇒ 退化为纯几何        跳过（当前 F=${F}）`);
}

// ── ② 逐对递增 + 增幅不减 ──
{
  const N = 220;
  let prev = quantumZpeRequirement(0);
  let prevRatio = null, mono = true, nonDec = true, why = "";
  for (let p = 1; p <= N; p++) {
    const cur = quantumZpeRequirement(p);
    if (cur.lte(prev)) { mono = false; why ||= `pairs=${p} 未递增`; }
    const ratio = cur.div(prev).toNumber();
    if (prevRatio != null && ratio < prevRatio - 1e-9) { nonDec = false; why ||= `pairs=${p} 增幅反而变小`; }
    prevRatio = ratio; prev = cur;
  }
  line(mono && nonDec, "② 逐对递增 + 增幅不减",
    (mono && nonDec) ? `0..${N} 全程成立（越靠后越难 ✓）` : why);
}

// ── ③ 永远有限正数 ──
{
  const ps = [0, 1, 50, 120, 200, 500, 2000];
  const bad = ps.filter((p) => !Number.isFinite(quantumZpeRequirement(p).log10().toNumber()));
  line(bad.length === 0, "③ 始终有限正数",
    bad.length ? `非有限：pairs=${bad.join(", ")}` : "采样到 pairs=2000 都有限");
}

// ── ④ 实现 == 理论式 ──
{
  const ps = [0, 1, 10, 50, 120, 200, 500];
  const bad = ps.filter((p) => !quantumZpeRequirement(p).eq(theory(p)));
  line(bad.length === 0, "④ 实现 == 注释里的理论式",
    bad.length ? `不一致于 pairs=${bad.join(", ")}` : `${ps.length} 个采样点逐位相等`);
}

// ── 标定表 ──
console.log();
console.log("   pairs   门槛(log10)   相对上一对(x)   相对纯几何(x)");
for (const p of [0, 1, 5, 10, 25, 50, 75, 100, 120, 150, 200, 300]) {
  const cur = quantumZpeRequirement(p);
  const prev = p > 0 ? quantumZpeRequirement(p - 1) : null;
  console.log(
    String(p).padStart(7) + "   " +
    cur.log10().toNumber().toFixed(2).padStart(11) + "   " +
    (prev ? cur.div(prev).toNumber().toFixed(3) : "—").padStart(13) + "   " +
    cur.div(pure(p)).toNumber().toExponential(2).padStart(13)
  );
}

console.log();
console.log("=".repeat(76));
if (fail) {
  console.log(`  ❌ ${fail} 条断言失败`);
  console.log("=".repeat(76));
  process.exit(1);
}
console.log("  ✅ 全部通过（F=1 零回归 ✓｜越靠后越难 ✓｜有限 ✓｜与理论式一致 ✓）");
console.log("=".repeat(76));
