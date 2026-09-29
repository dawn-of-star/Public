/**
 * tools/infinity-sim.mjs —— ∞ 层（无限升级）的无头仿真与定点自检
 *
 * 为什么单独一个脚本：
 *   这一层的收入结构和大坍缩深度**解耦**了（④ 无限长河按耗时给点），
 *   而 tools/headless.mjs 那套"贪心买满"的策略不碰 ∞ 层，看不出节奏对不对。
 *   所以这里模拟一个**会玩的玩家**：攒点 → 买 ②③④ → 攒 128 点打破无限 → 买 ①，
 *   并把关键结论（每次无限的点数、每小时的点数、攒到 128 的时间）打出来。
 *
 * 用法：
 *   node tools/infinity-sim.mjs            默认 12 小时
 *   node tools/infinity-sim.mjs --hours=48
 *   node tools/infinity-sim.mjs --check    只跑定点自检（秒级）
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BREAK_INFINITY, CLIMB, INFINITY_ORDER, INFINITY_UPGRADES, OVERLOAD, REPEATABLE, VOID_UPGRADES, DE_UPGRADES, DREAM_UPGRADES, crunchThreshold, infinityRateMult, infinityUpgradeOwned, overloadThreshold, quantumGrowthRate } from "../src/config.js";
import { newState, serialize, deserialize } from "../src/state.js";
import {
  advance, breakInfinity, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade, buyRepeatable,
  buyTrap, buyVoidUpgrade, doBigCrunch, doClick,
} from "../src/engine.js";
import { darkEnergyRate, matterRate, climbFactor, overloadFactor, zpeMultiplier, zpeRate } from "../src/formulas.js";
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : d;
};
const pad = (v, n) => String(v).padEnd(n);
const f = (d, p = 2) => (d instanceof Decimal ? d.toExponential(p) : Number(d).toExponential(p));

let fails = 0;
const check = (label, cond, detail = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "✅" : "❌"} ${pad(label, 40)} ${detail}`);
};

console.log("=".repeat(84));
console.log("∞ 层定点自检");
console.log("=".repeat(84));
console.log();

// ── ① 打破无限的价格必须是 128 ──
check("打破无限 = 128 无限点", BREAK_INFINITY.unlockCost === 128, `unlockCost = ${BREAK_INFINITY.unlockCost}`);

// ── ② ④ 的速率：每 60 秒 1 点（基础 60 点/小时），单次最多计 30 分钟 ──
const ipTimeCfg = INFINITY_UPGRADES.ipTime;
check("④ 每点 = 60 秒", ipTimeCfg.secondsPerPoint === 60, `secondsPerPoint = ${ipTimeCfg.secondsPerPoint}`);
check("④ 单次上限 = 30 分钟", ipTimeCfg.capSeconds === 1800, `capSeconds = ${ipTimeCfg.capSeconds}`);

{
  // 一次"104 分钟的无限"应该给 **30** 点（撞上限；没上限时才是 104）
  const s = newState();
  s.ipTimeBought = true;
  s.infinityPoints = new Decimal(0);
  s.resources.matter = crunchThreshold();      // 单数据源，别手写 pow 精度
  s.peakMatter = new Decimal("1e30");
  s.brokenInfinity = true;
  s.infinityElapsed = 104 * 60;
  const r = doBigCrunch(s);
  const expect = ipTimeCfg.capSeconds / ipTimeCfg.secondsPerPoint;      // 30
  check("④ 104 分钟的无限 → 30 点（撞 30 分钟上限）", r && r.timeIP.eq(expect), `timeIP = ${r ? r.timeIP.toString() : "—"}`);
  check("大坍缩后计时器归零", s.infinityElapsed === 0, `infinityElapsed = ${s.infinityElapsed}`);

  // 上限以下按实际耗时给（10 分钟 → 10 点）
  const u = newState();
  u.ipTimeBought = true;
  u.infinityPoints = new Decimal(0);
  u.resources.matter = crunchThreshold();
  u.peakMatter = new Decimal("1e30");
  u.brokenInfinity = true;
  u.infinityElapsed = 10 * 60;
  const r2 = doBigCrunch(u);
  check("④ 10 分钟的无限 → 10 点（未撞上限）", r2 && r2.timeIP.eq(10), `timeIP = ${r2 ? r2.timeIP.toString() : "—"}`);
}

{
  // 买下 ① 之后，④ 的收益要跟着乘 ① 的倍率
  const s = newState();
  s.ipTimeBought = true;
  s.ipDoubleLevel = new Decimal(3);           // ×3^3 = ×27
  s.infinityPoints = new Decimal(0);
  s.resources.matter = crunchThreshold();     // ★ 必须用阈值本身，别用 pow(10, 308.2547)（精度差一点就触发不了）
  s.peakMatter = new Decimal("1e30");
  s.brokenInfinity = true;
  s.infinityElapsed = 600;                    // 10 分钟 → 基础 10 点
  const r = doBigCrunch(s);
  const expect = new Decimal(600 / 60).mul(Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, 3)); // 10×27 = 270
  check("④ 吃 ① 的加成（×27）", r && r.timeIP.sub(expect).abs().lt(1e-6),
    `timeIP = ${r ? r.timeIP.toString() : "—"}（期望 ${expect.toString()}）`);
  check("大坍缩后计时器归零", s.infinityElapsed === 0, `infinityElapsed = ${s.infinityElapsed}`);
}

// ── ③ ②③ 的效果真的进公式 ──
{
  const s = newState();
  s.zpe = new Decimal(1e30);
  const before = zpeMultiplier(s);
  s.ipToZpeBought = true;
  s.infinityPoints = new Decimal(50);
  const after = zpeMultiplier(s);
  check("② ZPE 倍率 += 无限点（加法区）", after.sub(before).eq(50), `${before.toFixed(2)} → ${after.toFixed(2)}（+${after.sub(before).toFixed(2)}）`);

  const z0 = zpeRate(s);
  s.ipToTransmuterBought = true;
  // ③ 只改暗能量速率，不改 ZPE 速率
  check("③ 只作用于相变仪", zpeRate(s).eq(z0), `zpeRate 不变 = ${z0.toExponential(2)}`);
}

// ── ④ 存档往返 ──
{
  const s = newState();
  s.ipDoubleLevel = new Decimal(7);
  s.ipToZpeBought = true;
  s.ipToTransmuterBought = true;
  s.ipTimeBought = true;
  s.infinityElapsed = 1234.5;
  const { state: back } = deserialize(serialize(s));
  check("∞ 层字段存档往返", back.ipDoubleLevel.eq(7) && back.ipToZpeBought && back.ipToTransmuterBought
    && back.ipTimeBought && back.infinityElapsed === 1234.5,
  `lv=${back.ipDoubleLevel} elapsed=${back.infinityElapsed}`);
}

// ── ⑤ 过载软上限 ──
{
  const s = newState();
  s.brokenInfinity = true;
  s.quantum = new Decimal(100);
  const t = overloadThreshold(s);
  check("过载拐点 = 308.2547 + log10(1.01)×量子",
    Math.abs(t.toNumber() - (BREAK_INFINITY.maxLog10 + 100 * OVERLOAD.quantumDelayPerQuantum)) < 1e-9,
    `拐点 = ${t.toNumber().toFixed(4)} 阶（量子 100）`);

  const at = (orders) => {
    const x = newState();
    x.brokenInfinity = true;
    x.quantum = new Decimal(100);
    x.resources.matter = Decimal.pow(10, t.add(orders));
    return overloadFactor(x).toNumber();
  };
  check("拐点处因子 = 1", at(0) === 1, `×${at(0)}`);
  check("超 10 阶 → 减半", Math.abs(at(10) - 0.5) < 1e-9, `×${at(10)}`);
  check("超 20 阶 → 1/4", Math.abs(at(20) - 0.25) < 1e-9, `×${at(20)}`);

  // 未打破无限时走硬顶，不受过载影响
  const y = newState();
  y.brokenInfinity = false;
  y.resources.matter = Decimal.pow(10, 400);
  check("未打破不受过载影响", overloadFactor(y).eq(1), `×${overloadFactor(y)}`);

  // ★ display == 实际：matterRate 必须和 tick 的增量一致（含过载）
  const z = newState();
  z.brokenInfinity = true;
  z.phaseTransmuterUnlocked = true;
  z.quantum = new Decimal(20);
  z.resources.traps = new Decimal(800);
  z.resources.particle = new Decimal("1e20");
  z.resources.matter = Decimal.pow(10, overloadThreshold(z).add(15));   // 故意落进过载区
  z.levels.particleBoost = new Decimal(200);
  const before = z.resources.matter;
  const shown = matterRate(z);
  const ovNow = overloadFactor(z);
  advance(z, 0.001);
  const measured = z.resources.matter.sub(before).div(0.001);
  const rel = shown.sub(measured).abs().div(measured.abs().max(1e-300)).toNumber();
  check("过载下 matterRate == tick 实际", rel < 0.01 && ovNow.lt(1),
    `显示 ${shown.toExponential(3)} vs 实测 ${measured.toExponential(3)}（误差 ${(rel * 100).toFixed(3)}%，因子 ×${ovNow.toFixed(3)}）`);
}

// ── ⑥ 新增的 8 条（起点跃迁 / 速率解放）+ ①×3 ──
{
  const s = newState();
  check("① 效果 = ×3（价款 ×10 不变）", INFINITY_UPGRADES.ipDouble.effectMult === 3 && INFINITY_UPGRADES.ipDouble.costMult === 10,
    `effectMult=${INFINITY_UPGRADES.ipDouble.effectMult} costMult=${INFINITY_UPGRADES.ipDouble.costMult}`);

  // 起点跃迁：买 IV 后，大坍缩要把物质起点抬到 1e200
  const t = newState();
  t.peakMatter = new Decimal("1e30");
  t.brokenInfinity = true;
  t.infinityPoints = new Decimal(1e6);
  const costs = ["start50", "start100", "start150", "start200"].map((id) => buyInfinityUpgrade(t, id).ok);
  t.resources.matter = crunchThreshold();     // ★ 单数据源，别手写 pow(10, 308.2547)
  doBigCrunch(t);
  const startLog = t.resources.matter.gt(0) ? t.resources.matter.log10().toNumber() : 0;
  check("起点跃迁 IV → 大坍缩后从 1e200 开局", costs.every(Boolean) && Math.abs(startLog - 200) < 1e-6,
    `四项买入=${costs.join(",")}  开局 1e${startLog.toFixed(2)}`);

  // 速率解放：四项相乘 = 1.10×1.10×1.15×1.20 = 1.6698，并且真的进了 R
  const r = newState();
  r.infinityPoints = new Decimal(1e6);
  for (const id of ["rate110", "rate121", "rate139", "rate167"]) buyInfinityUpgrade(r, id);
  const mult = infinityRateMult(r);
  const expect = 1.10 * 1.10 * 1.15 * 1.20;
  const q = new Decimal(100);
  const boosted = quantumGrowthRate(q, mult).toNumber();
  const plain = quantumGrowthRate(q).toNumber();
  check("速率解放四项合计 ×1.6698 且进 R", Math.abs(mult.toNumber() - expect) < 1e-9 &&
    Math.abs(boosted / plain - expect) < 1e-9,
  `×${mult.toNumber().toFixed(4)}（期望 ${expect.toFixed(4)}）  R ${plain.toFixed(5)} → ${boosted.toFixed(5)}`);

  // ④ 的耗时上限：30 分钟（给"速度"一个靶子）
  check("④ 单次计入上限 = 1800 秒", INFINITY_UPGRADES.ipTime.capSeconds === 1800,
    `capSeconds=${INFINITY_UPGRADES.ipTime.capSeconds}`);
}

// ── ⑦ 爬升形状（路线 1）：从直线变 log 形 ──
{
  const at = (L) => {
    const s = newState();
    s.resources.matter = Decimal.pow(10, L);
    return climbFactor(s).toNumber();
  };
  check("拐点处因子 = 1", at(CLIMB.knee) === 1, `×${at(CLIMB.knee)}（knee = ${CLIMB.knee}）`);
  check("拐点以下恒为 1", at(0) === 1 && at(CLIMB.knee - 0.001) === 1, `×${at(5)} / ×${at(CLIMB.knee - 0.001)}`);
  check(`超 ${CLIMB.halvingOrders} 阶 → 减半`, Math.abs(at(CLIMB.knee + CLIMB.halvingOrders) - 0.5) < 1e-9,
    `×${at(CLIMB.knee + CLIMB.halvingOrders)}`);
  check(`超 ${2 * CLIMB.halvingOrders} 阶 → 1/4`, Math.abs(at(CLIMB.knee + 2 * CLIMB.halvingOrders) - 0.25) < 1e-9,
    `×${at(CLIMB.knee + 2 * CLIMB.halvingOrders)}`);

  // ★ 显示 == 实际：未打破（过载因子为 1）时，matterRate 必须和 tick 的增量一致（含爬升因子）
  const s = newState();
  s.phaseTransmuterUnlocked = true;
  s.quantum = new Decimal(10);
  s.resources.traps = new Decimal(800);
  s.resources.particle = new Decimal("1e20");
  s.levels.particleBoost = new Decimal(200);
  s.resources.matter = Decimal.pow(10, 200);          // 落在爬升衰减区（因子 ≈ 0.3）
  const before = s.resources.matter;
  const shown = matterRate(s);
  const cf = climbFactor(s);
  advance(s, 0.001);
  const measured = s.resources.matter.sub(before).div(0.001);
  const rel = shown.sub(measured).abs().div(measured.abs().max(1e-300)).toNumber();
  check("爬升衰减下 matterRate == tick 实际", rel < 0.01 && cf.lt(1),
    `显示 ${shown.toExponential(3)} vs 实测 ${measured.toExponential(3)}（误差 ${(rel * 100).toFixed(3)}%，因子 ×${cf.toFixed(3)}）`);
}

if (process.argv.includes("--check")) {
  console.log();
  console.log(`结果：${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

// ══════════════════════════════════════════════════════════
// 模拟：会玩的玩家
// ══════════════════════════════════════════════════════════
const HOURS = arg("hours", 12);
const DT = 0.5;
const s = newState();
for (let i = 0; i < 10; i++) doClick(s);       // ★ 开局先点 10 次

let t = 0;
let nextLog = 0;
const firstBreakAt = { v: null };
const ipHistory = [];
let lastIP = new Decimal(0);

console.log();
console.log(`模拟：${HOURS} 小时（每 ${DT} 秒一步，贪心购买 + 攒点买 ∞ 升级）`);
console.log();
console.log(`${pad("时刻", 8)} ${pad("物质", 11)} ${pad("无限点", 11)} ${pad("∞升级", 16)} ${pad("本次耗时", 10)} ${pad("坍缩", 5)} ${pad("打破无限", 9)}`);
console.log("-".repeat(84));

while (t < HOURS * 3600) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
  for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);

  // ∞ 层：先打破无限（否则 1 点会被 ②③ 抢走），再按价格从低到高买一次性升级，最后买 ①
  if (!s.brokenInfinity && s.infinityPoints.gte(BREAK_INFINITY.unlockCost)) {
    if (breakInfinity(s) && firstBreakAt.v === null) firstBreakAt.v = t;
  }
  const singles = INFINITY_ORDER
    .filter((id) => !INFINITY_UPGRADES[id].repeatable)
    .sort((a, b) => (INFINITY_UPGRADES[a].cost ?? 0) - (INFINITY_UPGRADES[b].cost ?? 0));
  for (const id of singles) buyInfinityUpgrade(s, id);
  for (let i = 0; i < 20 && buyInfinityUpgrade(s, "ipDouble").ok; i++) { /* ① */ }

  // 打破无限之后没有强制坍缩了 —— 这里给一个简单策略：过载压到 5% 就收
  if (s.brokenInfinity && s.resources.matter.gt(0) && overloadFactor(s).lt(0.05)) doBigCrunch(s);

  advance(s, DT);
  t += DT;

  if (t >= nextLog) {
    const owned = INFINITY_ORDER.filter((id) => infinityUpgradeOwned(s, id)).map((id) => {
      const cfg = INFINITY_UPGRADES[id];
      return cfg.repeatable ? `①Lv${s.ipDoubleLevel.toNumber()}` : cfg.name;
    });
    console.log(
      `${pad((t / 3600).toFixed(1) + "h", 8)} ${pad(f(s.resources.matter, 2), 11)} ${pad(f(s.infinityPoints, 2), 11)} ` +
      `${pad(owned.join(" ") || "—", 16)} ${pad(fmtTime(s.infinityElapsed ?? 0), 10)} ${pad(s.bigCrunchCount.toNumber(), 5)} ` +
      `${pad(s.brokenInfinity ? "已打破" : "未打破", 9)}`,
    );
    nextLog = t + 1800;
  }
  ipHistory.push({ t, ip: s.infinityPoints });
  lastIP = s.infinityPoints;
}

function fmtTime(sec) {
  const x = Math.max(0, Math.floor(sec));
  if (x < 3600) return `${Math.floor(x / 60)}m${x % 60}s`;
  return `${Math.floor(x / 3600)}h${Math.floor((x % 3600) / 60)}m`;
}

console.log();
console.log("=".repeat(84));
console.log("结果");
console.log("=".repeat(84));
console.log();
console.log(`  模拟时长        ${HOURS} 小时`);
console.log(`  大坍缩次数      ${s.bigCrunchCount.toString()}   平均 ${(HOURS * 60 / Math.max(1, s.bigCrunchCount.toNumber())).toFixed(1)} 分钟/次`);
console.log(`  终局无限点      ${f(s.infinityPoints)}`);
console.log(`  ① 等级          ${s.ipDoubleLevel.toString()}（收益 ×${Decimal.pow(INFINITY_UPGRADES.ipDouble.effectMult, s.ipDoubleLevel).toString()}）`);
console.log(`  ∞ 升级          ${INFINITY_ORDER.map((id) => {
    const cfg = INFINITY_UPGRADES[id];
    if (cfg.repeatable) return `①Lv${s.ipDoubleLevel.toNumber()}`;
    return `${cfg.name}${infinityUpgradeOwned(s, id) ? "✓" : "✗"}`;
  }).join(" ")}`);
console.log(`  打破无限        ${firstBreakAt.v === null ? "未达成 ❌" : `第 ${(firstBreakAt.v / 3600).toFixed(1)} 小时达成（${s.bigCrunchCount.toNumber()} 次坍缩前后）`}`);
console.log(`  终局 ZPE 倍率   ${f(zpeMultiplier(s))}`);
console.log(`  终局速率        ZPE ${f(zpeRate(s))}/s   暗能量 ${f(darkEnergyRate(s))}/s`);
console.log();
console.log(`  定点自检        ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
process.exit(fails ? 1 : 0);
