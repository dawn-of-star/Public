#!/usr/bin/env node
/**
 * tools/de-milestone-model.mjs —— dm4b「全局倍率作用于相变速率」的数学模型
 *
 * ── 要回答的问题 ──
 * 暗能量在自反馈下会不会失控？还是仅仅「涨得快一点」？
 *
 * ── 模型 ──
 * 相变速率：  dDE/dt = C × globalMult(DE) / (1 + 0.001·DE^0.5)
 *                        ↑ dm4b 加的        ↑ 原有的 DE 惩罚
 *
 * 其中 globalMult 里与 DE 相关的部分只有暗能量倍率：
 *     deMult(DE) = 1 + 0.25 × log2(DE)
 * （DM / 梦想点 / 量子 都是外生常数，归一化到 C 里）
 *
 * 于是两种情形：
 *   未触发： dDE/dt = C / (1 + 0.001·DE^0.5)              <- 单调递减（「涨不动」）
 *   已触发： dDE/dt = C × deMult(DE) / (1 + 0.001·DE^0.5)
 *
 * ── 判据 ──
 *   · 会失控吗？看 dDE/dt 是否随 DE 单调上升 -> 若是则正反馈无界
 *   · 有多快？比较达到同一 DE 所需的时间
 */

import Decimal from "../dist/break_eternity.esm.js";
import { DE_PENALTY } from "../src/config.js";

const D = (v) => new Decimal(v);
const pad = (s, n) => String(s).padEnd(n);
const hr = (t) => "─".repeat(t);
const dur = (s) => (s < 1 ? `${(s * 1000).toFixed(0)}ms` : s < 60 ? `${s.toFixed(1)}s`
  : s < 3600 ? `${(s / 60).toFixed(1)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`);

/** 暗能量倍率（只保留与 DE 有关的部分） */
const deMult = (de) => (de <= 1 ? 1 : 1 + 0.25 * (Math.log(de) / Math.log(2)));
/** DE 惩罚乘数 */
const penalty = (de) => 1 / (1 + DE_PENALTY.coeff * Math.pow(de, DE_PENALTY.exponent));

/** 相变速率（归一化 C=1） */
const rate = (de, withMilestone) =>
  (withMilestone ? deMult(de) : 1) * penalty(de);

console.log(hr(80));
console.log("dm4b 数学模型：全局倍率作用于相变转换速率");
console.log(hr(80));
console.log();
console.log(`  速率(DE) = ${DE_PENALTY.coeff===0.001?"":"C × "}${"deMult(DE)^k"} × penalty(DE)`);
console.log(`  penalty(DE) = 1/(1 + ${DE_PENALTY.coeff} × DE^${DE_PENALTY.exponent})`);
console.log(`  deMult(DE)  = 1 + 0.25 × log2(DE)`);
console.log();

// ══════════════════════════════════════════════════════════
console.log(hr(80));
console.log("[1] 速率随暗能量的变化 —— 会不会失控？");
console.log(hr(80));
console.log();
console.log(`    ${pad("暗能量", 12)} ${pad("未触发速率", 16)} ${pad("已触发速率", 16)} ${pad("已触发/未触发", 14)} 趋势`);
console.log("    " + hr(72));

let prev = null;
let monotonicUp = true;
for (const e of [0, 2, 4, 6, 8, 10, 12, 16, 20, 30]) {
  const de = e === 0 ? 0 : Math.pow(10, e);
  const r0 = rate(de, false), r1 = rate(de, true);
  const trend = prev === null ? "" : (r1 > prev ? "↑" : "↓");
  if (prev !== null && r1 <= prev) monotonicUp = false;
  prev = r1;
  console.log(
    `    ${pad("1e" + e, 12)} ${pad(r0.toExponential(3), 16)} ${pad(r1.toExponential(3), 16)} ` +
    `${pad((r1 / r0).toExponential(3), 14)} ${trend}`,
  );
}
console.log();
console.log(`    已触发时速率是否单调上升？ ${monotonicUp ? "是 -> 正反馈无界 ⚠️" : "否 -> 会上涨但有转折，收敛 ✅"}`);
console.log();

// 找转折点
function peakDE() {
  let lo = 0, hi = 1e40;
  for (let i = 0; i < 300; i++) {
    const mid = Math.sqrt(lo * hi) || 1;
    const eps = mid * 1.0001;
    if (rate(eps, true) > rate(mid, true)) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
const pk = peakDE();
console.log(`    速率峰值出现在 DE ≈ 1e${Math.log10(pk).toFixed(2)}`);
console.log(`    （峰值之后速率下降，说明 log(DE) 最终输给 DE^${DE_PENALTY.exponent}）`);
console.log();

// ══════════════════════════════════════════════════════════
console.log(hr(80));
console.log("[2] 积分：达到同一暗能量要多久");
console.log(hr(80));
console.log();

/** 数值积分 dDE/dt = rate(DE)，返回达到 target 的时间 */
function timeTo(target, withMilestone, tMax = 1e12) {
  let de = 1, t = 0;
  const steps = 20000;
  // 对数步长推进：每步 DE ×k，用 dDE/dt 换算 dt
  const k = Math.pow(target, 1 / steps);
  for (let i = 0; i < steps; i++) {
    const next = de * k;
    const dDE = next - de;
    const r = rate(de, withMilestone);
    if (r <= 0) return Infinity;
    t += dDE / r;
    de = next;
    if (t > tMax) return Infinity;
  }
  return t;
}

console.log(`    ${pad("目标暗能量", 14)} ${pad("未触发", 14)} ${pad("已触发", 14)} 提速`);
console.log("    " + hr(58));
for (const e of [4, 6, 8, 10, 12, 15, 20, 30]) {
  const target = Math.pow(10, e);
  const t0 = timeTo(target, false), t1 = timeTo(target, true);
  console.log(
    `    ${pad("1e" + e, 14)} ${pad(dur(t0), 14)} ${pad(dur(t1), 14)} ${t1 > 0 ? (t0 / t1).toFixed(2) + "x" : "—"}`,
  );
}
console.log();

// ══════════════════════════════════════════════════════════
console.log(hr(80));
console.log("结论");
console.log(hr(80));
console.log();
console.log(`  · dm4b 把相变速率乘上 globalMult，而 globalMult 里与 DE 相关的只有 deMult ∝ log(DE)`);
console.log(`  · 于是 dDE/dt ∝ log(DE)/DE^${DE_PENALTY.exponent} —— 在 DE ≈ 1e${Math.log10(pk).toFixed(1)} 处达到峰值后回落`);
console.log(`  · **不是无界正反馈**：对数项最终输给 DE^${DE_PENALTY.exponent}`);
console.log(`  · 它做的是「把暗能量的天花板抬高 + 前期明显加速」，不是让它跑到无限`);
console.log();
