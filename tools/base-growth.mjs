#!/usr/bin/env node
/**
 * tools/base-growth.mjs —— 禁用坍缩后的**纯基础成长曲线**
 *
 * 目的：回答「基础成长率在高物质处会不会衰减」。
 * 方法：把 `COLLAPSE.unlockMatter` 抬到不可达，于是临界坍缩/量子/大坍缩全部不触发，
 *       剩下的就是第 0~2 层的纯产出。
 *
 * 判据：d(log10 M)/dt —— 每秒涨几个数量级。
 *       如果它随物质升高而下降，说明有乘区跟不上，那就是「阶梯必须靠暗物质补偿」的根源。
 */

import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, VOID_UPGRADES, DE_UPGRADES, COLLAPSE } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";
import {
  globalMultiplier, matterRate, entropyRate, particleRate, zpeRate,
  effectiveTraps, conversion, darkEnergyMultiplier,
} from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const log10 = (d) => (d.gt(0) ? d.log10().toNumber() : 0);

// ★ 禁用坍缩：门槛抬到不可达
COLLAPSE.unlockMatter = 1e999;

const s = newState();
const watch = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300];
const done = new Set();
const rows = [];

console.log("=".repeat(104));
console.log("纯基础成长曲线（坍缩已禁用）");
console.log("=".repeat(104));
console.log();
console.log(
  `  ${pad("时刻", 8)} ${pad("物质", 9)} ${pad("d(阶)/秒", 13)} ` +
  `${pad("全局加成", 11)} ${pad("转化率", 10)} ${pad("熵阱", 9)} ${pad("ZPE倍率", 11)} ${pad("暗能量倍率", 11)}`,
);
console.log("  " + "-".repeat(100));

for (let i = 0; i < 400000; i++) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);

  const M = s.resources.matter;
  const mL = log10(M);

  for (const w of watch) {
    if (done.has(w) || mL < w) continue;
    done.add(w);
    const dlog = M.gt(0) ? matterRate(s).div(M).div(Math.LN10).toNumber() : 0;
    const cv = conversion(s);
    const row = {
      t: i, w, dlog,
      gm: log10(globalMultiplier(s)),
      conv: cv.output.div(cv.threshold).toNumber(),
      traps: effectiveTraps(s).toNumber(),
      zpeM: log10(zpeRate(s)),
      deM: log10(darkEnergyMultiplier(s)),
    };
    rows.push(row);
    console.log(
      `  ${pad(i + "s", 8)} ${pad("1e" + w, 9)} ${pad(dlog.toExponential(3), 13)} ` +
      `${pad("1e" + row.gm.toFixed(1), 11)} ${pad(row.conv.toExponential(3), 10)} ` +
      `${pad(row.traps.toFixed(0), 9)} ${pad("1e" + row.zpeM.toFixed(1), 11)} ${pad("1e" + row.deM.toFixed(1), 11)}`,
    );
  }
  if (done.has(300)) break;

  tick(s, 1);
}

console.log();
console.log("─".repeat(104));
console.log("  增长率的变化：");
console.log("─".repeat(104));
if (rows.length >= 2) {
  const first = rows[0], last = rows[rows.length - 1];
  console.log(`    1e${first.w} 时 ${first.dlog.toExponential(3)} 阶/秒`);
  console.log(`    1e${last.w} 时 ${last.dlog.toExponential(3)} 阶/秒`);
  const ratio = last.dlog / first.dlog;
  console.log(`    变化 = ${ratio.toExponential(3)}  ${ratio < 0.1 ? "❌ 严重衰减" : ratio < 0.5 ? "⚠️ 明显衰减" : ratio < 1.5 ? "✅ 基本恒定" : "✅ 增长中"}`);
}
console.log();
COLLAPSE.unlockMatter = 1e25;
