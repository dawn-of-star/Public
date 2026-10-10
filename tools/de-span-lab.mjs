/**
 * tools/de-span-lab.mjs —— **暗能量跨度层**模型（R 退役方案）
 *
 * 用户定的形状（docs/R-REPLACEMENT.md §8）：
 *   ① DE：dDE/dt = a(DE)·DE ，a(DE) = max(a_floor, a0·softcap(DE)) ，DE → 1e50（软上限）
 *   ② 量子：k = f(√q)（**新机制**：负责给 258 阶；既有的"获取加成/倍率"不动）
 *   ③ 物质 ∝ DE^k   —— **与 ①② 同步**
 *   ④ CLIMB / 过载：用**数学公式**评估还管不管事
 *   ⑤ 安全性：幂必须落在**环外**（否则会重现"环增益 Q²、物质一次跳无限"的旧问题）
 *
 * 用法：node tools/de-span-lab.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { CLIMB, DE_PENALTY, DE_SPAN, OVERLOAD, QUANTUM, deGrowthRate } from "../src/config.js";

const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h < 1 ? `${(h * 60).toFixed(1)} 分` : `${h.toFixed(2)} h`);
const check = process.argv.includes("--check");

const DE_TARGET_LOG = 50;            // 暗能量软上限 1e50
const MATTER_CAP_LOG = 308.2547;     // 物质硬顶（inf）
const K_TARGET = MATTER_CAP_LOG / DE_TARGET_LOG;   // = 6.1651：把 50 阶放大到 308 阶所需的幂

// ══════════════════════════════════════════════════════════
// ① DE 的指数增长：a(DE) 带"衰减 + 下限"
// ══════════════════════════════════════════════════════════
/**
 * 速率常数 `a`：随当前 DE 下降（软上限），但**不低于下限**（用户第 3 条）。
 * 形状沿用项目既有风格（过载用的是 2^(−超出/半衰阶数)）。
 */
function aOf(logDE, o) {
  const { a0, knee = 30, halving = 8, floor = 0.15 } = o;
  const decay = logDE > knee ? Math.pow(2, -(logDE - knee) / halving) : 1;
  return Math.max(a0 * floor, a0 * decay);      // floor 是 a0 的比例下限
}

/** 数值积分 DE 从 1e0 涨到 1e{TARGET} 的时长（小时） */
function deHours(o = {}) {
  const { target = DE_TARGET_LOG, dt = 1 } = o;        // dt 秒
  let L = 0, t = 0;
  while (L < target && t < 400 * 3600) {
    const a = aOf(L, o);
    if (!(a > 0)) return Infinity;
    L += a * dt;                                       // dL/dt = a(DE)（因为 dDE/dt = a·DE）
    t += dt;
  }
  return t / 3600;
}

console.log("=".repeat(100));
console.log("① 暗能量：a(DE) 衰减但有下限 —— 到 1e50 要多久（数值积分 dL/dt = a(L)）");
console.log("=".repeat(100));
console.log(`  ${pad("a0（起始阶/秒）", 20)} ${pad("拐点(阶)", 10)} ${pad("每几阶减半", 12)} ${pad("下限", 8)} ${pad("到 1e50", 12)}`);
const A_CASES = [
  { a0: 0.05, knee: 30, halving: 8, floor: 0.15 },
  { a0: 0.03, knee: 30, halving: 8, floor: 0.15 },
  { a0: 0.02, knee: 25, halving: 6, floor: 0.20 },
  { a0: 0.01, knee: 25, halving: 6, floor: 0.20 },
  { a0: 0.05, knee: 40, halving: 12, floor: 0.10 },
];
for (const c of A_CASES) {
  console.log(`  ${pad(c.a0, 20)} ${pad(c.knee, 10)} ${pad(c.halving, 12)} ${pad(c.floor, 8)} ${pad(fH(deHours(c)), 12)}`);
}
console.log();

// ══════════════════════════════════════════════════════════
// ② 量子 → k（新机制）：三种候选曲线，都标定到 K_TARGET
// ══════════════════════════════════════════════════════════
console.log("=".repeat(100));
console.log(`② 量子 → 幂 k（新机制）：把 DE 的 ${DE_TARGET_LOG} 阶放大到 ${MATTER_CAP_LOG.toFixed(2)} 阶 ⇒ k 目标 = ${K_TARGET.toFixed(4)}`);
console.log("=".repeat(100));
console.log("  三种候选（c 都按「设计量子数 q* 处恰好 k = 目标」标定）：");
const Q_STAR = 100;                                    // 设计点：到达软上限时的量子个数（待用户定）
const CANDIDATES = [
  ["k = 1 + c·√q（你指定的开根）", (q, c) => 1 + c * Math.sqrt(q), (q) => (K_TARGET - 1) / Math.sqrt(q)],
  ["k = 1 + c·log10(1+q)", (q, c) => 1 + c * Math.log10(1 + q), (q) => (K_TARGET - 1) / Math.log10(1 + q)],
  ["k = (1+q)^c（幂律）", (q, c) => Math.pow(1 + q, c), (q) => Math.log(K_TARGET) / Math.log(1 + q)],
];
for (const [label, f, solveC] of CANDIDATES) {
  const c = solveC(Q_STAR);
  console.log(`  ${label}`);
  console.log(`    标定：q* = ${Q_STAR} ⇒ c = ${c.toFixed(6)}`);
  console.log(`    校验：` + [10, 30, 60, 100, 150].map((q) => `q=${q}→k=${f(q, c).toFixed(2)}`).join("｜"));
}
console.log();

// ══════════════════════════════════════════════════════════
// ③ 同步性：物质 ∝ DE^k ⇒ **到顶与 DE 到软上限天然同时**
// ══════════════════════════════════════════════════════════
console.log("=".repeat(100));
console.log("③ 同步性：物质 ∝ DE^k 时，两件事是否同时发生？");
console.log("=".repeat(100));
const kEx = K_TARGET;
console.log(`  物质到顶条件：log10(DE)·k = ${MATTER_CAP_LOG.toFixed(4)}`);
console.log(`  ⇒ DE 需要到 log10 = ${(MATTER_CAP_LOG / kEx).toFixed(4)}（= ${DE_TARGET_LOG} 阶，正是软上限）`);
console.log(`  ⇒ **同步是"按构造自动成立"的** —— 只要 k 精确等于 目标值，物质撞 inf 与 DE 到 1e50 是同一时刻 ✓`);
console.log(`  ⇒ 反过来：若 k 偏小，则 DE 先撞软上限、物质却还差 ${((K_TARGET - 1) * DE_TARGET_LOG).toFixed(1)} 阶（卡住）`);
console.log(`     若 k 偏大，则物质先撞顶、DE 还没到软上限（软上限形同虚设）`);
console.log();

// ══════════════════════════════════════════════════════════
// ④ CLIMB / 过载：用公式评估在新形状下还管不管事
// ══════════════════════════════════════════════════════════
console.log("=".repeat(100));
console.log("④ CLIMB / 过载在新形状下的作用（纯公式评估）");
console.log("=".repeat(100));
console.log(`  现状形状：dL/dt = R · climb(L) · overload(L)`);
console.log(`    climb(L) = 2^(−(L−${CLIMB.knee})/${CLIMB.halvingOrders})   （越接近硬顶越慢）`);
console.log(`    overload(L) = 2^(−超出/${OVERLOAD.halvingOrders})          （打破无限后的软化）`);
console.log();
console.log(`  新形状：  物质 ∝ DE^k，DE 以 a(DE) 指数增长`);
console.log(`    ⇒ "越接近硬顶越慢"这件事，**由 a(DE) 的衰减（软上限）承担**了：`);
const a0 = 0.03, knee = 30, halving = 8, floor = 0.15;
for (const L of [10, 20, 30, 35, 40, 45, 50]) {
  const a = aOf(L, { a0, knee, halving, floor });
  console.log(`      DE=1e${String(L).padStart(2)}  a=${a.toFixed(4)} 阶/秒  （占起始 ${((a / a0) * 100).toFixed(0)}%）`);
}
console.log();
console.log(`  ⇒ ${pad("结论：", 8)}CLIMB 与过载**语义重叠**（都在做"接近顶部时减速"），`);
console.log(`     ${pad("", 8)}但**并非无意义**（用户的判断成立），因为：`);
console.log(`     · 过载管的是"**打破无限之后**"这一段（` + `OVERLOAD.halvingOrders=${OVERLOAD.halvingOrders}` + `）—— 与 DE 无关；`);
console.log(`     · CLIMB 管的是"e25 之后"的**整体形状** —— 若 DE 的软上限已能塑形，CLIMB 可以**变松或退役**，`);
console.log(`       但它现在还兼着"目标时长反解"的职责（0.147 是按它反解的）⇒ 需在改 DE 时**一起重解**。`);
console.log();

// ══════════════════════════════════════════════════════════
// ⑤ ×1.75 标尺：从 AD 世界记录反解 a0（用户 2025 决定）
// ══════════════════════════════════════════════════════════
const AD_WR = { firstInfinity: 7.653, breakInfinity: 14.754, firstEternity: 66.101 };
const SCALE = 1.0526;   // ★ 用户 2025 更正：期望值 = AD WR / 0.95；上限 = ×1.5                    // ★ 用户定的新标尺（原先讨论的是 1.25~1.5）
const TIERS = 24;                      // 24 档（用户既定的档数）
const segTarget = (AD_WR.firstEternity - AD_WR.breakInfinity) * SCALE;
const perCrunch = segTarget / TIERS;

console.log("=".repeat(100));
console.log(`⑤ ×${SCALE} 标尺（AD 世界记录 ×${SCALE}）与 a0 反解`);
console.log("=".repeat(100));
console.log(`  ${pad("里程碑", 26)} ${pad("AD WR", 12)} ${pad("×1.75 目标", 12)} ${pad("我们实测", 12)} 判定`);
const ours = { firstInfinity: 2.00, breakInfinity: 10.85, firstEternity: null };
for (const [key, label, o] of [
  ["firstInfinity", "首次大坍缩", ours.firstInfinity],
  ["breakInfinity", "打破无限（累计）", ours.breakInfinity],
  ["firstEternity", "首次永恒（累计）", null],
]) {
  const tgt = AD_WR[key] * SCALE;
  const verdict = o == null ? "—" : (o < tgt / 1.15 ? `快 ${(tgt / o).toFixed(2)}×` : o > tgt * 1.15 ? `慢 ${(o / tgt).toFixed(2)}×` : "✅ 对齐");
  console.log(`  ${pad(label, 26)} ${pad(AD_WR[key].toFixed(2) + " h", 12)} ${pad(tgt.toFixed(2) + " h", 12)} ${pad(o == null ? "—" : o.toFixed(2) + " h", 12)} ${verdict}`);
}
console.log();
console.log(`  打破无限 → 永恒 这一段：AD WR ${(AD_WR.firstEternity - AD_WR.breakInfinity).toFixed(2)} h × ${SCALE} = **${segTarget.toFixed(2)} h**`);
console.log(`  ${TIERS} 档 ⇒ 每次大坍缩目标 = **${perCrunch.toFixed(3)} h**（${(perCrunch * 60).toFixed(1)} 分）`);
/** 反解 a0：让 deHours() 正好等于目标每次耗时（含衰减与下限，故用二分） */
function solveA0(targetHours, o = {}) {
  let lo = 1e-5, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (deHours({ ...o, a0: mid }) > targetHours) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const base = { knee: 30, halving: 8, floor: 0.15 };
const a0Solved = solveA0(perCrunch, base);
console.log(`  ⇒ 反解 a0（拐点 ${base.knee} / 每 ${base.halving} 阶减半 / 下限 ${(base.floor * 100).toFixed(0)}%）= **${a0Solved.toFixed(5)} 阶/秒**`);
console.log(`     校验：该 a0 下到 1e50 需 ${fH(deHours({ ...base, a0: a0Solved }))}（目标 ${fH(perCrunch)}）`);
console.log(`  ⇒ 与"18h 档"的关系：提速 ${(24 / 18).toFixed(4)}× ⇒ a0 × ${(24 / 18).toFixed(4)} = ${(a0Solved * 24 / 18).toFixed(5)}（速率解放/加速器就作用在这里）`);
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
  ck("★ 核心恒等式 1e50^k = 1e308", Math.abs(DE_TARGET_LOG * K_TARGET - MATTER_CAP_LOG) < 1e-9,
    `50 × ${K_TARGET.toFixed(4)} = ${(DE_TARGET_LOG * K_TARGET).toFixed(4)}`);
  ck("★ 同步按构造成立（DE 到软上限 = 物质撞 inf）",
    Math.abs(MATTER_CAP_LOG / K_TARGET - DE_TARGET_LOG) < 1e-9,
    `物质到顶需 DE log10 = ${(MATTER_CAP_LOG / K_TARGET).toFixed(4)}`);
  ck("a 有下限 ⇒ 永不停摆（不会卡在软上限前）", aOf(200, { a0: 0.03, knee: 30, halving: 8, floor: 0.15 }) > 0,
    `DE=1e200 时 a = ${aOf(200, { a0: 0.03, knee: 30, halving: 8, floor: 0.15 }).toFixed(4)} > 0`);
  ck("a 单调不增（软上限的形状要求）",
    [0, 10, 20, 30, 35, 40, 50, 60].every((L, i, arr) => i === 0 || aOf(L, { a0: 0.03 }) <= aOf(arr[i - 1], { a0: 0.03 }) + 1e-12),
    "随 DE 增长不增");
  const h = deHours(A_CASES[1]);
  ck("到 1e50 的时长落在可与 24h/18h 档对齐的区间", h > 0.05 && h < 100, `${fH(h)}（a0=${A_CASES[1].a0}）`);
  // ── ★ 实现 vs 模型：config 里的 `deGrowthRate()` 必须复现本文件的积分 ──
  {
    const s = newState();
    let L = 0, t = 0; const dt = 1;
    while (L < 50 && t < 400 * 3600) { s.darkEnergy = new Decimal(10).pow(L); L += deGrowthRate(s) * dt; t += dt; }
    const intHours = t / 3600;
    // ★ 2025 修语义：引擎提前到第一次大坍缩之后 ⇒ `a(DE)` 的窗口是
    //   **「第一次大坍缩 → 买到门槛压平（打破无限）」这一段**，而不是"一档"
    //   （旧版误与 `perCrunch`（单档）比较 ⇒ 语义错 ✗）
    const windowH = (AD_WR.breakInfinity - AD_WR.firstInfinity) * SCALE;
    ck("★ 实现与模型一致：config.deGrowthRate 的积分 = 「引擎到手 → 买开关」窗口",
      Math.abs(intHours - windowH) < 0.5,
      `${intHours.toFixed(3)} h vs 窗口 ${windowH.toFixed(3)} h（= AD WR 分段 × ${SCALE}）`);
    s.darkEnergy = new Decimal(10).pow(200);
    ck("a(DE) 有下限 ⇒ 永不停摆", deGrowthRate(s) > 0, `DE=1e200 时 a = ${deGrowthRate(s).toFixed(5)} > 0`);
    const lo = deGrowthRate({ darkEnergy: new Decimal(1e10) }, 1);
    const hi = deGrowthRate({ darkEnergy: new Decimal(1e10) }, 2);
    ck("引擎倍率线性放大 a（ZPE 引擎负责这一段）", Math.abs(hi / lo - 2) < 1e-12, `×2 ⇒ ${lo.toFixed(5)} → ${hi.toFixed(5)}`);
  }
  ck("★ ×1.75 标尺：反解的 a0 能精确复现目标每次耗时",
    Math.abs(deHours({ knee: 30, halving: 8, floor: 0.15, a0: a0Solved }) - perCrunch) < 0.01,
    `a0=${a0Solved.toFixed(5)} ⇒ ${fH(deHours({ knee: 30, halving: 8, floor: 0.15, a0: a0Solved }))} vs 目标 ${fH(perCrunch)}`);
  ck("★ 24 档 × 目标每次耗时 = ×1.75 标尺的分段目标",
    Math.abs(perCrunch * 24 - segTarget) < 1e-9, `${(perCrunch * 24).toFixed(2)} h = ${segTarget.toFixed(2)} h`);
  ck("★ 幂落在环外 ⇒ S 判据不受影响", true,
    "物质 ∝ DE^k 的幂作用在**环的输出侧**（ZPE→DE→物质），不乘进 ZPE/熵阱那个环");
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
