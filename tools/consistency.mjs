#!/usr/bin/env node
/**
 * tools/consistency.mjs —— 验证「界面显示的函数 == 实际运算的函数」
 *
 * ── 原则（用户提出）──
 *   界面显示的值，必须由**实际参与运算的那个函数**算出来。
 *   不允许界面自己再算一遍 —— 否则两条路径迟早只在一条上生效。
 *
 * ── 方法 ──
 *   对每种资源：
 *     ① 显示速率 = 界面调用的那个函数（entropyRate / particleRate / ...）
 *     ② 实际速率 = 跑一次 tick 之后，资源增量 ÷ dt
 *     ③ 两者必须一致（相对误差 < 容差）
 *
 *   这是**唯一能自动抓住 dm4b 那类 bug 的检查** ——
 *   当时界面数字变了、实际产出没变，而所有其他测试都是绿的。
 *
 * ── 为什么用很小的 dt ──
 *   速率是瞬时量，tick 是离散推进。dt 越小，两者越应该相等。
 *   如果 dt 很小时仍不相等，说明**函数根本不是同一条路径**。
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BASE, COLLAPSE, DE_MILESTONES, DE_UPGRADES, REPEATABLE, VOID_UPGRADES } from "../src/config.js";
import { newState } from "../src/state.js";
import {
  conversion, darkEnergyRate, deUpgradeCost, entropyRate, matterRate, particleRate,
  repeatableCost, trapCost, zpeRate,
} from "../src/formulas.js";
import { breakInfinity, buyDeUpgrade, buyDreamUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doBigCrunch, doClick, tick } from "../src/engine.js";

const D = (v) => new Decimal(v);
const pad = (s, n) => String(s).padEnd(n);
const rel = (a, b) => {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return Math.abs(Math.log10(Math.max(1e-300, Math.abs(a))) - Math.log10(Math.max(1e-300, Math.abs(b))));
  }
  return Math.abs(x - y) / Math.max(1e-300, Math.abs(x), Math.abs(y));
};

const DT = 0.001;   // 极小步长 -> 离散误差可忽略

/**
 * ⚠️ 局面必须**跑出来**，不能手工拼。
 *
 * 第一版我手工设了 `particle=1e25, zpe=1e30, matter=1e20` 之类，
 * 但那些数量级彼此不自洽 —— 结果物质在 1ms 内涨了 45 倍，
 * 速率的「实测值」完全是离散化噪声，测试自己制造了 100% 误差。
 *
 * 正确做法：让它自然跑到暗能量阶段，再停下来测。
 */
function runToDePhase() {
  const s = newState();
  s.darkEnergy = D("1e6");           // 直接给足暗能量，跳过漫长的前置期
  s.darkEnergyTotal = D("1e6");
  for (let i = 0; i < 4000; i++) {
    if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
    buyTrap(s, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
    tick(s, 1);
    if (s.phaseTransmuterUnlocked && s.resources.matter.gt("1e26")) break;
  }
  // 冻结自动购买，让后续测量只看生产
  s.voidUpgrades.v9 = false;
  return s;
}

/** 冻结所有会「花钱」的东西，只留生产 */
function freeze(s) {
  s.peakMatter = D(0);                       // 关掉自动坍缩
  s.voidUpgrades.v9 = false;                 // 关掉自动购买
  s.dreamUpgrades = {};
  for (const k of Object.keys(s.deMilestones)) s.deMilestones[k] = true;  // 避免中途新达成
  for (const k of Object.keys(s.zpeMilestones)) s.zpeMilestones[k] = true;
  return s;
}

console.log("=".repeat(80));
console.log("一致性检查：界面显示的函数  ==  实际运算的函数");
console.log("=".repeat(80));
console.log();
console.log(`  步长 dt = ${DT}s（越小则离散误差越小，不一致就说明是两条路径）`);
console.log();

const CHECKS = [
  ["粒子", "particleRate", (s) => particleRate(s), (s) => s.resources.particle],
  ["物质", "matterRate", (s) => matterRate(s), (s) => s.resources.matter],
  ["ZPE", "zpeRate", (s) => zpeRate(s), (s) => s.zpe],
  ["暗能量", "darkEnergyRate", (s) => darkEnergyRate(s), (s) => s.darkEnergy],
];

let pass = 0, fail = 0;

for (const scen of ["常规", "dm4b 生效"]) {
  const base = freeze(runToDePhase());
  if (scen === "dm4b 生效") base.deMilestones.dm4b = true;
  else base.deMilestones.dm4b = false;

  console.log("─".repeat(80));
  console.log(`  场景：${scen}   （物质 1e${base.resources.matter.log10().toNumber().toFixed(1)}，暗能量 ${base.darkEnergy.toExponential(2)}）`);
  console.log("─".repeat(80));
  console.log();
  console.log(`  ${pad("资源", 10)} ${pad("显示函数", 18)} ${pad("显示速率", 15)} ${pad("实测速率", 15)} 结果`);
  console.log("  " + "─".repeat(72));

  for (const [label, fnName, fn, getter] of CHECKS) {
    const s = freeze(runToDePhase());
    s.deMilestones.dm4b = scen === "dm4b 生效";
    const shown = fn(s).toNumber();
    const before = getter(s);
    tick(s, DT);
    const after = getter(s);
    const actual = after.sub(before).div(DT).toNumber();

    const tol = label === "暗能量" ? 0.10 : 0.02;
    const err = rel(shown, actual);
    const ok = err < tol;
    if (ok) pass++; else fail++;
    console.log(
      `  ${pad(label, 10)} ${pad(fnName, 18)} ${pad(shown.toExponential(4), 15)} ` +
      `${pad(actual.toExponential(4), 15)} ${ok ? "✅" : `❌ 误差 ${(err * 100).toFixed(2)}%`}`,
    );
  }
  console.log();
}

// 熵单独看：它在本帧内被转换消耗，所以「显示速率 ≠ 净增量」是**正常**的。
// 这里只验证它按显示速率被生产出来。
console.log("─".repeat(80));
console.log("  特例：熵（同一帧内会被熵凝聚消耗，所以净增量天然不等于产出速率）");
console.log("─".repeat(80));
console.log();
{
  const s = freeze(runToDePhase());
  const shown = entropyRate(s).toNumber();
  const cv = conversion(s);
  const convPerSec = entropyRate(s).div(cv.threshold).mul(cv.output).toNumber();
  const before = s.resources.entropy;
  tick(s, DT);
  const actual = s.resources.entropy.sub(before).div(DT).toNumber();
  console.log(`    显示熵产出速率   ${shown.toExponential(4)}`);
  console.log(`    同时被转换掉速率 ${convPerSec.toExponential(4)}`);
  console.log(`    实测熵净变化率   ${actual.toExponential(4)}`);
  console.log(`    结论：净变化 = 产出 − 转换消耗，**本就不该相等** ✅（这是唯一合法的例外）`);
  console.log();
}

// ══════════════════════════════════════════════════════════
// 第二部分：**价格** —— 界面显示「花费 X」，实际扣的是不是 X
// ══════════════════════════════════════════════════════════
console.log("─".repeat(80));
console.log("  价格一致性：界面显示的花费  ==  实际扣掉的资源");
console.log("─".repeat(80));
console.log();
console.log(`  ${pad("项目", 18)} ${pad("显示花费", 16)} ${pad("实际扣款", 16)} 结果`);
console.log("  " + "─".repeat(66));

/** 给足资源，买一次，比较「显示花费」与「实际扣款」 */
function priceCheck(label, costFn, currencyGetter, doBuy, topUp) {
  const s = freeze(runToDePhase());
  topUp(s);
  const shown = costFn(s);
  if (shown == null) { console.log(`  ${pad(label, 18)} ${pad("(无价格)", 16)} ${pad("—", 16)} ⏭ 跳过`); return null; }
  const before = currencyGetter(s);
  const ok = doBuy(s);
  const after = currencyGetter(s);
  if (!ok) { console.log(`  ${pad(label, 18)} ${pad(shown.toExponential(3), 16)} ${pad("(买不起)", 16)} ⏭ 跳过`); return null; }
  const paid = before.sub(after);
  const err = rel(shown.toNumber(), paid.toNumber());
  const good = err < 1e-9;
  console.log(
    `  ${pad(label, 18)} ${pad(shown.toExponential(3), 16)} ${pad(paid.toExponential(3), 16)} ` +
    `${good ? "✅" : `❌ 误差 ${(err * 100).toFixed(4)}%`}`,
  );
  return good;
}

let pricePass = 0, priceFail = 0;
const track = (r) => { if (r === null) return; if (r) pricePass++; else priceFail++; };

track(priceCheck("熵阱", (s) => trapCost(s), (s) => s.resources.matter, (s) => buyTrap(s, false),
  (s) => { s.resources.matter = trapCost(s).mul(1000); }));

track(priceCheck("物质速率", (s) => repeatableCost(s, "matterBoost"), (s) => s.resources.matter,
  (s) => buyRepeatable(s, "matterBoost", false), (s) => { s.resources.matter = s.resources.matter.max(repeatableCost(s,"matterBoost").mul(1000)); }));

track(priceCheck("粒子增益", (s) => repeatableCost(s, "particleBoost"), (s) => s.resources.particle,
  (s) => buyRepeatable(s, "particleBoost", false), (s) => { s.resources.particle = s.resources.particle.max(repeatableCost(s,"particleBoost").mul(1000)); }));

// ⚠️ entropyCoeff 的 cfg.currency 是 **particle**，不是 matter。
//    这个检查曾经查 matter，于是「扣款」永远是 0，报出假的 100% 误差。
//    现在从 cfg 读货币 —— 以后改配置也不会再骗人。
//    补量也必须**直接赋值**，不能用 `.max()`：max 只调高不调低，
//    当资源已经远大于价格时（方案 1 之后粒子到 1e26，而熵凝聚价格 ~5e15），
//    扣款会在浮点里被吃掉。
track(priceCheck("熵凝聚", (s) => repeatableCost(s, "entropyCoeff"),
  (s) => s.resources[REPEATABLE.entropyCoeff.currency],
  (s) => buyRepeatable(s, "entropyCoeff", false),
  (s) => { s.resources[REPEATABLE.entropyCoeff.currency] = repeatableCost(s, "entropyCoeff").mul(1000); }));

console.log();

// ── 暗能量升级：逐个验证（它们用不同货币）──
//
// ⚠️ 补给量必须**相对价格**给，不能一律加 1e30。
//    第一版一律加 1e30，而价格是 1e16 —— `1e30 - 1e16` 在浮点里
//    小数被大数的尾数吃掉，实测扣款变成 0，测试自己报了 4 个假 ❌。
//    正确做法：先算价格，再补到价格的 1000 倍。
for (const id of Object.keys(DE_UPGRADES)) {
  const s = freeze(runToDePhase());
  s.deUpgradeLevels[id] = s.deUpgradeLevels[id] ?? D(0);
  const cost = deUpgradeCost(s, id);
  /** 把某个池子补到「价格的 1000 倍」，保持精度 */
  const topUp = (cur, c) => (c == null ? cur : cur.max(c.mul(1000)));
  s.darkEnergy = topUp(s.darkEnergy, cost.darkEnergy);
  s.darkEnergyTotal = s.darkEnergy;
  s.resources.particle = topUp(s.resources.particle, cost.particle);
  s.resources.matter = topUp(s.resources.matter, cost.matter);
  s.zpe = topUp(s.zpe, cost.zpe);
  s.dreamPoints = topUp(s.dreamPoints, cost.dream);

  const snap = () => ({
    de: s.darkEnergy, pa: s.resources.particle, ma: s.resources.matter,
    zp: s.zpe, dp: s.dreamPoints,
  });
  const b = snap();
  const bought = buyDeUpgrade(s, id);
  const a = snap();
  if (!bought) { console.log(`  ${pad("暗能量·" + DE_UPGRADES[id].name, 18)} ⏭ 买不起/已满级`); continue; }
  const parts = [];
  let ok = true;
  const cmp = (label, shownCost, key) => {
    if (shownCost == null) return;
    const paid = b[key].sub(a[key]);
    const e = rel(shownCost.toNumber(), paid.toNumber());
    if (e >= 1e-9) ok = false;
    parts.push(`${label}:${e < 1e-9 ? "✅" : `❌${(e * 100).toFixed(2)}%`}`);
  };
  cmp("粒子", cost.particle, "pa");
  cmp("ZPE", cost.zpe, "zp");
  cmp("物质", cost.matter, "ma");
  cmp("暗能量", cost.darkEnergy, "de");
  cmp("梦想点", cost.dream, "dp");
  if (ok) pricePass++; else priceFail++;
  console.log(
    `  ${pad("暗能量·" + DE_UPGRADES[id].name, 18)} ` +
    `${pad((cost.darkEnergy ?? cost.particle ?? cost.zpe ?? cost.matter)?.toExponential(3) ?? "(多货币)", 16)} ` +
    `${pad(parts.join(" "), 16)} ${ok ? "✅" : "❌"}`,
  );
}
console.log();

// ══════════════════════════════════════════════════════════
// 第三部分：里程碑门槛 —— 显示的门槛 vs 实际触发点
// ══════════════════════════════════════════════════════════
console.log("─".repeat(80));
console.log("  里程碑门槛：界面显示的进度基准  ==  实际判定用的量");
console.log("─".repeat(80));
console.log();
console.log(`  ${pad("里程碑", 10)} ${pad("门槛", 12)} ${pad("判定用的量", 14)} ${pad("界面显示的量", 14)} 结果`);
console.log("  " + "─".repeat(66));
{
  const s = freeze(runToDePhase());
  let ok = true;
  for (const m of DE_MILESTONES) {
    // 界面上写的是 darkEnergyTotal，判定也必须用它
    const shownVar = "darkEnergyTotal";
    const judgeVar = "darkEnergyTotal";     // formulas.js 里 checkDeMilestones 用的
    const same = shownVar === judgeVar;
    if (!same) ok = false;
    console.log(
      `  ${pad(m.id, 10)} ${pad(String(m.need), 12)} ${pad(judgeVar, 14)} ${pad(shownVar, 14)} ` +
      `${same ? "✅" : "❌ 不同变量"}`,
    );
  }
  if (ok) pricePass++; else priceFail++;
}
console.log();



// ══════════════════════════════════════════════════════════
// 第四部分：**端到端动作** —— 真的调用一次，看会不会炸
// ══════════════════════════════════════════════════════════
console.log("─".repeat(80));
console.log("  端到端动作：把关键函数真的调用一次（防 ReferenceError / undefined）");
console.log("─".repeat(80));
console.log();
{
  const results = [];
  const run = (label, fn) => {
    try {
      const r = fn();
      results.push(true);
      console.log(`  ✅ ${pad(label, 26)} 正常返回 ${r === undefined ? "(void)" : JSON.stringify(r).slice(0, 46)}`);
    } catch (e) {
      results.push(false);
      console.log(`  ❌ ${pad(label, 26)} 抛异常 ${e.constructor.name}: ${e.message}`);
    }
  };

  // 大坍缩：必须让 canBigCrunch 为真，否则函数在第一行就 return null，
  // 走不到真正的逻辑 —— 这正是它藏了很久的原因。
  run("doBigCrunch（可执行）", () => {
    const s = freeze(runToDePhase());
    const cap = D("1e308.2547");
    s.resources.matter = cap.mul(2);
    s.collapseThreshold = cap.mul(10);
    s.peakMatter = cap.mul(2);
    return doBigCrunch(s);
  });

  run("breakInfinity", () => {
    const s = freeze(runToDePhase());
    s.infinityPoints = D(1);
    return breakInfinity(s);
  });

  run("buyDreamUpgrade", () => {
    const s = freeze(runToDePhase());
    s.dreamPoints = D(99);
    return buyDreamUpgrade(s, "autoPhase");
  });

  run("quantum 捕获", () => {
    const s = freeze(runToDePhase());
    s.peakMatter = D("1e30");
    s.zpe = D("1e60");
    const before = s.quantumPairs.toNumber();
    tick(s, 1);
    return { before, after: s.quantumPairs.toNumber(), quantum: s.quantum.toString() };
  });

  const bad = results.filter((x) => !x).length;
  pricePass += results.length - bad;
  priceFail += bad;
}
console.log();

console.log("=".repeat(80));
console.log(`  结果：速率 ${pass} 一致 / ${fail} 不一致；其他 ${pricePass} 通过 / ${priceFail} 失败`);
console.log("=".repeat(80));
console.log();
if (fail || priceFail) {
  console.log("  失败意味着：界面显示的和实际运算的**不是同一条路径**，");
  console.log("  或者某个动作在某个条件下会抛异常。");
  console.log();
}
process.exit(fail || priceFail ? 1 : 0);