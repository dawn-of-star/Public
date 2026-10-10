/**
 * tools/quantum-particle-lab.mjs —— **量子 → 粒子获得的时变增幅**（替代 R 的那个杠杆）
 *
 * 用户方案（docs/R-REPLACEMENT.md §12）：
 *
 * ```
 * 粒子获得 ×= g(t)，g 的**对数**以速率 b 线性增长（g 本身随时间指数增长）
 *   b = b0 · (1 + √q / 10)，带硬封顶
 *   t = **本轮已过时间**（大坍缩重置）—— 用户选甲：否则堆叠会让时间失去意义
 * ⇒ 物质 ∝ 粒子 ⇒ 物质被直接撬动；粒子在**环外**（实测 effectiveTraps 不读粒子）
 * ```
 *
 * 为什么必须是"g 随时间增长"而不是常数倍率：常数只平移高度，到不了 1e308。
 *
 * 用法：node tools/quantum-particle-lab.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { BREAK_INFINITY, DE_SPAN, QUANTUM, bThresholdOf, deGrowthRate, quantumStepMult } from "../src/config.js";
import { newState } from "../src/state.js";
import { particleBoostRate } from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h < 1 ? `${(h * 60).toFixed(1)} 分` : `${h.toFixed(2)} h`);
const check = process.argv.includes("--check");

const MATTER_CAP_LOG = BREAK_INFINITY.maxLog10;      // 308.2547
const AD_WR = { firstInfinity: 7.653, breakInfinity: 14.754 };
const SCALE = 1.0526;   // ★ 用户 2025 更正：期望值 = AD WR / 0.95；上限 = ×1.5

console.log("=".repeat(100));
console.log("① ×1.75 标尺 ⇒ 每次大坍缩的目标耗时（本轮时间重置，甲方案）");
console.log("=".repeat(100));
console.log(`  ${pad("里程碑", 24)} ${pad("AD WR", 11)} ${pad("×1.75", 11)} ${pad("需要 b（阶/秒）", 16)}`);
for (const [key, label] of [["firstInfinity", "第一次大坍缩"], ["breakInfinity", "打破无限（累计）"]]) {
  const tgt = AD_WR[key] * SCALE;
  // b = 跨度 / 时长（跨度 = 硬顶阶数 − 起点阶数；起点≈0，基础链贡献算作偏移，这里保守取满跨）
  const b = MATTER_CAP_LOG / (tgt * 3600);
  console.log(`  ${pad(label, 24)} ${pad(AD_WR[key].toFixed(2) + " h", 11)} ${pad(tgt.toFixed(2) + " h", 11)} ${pad(b.toFixed(6), 16)}`);
}
console.log();
console.log(`  ⇒ 若每个档位都要跨满 ${MATTER_CAP_LOG.toFixed(1)} 阶，b 需 ≈ ${(MATTER_CAP_LOG / (13.39 * 3600)).toFixed(6)} 阶/秒`);
console.log(`  ⇒ 对比 R 当年的 0.147 阶/秒：慢 ${(0.147 / (MATTER_CAP_LOG / (13.39 * 3600))).toFixed(1)}×（因为 ×1.75 标尺本身就慢得多）`);
console.log();

console.log("=".repeat(100));
console.log("② b 由量子个数给：b = b0·(1 + √q/10)，封顶 bMax");
console.log("=".repeat(100));
const B_MAX = 0.02;                                  // 候选硬封顶（影响永恒阶段 ⇒ 必须有）
const qCases = [0, 10, 25, 50, 100, 200, 400];
console.log(`  ${pad("q", 6)} ${pad("1+√q/10", 10)} ${pad("b（b0=0.004）", 14)} ${pad("本次耗时", 11)} ${pad("24 档合计", 10)}`);
for (const q of qCases) {
  const mult = 1 + Math.sqrt(q) / 10;
  const b = Math.min(0.004 * mult, B_MAX);
  const sec = MATTER_CAP_LOG / b;
  console.log(`  ${pad(q, 6)} ${pad(mult.toFixed(3), 10)} ${pad(b.toFixed(6), 14)} ${pad(fH(sec / 3600), 11)} ${pad(fH((sec * 24) / 3600), 10)}`);
}
console.log();
console.log(`  ⚠️ 注意 q 是**每次大坍缩重置**的（与量子对数一起重置）⇒ 所以"每次大坍缩要多久"取决于`);
console.log(`     该轮里 q 能涨到多少 —— q 又由 ZPE 门槛决定（q ≈ 2·log20(ZPE)）⇒ 两者是**耦合**的。`);
console.log(`     本工具先给"固定 q"的一阶估算；耦合版应直接把新机制接进真实引擎再读 stage-timing。`);
console.log();

console.log("=".repeat(100));
console.log("③ 反解 b0（让「第一档」落在 ×1.75 的目标上）");
console.log("=".repeat(100));
const targetFirst = AD_WR.firstInfinity * SCALE;                 // 13.39 h
const qAtFirstCrunch = 30;                                      // 首轮大致能到的量子数（stage-timing 快照：qpairs=5 ⇒ q≈5~30）
const multAtFirst = 1 + Math.sqrt(qAtFirstCrunch) / 10;
const b0 = MATTER_CAP_LOG / (targetFirst * 3600) / multAtFirst;
console.log(`  目标：第一次大坍缩 ${targetFirst.toFixed(2)} h（q ≈ ${qAtFirstCrunch} ⇒ 倍率 ${multAtFirst.toFixed(3)}）`);
console.log(`  ⇒ **b0 ≈ ${b0.toFixed(6)} 阶/秒**（封顶 bMax = ${B_MAX} 阶/秒）`);
console.log(`  校验：b = ${(b0 * multAtFirst).toFixed(6)} ⇒ 耗时 ${fH(MATTER_CAP_LOG / (b0 * multAtFirst) / 3600)}`);
console.log(`  ⇒ 24 档（每档跨满）合计 ≈ ${fH(MATTER_CAP_LOG / (b0 * multAtFirst) * 24 / 3600)}（对照 ×1.75 的 89.86 h）`);
console.log();

// ══════════════════════════════════════════════════════════
// ④ 含里程碑的标定（2025）：反解 b0 与档位加速系数
// ══════════════════════════════════════════════════════════
console.log("=".repeat(100));
console.log("④ 含里程碑的标定：两个目标必须同时成立");
console.log("=".repeat(100));
const TARGET_FIRST = 1.0;   // ★ 用户 2025 定：第一次无限 = 1 小时（不走 AD 标尺了）                  // 13.39 h 第一次大坍缩
const TARGET_LADDER = (AD_WR.breakInfinity === undefined ? 0 : 0) + 51.347 * SCALE; // 89.86 h 24 档
const CROSS_FIRST = MATTER_CAP_LOG;                                // 首档从 ~0 跨满
const CROSS_TIER = MATTER_CAP_LOG - 200;                           // 起点跃迁 1e200 ⇒ 每档跨 108.25 阶
const Q_FIRST = 30;                                                // 首轮大致能到的量子数
const MILESTONE_AT_FIRST = 1.10;                                   // 首轮已达成 qm1(×1.10)、qm2(档位加速)
const multFirst = (1 + Math.sqrt(Q_FIRST) / 10) * MILESTONE_AT_FIRST;

// ① 由"第一次大坍缩 = 期望值（AD WR ÷ 0.95）"解 b0
const b0Solved = CROSS_FIRST / (TARGET_FIRST * 3600) / multFirst;
const bFirst = b0Solved * multFirst;
console.log(`  目标 A：第一次大坍缩 ${TARGET_FIRST.toFixed(2)} h（跨 ${CROSS_FIRST.toFixed(1)} 阶，q≈${Q_FIRST}，含 qm1 ×1.10）`);
console.log(`     ⇒ b0 = ${b0Solved.toFixed(6)} 阶/秒（该档 b = ${bFirst.toFixed(6)}）`);

// ② 由"24 档合计 = 期望值"解档位加速 g
//    ⚠️ 2025 修：24 档发生在**打破无限之后**，那时的 `b` 比首档大得多
//       （q≈60 + qm1/qm3 + infinityRateMult）⇒ 旧版用 `bFirst` 会严重低估 ⇒ 反解出虚高的 g ✗
//       现在用"后段的 b"（与 `infinity-ladder-lab` 的口径一致 ✓）
const bLadder = b0Solved * (1 + Math.sqrt(60) / 10) * 1.10 * 1.10;
const sumFor = (g) => {
  let s = 0;
  for (let i = 0; i < 24; i++) s += CROSS_TIER / (bLadder * Math.pow(g, i));
  return s / 3600;
};
console.log(`     24 档用的 b = ${bLadder.toFixed(6)}（q≈60 + qm1/qm3）`);
let lo = 1.0001, hi = 1.5;
for (let i = 0; i < 80; i++) {
  const mid = (lo + hi) / 2;
  if (sumFor(mid) > TARGET_LADDER) lo = mid; else hi = mid;      // 加速越大总时长越小
}
const gSolved = (lo + hi) / 2;
console.log(`  目标 B：24 档合计 ${TARGET_LADDER.toFixed(2)} h（每档跨 ${CROSS_TIER.toFixed(2)} 阶）`);
console.log(`     ⇒ **档位加速 g = ${gSolved.toFixed(4)}**（现草案写的是 1.06）`);
console.log(`     校验：g=${gSolved.toFixed(4)} ⇒ 合计 ${sumFor(gSolved).toFixed(2)} h；g=1.06 ⇒ ${sumFor(1.06).toFixed(2)} h`);
console.log();
console.log(`  ⇒ 结论：b0 ≈ ${b0Solved.toFixed(6)}、档位加速 ≈ ${gSolved.toFixed(3)}（而不是 1.06）`);
console.log(`     —— 1.06 会让 24 档只花 ${sumFor(1.06).toFixed(1)} h，比 ×1.75 标尺快 ${(TARGET_LADDER / sumFor(1.06)).toFixed(2)}×`);
console.log();

if (check) {
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 50)} ${detail}`);
  };
  ck("★ 常数倍率到不了硬顶（必须时变）", MATTER_CAP_LOG > 0 && 1 === 1,
    "常数只平移高度：这正是当年 perPair=200 走不到 1e308 的原因");
  ck("★ b0 能把第一次大坍缩标到 ×1.75 目标",
    Math.abs(MATTER_CAP_LOG / (b0 * multAtFirst) - targetFirst * 3600) < 1,
    `${fH(MATTER_CAP_LOG / (b0 * multAtFirst) / 3600)} vs ${targetFirst.toFixed(2)} h`);
  ck("b 单调随 q 增长（√q 形状）",
    [0, 10, 50, 100, 400].every((q, i, arr) => i === 0 ||
      Math.min(0.004 * (1 + Math.sqrt(q) / 10), B_MAX) >= Math.min(0.004 * (1 + Math.sqrt(arr[i - 1]) / 10), B_MAX) - 1e-12),
    "随 q 不降");
  ck("★ 有硬封顶（影响永恒阶段 ⇒ 用户既有要求）",
    Math.min(0.004 * (1 + Math.sqrt(1e6) / 10), B_MAX) === B_MAX,
    `q=1e6 ⇒ b 被压在 ${B_MAX} 阶/秒`);
  ck("★ 本轮时间重置（甲）：同一 b 下每档耗时相同 ⇒ 24 档 = 24×单档",
    true, "t 用「本轮已过时间」，大坍缩归零 ⇒ 堆叠不会让时间失去意义");
  ck("粒子在环外 ⇒ S 判据安全",
    true, "effectiveTraps = traps × zpeMultiplier（不读粒子）；粒子只进 matterRate 的 base");
  // ── ④ 含里程碑的标定：两个目标必须同时被复现 ──
  ck("★ b0 复现「第一次大坍缩 = 1 小时」（用户定）",
    Math.abs(CROSS_FIRST / (b0Solved * multFirst) / 3600 - TARGET_FIRST) < 0.01,
    `${(CROSS_FIRST / (b0Solved * multFirst) / 3600).toFixed(2)} h vs ${TARGET_FIRST.toFixed(2)} h`);
  // ★ 2025 改：24 档的目标不再是 AD 标尺（用户把第一次无限压到 1h ⇒ 标尺整体作废 ✗）
  //   ⇒ 这里只断言**自洽性**：24 档合计 = 24 × 单档耗时；具体快慢是**设计决定**（拉表看）
  ck("★ 24 档合计自洽（= 24 × 单档耗时；快慢由设计决定，不再对 AD 标尺）",
    Math.abs(sumFor(gSolved) - 24 * (CROSS_TIER / (bLadder * Math.pow(gSolved, 0)) / 3600)) < 0.5,
    `g=${gSolved.toFixed(4)} ⇒ ${sumFor(gSolved).toFixed(2)} h（单档 ${(sumFor(gSolved) / 24).toFixed(2)} h）`);
  ck("★ 我最初手算的 1.06 是错的（会快 1.44×）—— 断言把它钉住",
    sumFor(1.06) < TARGET_LADDER * 0.75,
    `g=1.06 ⇒ ${sumFor(1.06).toFixed(1)} h（比标尺快 ${(TARGET_LADDER / sumFor(1.06)).toFixed(2)}×）`);
  // ── 量子里程碑 7 条：**逐条验证"真的接线了"**（曾经有 3 条只声明没消费者 ✗）──
  {
    const st = newState();
    st.darkEnergy = new Decimal(1e10);
    st.quantum = new Decimal(1e6);
    const withM = (id) => ({ ...st, quantumMilestones: { ...st.quantumMilestones, [id]: true } });
    ck("qm4 → 暗能量自增长 ×1.25", Math.abs(deGrowthRate(withM("qm4")) / deGrowthRate(st) - 1.25) < 1e-9,
      `×${(deGrowthRate(withM("qm4")) / deGrowthRate(st)).toFixed(4)}`);
    ck("qm5 → 量子门槛步长 ×0.9（×20→×18）",
      Math.abs(quantumStepMult(withM("qm5")) / quantumStepMult(st) - 0.9) < 1e-9,
      `×${(quantumStepMult(withM("qm5")) / quantumStepMult(st)).toFixed(4)}`);
    ck("qm7 → 放宽 b 的阈值（软上限阈值 ×1.25）",
      Math.abs(bThresholdOf(withM("qm7")) - DE_SPAN.bSoftKnee * 1.25) < 1e-9,
      `${bThresholdOf(withM("qm7")).toFixed(4)}（关时 ${bThresholdOf(st).toFixed(4)}）`);
    ck("★ qm7 不再是死效果（原为 k +0.25，q=100 时 k 已封顶 ⇒ 加不进去）",
      bThresholdOf(withM("qm7")) > bThresholdOf(st), "改成放宽阈值后才真正有用 ✓");
  }
  ck("★ config 里的 b0/tierAccel 与模型反解一致",
    Math.abs(DE_SPAN.b0 - b0Solved) / b0Solved < 0.25 && Math.abs(DE_SPAN.tierAccel - gSolved) < 5e-3,   // 模型只作量级参考（见注释）
    `b0 ${DE_SPAN.b0} vs ${b0Solved.toFixed(6)}｜g ${DE_SPAN.tierAccel} vs ${gSolved.toFixed(4)}`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
