#!/usr/bin/env node
/**
 * tools/tier4-timing.mjs —— 第四层（暗物质/新层）的最佳提供时机分析
 *
 * 要回答的问题：
 *   1. 各物质阈值分别在什么时间达成？
 *   2. 增长的「阶/小时」是怎么衰减的？（决定什么时候玩家会觉得卡）
 *   3. 1e25 物质时，玩家手上还剩什么没解锁？
 *   4. 第四层的 S 预算还剩多少？
 *
 * 用法：node tools/tier4-timing.mjs [--hours=24]
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BASE, DE_UPGRADES, REPEATABLE, VOID_UPGRADES, computeS } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";
import { matterRate, particleRate, globalMultiplier, zpeMultiplier } from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : d;
};
const HOURS = arg("hours", 24);

const log10 = (d) => (d.gt(0) ? d.log10().toNumber() : 0);
const clock = (s) =>
  s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(2)}h`;

// ══════════════════════════════════════════════════════════
console.log("=".repeat(80));
console.log("第四层时机分析");
console.log("=".repeat(80));
console.log();

// ── S 预算 ──
const { S, parts } = computeS();
console.log("【1】S 预算（SPEC 判据 P10：S 必须 < 1）");
console.log("  " + "-".repeat(60));
for (const p of parts) {
  console.log(`    ${pad(p.id, 16)} m=${pad(p.m, 7)} r=${pad(p.r, 6)} 贡献 ${(Math.log(p.m) / Math.log(p.r)).toFixed(4)}`);
}
console.log("  " + "-".repeat(60));
console.log(`    当前 S = ${S.toFixed(4)}`);
console.log(`    第四层可用预算 = 1 - ${S.toFixed(4)} = ${(1 - S).toFixed(4)}`);
console.log();
console.log("  含义：第四层如果加一条「可重复购买的纯乘法升级」，它贡献的");
console.log("        log(m)/log(r) 必须 ≤ 这个预算。留 20% 安全余量则更紧。");
console.log();

// ══════════════════════════════════════════════════════════
// 跑模拟，记录时间序列
// ══════════════════════════════════════════════════════════
const state = newState();
const DT = 0.5;
const MAX = HOURS * 3600;
const BUY_ORDER = ["particleBoost", "matterBoost", "entropyCoeff"];
const samples = [];

for (let i = 0; i < 10; i++) doClick(state);

let t = 0;
let firstVoidT = null;
let allVoidT = null;
let allZpeMsT = null;
let allDeMsT = null;
let deUnlockT = null;

while (t < MAX) {
  if (state.resources.traps.lt(3) || state.resources.entropy.lt(1)) {
    for (let i = 0; i < 10; i++) doClick(state);
  }
  for (const id of BUY_ORDER) buyRepeatable(state, id, true);
  buyTrap(state, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(state, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(state, id);

  tick(state, DT);
  t += DT;

  const voidN = Object.values(state.voidUpgrades).filter(Boolean).length;
  if (firstVoidT === null && voidN > 0) firstVoidT = t;
  if (allVoidT === null && voidN === 9) allVoidT = t;
  if (allZpeMsT === null && Object.values(state.zpeMilestones).every(Boolean)) allZpeMsT = t;
  if (allDeMsT === null && Object.values(state.deMilestones).every(Boolean)) allDeMsT = t;
  if (deUnlockT === null && state.phaseTransmuterUnlocked) deUnlockT = t;

  // 每秒采一次
  if (Math.abs((t % 60)) < DT / 2) {
    samples.push({
      t,
      matter: state.resources.matter,
      particle: state.resources.particle,
      zpe: state.zpe,
      de: state.darkEnergy,
      traps: state.resources.traps,
      lv: { ...state.levels },
      voidN,
      zpeMs: Object.values(state.zpeMilestones).filter(Boolean).length,
      deMs: Object.values(state.deMilestones).filter(Boolean).length,
    });
  }
}

// ══════════════════════════════════════════════════════════
console.log("【2】关键解锁时间");
console.log("  " + "-".repeat(60));
console.log(`    相变仪解锁（第三层开）   ${deUnlockT === null ? "未达成" : clock(deUnlockT)}`);
console.log(`    首个虚空升级（第二层开） ${firstVoidT === null ? "未达成" : clock(firstVoidT)}`);
console.log(`    9 个虚空升级买齐         ${allVoidT === null ? "未达成" : clock(allVoidT)}`);
console.log(`    6 个 ZPE 里程碑全达成    ${allZpeMsT === null ? "未达成" : clock(allZpeMsT)}`);
console.log(`    6 个暗能量里程碑全达成   ${allDeMsT === null ? "未达成" : clock(allDeMsT)}`);
console.log();
console.log("  ⚠️ 注意最后一行 —— 如果它在很早就达成，说明现有三层的内容");
console.log("     在第四层之前就被吃干净了，中间会有一段「无事可做」。");
console.log();

// ══════════════════════════════════════════════════════════
console.log("【3】物质阈值达成时间");
console.log("  " + "-".repeat(60));
console.log(`    ${pad("物质", 12)} ${pad("时间", 12)} 当时的等级 粒子/物质/凝聚   熵阱   ZPE`);
for (const target of [1e15, 1e20, 1e22, 1e25, 1e27, 1e30, 1e35, 1e40, 1e50, 1e60]) {
  const label = `1e${Math.round(Math.log10(target))}`;
  const hit = samples.find((s) => log10(s.matter) >= target);
  if (!hit) { console.log(`    ${pad(label, 12)} ${pad("未达成", 12)}`); continue; }
  const lv = `${hit.lv.particleBoost.toNumber().toFixed(0)}/${hit.lv.matterBoost.toNumber().toFixed(0)}/${hit.lv.entropyCoeff.toNumber().toFixed(0)}`;
  console.log(
    `    ${pad(label, 12)} ${pad(clock(hit.t), 12)} ${pad(lv, 22)} ${pad(hit.traps.toNumber().toFixed(0), 5)} 1e${log10(hit.zpe).toFixed(1)}`,
  );
}
console.log();

// ══════════════════════════════════════════════════════════
console.log("【4】增长速度衰减（关键表）");
console.log("  " + "-".repeat(74));
console.log(`    ${pad("时间段", 18)} ${pad("物质增长", 14)} ${pad("阶/小时", 12)} 对比上一段`);
const buckets = [];
for (let h = 0; h < HOURS; h += 0.5) {
  const a = samples.find((s) => s.t >= h * 3600);
  const b = samples.find((s) => s.t >= (h + 0.5) * 3600);
  if (a && b) buckets.push({ h, orders: log10(b.matter) - log10(a.matter) });
}
let prevRate = null;
for (const b of buckets) {
  const rate = b.orders / 0.5;
  const rel = prevRate === null ? "" : `×${(rate / prevRate).toFixed(2)}`;
  if (b.h < 6 || b.h % 2 === 0) {
    console.log(
      `    ${pad(`${b.h}h → ${b.h + 0.5}h`, 18)} ${pad(`+${b.orders.toFixed(2)} 阶`, 14)} ${pad(rate.toFixed(2), 12)} ${rel}`,
    );
  }
  prevRate = rate;
}
console.log();

// ══════════════════════════════════════════════════════════
console.log("【5】如果什么都不加，还要多久到 e50 / e60 / e100");
console.log("  " + "-".repeat(60));
// 用最后 4 小时的平均速率外推
const lastT = samples[samples.length - 1];
const prevT = samples.find((s) => s.t >= lastT.t - 4 * 3600) ?? samples[0];
const recentRate = (log10(lastT.matter) - log10(prevT.matter)) / ((lastT.t - prevT.t) / 3600);
console.log(`    最近 4 小时速率：${recentRate.toFixed(3)} 阶/小时`);
for (const target of [50, 60, 100]) {
  const need = target - log10(lastT.matter);
  const hours = need / recentRate;
  console.log(`    到达 1e${target} 还需 ${hours.toFixed(1)} 小时（${(hours / 24).toFixed(1)} 天）  [按 ${recentRate.toFixed(2)} 阶/小时外推]`);
}
console.log();
console.log("  ⚠️ 速率本身还在衰减，所以上面的估计**偏乐观**。");
console.log("     多项式增长下，实际时间会比线性外推长得多。");
console.log();

// ══════════════════════════════════════════════════════════
console.log("【6】1e25 物质那一刻的现场");
console.log("  " + "-".repeat(60));
const at25 = samples.find((s) => log10(s.matter) >= 25);
if (at25) {
  console.log(`    时间              ${clock(at25.t)}`);
  console.log(`    粒子              ${at25.particle.toExponential(2)}`);
  console.log(`    物质              ${at25.matter.toExponential(2)}`);
  console.log(`    ZPE               ${at25.zpe.toExponential(2)}`);
  console.log(`    暗能量            ${at25.de.toExponential(2)}`);
  console.log(`    熵阱              ${at25.traps.toNumber().toFixed(0)}`);
  console.log(`    升级等级          ${at25.lv.particleBoost.toNumber().toFixed(0)} / ${at25.lv.matterBoost.toNumber().toFixed(0)} / ${at25.lv.entropyCoeff.toNumber().toFixed(0)}`);
  console.log(`    虚空升级          ${at25.voidN}/9`);
  console.log(`    ZPE 里程碑        ${at25.zpeMs}/6`);
  console.log(`    暗能量里程碑      ${at25.deMs}/6`);
  console.log();
  const left = 9 - at25.voidN;
  console.log(`    => 那一刻还剩 ${left} 个虚空升级没买。`);
  if (left === 0) {
    console.log("       现有内容已经全部吃完 —— 这正是加新层的好时机。");
  } else {
    console.log("       ⚠️ 还有内容没解锁，此时加新层会**盖住**它们。");
  }
}
console.log();

// ══════════════════════════════════════════════════════════
console.log("【7】结论");
console.log("=".repeat(80));
console.log();
console.log(`    S 预算：${(1 - S).toFixed(3)}（当前 ${S.toFixed(3)}）`);
if (allDeMsT !== null && at25) {
  console.log(`    暗能量里程碑全达成在 ${clock(allDeMsT)}，1e25 物质在 ${clock(at25.t)}`);
  console.log(`    => ${allDeMsT < at25.t ? "里程碑先吃完 ✅ 1e25 是合理门槛" : "里程碑还没吃完，1e25 偏早 ⚠️"}`);
}
console.log();
