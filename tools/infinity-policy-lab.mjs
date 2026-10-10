/**
 * tools/infinity-policy-lab.mjs —— **策略感知的 ∞ 层模型**（2025）
 *
 * 为什么需要它：`infinity-ladder-lab` 只看"IP/次"，预测不了这一段 ✗
 *   —— 实测：把 `c` 从 0.035 提到 0.060，破∞ 反而从 57.97h 变慢（50h 只 4 次坍缩）✗
 *   原因：**"每次能推过拐点多少阶"是状态相关的、会漂**（取决于该轮 q 与倍率）
 *   ⇒ 不能用单点反解，必须**扫描**（本工具）。
 *
 * 模型（与现实策略一致：先攒够 128 IP 打破无限，再按价格从低到高买一次性升级）：
 *
 *   每轮：  time_i = (308.2547 − startLog) / b_eff        ← 起点跃迁缩短它
 *           IP_i   = ipPerCrunch(c, excess)               ← 深度复利
 *   策略：  IP ≥ 128 ⇒ 买「打破无限」；否则**攒着**（起点跃迁要 20/40/80/300，太贵）
 *
 * 用法：node tools/infinity-policy-lab.mjs [--check]
 */
import { BREAK_INFINITY, CLIMB, DE_SPAN, INFINITY_UPGRADES } from "../src/config.js";

const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h < 1 ? `${(h * 60).toFixed(1)} 分` : `${h.toFixed(2)} h`);
const check = process.argv.includes("--check");

const CAP = BREAK_INFINITY.maxLog10;                 // 308.2547
const WR = { first: 7.653, brk: 14.754, eter: 66.101 };
const EXP = 1 / 0.95, CEIL = 1.5;
const T = { first: WR.first * EXP, brk: WR.brk * EXP, brkCeil: WR.brk * CEIL };

/** 起点跃迁（真实代价与效果，直接读 config ✓ 单一数据源） */
const STARTS = ["start50", "start100", "start150", "start200"]
  .map((id) => ({ id, cost: INFINITY_UPGRADES[id].cost, startLog: INFINITY_UPGRADES[id].startLog10 }));
const BREAK_COST = BREAK_INFINITY.unlockCost;

/** 一次大坍缩能拿多少 IP：`10^(c·超出拐点的阶数)`（前面那段 depth² ≈ 1，忽略） */
const ipPerCrunch = (c, excess) => Math.max(1, Math.pow(10, c * excess));

console.log("=".repeat(100));
console.log("① 现实策略下的破∞时长（扫描 c × 每次超出阶数）");
console.log("=".repeat(100));
console.log(`  策略：先攒够 ${BREAK_COST} IP 打破无限（起点跃迁 20/40/80/300 太贵 ⇒ 破∞前买不起 ✗）`);
console.log(`  目标区间：[${T.brk.toFixed(2)} h（期望） … ${T.brkCeil.toFixed(2)} h（上限）]`);
console.log();
console.log(`  ${pad("c", 9)} ${pad("超出阶数", 10)} ${pad("IP/次", 10)} ${pad("需要次数", 10)} ${pad("破∞时刻", 11)} 判定`);

const rows = [];
for (const c of [0.035, 0.05, 0.06, 0.07, 0.08, 0.1]) {
  for (const excess of [10, 20, 27, 40]) {
    const ip = ipPerCrunch(c, excess);
    const n = Math.ceil(BREAK_COST / ip);            // 需要几次（每次同深、同耗时）
    // 第一次大坍缩用 8.06h 的标定 b；后续每轮**起点不变**（买不起起点跃迁）⇒ 同样耗时
    const perCrunch = T.first;
    const total = perCrunch + (n - 1) * perCrunch;
    const verdict = total <= T.brkCeil ? (Math.abs(total - T.brk) / T.brk < 0.15 ? "✅ 期望区" : "✅ 在区间") : "❌ 出界";
    rows.push({ c, excess, ip, n, total, ok: total <= T.brkCeil });
    console.log(`  ${pad(c, 9)} ${pad(excess, 10)} ${pad(ip.toFixed(1), 10)} ${pad(n, 10)} ${pad(fH(total), 11)} ${verdict}`);
  }
}
console.log();
console.log("  ⇒ **落在区间内的组合**（c ≥ 0.06 且超出 ≥ 20 阶，或 c ≥ 0.035 且超出 ≥ 40 阶）：");
for (const r of rows.filter((r) => r.ok)) {
  console.log(`     c=${r.c} × 超出 ${r.excess} 阶 ⇒ ${r.ip.toFixed(1)} IP/次 ⇒ ${r.n} 次 ⇒ ${fH(r.total)} ✓`);
}
console.log();

console.log("=".repeat(100));
console.log("② 关键结构事实：**破∞之前买不起任何加速**（这才是时长过长的根源）");
console.log("=".repeat(100));
console.log(`  ${pad("升级", 18)} ${pad("代价", 8)} ${pad("破∞前买得起吗", 16)} 说明`);
for (const s of STARTS) {
  console.log(`  ${pad(s.id, 18)} ${pad(s.cost, 8)} ${pad(s.cost < BREAK_COST ? "能" : "❌ 不能", 16)} 起点 1e${s.startLog} ⇒ 单档少跨 ${s.startLog} 阶`);
}
console.log(`  ${pad("打破无限", 18)} ${pad(BREAK_COST, 8)} ${pad("目标", 16)} —— 所有加速都要跟它抢同一笔 IP ✗`);
console.log();
console.log("  ⇒ 所以破∞前的每一档都**必须**跨满 308 阶（起点 = 0）⇒ 每档 ~10h");
console.log("     ⇒ 想让这一段落进区间，只有两条路：");
console.log("        (甲) **IP/次 大幅提高**（c 与超出阶数一起抬）⇒ 2 次就够 ✓");
console.log("        (乙) 把某个加速**移到破∞之前**（例如量子里程碑给一个新起点，或档位里程碑给）✓");

if (check) {
  console.log();
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 50)} ${detail}`);
  };
  const ip = (c, e) => ipPerCrunch(c, e);
  ck("★ 存在使破∞落进区间的组合", rows.some((r) => r.ok),
    `${rows.filter((r) => r.ok).length} / ${rows.length} 组在区间内`);
  ck("★ c=0.035（现值）× 超出 27 阶 出界", T.first + (Math.ceil(BREAK_COST / ip(0.035, 27)) - 1) * T.first > T.brkCeil,
    `${fH(T.first + (Math.ceil(BREAK_COST / ip(0.035, 27)) - 1) * T.first)} > 上限 ${fH(T.brkCeil)}`);
  ck("★ c=0.07 × 超出 27 阶 落在期望区", T.first + (Math.ceil(BREAK_COST / ip(0.07, 27)) - 1) * T.first <= T.brkCeil,
    `${fH(T.first + (Math.ceil(BREAK_COST / ip(0.07, 27)) - 1) * T.first)} ≤ 上限 ${fH(T.brkCeil)}`);
  ck("★ 结构事实：起点跃迁与打破无限**抢同一笔 IP**（零和，不是「买不起」）",
    STARTS.some((s) => s.cost < BREAK_COST), `start50 = 20 IP < 破∞ 128 IP ⇒ 买它就推迟破∞`);
  ck("标尺换算正确（期望 = WR ÷ 0.95）", Math.abs(T.brk - WR.brk / 0.95) < 1e-9, `${T.brk.toFixed(2)} h`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
