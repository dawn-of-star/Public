#!/usr/bin/env node
/**
 * tools/compare-pace.mjs —— 原稿 vs 新实现，**同等级**下的速率对比
 *
 * 为什么这样做：直接跑两边的完整模拟，差异会同时来自「公式改了」和
 * 「购买策略不同」，分不清是哪个。所以这里固定**同一组等级**，
 * 只比产出速率 —— 这样差异 100% 来自公式改动。
 *
 * 用法：node tools/compare-pace.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const noop = () => {};
function fakeEl() {
  return new Proxy(
    {
      textContent: "", innerHTML: "", style: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, appendChild: noop,
      setAttribute: noop, getAttribute: () => null,
    },
    { get: (t, p) => (p in t ? t[p] : noop), set: (t, p, v) => ((t[p] = v), true) },
  );
}
globalThis.document = {
  getElementById: fakeEl, querySelector: fakeEl, querySelectorAll: () => [],
  createElement: fakeEl, addEventListener: noop, body: fakeEl(), visibilityState: "visible",
};
globalThis.window = { addEventListener: noop, onload: null };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.alert = noop;
globalThis.requestAnimationFrame = noop;   // 原稿构造时要用
globalThis.cancelAnimationFrame = noop;
// 原稿的 startAutoSave() 会起 setInterval，桩掉它，否则 Node 永远不退出
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
globalThis.setTimeout = (fn) => 0;

const Decimal = (await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href)).default;
globalThis.Decimal = Decimal;

// ── 原稿（已移到 legacy/，不再维护，只作为对照基准）──
const GameState = (await import(new URL("../legacy/js/state.js", import.meta.url).href)).default;
const engineMod = await import(new URL("../legacy/js/engine.js", import.meta.url).href);
const oldEngine = new engineMod.default(false);

// ── 新实现 ──
const N = await import(new URL("../src/engine.js", import.meta.url).href);
const NF = await import(new URL("../src/formulas.js", import.meta.url).href);
const NS = await import(new URL("../src/state.js", import.meta.url).href);

const D = (v) => new Decimal(v ?? 0);
const pad = (s, n) => String(s).padEnd(n);
function fmt(d) {
  if (d == null) return "-";
  if (!(d instanceof Decimal)) d = new Decimal(d);
  if (d.lt(1000)) return d.toFixed(2);
  const e = d.log10().toNumber();
  if ((d.layer ?? 0) >= 1) return `e${e.toFixed(1)}`;
  if (e < 6) return d.toFixed(0);
  return d.toExponential(2).replace("e+", "e");
}

// ══════════════════════════════════════════════════════════
// 设置同一组等级
// ══════════════════════════════════════════════════════════

const SCENARIOS = [
  { name: "开局", pb: 0, mb: 0, ec: 0, traps: 1, zpe: 0, de: 0, dp: 0 },
  { name: "早期", pb: 3, mb: 5, ec: 5, traps: 10, zpe: 0, de: 0, dp: 1 },
  { name: "ZPE 初启", pb: 15, mb: 30, ec: 25, traps: 40, zpe: 1e4, de: 0, dp: 2 },
  { name: "中期", pb: 50, mb: 100, ec: 80, traps: 90, zpe: 1e9, de: 0, dp: 3 },
  { name: "后期", pb: 150, mb: 300, ec: 250, traps: 150, zpe: 1e14, de: 1e6, dp: 4 },
];

function setOld(s) {
  const G = GameState;
  G.resources.entropy = D(0);
  G.resources.particle = D(1000);
  G.resources.matter = D(1000);
  G.resources.traps = D(s.traps);
  G.dreamPoints = D(s.dp);
  G.zpe = D(s.zpe);
  G.zpeTotal = D(s.zpe);
  G.darkEnergy = D(s.de);
  G.darkEnergyTotal = D(s.de);
  G.upgrades.particleBoost.level = D(s.pb);
  G.upgrades.matterBoost.level = D(s.mb);
  G.upgrades.entropyCoeff.level = D(s.ec);
  G.zpeMilestones = { milestone1: false, milestone2: false, milestone3: false, milestone4: false, milestone5: false, milestone6: false };
  G.deMilestones = { m0: false, m1: false, m2: false, m3: false, m4: false, m5: false };
  G.voidUpgrades = { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false, v7: false, v8: false, v9: false };
  G.zpeBaseMultiplier = D(1);
  G.entropyOutputMultiplier = D(1);
  G.matterConversionMultiplier = D(1);
  G.zpeMultiplierExtra = D(1);
  G.dreamCoefficient = D(0.02);
  G.deMilestone2Active = G.deMilestone3Active = G.deMilestone4Active = G.deMilestone5Active = false;
  G.zpeFixedMultiplier = null;
  G.dreamAnnihilationLevel = D(0);
  G.phaseShiftLevel = D(0);
  G.vacuumAccelLevel = D(0);
  G.phaseTransmuterUnlocked = false;
  G.trapCost.current = G.trapCost.base.mul(G.trapCost.multiplier.pow(s.traps));
}

function setNew(st, s) {
  st.resources.entropy = D(0);
  st.resources.particle = D(1000);
  st.resources.matter = D(1000);
  st.resources.traps = D(s.traps);
  st.dreamPoints = D(s.dp);
  st.zpe = D(s.zpe);
  st.zpeTotal = D(s.zpe);
  st.darkEnergy = D(s.de);
  st.darkEnergyTotal = D(s.de);
  st.levels.particleBoost = D(s.pb);
  st.levels.matterBoost = D(s.mb);
  st.levels.entropyCoeff = D(s.ec);
  for (const k of Object.keys(st.zpeMilestones)) st.zpeMilestones[k] = false;
  for (const k of Object.keys(st.deMilestones)) st.deMilestones[k] = false;
  for (const k of Object.keys(st.voidUpgrades)) st.voidUpgrades[k] = false;
  st.zpeFixedMultiplier = null;
  for (const k of Object.keys(st.deUpgradeLevels)) st.deUpgradeLevels[k] = D(0);
  st.phaseTransmuterUnlocked = false;
}

/** 跑原稿一秒，返回各项增量 */
function oldRates(s) {
  setOld(s);
  const before = {
    e: GameState.resources.entropy,
    p: GameState.resources.particle,
    m: GameState.resources.matter,
    z: GameState.zpe,
  };
  oldEngine.calculateProduction(1);
  oldEngine.checkAutoConversion();
  return {
    entropy: GameState.resources.entropy.sub(before.e),
    particle: GameState.resources.particle.sub(before.p),
    matter: GameState.resources.matter.sub(before.m),
    zpe: GameState.zpe.sub(before.z),
  };
}

/** 跑新实现一秒 */
function newRates(s) {
  const st = NS.newState();
  setNew(st, s);
  return {
    entropy: NF.entropyRate(st),
    particle: NF.particleRate(st),
    matter: NF.matterRate(st),
    zpe: NF.zpeRate(st),
  };
}

// ══════════════════════════════════════════════════════════
console.log("=".repeat(88));
console.log("同等级速率对比：原稿 vs 新实现");
console.log("（同一组等级、同样的资源，只比产出速率 —— 差异 100% 来自公式改动）");
console.log("=".repeat(88));
console.log();

for (const s of SCENARIOS) {
  const o = oldRates(s);
  const n = newRates(s);
  console.log(`【${s.name}】 等级 全局${s.pb} / 物质${s.mb} / 凝聚${s.ec}   熵阱${s.traps}  ZPE ${fmt(D(s.zpe))}  暗能量 ${fmt(D(s.de))}`);
  console.log(`  ${pad("", 10)} ${pad("原稿", 16)} ${pad("新实现", 16)} 倍数`);
  console.log("  " + "-".repeat(66));
  for (const [key, label] of [["entropy", "熵/秒"], ["particle", "粒子/秒"], ["matter", "物质/秒"], ["zpe", "ZPE/秒"]]) {
    const a = o[key], b = n[key];
    let ratio = "-";
    if (a.gt(0) && b.gt(0)) ratio = `${b.div(a).toNumber().toFixed(2)}x`;
    else if (b.gt(0)) ratio = "∞";
    else if (a.gt(0)) ratio = "0";
    console.log(`  ${pad(label, 10)} ${pad(fmt(a), 16)} ${pad(fmt(b), 16)} ${ratio}`);
  }
  console.log();
}

// ══════════════════════════════════════════════════════════
console.log("=".repeat(88));
console.log("单独看：熵凝聚等级对「熵→粒子」转换的影响");
console.log("=".repeat(88));
console.log();
console.log(`  ${pad("等级", 8)} ${pad("原稿 产出/阈值", 24)} ${pad("新实现 产出/阈值", 26)} 转换率倍数`);
console.log("  " + "-".repeat(80));
for (const lv of [0, 5, 10, 20, 35, 50, 100, 200, 400]) {
  const s = { pb: 0, mb: 0, ec: lv, traps: 50, zpe: 0, de: 0, dp: 0 };
  setOld(s);
  const oc = { t: GameState.upgrades.entropyCoeff.getCurrentCostThreshold(), o: GameState.rules.autoConvertOutput.add(GameState.upgrades.entropyCoeff.getExtraOutput()) };
  const st = NS.newState();
  setNew(st, s);
  const nc = NF.conversion(st);
  const oRate = oc.o.div(oc.t).toNumber();
  const nRate = nc.output.div(nc.threshold).toNumber();
  console.log(
    `  ${pad(lv, 8)} ${pad(`${fmt(oc.o)} / ${fmt(oc.t)} = ${oRate.toExponential(3)}`, 24)} ` +
    `${pad(`${fmt(nc.output)} / ${fmt(nc.threshold)} = ${nRate.toExponential(3)}`, 26)} ${(nRate / oRate).toFixed(2)}x`,
  );
}
console.log();
console.log("  ★ 原稿的转换率在 400 级时已接近硬上限 0.05（0.15/3）；");
console.log("    新实现是指数增长，没有上限 —— 这是本次改动里对速度影响最大的一处。");
console.log();

process.exit(0);
