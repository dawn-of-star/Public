#!/usr/bin/env node
/**
 * tools/baseline-034.mjs —— 原稿 js/ 的**完整进度基线**
 *
 * 目的：用户说原稿「节奏不错」。我改了公式，必须拿原稿本身跑一遍，
 *       用同样的测量方式对比，否则「快了还是慢了」只能靠感觉。
 *
 * 做法：
 *   · 装 DOM 桩 + 全局 Decimal（原稿依赖 <script> 挂的全局）
 *   · 桩掉 requestAnimationFrame / setInterval（原稿构造时要用，且会挂住进程）
 *   · 用 engine.loop(时间戳) 推进，手动补购买（3 个升级的购买函数没被导出）
 *
 * 用法：node tools/baseline-034.mjs --hours=8
 */

import Decimal from "../dist/break_eternity.esm.js";

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
globalThis.requestAnimationFrame = noop;
globalThis.cancelAnimationFrame = noop;
globalThis.setInterval = () => 0;   // 原稿的 startAutoSave 会挂住进程
globalThis.setTimeout = () => 0;
globalThis.Decimal = Decimal;

const GameState = (await import(new URL("../legacy/js/state.js", import.meta.url).href)).default;
const engineMod = await import(new URL("../legacy/js/engine.js", import.meta.url).href);
const { buyEntropyTrap } = engineMod;

const pad = (s, n) => String(s).padEnd(n);
const clock = (s) => (s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
function fmt(d) {
  if (d == null) return "-";
  if (!(d instanceof Decimal)) d = new Decimal(d);
  if (d.lt(1000)) return d.toFixed(2);
  const e = d.log10().toNumber();
  if ((d.layer ?? 0) >= 1) return `e${e.toFixed(1)}`;
  if (e < 6) return d.toFixed(0);
  return `${d.mantissa.toFixed(2)}e${Math.floor(e)}`;
}

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : d;
};
const HOURS = arg("hours", 8);

const engine = new engineMod.default(false);

// ── 时间控制：让引擎以为真实时间在流逝 ──
let simTime = Date.now();
const realNow = Date.now;
Date.now = () => simTime;

// ── 手动购买（原稿的 3 个购买函数没导出，这里复刻其逻辑）──
function buyUpgrades() {
  const G = GameState;
  const hasM2 = G.zpeMilestones.milestone2;
  const zm = G.getEffectiveZpeMultiplierForPrice ? G.getEffectiveZpeMultiplierForPrice() : G.getZpeMultiplier();
  const specs = [
    ["particleBoost", "particle"],
    ["matterBoost", "matter"],
    ["entropyCoeff", "particle"],
  ];
  for (const [key, poolName] of specs) {
    const up = G.upgrades[key];
    for (let guard = 0; guard < 500; guard++) {
      let cost = up.getNextCost();
      if (hasM2) cost = cost.div(zm);
      const pool = G.resources[poolName];
      if (pool.lt(cost)) break;
      G.resources[poolName] = pool.sub(cost);
      up.level = up.level.add(1);
      const flag = { particleBoost: "particleBoost", matterBoost: "matterBoost", entropyCoeff: "entropyCoeff" }[key];
      if (!G.dreamPointsAwarded[flag]) {
        G.dreamPointsAwarded[flag] = true;
        G.dreamPoints = G.dreamPoints.add(1);
      }
    }
  }
  // 熵阱
  for (let i = 0; i < 500; i++) if (!buyEntropyTrap()) break;
  // 虚空升级
  for (const id of ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9"]) {
    if (!G.voidUpgrades[id]) engineMod.buyVoidUpgrade(id);
  }
  // 暗能量升级（原稿的购买函数没导出，这里只做「真空加速」，效果最直接）
  for (let i = 0; i < 50; i++) {
    const cost = new Decimal(10).pow(G.vacuumAccelLevel);
    if (G.zpe.lt(cost)) break;
    G.zpe = G.zpe.sub(cost);
    G.vacuumAccelLevel = G.vacuumAccelLevel.add(1);
  }
}

console.log("=".repeat(84));
console.log("原稿 0.3.4 完整进度基线（直接跑 js/ 的原始代码）");
console.log("=".repeat(84));
console.log();
console.log(`  ${pad("时间", 9)} ${pad("熵", 12)} ${pad("粒子", 12)} ${pad("物质", 12)} ${pad("ZPE", 12)} ${pad("暗能量", 12)} 等级 全局/物质/凝聚  熵阱`);
console.log("  " + "-".repeat(100));

const DT_MS = 50;
const MAX = HOURS * 3600;
const REPORT_AT = [30, 120, 300, 900, 1800, 3600, 7200, 14400, 28800];
let nextReport = 0;
let t = 0;
let firstVoid = null;

while (t < MAX) {
  // 点击（熵阱少的时候靠手点）
  if (GameState.resources.traps.lt(5)) {
    for (let i = 0; i < 10; i++) engine.handleClick();
  }

  if (Math.abs(t % 0.5) < DT_MS / 2000) buyUpgrades();

  simTime += DT_MS;
  engine.loop(simTime);
  t += DT_MS / 1000;

  if (firstVoid === null) {
    const owned = Object.values(GameState.voidUpgrades).filter(Boolean).length;
    if (owned > 0) firstVoid = t;
  }

  if (nextReport < REPORT_AT.length && t >= REPORT_AT[nextReport]) {
    const G = GameState;
    const lv = ["particleBoost", "matterBoost", "entropyCoeff"].map((k) => G.upgrades[k].level.toNumber().toFixed(0)).join("/");
    console.log(
      `  ${pad(clock(t), 9)} ${pad(fmt(G.resources.entropy), 12)} ${pad(fmt(G.resources.particle), 12)} ` +
      `${pad(fmt(G.resources.matter), 12)} ${pad(fmt(G.zpe), 12)} ${pad(fmt(G.darkEnergy), 12)} ${pad(lv, 18)} ${fmt(G.resources.traps)}`,
    );
    nextReport++;
  }
}

const G = GameState;
console.log();
console.log("=".repeat(84));
console.log("原稿最终状态");
console.log("=".repeat(84));
console.log();
console.log(`  模拟时长       ${clock(t)}`);
console.log(`  粒子           ${fmt(G.resources.particle)}`);
console.log(`  物质           ${fmt(G.resources.matter)}`);
console.log(`  熵阱           ${fmt(G.resources.traps)}`);
console.log(`  ZPE            ${fmt(G.zpe)}`);
console.log(`  暗能量         ${fmt(G.darkEnergy)}`);
console.log(`  梦想点         ${fmt(G.dreamPoints)}`);
console.log();
console.log(`  升级等级       全局 ${G.upgrades.particleBoost.level.toNumber()} / 物质 ${G.upgrades.matterBoost.level.toNumber()} / 凝聚 ${G.upgrades.entropyCoeff.level.toNumber()}`);
const owned = Object.entries(G.voidUpgrades).filter(([, v]) => v).map(([k]) => k);
console.log(`  虚空升级       ${owned.length}/9  ${owned.join(" ") || "(无)"}`);
console.log(`  ZPE 里程碑     ${Object.values(G.zpeMilestones).filter(Boolean).length}/6`);
console.log(`  暗能量里程碑   ${Object.values(G.deMilestones).filter(Boolean).length}/6`);
console.log(`  首个虚空升级   ${firstVoid === null ? "未达成" : clock(firstVoid)}`);
console.log(`  真空加速等级   ${G.vacuumAccelLevel.toNumber()}`);

Date.now = realNow;
process.exit(0);
