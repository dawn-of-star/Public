#!/usr/bin/env node
/**
 * tools/ad-galaxy-shape-lab.mjs —— **AD 星系的真实价格形状**（照源码复算）
 *
 * ── 为什么需要它（我差点搞错）──
 *   用户说「zpe 引擎应当也采用 AD 星系的那种价格增幅逻辑」。
 *   我原以为那是「分段指数」（`costIncreaseThreshold` / `costIncreaseMultiplier`），
 *   但读 `D:\game\AntimatterDimensionsSourceCode\src\core\galaxy.js` 后确认：
 *
 *     amount = baseCost(80) + galaxies × costMult(60)          ← **线性主导**！
 *     DISTANT/DISTANT-EC5：再 `+= g² + g`                      ← **二次**
 *     REMOTE：`×= 1.002^(g − remoteStart + 1)`                 ← **温和指数**（底数仅 1.002）
 *
 *   ⇒ AD 的星系价格是**多项式（线性+二次）为主、指数为辅**的形状，
 *     而且它有 `costScalingStart`（进入远距星系的阈值）与 `remoteStart`（进入超远距的阈值）。
 *
 * ── 本表要回答 ──
 *   1. AD 这条曲线**从 0 到满级**跨多少个数量级？（决定我们能不能照抄「量级」）
 *   2. 它对应的"等级随时间"是收敛还是发散？（与 k→26 的有界效果是否匹配）
 *   3. 我们的引擎（三次方）与之相比，形状差在哪。
 *
 * 用法：node tools/ad-galaxy-shape-lab.mjs
 */
const AD = { baseCost: 80, costMult: 60, remoteStart: 800, residual: 1.002 };

/** AD 星系价格（照 `galaxy.js` 的 `requirementAt`，去掉挑战/升级修正） */
function adGalaxyCost(g, { costScalingStart = 100, type = "REMOTE" } = {}) {
  let amount = AD.baseCost + g * AD.costMult;
  if (type === "DISTANT" || type === "REMOTE") {
    const before = Math.max(0, g - costScalingStart + 1);
    amount += before * before + before;
  }
  if (type === "REMOTE") amount *= Math.pow(AD.residual, g - (AD.remoteStart - 1));
  return amount;
}

console.log("=".repeat(88));
console.log("AD 星系的真实价格形状（照源码复算）");
console.log("=".repeat(88));
console.log(`  baseCost=${AD.baseCost}｜costMult=${AD.costMult}｜remoteStart=${AD.remoteStart}｜remote 底数=${AD.residual}`);
console.log();

console.log("表 1｜价格曲线（几组 costScalingStart）");
console.log("     星系 g    纯线性部分    +二次(阈值100)   +二次(阈值10)    +remote(阈值800)");
for (const g of [0, 10, 50, 100, 200, 500, 800, 1000, 2000, 5000]) {
  const lin = AD.baseCost + g * AD.costMult;
  const q100 = adGalaxyCost(g, { costScalingStart: 100, type: "DISTANT" });
  const q10 = adGalaxyCost(g, { costScalingStart: 10, type: "DISTANT" });
  const rem = adGalaxyCost(g, { costScalingStart: 100, type: "REMOTE" });
  console.log(
    `  ${String(g).padStart(9)}  ${lin.toExponential(2).padStart(13)}  ${q100.toExponential(2).padStart(16)}  ` +
    `${q10.toExponential(2).padStart(16)}  ${rem.toExponential(2).padStart(17)}`
  );
}
console.log();

console.log("表 2｜跨多少数量级（这是「能不能照抄量级」的关键）");
for (const [label, opt] of [
  ["纯线性", { costScalingStart: 1e9, type: "LINEAR" }],
  ["+二次(阈值100)", { costScalingStart: 100, type: "DISTANT" }],
  ["+二次+remote", { costScalingStart: 100, type: "REMOTE" }],
]) {
  const a = adGalaxyCost(0, opt), b = adGalaxyCost(5000, opt);
  console.log(`  ${label.padEnd(18)} 0 级 ${a.toExponential(1)} → 5000 级 ${b.toExponential(2)}  = 跨 ${Math.log10(b / a).toFixed(1)} 个数量级`);
}
console.log();
console.log("  ⚠️ AD 的星系**满级也就几千个**，价格跨度只有几个数量级（因为它的货币是反物质，");
console.log("     而反物质本身跨 1e308）—— 而**我们的货币是无限点**，量级完全不同 ✗");
console.log();

console.log("表 3｜形状 vs 效果的匹配（同一套判据）");
console.log("  机制            价格形状            效果形状            匹配?");
console.log("  AD 星系         线性+二次(+1.002^)    ×(1+0.02·g)^… 乘性  ✅ 都不收敛");
console.log("  我们 ①          分段指数(×10→×1000)  2^lv（无上限）       ✅ 都不收敛");
console.log("  我们 引擎       三次方(多项式)        k→26（**有上限**）   ❌ 一个收敛一个不收敛");
console.log();

console.log("=".repeat(88));
console.log("  ★ 结论");
console.log("=".repeat(88));
console.log("  1. 「照抄 AD 星系的**形状**」= 多项式（线性+二次为主）= **就是我们现在三次方的近亲** ✗");
console.log("     ⇒ 形状问题**照抄 AD 解决不了**：AD 的效果是**乘性、不收敛**的，");
console.log("       所以它用多项式价格是**自洽**的；而我们的 k→26 **有上限**，用多项式就不自洽。");
console.log("  2. 真正该照抄的是 **AD 的「阈值分段」机制**（`costScalingStart` / `remoteStart`）：");
console.log("     在一段里用便宜的增长率，过阈值后**跳到一个更陡的增长率**。");
console.log("     ⇒ 这正是我们 ① 已经在用的手法（×10 → ×100 → ×1000 分段）✓");
console.log("  3. 所以引擎的正确做法是**把「阈值分段」用在指数底数上**：");
console.log("       `cost ∝ r_seg^lv`，`r_seg` 随段跳（例如 ×1.05 → ×1.2 → ×2）");
console.log("     这样既有 AD 的「分段跳档」手感，又让**等级收敛**（与 k 的有界性匹配）✓");
console.log();
console.log("  ⇒ 需要你定的就是**跳档阈值**与**每段的底数**（下一张表给出对照）。");
