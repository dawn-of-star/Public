/**
 * tools/crunch-speed-lab.mjs —— **「一次大坍缩要爬多久」以及各机制能省多少小时**
 *
 * ── 用户的问题 ──
 *   「各种机制与纯数值提升，对 ZPE 引擎效率的提升有多少（= 把 24 小时档缩短到 18 小时之类）」
 *
 * ── 模型（闭式，全部来自 config 的真实形状）──
 *   爬升速度（阶/秒）：`dL/dt = R · climb(L) · overload(L)`
 *     · `R`        = `quantumGrowthRate(量子, 速率解放)`，上限 `QUANTUM.growthRateMax`
 *     · `climb(L)`  = `2^(−(L − CLIMB.knee)/CLIMB.halvingOrders)`（超过拐点后每 100 阶减半）
 *     · `overload(L)` = `2^(−(L − 过载拐点)/OVERLOAD.halvingOrders)`（每 10 阶减半）
 *
 *   于是**一次大坍缩的耗时**就是一维积分：
 *     `t = ∫ dL / (R · climb · overload)`   ← 本工具用数值积分（形状本身是分段 2 的幂，
 *                                              数值积分比手推分段闭式更不容易写错）
 *
 *   校验：`R = 0.147、起点 25 阶、目标 308.25 阶` 应当得到 **≈100 分钟**
 *   （与 `tools/pace-model.mjs` 里那个已确认的数字一致 —— 这条是 `--check` 的第一断言）。
 *
 * ── 为什么"缩短总时长"只有两条路 ──
 *   总时长 = **档数 × 每次大坍缩耗时**
 *     · 降"每次耗时"：起点跃迁 / 速率解放 / 量子数量 / 坍缩加速器 / 自动化
 *     · 降"档数"  ：每档所需铸币上限减少（把 24 档压成 18 档）
 *
 * 用法：
 *   node tools/crunch-speed-lab.mjs           机制对照表（省了多少小时）
 *   node tools/crunch-speed-lab.mjs --check   定点断言
 */
import Decimal from "../dist/break_eternity.esm.js";
import { BREAK_INFINITY, CLIMB, COLLAPSE, OVERLOAD, QUANTUM } from "../src/config.js";

const TARGET = BREAK_INFINITY.maxLog10;        // 308.2547
const KNEE = CLIMB.knee;                       // 25（量子层解锁点）
const quantumDelay = (q) => q * OVERLOAD.quantumDelayPerQuantum;

/**
 * 一次大坍缩的爬升耗时（秒）。
 * @param {object} o
 * @param {number} o.startLog10 本轮起点（阶）—— 受「起点跃迁」影响
 * @param {number} o.endLog10   本轮目标（阶）—— 默认推到物质上限
 * @param {number} o.R          成长速率（阶/秒）
 * @param {number} o.quantum    量子数（决定过载拐点）
 * @param {number} o.climbHalving  每多少阶爬升速率减半（机制可以放宽它）
 * @param {number} o.overHalving   过载后每多少阶减半（机制可以放宽它）
 * @param {number} o.step       数值积分步长（阶）
 */
export function climbSeconds(o) {
  const {
    startLog10 = KNEE, endLog10 = TARGET, R = QUANTUM.growthRateMax,
    quantum = 0, climbHalving = CLIMB.halvingOrders, overHalving = OVERLOAD.halvingOrders,
    step = 0.01,
  } = o;
  if (!(R > 0)) return Infinity;
  const overKnee = TARGET + quantumDelay(quantum);
  let t = 0;
  for (let L = startLog10; L < endLog10; L += step) {
    const climb = L > KNEE ? Math.pow(2, -(L - KNEE) / climbHalving) : 1;
    const over = L > overKnee ? Math.pow(2, -(L - overKnee) / overHalving) : 1;
    t += step / (R * climb * over);
  }
  return t;
}

/** 量子 → 成长速率（与 config.quantumGrowthRate 同式，这里直接内联避免状态依赖） */
export function rateOf(quantum, rateMult = 1) {
  const max = QUANTUM.growthRateMax * rateMult;
  return quantum <= 0 ? 0 : max * quantum / (quantum + QUANTUM.growthRateHalf);
}

/** 表格与断言共用的入口：把"机制"翻译成 `climbSeconds` 的参数（避免两处口径不一致） */
export function secFor(o = {}) {
  const R = o.quantum === undefined
    ? QUANTUM.growthRateMax * (o.rateMult ?? 1)
    : rateOf(o.quantum, o.rateMult ?? 1);
  return climbSeconds({
    startLog10: o.startLog10 ?? KNEE,
    endLog10: o.endLog10 ?? TARGET,
    R,
    quantum: o.quantum ?? 0,
    overHalving: o.overHalving ?? OVERLOAD.halvingOrders,
  });
}

const fMin = (s) => (Number.isFinite(s) ? `${(s / 60).toFixed(1)} 分` : "∞");
const fH = (h) => `${h.toFixed(1)} h`;
const pad = (s, n) => String(s).padEnd(n);

// ══════════════════════════════════════════════════════════
// 机制清单：每个机制改的是哪一项
// ══════════════════════════════════════════════════════════
const BASE_TIERS = 24;          // 用户定的 24 小时档 = 24 次大坍缩
const MECHS = [
  ["① 基准（无机制，R = 上限 0.147）", {}],
  ["② 起点跃迁 1e100", { startLog10: 100 }],
  ["③ 起点跃迁 1e200 ← 正好够 24h 档", { startLog10: 200 }],
  ["④ 起点跃迁 1e250", { startLog10: 250 }],
  ["⑤ 速率解放 ×1.35 ← 18h 档", { startLog10: 200, rateMult: 1.35 }],
  ["⑥ 速率解放 ×1.67（满）", { startLog10: 200, rateMult: 1.67 }],
  ["⑦ 量子只有 1 个（R 未饱和，惩罚）", { startLog10: 200, quantum: 1 }],
  ["⑧ 量子 100 个（≈ 饱和）", { startLog10: 200, quantum: 100 }],
  ["⑨ 过载解放：每 10 → 14 阶减半", { startLog10: 200, overHalving: 14 }],
  ["⑩ 多推 3 阶上限之后（换 IP，不是省时间）", { startLog10: 200, endLog10: TARGET + 3 }],
  ["★ 起点 250 + 速率 ×1.67 + 量子 100", { startLog10: 250, rateMult: 1.67, quantum: 100 }],
  ["★★ 同上，且每档只需 18 档（档数压缩）", { startLog10: 250, rateMult: 1.67, quantum: 100, tiers: 18 }],
];

const check = process.argv.includes("--check");

console.log("=".repeat(100));
console.log("一次大坍缩要爬多久，以及各机制把 24 小时档缩短到多少");
console.log("=".repeat(100));
console.log(`  形状常量：爬升拐点 ${KNEE} 阶、每 ${CLIMB.halvingOrders} 阶减半；` +
  `过载拐点 = 上限 + 0.00432×量子、每 ${OVERLOAD.halvingOrders} 阶减半；R 上限 ${QUANTUM.growthRateMax}`);
console.log();
console.log(`  ${pad("机制", 44)} ${pad("每次耗时", 10)} ${pad("24 档总时长", 13)} ${pad("相对基准", 10)}`);

const base = climbSeconds({ quantum: 0 });
const baseTiers = BASE_TIERS;
let baseTotal = null;
for (const [label, o] of MECHS) {
  const tiers = o.tiers ?? BASE_TIERS;
  // R 的取法：**没给量子就当作已饱和**（基准是"量子足够"的理想曲线）；
  // 给了量子才用饱和公式 —— 第一版把"有 rateMult 但没给 quantum"算成 R=0，整行成了 ∞。
  const R = o.quantum === undefined
    ? QUANTUM.growthRateMax * (o.rateMult ?? 1)
    : rateOf(o.quantum, o.rateMult ?? 1);
  const sec = climbSeconds({
    startLog10: o.startLog10 ?? KNEE,
    endLog10: o.endLog10 ?? TARGET,
    R,
    quantum: o.quantum ?? 0,
    overHalving: o.overHalving ?? OVERLOAD.halvingOrders,
  });
  const total = (sec * tiers) / 3600;
  if (baseTotal === null) baseTotal = total;
  const delta = total - baseTotal;
  console.log(`  ${pad(label, 44)} ${pad(fMin(sec), 10)} ${pad(fH(total) + ` (${tiers} 档)`, 13)} ` +
    `${delta < -0.05 ? "省 " + fH(-delta) : delta > 0.05 ? "多 " + fH(delta) : "—"}`);
}
console.log();

if (check) {
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };

  // ① 与既有 pace-model 的数字对齐（100.2 分钟那条）
  const canon = secFor({});
  ck("基准与 pace-model 的 100 分钟对齐", Math.abs(canon / 60 - 100.2) < 3,
    `${(canon / 60).toFixed(1)} 分钟（pace-model 记录 100.2 分钟）`);

  // ② 起点越高越快（单调）
  const s25 = climbSeconds({ startLog10: 25 }), s200 = climbSeconds({ startLog10: 200 }),
    s250 = climbSeconds({ startLog10: 250 });
  ck("起点跃迁单调地缩短耗时", s25 > s200 && s200 > s250,
    `25→${fMin(s25)}｜200→${fMin(s200)}｜250→${fMin(s250)}`);

  // ③ 速率解放线性缩短（R ×k ⇒ 时间 ÷k）
  const r1 = secFor({ rateMult: 1 }), r2 = secFor({ rateMult: 2 });
  ck("速率提升 k 倍 ⇒ 耗时 ÷k（线性）", Math.abs(r1 / r2 - 2) < 0.02, `×2 → ${(r1 / r2).toFixed(3)} 倍`);

  // ④ 过载解放只影响"推得上限之后"的部分
  const o10 = climbSeconds({ endLog10: TARGET + 3, overHalving: 10 });
  const o14 = climbSeconds({ endLog10: TARGET + 3, overHalving: 14 });
  ck("过载解放对「不推上限之后」没有影响",
    Math.abs(climbSeconds({}) - climbSeconds({ overHalving: 14 })) < 1,
    `到上限为止两者差 ${(climbSeconds({}) - climbSeconds({ overHalving: 14 })).toFixed(2)} 秒`);
  ck("过载解放对「继续推深」有效", o14 < o10, `推到上限+3 阶：10→${fMin(o10)}｜14→${fMin(o14)}`);

  // ⑤ 量子是门槛：没有量子就爬不动
  ck("量子为 0 时爬升速率为 0（爬不动）", rateOf(0) === 0, `R(0) = ${rateOf(0)}`);
  ck("量子数量对 R 饱和（100 个 ≈ 上限）", rateOf(100) / QUANTUM.growthRateMax > 0.99,
    `R(100)/Rmax = ${(rateOf(100) / QUANTUM.growthRateMax).toFixed(4)}`);

  // ⑥ 关键结论：24 小时档要成立，每次耗时必须 ≈60 分钟
  const need = 24 * 3600 / BASE_TIERS;
  const withStart = secFor({ startLog10: 200 });
  const withRate = secFor({ rateMult: 1.67 });
  const withBoth = secFor({ startLog10: 200, rateMult: 1.67 });
  ck("单靠起点跃迁 1e200 还不够 60 分钟", withStart > need,
    `1e200 → ${fMin(withStart)}（需要 ≤ ${fMin(need)}）`);
  ck("起点 1e200 + 速率 ×1.67 可达成 60 分钟", withBoth < need,
    `→ ${fMin(withBoth)}（省 ${((canon - withBoth) / 60).toFixed(1)} 分钟/次）`);
  ck("两个机制叠加后 24 档总时长 ≈ 目标", (withBoth * BASE_TIERS / 3600) < 24,
    `${fH(withBoth * BASE_TIERS / 3600)}（基准 ${fH(canon * BASE_TIERS / 3600)}）`);

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
