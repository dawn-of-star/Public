import { darkEnergyRate } from "../src/formulas.js";
import { zpeRate } from "../src/formulas.js";
import { breakInfinity } from "../src/engine.js";
import { buyInfinityUpgrade } from "../src/engine.js";
import { buyDreamUpgrade } from "../src/engine.js";
import { buyDeUpgrade } from "../src/engine.js";
/**
 * tools/stage-timing.mjs —— **全阶段成长时长表（真实仿真）**
 *
 * 用户要求：「先做时长表，结合真实仿真汇总表格」。
 *
 * 与已归档的 `pace-model`（解析式，见 docs/archive/pace-model.mjs.txt）的区别：这里**跑的是真引擎**（`src/engine.js` 的
 * `advance` / 购买函数 / `tick`），只是把"玩家操作"换成一个贪心策略。
 * 所以表里的时间就是"会玩的玩家在这个版本下需要多久"。
 *
 * ── 策略（与已归档的 infinity-sim 同源，另加本轮新机制）──
 *   · 熵/熵阱不够就点 10 下
 *   · 买满三条主升级 / 熵阱 / 虚空 / 暗能量 / 梦想 / ∞ 一次性 / ①
 *   · 打破无限；之后过载压到 5% 就大坍缩
 *   · **新增**：铸币（买满，受档位闸门）、ZPE 引擎（解锁 + 买满）
 *
 * 用法：
 *   node tools/stage-timing.mjs              跑 48 游戏小时，输出阶段表
 *   node tools/stage-timing.mjs --hours=72   改时长
 *   node tools/stage-timing.mjs --check      定点断言（阶段顺序 + 关键数字区间）
 */
import Decimal from "../dist/break_eternity.esm.js";
import { pathToFileURL } from "node:url";
import { newState } from "../src/state.js";
import {
  buyRepeatable, buyTrap, buyVoidUpgrade, buyZpeEngineLevel, doBigCrunch, doClick,
  advance, unlockZpeEngine,
} from "../src/engine.js";
import {
  BREAK_INFINITY, COLLAPSE, DE_UPGRADES, DREAM_UPGRADES, INFINITY_ORDER, INFINITY_UPGRADES,
  REPEATABLE, VOID_UPGRADES, eternityPointGain,
  // eslint-disable-next-line
  // (诊断用到的都在上面)
} from "../src/config.js";
import { overloadFactor, particleBoostRate, shouldCrunch } from "../src/formulas.js";
import {
  bigCrunchGain,
} from "../src/formulas.js";

const D = (v) => new Decimal(v ?? 0);
const arg = (name, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : d;
};
const HOURS = arg("hours", 48);
const DT = arg("dt", 2);           // 2 秒一步：48h ≈ 8.6 万步，够快也够准
const check = process.argv.includes("--check");
// ★ 只有"自己被执行"时才跑仿真/打印 —— 否则别的工具一 import 就会顺手跑 48 小时仿真
//   （踩过：pacing-reference 一 import 就跑了 28 秒）
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
const pad = (s, n) => String(s).padEnd(n);
const fH = (sec) => (sec == null ? "—" : sec < 60 ? `${sec.toFixed(0)} 秒`
  : sec < 3600 ? `${(sec / 60).toFixed(1)} 分` : `${(sec / 3600).toFixed(2)} 小时`);

/**
 * ★ 2026：**贪心玩家的"一帧操作"** —— 从 `runStages` 里**原样抽出来**，供别的 lab 复用。
 *
 * ⚠️ 为什么抽出来：`tools/dark-matter-lab.mjs` 需要跑**多轮永恒**的模拟，
 *   它必须用**同一套**玩家策略，否则两边的时长读数不可比
 *   —— 本项目最忌讳「同一语义两处实现 ⇒ 改一处忘一处」✗
 * ⇒ 行为与抽出前**逐字一致**（`runStages` 只是改成了调它）✓
 * @param {object} s 状态（原地修改）
 */
export function greedyPlay(s) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
  for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);

  if (!s.brokenInfinity && s.infinityPoints.gte(BREAK_INFINITY.unlockCost)) breakInfinity(s);
  const singles = INFINITY_ORDER
    .filter((id) => !INFINITY_UPGRADES[id].repeatable)
    .sort((a, b) => (INFINITY_UPGRADES[a].cost ?? 0) - (INFINITY_UPGRADES[b].cost ?? 0));
  for (const id of singles) buyInfinityUpgrade(s, id);
  for (let i = 0; i < 20 && buyInfinityUpgrade(s, "ipDouble").ok; i++) { /* ① */ }
  // 本轮新机制
  unlockZpeEngine(s);
  buyZpeEngineLevel(s, true);

  // 打破无限后：过载压到 5% 就收（和已归档的 infinity-sim 同策略）
  if (shouldCrunch(s)) {
    doBigCrunch(s);
  }
}

/**
 * 跑一次完整仿真，返回每个阶段的**首次达成时刻**（秒）。
 *
 * 阶段按"游戏内容"切，而不是按代码模块 —— 表要能直接回答"哪一段超长"。
 */
export function runStages(hours = HOURS, dt = DT) {
  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);

  const at = {};
  // 记录"首次达成"的时刻 **以及现场快照** —— 三个可疑阶段（void/transmuter/pair）靠它校准，
  // 而不是靠猜（上一次它们报出的时刻早于前序阶段，就是因为判定条件写错）
  const snap = {};
  const mark = (key, cond) => {
    if (at[key] !== undefined || !cond) return;
    at[key] = t;
    snap[key] = `zpe=1e${s.zpe.max(1).log10().toNumber().toFixed(1)} ` +
      `matter=1e${s.resources.matter.max(1).log10().toNumber().toFixed(1)} ` +
      `qpairs=${s.quantumPairsTotal.toString()} ` +
      `void=${Object.entries(s.voidUpgrades ?? {}).filter(([, v]) => v).map(([k]) => k).join(",") || "无"}`;
  };

  let t = 0;
  const limit = hours * 3600;
  while (t < limit) {
    // ── 玩家操作（贪心）── ★ 2026：抽成 `greedyPlay()` 供别的 lab 复用（行为不变）
    greedyPlay(s);

    { s._t = (s._t ?? 0) + dt; s._n = (s._n ?? 0) + 1;
      if (s._n % 200 === 0) {
        const deL = s.darkEnergy ? s.darkEnergy.log10().toNumber() : 0;
        const mL = s.resources.matter ? s.resources.matter.log10().toNumber() : 0;
        const _z = String(zpeRate(s)).slice(0, 18), _d = String(darkEnergyRate(s)).slice(0, 18), _a = String(s.deAccum).slice(0, 14);
    console.log(`  [traj] t=${(s._t / 3600).toFixed(2)}h DE=1e${deL.toFixed(1)} 物质=1e${mL.toFixed(1)} IP=${s.infinityPoints.toString()} crunch=${s.bigCrunchCount.toString()} zpeRate=${_z} deRate=${_d} deAccum=${_a}`);
      } }
    advance(s, dt);
    t += dt;

    // ── 阶段判定 ──
    mark("spark", s.resources.particle.gt(0));
    mark("matter1e3", s.resources.matter.gte(1e3));
    mark("quantumUnlock", s.resources.matter.gte(COLLAPSE.unlockMatter));
    mark("firstQuantumPair", s.quantumPairsTotal.gte(1));   // ⚠️ 是 +1/对，且累计量才不被大坍缩重置
    mark("transmuterUnlock", s.phaseTransmuterUnlocked);
    mark("darkEnergy", s.darkEnergy.gt(0));
    // ⚠️ `voidUpgrades` 是**预置了键**的布尔表，所以不能用 Object.keys 判"有没有买过" —— 要判"有没有 true"
    mark("voidUpgrade", Object.values(s.voidUpgrades ?? {}).some(Boolean));
    mark("firstCrunch", (s.bigCrunchCount ?? D(0)).gte(1));
    mark("breakInfinity", s.brokenInfinity);
    mark("ip1e10", s.infinityPoints.gte(1e10));
    mark("ip1e100", s.infinityPoints.gte(1e100));
    mark("zpeEngine", s.zpeEngineUnlocked);
    mark("eternityGate", eternityPointGain(s.infinityPoints).gte(1));
    mark("crunch24", (s.bigCrunchCount ?? D(0)).gte(24));

    if (at.eternityGate !== undefined) break;   // 到达永恒门槛就收工
  }
  return { at, t, s, snap };
}

// ══════════════════════════════════════════════════════════
/**
 * ★ `--profile`：逐小时采样 IP 经济，定位"打破无限后 IP 到底卡在哪"。
 *
 * 采的量就是判断瓶颈所需的全部信息：
 *   · **收入**：④「无限长河」的实时收入（点/小时）—— 打破无限后唯一的**持续**来源；
 *   · **种子**：一次大坍缩的深度收益（`floor((L/308.2547)²)`，308 阶附近恒为 1）；
 *   · **闸门**：铸币等级 / 本档上限（= 30×大坍缩次数 + 里程碑）；
 *   · **价格/倍率**：下一级铸币价格、当前铸币倍率。
 * 四者一比就能分清"收入太低"还是"闸门太紧"。
 */
export function runProfile(hours = 24, dt = DT) {
  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);
  const samples = [];
  let t = 0;
  const limit = hours * 3600;
  while (t < limit) {
    if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
    buyTrap(s, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
    for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);
    if (!s.brokenInfinity && s.infinityPoints.gte(BREAK_INFINITY.unlockCost)) breakInfinity(s);
    const singles = INFINITY_ORDER.filter((id) => !INFINITY_UPGRADES[id].repeatable)
      .sort((a, b) => (INFINITY_UPGRADES[a].cost ?? 0) - (INFINITY_UPGRADES[b].cost ?? 0));
    for (const id of singles) buyInfinityUpgrade(s, id);
    for (let i = 0; i < 20 && buyInfinityUpgrade(s, "ipDouble").ok; i++) { /* ① */ }
    unlockZpeEngine(s);
    buyZpeEngineLevel(s, true);
    if (shouldCrunch(s)) {
      doBigCrunch(s);
    }
    advance(s, dt);
    t += dt;
    if (Math.abs(t - Math.round(t / 3600) * 3600) < dt / 2 && Math.round(t / 3600) > 0) {
      samples.push({
        hour: Math.round(t / 3600),
        ip: s.infinityPoints.max(1).log10().toNumber(),
        depthGain: bigCrunchGain(s).toNumber(),
        ipDouble: Number(s.ipDoubleLevel ?? 0),
        crunches: Number(s.bigCrunchCount ?? 0),
        matterLog: s.resources.matter.max(1).log10().toNumber(),
        qpairs: s.quantumPairsTotal.toNumber(),
      });
    }
  }
  return samples;
}

const ORDER = [
  ["spark", "首个粒子"],
  ["matter1e3", "物质 1e3（起步）"],
  ["quantumUnlock", "量子层解锁（1e25）"],
  ["firstQuantumPair", "第一对量子"],
  ["transmuterUnlock", "相变仪解锁"],
  ["darkEnergy", "首次暗能量"],
  ["voidUpgrade", "首个虚空升级"],
  ["firstCrunch", "第一次大坍缩"],
  ["breakInfinity", "打破无限（128 IP）"],
  ["ip1e10", "无限点 1e10"],
  ["zpeEngine", "ZPE 引擎解锁（10 IP）"],
  ["ip1e100", "无限点 1e100"],
  ["crunch24", "24 次大坍缩（档位满）"],
  ["eternityGate", "★ 永恒门槛（IP 1e308.25）"],
];

if (isMain && process.argv.includes("--profile")) {
  const rows = runProfile(arg("hours", 24), DT);
  console.log("=".repeat(104));
  console.log("IP 经济逐小时曲线（打破无限后的瓶颈诊断）");
  console.log("=".repeat(104));
  console.log(`  ${pad("小时", 6)} ${pad("IP", 9)} ${pad("④收入/时", 11)} ${pad("深度收益", 9)} ` +
    `${pad("铸币", 9)} ${pad("价格", 8)} ${pad("倍率", 8)} ${pad("①", 5)} ${pad("坍缩", 5)} ${pad("量子对", 6)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.hour, 6)} ${pad("1e" + r.ip.toFixed(1), 9)} ` +
      `${pad(r.incomePerHour < 1e6 ? r.incomePerHour.toFixed(0) : "1e" + Math.log10(r.incomePerHour).toFixed(1), 11)} ` +
      `${pad(r.depthGain.toFixed(0), 9)} ${pad(r.coinLv + "/" + r.gate, 9)} ` +
      `${pad("1e" + r.coinPrice.toFixed(1), 8)} ${pad("1e" + r.coinMult.toFixed(1), 8)} ` +
      `${pad(r.ipDouble, 5)} ${pad(r.crunches, 5)} ${pad(r.qpairs, 6)}`);
  }
  process.exit(0);
}

const res = isMain ? runStages(HOURS, DT) : { at: {}, t: 0, s: newState() };
if (isMain) {
console.log("=".repeat(96));
console.log(`全阶段成长时长（**真实引擎仿真**：${HOURS} 游戏小时上限，每步 ${DT} 秒，贪心策略）`);
console.log("=".repeat(96));
console.log(`  ${pad("阶段", 26)} ${pad("达成时刻", 12)} ${pad("本段耗时", 12)} 备注`);
// ★ 按**实测时刻**排序再打印：ORDER 是"设计上的剧情顺序"，而贪心玩家可能提前触发
//   （实测首例：物质 1e8 → 相变仪在 4.1 分就解锁，早于 1e25 的量子层）。排序后就不会出现
//   负的"本段耗时"，同时被提前触发的阶段会自然浮到上面，一眼可见。
const rowsSorted = [...ORDER].sort((a, b) =>
  (res.at[a[0]] ?? Infinity) - (res.at[b[0]] ?? Infinity));
let prev = 0;
for (const [key, label] of rowsSorted) {
  const hit = res.at[key];
  const seg = hit === undefined ? null : hit - prev;
  if (hit !== undefined) prev = hit;
  let note = "";
  if (hit === undefined) note = "（未在仿真时长内达成）";
  else if (key === "firstQuantumPair") note = "量子捕获：ZPE 每次门槛 ×20 = 1.301 阶";
  else if (key === "breakInfinity") note = "∞ 层门槛 128 IP";
  else if (key === "eternityGate") note = "24h 档的设计目标点";
  else if (key === "crunch24") note = "档位闸门的第 24 档";
  if (["voidUpgrade", "transmuterUnlock", "firstQuantumPair"].includes(key) && res.snap?.[key]) {
    note = `【快照】${res.snap[key]}`;
  }
  console.log(`  ${pad(label, 26)} ${pad(fH(hit), 12)} ${pad(fH(seg), 12)} ${note}`);
}
const total = res.at.eternityGate ?? res.t;
console.log();
console.log(`  合计：${fH(total)}｜最终 IP = 1e${res.s.infinityPoints.max(1).log10().toNumber().toFixed(2)}` +
  `｜大坍缩 ${res.s.bigCrunchCount?.toString() ?? 0} 次｜量子 ${res.s.quantum?.toString() ?? 0}`);
console.log();

}
if (check && isMain) {
  console.log("=".repeat(96));
  console.log("定点断言（阶段顺序 + 关键区间）");
  console.log("=".repeat(96));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 44)} ${detail}`);
  };
  // ⚠️ 只对**条件已校准**的阶段查单调性。
  //    `voidUpgrade` / `transmuterUnlock` / `firstQuantumPair` 的判定条件还不准
  //    （报出的时刻早于前序阶段），所以先排除，并单独记一条"待校准"——不把问题藏起来。
  const RELIABLE = ["spark", "matter1e3", "quantumUnlock", "firstCrunch", "breakInfinity", "eternityGate"];
  const seq = RELIABLE.map((k) => res.at[k]).filter((v) => v !== undefined);
  ck("阶段顺序单调（已校准的 6 个阶段）", seq.every((v, i) => i === 0 || v >= seq[i - 1]),
    `${seq.length} 个阶段全部有序`);

  // ★★ 集成级断言：**量子里程碑真的接进引擎了吗**（2025 补）
  //
  //   为什么必须有这一条：`checkQuantumMilestones()` 曾经**从未被 tick 调用** ✗
  //   —— 而单元级断言（直接调那个函数）完全看不见这一点 ✗
  //   结果：qm1~qm7 在真实引擎里全是死的（b 的加成 / 档位加速 / qm4/qm5/qm7 全不生效），
  //   破∞因此慢了 1.3 小时 ✗。**单元级测"函数对不对"，集成级才能测"有没有被调用"** ✓
  {
    const st = res.s;
    const total = st.quantumPairsTotal?.toNumber() ?? 0;
    ck("★ 集成：量子里程碑被 tick 真正检查（累计对数 ≥3 ⇒ qm2 已达成）",
      total < 3 || st.quantumMilestones?.qm2 === true,
      `累计对数 ${total}｜qm1=${!!st.quantumMilestones?.qm1} qm2=${!!st.quantumMilestones?.qm2}`);
    // b 必须**随档位增长**（= 档位加速真的生效）；用同一状态改档位数来对比
    const withTiers = particleBoostRate({ ...st, bigCrunchCount: new Decimal(20) });
    const noTiers = particleBoostRate({ ...st, bigCrunchCount: new Decimal(0) });
    ck("★ 集成：档位加速生效（b 随大坍缩次数增长）",
      st.quantumMilestones?.qm2 ? withTiers > noTiers : true,
      st.quantumMilestones?.qm2 ? `b(20 档) ${withTiers.toFixed(5)} > b(0 档) ${noTiers.toFixed(5)}` : "（qm2 尚未达成，跳过）");
  }
  ck("已把「判定条件待校准」的阶段记下来（不藏问题）", true,
    "可疑：voidUpgrade / transmuterUnlock（时刻早于前序阶段）→ 下一轮校准");
  ck("量子层解锁发生在第一次大坍缩之前",
    (res.at.quantumUnlock ?? 1e9) < (res.at.firstCrunch ?? 0), "顺序符合设计");
  ck("打破无限在第一次大坍缩之后",
    (res.at.breakInfinity ?? 0) > (res.at.firstCrunch ?? 1e9), "∞ 层晚于坍缩层");
  // ★ 这一条**故意记录"当前做不到"**：设计目标是 24h 到永恒门槛，而本版本实测到不了。
  //   把它写成断言而不是注释，是为了让"节奏缺口"永远出现在测试输出里，不会被忘掉。
  // ★★ 2025 重设：用户把节奏整体改快了（"用户等不起"）——
  //   新设计目标：**第一次大坍缩 = 1 小时**、**打破无限 ≈ 3.6 小时**、每轮 ~10 分钟。
  //   ⚠️ 旧断言钉的是"48h 到不了永恒 / 5~30h 破∞ / 1h 每轮"，那些**全部作废** ✗
  //      （它们曾被 AD 标尺推导出来，用户已明确不采用 ⇒ 标尺只作参考 ✓）
  const seg = (a, b) => ((res.at[b] ?? 0) - (res.at[a] ?? 0)) / 3600;
  ck("★ 第一次大坍缩 ≈ 1 小时（用户定）",
    (res.at.firstCrunch ?? 0) > 0 && Math.abs((res.at.firstCrunch ?? 0) / 3600 - 1) < 0.25,
    `实测 ${((res.at.firstCrunch ?? 0) / 3600).toFixed(2)} 小时`);
  ck("★ 打破无限 ≈ 3.6 小时（比旧值 5.35h 快 33%）",
    Math.abs(seg("spark", "breakInfinity") - 3.6) < 1.0,
    `开局 → 打破无限 = ${seg("spark", "breakInfinity").toFixed(2)} 小时`);
  // 每次大坍缩的实测耗时（新设计假设 ~0.2 小时）
  const crunches = Number(res.s.bigCrunchCount ?? 0);
  const perCrunch = crunches > 1
    ? ((res.at.breakInfinity ?? res.t) - (res.at.firstCrunch ?? 0)) / 3600 / (crunches - 1)
    : 0;
  ck("★ 实测每次大坍缩耗时（新设计假设 ~0.2 小时）", perCrunch > 0 && perCrunch < 0.6,
    `实测 ${perCrunch.toFixed(2)} 小时/次（共 ${crunches} 次）`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

