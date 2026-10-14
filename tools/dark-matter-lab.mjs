#!/usr/bin/env node
/**
 * tools/dark-matter-lab.mjs —— **暗物质 / 第二台相变仪**：参数表 + 定点断言 + 真引擎标定
 *
 * ══════════════════════════════════════════════════════════
 * 规则来源（用户 2026 重写版，取代设计稿第 50~52 行的雏形）
 * ══════════════════════════════════════════════════════════
 *   ① 暗物质由 **EP 获取**（等比价格 `costBase·costMult^n`）
 *   ② 第二台相变仪的速度是「第一台的 `^speedExp`」（可调以适配前期速度）
 *   ③ 第二台同时受**暗物质数量**的速度提升（`n^speedNExp`）
 *   ④ 把暗能量**基于暗物质的 `^effectNExp`** 转化为倍率 ⇒ 额外的**暗能量倍率**加成
 *
 * ── 落点 ──
 *   `darkEnergyMultiplier` 的**加法区**（与 `q²` 同池）：`+ (转化值 − 1)`
 *
 * ── 为什么用「效率」而不是「按时间跟踪」──
 *   实测（见 `--calibrate`）：目标 `T` 在**一整轮**里只从 1 涨到 ~18，
 *   而暗能量要长 167 阶那么久 ⇒ 任何秒级的跟踪速度都"追得上" ⇒ `v2` 会完全看不见 ✗
 *   ⇒ `转化值 = 1 + (T − 1)·min(1, v2/v2Ref)`：v2 决定"能转出多少"，既可见又有界 ✓
 *
 * 用法：
 *   node tools/dark-matter-lab.mjs              参数表（**快**，无仿真）
 *   node tools/dark-matter-lab.mjs --check      定点断言
 *   node tools/dark-matter-lab.mjs --calibrate  真引擎：多轮永恒 + v2Ref 标定（**慢**）
 *   node tools/dark-matter-lab.mjs --calibrate --eternities=6 --hours=14
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState, serialize, deserialize } from "../src/state.js";
import { advance, buyDarkMatter, doClick, doEternity } from "../src/engine.js";
import { darkEnergyRate, darkEnergyMultiplier } from "../src/formulas.js";
import {
  DARK_MATTER, ETERNITY_MILESTONES, darkMatterAdditiveTerm, darkMatterAffordableIn,
  darkMatterCostFor, darkMatterCount, darkMatterEffectMult, darkMatterPriceAt,
  // ★ 2026：为了做「收手判据是否吃掉了加成」的对照实验（lab 专用覆盖，不写回文件）
  OVERLOAD,
  darkMatterTargetMult, darkMatterUnlocked, eternityPointGain, secondTransmuterSpeed,
} from "../src/config.js";
// ★ 复用 stage-timing 的贪心策略（**不复制** —— 项目最忌讳「同一语义两处实现」）
//   它自带 `isMain` 守卫，所以 import 不会顺手跑 48 小时仿真 ✓
import { greedyPlay } from "./stage-timing.mjs";

const D = (v) => new Decimal(v ?? 0);
const num = (x) => {
  const v = Number(x);
  if (!Number.isFinite(v)) return "∞";
  if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) return v.toExponential(3).replace("e+", "e");
  return String(Number(v.toPrecision(5)));
};
const f = (x, n) => Number(x).toFixed(n === undefined ? 2 : n);
const pad = (s, n) => String(s).padEnd(n);
const arg = (name, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : d;
};
const DT = arg("dt", 2);
const check = process.argv.includes("--check");
const calibrate = process.argv.includes("--calibrate");
let fails = 0;
let total = 0;                 // ★ 断言条数**自动计数**（写死会随改动漂移 ✗）
const ck = (label, ok, detail = "") => {
  total++;
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
};

/** 合成状态：只设暗物质机制用到的输入（`v1Log10` 是**快照**，所以直接给） */
const mk = ({ eternities = 0, n = 0, deLog = 0, v1Log = 100, ep = 0 } = {}) => {
  const s = newState();
  s.eternityCount = eternities;
  s.eternityDarkMatter = n;
  s.v1Log10 = v1Log;
  if (deLog > 0) { s.darkEnergy = D(10).pow(deLog); s.darkEnergyTotal = D(10).pow(deLog); }
  s.eternityPoints = D(ep);
  return s;
};

// ══════════════════════════════════════════════════════════
// 一、定点断言（--check）
// ══════════════════════════════════════════════════════════
if (check) {
  console.log("=".repeat(92));
  console.log("暗物质 / 第二台相变仪 —— 定点断言");
  console.log("=".repeat(92));

  console.log("\n── ① 解锁判据 = em4（第 4 次永恒）──");
  ck("em4 已实装（非占位）", !ETERNITY_MILESTONES.find((m) => m.id === "em4")?.pending);
  ck("0 / 3 次永恒 ⇒ 未解锁且项恰好 0", darkMatterAdditiveTerm(mk({ eternities: 3, n: 5 })) === 0);
  ck("4 次永恒 + n>0 ⇒ 解锁", darkMatterUnlocked(mk({ eternities: 4, n: 1 })));

  console.log("\n── ② 零回归（未解锁 / n=0 ⇒ 加法项**恰好** 0）──");
  ck("未解锁（手改 n=999 也没用）", darkMatterAdditiveTerm(mk({ eternities: 0, n: 999, deLog: 167 })) === 0);
  ck("已解锁但 n=0", darkMatterAdditiveTerm(mk({ eternities: 4, n: 0, deLog: 167 })) === 0);

  console.log("\n── ③ ④ 的目标 T（含硬封顶）──");
  {
    const T = (n, deLog) => darkMatterTargetMult(mk({ eternities: 4, n, deLog }));
    ck("n 越大 T 越大（**封顶前**）", T(1, 167) < T(2, 167) && T(2, 167) < T(3, 167),
      `n=1 ⇒ ${f(T(1, 167), 2)}｜n=2 ⇒ ${f(T(2, 167), 2)}｜n=3 ⇒ ${f(T(3, 167), 2)}`);
    ck("暗能量越深 T 越大", T(2, 50) < T(2, 167), `1e50 ⇒ ${f(T(2, 50), 2)}｜1e167 ⇒ ${f(T(2, 167), 2)}`);
    ck("★ 余额=1（刚重置）⇒ T 恰好 1（**不变减益**）", (() => {
      const s = mk({ eternities: 4, n: 122 });
      s.darkEnergy = D(1);
      return darkMatterTargetMult(s) === 1;
    })(), "log10(2)^e − 1 < 0 ⇒ max(0,·) 夹住 ✓");
    // ★ 用户 2026 的核心诉求：「数值不足」⇒ n 必须真的有用
    const lo = T(2, 3578) - 1, hi = T(150, 3578) - 1;
    ck("★★ n 从 2 到 150 ⇒ 项跨**数量级**（「数值不足」的修法）",
      hi / Math.max(1, lo) > 1e3, `项 ${num(lo)} → ${num(hi)}（×${num(hi / Math.max(1, lo))}）`);
    // ★ 硬封顶必须真的封住（否则 0.34 次方的幂律会把整段压塌）
    const huge = T(1e6, 3578) - 1;
    const cap = DARK_MATTER.effectCap;
    ck(`★ 硬封顶生效（项 ≤ effectCap = ${num(cap)}）`, huge <= cap * (1 + 1e-12) && huge >= cap * 0.999,
      `n=1e6 ⇒ 项 ${num(huge)}`);
    ck("T 恒为有限正数（不会 NaN / ∞）", [1, 10, 1e6, 1e30].every((n) => Number.isFinite(T(n, 3578)) && T(n, 3578) >= 1));
  }

  console.log("\n── ④ 第二台速度 v2 = v1^0.01 × n^0.25 ──");
  {
    const v2 = (v1Log, n) => secondTransmuterSpeed(mk({ eternities: 4, n, v1Log }));
    ck("v1 的指数是**压缩机**（v1=1e100 ⇒ 10）", Math.abs(v2(100, 1) - 10) < 1e-9, num(v2(100, 1)));
    ck("v1=1e300 ⇒ v2 = 1000（落在 1~1000）", Math.abs(v2(300, 1) - 1000) < 1e-6, num(v2(300, 1)));
    ck("n^0.25：n=122 ⇒ ×3.32", Math.abs(v2(0, 122) / v2(0, 1) - Math.pow(122, 0.25)) < 1e-9, `×${f(v2(0, 122) / v2(0, 1), 3)}`);
    ck("未解锁 / n=0 ⇒ v2 = 0", v2(300, 0) === 0 && secondTransmuterSpeed(mk({ eternities: 0, n: 5, v1Log: 300 })) === 0);
  }

  console.log("\n── ⑤ 效率形式：转化值 ∈ [1, T]，v2 无界也安全 ──");
  {
    const e = (v1Log) => darkMatterEffectMult(mk({ eternities: 4, n: 122, deLog: 167, v1Log }));
    const T = darkMatterTargetMult(mk({ eternities: 4, n: 122, deLog: 167 }));
    // ⚠️ 这里**不能**再断言"效率≈0 ⇒ 转化值≈1"—— `T` 现在可达 1e9~1e12（硬封顶前），
    //   于是**极小的效率也能给出大项**（eff=1e-5 × T=2e9 ⇒ 项 2e4）✗
    //   ⇒ 正确的性质是：**随 v2 单调递增**，且封在 T ✓
    ck("随 v2 单调递增（v2 越大转化值越大）", e(-323) < e(0) && e(0) < e(50) && e(50) < T + 1e-9,
      `${num(e(-323))} < ${num(e(0))} < ${num(e(50))} < ${num(T)}`);
    ck("v2 中等 ⇒ 介于 1 与 T 之间", e(-323) < e(50) && e(50) < T + 1e-9, `${f(e(-323), 3)} < ${f(e(50), 3)} < ${f(T, 3)}`);
    ck("★ v2 巨大 ⇒ **封在 T**（有界）", Math.abs(e(1e9) - T) < 1e-9, `×${f(e(1e9), 4)}（T=${f(T, 4)}）`);
  }

  console.log("\n── ⑥ 落点：真的加进 `darkEnergyMultiplier` 的**加法区** ──");
  {
    // 干净状态：没买 DE 升级、引擎未解锁 ⇒ accel = 1、引擎倍率 = 1 ⇒ 倍率 == base
    // ⚠️ 用**封顶前**的小 n（否则加法项巨大，差额会溢出到看不出结构）
    const off = mk({ eternities: 4, n: 0, deLog: 167, v1Log: 300 });
    const on = mk({ eternities: 4, n: 2, deLog: 167, v1Log: 300 });
    const mOff = darkEnergyMultiplier(off).toNumber();
    const mOn = darkEnergyMultiplier(on).toNumber();
    const term = darkMatterAdditiveTerm(on);
    ck("★ 未解锁时倍率 == 基线 A（证明状态干净）", Math.abs(mOff - (1 + 167 * Math.log2(10) * 0.25)) < 1e-6, `A = ${f(mOff, 3)}`);
    ck("★ 差额 == 加法项（**不是乘性**）", Math.abs((mOn - mOff) - term) < 1e-6, `差额 ${num(mOn - mOff)} vs 项 ${num(term)}`);
    ck("项 ≥ 0（永不减益）", term >= 0, `项 = ${num(term)}`);
  }

  console.log("\n── ⑦ 获取：EP 购买（等比 costBase·costMult^n）──");
  {
    ck("价格序列 1 / 3 / 9", darkMatterPriceAt(0).toNumber() === 1 && darkMatterPriceAt(1).toNumber() === 3 && darkMatterPriceAt(2).toNumber() === 9);
    ck("买满 == 逐级（池 1/3/13/40/1000）", [1, 3, 13, 40, 1000].every((pool) => {
      const k = darkMatterAffordableIn(0, D(pool));
      return darkMatterCostFor(0, k).lte(pool) && darkMatterCostFor(0, k + 1).gt(pool);
    }));
    const s = mk({ eternities: 4, ep: 100 });
    ck("买 4 个扣 40（1+3+9+27）", buyDarkMatter(s, 4) === 4 && s.eternityPoints.toNumber() === 60 && s.eternityDarkMatter === 4,
      `EP=${num(s.eternityPoints)}｜n=${s.eternityDarkMatter}`);
    ck("未解锁 ⇒ 买不了（即使 EP 巨量）", buyDarkMatter(mk({ eternities: 3, ep: 1e9 }), 1) === 0);
  }

  console.log("\n── ⑧ 存档：往返 + ★ 旧档撞车守卫 + 脏数据 ──");
  {
    const back = deserialize(serialize(mk({ eternities: 4, n: 37, v1Log: 123.5 }))).state;
    ck("往返保留 n / v1Log10", darkMatterCount(back) === 37 && Math.abs(back.v1Log10 - 123.5) < 1e-9);
    ck("★ 旧档残留 darkMatter=56 ⇒ 新字段仍为 0（不撞车）",
      darkMatterCount(deserialize({ darkMatter: 56 }).state) === 0
      && darkMatterCount(deserialize({ darkMatter: 56, eternityDarkMatter: 3 }).state) === 3);
    ck("脏数据（-5/NaN/3.7/'abc'）⇒ 归一", (() => {
      const g = (v) => darkMatterCount(deserialize({ eternityDarkMatter: v }).state);
      return g(-5) === 0 && g(NaN) === 0 && g(3.7) === 3 && g("abc") === 0;
    })());
  }

  console.log("\n── ⑨ doEternity 不清暗物质（静态源码守卫）──");
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/engine.js", import.meta.url), "utf8");
    const start = src.indexOf("export function doEternity(");
    const end = src.indexOf("\n}", start);
    const body = start < 0 ? "" : src.slice(start, end < 0 ? start + 5000 : end);
    ck("★ doEternity 体内不出现 eternityDarkMatter", start >= 0 && !/eternityDarkMatter/.test(body),
      start < 0 ? "守卫失效（找不到 doEternity）✗" : `体长 ${body.length}`);
  }

  console.log("\n── ⑩ 真引擎冒烟：50 次 tick 不炸、快照被写入 ──");
  {
    const { tick } = await import("../src/engine.js");
    const s = mk({ eternities: 4, n: 20, v1Log: 100 });
    s.phaseTransmuterUnlocked = true;
    s.resources.traps = D(50);
    s.zpe = D("1e30");
    for (let i = 0; i < 50; i++) tick(s, 1);
    const m = darkEnergyMultiplier(s).toNumber();
    ck("倍率是有限正数", Number.isFinite(m) && m > 0, `×${f(m, 3)}`);
    ck("v1Log10 快照被写入（有限）", Number.isFinite(s.v1Log10), `v1Log10 = ${f(s.v1Log10, 3)}`);
    ck("快照写入后加法项仍有限", Number.isFinite(darkMatterAdditiveTerm(s)), `项 = ${f(darkMatterAdditiveTerm(s), 4)}`);
  }

  console.log("\n" + "=".repeat(92));
  console.log(fails === 0 ? `  全部通过 ✅（暗物质 ${total} 条）` : `  ${fails} / ${total} 项失败 ❌`);
  console.log("=".repeat(92));
  process.exit(fails ? 1 : 0);
}

// ══════════════════════════════════════════════════════════
// 二、真引擎标定（--calibrate）
// ══════════════════════════════════════════════════════════

/**
 * 跑到**永恒门槛**（复用 stage-timing 的贪心策略）。
 *
 * ⚠️⚠️ **必须同时记录 `v1Log10` 的峰值**（`maxV1Log`）—— 这是我实测踩的坑：
 *   跑完那一刻往往**刚坍缩过**（`shouldCrunch` 在 `advance` 之前触发），
 *   而 `resetForCollapse` 把熵阱清零 ⇒ `zpeRate = 0` ⇒ 那一帧的快照是**极小值** ✗
 *   ⇒ 直接读跑完后的 `state.v1Log10` 会得到 ≈ 哨兵值（-323），把效果判成 0 ✗✗
 *   （但`eternityPointGain(IP) >= 1` 立刻成立 ⇒ 循环当场 break ⇒ 快照就停在那里）
 *   ⇒ 报告一律用 `maxV1Log`（"本轮 v1 最高到了多少"），那才是暗物质真正起作用的时刻 ✓
 *   —— 这正是 `TODO.md` J4 的教训：「**测量工具反复出错**」。
 */
function runToGate(s, { hours, dt, samples, onSample }) {
  let t = 0;
  const limit = hours * 3600;
  let atBreak = null;
  let maxV1Log = -Infinity;
  let maxDeLog = -Infinity;     // ★ 暗能量**余额**的峰值（跑完那刻可能刚坍缩 ⇒ 也是极小值 ✗）
  let maxTerm = 0;              // ★ 加进加法区的项在本轮的**最大值** ⇒ 证明机制真的生效过
  let maxCrunch = 0;            // ★ 本轮的大坍缩次数 ⇒ 用来验证"段时长是不是被 runSeconds 钉住"
  while (t < limit) {
    greedyPlay(s);
    if (s.brokenInfinity && atBreak === null) atBreak = t;
    if (onSample && samples && Math.floor(t) % samples === 0) onSample(s, t);
    advance(s, dt);
    t += dt;
    const lg = Number(s.v1Log10);
    if (Number.isFinite(lg) && lg > maxV1Log) maxV1Log = lg;
    const de = s.darkEnergy;
    if (de && de.gt && de.gt(1)) {
      const dl = de.log10().toNumber();
      if (Number.isFinite(dl) && dl > maxDeLog) maxDeLog = dl;
    }
    const tm = darkMatterAdditiveTerm(s);
    if (Number.isFinite(tm) && tm > maxTerm) maxTerm = tm;
    const bc = Number(s.bigCrunchCount ?? 0);
    if (Number.isFinite(bc) && bc > maxCrunch) maxCrunch = bc;
    if (eternityPointGain(s.infinityPoints).gte(1)) return { ok: true, t, atBreak, maxV1Log, maxDeLog, maxTerm, maxCrunch };
  }
  return { ok: false, t, atBreak, maxV1Log, maxDeLog, maxTerm, maxCrunch };
}

/** 把一条真实状态的"第一台速率"记进样本（存 log10，避免溢出） */
const sampleV1 = (s, t, cols) => {
  const r = s.phaseTransmuterUnlocked ? darkEnergyRate(s) : D(0);
  const lg = r.gt(0) ? r.log10().toNumber() : null;
  if (lg !== null && Number.isFinite(lg)) cols.push({ t, lg });
};

function calibrateMain() {
  const ETERNITIES = arg("eternities", 6);
  const HOURS = arg("hours", 16);
  const runStages = arg("stages", 1);          // 1 = 只在第 1 轮采样（省时间）
  // ★ `--cap=` / `--coeff=` 只改**本进程内存里**的参数（lab 专用，不写回文件）⇒ 用来扫系数
  const capArg = process.argv.find((a) => a.startsWith("--cap="));
  if (capArg) {
    DARK_MATTER.effectCap = Number(capArg.split("=")[1]);
    console.log(`⚠️ lab 覆盖：effectCap = ${num(DARK_MATTER.effectCap)}（只在本进程内生效）`);
  }
  const coeffArg = process.argv.find((a) => a.startsWith("--coeff="));
  if (coeffArg) {
    DARK_MATTER.effectCoeff = Number(coeffArg.split("=")[1]);
    console.log(`⚠️ lab 覆盖：effectCoeff = ${num(DARK_MATTER.effectCoeff)}（只在本进程内生效）`);
  }
  // ★ 2026 对照实验：**收手兜底**（`shouldCrunch` 的 ② 按速率判据）会不会把加成吃掉？
  //   设计本意（见 `shouldCrunch` 注释）：按时间收手 ⇒ 生产加速换成**深度**
  //   而实测基线是**兜底先到**（200s < runSeconds 300s）⇒ 加速变成**更早收手**⇒ 深度变浅 ✗
  //   ⇒ 本开关把兜底阈值调低（甚至关掉），看暗物质的贡献会不会跳上去 ✓
  const cbArg = process.argv.find((a) => a.startsWith("--crunchbelow="));
  if (cbArg) {
    const v = cbArg.split("=")[1];
    OVERLOAD.crunchBelow = v === "off" ? -1 : Number(v);
    console.log(`⚠️ lab 覆盖：OVERLOAD.crunchBelow = ${OVERLOAD.crunchBelow}`
      + `${OVERLOAD.crunchBelow < 0 ? "（**关闭兜底** ⇒ 只按 runSeconds 收手）" : ""}（只在本进程内生效）`);
  }
  console.log("=".repeat(100));
  console.log("暗物质 —— 真引擎标定（多轮永恒 + 第一台速率分布 + 效果实测）");
  console.log("=".repeat(100));
  console.log(`参数：最多 ${ETERNITIES} 轮｜每轮上限 ${HOURS} 小时｜步长 ${DT} 秒\n`);

  const v1cols = [];
  let s = newState();
  for (let i = 0; i < 10; i++) doClick(s);

  const epTraj = [];
  let fork = null;                              // em4 达成那一刻的状态（用于对照实验）
  for (let e = 1; e <= ETERNITIES; e++) {
    const r = runToGate(s, {
      hours: HOURS, dt: DT,
      samples: e <= runStages ? 600 : 0,
      onSample: e <= runStages ? (st, t) => sampleV1(st, t, v1cols) : null,
    });
    if (!r.ok) { console.log(`第 ${e} 轮：${f(r.t / 3600, 2)} 小时内没到永恒门槛 ⇒ 停止`); break; }
    const epBefore = s.eternityPoints;
    const gained = eternityPointGain(s.infinityPoints);
    epTraj.push({ e, hours: r.t / 3600, breakH: r.atBreak === null ? null : r.atBreak / 3600, epBefore: epBefore.toNumber(), gained: gained.toNumber() });
    console.log(`第 ${e} 轮：共 ${pad(f(r.t / 3600, 2), 6)} 小时（其中破∞在 ${pad(r.atBreak === null ? "—" : f(r.atBreak / 3600, 2), 6)} 小时）`
      + `｜到手 EP ${pad(num(gained), 10)}｜累计 EP ${pad(num(epBefore.add(gained)), 12)}`
      + `｜v1 峰值 log10 ${pad(f(r.maxV1Log, 1), 7)}｜暗物质 ${s.eternityDarkMatter}`);
    doEternity(s);
    // ⚠️ 分叉点必须取在 `doEternity` **之后**：
    //   ① `eternityCount` 是在 `doEternity` 里 +1 的 ⇒ 之前取则还是 3 ⇒ em4 未达成 ⇒ 暗物质**锁着** ✗
    //   ② 之前取的状态已满足永恒门槛 ⇒ 下一轮会立刻结束（实测读数 0.00 小时）✗
    //   （这两个都是我自己写 lab 时踩的，记在这里防复发）
    if (e === 4) fork = serialize(s);
  }

  // ── 第一台速率分布（决定 v2Ref）──
  if (v1cols.length) {
    const lgs = v1cols.map((x) => x.lg);
    const q = (p) => lgs[Math.min(lgs.length - 1, Math.floor(lgs.length * p))];
    console.log("\n" + "─".repeat(100));
    console.log("第一台速率 `v1 = darkEnergyRate` 的真实分布（log10）—— 第 1 轮，每 10 分钟采样一次");
    console.log("─".repeat(100));
    console.log(`  样本 ${lgs.length} 个｜min ${f(q(0), 2)}｜25% ${f(q(0.25), 2)}｜中位 ${f(q(0.5), 2)}｜75% ${f(q(0.75), 2)}｜max ${f(q(0.999), 2)}`);
    console.log("\n  由 `v2 = v1^0.01 × n^0.25` 换算（取几个代表点）：");
    console.log("  " + pad("log10 v1", 10) + pad("v1^0.01", 10) + pad("×n^0.25 (n=10)", 16) + pad("(n=122)", 12) + "(n=1000)");
    for (const lg of [q(0.25), q(0.5), q(0.75), q(0.999)]) {
      const p1 = Math.pow(10, DARK_MATTER.speedExp * lg);
      console.log("  " + pad(f(lg, 2), 10) + pad(f(p1, 3), 10)
        + pad(f(p1 * Math.pow(10, 0.25), 3), 16) + pad(f(p1 * Math.pow(122, 0.25), 3), 12) + f(p1 * Math.pow(1000, 0.25), 3));
    }
    console.log("\n  ⇒ 建议 `v2Ref` 取在「v2 中位数」附近，这样效率从 ~0.5 起步、后期爬到 1：");
    const mid = Math.pow(10, DARK_MATTER.speedExp * q(0.5)) * Math.pow(122, 0.25);
    console.log(`     当前 v2Ref = ${DARK_MATTER.v2Ref}｜按第 1 轮中位数 × n=122 估的中位 v2 ≈ ${f(mid, 2)}`);
    console.log("     ⚠️ 但暗物质要到 **第 4 次永恒** 才解锁 ⇒ 那时的 v1 比第 1 轮更高");
    console.log("        （实测见上面的多轮表：每轮 v1 的峰值随 `darkEnergyTotal` 累积而上升）");
  }

  // ── EP 经济（决定"第 4 次永恒时买得起几个"）──
  console.log("\n" + "─".repeat(100));
  console.log("EP 经济：暗物质的价格阶梯 1 / 3 / 9 / 27 / 81 …（买满 = 逐级真价之和）");
  console.log("─".repeat(100));
  console.log("  " + pad("第几轮", 8) + pad("到手 EP", 12) + pad("累计 EP", 14) + pad("可买个数", 10) + "累计总价");
  let acc = 0;
  for (const row of epTraj) {
    acc += row.gained;
    const k = darkMatterAffordableIn(0, D(acc));
    console.log("  " + pad(row.e, 8) + pad(num(row.gained), 12) + pad(num(acc), 14) + pad(k, 10) + num(darkMatterCostFor(0, k)));
  }
  console.log("  ⚠️ 这个模拟**不买 epMult**（EP 全部存下来）⇒ 是「能买几个」的**上界**");
  console.log("     真实玩家会优先买 epMult（首价 1 EP、每级 ×5）⇒ 实际可支配 EP 更少");

  // ── 效果实测（在第 5 轮上做对照：n=0 vs n=N）──
  if (fork) {
    console.log("\n" + "─".repeat(100));
    console.log("效果实测：同一状态分叉，第 5 轮跑两遍（n=0 对照 vs n=N）");
    console.log("─".repeat(100));
    const runFork = (n) => {
      const st = deserialize(fork).state;
      st.eternityDarkMatter = n;
      const ep0 = st.eternityPoints.toNumber();
      const r = runToGate(st, { hours: HOURS, dt: DT });
      // ★ 用**本轮两个峰值**还原"机制最强的那个时刻"（跑完那刻往往刚坍缩过，读到的都是极小值 ✗）
      st.v1Log10 = Number.isFinite(r.maxV1Log) ? r.maxV1Log : st.v1Log10;
      if (Number.isFinite(r.maxDeLog) && r.maxDeLog > 0) st.darkEnergy = D(10).pow(r.maxDeLog);
      return {
        ok: r.ok, hours: r.t / 3600,
        breakH: r.atBreak === null ? null : r.atBreak / 3600,
        maxTerm: r.maxTerm, maxV1Log: r.maxV1Log, maxDeLog: r.maxDeLog, maxCrunch: r.maxCrunch,
        term: darkMatterAdditiveTerm(st), v2: secondTransmuterSpeed(st),
        eff: Math.min(1, secondTransmuterSpeed(st) / DARK_MATTER.v2Ref),
        target: darkMatterTargetMult(st),
      };
    };
    const base = runFork(0);
    const show = (label, t) => {
      const d = base.ok && t.ok ? base.hours - t.hours : NaN;
      // ⚠️⚠️ 2026 修**测量口径**：原来印的是 `总时长 / 次数` —— 那不是"每次坍缩的时长" ✗
      //   它把**破∞ 之前**那段也摊进了分母（那时 `shouldCrunch` 因 `!brokenInfinity`
      //   直接返回 false ⇒ **一次坍缩都没有**）⇒ 报出的数偏大好几倍。
      //   实测第 5 轮：3.79h / 82 次 ⇒ 旧口径报 **166 秒**；
      //   扣掉破∞前 2.98h 后，破∞后只有 0.81h/82 次 ⇒ 真实 **≈36 秒/次** ✓
      //   ⇒ 改成只算**破∞之后**那一段（这才是收手判据真正作用的时间）✓
      const segSec = (t.breakH === null || !t.ok) ? null : (t.hours - t.breakH) * 3600;
      const per = segSec === null ? null : segSec / Math.max(1, t.maxCrunch);
      console.log(`  ${pad(label, 8)}：第 5 轮 ${t.ok ? pad(f(t.hours, 2), 6) + " 小时" : "没到门槛"}`
        + `｜破∞后 ${segSec === null ? "—" : f(segSec / 3600, 2) + " 小时"}`
        + `｜坍缩 ${pad(t.maxCrunch, 4)} 次 ⇒ **${per === null ? "—" : f(per, 1)} 秒/次**`
        + `｜项峰值 ${num(t.maxTerm)}｜省 ${Number.isFinite(d) ? f(d * 60, 1) + " 分钟" : "—"}`
        + `（${Number.isFinite(d) && base.hours > 0 ? f(d / base.hours * 100, 1) + "%" : "—"}）`);
    };
    show("n=0", base);
    // ★ **用户的 EP 现实**：40 EP ⇒ n=4（`1+3+9+27` 恰好）、1145 EP ⇒ n=7
    //   用户的裁定：「拟真不如我上手玩」「强度不足就调系数」⇒ 只扫**买得起的**那一段 ✓
    for (const n of [2, 4, 7, 10, 30, 122]) show("n=" + n, runFork(n));
    console.log("\n  ⚠️ 读数须知：`n` 是**手动塞进去**的（不分叉 EP 成本），量的是**纯效果**；");
    console.log("     要连成本一起看，得让模拟真的去买（`buyDarkMatter`），那会与 epMult 抢 EP ⇒ 另开一轮做。");
  } else {
    console.log("\n（没能跑到第 4 次永恒 ⇒ 跳过效果对照实验；调大 --eternities/--hours 再试）");
  }

  console.log("\n" + "=".repeat(100));
}

// ══════════════════════════════════════════════════════════
// 二·五、挂机模式（--hang）：**不按永恒**，看 IP / EP 能挂到多少
// ══════════════════════════════════════════════════════════
//
// 为什么需要它：用户 2026 指出「**可永恒时并不强制永恒**」⇒ 玩家可以用**耐心**换 EP：
//   `EP = 5^(log10(IP)/308 − 0.7)` 随 IP **无界**增长 ⇒ 挂得越久，单次永恒的 EP 越多。
// ⇒ 于是「暗物质的价格阶梯陡不陡」这件事，答案取决于**挂机能把 IP 推到多高**
//   （而不是取决于"每轮 1 EP"那个下限）✓
//
// ⚠️ 与 `--calibrate` 的区别：那个一撞门槛就停（量"最快通关"）；
//   这个**不许停**，一直跑，量"最长能憋多少"。
function hangMain() {
  const HOURS = arg("hours", 48);
  const STEP = arg("sample", 1800);            // 每 30 分钟采一行
  console.log("=".repeat(100));
  console.log("暗物质 —— 挂机模式（**永不按永恒**，看 IP / EP 能憋多高）");
  console.log("=".repeat(100));
  console.log(`最多 ${HOURS} 小时｜步长 ${DT} 秒｜每 ${STEP / 60} 分钟采一行\n`);

  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);
  const gained = () => eternityPointGain(s.infinityPoints).toNumber();
  let t = 0;
  const limit = HOURS * 3600;
  let nextAt = 0;
  let gateT = null;                            // 撞门槛的时刻（对照"一撞就走"能拿多少）
  console.log("  " + pad("挂机时长", 12) + pad("log10 IP", 14) + pad("单次永恒 EP", 16) + pad("能买暗物质", 12) + "落在实测的哪一档");
  const band = (n) => (n <= 10 ? "感觉不到（<0.2 分）" : n < 30 ? "微弱（~1 分）" : n < 55 ? "约 3.4%" : n < 122 ? "约 7.9%" : "约 16~25%");
  // ⚠️ **必须逐行打印**（不能等循环结束再打）—— 否则长跑时看不到进度，
  //   而且被管道缓存时连第一行都看不见（我踩过：10 分钟没有任何输出）✗
  const emit = (r) => {
    const h = r.t / 3600;
    const mark = gateT !== null && Math.abs(r.t - gateT) < STEP ? "  ← 撞门槛那一刻" : "";
    console.log("  " + pad(f(h, 2) + " 小时", 12) + pad("1e" + f(r.ipLog, 1), 14)
      + pad(num(r.ep), 16) + pad(r.n, 12) + band(r.n) + mark);
  };
  let last = null;
  while (t < limit) {
    greedyPlay(s);
    advance(s, DT);
    t += DT;
    if (gateT === null && gained() >= 1) gateT = t;
    if (t >= nextAt) {
      const ip = s.infinityPoints;
      const ep = gained();
      last = { t, ipLog: ip.max(1).log10().toNumber(), ep, n: darkMatterAffordableIn(0, D(ep)) };
      emit(last);
      nextAt += STEP;
    }
  }
  console.log("");
  const need30 = (Math.pow(3, 30) - 1) / 2;
  console.log(`  结论：挂 ${f(HOURS, 0)} 小时能到 log10 IP ≈ ${f(last.ipLog, 1)}、单次 EP ≈ ${num(last.ep)}、n ≈ ${last.n}`);
  console.log(`        要买到 n=30 需要 ${num(need30)} EP ⇒ 需要 log10 IP ≈ ${f(308 * (Math.log10(need30) / Math.log10(5) + 0.7), 0)}`);
  console.log("  ⚠️ 读数须知：这个贪心策略**不买 epMult**（EP 全存）⇒ 是「能买几个」的**上界** ✓");
  console.log("=".repeat(100));
}

// ══════════════════════════════════════════════════════════
// 二·七、时间线模式（--timeline）：**加成一个轮回里什么时候才亮？**
// ══════════════════════════════════════════════════════════
//
// 用户 2026 的问题：「就暗物质初期 4 个的情况下能不能**加速前期**？」
// ⇒ 要回答它必须看**时序**，而不是看总省时：
//   · `resetForCollapse`（`engine.js:819`）**每次大坍缩**都执行 `darkEnergy = D(1)`
//     ⇒ 那一项的唯一输入（**暗能量余额**）在每个大坍缩开始时都回到 1
//   · 而项 = `30000·((log10(1+余额))^(n^0.32) − 1)` ⇒ 余额 = 1 时**恰好 0**
// ⇒ 所以理论上"前期"拿不到加成；本模式把这条**测出来**（首次超过各档的时刻）✓
//
// 用法：node tools/dark-matter-lab.mjs --timeline --ns=2,4
function timelineMain() {
  const NS = (process.argv.find((a) => a.startsWith("--ns="))?.split("=")[1] ?? "2,4").split(",").map(Number);
  const HOURS = arg("hours", 8);
  const STEP = arg("sample", 60);
  console.log("=".repeat(104));
  console.log("暗物质 —— 时间线：第 5 轮（em4 之后第一次）里，加成一个轮回中什么时候才亮");
  console.log("=".repeat(104));

  // ── 先跑到 em4（与 `--calibrate` 同一条路；分叉点取在 `doEternity` **之后**）──
  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);
  for (let e = 1; e <= 4; e++) {
    const r = runToGate(s, { hours: HOURS, dt: DT });
    if (!r.ok) { console.log(`第 ${e} 轮没到门槛 ⇒ 中止`); return; }
    doEternity(s);
  }
  const fork = serialize(s);
  console.log("（已跑到第 4 次永恒 ⇒ em4 达成；下面用它的分叉跑第 5 轮）\n");

  for (const n of NS) {
    const st = deserialize(fork).state;
    st.eternityDarkMatter = n;
    const cols = [];
    runToGate(st, {
      hours: HOURS, dt: DT, samples: STEP,
      onSample: (ss, t) => {
        const de = ss.darkEnergy;
        const dlg = de && de.gt && de.gt(1) ? de.log10().toNumber() : 0;
        cols.push({ t, dlg, term: darkMatterAdditiveTerm(ss) });
      },
    });
    const T = (lv) => { const hit = cols.find((c) => c.term >= lv); return hit ? hit.t : null; };
    const fT = (x) => (x === null ? "**从未**" : `${f(x / 60, 1)} 分`);
    console.log(`── n=${n}（${n === 2 ? "4 EP 首买" : n === 4 ? "40 EP" : "—"}）第 5 轮 ──`);
    console.log(`  项首次 ≥ 1e6：${fT(T(1e6))}｜≥ 1e9：${fT(T(1e9))}｜≥ 1e10：${fT(T(1e10))}`
      + `｜峰值 ${num(Math.max(...cols.map((c) => c.term)))}`);
    const tail = cols.filter((c) => c.term >= 1e9).length;
    console.log(`  整轮中「项 ≥ 1e9」占 **${f(tail / cols.length * 100, 1)}%** 的时间`
      + `（整轮 ${f(cols[cols.length - 1].t / 60, 1)} 分钟）\n`);
    console.log("  " + pad("时刻", 10) + pad("log10 余额", 14) + pad("项", 18) + "说明");
    for (const m of [0, 30, 60, 120, 300, 600, 1200, 1800, 2400, 3000, 3300]) {
      const c = cols.find((x) => x.t >= m);
      if (!c) continue;
      const tag = c.term < 1 ? "**加成还是 0**（余额还没长起来）"
        : c.term < 1e6 ? "几乎无感" : c.term < 1e9 ? "微弱" : c.term < 1e11 ? "★ 有感" : "★ 接近封顶";
      console.log("  " + pad(f(c.t / 60, 1) + " 分", 10) + pad(f(c.dlg, 1), 14) + pad(num(c.term), 18) + tag);
    }
    console.log("");
  }
  console.log("=".repeat(104));
}

// ══════════════════════════════════════════════════════════
// 三、参数表（默认输出；**无仿真**，秒出）
// ══════════════════════════════════════════════════════════
function tables() {
  const n = DARK_MATTER;
  console.log("=".repeat(92));
  console.log("暗物质 / 第二台相变仪 —— 参数表（`--calibrate` 跑真引擎标定）");
  console.log("=".repeat(92));
  console.log(`当前参数：costBase=${n.costBase} costMult=${n.costMult}｜speedExp=${n.speedExp} speedNExp=${n.speedNExp}`
    + `｜effectCoeff=${n.effectCoeff} effectNExp=${n.effectNExp}｜v2Ref=${n.v2Ref}\n`);

  console.log("── 价格阶梯（EP）──");
  console.log("  " + pad("个数 n", 10) + pad("单价", 14) + pad("累计总价", 16) + "序列");
  let sum = 0;
  for (let k = 0; k < 10; k++) {
    const p = darkMatterPriceAt(k);
    sum += p.toNumber();
    console.log("  " + pad(k, 10) + pad(num(p), 14) + pad(num(sum), 16) + (k < 6 ? "" : "…"));
  }
  console.log("  序列：" + [0, 1, 2, 3, 4, 5].map((k) => num(darkMatterPriceAt(k))).join(" / ") + " …");

  console.log("\n── ④ 目标 T = 1 + " + n.effectCoeff + "·max(0, (log10(1+余额))^n^" + n.effectNExp + " − 1) ──");
  const deList = [10, 50, 100, 167, 250, 360];
  console.log("  " + pad("个数 n", 10) + deList.map((d) => pad("DE=1e" + d, 12)).join(""));
  for (const k of [1, 10, 100, 122, 1000, 1e4, 1e6]) {
    console.log("  " + pad(num(k), 10) + deList.map((d) => pad(f(darkMatterTargetMult(mk({ eternities: 4, n: k, deLog: d })), 2), 12)).join(""));
  }

  console.log("\n── v2 = v1^" + n.speedExp + " × n^" + n.speedNExp + "，效率 = min(1, v2/" + n.v2Ref + ") ──");
  console.log("  " + pad("log10 v1", 10) + [1, 10, 122, 1000].map((k) => pad("n=" + k, 12)).join(""));
  for (const lg of [0, 20, 50, 100, 167, 250]) {
    console.log("  " + pad(lg, 10) + [1, 10, 122, 1000].map((k) => {
      const v2 = secondTransmuterSpeed(mk({ eternities: 4, n: k, v1Log: lg }));
      return pad(f(v2, 2) + " (" + f(Math.min(1, v2 / n.v2Ref) * 100, 0) + "%)", 12);
    }).join(""));
  }
  console.log("  （括号 = 效率；效率封顶 1 ⇒ 转化值 ≤ T ⇒ **有界** ✓）");

  console.log("\n── 强度：加进暗能量倍率加法区的项 vs 基线 A ──");
  const A0 = 1 + 167 * Math.log2(10) * 0.25;
  console.log(`  基线 A（DE=1e167、q=0）= ${f(A0, 1)}｜目标 Δ = 项/A ∈ [0.1, 0.5]`);
  console.log("  " + pad("v2 饱和时的 T", 16) + pad("项 = T−1", 12) + pad("Δ", 10) + "物质加速 (1+Δ)²");
  for (const k of [10, 122, 1000, 1e4, 1e6]) {
    const T = darkMatterTargetMult(mk({ eternities: 4, n: k, deLog: 167 }));
    const d = (T - 1) / A0;
    console.log("  " + pad(f(T, 3), 16) + pad(f(T - 1, 3), 12) + pad(f(d, 4), 10) + "×" + f((1 + d) * (1 + d), 3));
  }
  console.log("\n  用法：`--check` 跑断言；`--calibrate` 用真引擎标定 v2Ref 与效果。");
  console.log("=".repeat(92));
}

if (process.argv.includes("--timeline")) timelineMain();
else if (process.argv.includes("--hang")) hangMain();
else if (calibrate) calibrateMain();
else tables();
