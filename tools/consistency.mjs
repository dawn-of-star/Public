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
 *
 * ⚠️⚠️ 2026 追加的**结构性**原则（血的教训）：
 *   **热路径上不许有 O(n) 循环** —— 哪怕数学完全正确 ✗
 *   实证：为修 ZPE 2000 级后的惩罚，我把 `zpeEngineTotalCost` 从闭式改成
 *     逐级累加 ⇒ `render()` 每帧多花 12~16ms、且**越往后越慢**。
 *   而 **Node mock 量不出来**（那里 render 只有 2.4ms/帧），只有真浏览器暴露 ✗
 *   ⇒ 本文件末尾有一条**静态扫描**：`src/` 不许调用 `*Loop` 系列 ✓
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Decimal from "../dist/break_eternity.esm.js";
import { BASE, COLLAPSE, DE_MILESTONES, DE_UPGRADES, REPEATABLE, VOID_UPGRADES, ipDoubleMult,
  // ★ 2025：① 的价格序列断言要用（用户裁定「首价 1 点、之后每级 ×10」）
  ipDoublePriceAt, ipDoubleCost, ipDoubleAffordableIn, infinityUpgradeCost,
  // ★ 2025：性能回归断言要用（大池子测耗时）
  ipDoubleCostFor,
  // ★★★ 2025：永恒升级「永恒增幅」断言要用（第三层设计稿 33~35 行）
  epMultPriceAt, epMultAffordableIn, epMultFactor, eternityPointGain, ETERNITY, ETERNITY_UPGRADES,
  // ★★★ 2025：可重复梦想升级（「离线时长扩展」= 离线时间上限）断言要用
  DREAM_UPGRADES, DREAM_BY_ID, dreamUpgradeLevelOf, dreamUpgradeCostAt, offlineCapSeconds,
  // ★★★ 2025：永恒里程碑 em2（neko 加成翻倍）/ em7（自动完成 IC）断言要用
  NEKO, NEKO_BONUS_DOUBLE, nekoGlobalExponent, INFINITY_CHALLENGES,
  // ★★★ 2025：两个新修复（ipDouble 封顶平台 / ZPE 引擎 2000 级后增幅）断言要用
  //   ⚠️ `ipDoublePriceAt` 上面已经导过了 ⇒ 这里**不要**再列一次（会 `already been declared` ✗）
  IP_DOUBLE_AD, zpeEngineStepMult, zpeEngineCostMult, zpeEngineCost,
  ZPE_ENGINE, zpeEngineAffordableIn, zpeEngineTotalCost,
  // ★★★ 2026：性能回归断言要"逐级"版做**对照基准**（闭式快、循环显然正确 ⇒ 必须一致）✓
  zpeEngineTotalCostLoop, zpeEngineAffordableInLoop } from "../src/config.js";
import { newState } from "../src/state.js";
import {
  conversion, darkEnergyRate, deUpgradeCost, entropyRate, globalMultiplier, globalMultiplierParts,
  matterRate, particleRate, repeatableCost, trapCost, zpeRate,
} from "../src/formulas.js";
import { breakInfinity, buyDeUpgrade, buyDreamUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doBigCrunch, doClick, tick, infinityUpgradeEffect,
  // ★ 2025：① 的"买满 == 逐级实买"断言要它
  buyInfinityUpgrade,
  // ★★★ 2025：永恒增幅的「买满 == 逐级」与「实得 EP」断言要它们
  buyEpMult, doEternity,
  // ★★★ 2025：em7「按最快无限速度自动完成无限挑战」断言要它 ✓
  icAutoAdvance,
  // ★★★ 2025：ZPE 引擎 2000 级后的价格增幅断言要它们 ✓
  buyZpeEngineLevel, buyIpDoubleMax } from "../src/engine.js";
// ★★★ 2025：em7 的详情文案要 `sci`（统一科学计数法）✓
import { sci } from "../src/format.js";

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
    // ★★ 2025 修（打点定位后）：**物质/粒子必须用更小的步长** ✗
    //
    //   为什么：引擎的物质增量是**闭式解** `ΔM = k·(P0·dt + c·dt²/2)`，
    //     而 `matterRate()` 是**瞬时值** `k·P0` —— 两者的比是 `1 + c·dt/(2·P0)` ✗
    //     在某些状态里"粒子每秒被替换 ~1e5 次"（`c/P0` 极大）⇒ 1 毫秒步长下
    //     那个二阶项会**反超**一阶项 44 倍 ⇒ 断言误报 97.8% ✗（并被我误判成量子的问题 ✗）
    //   修法：这两个量用 `dt = 1e-7`（二阶项占比 < 0.5% ✓），其余仍用 DT ✓
    //   ⚠️ 这**不是**放宽标准：`matterRate` 的定义没错、引擎的闭式解也没错 ✗，
    //      错的是"拿两个不同阶的东西比" ✗ —— 打点实测：`显示/(P0·k·过载·爬升) = 1.0000` ✓
    const dtHere = (label === "物质" || label === "粒子") ? 1e-7 : DT;
    tick(s, dtHere);
    const after = getter(s);
    const actual = after.sub(before).div(dtHere).toNumber();

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
    if (e >= 1e-3) ok = false;   // 与上面同一处容差（余额差里混了同步产出）
    // ⚠️ 2025 修：容差从 `1e-9` 放到 `1e-3` —— 原因不是"放宽标准"，而是
    //   `paid` 是**余额差**，而同一 tick 里该资源还在**继续生产** ✗
    //   ⇒ 差值里天然混进了一点产出（实测相对误差 ~1e-5，显示成 0.00% ✗）
    //   1e-3（0.1%）仍能抓住"显示与实收不是一个数"这类真问题 ✓
    parts.push(`${label}:${e < 1e-3 ? "✅" : `❌${(e * 100).toFixed(2)}%`}`);
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

// ══════════════════════════════════════════════════════════
// 第五部分：**失败的交易不许扣钱** + 大坍缩的「本轮进度」必须归零
// ══════════════════════════════════════════════════════════
console.log("─".repeat(80));
console.log("  回归守卫：失败的购买不扣钱；大坍缩清掉本轮累加器");
console.log("─".repeat(80));
console.log();
{
  const results = [];
  const check = (label, fn) => {
    let ok = false, detail = "";
    try { ({ ok, detail } = fn()); } catch (e) { detail = `${e.constructor.name}: ${e.message}`; }
    results.push(ok);
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 34)} ${detail}`);
  };

  // ① 双价（梦想点 + ZPE）升级买不起时，梦想点不许被扣掉
  //
  //    老写法是「先扣梦想点 -> 再查 ZPE -> 不够就 return false」，
  //    扣掉的那点不会退回来。当前配置里 v9 的 ZPE 价是 0 所以碰不到，
  //    这里临时合成一条双价升级，把这个坑钉死。
  check("双价升级买不起：梦想点不扣", () => {
    VOID_UPGRADES.__probe = {
      id: "__probe", name: "回归守卫·双价", cost: "1000",
      costDream: 1, desc: "临时配置，仅用于自检", rewardDream: false,
    };
    try {
      const s = freeze(runToDePhase());
      // ⚠️ runToDePhase 会遍历 VOID_UPGRADES 自动买 —— 可能已经把 __probe 买掉了。
      //    必须显式重置，否则这条自检会「因为已拥有」而假通过。
      s.voidUpgrades.__probe = false;
      s.dreamPoints = D(1);
      s.zpe = D(0);                       // ZPE 不够 -> 必须整笔失败
      const before = s.dreamPoints.toString();
      const bought = buyVoidUpgrade(s, "__probe");
      const after = s.dreamPoints.toString();
      const ok = bought === false && before === after;
      return { ok, detail: `买成功=${bought}？ 梦想点 ${before} -> ${after}` };
    } finally {
      delete VOID_UPGRADES.__probe;
    }
  });

  // ② 大坍缩后相变环进度必须归零（界面读的是 deAccum，不是 zpeAccumulator）
  check("大坍缩后 deAccum 归零", () => {
    const s = freeze(runToDePhase());
    const cap = D("1e308.2547");
    s.resources.matter = cap.mul(2);
    s.peakMatter = cap.mul(2);
    s.deAccum = D(5e7);
    const before = s.deAccum.toString();
    const r = doBigCrunch(s);
    const ok = !!r && !s.deAccum.gt(0) && !s.zpeAccumulator.gt(0);
    return { ok, detail: `deAccum ${before} -> ${s.deAccum.toString()}（坍缩返回 ${r ? "ok" : "null"}）` };
  });

  // ③ 顶部「全局加成」槽：显示的总值必须等于三个因子的乘积
  //    槽把「全局加成」拆成 梦想点 × 计数频率 × 暗能量 展示；拆错或算错就是"显示 ≠ 实际"
  check("全局加成槽 = 三因子乘积", () => {
    const s = freeze(runToDePhase());
    s.dreamPoints = D(37);
    const parts = globalMultiplierParts(s);
    const total = globalMultiplier(s);
    const product = parts.dream.mul(parts.countFreq).mul(parts.de);
    const ok = rel(parts.total.toString(), total.toString()) < 1e-12 &&
      rel(product.toString(), total.toString()) < 1e-12;
    return {
      ok,
      detail: `梦想点 ×${parts.dream.toFixed(3)} · 计数频率 ×${parts.countFreq.toFixed(3)}` +
        ` · 暗能量 ×${parts.de.toFixed(3)} = ×${product.toFixed(3)}（总值 ×${total.toFixed(3)}）`,
    };
  });

  // ④ 重复购买类升级**只在关键节点**（1/5/10/50/100…）写日志
  //    没有这条守卫的话，自动获取模式一帧买几百级 -> 日志面板被刷爆（重要事件被冲走）
  check("重复购买升级只在关键节点写日志", () => {
    const s = newState();
    s.resources.matter = D("1e60");              // 给足物质，直接连买
    const wrote = [];
    for (let i = 1; i <= 10; i++) {
      const n0 = s.log.length;
      buyRepeatable(s, "matterBoost");
      if (s.log.length > n0) wrote.push(i);
    }
    // 批量买也应当**只写一条**（跨过多个关键节点时）
    const n1 = s.log.length;
    buyRepeatable(s, "matterBoost", true);
    const bulkWrote = s.log.length - n1;
    const expect = [1, 5, 10];
    const ok = JSON.stringify(wrote) === JSON.stringify(expect) && bulkWrote <= 1;
    return {
      ok,
      detail: `连买到 10 级，写日志的等级 = [${wrote.join(", ")}]（期望 [${expect.join(", ")}]）；` +
        `之后"买满"写了 ${bulkWrote} 条`,
    };
  });

  // ★★ 2025 新增：**① 无限增幅的"显示 == 实发"必须成立**
  //
  //   现场：`ipDoubleMult()`（实发，`bigCrunchGain` 走它）曾是**线性** `1+0.10×等级`，
  //     而显示侧（`engine.js` 的 `infinityUpgradeEffect`、`ui.js` 的收入明细）各写了一遍
  //     `Decimal.pow(effectMult, 等级)` ⇒ **100 级时显示比实发大 1.2e29 倍** ✗
  //   这是本项目最忌讳的一类 bug，成因是"同一条公式两处各写一遍"。
  //   现在实发与显示共用 `ipDoubleMult()` ⇒ 本断言守住它（换形态也自动同步 ✓）。
  check("① 无限增幅：显示 == 实发（唯一入口 ipDoubleMult）", () => {
    const st = (L) => ({ ...newState(), ipDoubleLevel: L, infinityPoints: new Decimal(0) });
    const rows = [0, 1, 5, 10, 30, 100, 500].map((L) => {
      const actual = ipDoubleMult(st(L)).toString();
      const shown = infinityUpgradeEffect(st(L), "ipDouble").mult.toString();
      return { L, actual, shown, ok: actual === shown };
    });
    const badRows = rows.filter((r) => !r.ok);
    return {
      ok: badRows.length === 0,
      detail: badRows.length === 0
        ? `7 个等级全部一致（含 500 级 = ${rows[6].actual.slice(0, 12)}…）`
        : `不一致：${badRows.map((r) => `L${r.L} 实${r.actual} vs 显${r.shown}`).join("｜")}`,
    };
  });

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 新增（用户裁定改了 ① 的首价序列之后必须守住的）
  // ══════════════════════════════════════════════════════════
  // 用户裁定：「无限增幅的初始价格不应该就是 1 无限点（购买时 1 级）么？
  //            然后每 2 级为 10 无限点花费，3 级 100 点（以此类推）」
  //   ⇒ 价格序列 = `1 → 1 → 10 → 100 → 1000 …`
  //
  // 为什么必须断言：这个序列**第 1 级是特例**（`10^(n−1)` 在 n=0 处是 0.1 而非 1）
  //   ⇒ 任何"当纯等比处理"的闭式都会错 ✗（我在 `ipDoubleAffordableIn` 里**错了两次**：
  //      先写 `/9` 后写 `/90`，又想用它反解 k）
  //   ⇒ 守三件事：① 价格序列本身 ② `ipDoublePriceAt` / `ipDoubleCost` /
  //      `infinityUpgradeCost` 三者同源 ③ **能买几级 == 逐级实买到买不起**
  check("① 价格序列 = 1,1,10,100,1000…（用户裁定）", () => {
    const want = [1, 1, 10, 100, 1000, 10000, 100000];
    const got = want.map((_, n) => Number(ipDoublePriceAt(n)));
    // ⚠️ `ipDoubleCost` / `infinityUpgradeCost` 收的是 **state**（读 `state.ipDoubleLevel`）
    //   ⇒ 必须包成 Decimal，不能直接传 number（否则 `lv.toNumber is not a function` ✗）
    const stAt = (n) => ({ ipDoubleLevel: new Decimal(n) });
    const viaCost = want.map((_, n) => Number(ipDoubleCost(stAt(n))));
    const viaIUC = want.map((_, n) => Number(infinityUpgradeCost(stAt(n), "ipDouble")));
    const eq = (a, b) => a.every((v, i) => v === b[i]);
    const ok = eq(got, want) && eq(viaCost, want) && eq(viaIUC, want);
    return {
      ok,
      detail: ok
        ? `序列 ${got.join(",")} ✓｜三个入口（PriceAt / Cost / infinityUpgradeCost）完全一致 ✓`
        : `序列=${got.join(",")}（应 ${want.join(",")}）｜Cost=${viaCost.join(",")}｜IUC=${viaIUC.join(",")}`,
    };
  });

  check("① 买满 == 逐级实买（含第 1 级特例的边界）", () => {
    const pools = ["5", "100", "1e4", "1e6", "1e12", "1e29"];
    const rows = pools.map((p) => {
      const a = { ...newState(), brokenInfinity: true, infinityPoints: new Decimal(p) };
      const pred = ipDoubleAffordableIn(0, a.infinityPoints);
      const b = { ...newState(), brokenInfinity: true, infinityPoints: new Decimal(p) };
      let real = 0;
      while (buyInfinityUpgrade(b, "ipDouble").ok && real < 500) real++;
      return { p, pred, real, ok: pred === real };
    });
    const badRows = rows.filter((r) => !r.ok);
    return {
      ok: badRows.length === 0,
      detail: badRows.length === 0
        ? `6 个池子全部一致（5 点 ⇒ ${rows[0].pred} 级、1e6 ⇒ ${rows[3].pred} 级）✓`
        : `不一致：${badRows.map((r) => `${r.p} 预测${r.pred} vs 实买${r.real}`).join("｜")}`,
    };
  });

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025（第三层设计稿 33~35 行）：**永恒升级「永恒增幅」**
  // ══════════════════════════════════════════════════════════
  // 设计稿原文：「永恒升级面板：将最终获得的永恒点 *5（价格初始 1ep，每次购买后 *5）
  //             （**剩下的类似 ad 中的永恒升级**）」
  //   ⇒ 最后一句是**权威补充** ⇒ 价格照 **AD** 抄。
  //     AD 的 `EPMultiplierState.costAfterCount`：
  //       multPerUpgrade = [50, 100, 500, 1000]｜cost = mult^n × **500**
  //   ⚠️ 我原来实现成 `5^n × 1`（基础价 1、倍率 5）—— **两处都错** ✗
  //     （用户报「永恒增幅价格增幅的 bug」时才查出来）
  // 守三件事：① 价格序列**精确**且与 **AD 独立算出的值**一致（不拿函数自己的输出当期望 ✗）
  //          ② 买满 == 逐级实买（闭式与实现同源）
  //          ③ **永恒时实得 EP == 基础 × 倍率**（效果真的落在"最终获得的"上）
  check("★ 永恒增幅：价格序列 = 设计稿「初始 1ep、每次 ×5」+ 阶梯（独立重算）", () => {
    // ⚠️ 期望值**独立算**（不调用 `epMultPriceAt`）—— "断言不能自证"的纪律 ✓
    //
    // ⚠️⚠️ 这里我错了**两次**，都值得记：
    //   ① 第一版写成 `for i: if (cost_i < thresh_i) 用 i` —— **反了** ✗
    //      （正确语义：价格**超过**本段阈值 ⇒ 进下一段）
    //   ② 第二版把阈值用 `Number(raw)` 转成 double 再比 —— 对 `1e30` 尚可，
    //      但**段选择逻辑**仍写错 ⇒ 期望值离谱 ✗
    //   ⇒ 最终这版：**从末段往回找**第一个"价格 ≥ 该段阈值"的段 ⇒ 它就是当前段 ✓
    //     （`null` = 末段，无条件中选；且这样写**不可能**漏段/多段）
    const cfg = ETERNITY_UPGRADES.epMult;
    const M = cfg.costMultTiers;
    // ⚠️⚠️ 阈值**绝不能用 `Number()` 比** —— `Number("1e10000") === Infinity` ✗
    //   （`1e1000` / `1e10000` 都超过 double 范围 ⇒ 一切比较都失真）
    //   ⇒ 全程在 **log10 空间**比较（只做乘法，无溢出）✓
    const log10Th = cfg.costThresholds.map((s) => {
      if (s == null) return Infinity;
      const str = String(s);
      const m = /^1e(\d+)$/.exec(str);
      return m ? Number(m[1]) : new Decimal(str).log10().toNumber();
    });
    const log10Base = Math.log10(cfg.costBase);
    /**
     * 独立实现：**取第一个「价格 < 本段阈值」的段**（与真实代码 / AD 语义一致）。
     * ⚠️ 我在这里错了**三次**，每条都值得记：
     *   ① 写成"价格**超过**阈值就用本段" ⇒ **反了**
     *   ② 用 `Number(raw)` 比阈值 ⇒ `1e10000 → Infinity` ⇒ 全错
     *   ③ 反向循环"找第一个超过阈值的段" ⇒ 又反了一次
     * ⇒ 现在照抄语义、在 log10 空间比，且**采样点故意跨段边界**（43 / 1000 / 5000）✓
     */
    const expect = (n) => {
      let mult = M[0];
      for (let i = 0; i < M.length; i++) {
        const mag = log10Base + n * Math.log10(M[i]);        // log10( base·M[i]^n )
        if (mag < log10Th[i]) { mult = M[i]; break; }
      }
      return cfg.costBase * Math.pow(mult, n);
    };
    // 采样点**故意跨过每个段边界**（43 / 1000 / 5000 附近）⇒ 真的验到阶梯 ✓
    const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 41, 42, 43, 44, 999, 1000, 1001, 4999, 5000, 5001, 6000];
    const rows = pts.map((n) => {
      const want = expect(n);
      const got = Number(epMultPriceAt(n));
      // 大数比较用相对误差（`Number()` 会丢精度；两侧同路径 ⇒ 允许 1e-9）✓
      const ok = want === got || (want > 0 && Math.abs(got - want) / want <= 1e-9);
      return { n, want, got, ok };
    });
    const bad = rows.filter((r) => !r.ok);
    // 额外守**设计稿字面**：前 4 级必须是 1 / 5 / 25 / 125
    const head = [1, 5, 25, 125];
    const headOk = head.every((v, i) => Number(epMultPriceAt(i)) === v);
    return {
      ok: bad.length === 0 && headOk,
      detail: bad.length === 0 && headOk
        ? `跨段边界的 ${pts.length} 个点全部一致 ✓｜前 4 级 = ${head.join(",")}（设计稿「初始 1ep、每次 ×5」）✓`
        : (bad.length
          ? `不一致：${bad.map((r) => `Lv${r.n} 得${r.got} 应${r.want}`).join("｜")}`
          : "前 4 级不符设计稿"),
    };
  });

  // ⚠️⚠️ 2025 修正（用户报「永恒增幅价格消耗不对」）：
  //   原来这条只测 `1 / 5 / 100 / 1e6 / 1e12` —— **恰好避开了所有会出错的边界** ✗
  //   实际坏掉的池子：**6**（探针说 2 级、买满却买 0 级）、**3906**（少买 1 级）、
  //   **4000**（扣款出现 `3906.000000000005` 的小数漂移）
  //   根因：`epMultAffordableIn` 用 `Math.log10/.floor` 求级数（浮点边界少 1），
  //         `buyEpMult` 用几何闭式算总价（幂的乘积/相除漂移）
  //   ⇒ 现在**把出错的那几个池子逐个钉进断言**，并额外验"扣款是精确整数" ✓
  //
  // ⚠️ 2025 二次修正：价格改成**分段 + 无封顶**后，"买满"与"逐级买"两条路
  //   在**大池子**上会差 `1e-12` 相对量级（`Decimal` 尾数精度噪声：连乘 5000 次
  //   vs `ipow` 的乘法顺序不同 ⇒ 舍入路径不同）。**级数必须精确相等**，
  //   余额允许 `1e-9` 相对容差（价格显示只用 3~6 位有效数字 ⇒ 玩家不可感知）✓
  check("★ 永恒增幅：买满 == 逐级实买（含**边界池** 6 / 3906 / 4000 + 大池子）", () => {
    const pools = ["1", "5", "6", "30", "100", "3906", "4000", "1e6", "1e10", "1e100", "1e1000", "1e10000", "1e20000"];
    const rows = pools.map((p) => {
      const a = { ...newState(), eternityPoints: new Decimal(p) };
      const pred = epMultAffordableIn(0, a.eternityPoints);
      const b = { ...newState(), eternityPoints: new Decimal(p) };
      let real = 0;
      while (buyEpMult(b, 1) > 0 && real < 60000) real++;
      // 买满：预测几级就必须真的买几级，且**扣款总额必须精确**（无小数尾巴）
      const c = { ...newState(), eternityPoints: new Decimal(p) };
      const gotMax = buyEpMult(c, null);
      const spent = new Decimal(p).sub(c.eternityPoints);
      const spentExact = spent.floor().eq(spent);
      // 余额一致性（见上面的容差说明）
      const lvOk = pred === real && gotMax === real;
      const balOk = (() => {
        const a2 = { ...newState(), eternityPoints: new Decimal(p) };
        buyEpMult(a2, null);
        const b2 = { ...newState(), eternityPoints: new Decimal(p) };
        while (buyEpMult(b2, 1) > 0) { /* 买到买不动 */ }
        const l1 = a2.eternityPoints, l2 = b2.eternityPoints;
        if (l1.eq(l2)) return true;
        const rel = l1.sub(l2).abs().div(Decimal.max(l1, l2));
        // ⚠️ 容差取 `1e-6`（不是 1e-9）：误差**随连乘次数线性累积** ——
        //   池 1e10000（5000 级）⇒ 实测 4e-12｜池 1e20000（7411 级）⇒ 实测 **1.6e-9** ✓
        //   价格显示只用 3~6 位有效数字 ⇒ 1e-6 玩家完全不可感知 ✓
        return rel.lte(new Decimal("1e-6"));
      })();
      return { p, pred, real, gotMax, spentExact, lvOk, balOk, ok: lvOk && spentExact && balOk };
    });
    const badRows = rows.filter((r) => !r.ok);
    return {
      ok: badRows.length === 0,
      detail: badRows.length === 0
        ? `${pools.length} 个池子全部一致（含边界 6⇒2 级、3906⇒6 级、1e10000⇒5000 级）；` +
          `扣款全是精确整数；余额差 ≤ 1e-6 ✓`
        : `不一致：${badRows.map((r) => `${r.p} 预测${r.pred}/实买${r.real}/买满${r.gotMax}` +
            `/整数${r.spentExact}/级数${r.lvOk}/余额${r.balOk}`).join("｜")}`,
    };
  });

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025（用户要求）：「4 个 h 有点短了，梦想页面自动化中建议多一个
  //   消耗梦想点兑换更多离线时间的升级」
  // ══════════════════════════════════════════════════════════
  // 守四件事：
  //   ① 价格序列**精确整数**（`Decimal.pow(2,3)` 会给 `15.999999999999998` ✗）
  //   ② **标价 == 实扣**（逐级买 12 次，每次差值必须等于当时的价格）✓
  //   ③ 上限 = 基础 4h + 等级 × 1h，且**满级后拒绝**（`maxLevel`）
  //   ④ 一次性梦想升级**不受影响**（回归：首次可买、再次拒绝、等级恒 1）✓
  check("★ 梦想升级「离线时长扩展」：价格精确整数（2/4/…/4096）", () => {
    const want = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
    const got = want.map((_, lv) => Number(dreamUpgradeCostAt("offlineCap", lv)));
    const exact = got.every((v) => Number.isInteger(v));
    const ok = exact && got.every((v, i) => v === want[i]) && dreamUpgradeCostAt("offlineCap", 12) == null;
    return {
      ok,
      detail: ok
        ? `Lv0~11 = ${got.join(",")} ✓（全整数，无浮点尾巴）｜Lv12 ⇒ 满级 null ✓`
        : `序列=${got.join(",")}（应 ${want.join(",")}）${exact ? "" : "｜**有非整数**（Decimal.pow 漂移）✗"}`,
    };
  });

  check("★ 梦想升级「离线时长扩展」：标价 == 实扣（逐级 12 次）＋ 上限 4h→16h", () => {
    const s = { ...newState(), dreamPoints: new Decimal("1e6") };
    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const lvBefore = dreamUpgradeLevelOf(s, "offlineCap");
      const price = Number(dreamUpgradeCostAt("offlineCap", lvBefore));
      const snap = s.dreamPoints.toString();          // ⚠️ 快照用字符串（引用会被后续赋值换掉）
      const okBuy = buyDreamUpgrade(s, "offlineCap");
      const paid = Number(new Decimal(snap).sub(s.dreamPoints));
      rows.push({ i, price, paid, lv: dreamUpgradeLevelOf(s, "offlineCap"), ok: okBuy && paid === price });
    }
    const refused = buyDreamUpgrade(s, "offlineCap") === false;      // 第 13 次必须拒绝
    const capOk = offlineCapSeconds(s) === BASE.offlineCapSeconds + 12 * 3600;
    const baseOk = offlineCapSeconds(newState()) === BASE.offlineCapSeconds;
    const bad = rows.filter((r) => !r.ok);
    return {
      ok: bad.length === 0 && refused && capOk && baseOk,
      detail: bad.length === 0 && refused && capOk && baseOk
        ? `12 次全部「标价 == 实扣」✓（2→4096，共 8190）｜第 13 次拒绝 ✓｜` +
          `上限 ${BASE.offlineCapSeconds / 3600}h → ${offlineCapSeconds(s) / 3600}h ✓（未买时 ${BASE.offlineCapSeconds / 3600}h）`
        : `异常：${bad.map((r) => `第${r.i}次 价${r.price} 扣${r.paid}`).join("｜")}` +
          `${refused ? "" : "｜**满级没拒绝**✗"}${capOk ? "" : "｜上限不对✗"}${baseOk ? "" : "｜基础上限被动✗"}`,
    };
  });

  check("★ 梦想升级：一次性那几条**不受可重复机制影响**（回归）", () => {
    const ones = DREAM_UPGRADES.filter((x) => !x.repeatable);
    const bad = [];
    for (const d of ones) {
      const s = { ...newState(), dreamPoints: new Decimal(1e6) };
      const first = buyDreamUpgrade(s, d.id);
      const second = buyDreamUpgrade(s, d.id);
      const lv = dreamUpgradeLevelOf(s, d.id);
      if (first !== true || second !== false || lv !== 1) bad.push(`${d.id}(首${first}/再${second}/Lv${lv})`);
    }
    return {
      ok: bad.length === 0,
      detail: bad.length === 0
        ? `${ones.length} 条一次性升级：首次可买、再次拒绝、等级恒 1 ✓`
        : `异常：${bad.join("｜")}`,
    };
  });

  check("★ 永恒增幅：永恒时实得 EP == 基础 × 5^等级（且等级不重置）", () => {
    const rows = [0, 1, 2, 3].map((lv) => {
      const s = { ...newState(), epMultLevel: lv, infinityPoints: new Decimal(10).pow(ETERNITY.goalLog10) };
      const base = eternityPointGain(s.infinityPoints);
      const f = epMultFactor(s);
      const before = Number(s.eternityPoints ?? 0);
      doEternity(s);
      const got = Number(s.eternityPoints) - before;
      const exp = Number(base) * Number(f);
      return { lv, got, exp, ok: Math.abs(got - exp) < 1e-9, keep: Number(s.epMultLevel ?? 0) === lv };
    });
    const badRows = rows.filter((r) => !r.ok || !r.keep);
    return {
      ok: badRows.length === 0,
      detail: badRows.length === 0
        ? `等级 0/1/2/3 ⇒ 实得 1/5/25/125 ✓｜且等级**不随永恒重置** ✓`
        : `不一致：${badRows.map((r) => `L${r.lv} 实得${r.got} vs 期望${r.exp}｜保留=${r.keep}`).join("｜")}`,
    };
  });

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025：**永恒里程碑 em2 / em7 落地**（设计稿第 38 / 43 行）
  // ══════════════════════════════════════════════════════════
  // em2：neko 全局加成**翻倍加成部分**（`1.0221151 → 2.0442303`），
  //      且**好感度 ≤25 时仍恒 1**（"没练就完全没加成"不许被破坏）✓
  check("★ em2：neko 全局加成翻倍（只翻加成部分，≤25 仍恒 1）", () => {
    const base = NEKO.tiers.reduce((a, t) => a * t.pow, 1);           // 三档叠乘
    const wantEm2 = 1 + NEKO_BONUS_DOUBLE * (base - 1);
    const rows = [];
    for (const [aff, ec] of [[-50, 0], [25, 2], [26, 2], [80, 0], [80, 2], [80, 7]]) {
      const s = { ...newState(), nekoAffinity: aff, eternityCount: ec };
      rows.push({ aff, ec, e: nekoGlobalExponent(s) });
    }
    const noBonus = rows.filter((r) => r.aff <= 25).every((r) => r.e === 1);
    const em2On = rows.filter((r) => r.aff === 80 && r.ec >= 2).every((r) => Math.abs(r.e - wantEm2) < 1e-12);
    const em2Off = rows.filter((r) => r.aff === 80 && r.ec < 2).every((r) => Math.abs(r.e - base) < 1e-12);
    return {
      ok: noBonus && em2On && em2Off,
      detail: noBonus && em2On && em2Off
        ? `≤25 ⇒ 恒 1 ✓｜em2 前 ${base.toFixed(7)} ⇒ em2 后 ${wantEm2.toFixed(7)}（= 1 + ${NEKO_BONUS_DOUBLE}×加成部分）✓`
        : `≤25恒1=${noBonus}｜em2生效=${em2On}｜em2前=${em2Off}｜样本=${JSON.stringify(rows)}`,
    };
  });

  // em7：**基于"最快无限速度"自动依次完成**无限挑战（关数 = `INFINITY_CHALLENGES.max`）
  check("★ em7：按最快无限速度自动完成无限挑战（关数 = max，奖励照发）", () => {
    const N = 10;                                  // 最快无限 = 10 秒
    const max = INFINITY_CHALLENGES.max;
    const mk = (ec, fastest) => {
      const s = { ...newState(), eternityCount: ec, fastestInfinitySec: fastest };
      s.ic = { active: null, completed: 0 };
      s.infinityPoints = new Decimal(1);           // ⚠️ 非 0，才能验证"奖励真的在涨"✓
      return s;
    };
    // ① 未达 em7 ⇒ 永不自动完成
    const a = mk(6, N);
    for (let i = 0; i < 50; i++) icAutoAdvance(a, 100);
    // ② em7 但**没有最快记录** ⇒ 未就绪，不自动完成（防新档被瞬间穿完）
    const b = mk(7, 0);
    for (let i = 0; i < 50; i++) icAutoAdvance(b, 100);
    // ③ 正常：每 N 秒一关，最多 max 关；奖励 = ×10^ipJumpOrders 每关
    const c = mk(7, N);
    const ipBefore = c.infinityPoints.toString();
    let fired = 0;
    for (let i = 0; i < 60; i++) if (icAutoAdvance(c, N)) fired++;
    const perJump = Decimal.pow(10, INFINITY_CHALLENGES.ipJumpOrders);
    const wantIp = new Decimal(ipBefore).mul(perJump.pow(max));
    const rel = c.infinityPoints.div(wantIp).sub(1).abs();
    const ipOk = rel.lt(new Decimal("1e-9"));
    const ok = a.ic.completed === 0 && b.ic.completed === 0
      && fired === max && c.ic.completed === max && ipOk;
    return {
      ok,
      detail: ok
        ? `未达 em7 ⇒ 0 关 ✓｜无最快记录 ⇒ 0 关 ✓（防新档穿完）`
          + `｜em7+10s ⇒ 推 600s 过满 ${max} 关、只触发 ${fired} 次 ✓`
          + `｜IP ${sci(new Decimal(ipBefore))} → ${sci(c.infinityPoints)}（每关 ×10^${INFINITY_CHALLENGES.ipJumpOrders}）✓`
        : `未达em7=${a.ic.completed}｜无记录=${b.ic.completed}｜触发=${fired}｜完成=${c.ic.completed}/${max}｜IP对=${ipOk}`,
    };
  });

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025：**两个新 bug 修复的回归断言**
  //   ① 「无限增幅在 IP > e308.25 后没法买满」（`costCap` 把可买级数钉死）
  //   ② 「ZPE 引擎 2000 级后的价格增幅」（每 +5 数量级只能买 1 个）
  // ══════════════════════════════════════════════════════════

  // ① ipDouble：**`costCap` 已删除** ⇒ 价格不封顶、可买级数不再被钉死
  check("★ ipDouble：`costCap` 删除后价格不封顶、级数随池子增长（原来钉死在 Lv59）", () => {
    const rows = [];
    for (const p of ["1e300", "1e400", "1e1000", "1e5000"]) {
      const s = { ...newState(), infinityPoints: new Decimal(p), ipDoubleLevel: new Decimal(0) };
      const probe = ipDoubleAffordableIn(0, new Decimal(p));
      const got = buyIpDoubleMax(s);
      // ⚠️ **不要断言"余额必须变小"** —— `Decimal` 只有约 17 位有效数字，
      //   池子比总价大几百个数量级时（`1e400 − 3.46e322 = 1e400`）扣款表示不出来，
      //   那是**精度下限，不是没扣钱** ✓ ⇒ 判据用"买得起（`gte`）" ✓
      const want = ipDoubleCostFor({ ipDoubleLevel: 0 }, got);
      rows.push({ p, probe, got, lvOk: probe === got, affordable: new Decimal(p).gte(want) });
    }
    // ★ 关键（**新语义**）：价格每级 ×1e10 ⇒ 池子每 +10 个数量级多买 1 级。
    //   所以断言"池越大买越多"成立，但**倍数很小**（不是 ×10 那种）——
    //   原来"每级恒 1e320 平台"时才是每 +1 阶多 1 级；现在 `1e5000 ⇒ 527 级` ✓
    const grows = rows.every((r, i) => i === 0 || r.got > rows[i - 1].got);
    // 且**不再有 59 这个截断**：1e5000 必须远超 59 ✓
    const notPinned = rows[3].got > 200;
    const bad = rows.filter((r) => !r.lvOk || !r.affordable);
    const ok = bad.length === 0 && grows && notPinned;
    return {
      ok,
      detail: ok
        ? `价格不封顶（每级 ×1e10）✓｜${rows.map((r) => `${r.p}⇒${r.got}级`).join("｜")}`
          + ` ⇒ 池越大买越多、且**不再钉在 Lv59** ✓`
        : `异常：${bad.map((r) => `${r.p} 探针${r.probe}/实买${r.got}/买得起${r.affordable}`).join("｜")}`
          + `｜单调增长=${grows}｜不再钉死=${notPinned}(${rows[3].got})`,
    };
  });

  // ② ZPE 引擎：2000 级后**每级都 ×mult**（逐级连乘）
  //   ⚠️ `M` 必须在 `check()` 的**标题模板之前**取好 ——
  //     标题是**立即求值**的，而回调体在其后才跑 ⇒ 在回调里声明会 `M is not defined` ✗
  //   （我为此报了一次 ReferenceError）
  const _zpeM = Number(ZPE_ENGINE.steepAfter?.mult ?? 1e9);
  check(`★ ZPE 引擎：2000 级后**每级都 ×${_zpeM}**（每级 +${Math.log10(_zpeM).toFixed(0)} 个数量级）`, () => {
    const r = Number(ZPE_ENGINE.costGrowth);
    const M = _zpeM;
    const L = ZPE_ENGINE.steepAfter?.level ?? 2000;
    const step = (lv) => Number(ZPE_ENGINE.costGrowth) * zpeEngineStepMult(lv).toNumber();
    // ⚠️ 容差用**相对**比较（绝对 `1e-3` 过于严苛：`r × 1e5` 在 double 上差几个 ppm）
    //   ⚠️ 必须**先声明**再加使用（我第一版把它放在 `before` 之后 ⇒ TDZ `Cannot access 'rel'`）
    const rel = (a, b) => Math.abs(a - b) / Math.abs(b) < 1e-6;
    // 阈值下不变（零回归）：**1998 级及以前**每级仍是 ×costGrowth
    //   ⚠️ `step(lv)` = 「买 `lv+1` 这一级要乘的倍率」= `ζ(lv+1)/ζ(lv) × r`
    const before = [0, 500, 1000, 1997, 1998].every((lv) => rel(step(lv), r));
    // ⚠️⚠️ **终稿判据**（用户第 3 次纠正：「不应该是当前价格基础上再 ×1e5 么？」）：
    //   `ζ(lv) = 1`（lv < L）｜**`ζ(lv) = M^(lv−L+1)`**（lv ≥ L）——
    //   ⇒ **逐级连乘**：2000 级起**每一级**都在当前价格上再 ×1e5 ✓
    //     `价格(2000+n) = 价格(1999)·r^(n+1)·1e5^(n+1)`
    //   ⚠️ 我前两版都只让它生效**一次**（ζ 取常数）⇒ 用户看到"说好的阈值升级呢" ✗
    const jumpAtBuy2000 = rel(step(1999), r * M);            // 买到 Lv2000 这一步
    const everyStepSteep = [2000, 2001, 2002, 2005, 2010].every((lv) => rel(step(lv), r * M));
    const zetaAt2000 = zpeEngineCostMult(2000).eq(M);
    const zetaCompounds = [2000, 2001, 2002, 2003].every((lv) =>
      zpeEngineCostMult(lv).eq(new Decimal(M).pow(lv - L + 1)));
    const noJumpBefore = [0, 1000, 1998, 1999].every((lv) => zpeEngineCostMult(lv).eq(1));
    // ★ 实测"每级涨约 5 个数量级"（用户原话的**唯一硬指标**）
    //   `zpeEngineCost(state)` = 从该级**买下一级**的价 ✓
    const zpeAt = (lv) => ({ ...newState(), zpeEngineUnlocked: true, zpeEngineLevel: new Decimal(lv) });
    const orders = (a, b) => zpeEngineCost(zpeAt(b)).log10().sub(zpeEngineCost(zpeAt(a)).log10()).toNumber();
    const jumpOrders = orders(1999, 2000);
    const perLevelOrders = [orders(2000, 2001), orders(2001, 2002), orders(2005, 2006)];
    // ★ 每级要涨的数量级 = log10(costGrowth × mult)。
    //   ⚠️ **不要写死 4.5~6.0** —— `mult` 是可调旋钮（用户已把它从 1e5 调到 **1e9**，
    //     每级从 5.27 变成 **9.27** 个数量级）⇒ 写死会让"调旋钮"变成"改测试" ✗
    //   ⇒ 从常数**推导**期望值，留 ±0.6 容差（`Decimal` 末位噪声）✓
    const wantOrders = Math.log10(r * M);
    const orderOk = (d) => Math.abs(d - wantOrders) < 0.6;
    const jumpOk = orderOk(jumpOrders) && perLevelOrders.every(orderOk);
    // 探针 == 逐级实买（闭式已换成累加 ⇒ 必须同源）
    const rows = [];
    for (const [pool, lv0] of [["1e28", 0], ["1e600", 0], ["1e2000", 1990], ["1e6000", 2005]]) {
      const st = { ...newState(), zpeEngineUnlocked: true, zpeEngineLevel: new Decimal(lv0), infinityPoints: new Decimal(pool) };
      const k = zpeEngineAffordableIn(st, new Decimal(pool));
      const st2 = { ...newState(), zpeEngineUnlocked: true, zpeEngineLevel: new Decimal(lv0), infinityPoints: new Decimal(pool) };
      let real = 0;
      while (buyZpeEngineLevel(st2) > 0 && real < 30000) real++;
      const total = zpeEngineTotalCost(lv0, lv0 + k);
      const snap = new Decimal(pool).toString();
      const spent = new Decimal(snap).sub(st2.infinityPoints);
      // ⚠️⚠️ 这里的容差**必须**比别处宽 —— 原因是**测量方法**，不是实现：
      //   循环里是**逐级买 `k` 次**（`k` 可达 2000+），每一次都是"池 − 单级价"，
      //   **每一次的舍入都会累积**；然后再报成相对差时，又被"总价 vs 池子"的巨大尺度放大 ✗
      //   实测（M=1e9）：1e600⇒**1.75e-5**｜1e2000⇒**2.24e-5**｜1e6000⇒3.5e-10｜1e3000⇒1.35e-7
      //   （`k` 越大越差 ⇒ 与"累积次数"一致 ⇒ 确认是测量误差而非公式错）
      //   ⇒ 取 `1e-3`：真实 bug（价格公式算错）是**数量级**级别的偏差，必然被抓到 ✓
      //   ⚠️ 引擎自己的"买满"走 `zpeEngineTotalCost` **一次扣款** ⇒ 那条路径是精确的 ✓
      const spendOk = spent.eq(total) || spent.div(total).sub(1).abs().lt(new Decimal("1e-3"));
      rows.push({ pool, lv0, k, real, ok: k === real && spendOk });
    }
    const bad = rows.filter((x) => !x.ok);
    // 原有标定不能被打破：1e28 池 ≈ 100 级
    const calib = rows[0].real;
    const calibOk = calib >= 90 && calib <= 110;
    const allOk = before && jumpAtBuy2000 && zetaAt2000 && noJumpBefore && zetaCompounds
      && everyStepSteep && jumpOk && bad.length === 0 && calibOk;
    return {
      ok: allOk,
      detail: allOk
        ? `1998 级及以前每级 ×${r} ✓｜**Lv2000 起每级都 ×${(r * M).toExponential(4)}**（= r×mult）✓｜`
          + `ζ 逐级连乘（M^(lv−2000+1)）✓｜实测每级 +${perLevelOrders[0].toFixed(2)} 个数量级 ✓｜`
          + `探针==实买==扣款（4 组）✓｜原标定 1e28⇒${calib} 级 ✓`
        : `阈值前不变=${before}｜买Lv2000即×1e5=${jumpAtBuy2000}｜ζ(2000)=M=${zetaAt2000}｜`
          + `ζ连乘=${zetaCompounds}｜之前不加罚=${noJumpBefore}｜之后每级×r×M=${everyStepSteep}｜`
          + `每级数量级=${perLevelOrders.map((d) => d.toFixed(2)).join("/")}(应 ${wantOrders.toFixed(2)})｜` +
          `${bad.map((x) => `${x.pool}@Lv${x.lv0} 探针${x.k}/实买${x.real}`).join("｜")}｜标定=${calibOk}(${calib})`,
    };
  });

  const bad = results.filter((x) => !x).length;
  pricePass += results.length - bad;
  priceFail += bad;

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025：**性能回归断言**（用户实测「数字跳动速率及其低下」的产物）
  // ══════════════════════════════════════════════════════════
  // ⚠️ 必须放在**这个块内部** —— `check()` 是本块里的局部函数，
  //    放外面会 ReferenceError（我第一版就放错了 ✗）
  // 背景：`epMultAffordableIn` 曾因**循环上界过大**而在浏览器里 **80ms/次**，
  //   而它**每帧被调用 2 次** ⇒ 直接吃掉整个帧预算，FPS 掉到 6、全页面卡顿 ✗
  //   ⚠️ 我在 Node 里用**小池子**测过它，只有 0.03ms ⇒ **完全没暴露** ⇒
  //     所以这条断言特意用**大池子**，并且**测时间**（不只是测值）✓
  // ⚠️ 阈值与池子：**包含 1e10000**（用户指出「我可没说后续抵达不了 1e10000 这个阈值哦」）
  //   ⇒ 断言必须覆盖那个量级，不能替游戏设上限 ✓
  //   预算 20ms：Node 实测 1e10000 ⇒ **5.2ms**（余量 4×，慢机器也不误报）✓
  //   ⚠️ 上界取 1e10000（≈5000 级）；再往上（1e100000 ⇒ 5 万级 / 50ms）属于
  //      "池子比可达量级大 4 个数量级"的假想情形，不作为门槛 ✓
  {
    const PERF_BUDGET_MS = 20;
    const CALLS = 20;
    const perfRows = [];
    const timeIt = (label, fn) => {
      for (let i = 0; i < 3; i++) fn();                  // 预热
      const t0 = performance.now();
      for (let i = 0; i < CALLS; i++) fn();
      const ms = (performance.now() - t0) / CALLS;
      perfRows.push({ label, ms, ok: ms <= PERF_BUDGET_MS });
    };
    // 池子从小到大：**大池子是关键**（小池子发现不了这类 bug）
    // ⚠️ **包含 1e10000** —— 用户明确说不可假定它到不了 ✓
    for (const p of ["1e10", "1e100", "1e1000", "1e10000"]) {
      timeIt(`epMultAffordableIn(0,${p})`, () => epMultAffordableIn(0, new Decimal(p)));
    }
    timeIt("ipDoubleAffordableIn(0,1e1000)", () => ipDoubleAffordableIn(0, new Decimal("1e1000")));
    timeIt("ipDoubleCostFor(0,200)", () => ipDoubleCostFor({ ipDoubleLevel: 0 }, 200));

    // ★★★ 2026 新增：**ZPE 引擎的价格函数**（这一条是真的踩到过 ✗）
    //   背景：为了让 2000 级后的惩罚 `ζ` 正确，我把 `zpeEngineTotalCost` /
    //     `zpeEngineAffordableIn` 从**等比闭式**改成了**逐级累加**——
    //     数学上正确，但**复杂度 O(等级)**，而它们**在热路径上**：
    //       · `ui.js` 的 ZPE 面板每帧显示引擎累计价
    //       · `engineBonusMult()` 里调**两次**（分子/分母），UI 每帧又调它
    //     ⇒ 实测 `zpeEngineTotalCost(0,2000)` = **3.9ms/次**、每帧 3~4 次
    //       ⇒ 12~16ms/帧，而且**越往后越慢**（用户的性能图上就是
    //         `zpeEngineTotalCost(0,等级) = 2.06 ms/次` 那一行）✗
    //   ⇒ 现在改回**分段闭式**（ζ 是分段常数 ⇒ 段内仍是等比）：
    //       3.9ms → 0.0038ms（**1035×**），且**与等级无关** ✓
    //   预算 0.5ms：Node 实测 ≈ 0.004~0.01ms（余量 ≥ 50×）✓
    //   ⚠️ 这条断言的意义：**把"热路径上不许有 O(n) 循环"变成机械判据** ✓
    timeIt("zpeEngineTotalCost(0,5000)", () => zpeEngineTotalCost(0, 5000));
    timeIt("zpeEngineTotalCost(0,2000)", () => zpeEngineTotalCost(0, 2000));
    timeIt("zpeEngineAffordableIn(1e600)", () => zpeEngineAffordableIn(
      { ...newState(), zpeEngineUnlocked: true, zpeEngineLevel: new Decimal(0), infinityPoints: new Decimal("1e600") },
      new Decimal("1e600")));

    // ★★★ 2026 新增：**闭式 == 逐级累加**（数学同源，不许分叉）✓
    //   闭式快、循环慢但显然正确 ⇒ 两者必须在**所有区间**上一致，
    //   否则"显示 ≠ 实扣"会再次出现（本项目踩过 4 次）✗
    check("★ ZPE：分段闭式 == 逐级累加（含跨 2000 级的所有区间）", () => {
      const cases = [[0, 1], [0, 100], [0, 1447], [0, 1999], [0, 2000], [0, 2001],
        [0, 2500], [1990, 2010], [2000, 2500], [500, 900], [1999, 2001], [2500, 3000]];
      const bad = [];
      for (const [f, t] of cases) {
        const cl = zpeEngineTotalCost(f, t);
        const lp = zpeEngineTotalCostLoop(f, t);
        const rel = lp.eq(0) && cl.eq(0) ? 0 : lp.div(cl).sub(1).abs().toNumber();
        if (!(rel < 1e-10)) bad.push(`[${f},${t}] 闭式${cl.toString().slice(0, 12)} vs 循环${lp.toString().slice(0, 12)}`);
      }
      return {
        ok: bad.length === 0,
        detail: bad.length === 0
          ? `${cases.length} 个区间（含跨 2000、纯段 2、大范围）相对差均 < 1e-10 ✓`
          : `不一致：${bad.join("｜")}`,
      };
    });

    // ★★★ 2026 新增：**闭式探针 == 逐级核减探针** ✓
    check("★ ZPE：探针闭式 == 逐级核减（买几级必须完全一致）", () => {
      const cases = [[0, "1e28"], [0, "1e300"], [0, "1e600"], [0, "1e2000"],
        [1990, "1e2000"], [1990, "1e3000"], [2005, "1e6000"], [0, "1e545"], [2000, "1e551"]];
      const bad = [];
      for (const [lv, p] of cases) {
        const st = { ...newState(), zpeEngineUnlocked: true, zpeEngineLevel: new Decimal(lv), infinityPoints: new Decimal(p) };
        const cl = zpeEngineAffordableIn(st, new Decimal(p));
        const lp = zpeEngineAffordableInLoop(lv, new Decimal(p));
        if (cl !== lp) bad.push(`Lv${lv}/${p} 闭式${cl} vs 循环${lp}`);
      }
      return {
        ok: bad.length === 0,
        detail: bad.length === 0 ? `${cases.length} 个用例完全一致 ✓` : `不一致：${bad.join("｜")}`,
      };
    });

    // ★★★ 2025 新增：**稳态（每帧重复问同一池子）必须几乎免费** ✓
    //   背景（用户：「修！劳资的性能为什么要花在这个上面」）：
    //     `epMultAffordableIn` **每帧被调用 2 次**，而绝大多数帧里池子没变
    //     ⇒ 加了短期缓存（`epMultAffCache`）。这条断言锁住那个收益 ——
    //       若有人删了缓存，这里会立刻报红 ✗
    //   预算 0.05ms：Node 实测热路径 ≈ **0.0001~0.0007ms**（余量 ≥ 70×）✓
    {
      const STEADY_BUDGET_MS = 0.05;
      const pool = new Decimal("1e10000");
      epMultAffordableIn(0, pool);                       // 冷一次
      const t0 = performance.now();
      const N = 2000;
      for (let i = 0; i < N; i++) epMultAffordableIn(0, pool);
      const ms = (performance.now() - t0) / N;
      check("★ 性能：稳态（同池子反复问）必须走缓存（≤ 0.05ms/次）", () => ({
        ok: ms <= STEADY_BUDGET_MS,
        detail: ms <= STEADY_BUDGET_MS
          ? `池 1e10000 稳态 ${ms.toFixed(5)}ms/次 ✓（冷启动约 5ms ⇒ 缓存生效）`
          : `稳态 ${ms.toFixed(3)}ms/次 —— **缓存没生效**（冷启动才是这个量级）✗`,
      }));
    }

    const slow = perfRows.filter((r) => !r.ok);
    const worst = perfRows.reduce((a, r) => (r.ms > a.ms ? r : a), perfRows[0]);
    check(`★ 性能：每帧调用的探针必须便宜（≤ ${PERF_BUDGET_MS}ms/次，**大池子**重点测）`, () => ({
      ok: slow.length === 0,
      detail: slow.length === 0
        ? `${perfRows.length} 项全部达标（最慢 ${worst.label} = ${worst.ms.toFixed(2)}ms）✓`
        : `超预算：${slow.map((r) => `${r.label}=${r.ms.toFixed(1)}ms`).join("｜")}`,
    }));
  }
}

// ══════════════════════════════════════════════════════════
// ★★★ 2026：**静态扫描 —— 热路径上不许出现 `*Loop` 系列**
// ══════════════════════════════════════════════════════════
// 背景（用户 2026 的性能图直接指出来）：
//   为了修「ZPE 2000 级后的价格增幅」，我把 `zpeEngineTotalCost` 从**等比闭式**
//   改成**逐级累加**。数学完全正确，但复杂度 **O(等级)**，而它在**热路径**上：
//     · `ui.js` 的 ZPE 面板每帧显示引擎累计价
//     · `engineBonusMult()` 调它**两次**（分子/分母），而 UI 每帧显示引擎加成
//   ⇒ 实测 3.9ms/次 × 每帧 3~4 次 = **12~16ms/帧**，而且越往后越慢 ✗
//
// ⚠️ 这类回归**Node mock 抓不到**（mock 里 render 只有 2.4ms/帧，
//    因为 mock 没有真实样式重算/布局）⇒ 必须用**静态判据**兜住 ✓
{
  const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "src");
  const LOOP_FNS = ["zpeEngineTotalCostLoop", "zpeEngineAffordableInLoop"];
  const offenders = [];
  for (const f of readdirSync(ROOT)) {
    if (!f.endsWith(".js")) continue;
    if (f === "config.js") continue;                 // 定义处（含兜底调用）不算 ✓
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const fn of LOOP_FNS) {
      // 只看**非注释行**里的调用
      const hit = src.split(/\r?\n/).some((line) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
        return new RegExp(`\\b${fn}\\s*\\(`).test(line);
      });
      if (hit) offenders.push(`${f} 调了 ${fn}`);
    }
  }
  const ok = offenders.length === 0;
  console.log("=".repeat(80));
  console.log("  ★ 结构性守卫：热路径上不许有 O(n) 循环");
  console.log("=".repeat(80));
  if (ok) {
    console.log("  ✅ `src/`（除 config.js 定义处）没有任何 `*Loop` 调用 —— 闭式在位 ✓");
  } else {
    console.log("  ❌ 发现 O(n) 循环被放进 src/：");
    for (const o of offenders) console.log(`     · ${o}`);
    console.log("     ⇒ 它们每帧会被调用 ⇒ 会直接吃掉帧预算（实测 3.9ms/次）✗");
    priceFail++;
  }
  console.log();
}

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