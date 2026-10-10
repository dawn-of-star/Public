/**
 * tools/calibrate-b0.mjs —— 方案甲：用**积分**反解 `b0`（而不是把 b 当常数）
 *
 * 为什么：`dL_M/dt = b(q(t))`，而 `q` 在**本轮内从 0 涨起来** ⇒
 *   用"q≈30 恒定"反解（旧做法）会让前期 b 偏大 ⇒ 积分时间远长于目标 ✗
 *
 * 做法：
 *   ① 真实引擎量出 `q(t)`（**与 b 无关**：q 只由 ZPE 门槛链决定 ✓）
 *   ② 数值积分 `∫₀^t b(q(τ)) dτ = 308.2547 − L_offset`，反解 `b0` 使 `t = 8.06h`
 *
 * 用法：node tools/calibrate-b0.mjs
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { advance, buyDeUpgrade, buyDreamUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade } from "../src/engine.js";
import { DE_SPAN, DE_UPGRADES, DREAM_UPGRADES, REPEATABLE, VOID_UPGRADES } from "../src/config.js";
import { particleBoostRate } from "../src/formulas.js";

const D = (v) => new Decimal(v ?? 0);
const CAP = 308.2547;
const TARGET = 1.0;                          // ★ 用户 2025：第一次无限缩到 **1 小时**
const L_OFFSET = 25;                         // 增幅主导之前，基础链已把物质推到 ~1e25

// ── ① q(t) 的口径：三种（因为"从引擎实时量 q(t)"会引入策略/字段依赖，不稳 ✗）──
//    q 只由 ZPE 门槛链决定（与 b 无关 ✓）：q = perPair × 跨过的门槛数，门槛 = 1e10×(20×stepMult)^n
//    实测锚点（stage-timing 快照）：q≈4~5 时 t≈6.8 分；本轮的 q 终值 ≈ 30；第一次大坍缩 ≈ 10.5h
const Q_END = 30;
const MODES = {
  "q ≡ 0（最悲观）": () => 0,
  "q(t) 线性斜坡（0 → 30）": (t) => Q_END * Math.min(1, t / (10.5 * 3600)),
  "q(t) 斜坡并在 6.8 分后加速（贴合实测）": (t) => Q_END * Math.min(1, Math.pow(t / (10.5 * 3600), 0.4)),
  "q ≡ 30（旧口径，最乐观）": () => Q_END,
};
let qMode = MODES["q(t) 线性斜坡（0 → 30）"];
console.log("=".repeat(96));
console.log("① q(t) 的三种口径（q 与 b 无关 ⇒ 只需选一个口径来标定）");
console.log("=".repeat(96));
for (const [name, f] of Object.entries(MODES)) {
  console.log(`  ${name.padEnd(34)} t=1h:q≈${Math.round(f(3600))}  t=4h:q≈${Math.round(f(4 * 3600))}  t=8h:q≈${Math.round(f(8 * 3600))}`);
}
/** q(t)：直接走当前选定的口径（qMode，见 ① 的四种） */
function qAt(t) {
  return qMode(t);
}

/** 给定 b0，积分到撞顶的时长（小时） */
function hoursFor(b0) {
  const save = DE_SPAN.b0;
  DE_SPAN.b0 = b0;
  const st = { quantum: D(0), quantumMilestones: {}, bigCrunchCount: D(0) };
  let L = L_OFFSET, t = 0;
  const dt = 1;
  while (L < CAP && t < 200 * 3600) {
    st.quantum = D(qAt(t));
    const b = particleBoostRate(st);
    L += b * dt;
    t += dt;
  }
  DE_SPAN.b0 = save;
  return t / 3600;
}

// ── ② 二分反解 b0 ──
let lo = 1e-4, hi = 0.2;
for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (hoursFor(m) > TARGET) lo = m; else hi = m; }
const b0 = (lo + hi) / 2;
console.log();
console.log("=".repeat(96));
console.log("② 积分反解 b0");
console.log("=".repeat(96));
console.log(`  目标：第一次大坍缩 = AD WR ${7.653}h ÷ 0.95 = **${TARGET.toFixed(2)} h**（上限 ${(7.653 * 1.5).toFixed(2)} h）`);
console.log(`  旧口径（q≈30 恒定）= ${(CAP / (TARGET * 3600) / ((1 + Math.sqrt(30) / 10) * 1.10)).toFixed(6)}（现用值 ${DE_SPAN.b0}）`);
console.log(`  **新口径（积分）    = ${b0.toFixed(6)}**（校验 ${hoursFor(b0).toFixed(3)} h）`);

// ── ②b 敏感性表：每种 q(t) 口径各自反解一个 b0 ──
console.log();
console.log("=".repeat(96));
console.log("②b 敏感性：q(t) 口径 → 反解出的 b0 → 与旧值的比值");
console.log("=".repeat(96));
console.log("  口径                                  b0        vs 旧值 0.006243   校验时长");
const solved = {};
for (const [name, f] of Object.entries(MODES)) {
  qMode = f;
  let l = 1e-4, h = 0.3;
  for (let i = 0; i < 60; i++) { const m = (l + h) / 2; if (hoursFor(m) > TARGET) l = m; else h = m; }
  const v = (l + h) / 2;
  solved[name] = v;
  console.log(`  ${name.padEnd(36)} ${v.toFixed(6)}   ×${(v / 0.006243).toFixed(2).padStart(5)}          ${hoursFor(v).toFixed(3)} h`);
}
qMode = MODES["q(t) 线性斜坡（0 → 30）"];
// ── ③ 拉表 ──
console.log();
console.log("=".repeat(96));
console.log("③ 拉表：新 b0 下的爬升（q 随本轮增长 ⇒ b 随之增长）");
console.log("=".repeat(96));
const save = DE_SPAN.b0;
DE_SPAN.b0 = b0;
const st = { quantum: D(0), quantumMilestones: {}, bigCrunchCount: D(0) };
let L = L_OFFSET, t = 0;
console.log("  时刻      本轮 q    b(阶/秒)   log10(物质)   本段时间");
let lastT = 0;
while (L < CAP && t < 200 * 3600) {
  st.quantum = D(qAt(t));
  const b = particleBoostRate(st);
  L += b;
  t++;
  if (t % 3600 === 0 || L >= CAP) {
    console.log(`  ${(t / 3600).toFixed(2).padStart(5)} h   ${String(Math.round(qAt(t))).padStart(5)}     ${b.toFixed(5)}      ${L.toFixed(1).padStart(7)}      ${((t - lastT) / 3600).toFixed(2)} h`);
    lastT = t;
  }
}
DE_SPAN.b0 = save;
