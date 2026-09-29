/**
 * tools/pace-model.mjs —— 节奏**数学模型**（不跑游戏，纯解析式）
 *
 * 为什么要有它：
 *   改一个常数就跑一次 14 小时无头仿真是浪费。这一层的形状是闭式的，
 *   解析式能直接给出「每 25 阶耗时 / 单次无限时长 / 攒到 128 点要多久」，
 *   而且常数全部**从 src/config.js 读**，不会和游戏脱节。
 *
 * ── 模型 ──
 *   1. 爬升：`dL/dt = R₀ · 2^(−(L−knee)/D)`（L ≤ knee 时因子为 1）
 *        ⇒ `t(L₁→L₂) = (D/(ln2·R₀)) · (2^((L₂−knee)/D) − 2^((L₁−knee)/D))`
 *        D → ∞ 退化成直线 `(L₂−L₁)/R₀`（= 0.5.0 现状）
 *   2. 过载（打破之后）：拐点 `B + log10(1.01)·量子`，之上再每 `halvingOrders` 阶减半
 *   3. 收益：未打破每次固定 `firstCrunchIP`；买下 ④ 后额外 `耗时 ÷ 60`；两者都乘 `①^等级`
 *   4. 轮次：`单次时长 = 首轮(基础环段，实测常数) 或 起点跃迁后的爬升 + ZPE 爬坡余量`
 *
 * 用法：
 *   node tools/pace-model.mjs            现状 vs 路线 1 的形状对照 + 到打破无限的时间
 *   node tools/pace-model.mjs --check    定点断言（与沙盒实测对齐，容差 8%）
 *   node tools/pace-model.mjs --sweep    参数矩阵（R₀ × D）
 */
import {
  BREAK_INFINITY, CLIMB, COLLAPSE, INFINITY_ORDER, INFINITY_UPGRADES, QUANTUM,
} from "../src/config.js";

const LN2 = Math.LN2;
const B = BREAK_INFINITY.maxLog10;                        // 308.2547…
const KNEE_DEFAULT = CLIMB.knee;                          // 25（从 COLLAPSE.unlockMatter 推出来）
const D_DEFAULT = CLIMB.halvingOrders;                    // 100
const R_BASE = QUANTUM.growthRateMax;                     // 现状 0.147（路线 1 已落地）

// ── ∞ 层升级的数值（单一数据源，不抄）──
const RATE_LADDER = INFINITY_ORDER
  .map((id) => ({ id, ...INFINITY_UPGRADES[id] }))
  .filter((c) => c.rateMult != null)
  .sort((a, b) => a.cost - b.cost);
const START_LADDER = INFINITY_ORDER
  .map((id) => ({ id, ...INFINITY_UPGRADES[id] }))
  .filter((c) => c.startLog10 != null)
  .sort((a, b) => a.cost - b.cost);
const RATE_ALL = RATE_LADDER.reduce((m, c) => m * c.rateMult, 1);
const IP_MULT = INFINITY_UPGRADES.ipDouble.effectMult;
const IP_COST_MULT = INFINITY_UPGRADES.ipDouble.costMult;
const SEC_PER_POINT = INFINITY_UPGRADES.ipTime.secondsPerPoint;

/** 爬升耗时（秒）：L₁ → L₂，斜率 R₀·2^(−(L−knee)/D) */
export function climbSeconds(L1, L2, { R0 = R_BASE, D = D_DEFAULT, knee = KNEE_DEFAULT } = {}) {
  let t = 0;
  let l = L1;
  if (l < knee) {                                  // knee 以下：常数斜率
    const upTo = Math.min(knee, L2);
    t += (upTo - l) / R0;
    l = upTo;
  }
  if (L2 > l) {
    if (!Number.isFinite(D)) {
      t += (L2 - l) / R0;                          // 直线（现状）
    } else {
      const k = D / (LN2 * R0);
      t += k * (Math.pow(2, (L2 - knee) / D) - Math.pow(2, (l - knee) / D));
    }
  }
  return t;
}

/** 每 25 阶的分段耗时（形状）；返回 [{to, segSec, cumSec}] */
export function segmentTable({ R0 = R_BASE, D = D_DEFAULT, knee = KNEE_DEFAULT, from = KNEE_DEFAULT, to = B, step = 25 } = {}) {
  const rows = [];
  let prev = from, cum = 0;
  for (let x = Math.ceil(from / step) * step; x <= to; x += step) {
    if (x <= from) continue;
    const seg = climbSeconds(prev, x, { R0, D, knee });
    cum += seg;
    rows.push({ to: x, segSec: seg, cumSec: cum });
    prev = x;
  }
  if (prev < to) {                                  // 收尾到 B
    const seg = climbSeconds(prev, to, { R0, D, knee });
    cum += seg;
    rows.push({ to, segSec: seg, cumSec: cum });
  }
  return rows;
}

/**
 * 一轮无限（从开局深度爬到上限）要多久。
 * @param opts.startLog 起点跃迁带来的开局深度（0 = 从零开始，走基础环段）
 * @param opts.firstRun 首轮是否走基础环段（0 → e25 那段由熵阱→ZPE 决定，模型用实测常数）
 * @param opts.ramp 每轮开头 ZPE/量子重新爬坡的余量（秒）
 *        ★ 标定值 300 秒：来源是沙盒实测与解析式的差 ——
 *          路线1 实测 105.1 min vs 解析 100.2；满配（起点 1e200）实测 42.0 vs 解析 36.8，
 *          两条差都是 ~5 分钟（大坍缩把 ZPE/熵阱清零，量子要从 0 重新捕）。
 */
export function singleInfinitySeconds({ R0 = R_BASE, D = D_DEFAULT, knee = KNEE_DEFAULT,
  startLog = 0, firstRun = false, firstRunSeconds = 6300, ramp = 300 } = {}) {
  if (firstRun && startLog === 0) return firstRunSeconds;      // 实测 104.3 分钟
  const from = Math.max(knee, startLog);
  return ramp + climbSeconds(from, B, { R0, D, knee });
}

/** 单次无限能拿多少无限点（未打破：固定 1 × ①；另有 ④ 的耗时部分，**受 capSeconds 限制**） */
export function ipPerCrunch(seconds, { ipLevel = 0, hasTime = true } = {}) {
  const mult = Math.pow(IP_MULT, ipLevel);
  const depth = BREAK_INFINITY.firstCrunchIP * mult;            // 未打破：固定收益
  const cap = INFINITY_UPGRADES.ipTime.capSeconds;
  const counted = cap == null ? seconds : Math.min(seconds, cap);
  const time = hasTime ? (counted / SEC_PER_POINT) * mult : 0;
  return depth + time;
}

/** ① 的第 n 级价格（首价 1、每级 ×10） */
export const ipLevelCost = (n) => INFINITY_UPGRADES.ipDouble.firstCost * Math.pow(IP_COST_MULT, n);

/**
 * 到「打破无限」要多久（周期模型，解析迭代，不跑游戏）。
 * 采购策略与 tools/infinity-sim.mjs 一致：先攒 ②③④（1/1/3 点），再按价格买 ①，够 128 就打破。
 *
 * ⚠️ 口径：`startLog` / `R0` 是**直接给**的，不代表玩家已经买得起起点跃迁/速率解放。
 *    所以这个函数算的是「这些升级到手之后能多快」，是**下界时间**（乐观）；
 *    真实进度受 IP 收入限制（实测：起点/速率要到 8.5~11.5 小时才买得起，见 infinity-sim）。
 */
export function timeToBreak({ R0 = R_BASE, D = D_DEFAULT, knee = KNEE_DEFAULT, startLog = 0,
  ramp = 300, firstRunSeconds = 6300, maxCycles = 200 } = {}) {
  let ip = 0, ipLevel = 0, elapsed = 0, cycles = 0, hasTime = false;
  const bought = { ipToZpe: false, ipToTransmuter: false, ipTime: false };
  while (cycles < maxCycles && ip < BREAK_INFINITY.unlockCost) {
    cycles++;
    const dur = singleInfinitySeconds({ R0, D, knee, startLog, firstRun: cycles === 1, firstRunSeconds, ramp });
    elapsed += dur;
    ip += ipPerCrunch(dur, { ipLevel, hasTime });
    for (const id of ["ipToZpe", "ipToTransmuter", "ipTime"]) {
      if (bought[id]) continue;
      const cost = INFINITY_UPGRADES[id].cost ?? 0;
      if (ip >= cost) { ip -= cost; bought[id] = true; if (id === "ipTime") hasTime = true; }
    }
    while (ip >= ipLevelCost(ipLevel)) { ip -= ipLevelCost(ipLevel); ipLevel++; }
  }
  return { hours: elapsed / 3600, cycles, ip, ipLevel, bought, perCycleMin: (elapsed / cycles) / 60 };
}

// ══════════════════════════════════════════════════════════
const fmtMin = (s) => `${(s / 60).toFixed(1)} min`;
const pad = (v, n) => String(v).padEnd(n);

if (process.argv.includes("--check")) {
  console.log("=".repeat(86));
  console.log("节奏模型定点断言（与 _sim 沙盒实测对齐，容差 8%）");
  console.log("=".repeat(86));
  let fails = 0;
  const check = (label, got, want, tol = 0.08) => {
    const rel = Math.abs(got - want) / want;
    const ok = rel <= tol;
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 42)} ${got.toFixed(4)}  期望 ${want.toFixed(4)}（差 ${(rel * 100).toFixed(1)}%）`);
  };
  // 现状：直线 283.25 阶 @0.0488（沙盒实测 97.6 分钟）
  check("现状 e25→e308.2547（分钟）", climbSeconds(KNEE_DEFAULT, B, { R0: 0.0488, D: Infinity }) / 60, 97.6);
  // 路线 1：knee=25, D=100, R₀=0.147（沙盒实测 105.1 分钟）
  check("路线1 e25→e308.2547（分钟）", climbSeconds(KNEE_DEFAULT, B, { R0: 0.147, D: 100, knee: 25 }) / 60, 105.1);
  // 路线 1 + 起点 IV + 速率 IV（沙盒 S2 实测 42.0 分钟，含标定后的 5 分钟爬坡余量）
  check("路线1+起点IV+速率IV（分钟）",
    singleInfinitySeconds({ R0: 0.147 * RATE_ALL, D: 100, knee: 25, startLog: 200 }) / 60, 42.0);
  check("起点跃迁 IV 的开局深度", START_LADDER.at(-1).startLog10, 200, 1e-9);
  check("速率解放四项合计", RATE_ALL, 1.10 * 1.10 * 1.15 * 1.20, 1e-9);
  check("④ 秒/点", SEC_PER_POINT, 60, 1e-9);
  // ★ 路线 1 的三个常数必须与 config 一致（改了机制没同步模型 = 时间算错）
  check("CLIMB.knee（应 = log10(1e25)）", KNEE_DEFAULT, 25, 1e-9);
  check("CLIMB.halvingOrders", D_DEFAULT, 100, 1e-9);
  check("QUANTUM.growthRateMax", R_BASE, 0.147, 1e-9);
  // ★ ④ 的上限必须进模型（踩过：模型没吃 cap，预测 8.8h vs 实测 10.4h）
  check("④ 单次上限（秒）", INFINITY_UPGRADES.ipTime.capSeconds, 1800, 1e-9);
  {
    const capped = ipPerCrunch(104 * 60, { ipLevel: 0, hasTime: true });
    check("④ 104 分钟的无限只给 31 点（30 上限 + 1 深度）", capped, 31, 1e-9);
  }
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

// ══════════════════════════════════════════════════════════
console.log("=".repeat(96));
console.log("① 形状对照：现状（直线）vs 路线 1（knee=25, D=100, R₀=0.147）");
console.log("=".repeat(96));
{
  const a = segmentTable({ R0: 0.0488, D: Infinity });
  const b = segmentTable({ R0: 0.147, D: 100, knee: 25 });
  console.log(`  ${pad("到 1e", 9)} ${pad("现状本段", 11)} ${pad("现状累计", 11)} ${pad("路线1本段", 11)} ${pad("路线1累计", 12)}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    console.log(`  ${pad(a[i].to, 9)} ${pad(fmtMin(a[i].segSec), 11)} ${pad(fmtMin(a[i].cumSec), 11)} ` +
      `${pad(fmtMin(b[i].segSec), 11)} ${pad(fmtMin(b[i].cumSec), 12)}`);
  }
  console.log(`  ⇒ 合计：现状 ${fmtMin(a.at(-1).cumSec)} ／ 路线1 ${fmtMin(b.at(-1).cumSec)}`);
}

console.log();
console.log("=".repeat(96));
console.log("② 起点跃迁 / 速率解放 对「单次无限」的影响（路线 1 参数，含 5 分钟爬坡余量）");
console.log("=".repeat(96));
{
  const base = { R0: 0.147, D: 100, knee: 25 };
  const noStart = singleInfinitySeconds({ ...base, startLog: 0 });
  console.log("  起点跃迁（速率未买）：");
  for (const s of [0, ...START_LADDER.map((c) => c.startLog10)]) {
    const t = singleInfinitySeconds({ ...base, startLog: s, firstRun: s === 0 });
    const pct = s > 0 ? ` −${(100 - t / noStart * 100).toFixed(0)}%` : "";
    console.log(`     开局 ${pad(s > 0 ? `1e${s}` : "0（首轮走基础环）", 18)} → ${pad(fmtMin(t), 11)}${pct}`);
  }
  console.log();
  console.log("  速率解放（起点取 1e200）：");
  let mult = 1;
  for (const c of [{ name: "（未买）", rateMult: 1 }, ...RATE_LADDER]) {
    mult *= c.rateMult;
    const t = singleInfinitySeconds({ ...base, R0: 0.147 * mult, startLog: 200 });
    console.log(`     ${pad(c.name, 16)} 上限 ×${pad(mult.toFixed(4), 9)} → ${pad(fmtMin(t), 11)}${t <= 1800 ? " ✅ 已进 30 分钟" : ""}`);
  }
  console.log();
  console.log(`  ⇒ 满配（起点 1e200 + 速率 I~IV）：${fmtMin(singleInfinitySeconds({ ...base, R0: 0.147 * RATE_ALL, startLog: 200 }))}`);
}

console.log();
console.log("=".repeat(96));
console.log("③ 到「打破无限」（128 点）的时间（周期模型）");
console.log("   ⚠️ 起点/速率是**直接给**的：这些数字 = 升级到手之后的速度（乐观下界）。");
console.log("      真实进度受 IP 收入限制 —— 实测起点/速率要到 8.5~11.5 小时才买得起（见 infinity-sim）。");
console.log("=".repeat(96));
{
  for (const [label, opts] of [
    ["现状（直线 R₀=0.0488）", { R0: 0.0488, D: Infinity }],
    ["路线 1", { R0: 0.147, D: 100, knee: 25 }],
    ["路线 1 + 起点 IV", { R0: 0.147, D: 100, knee: 25, startLog: 200 }],
    ["路线 1 + 起点 IV + 速率 IV", { R0: 0.147 * RATE_ALL, D: 100, knee: 25, startLog: 200 }],
  ]) {
    const r = timeToBreak(opts);
    console.log(`  ${pad(label, 30)} ${pad(r.hours.toFixed(1) + " 小时", 11)} ${pad(r.cycles + " 次无限", 11)} ` +
      `${pad("均 " + r.perCycleMin.toFixed(1) + " 分钟/次", 16)} 终局 ①Lv${r.ipLevel}`);
  }
}

if (process.argv.includes("--sweep")) {
  console.log();
  console.log("=".repeat(96));
  console.log("④ 参数矩阵：e25→e308.2547 用时（分钟）—— 行 = R₀，列 = D（knee=25）");
  console.log("=".repeat(96));
  const Ds = [50, 100, 200, Infinity];
  console.log(`  ${pad("R₀", 8)} ${Ds.map((d) => pad(Number.isFinite(d) ? "D=" + d : "直线", 13)).join("")}`);
  for (const R0 of [0.05, 0.1, 0.147, 0.2, 0.3, 0.5]) {
    const cells = Ds.map((D) => pad(fmtMin(climbSeconds(KNEE_DEFAULT, B, { R0, D })), 13));
    console.log(`  ${pad(R0, 8)} ${cells.join("")}`);
  }
  console.log();
  console.log("  读法：想让「e25→e308.25」≈100 分钟，沿它找格子（0.147 / D=100 就在其中）。");
}
