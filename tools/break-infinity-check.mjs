#!/usr/bin/env node
/** tools/break-infinity-check.mjs —— 验证「打破无限」三阶段 */

import Decimal from "../dist/break_eternity.esm.js";
import { BREAK_INFINITY, CRUNCH_AT_LABEL, infinityPointGain, crunchThreshold } from "../src/config.js";
import { newState } from "../src/state.js";
import { breakInfinity, doBigCrunch, tick } from "../src/engine.js";
import { canBigCrunch } from "../src/formulas.js";

const pad = (s, n) => String(s).padEnd(n);
const cap = crunchThreshold();

console.log("=".repeat(76));
console.log("打破无限：三阶段验证");
console.log("=".repeat(76));
console.log();
console.log(`  阈值 ${CRUNCH_AT_LABEL}   解锁价 ${BREAK_INFINITY.unlockCost} 无限点`);
console.log();

const st = newState();
st.peakMatter = new Decimal("1e30");   // 解锁第四层

// ── 阶段 ①：未打破，物质硬顶 ──
console.log("【① 未打破】物质硬顶在阈值，到顶强制大坍缩");
// 先把坍缩阈值推到超过大坍缩阈值，模拟「梯子已经爬完」
st.resources.matter = cap.mul(10);      // 故意超出去
tick(st, 0.001);
console.log(`  投入 1e309 物质 -> 实际 ${st.resources.matter.toString()}`);
// 大坍缩会重置物质，所以正确的结果是「不高于阈值」（被压住或被重置）
console.log(`  物质未超过阈值        ${st.resources.matter.lte(cap) ? "✅" : "❌"}（大坍缩会重置为 0）`);
console.log(`  强制触发大坍缩        ${st.bigCrunchCount.gte(1) ? "✅" : "❌"}`);
console.log(`  获得无限点            ${st.infinityPoints.toString()}  ${st.infinityPoints.eq(1) ? "✅ 固定 1" : "❌"}`);
console.log(`  brokenInfinity        ${st.brokenInfinity}  ${st.brokenInfinity === false ? "✅ 还没打破" : "❌"}`);
console.log();

// ── 阶段 ②：打破无限 ──
console.log("【② 花无限点打破】");
// 解锁价现在是 128（设计意图：逼玩家多次无限攒点），所以先把点数补足
st.infinityPoints = st.infinityPoints.add(BREAK_INFINITY.unlockCost);
const before = st.infinityPoints.toString();
const ok = breakInfinity(st);
console.log(`  breakInfinity()       ${ok ? "✅ 成功" : "❌ 失败"}`);
console.log(`  无限点                ${before} -> ${st.infinityPoints.toString()}（花掉 ${BREAK_INFINITY.unlockCost}）`);
console.log(`  brokenInfinity        ${st.brokenInfinity}  ${st.brokenInfinity ? "✅" : "❌"}`);
console.log();

// ── 阶段 ③：上限解除 + 手动 + 深度收益 ──
console.log("【③ 打破后】上限解除，手动大坍缩，收益随深度增长");
// 大坍缩会把坍缩阈值重置回起点，所以这里要重新把它推到「阶梯终点」之后，
// 否则自动梯度会把物质吃掉（这正是梯子必须有终点的原因）
st.resources.matter = cap.mul(1000);    // 1e311.25
tick(st, 0.001);
console.log(`  投入 1e311 物质 -> 实际 ${st.resources.matter.toString()}`);
console.log(`  上限已解除            ${st.resources.matter.gt(cap) ? "✅ 超过阈值了" : "❌ 还被压着"}`);
console.log(`  大坍缩未自动触发      ${st.bigCrunchCount.eq(1) ? "✅ 仍是 1 次" : "❌ 自动触发了"}`);
console.log(`  canBigCrunch()        ${canBigCrunch(st) ? "✅ 按钮可用" : "❌"}`);
console.log();

console.log("  深度收益曲线：");
console.log(`  ${pad("物质", 14)} ${pad("无限点", 10)}`);
console.log("  " + "-".repeat(26));
for (const e of [308, 400, 616, 1000, 2000, 3000, 5000, 10000]) {
  const m = new Decimal(10).pow(e);
  console.log(`  ${pad("1e" + e, 14)} ${pad(infinityPointGain(m, true).toString(), 10)}`);
}
console.log();

const manual = doBigCrunch(st);
console.log(`  手动大坍缩            ${manual ? "✅ 成功" : "❌ 失败"}，本次拿到 ${manual?.infinityPoints?.toString()} 无限点`);
console.log(`  大坍缩次数            ${st.bigCrunchCount.toString()}`);
console.log();
