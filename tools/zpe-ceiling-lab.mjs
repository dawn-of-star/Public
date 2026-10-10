#!/usr/bin/env node
/**
 * tools/zpe-ceiling-lab.mjs —— 量子路径的**瓶颈诊断**：ZPE 能涨到多少 / 量子卡在哪
 *
 * ── 为什么需要它 ──
 *   2025 诊断「过载」时实测到一件与设计稿冲突的事：
 *     · 捕获门槛 `quantumZpeRequirement(pairs) = 1e10 × 20^pairs` **每对 ×20（+1.301 阶）**
 *     · 而 ZPE 的天花板约 **1e47**（见下表）⇒ 门槛在 pairs≈28~30 就追平 ZPE
 *     · 设计稿（`第三层设计.txt` 行 11~12）要求量子能走到 **120 对**
 *   ⇒ 也就是说：**量子路径会停在 ~30 对**，与设计稿差了 4 倍。
 *
 *   ⚠️ 这条结论直接决定「过载阈值累进」（`QUANTUM.captureTierFactor`）能不能用：
 *     累进会让门槛**更陡** ⇒ 只会让卡住更早发生 ✗
 *     所以任何提高门槛的改动，都必须先看这张表。
 *
 * 用法：`node tools/zpe-ceiling-lab.mjs [小时数]`
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import {
  advance, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade, buyRepeatable, buyTrap,
  buyVoidUpgrade, doBigCrunch, doClick, unlockZpeEngine, buyZpeEngineLevel, breakInfinity,
} from "../src/engine.js";
import {
  BREAK_INFINITY, DE_UPGRADES, DREAM_UPGRADES, INFINITY_ORDER, INFINITY_UPGRADES,
  QUANTUM, REPEATABLE, VOID_UPGRADES, quantumZpeRequirement, qOf, zpeEngineLevel,
} from "../src/config.js";
import { shouldCrunch, zpeRate } from "../src/formulas.js";

const HOURS = Number(process.argv[2]) || 24;
const DT = 2;
const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const lg = (v) => { const n = num(v && v.log10 ? v.log10() : Math.log10(v)); return Number.isFinite(n) ? n : NaN; };

const s = newState();
for (let i = 0; i < 10; i++) doClick(s);

console.log("=".repeat(84));
console.log(`ZPE 天花板 / 量子瓶颈诊断（模拟 ${HOURS} 小时）`);
console.log("=".repeat(84));
console.log("  t(h)   log10(ZPE)  ZPE增速/小时   pairs   下一对门槛(log10)  差(阶)  crunch  引擎");
let t = 0, row = -1;
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
  for (let i = 0; i < 500 && buyInfinityUpgrade(s, "ipDouble").ok; i++) { }
  unlockZpeEngine(s);
  buyZpeEngineLevel(s, true);
  if (shouldCrunch(s)) doBigCrunch(s);
  advance(s, DT);
  t += DT;

  const h = Math.floor(t / 3600);
  if (h % 2 === 0 && h !== row && t >= 2 * 3600) {
    row = h;
    const z = lg(s.zpe);
    const pairs = num(s.quantumPairs ?? 0);
    const need = lg(quantumZpeRequirement(s.quantumPairs ?? D(0)));
    console.log(
      String(h).padStart(6) + "  " + String(z.toFixed(2)).padStart(11) + "  " +
      String((zpeRate(s) > 0 ? lg(zpeRate(s)) - z : NaN) === NaN ? "—" : (lg(zpeRate(s)) - z).toFixed(2)).padStart(13) + "  " +
      String(pairs).padStart(6) + "   " + String(need.toFixed(1)).padStart(16) + "  " +
      String((need - z).toFixed(1)).padStart(6) + "  " + String(num(s.bigCrunchCount)).padStart(7) + "  " +
      String(num(zpeEngineLevel(s))).padStart(5)
    );
  }
}

console.log();
const zEnd = lg(s.zpe);
console.log(`最终：log10(ZPE) = ${zEnd.toFixed(2)}｜pairs = ${num(s.quantumPairs ?? 0)}｜量子 = ${num(qOf(s))}`);
console.log(`门槛 = 1e10 × ${Number(QUANTUM.zpeCostGrowth) * Number(QUANTUM.zpeCostExtraNerf)}^pairs｜captureTierFactor = ${QUANTUM.captureTierFactor}`);
console.log();
console.log(`⇒ 量子能走到的对数上限 ≈ (log10(ZPE) − 10) / log10(${Number(QUANTUM.zpeCostGrowth) * Number(QUANTUM.zpeCostExtraNerf)}) = ${((zEnd - 10) / Math.log10(Number(QUANTUM.zpeCostGrowth) * Number(QUANTUM.zpeCostExtraNerf))).toFixed(1)} 对`);
