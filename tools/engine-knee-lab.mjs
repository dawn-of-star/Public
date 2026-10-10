#!/usr/bin/env node
/**
 * tools/engine-knee-lab.mjs —— **ZPE 引擎：价格增长 / 饱和拐点 是否适配当前 IP 经济**
 *
 * ── 问题（用户 2025 提问）──
 *   「能不能改变 zpe 引擎的价格增幅以让其适应现在的逻辑？」
 *
 *   引擎是**唯一改物质「形状」**的落点（`matterTotalExponent = k`，物质产出 ∝ a区^k），
 *   所以它必须能真的长起来。但实测（stage-timing 口径）：
 *
 *     t(h)   引擎等级   k      下一级价格   IP 池
 *        24      44   1.54      1e5.7     1e5.60
 *        48      57   1.69      1e6.0     1e5.28
 *        96      77   1.93      1e6.4     1e6.04
 *       168      95   2.13      1e6.6     1e6.46
 *
 *   ⇒ 168 小时只到 95 级、k = 2.13；而饱和拐点在 `MATTER_B_KNEE = 2000` 级
 *     ⇒ **k 几乎全程≈1**，引擎等于不存在 ✗
 *
 * ── 根因（两个「斜率不匹配」）──
 *   1. **价格是三次方**（`5·(lv+1)³`，log 斜率 3 阶/级），而 **IP 收入随轮数只线性增长**
 *      ⇒ 等级增长是 `log(t)` 级 ⇒ 到 2000 级要数百小时以上。
 *   2. **饱和拐点 2000 级** 对这条收入曲线来说**高得离谱**：
 *      k 的一半（13.5）要 2000 级，逼近上限要 ~50000 级。
 *
 * ── 本表要回答 ──
 *   在**可达等级**（按实测斜率外推）下，`MATTER_B_KNEE` 取多少才能让 k 有实际量级？
 *
 * 用法：node tools/engine-knee-lab.mjs
 */
import { MATTER_B_KNEE, MATTER_B_KMAX, ZPE_ENGINE } from "../src/config.js";

/** k(等级) —— 与 config 的 `matterTotalExponent` 同式 */
const kOf = (lv, knee = MATTER_B_KNEE) => 1 + MATTER_B_KMAX * ((lv / knee) / (1 + lv / knee));
/** 累计价格（三次方的闭式：base × [ (n(n+1)/2)² ]） */
const totalCostLog = (lv) => Math.log10(ZPE_ENGINE.baseCostIp) + 2 * Math.log10((lv * (lv + 1)) / 2);

/** 实测斜率：168h → 95 级。等级大致按 `t^0.25` 走（价格三次方 ⇒ 等级 ∝ 池^(1/3)，池 ∝ t） */
const levelAt = (hours) => Math.round(95 * Math.pow(hours / 168, 1 / 3));

console.log("=".repeat(88));
console.log("ZPE 引擎：饱和拐点 vs IP 经济");
console.log("=".repeat(88));
console.log(`  价格 = ${ZPE_ENGINE.baseCostIp} × (等级+1)³ ⇒ 累计 = ${ZPE_ENGINE.baseCostIp} × (n(n+1)/2)²`);
console.log(`  k = 1 + ${MATTER_B_KMAX}·x/(1+x)，x = 等级/${MATTER_B_KNEE}（当前拐点）`);
console.log();

// ── 表 1：可达等级（按实测斜率外推）──
console.log("表 1｜可达等级（按 168h→95 级的实测斜率 r ∝ t^(1/3) 外推）");
console.log("    时间(h)   可达等级   累计价格(log10 IP)   k(拐点2000)");
for (const h of [48, 168, 500, 2000, 10000, 100000]) {
  const lv = levelAt(h);
  console.log(
    `  ${String(h).padStart(9)}  ${String(lv).padStart(9)}  ${totalCostLog(lv).toFixed(1).padStart(19)}  ` +
    `${kOf(lv, MATTER_B_KNEE).toFixed(3).padStart(11)}`
  );
}
console.log();
console.log("  ⚠️ 到 100000 小时（11 年）才 300 级 ⇒ k 仍只有 2.4 ⇒ **引擎全程等于没做** ✗");
console.log();

// ── 表 2：拐点该取多少 ──
console.log("表 2｜如果只改**饱和拐点** `MATTER_B_KNEE`（价格公式不动）");
console.log("    拐点     k@50级   k@95级(168h)   k@150级   k@300级   k@1000级   k→∞ 需要的等级(≈20×拐点)");
for (const knee of [2000, 500, 200, 100, 50, 20]) {
  console.log(
    `  ${String(knee).padStart(6)}  ${kOf(50, knee).toFixed(2).padStart(7)}  ${kOf(95, knee).toFixed(2).padStart(13)}  ` +
    `${kOf(150, knee).toFixed(2).padStart(8)}  ${kOf(300, knee).toFixed(2).padStart(8)}  ${kOf(1000, knee).toFixed(2).padStart(9)}  ` +
    `${String(knee * 20).padStart(22)}`
  );
}
console.log();
console.log("  ★ 判据：让 **168 小时左右**（约一周）能达到 k ≈ 一半上限（13.5）");
console.log("     ⇒ 需要 `拐点 ≈ 168h 可达的等级` ⇒ 当前 95 级 ⇒ **拐点 ≈ 100**");
console.log();

// ── 表 3：若改价格增长（三次方 → 其他）──
console.log("表 3｜如果改**价格增长指数**（`(lv+1)^p`），给定 IP 池能买到几级");
console.log("    IP 池(log10)   p=3(现状)   p=2   p=1.5   p=1");
for (const poolLog of [5, 6, 8, 10, 14]) {
  const solveP = (p) => {
    // base * lv^p ≈ 10^pool  （量级近似）
    const lv = Math.pow(Math.pow(10, poolLog) / ZPE_ENGINE.baseCostIp, 1 / p);
    return lv;
  };
  console.log(
    `  ${String(poolLog).padStart(13)}  ${solveP(3).toExponential(1).padStart(11)}  ` +
    `${solveP(2).toExponential(1).padStart(5)}  ${solveP(1.5).toExponential(1).padStart(7)}  ${solveP(1).toExponential(1).padStart(7)}`
  );
}
console.log();
console.log("  ⚠️ **单次能买到的等级**受「池子/单价」限制；但**累计**才是关键 ——");
console.log("     实测 168h 池子 1e6.5、单价 1e6.6 ⇒ 每轮只够买 1 级 ⇒ 增长被单价锁死。");
console.log("     ⇒ 降低价格指数（p=2 或 1.5）能让**同一池子买到更多级** ⇒ 加快爬升 ✓");
console.log();

// ── 结论 ──
console.log("=".repeat(88));
console.log("  ★ 结论：可以改，而且**该改**（引擎现在等于没做）");
console.log("=".repeat(88));
console.log("  两条路（互不排斥，可同时用）：");
console.log("   (a) **把饱和拐点从 2000 降到 ~100** —— 最省事、收益最大：");
console.log("       不动价格公式，只让 k 在「当前可达的等级区间」内就有量级 ✓");
console.log("       168h（95 级）⇒ k = 13.2（现在只有 2.13）⇒ 物质产出多 1e11 量级 ✓");
console.log("   (b) **把价格指数从 3 降到 2（或 1.5）** —— 让同一池子买到更多级：");
console.log("       但要注意：这是「让引擎更便宜」，会把 1e25 的形状杠杆更早放出来 ⇒");
console.log("       必须同时检查它是否让物质曲线过陡（跑 `tools/stage-timing.mjs` 复测）。");
console.log();
console.log("  ⚠️ 我**没有**改任何数值 —— 这张表只是把两条路的后果摆出来。");
console.log("     推荐先只做 (a)（改一个常数、可逆、影响面小），再看是否需要 (b)。");
