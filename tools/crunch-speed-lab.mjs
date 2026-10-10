#!/usr/bin/env node
/**
 * tools/crunch-speed-lab.mjs —— ★ 2025 **重写**：一次无限要爬多久（**调用真引擎**）
 *
 * ══════════════════════════════════════════════════════════
 * 为什么整篇重写（不是修补）
 * ══════════════════════════════════════════════════════════
 * 旧版把"爬升耗时"**重新建模**成
 *     `climb(L) = 2^(−(L − CLIMB.knee)/CLIMB.halvingOrders)` + 过载 `2^(−x/OVERLOAD.halvingOrders)`
 * 而这两套机制**已经删掉了**：
 *   · 爬升已改成量子驱动的 `particleBoostRate`（指数**增长**，不是衰减）
 *   · 过载已改成**按速率触发**的渐近因子 `1/(1+over/8430)`
 *   · 收手判据已从"速率"改成**按时间**（`OVERLOAD.runSeconds`）
 * ⇒ 旧模型读到 `OVERLOAD.halvingOrders === undefined` ⇒ 整表 `Infinity`/`NaN` ✗
 *
 * ══════════════════════════════════════════════════════════
 * 新做法（**两次失败后才定下来的**，都记在这里免得再犯）
 * ══════════════════════════════════════════════════════════
 * ✗ 失败 1：空状态 + 闭式 ⇒ 全表"永远到不了"。
 *     原因：空状态 `particleRate = 0`（还没解锁 熵→粒子）。
 * ✗ 失败 2：真引擎跑出中局状态 + 闭式 ⇒ 全表"0.0 秒"。
 *     原因：闭式假设 `matterCoeff` 在整段爬升中**恒定**，而真玩法里它**一直在涨**
 *           （玩家持续买东西）⇒ 用"那一刻的大 coeff"去乘整段 ⇒ **严重低估** ✗
 *           （实测：1e121 → 1e308 真要几分钟，闭式给 0.0 秒）
 * ✓ 做法：**照 `engine.js` 的 `advance` 推进，并盯住目标** ——
 *     每走一步都用**当时**的真 `matterCoeff` / `particleRate`，
 *     直到物质越过目标（或超过时间上限）⇒ 记下真实耗时 ✓
 *     这与引擎是**同一个 tick 语义**，不引入任何新模型。
 *
 * 用法：`node tools/crunch-speed-lab.mjs [--check] [bootstrap小时数]`
 */
import Decimal from "../dist/break_eternity.esm.js";
import {
  BREAK_INFINITY, OVERLOAD, REPEATABLE, VOID_UPGRADES, DE_UPGRADES, DREAM_UPGRADES,
  INFINITY_ORDER, INFINITY_UPGRADES,
} from "../src/config.js";
import { shouldCrunch } from "../src/formulas.js";
import {
  advance, doClick, buyRepeatable, buyTrap, buyVoidUpgrade, buyDeUpgrade, buyDreamUpgrade,
  breakInfinity, unlockZpeEngine, buyZpeEngineLevel, buyIpDoubleMax, buyInfinityUpgrade, doBigCrunch,
} from "../src/engine.js";
import { newState } from "../src/state.js";

const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const lg = (v) => { const n = num(v && v.log10 ? v.log10() : Math.log10(v)); return Number.isFinite(n) ? n : NaN; };
const TARGET = BREAK_INFINITY.maxLog10;              // 308.2547（打破无限前的硬顶）
const RUN_CAP = Number(OVERLOAD.runSeconds);
const pad = (s, n) => String(s).padEnd(n);
const fMin = (s) => (!Number.isFinite(s) ? "到不了" : s < 90 ? `${s.toFixed(1)} 秒` : `${(s / 60).toFixed(1)} 分`);

/** 玩家会做的购买（与其它 lab 同一套，保持可比） */
function shop(s) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
  for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);
  const singles = INFINITY_ORDER.filter((id) => !INFINITY_UPGRADES[id].repeatable)
    .sort((a, b) => (INFINITY_UPGRADES[a].cost ?? 0) - (INFINITY_UPGRADES[b].cost ?? 0));
  for (const id of singles) buyInfinityUpgrade(s, id);
  buyIpDoubleMax(s);
  unlockZpeEngine(s);
  buyZpeEngineLevel(s, true);
}

/** ① bootstrap：用真引擎跑 `hours` 小时（含购买/坍缩），得到真实中局状态 */
export function bootstrap(hours) {
  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);
  let t = 0;
  while (t < hours * 3600) {
    shop(s);
    if (!s.brokenInfinity && s.infinityPoints.gte(BREAK_INFINITY.unlockCost)) breakInfinity(s);
    if (shouldCrunch(s)) doBigCrunch(s);
    advance(s, 5);
    t += 5;
  }
  return s;
}

/**
 * ② 从**当前状态**出发，真引擎推进到物质越过目标，返回**总共**耗时（秒）。
 *
 * ⚠️ 关键：撞到收手（`shouldCrunch`）**不能直接返回** ——
 *   真玩法是"坍缩一次、继续推"，目标要靠**多次大坍缩**才够得着
 *   （我第一版写成"一撞收手就 return false"⇒ 全表都报"未达" ✗）
 * ⇒ 这里模拟玩家：**该收手就收手、然后继续**，一直推进到越过硬顶为止 ✓
 *
 * @returns {{sec:number, reached:boolean, crunches:number}}
 */
export function timeToTarget(state, { target = TARGET, capSeconds = 36 * 3600, step = 5 } = {}) {
  let t = 0;
  // ⚠️ 坍缩次数**读计数器**，不要自己 ++：未打破无限时坍缩是 `tick` 里的
  //   **硬顶强制触发**（`phaseResets`），`shouldCrunch` **不会**报出来 ✗
  //   （我第一版自己数 ⇒ 全表都显示 0 次坍缩）
  const c0 = num(state.bigCrunchCount);
  while (t < capSeconds) {
    if (lg(state.resources.matter) >= target) return { sec: t, reached: true, crunches: num(state.bigCrunchCount) - c0 };
    shop(state);
    if (!state.brokenInfinity && state.infinityPoints.gte(BREAK_INFINITY.unlockCost)) breakInfinity(state);
    if (shouldCrunch(state)) doBigCrunch(state);
    advance(state, step);
    t += step;
  }
  return { sec: capSeconds, reached: false, crunches: num(state.bigCrunchCount) - c0 };
}

const HOURS = Number(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a))) || 2;

console.log("=".repeat(104));
console.log("★ 一次无限要爬多久 —— **真引擎推进 + 盯住硬顶**（不引入任何新模型）");
console.log("=".repeat(104));
console.log(`  目标 = 物质硬顶 ${TARGET.toFixed(4)} 阶｜收手上限 \`OVERLOAD.runSeconds\` = ${RUN_CAP} 秒`);
console.log();
console.log(`  ${pad("bootstrap(h)", 13)} ${pad("起始物质(log10)", 16)} ${pad("引擎等级", 9)} ${pad("到硬顶耗时", 13)} ${pad("期间坍缩", 9)} ${pad("判定", 12)}`);
const rows = [];
for (const h of [0.5, 1, 2, 4]) {
  const st = bootstrap(h);
  const startL = lg(st.resources.matter);
  const lv = num(st.zpeEngineLevel);
  const r = timeToTarget(st);
  rows.push({ h, startL, lv, sec: r.sec, reached: r.reached, crunches: r.crunches });
  console.log(
    `  ${pad(h.toFixed(1), 13)} ${pad(startL.toFixed(1), 16)} ${pad(lv, 9)} ${pad(fMin(r.sec), 13)} ` +
    `${pad(r.crunches, 9)} ${pad(r.reached ? "✅ 达成" : "❌ 未达", 12)}`
  );
}
console.log();
console.log(`  ★ 读法：`);
console.log(`     · 上表 = 从**那个真实中局状态**继续玩（该坍缩就坍缩），到"物质摸到硬顶"要多久`);
console.log(`     · "期间坍缩" = 这 36h 里为了攒够推进力跑了多少次大坍缩`);
console.log(`     · 耗时随 bootstrap 变短 ⇒ **引擎/升级的推进感**就是这个 ✓`);
console.log();

if (process.argv.includes("--check")) {
  console.log("=".repeat(104));
  console.log("定点断言");
  console.log("=".repeat(104));
  let fails = 0;
  const ck = (ok, label, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };

  // ① 全场无 NaN（旧版就是死在这）
  const anyNaN = rows.some((r) => Number.isNaN(r.sec) || Number.isNaN(r.startL) || Number.isNaN(r.lv));
  ck(!anyNaN, "★ 全部行都没有 NaN（旧版整表 NaN/∞ ✗）",
    anyNaN ? "有 NaN" : `${rows.length} 行全部有限`);

  // ② 早期一定能爬到硬顶（否则游戏根本推不动）
  const early = bootstrap(2);
  const rEarly = timeToTarget(early, { capSeconds: 6 * 3600 });
  ck(rEarly.reached, "★ 2h bootstrap 后能在 6h 内爬到物质硬顶",
    rEarly.reached ? `用了 ${fMin(rEarly.sec)}` : `6h 内没到（只到 1e${lg(early.resources.matter).toFixed(1)}）`);

  // ③ 耗时随进度**单调变短**（推进感的定义）
  const t1 = timeToTarget(bootstrap(1), { capSeconds: 6 * 3600 });
  const t2 = timeToTarget(bootstrap(4), { capSeconds: 6 * 3600 });
  const cmp = t1.reached && t2.reached ? t2.sec <= t1.sec : t2.reached;
  ck(cmp, "★ 进度越多 ⇒ 到硬顶越快（推进感）",
    `1h bootstrap ⇒ ${fMin(t1.sec)}｜4h ⇒ ${fMin(t2.sec)}`);

  // ④ 已过目标 ⇒ 立即返回 0
  {
    const s = bootstrap(0.5);
    s.resources.matter = D(10).pow(TARGET + 10);
    const z = timeToTarget(s, { capSeconds: 60 });
    ck(z.sec === 0 && z.reached, "★ 已过目标 ⇒ 0 秒（边界不返回负/NaN）", `sec = ${z.sec}｜reached = ${z.reached}`);
  }
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
