#!/usr/bin/env node
/**
 * tools/engine-mech-lab.mjs —— **引擎 5 条机制的「内部终点」表 + 实测等级**
 *
 * ── 用户 2025 的设计主张（本工具的依据）──
 *   「**没有终点，但内部的机制可以拥有终点**（这也就是为什么引擎并不像 AD 中星系
 *     直接单纯增幅计数频率强度那样只有一个机制，而是多个机制）」
 *
 *   ⇒ 引擎整体无上限（价格用**多项式**，照抄 AD 星系的形状）；
 *     每条机制各自走**饱和式 / 开根 / 阈值**，各有终点
 *     ⇒ 形成「早期吃①、中期吃②、后期吃⑤」的**排期** ✓
 *
 * ── 5 条机制（参数在 `ENGINE_MECH` / `ZPE_ENGINE` / `MATTER_B_KNEE`）──
 *   ① ZPE 倍率**加法区**   `A·x/(1+x)`，x = lv/knee     → 渐近 A，**有终点** ✓
 *   ② ZPE **产出倍率**     `1 + coeff·√lv`              → 开根，增长极慢（实际到顶早）
 *   ②b ZPE/暗能量**乘算**  `1 + coeff·√lv`              → 同上
 *   ③ 计数频率            `lv ≥ countFreqLevel` 解锁     → **纯阈值，本身就是终点** ✓
 *   ④ 暗能量**自增长**     `1 + A·x/(1+x)`，x = lv/knee   → 渐近 A+1，**有终点** ✓
 *   ⑤ 物质 b区幂 `k`       `1 + 25·x/(1+x)`              → 渐近 26，**有终点** ✓
 *
 * 用法：node tools/engine-mech-lab.mjs [小时数]     默认 168
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import {
  advance, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade, buyIpDoubleMax, buyRepeatable,
  buyTrap, buyVoidUpgrade, doBigCrunch, doClick, unlockZpeEngine, buyZpeEngineLevel, breakInfinity,
} from "../src/engine.js";
import {
  BREAK_INFINITY, DE_UPGRADES, DREAM_UPGRADES, INFINITY_ORDER, INFINITY_UPGRADES,
  REPEATABLE, VOID_UPGRADES, MATTER_B_KNEE, MATTER_B_KMAX, ZPE_ENGINE, ENGINE_MECH,
  matterTotalExponent, zpeEngineLevel, zpeEngineAddBonus, zpeEngineProdMult, zpeEngineMultBonus, deEngineLevelBonus,
} from "../src/config.js";
import { shouldCrunch } from "../src/formulas.js";

const HOURS = Number(process.argv[2]) || 168;
/**
 * ⚠️ **步长必须保持 2s**（我试过放大到 20s 提速，结论会变 ✗）：
 *     步长 2s  ⇒ 引擎 **1447** 级
 *     步长 20s ⇒ 引擎 **173672** 级   ← 差 120 倍！
 *   原因：这一轮是**按时间收手**（`runSeconds`），步长太大 ⇒
 *     `shouldCrunch` 的判定点变稀 ⇒ **漏掉收手时机** ⇒ 一轮能推得更远 ⇒ 等级爆掉。
 *   ⇒ 想提速**不能动这里**（要么就让 `advance` 内部按 2s 细分，要么把本脚本排除出批跑）。
 *   ⚠️ 因此本脚本已列入 `run-all.mjs` 的 `HEAVY`（默认不跑）—— 它是**标定用的重诊断**，
 *      手动 `node tools/engine-mech-lab.mjs` 调用 ✓
 */
const STEP = Number(process.argv[3]) || 2;
const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const lg = (v) => { const n = num(v && v.log10 ? v.log10() : Math.log10(v)); return Number.isFinite(n) ? n : NaN; };

/** 饱和式 `1 + A·x/(1+x)` */
const sat = (A, lv, knee) => { const x = lv / knee; return 1 + A * (x / (1 + x)); };
const M = {
  add: (lv) => sat(ENGINE_MECH.add.A, lv, ENGINE_MECH.add.knee),
  prod: (lv) => 1 + ENGINE_MECH.prod.coeff * Math.sqrt(lv),
  mult: (lv) => 1 + ENGINE_MECH.mult.coeff * Math.sqrt(lv),
  de: (lv) => sat(ENGINE_MECH.de.A, lv, ENGINE_MECH.de.knee),
  k: (lv) => 1 + MATTER_B_KMAX * ((lv / MATTER_B_KNEE) / (1 + lv / MATTER_B_KNEE)),
};

console.log("=".repeat(100));
console.log("引擎 5 条机制：内部终点表");
console.log("=".repeat(100));
console.log(`  ① A=${ENGINE_MECH.add.A}、knee=${ENGINE_MECH.add.knee} ⇒ 渐近 +${ENGINE_MECH.add.A}`);
console.log(`  ② coeff=${ENGINE_MECH.prod.coeff}｜②b coeff=${ENGINE_MECH.mult.coeff}（开根）`);
console.log(`  ③ 阈值 lv=${ZPE_ENGINE.countFreqLevel}`);
console.log(`  ④ A=${ENGINE_MECH.de.A}、knee=${ENGINE_MECH.de.knee} ⇒ 渐近 ×${ENGINE_MECH.de.A + 1}`);
console.log(`  ⑤ knee=${MATTER_B_KNEE} ⇒ 渐近 ${1 + MATTER_B_KMAX}`);
console.log(`  价格 base=${ZPE_ENGINE.baseCostIp} × (lv+1)³`);
console.log();

console.log("   等级      ①(lg)   ②(lg)   ②b(lg)   ④(lg)     ⑤k    ⑤(lg)");
for (const lv of [10, 50, 100, 200, 500, 1000, 2000, 5000, 20000]) {
  console.log(
    `  ${String(lv).padStart(7)}  ` +
    [M.add, M.prod, M.mult, M.de].map((f) => lg(f(lv)).toFixed(2).padStart(7)).join("  ") +
    `  ${M.k(lv).toFixed(2).padStart(6)}  ${lg(M.k(lv)).toFixed(2).padStart(6)}`
  );
}
console.log();
console.log("  每条机制「实际到顶」的等级（到极限的 90% / 99% 需要多少级）：");
for (const [name, lim, knee] of [
  ["① 加法区", ENGINE_MECH.add.A, ENGINE_MECH.add.knee],
  ["④ 暗能量", ENGINE_MECH.de.A, ENGINE_MECH.de.knee],
  ["⑤ k", MATTER_B_KMAX, MATTER_B_KNEE],
]) {
  const lvFor = (r) => knee * (r / (1 - r));   // 解 A·x/(1+x) = r·A ⇒ x = r/(1−r)
  console.log(`     ${name.padEnd(10)} 极限 ${(lim + 1).toFixed(0).padStart(4)}｜90% 在 ${lvFor(0.9).toFixed(0).padStart(6)} 级｜99% 在 ${lvFor(0.99).toFixed(0).padStart(7)} 级`);
}
console.log(`     ${"② ②b".padEnd(10)} 开根 ⇒ 无极限；但 1e5 级才给 ${M.prod(1e5).toFixed(2)} / ${M.mult(1e5).toFixed(2)}（实际到顶早）`);
console.log(`     ${"③ 计数频率".padEnd(10)} 纯阈值 lv=${ZPE_ENGINE.countFreqLevel} ⇒ 一解锁即到顶`);
console.log();

// ══ 实测 ══
console.log("=".repeat(100));
console.log(`实测：${HOURS} 小时内引擎等级 / k / 各机制 / IP`);
console.log("=".repeat(100));
const s = newState();
for (let i = 0; i < 10; i++) doClick(s);
console.log("  t(h)   引擎等级    k     ①加法   ②产出   ②b乘算  ④暗能量   log10(IP)");
let t = 0, row = -1;
const stepH = HOURS > 48 ? 24 : 6;
while (t < HOURS * 3600) {
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
  buyIpDoubleMax(s);
  unlockZpeEngine(s);
  buyZpeEngineLevel(s, true);
  if (shouldCrunch(s)) doBigCrunch(s);
  advance(s, STEP);
  t += STEP;

  const h = Math.floor(t / 3600);
  if (h % stepH === 0 && h !== row && t >= stepH * 3600) {
    row = h;
    const lv = num(zpeEngineLevel(s));
    console.log(
      `  ${String(h).padStart(4)}  ${String(lv).padStart(9)}  ${num(matterTotalExponent(s)).toFixed(2).padStart(5)}  ` +
      `${lg(num(zpeEngineAddBonus(s)) + 1).toFixed(2).padStart(6)}  ${lg(num(zpeEngineProdMult(s))).toFixed(2).padStart(6)}  ` +
      `${lg(num(zpeEngineMultBonus(s))).toFixed(2).padStart(7)}  ${lg(deEngineLevelBonus(lv)).toFixed(2).padStart(7)}  ` +
      `${lg(s.infinityPoints).toFixed(2).padStart(9)}`
    );
  }
}
console.log();
const lvEnd = num(zpeEngineLevel(s));
console.log(`  最终：引擎 ${lvEnd} 级 ⇒ k = ${num(matterTotalExponent(s)).toFixed(3)}（终点 ${1 + MATTER_B_KMAX}）`);
console.log(`  IP 池 = 1e${lg(s.infinityPoints).toFixed(2)}｜大坍缩 ${num(s.bigCrunchCount).toExponential(1)}`);
console.log();
console.log(`  ★ 目标（A 方案）：${HOURS}h 时引擎 ≈ 2000 级`);
console.log(`     实际 ${lvEnd} 级 ⇒ ${lvEnd >= 1500 && lvEnd <= 3000 ? "✅ 落在目标区间" : "⚠️ 偏离目标 —— 需要重标价格 base"}`);
