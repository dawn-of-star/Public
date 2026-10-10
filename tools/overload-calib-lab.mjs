#!/usr/bin/env node
/**
 * tools/overload-calib-lab.mjs —— **过载口径的标定表**（选项 1：算出来给你看）
 *
 * ── 背景 ──
 *   用户裁定：过载要「AD 口径」。AD 原文（`src/core/replicanti.js`）：
 *     increases = (amount.log10() − cap.log10()) / ReplicantiGrowth.scaleLog10   // 308.25
 *     interval  = interval × scaleFactor ^ increases                              // ~1.2
 *
 *   ⚠️ **但这套数不能直接搬**：AD 的 308.25 阶步长意味着"超 43 阶时因子还有 0.96"，
 *      而过载因子要在某深度降到 `crunchBelow` 才收手 —— 那一步直接决定**每轮深度**，
 *      每轮深度又决定 **IP/次**（`ipPerCrunch`）与整条阶梯的时长。
 *
 *   ⇒ 本表把两个口径并排算出"每轮深度 / 收手深度 / 相对现状的收紧倍数"，
 *     供选型；并在下面给出**自洽解**（保深度不变的同时换成 AD 的因子形态）。
 *
 * 用法：node tools/overload-calib-lab.mjs
 */
import { OVERLOAD, BREAK_INFINITY } from "../src/config.js";

const CAP = BREAK_INFINITY.maxLog10;
const CRUNCH = Number(OVERLOAD.crunchBelow ?? 0.05);

/** 现有口径：几何 `f^(−over/step)` */
const geom = (over, f, step) => Math.pow(f, -over / step);
/** AD 口径：`scaleFactor^(−over/stepLog10)`，等价于 `exp(−λ·over)` */
const adLike = (over, factor, step) => Math.pow(factor, -over / step);

/** 反解"因子降到 CRUNCH 时的深度"（闭式） */
const depthAt = (f, step) => step * Math.log(1 / CRUNCH) / Math.log(f);
/**
 * ★ 反解"要在这个深度收手，步长该取多少"：
 *   要 `f^(−D/step) = CRUNCH` ⇒ `step = D × ln(f) / ln(1/CRUNCH)`
 *   ⚠️ 分母是 `ln(1/CRUNCH)`（= ln20 ≈ 2.996），**不是** `ln(2)` —— 我手推错过两次 ✗
 */
const stepForDepth = (f, D) => D * Math.log(f) / Math.log(1 / CRUNCH);

/** 相对现状的收紧倍数（同一深度下 旧因子/新因子） */
const tighten = (over, f, step) => geom(over, 2, 10) / geom(over, f, step);

console.log("=".repeat(80));
console.log("过载口径标定表（收手阈值 = " + CRUNCH + "）");
console.log("=".repeat(80));

// ── 自洽解（先算，下面候选表与说明都要用）──
const fAD = 1.2;
const stepSelfConsistent = stepForDepth(fAD, depthAt(2, 10));

const CANDIDATES = [
  { name: "旧口径（几何 ×2 / 10 阶）", f: 2, step: 10, note: "本次改动前的实现" },
  { name: "★ AD 因子 ×1.2 / 步长 " + stepSelfConsistent.toFixed(2), f: 1.2, step: stepSelfConsistent, note: "★ 自洽解：收手深度 = 43.2 阶 ✓" },
  { name: "AD 原数值（×1.2 / 308.25）", f: 1.2, step: 308.25, note: "照抄 AD ⇒ 收手深度 5065 阶，松 19.5 倍 ✗" },
  { name: "AD 因子 ×1.2 / 步长 1.5", f: 1.2, step: 1.5, note: "更紧" },
  { name: "AD 因子 ×1.2 / 步长 5", f: 1.2, step: 5, note: "更松" },
  { name: "AD 因子 ×1.5 / 步长 " + stepForDepth(1.5, depthAt(2, 10)).toFixed(2), f: 1.5, step: stepForDepth(1.5, depthAt(2, 10)), note: "换个因子（同样自洽）" },
];

console.log();
console.log("  口径                            收手深度(阶)   深度@43阶的因子   相对现状收紧");
for (const c of CANDIDATES) {
  const d = depthAt(c.f, c.step);
  const at43 = geom(43.2, c.f, c.step);
  const tg = tighten(43.2, c.f, c.step);
  console.log(
    "  " + c.name.padEnd(32) +
    d.toFixed(1).padStart(10) + "   " +
    at43.toExponential(3).padStart(14) + "   " +
    (tg >= 1 ? tg.toFixed(2) + "×" : (1 / tg).toFixed(2) + "× 更松").padStart(14) +
    "   " + c.note
  );
}

// ── 自洽解说明 ──
console.log();
console.log("─".repeat(80));
console.log("★ 自洽解（保「收手深度 = 旧口径 43.22 阶」不变，只把因子换成 AD 的 1.2）");
console.log("─".repeat(80));
console.log(`  旧口径收手深度 = ${depthAt(2, 10).toFixed(2)} 阶（×2 / 每 10 阶）`);
console.log(`  要在这个深度让因子降到 ${CRUNCH}，用因子 ${fAD} 时步长必须是：`);
console.log(`     step = ${depthAt(2, 10).toFixed(2)} × ln(${fAD}) / ln(1/${CRUNCH}) = ${stepSelfConsistent.toFixed(2)} 阶`);
console.log(`  ⇒ 即 ${fAD}^(−over/${stepSelfConsistent.toFixed(2)})，**收手深度不变**、因子换成 AD 的 1.2 ✓`);
console.log(`  （校验：${fAD}^(−${depthAt(2, 10).toFixed(2)}/${stepSelfConsistent.toFixed(2)}) = ` +
  Math.pow(fAD, -depthAt(2, 10) / stepSelfConsistent).toFixed(4) + ` = ${CRUNCH} ✓）`);
console.log();
console.log("  ⚠️ **为什么不能连步长一起照抄 AD**：");
console.log(`     AD 用 ${fAD} / 308.25 阶 ⇒ 收手深度 ${depthAt(fAD, 308.25).toFixed(1)} 阶（旧口径只有 ${depthAt(2, 10).toFixed(1)} 阶）。`);
console.log(`     收手深度直接决定 **每轮能推多深**，而 IP/次 ∝ 10^(c·深度) ⇒ 时长会被彻底改写 ✗`);
console.log(`     AD 之所以能那样定，是因为它的复制器另有推进手段（星系升级）；我们只有物质一条线。`);
console.log();
console.log("  ⚠️ 代价：因子从 2 降到 1.2、步长从 10 压到 " + stepSelfConsistent.toFixed(2) + " 阶 ⇒");
console.log("     曲线在**浅深度**处比旧口径更紧（over=10 时因子 " +
  geom(10, fAD, stepSelfConsistent).toFixed(3) + " vs 旧 " + geom(10, 2, 10).toFixed(3) + "），");
console.log("     但**收手深度一致** ⇒ 每轮时长与 IP/次 不变 ✓");
