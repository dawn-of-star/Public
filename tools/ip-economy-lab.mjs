/**
 * tools/ip-economy-lab.mjs —— 「无限点推到 1e308.25」的**经济模型**（纯模拟，不跑游戏）
 *
 * ── 为什么需要新机制 ──
 *   IP 现在只有两个来源：
 *     · 深度收益 `floor((log10M / 308.2547)²)` —— 要到 1e308 点得让物质到 1e154 **阶**，不可能；
 *     · ④ 实时耗时收益 `60 × 3^①` 点/小时 —— 线性增长，追不上 306 个数量级。
 *   所以要到达 1e308.25，必须引入**倍增型**的 IP 升级（升级/里程碑模式）。
 *
 * ── 本工具在算什么 ──
 *   三个可购买的循环（都用闭式价格，贪心买）：
 *     ① 无限增幅   ：价格 `10^A`，收入 ×3          （已有；p = log3/log10 = 0.477 < 1，收敛）
 *     ② 引擎等级   ：价格 `5 × 2^E`，IP 收入 ×10^(g·E)（新；g 越大越猛）
 *     ③ 无限铸币   ：价格 `c0 × r^N`，IP 收入 ×m^N   （新；关键指数 **p = log m / log r**）
 *
 *   **p 是这套设计的核心**：
 *     p < 1  → 收敛（每一次升级越来越贵，追不上）
 *     p = 1  → 收入随时间的**对数线性**增长（稳，但要 308 阶需要很久）
 *     p > 1  → 超临界：**有限时间奇点**（`P^(1-p)` 归零）；把奇点放在 1e308.25 之外，
 *              就能得到"先慢慢起、最后几百阶刷地过去"的终局手感。
 *
 * 用法：
 *   node tools/ip-economy-lab.mjs            现状 vs 推荐参数（到 1e308.25 的时间）
 *   node tools/ip-economy-lab.mjs --sweep    扫参数（m × r × c0）
 *   node tools/ip-economy-lab.mjs --check    定点断言
 */
import Decimal from "../dist/break_eternity.esm.js";
import { BREAK_INFINITY, INFINITY_UPGRADES } from "../src/config.js";

const D = (v) => new Decimal(v ?? 0);
const TARGET = 308.25;                     // 目标：IP 到 1e308.25（和物质上限同一个数字）
const MILESTONES = [10, 50, 100, 200, 308.25];

/**
 * 模拟 IP 经济。
 * @param opts.m/r/c0  ② 无限铸币：效果 ×m^N，价格 c0×r^N
 * @param opts.engineG 引擎每级给 IP 收入的**阶数**
 * @param opts.ceilingFromEngine 铸币等级上限 = 引擎等级 + 这个偏移（null = 不设上限）
 *        ★ 这是**节流阀**：超临界（p>1）本身会"有限时间爆到无穷"，
 *          靠"上限跟着 ZPE 引擎走"把曲线切成阶梯，节奏就由 ZPE 的成长速度决定。
 * @param opts.ipPerHour0 起始收入（点/小时）——默认取实测的 ④ 收入 60
 * @param opts.hours 最多模拟多久（小时）
 */
export function simulate(opts = {}) {
  const {
    m = 2.5, r = 2, c0 = 1e6, engineG = 0.4, ceilingFromEngine = 0,
    ipPerHour0 = 60, hours = 400, dtHours = 1 / 60,
    // ★ 档位（用户定：**以大坍缩次数为准**）——
    //   把"每次大坍缩"近似成固定的 crunchHours（物质爬升受 R 钳制，实测 ~30~100 分钟）。
    //   每过一档：上限 +ceilingPerTier、涨价速度 r −= dR（下限 rFloor）、起步价 ÷c0Div。
    crunchHours = 1, ceilingPerTier = 32, dR = 0, rFloor = 1.4, c0Div = 1,
    uncapped = false, aCapPerTier = null, aCapBase = 3,
  } = opts;
  const log3 = Math.log10(INFINITY_UPGRADES.ipDouble.effectMult);

  let P = D(0);          // IP 池
  let A = 0;             // ① 等级
  let N = 0;             // 铸币等级
  let E = 0;             // 引擎等级
  let tier = 0;          // 档位 = 已发生的大坍缩次数
  const hits = {};
  const staircase = [];  // 每次大坍缩后的 IP 阶数（用来看"加速段"长什么样）
  let t = 0;

  const costA = () => D(10).pow(A);
  const costN = () => D(c0).div(D(c0Div).pow(tier)).mul(D(rNow()).pow(N));
  const costE = () => D(5).mul(D(2).pow(E));
  const rNow = () => Math.max(rFloor, r - dR * tier);
  const ceiling = () => (uncapped ? Infinity
    : (ceilingFromEngine === null ? 0 : E + ceilingFromEngine) + ceilingPerTier * tier);
  /**
   * ★ ①「无限增幅」也必须**分档设上限**。
   *
   * 发现过程：只给铸币设上限时，`ceilingPerTier` 从 12 改到 32 结果**完全一样**
   * —— 因为池子一大就能把 ① 一次买几百级（×3/级），① 自己就是不受节流的 runaway，
   * 铸币上限拦不住它。所以 IP 侧的**每个循环**都得吃同一个档位闸门。
   * （`aCapPerTier = null` = 不设限，用来复现这个漏洞。）
   */
  const aCeiling = () => (aCapPerTier === null ? Infinity : aCapBase + aCapPerTier * tier);
  const logIncome = () => Math.log10(ipPerHour0) + A * log3 + N * Math.log10(m) + E * engineG;

  while (t < hours) {
    const income = D(10).pow(logIncome()).mul(dtHours);
    P = P.add(income);
    t += dtHours;

    // 档位推进（大坍缩）
    const wantTier = Math.floor(t / crunchHours);
    if (wantTier > tier) {
      tier = wantTier;
      const lg = P.gt(0) ? P.log10().toNumber() : 0;
      staircase.push({ tier, t, logIP: lg, N, A, E });
      if (staircase.length > 80) break;
    }

    // 贪心购买：买得起就买"最便宜"的；铸币受上限约束
    for (let guard = 0; guard < 400; guard++) {
      const items = [
        { id: "A", cost: A < aCeiling() ? costA() : null },
        { id: "N", cost: N < ceiling() ? costN() : null },
        { id: "E", cost: costE() },
      ].filter((x) => x.cost && x.cost.lte(P) && x.cost.gt(0));
      if (!items.length) break;
      items.sort((x, y) => x.cost.cmp(y.cost));
      const pick = items[0];
      P = P.sub(pick.cost);
      if (pick.id === "A") A++;
      else if (pick.id === "N") N++;
      else E++;
    }

    const lgP = P.gt(0) ? P.log10().toNumber() : 0;
    for (const ms of MILESTONES) {
      if (hits[ms] === undefined && lgP >= ms) hits[ms] = t;
    }
    if (hits[TARGET] !== undefined) break;
  }
  const lgP = P.gt(0) ? P.log10().toNumber() : 0;
  return { hits, t, logIP: lgP, A, N, E, tier, staircase, p: Math.log10(m) / Math.log10(r) };
}

const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h === undefined ? "—" : h < 1 ? `${(h * 60).toFixed(0)} 分` : `${h.toFixed(1)} 小时`);
const check = process.argv.includes("--check");

// ══════════════════════════════════════════════════════════
if (check) {
  console.log("=".repeat(94));
  console.log("IP 经济模型定点断言");
  console.log("=".repeat(94));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 40)} ${detail}`);
  };
  // 现状：没有新机制（m=1 → 铸币无效；engineG=0）
  const now = simulate({ m: 1, engineG: 0, ceilingFromEngine: null, uncapped: true, hours: 400 });
  ck("现状 400 小时内到不了 1e308.25", now.hits[TARGET] === undefined,
    `400 小时后 IP = 1e${now.logIP.toFixed(1)}（① 只有 ${now.A} 级）`);
  ck("p = log m / log r 是设计核心", Math.abs((Math.log10(2.5) / Math.log10(2)) - 1.322) < 0.01,
    `m=2.5, r=2 → p = ${(Math.log10(2.5) / Math.log10(2)).toFixed(3)}（>1 才有终局手感）`);
  // ★ 节流阀：**单纯的"N ≤ 引擎等级"不是节流阀** —— 超临界状态下引擎等级和铸币
  //   会一起飞，两者时间几乎相同（这条断言把"此路不通"记下来，省得以后重试）。
  const uncapped = simulate({ m: 2.5, r: 2, c0: 1e6, engineG: 0, ceilingFromEngine: null, uncapped: true });
  const capped = simulate({ m: 2.5, r: 2, c0: 1e6, engineG: 0, ceilingFromEngine: 0 });
  ck("单纯 N≤引擎等级 不是节流阀（记录此路不通）",
    Math.abs((capped.hits[TARGET] ?? 0) - (uncapped.hits[TARGET] ?? 0)) < 0.5,
    `无上限 ${fH(uncapped.hits[TARGET])} ≈ 有上限 ${fH(capped.hits[TARGET])}`);
  // ★ 超临界的形状：最后 100 阶几乎是一瞬间（1e200 → 1e308.25 占总时长极小）
  const shape = uncapped;
  ck("超临界 = 先慢后冲（最后 108 阶占比 < 5%）",
    (shape.hits[TARGET] - shape.hits[200]) < shape.hits[TARGET] * 0.05,
    `1e200 → 1e308.25 用了 ${((shape.hits[TARGET] - shape.hits[200]) * 60).toFixed(1)} 分钟` +
    `（总时长 ${fH(shape.hits[TARGET])}）`);
  // ★ 起步价 c0 是"对顶时间"的主旋钮
  const cheap = simulate({ m: 2.5, r: 2, c0: 1e3, engineG: 0, ceilingFromEngine: null, uncapped: true });
  ck("c0 是主旋钮（1e6 → 1e3 会大幅提前）", cheap.hits[TARGET] < uncapped.hits[TARGET] / 10,
    `c0=1e6 → ${fH(uncapped.hits[TARGET])}；c0=1e3 → ${fH(cheap.hits[TARGET])}`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

// ══════════════════════════════════════════════════════════
console.log("=".repeat(94));
console.log("IP 经济：从 60 点/小时 到 1e308.25 需要什么");
console.log("=".repeat(94));
console.log(`  ${pad("方案", 44)} ${pad("到 1e10", 10)} ${pad("到 1e50", 10)} ${pad("到 1e100", 10)} ` +
  `${pad("到 1e200", 10)} ${pad("到 1e308.25", 11)} 收尾等级`);
const rows = [
  ["现状（不新增机制）", { m: 1, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["不加节流阀（上限=∞，p=1.32）", { m: 2.5, r: 2, c0: 1e6, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["铸币 ×2/级（p=1，临界）", { m: 2, r: 2, c0: 1e6, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["★ 24h 目标（m=2.5, c0=1e4.8）", { m: 2.5, r: 2, c0: Math.pow(10, 4.8), engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["★ 24h 目标（m=1.8, p=0.85）", { m: 1.8, r: 2, c0: Math.pow(10, 4.3), engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["★ 24h 目标（m=3, p=1.58）", { m: 3, r: 2, c0: Math.pow(10, 4.8), engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["12h 目标（m=2.5, c0=1e4.3）", { m: 2.5, r: 2, c0: Math.pow(10, 4.3), engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["48h 目标（m=2.5, c0=1e5.3）", { m: 2.5, r: 2, c0: Math.pow(10, 5.3), engineG: 0, ceilingFromEngine: null, uncapped: true }],
  // ★ 「每级耗时恒定」的候选：p = 1（效果与涨价同倍率）⇒ 等级随时间线性长
  ["p=1 小步（×2/级，价 ×2，c0=4）", { m: 2, r: 2, c0: 4, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["p=1 中步（×4/级，价 ×4，c0=4）", { m: 4, r: 4, c0: 4, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["p=1 大步（×7/级，价 ×7，c0=4）", { m: 7, r: 7, c0: 4, engineG: 0, ceilingFromEngine: null, uncapped: true }],
  ["p=1 大步（×10/级，价 ×10，c0=4）", { m: 10, r: 10, c0: 4, engineG: 0, ceilingFromEngine: null, uncapped: true }],
];
for (const [label, opts] of rows) {
  const res = simulate(opts);
  console.log(`  ${pad(label, 44)} ${pad(fH(res.hits[10]), 10)} ${pad(fH(res.hits[50]), 10)} ` +
    `${pad(fH(res.hits[100]), 10)} ${pad(fH(res.hits[200]), 10)} ${pad(fH(res.hits[TARGET]), 11)} ` +
    `铸币${res.N}/引擎${res.E}/①${res.A}`);
}
console.log();
console.log("  读法：`p = log m /log r` 是铸币的关键指数 —— p<1 收敛、p=1 对数线性、p>1 超临界（有限时间奇点）。");

if (process.argv.includes("--tiers")) {
  console.log();
  console.log("=".repeat(94));
  console.log("档位阶梯（档 = 大坍缩次数）：加速段是从哪来的？");
  console.log("=".repeat(94));
  const cfgs = [
    ["① 只抬上限（+32 级/档，涨价不变）", { ceilingPerTier: 32, dR: 0, c0Div: 1 }],
    ["② 上限 + 削减涨价（每档 r −0.02，下限 1.4）", { ceilingPerTier: 32, dR: 0.02, c0Div: 1 }],
    ["③ 上限 + 削减起步价（每档 ÷2）", { ceilingPerTier: 32, dR: 0, c0Div: 2 }],
    ["④ 上限 + 削减涨价 + 削减起步价", { ceilingPerTier: 32, dR: 0.02, c0Div: 2 }],
    ["⑤ 不抬上限，只削减涨价", { ceilingPerTier: 0, dR: 0.02, c0Div: 1 }],
    ["⑥ 抬高上限到 64/档", { ceilingPerTier: 64, dR: 0, c0Div: 1 }],
  ];
  for (const [label, over] of cfgs) {
    const res = simulate({ m: 2.5, r: 2, c0: 1e4, engineG: 0, ceilingFromEngine: null, hours: 60, ...over });
    const st = res.staircase;
    const first = st[0], mid = st[Math.floor(st.length / 2)], last = st[st.length - 1];
    console.log();
    console.log(`  ${label}`);
    console.log(`     到顶 ${fH(res.hits[TARGET])}｜档数 ${res.tier}｜终局铸币 ${res.N} 级 / ① ${res.A} 级｜p=${res.p.toFixed(2)}`);
    if (first && last) {
      console.log(`     每档兑现的阶数：第 1 档 +${(first.logIP - 0).toFixed(2)}｜中位档 +${((mid?.logIP ?? 0) - (st[Math.floor(st.length / 2) - 1]?.logIP ?? 0)).toFixed(2)}` +
        `｜末档 +${(last.logIP - (st[st.length - 2]?.logIP ?? 0)).toFixed(2)}`);
    }
  }
  console.log();
  console.log("  读法：**加速段 = 每次大坍缩后「上限松开 → 批量兑现」的那一下**；");
  console.log("        「削减」类机制（降价/降涨幅）让**同一次大坍缩兑现更多**，或让下一档来得更快。");
}

if (process.argv.includes("--fit")) {
  console.log();
  console.log("=".repeat(94));
  console.log("反解：想让「到 1e308.25」落在目标时长，起步价 c0 该取多少？");
  console.log("=".repeat(94));
  const targets = [2, 6, 12, 24, 48];
  console.log(`  ${pad("m（每级效果）", 16)} ${targets.map((t) => pad(`${t}h 用 c0`, 16)).join("")}`);
  for (const m of [1.8, 2, 2.5, 3]) {
    const cells = targets.map((target) => {
      let best = null;
      for (let e = 0; e <= 40; e += 0.25) {          // c0 = 10^e
        const r = simulate({ m, r: 2, c0: Math.pow(10, e), engineG: 0, ceilingFromEngine: null, uncapped: true, hours: 400 });
        const h = r.hits[TARGET];
        if (h === undefined) continue;
        if (best === null || Math.abs(h - target) < Math.abs(best.h - target)) best = { h, c0: Math.pow(10, e), e };
      }
      return pad(best ? `1e${best.e.toFixed(1)}` : ">1e40", 16);
    });
    console.log(`  ${pad(m, 16)} ${cells.join("")}`);
  }
  console.log();
  console.log("  读法：m 决定形状（p = log m/log 2），c0 决定总时长；两者独立，所以可以先定形状再定价。");
}

if (process.argv.includes("--sweep")) {
  console.log();
  console.log("=".repeat(94));
  console.log("参数扫描：到 1e308.25 的用时（小时）—— 行 = m（每级效果），列 = r（每级涨价）");
  console.log("=".repeat(94));
  const ms = [1.5, 2, 2.5, 3, 4];
  const rs = [1.5, 2, 2.5, 3];
  console.log(`  ${pad("m \\ r", 8)} ${rs.map((r) => pad("r=" + r, 14)).join("")}`);
  for (const m of ms) {
    const cells = rs.map((r) => {
      const res = simulate({ m, r, c0: 1e6, engineG: 0.4, hours: 400 });
      const h = res.hits[TARGET];
      return pad(h === undefined ? ">400h" : h.toFixed(1), 14);
    });
    console.log(`  ${pad(m, 8)} ${cells.join("")}`);
  }
  console.log();
  console.log("  （c0 = 1e6；p = log m/log r：>1 的格子里才会出现可接受的用时）");
}
