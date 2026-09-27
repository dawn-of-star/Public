#!/usr/bin/env node
/** tools/resource-curve.mjs —— ZPE / 暗能量 随物质增长的对照 */
import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, VOID_UPGRADES, DE_UPGRADES, QUANTUM } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";

const pad = (s, n) => String(s).padEnd(n);
const lg = (d) => (d.gt(0) ? d.log10().toNumber() : 0);
const dur = (s) => (s === null ? "—" : s < 3600 ? `${(s / 60).toFixed(1)}分` : `${(s / 3600).toFixed(2)}h`);

QUANTUM.zpeCostGrowth = 10;
QUANTUM.zpeCostExtraNerf = 2;
const stepLog = Math.log10(10 * 2);   // 每次捕获门槛涨多少数量级

const s = newState();
const watch = [25, 30, 40, 50, 60, 70, 80, 90, 98, 110, 130, 160, 200, 250, 300, 308];
const marks = {};
let reach = null;

for (let i = 0; i < 40000; i++) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);

  const mL = lg(s.resources.matter);
  for (const w of watch) {
    if (marks[w] === undefined && mL >= w) {
      marks[w] = { t: i, zpe: lg(s.zpe), de: lg(s.darkEnergy), q: s.quantum.toNumber(), pairs: s.quantumPairs.toNumber() };
    }
  }
  if (reach === null && mL >= 308) reach = i;
  tick(s, 1);
  if (reach !== null) break;
}

console.log("=".repeat(94));
console.log("ZPE / 暗能量 随物质增长对照");
console.log("=".repeat(94));
console.log();
console.log(`  ${pad("物质",9)} ${pad("时刻",9)} ${pad("ZPE",10)} ${pad("暗能量",10)} ${pad("ZPE门槛对数",13)} ${pad("按ZPE可捕",10)} ${pad("按暗能量可捕",12)}`);
console.log("  " + "-".repeat(90));
for (const w of watch) {
  const m = marks[w];
  if (!m) continue;
  // 当前门槛是 ZPE 的 1e10 × 20^n -> n = (log10(ZPE) - 10)/log10(20)
  const byZpe = Math.max(0, Math.floor((m.zpe - 10) / stepLog));
  const byDe = Math.max(0, Math.floor((m.de - 10) / stepLog));
  console.log(
    `  ${pad("1e" + w, 9)} ${pad(dur(m.t), 9)} ${pad("1e" + m.zpe.toFixed(1), 10)} ` +
    `${pad("1e" + m.de.toFixed(1), 10)} ${pad(byZpe * stepLog + 10 > 0 ? "1e" + (10 + byZpe * stepLog).toFixed(0) : "—", 13)} ` +
    `${pad(byZpe + " 对/" + byZpe * 2 + " 量子", 10)} ${pad(byDe + " 对/" + byDe * 2 + " 量子", 12)}`,
  );
}
console.log();
console.log("  观察：");
const first = marks[25], last = marks[300] ?? marks[250];
if (first && last) {
  console.log(`    物质 1e25 -> 1e${last === marks[300] ? 300 : 250}：ZPE 涨 ${(last.zpe - first.zpe).toFixed(1)} 个数量级，暗能量涨 ${(last.de - first.de).toFixed(1)} 个数量级`);
  console.log(`    => 暗能量比 ZPE 快 ${((last.de - first.de) / (last.zpe - first.zpe)).toFixed(2)} 倍`);
}
console.log();
console.log(`  （每次捕获门槛 ×20 = ${stepLog.toFixed(3)} 个数量级）`);
console.log();
