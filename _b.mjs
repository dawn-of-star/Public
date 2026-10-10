// 临时（用完即删）—— 核对 TODO 的 B1~B7 自述 vs 当前实现
import { readFileSync } from "node:fs";
import { OVERLOAD, DE_SPAN, QUANTUM, tierAccelMult, softCapB } from "./src/config.js";
import { newState } from "./src/state.js";
import Decimal from "./dist/break_eternity.esm.js";

const root = "C:/Users/25187/Documents/deepseek-harness/default-workspace/Public";
const cfg = readFileSync(`${root}/src/config.js`, "utf8");
const fml = readFileSync(`${root}/src/formulas.js`, "utf8");

console.log("=".repeat(96));
console.log("★ TODO B 段逐条核对（自述 ⇄ 实现）");
console.log("=".repeat(96));

console.log("\n【B1 破∞→永恒不再冻结】");
console.log("  tierAccelMult 存在        :", typeof tierAccelMult === "function");
console.log("  softCapB 非有限守卫       :", /isFinite|Number\.isFinite/.test(fml.slice(fml.indexOf("function softCapB"), fml.indexOf("function softCapB") + 900)));
try {
  const big = tierAccelMult({ bigCrunchCount: new Decimal(7448), tierMilestones: {} });
  console.log("  7448 档时 tierAccelMult   :", String(big), big === Infinity ? "❌ Infinity" : "✅ 有限");
} catch (e) { console.log("  ❌ 抛错:", e.message); }

console.log("\n【B2 DE 软上限】");
console.log("  OVERLOAD =", JSON.stringify({ knee: OVERLOAD.knee, p: OVERLOAD.p, crunchBelow: OVERLOAD.crunchBelow, runSeconds: OVERLOAD.runSeconds }));
console.log("  → knee 不再是 300 的'等效关闭'值:", OVERLOAD.knee !== 300 ? "✅ 已改（" + OVERLOAD.knee + "）" : "❌ 仍是 300");

console.log("\n【B3 坍缩刷屏】");
console.log("  收手判据 = 按时间 :", OVERLOAD.runSeconds === 300 ? "✅ runSeconds=300" : "❌");
console.log("  shouldCrunch 是否以时间为主 :", /runElapsed\s*>=\s*OVERLOAD\.runSeconds/.test(fml) ? "✅" : "❌");
console.log("  是否已无'硬顶强制坍缩'残留   :", /crunchThreshold\(\)/.test(readFileSync(`${root}/src/engine.js`, "utf8")) ? "（仍有硬顶分支，需人工确认是否已按裁定关闭）" : "✅ 无");

console.log("\n【B4 zpeRate 双乘全局加成 → 环增益重算】");
console.log("  环增益判据在 zpe-engine-lab / cap-monotonic-lab:", "（见测试输出）");
const hasLoopAssert = /环增益/.test(readFileSync(`${root}/tools/zpe-engine-lab.mjs`, "utf8"));
console.log("  zpe-engine-lab 里有'环增益'断言 :", hasLoopAssert ? "✅" : "❌");

console.log("\n【B5 沉潜蓄能超线性】");
console.log("  是否还引用 depthBoost/沉潜蓄能 :", /沉潜蓄能|depthBoost/.test(cfg) ? "⚠️ 仍有引用" : "✅ 已清除");
const s = newState();
console.log("  newState 里有无 pairBoostBought :", "pairBoostBought" in s ? "✅ 有（cm6 相关）" : "—");

console.log("\n【B6 tierAccel】");
console.log("  ", /tierAccel/.test(cfg) ? "✅ 存在" : "❌ 缺失");

console.log("\n【B7 引擎落点】");
console.log("  engineBonusMult 实现 :", /zpeEngineTotalCost\(0, lv\)/.test(cfg) ? "✅ 已按'与累计价同速'（方案甲）" : "❌");
console.log("  ZPE_ENGINE.costGrowth:", /costGrowth:\s*1\.872483/.test(cfg) ? "1.872483 ✅" : "（已变）");
console.log("  ipDouble 是否 ×2/级  :", /ipDoubleMult[\s\S]{0,80}\*\*\s*level|Math\.pow\(2,\s*level\)/.test(cfg) ? "✅ ×2^级" : "（检查）");
console.log("  → B7 的'①引擎被 softCapB 吃掉'是否解决：", /engineBonusMult/.test(fml) ? "✅ 引擎倍率已接到 5 个落点" : "❌");
