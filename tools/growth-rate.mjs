#!/usr/bin/env node
/** tools/growth-rate.mjs —— 把「每秒涨多少数量级」沿整局测出来 */
import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, VOID_UPGRADES, DE_UPGRADES } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";
import { globalMultiplier, matterRate, effectiveTraps } from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const s = newState();
const watch = [5, 10, 15, 20, 22, 24, 25, 26, 27, 30, 40, 60];
const done = new Set();

console.log("  物质跨过各数量级时的「指数增长率」");
console.log(`  ${pad("时刻", 8)} ${pad("物质", 10)} ${pad("d(阶)/秒", 14)} ${pad("全局加成", 12)} ${pad("熵阱", 10)} 备注`);
console.log("  " + "-".repeat(74));

for (let i = 0; i < 20000; i++) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);

  const M = s.resources.matter;
  const mL = M.gt(0) ? M.log10().toNumber() : 0;
  const b0 = s.bigCrunchCount.toNumber();

  for (const w of watch) {
    if (done.has(w) || mL < w) continue;
    done.add(w);
    const dlog = M.gt(0) ? matterRate(s).div(M).div(Math.LN10).toNumber() : 0;
    const note = w === 25 ? "★ 量子/坍缩解锁" : "";
    console.log(
      `  ${pad(i + "s", 8)} ${pad("1e" + w, 10)} ${pad(dlog.toExponential(3), 14)} ` +
      `${pad("1e" + globalMultiplier(s).log10().toNumber().toFixed(1), 12)} ` +
      `${pad(effectiveTraps(s).toNumber().toFixed(0), 10)} ${note}`,
    );
  }

  tick(s, 1);
  if (s.bigCrunchCount.toNumber() > b0) {
    console.log(`  ${pad(i + "s", 8)} ${pad("—", 10)} ${pad("—", 14)} ${pad("—", 12)} ${pad("—", 10)} ★ 大坍缩`);
    break;
  }
}
