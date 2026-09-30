/**
 * tools/eternity-lab.mjs —— 永恒层（**占位版**：只有门槛 + 永恒点公式）
 *
 * 公式来源：AD `src/core/secret-formula/multiplier-tab/eternity-points.js`
 *   `base.multValue: () => DC.D5.pow( log10(maxIP) / (308 − Pelle) − 0.7 )`
 * 即 **EP = floor( 5^(log10(IP)/308 − 0.7) )**。
 *
 * 本工具守三件事：
 *   1. 公式与 AD 一致（含"门槛处正好 1 点"这条手感基线）；
 *   2. 门槛 = 1e308.25（AD 的 eternityGoal 也是 1.79e308 ≈ 同一数字）；
 *   3. ★ 用户指定的差异：永恒层**没有**"到 1e308.25 强制触发"的机制 ——
 *      所以源码里不该出现任何"自动/强制永恒"的调用（用源码守卫钉住）。
 *
 * 用法：node tools/eternity-lab.mjs [--check]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "../dist/break_eternity.esm.js";
import { ETERNITY, eternityPointGain, BREAK_INFINITY } from "../src/config.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");

// AD 的原始公式，独立重写一遍（不用项目里的实现，避免"自己验自己"）。
//
// ⚠️ 必须**在 log 空间**复算：AD 的 IP 是普通 Number（上限 1.79e308），
//    而我们的 IP 是 Decimal，会超过这个上限 —— `toNumber()` 一越界就是 Infinity，
//    第一版据此把每一行都判成"不一致"（是测试的锅）。
const adFormulaLog10 = (log10ip) => {
  if (log10ip < 308.25) return null;                 // 不到门槛
  const log10ep = (log10ip / 308 - 0.7) * Math.log10(5);
  return log10ep < 300 ? Math.floor(Math.pow(10, log10ep)) : `1e${log10ep.toFixed(2)}`;  // 太大就报 log
};

const goal = new Decimal(10).pow(ETERNITY.goalLog10);
const rows = [
  ["门槛 −1 阶", new Decimal(10).pow(ETERNITY.goalLog10 - 1)],
  ["门槛（正好）", goal],
  ["门槛 +10 阶", new Decimal(10).pow(ETERNITY.goalLog10 + 10)],
  ["门槛 +100 阶", new Decimal(10).pow(ETERNITY.goalLog10 + 100)],
  ["门槛 +308 阶", new Decimal(10).pow(ETERNITY.goalLog10 + 308)],
  ["1e1000", new Decimal("1e1000")],
  ["1e1e6", new Decimal("1e1000000")],
];

console.log("=".repeat(92));
console.log("永恒点公式（照 AD：5^(log10(IP)/308 − 0.7)）");
console.log("=".repeat(92));
console.log(`  ${pad("无限点", 16)} ${pad("本项目实现", 16)} ${pad("AD 原式复算", 16)} 一致`);
for (const [label, ip] of rows) {
  const mine = eternityPointGain(ip);
  const ad = adFormulaLog10(ip.log10().toNumber());
  // 结果本身没超 1e300 就比精确值；超了就比 log10（Number 装不下）
  const same = mine.eq(0) ? ad === null : (typeof ad === "string"
    ? `1e${mine.log10().toNumber().toFixed(2)}` === ad
    : mine.eq(ad));
  console.log(`  ${pad(label, 16)} ${pad(mine.toString(), 16)} ${pad(String(ad), 16)} ${same ? "✅" : "❌"}`);
}
console.log();
console.log(`  门槛（ETERNITY.goalLog10） = ${ETERNITY.goalLog10.toFixed(4)}   （物质上限同一个数字）`);
console.log(`  除数 ${ETERNITY.divisor}、底数 ${ETERNITY.base}、偏移 ${ETERNITY.offset}` + "   ← 与 AD 逐项一致");

if (check) {
  console.log();
  console.log("=".repeat(92));
  console.log("定点断言");
  console.log("=".repeat(92));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 42)} ${detail}`);
  };
  ck("门槛 = 物质上限（同一个数字）",
    Math.abs(ETERNITY.goalLog10 - BREAK_INFINITY.maxLog10) < 1e-9,
    `${ETERNITY.goalLog10.toFixed(4)} vs ${BREAK_INFINITY.maxLog10.toFixed(4)}`);
  ck("不到门槛给 0 点", eternityPointGain(goal.div(10)).eq(0),
    `门槛 −1 阶 → ${eternityPointGain(goal.div(10)).toString()}`);
  ck("★ 门槛处正好给 1 点（AD 的手感基线）", eternityPointGain(goal).eq(1),
    `→ ${eternityPointGain(goal).toString()} 点（5^0.3008 = 1.62 → floor 1）`);
  ck("常数与 AD 逐项一致",
    ETERNITY.base === 5 && ETERNITY.divisor === 308 && Math.abs(ETERNITY.offset - 0.7) < 1e-12,
    `5^((log10 IP)/308 − 0.7)`);
  let allSame = true;
  for (let e = 300; e <= 3200; e += 13) {           // 抽稀扫一遍，和独立复算比
    const ip = new Decimal(10).pow(e);
    const mine = eternityPointGain(ip);
    const ad = adFormulaLog10(e);
    if (mine.eq(0)) { if (ad !== null) allSame = false; continue; }
    if (typeof ad === "string") {
      if (`1e${mine.log10().toNumber().toFixed(2)}` !== ad) allSame = false;
    } else if (!mine.eq(ad)) allSame = false;
  }
  ck("扫一遍（1e300~1e3200）与独立复算完全一致", allSame, "每 13 阶取一个点");
  // ★ 差异项：没有强制触发
  const engineSrc = readFileSync(join(ROOT, "src", "engine.js"), "utf8");
  const forced = /doEternity\s*\(|forceEternity|autoEternity/i.test(engineSrc) &&
    /tick[\s\S]{0,4000}doEternity/.test(engineSrc);
  ck("★ 没有「到门槛自动/强制永恒」的调用", !forced,
    forced ? "engine.js 里似乎有自动永恒" : "engine.js 里查不到自动永恒调用（符合「手动触发」）");
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
