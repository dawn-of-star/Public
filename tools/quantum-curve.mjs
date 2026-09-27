#!/usr/bin/env node
/**
 * tools/quantum-curve.mjs —— 设计量子阈值：让物质从 1e25 平滑走到 1e308.25
 *
 * ══════════════════════════════════════════════════════════
 * 目标（用户给定）
 * ══════════════════════════════════════════════════════════
 *   · 暗物质体系**已整体删除**
 *   · 由**量子涨落**独自把物质从 1e25 推到 1e308.25
 *   · 耗时 **> 1 小时 且 < 2 小时**
 *
 * 需要的平均速率：
 *   283 个数量级 / 3600 秒 = 0.0786 阶/秒   （1 小时）
 *   283 个数量级 / 7200 秒 = 0.0393 阶/秒   （2 小时）
 *
 * ══════════════════════════════════════════════════════════
 * 扫描的旋钮
 * ══════════════════════════════════════════════════════════
 *   perPair       每对给几个量子
 *   baseCost      第一对的门槛 ZPE
 *   growth        门槛递进倍率
 *   effectPow     量子效果的形式：×(1+q)^effectPow
 */

import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, VOID_UPGRADES, DE_UPGRADES, COLLAPSE, QUANTUM } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";

const pad = (s, n) => String(s).padEnd(n);
const dur = (s) => (s === null ? "未达到"
  : s < 60 ? `${s.toFixed(0)}s`
    : s < 3600 ? `${(s / 60).toFixed(1)}分`
      : `${(s / 3600).toFixed(2)}小时`);

/**
 * 跑一轮并采样物质曲线。
 * @returns { marks, reach308, q, pairs }
 */
function run(opts, maxSec) {
  QUANTUM.perPair = opts.perPair;
  QUANTUM.zpeBaseCost = opts.baseCost;
  QUANTUM.zpeCostGrowth = opts.growth;
  QUANTUM.zpeCostExtraNerf = 1;                // 扫描时不用额外削弱

  const s = newState();
  const marks = {};
  const watch = [25, 50, 100, 150, 200, 250, 300, 307];
  let reach308 = null;

  for (let i = 0; i < maxSec; i++) {
    if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
    buyTrap(s, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);

    const M = s.resources.matter;
    const mL = M.gt(0) ? M.log10().toNumber() : 0;
    for (const w of watch) if (marks[w] === undefined && mL >= w) marks[w] = i;
    if (reach308 === null && mL >= 308) reach308 = i;

    tick(s, 1);
    if (reach308 !== null) break;
  }
  return { marks, reach308, q: s.quantum.toNumber(), pairs: s.quantumPairs.toNumber() };
}

const MAX = 40000;   // 11 小时游戏时间

console.log("=".repeat(96));
console.log("量子阈值设计扫描 —— 无暗物质，目标：1e25 -> 1e308.25 用 1~2 小时");
console.log("=".repeat(96));
console.log();
console.log("  先看当前配置（perPair=2, base=1e10, growth=20）能走多远：");
console.log();

const first = run({ perPair: 2, baseCost: 1e10, growth: 20 }, MAX);
console.log(`    到达 1e308      ${dur(first.reach308)}`);
console.log(`    各数量级到达时间  ${[25, 50, 100, 150, 200, 250].map((w) => `1e${w}:${dur(first.marks[w] ?? null)}`).join("  ")}`);
console.log(`    最终量子 / 对数   ${first.q} / ${first.pairs}`);
console.log();

console.log("─".repeat(96));
console.log("  扫描：perPair 与 growth");
console.log("─".repeat(96));
console.log();
console.log(`  ${pad("perPair", 9)} ${pad("base", 8)} ${pad("growth", 8)} ${pad("到1e308", 11)} ${pad("1e25->1e50", 11)} ${pad("量子", 8)} 评价`);
console.log("  " + "-".repeat(92));

const CASES = [];
for (const perPair of [2, 10, 50, 200]) {
  for (const growth of [10, 100, 1e4]) {
    CASES.push({ perPair, baseCost: 1e10, growth });
  }
}

for (const c of CASES) {
  const r = run(c, MAX);
  const span = (r.marks[50] ?? 0) - (r.marks[25] ?? 0);
  const t = r.reach308;
  const verdict = t === null ? "❌ 走不到"
    : t > 7200 ? "⚠️ 太长"
      : t < 3600 ? "⚠️ 太短"
        : "✅ 达标";
  console.log(
    `  ${pad(c.perPair, 9)} ${pad("1e10", 8)} ${pad(c.growth.toExponential(0), 8)} ` +
    `${pad(dur(t), 11)} ${pad(span + "s", 11)} ${pad(r.q, 8)} ${verdict}`,
  );
}

QUANTUM.perPair = 2;
QUANTUM.zpeBaseCost = 1e10;
QUANTUM.zpeCostGrowth = 10;
QUANTUM.zpeCostExtraNerf = 2;

console.log();
console.log("  说明：");
console.log("    · perPair 直接放大量子数 -> 放大 ×(1+q)");
console.log("    · growth 越小 -> 同样 ZPE 下捕获越多对 -> 量子越多（但门槛递进仍是刹车）");
console.log("    · 「1e25->1e50 耗时」是平滑度的探针：太快说明前期就爆，太慢说明推不动");
console.log();
