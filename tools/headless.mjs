#!/usr/bin/env node
/**
 * tools/headless.mjs —— 不经过浏览器直接跑逻辑
 *
 * 用途：调数值时不用开浏览器；改完跑一遍就知道有没有踩坑。
 * 原理：src/ 全部是纯模块，Node 能直接 import。
 *
 * 用法：
 *   node tools/headless.mjs                  默认 2 小时
 *   node tools/headless.mjs --hours=8
 *   node tools/headless.mjs --check          只跑判据自检
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BASE, DE_MILESTONES, DE_UPGRADES, REPEATABLE, VOID_UPGRADES, ZPE_EXPONENT, ZPE_MILESTONES, computeS } from "../src/config.js";
import { newState, serialize, deserialize } from "../src/state.js";
import {
  advance, buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick,
  affordableCount, snapshot, tick,
} from "../src/engine.js";
import {
  conversion, darkEnergyMultiplier, floorDiv, globalMultiplier, zpeMultiplier,
  zpeProductionPenalty, darkEnergyGainPerConversion,
} from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const hr = (n) => "-".repeat(n);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
};

/** 大数的短显示 */
function fmt(d) {
  if (!(d instanceof Decimal)) d = new Decimal(d);
  if (d.lt(1000)) return d.toFixed(2);
  const e = d.log10().toNumber();
  if (e < 6) return d.toFixed(0);
  const layer = d.layer ?? 0;
  if (layer >= 1) return `e${e.toFixed(1)}`;
  return d.toExponential(2).replace("e+", "e");
}

const clock = (s) => {
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};

// ══════════════════════════════════════════════════════════
console.log("=".repeat(78));
console.log("判据自检（SPEC P1 / P10）");
console.log("=".repeat(78));
console.log();

const { S, parts } = computeS();
console.log("  可重复乘法升级的耦合判据  S = Σ log(m)/log(r)  必须 < 1");
console.log("  " + hr(60));
for (const p of parts) {
  const c = Math.log(p.m) / Math.log(p.r);
  console.log(`    ${pad(p.id, 16)} m=${pad(p.m, 7)} r=${pad(p.r, 6)} 贡献 ${c.toFixed(4)}`);
}
console.log("  " + hr(60));
console.log(`    S = ${S.toFixed(4)}   ${S < 1 ? "✅ 安全" : "❌ 会跑飞"}`);
console.log();

if (process.argv.includes("--check")) process.exit(S < 1 ? 0 : 1);

// ══════════════════════════════════════════════════════════
console.log("=".repeat(78));
console.log("定点验证：四个已修的 bug");
console.log("=".repeat(78));
console.log();

// ── 修 1：v4 必须真的生效 ──
{
  const a = newState();
  a.dreamPoints = new Decimal(50);
  const before = globalMultiplier(a);
  a.voidUpgrades.v4 = true;
  const after = globalMultiplier(a);
  const ratio = after.div(before).toNumber();
  // 无 v4: 1 + 50×0.02 = 2；有 v4: 1 + 50×0.08 = 5  => 比值 2.5
  console.log(`  ① v4「虚空共鸣」`);
  console.log(`     50 梦想点时，全局加成 ${fmt(before)} -> ${fmt(after)}  (×${ratio.toFixed(3)})`);
  console.log(`     期望 ×2.500（2 -> 5）  ${Math.abs(ratio - 2.5) < 0.01 ? "✅ 生效" : "❌ 无效"}`);
}
console.log();

// ── 修 2：暗能量 m2 必须真的降低阈值 ──
{
  const a = newState();
  a.levels.entropyCoeff = new Decimal(10);
  const t0 = conversion(a).threshold;
  a.darkEnergy = new Decimal(1000);
  const deMult = darkEnergyMultiplier(a);
  a.deMilestones.dm2 = true;
  const t1 = conversion(a).threshold;
  const out0 = conversion(a).output;
  console.log(`  ② 暗能量里程碑 dm2「降低熵凝聚阈值」`);
  console.log(`     暗能量倍率 = ${fmt(deMult)}`);
  console.log(`     阈值 ${fmt(t0)} -> ${fmt(t1)}   比值 ${t1.div(t0).toNumber().toFixed(4)}`);
  console.log(`     产出 不变 = ${fmt(out0)}`);
  const expected = 1 / deMult.toNumber();
  console.log(`     期望比值 ≈ ${expected.toFixed(4)}   ${Math.abs(t1.div(t0).toNumber() - expected) < 1e-6 ? "✅ 生效" : "❌ 无效"}`);
  console.log(`     （原稿是分子分母同时乘，比值恒为 1 —— 完全无效）`);
}
console.log();

// ── 修 3：ZPE 倍率改成小幂次 ──
{
  console.log(`  ③ ZPE 倍率：原稿 1+0.1·log10(Z)  ->  现在 (Z+1)^${ZPE_EXPONENT}`);
  console.log(`     ${pad("ZPE", 14)} ${pad("原稿", 12)} ${pad("现在", 12)} 倍数提升`);
  console.log("     " + hr(52));
  for (const e of [1, 3, 6, 10, 30, 100]) {
    const z = new Decimal(10).pow(e);
    const old = 1 + 0.1 * Math.log10(Math.pow(10, e));
    const now = zpeMultiplier(Object.assign(newState(), { zpe: z })).toNumber();
    const zs = e < 6 ? String(Math.pow(10, e)) : `1e${e}`;
    console.log(`     ${pad(zs, 14)} ${pad("x" + old.toFixed(2), 12)} ${pad("x" + fmt(new Decimal(now)), 12)} ${(now / old).toFixed(1)}x`);
  }
}
console.log();

// ── 修 4：整数除法不能被 Decimal 的舍入带偏（否则熵余量变负）──
{
  // 真实抓到的样本：x/y 真值 = 481675594906810.94，落在整数下方，
  // 而 Decimal 的 div 只保留约 15 位有效数字，把它抬成了 481675594906811。
  const x = new Decimal("16215948575620.594");
  const y = new Decimal("0.033665705190560606");
  const naive = x.div(y).floor();
  const safe = floorDiv(x, y);
  const badRem = x.sub(naive.mul(y));
  const goodRem = x.sub(safe.mul(y));
  console.log(`  ④ 熵 → 粒子的转换次数：整数除法不许被舍入带偏`);
  console.log(`     x/y 真值 481675594906810.94 -> floor 应该是 …810`);
  console.log(`     x.div(y).floor() = ${naive.toString()}   余量 ${badRem.toString()}  ← 负的，界面显示「余 -0.0019」`);
  console.log(`     floorDiv(x, y)   = ${safe.toString()}   余量 ${goodRem.toString()}`);
  const ok4 = safe.eq(481675594906810) && goodRem.gte(0);
  console.log(`     ${ok4 ? "✅ 余量非负" : "❌ 仍然会为负"}`);

  // 「买满」不能因为同一个舍入白跑：反推出的级数要多算一格时，必须自己下调整
  const st = newState();
  st.resources.particle = new Decimal("1e9");
  const canBuy = affordableCount(st, "particleBoost");
  const bought = buyRepeatable(st, "particleBoost", true);
  console.log(`     「买满」：显示可买 ${canBuy} 级 -> 实际买到 ${bought} 级，` +
    `余 ${fmt(st.resources.particle)} 粒子  ${bought > 0 && st.resources.particle.gte(0) ? "✅" : "❌ 白跑/透支"}`);
}
console.log();

// ══════════════════════════════════════════════════════════
const HOURS = arg("hours", 2);
console.log("=".repeat(78));
console.log(`模拟：${HOURS} 小时，每 0.5 秒推进一次，贪心购买`);
console.log("=".repeat(78));
console.log();
console.log(`  ${pad("时间", 10)} ${pad("熵", 12)} ${pad("粒子", 12)} ${pad("物质", 12)} ${pad("ZPE", 12)} ${pad("等级 粒子/物质/凝聚", 22)} 熵阱`);
console.log("  " + hr(92));

const state = newState();
/**
 * 步长。默认 0.5 秒（跑得快）。
 * 想验证「浏览器里的真实节奏」就传 --dt=0.016（约 60fps）。
 * 闭式解里有个 c·dt²/2 项，dt 越小越接近真实积分。
 */
const DT = arg("dt", 0.5);
const MAX = HOURS * 3600;
const REPORT_AT = [30, 120, 300, 900, 1800, 3600, 7200, 14400, 28800];
let nextReport = 0;
let t = 0;

// 开局：点几下拿到第一笔熵
for (let i = 0; i < 10; i++) doClick(state);

const BUY_ORDER = ["particleBoost", "matterBoost", "entropyCoeff"];
/** 熵余量出现负数的步数（必须是 0） */
let negEntropySteps = 0;

while (t < MAX) {
  // ★ 模拟玩家点击：熵阱还没起来的时候靠手点（这是开局唯一的熵来源）
  //   原稿也是这样：owned=0 时没有任何被动产出
  if (state.resources.traps.lt(3) || state.resources.entropy.lt(1)) {
    for (let i = 0; i < 10; i++) doClick(state); // 每秒 10 下
  }

  // 每 0.5 秒贪心买一次
  for (const id of BUY_ORDER) buyRepeatable(state, id, true);
  buyTrap(state, true);

  // 虚空升级：能买就买（按价格顺序）
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(state, id);
  // 暗能量升级
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(state, id);

  tick(state, DT);
  t += DT;

  // ★ 兜底不变量：熵余量永远不该是负数（Decimal 的 div 舍入曾经让它变负）
  if (state.resources.entropy.lt(0)) negEntropySteps++;

  if (nextReport < REPORT_AT.length && t >= REPORT_AT[nextReport]) {
    const s = snapshot(state);
    const lv = ["particleBoost", "matterBoost", "entropyCoeff"]
      .map((k) => state.levels[k].toNumber().toFixed(0)).join("/");
    console.log(
      `  ${pad(clock(t), 10)} ${pad(fmt(s.entropy), 12)} ${pad(fmt(s.particle), 12)} ` +
      `${pad(fmt(s.matter), 12)} ${pad(fmt(s.zpe), 12)} ${pad(lv, 22)} ${fmt(s.traps)}`,
    );
    nextReport++;
  }
}

const s = finalSnapshot(state);
console.log();
console.log("=".repeat(78));
console.log("最终状态");
console.log("=".repeat(78));
console.log();
console.log(`  模拟时长       ${clock(t)}`);
console.log(`  熵             ${fmt(s.entropy)}`);
console.log(`  粒子           ${fmt(s.particle)}`);
console.log(`  物质           ${fmt(s.matter)}`);
console.log(`  熵阱           ${fmt(s.traps)}  (实际生效 ${fmt(s.effectiveTraps)})`);
console.log(`  ZPE            ${fmt(s.zpe)}`);
console.log(`  暗能量         ${fmt(s.darkEnergy)}`);
console.log(`  梦想点         ${fmt(s.dreamPoints)}`);
console.log(`  全局加成       ${fmt(s.globalMultiplier)}`);
console.log(`  ZPE 倍率       ${fmt(s.zpeMultiplier)}`);
console.log();
console.log(`  熵/秒          ${fmt(s.entropyRate)}`);
console.log(`  粒子/秒        ${fmt(s.particleRate)}`);
console.log(`  物质/秒        ${fmt(s.matterRate)}`);
console.log();
console.log(`  升级等级       全局 ${state.levels.particleBoost.toNumber()} / 物质 ${state.levels.matterBoost.toNumber()} / 凝聚 ${state.levels.entropyCoeff.toNumber()}`);
const voidOwned = Object.entries(state.voidUpgrades).filter(([, v]) => v).map(([k]) => k);
console.log(`  虚空升级       ${voidOwned.length}/9  ${voidOwned.join(" ") || "(无)"}`);
console.log(`  ZPE 里程碑     ${Object.values(state.zpeMilestones).filter(Boolean).length}/${ZPE_MILESTONES.length}`);
console.log(`  暗能量里程碑   ${Object.values(state.deMilestones).filter(Boolean).length}/${DE_MILESTONES.length}`);
console.log(`  熵余量为负的步数 ${negEntropySteps}  ${negEntropySteps === 0 ? "✅" : "❌ 整数除法又踩到舍入了"}`);

function finalSnapshot(st) {
  return snapshot(st);
}

// ══════════════════════════════════════════════════════════
console.log();
console.log("=".repeat(78));
console.log("存档往返测试");
console.log("=".repeat(78));
console.log();
{
  const raw = serialize(state);
  const { state: back, ok } = deserialize(raw);
  const a = fmt(state.resources.particle);
  const b = fmt(back.resources.particle);
  const keysOk = Object.keys(state.levels).every(
    (k) => state.levels[k].eq(back.levels[k]),
  );
  console.log(`  反序列化       ${ok ? "OK" : "失败"}`);
  console.log(`  粒子           ${a} -> ${b}   ${a === b ? "✅" : "❌"}`);
  console.log(`  升级等级一致   ${keysOk ? "✅" : "❌"}`);
  console.log(`  JSON 大小      ${(JSON.stringify(raw).length / 1024).toFixed(1)} KB`);
}
console.log();
