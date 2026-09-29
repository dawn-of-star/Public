#!/usr/bin/env node
/**
 * tools/audit.mjs —— 关键数值审计（独立复算）
 *
 * ── 原则 ──
 * 「调用同一个函数两次」不算验证。每一项都要用**另一条路**算出同一个量，
 * 再和实现比对。所以下面大量使用暴力累加 / 手写表达式来交叉验证闭式解。
 *
 * ── 覆盖 ──
 *   A. 购买闭式解   vs 暴力累加
 *   B. 描述声称值   vs 实际公式
 *   C. 核心产出链   逐项拆解
 *   D. 第四层       暗物质 / 坍缩阶梯 / 量子 / 无限点
 */

import Decimal from "../dist/break_eternity.esm.js";
import { newState, levelOf, deLevelOf } from "../src/state.js";
import {
  BASE, COLLAPSE, DE_UPGRADES, QUANTUM, REPEATABLE, ZPE_MILESTONES, VOID_UPGRADES,
  computeS, crunchThreshold, quantumGrowthRate, infinityPointGain,
  quantumDeGainBonus, quantumDeMultBonus, quantumEntropyMultiplier,
  quantumZpeRequirement, dreamUpgradeEffects,
} from "../src/config.js";
import {
  conversion, darkEnergyGainPerConversion, darkEnergyMultiplier, effectiveTraps,
  entropyRate, countFreqAddTerm, globalMultiplier, matterRate, particleRate,
  repeatableCost, trapCost, zpeMultiplier, zpeRate,
} from "../src/formulas.js";
import { affordableCount, buyRepeatable, buyTrap } from "../src/engine.js";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? "  " + detail : ""}`); }
};
const near = (a, b, rel = 1e-9) => {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x === y) return true;
  return Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * rel;
};
const D = (v) => new Decimal(v);
const hr = (t) => "─".repeat(t);
const sec = (t) => { console.log(); console.log(hr(72)); console.log(t); console.log(hr(72)); };

/** 暴力累加前 n 级的总价（等比数列，直接逐项加） */
function bruteGeom(base, r, n) {
  let sum = D(0), cur = D(base);
  for (let i = 0; i < n; i++) { sum = sum.add(cur); cur = cur.mul(r); }
  return sum;
}

// ══════════════════════════════════════════════════════════
sec("A. 购买闭式解  vs  暴力累加");
// ══════════════════════════════════════════════════════════

// A1. buyRepeatable(max)：总扣款应等于暴力累加
{
  const st = newState();
  st.resources.matter = D("1e60");
  st.levels.matterBoost = D(0);
  const before = st.resources.matter;
  const n = buyRepeatable(st, "matterBoost", true);
  const spent = before.sub(st.resources.matter);
  // 暴力：从 0 级开始，价格 baseCost × r^i
  const cfg = REPEATABLE.matterBoost;
  const expect = bruteGeom(cfg.baseCost, cfg.costMult, n);
  ok("A1 buyRepeatable 总价 = 暴力累加", near(spent.toString(), expect.toString(), 1e-9),
    `买 ${n} 级，扣 ${spent.toExponential(4)} vs 累加 ${expect.toExponential(4)}`);
}

// A2. buyTrap(max)：同理
{
  const st = newState();
  st.resources.matter = D("1e40");
  const before = st.resources.matter;
  const n = buyTrap(st, true);
  const spent = before.sub(st.resources.matter);
  const expect = bruteGeom(BASE.trapBaseCost, BASE.trapCostMult, n);
  ok("A2 buyTrap 总价 = 暴力累加", near(spent.toString(), expect.toString(), 1e-9),
    `买 ${n} 个，扣 ${spent.toExponential(4)} vs 累加 ${expect.toExponential(4)}`);
}

// A3. 买完之后「再买一个」应该买不起
{
  const st = newState();
  st.resources.matter = D("1e60");
  buyRepeatable(st, "matterBoost", true);
  const next = repeatableCost(st, "matterBoost");
  ok("A3 买满后再买不起下一级", st.resources.matter.lt(next),
    `剩余 ${st.resources.matter.toExponential(3)} < 下级价 ${next.toExponential(3)}`);
}

// A4. affordableCount 与实际能买的级数一致（不依赖闭式解）
{
  const st = newState();
  st.resources.matter = D("1e30");
  const n = affordableCount(st, "matterBoost");
  // 独立复算：买 k 级总价 = base×(r^k−1)/(r−1) ≤ pool  ⇒  k = floor(log_r(pool(r−1)/base + 1))
  // （第一次我把这条写成了 log_r(base + pool(r−1))，那是错的 —— 审计工具自己也会错。）
  const cfg = REPEATABLE.matterBoost;
  const manual = Math.floor(
    Math.log(st.resources.matter.toNumber() * (cfg.costMult - 1) / cfg.baseCost + 1) / Math.log(cfg.costMult),
  );
  ok("A4 affordableCount 与手写式一致", n === manual, `实现 ${n}，手写 ${manual}`);
  // 再用第三条路验证：暴力累加 n 级买得起，n+1 级买不起
  const pool = st.resources.matter;
  const sumN = bruteGeom(cfg.baseCost, cfg.costMult, n);
  const sumN1 = bruteGeom(cfg.baseCost, cfg.costMult, n + 1);
  ok("A4b 暴力复核：n 级买得起、n+1 级买不起",
    pool.gte(sumN) && pool.lt(sumN1),
    `${sumN.toExponential(3)} ≤ ${pool.toExponential(3)} < ${sumN1.toExponential(3)}`);
}

// ══════════════════════════════════════════════════════════
sec("B. 描述声称值  vs  实际公式");
// ══════════════════════════════════════════════════════════

// B1. particleBoost 声称「所有产出 ×countFreqAddTerm」
{
  const st = newState();
  st.levels.particleBoost = D(100);
  // 实现在 globalMultiplier 里乘 countFreqAddTerm；独立复算 1 + 0.05×100
  const manual = 1 + 0.05 * 100;
  ok("B1 particleBoost 实际 = 1+0.05×等级", near(countFreqAddTerm(st).toString(), manual),
    `${countFreqAddTerm(st).toString()} vs ${manual}（旧描述曾写 ×1.1^等级 = ×13780）`);
}

// B2. matterBoost 声称「物质产出 ×effect^等级」—— effect 必须**从 config 读**，
//     不能在测试里写死。第一次我写了 1.125（削 S 之前的值），于是误报。
{
  const M = REPEATABLE.matterBoost.effect;
  const st = newState();
  st.levels.matterBoost = D(20);
  const manual = Math.pow(M, 20);
  const a = newState(); a.levels.matterBoost = D(20);
  const b = newState(); b.levels.matterBoost = D(0);
  a.resources.particle = D(1); b.resources.particle = D(1);
  const ratio = matterRate(a).div(matterRate(b)).toNumber();
  ok(`B2 matterBoost = ${M}^等级`, near(ratio, manual, 1e-9),
    `实算 ${ratio.toFixed(6)} vs 手算 ${manual.toFixed(6)}`);
}

// B3. 熵凝聚：显示值与 conversion() 一致
{
  const st = newState();
  st.levels.entropyCoeff = D(50);
  const cv = conversion(st);
  const rate = cv.output.div(cv.threshold).toNumber();
  const manual = (1 + 0.15 * 50) / (100 + 3 * 50);
  ok("B3 熵凝聚转换率 = (1+0.15n)/(100+3n)", near(rate, manual, 1e-9),
    `${rate.toFixed(8)} vs ${manual.toFixed(8)}`);
}

// B4. 每个一次性升级的 desc 都真实存在且非空
{
  let bad = [];
  for (const cfg of [...Object.values(VOID_UPGRADES), ...Object.values(DE_UPGRADES)]) {
    if (!cfg.desc) bad.push(cfg.id);
  }
  ok("B4 所有一次性升级都有 desc", bad.length === 0, bad.length ? bad.join(", ") : "");
}

// ══════════════════════════════════════════════════════════
sec("C. 核心产出链（逐项拆解）");
// ══════════════════════════════════════════════════════════

// C1. globalMultiplier 拆解
{
  const st = newState();
  st.dreamPoints = D(50);
  st.darkEnergy = D("1e6");
  st.levels.particleBoost = D(30);
  st.quantum = D(40);
  // ⚠️ 这个期望值必须跟着实现走，它已经被改过两次：
  //    ① 量子从 globalMultiplier 移到 entropyRate -> 去掉量子因子
  //    ② 暗物质体系整个删除（用户决定）-> 去掉 10^DM 因子
  //    每次实现一变它就报错，这正是它有用的证明。
  const manual = D(1).add(D(50).mul(0.02))            // 梦想点
    .mul(D(1).add(D(30).mul(0.05)))                   // 仿射项
    .mul(darkEnergyMultiplier(st));                   // 暗能量（含量子的 q² 基础加成）
  ok("C1 globalMultiplier 拆解一致", near(globalMultiplier(st).toString(), manual.toString(), 1e-9),
    `${globalMultiplier(st).toExponential(4)} vs ${manual.toExponential(4)}`);
}

// C2. entropyRate 拆解
{
  const st = newState();
  st.resources.traps = D(100);
  const manual = effectiveTraps(st)
    .mul(globalMultiplier(st))
    .mul(BASE.trapBaseRate)
    .mul(zpeMultiplier(st))
    .mul(1);
  ok("C2 entropyRate = 熵阱 × 全局 × 基数 × ZPE倍率 × v2", near(entropyRate(st).toString(), manual.toString(), 1e-9),
    `${entropyRate(st).toExponential(4)}`);
}

// C3. particleRate = 熵产出 / 阈值 × 产出
{
  const st = newState();
  st.resources.traps = D(100);
  const cv = conversion(st);
  const manual = entropyRate(st).div(cv.threshold).mul(cv.output);
  ok("C3 particleRate = 熵产出 / 阈值 × 产出", near(particleRate(st).toString(), manual.toString(), 1e-9),
    `${particleRate(st).toExponential(4)}`);
}

// C4. matterRate = 粒子 × 0.1 × 物质乘区 × 全局加成
{
  const st = newState();
  st.resources.particle = D("1e10");
  const manual = st.resources.particle.mul(BASE.matterPerParticle)
    .mul(D(1).pow(levelOf(st, "matterBoost")))       // 等级 0 -> 1
    .mul(globalMultiplier(st));
  ok("C4 matterRate 拆解一致", near(matterRate(st).toString(), manual.toString(), 1e-9),
    `${matterRate(st).toExponential(4)}`);
}

// ★ C5 / C6 / C7 / C8 已删除。
//
//   它们测的是「暗物质倍率 10^DM」和「坍缩阈值阶梯 base × step^n」——
//   整个体系被移除了（用户决定：暗物质不应存在）。
//
//   移除的原因不是调参，是**形式**：
//     `10^DM` 只能给 `log10(M) ∝ 2·log10(t) + 常数` 加常数，
//     累积到 1e560 时把曲线平移了几百个数量级 -> 阶梯 3 秒跑完。
//   现在由量子涨落提供 `∝ M` 的指数项（见下面 D 段的 D3）。

// ══════════════════════════════════════════════════════════
sec("D. 量子 / 无限点");
// ══════════════════════════════════════════════════════════

// D1. 量子门槛 = 1e10 × (zpeCostGrowth × zpeCostExtraNerf)^对数
//
// ⚠️ 期望值必须从 config 读，不能写死 10 —— 用户加了「再 ×2」的削弱后
//    写死的期望值立刻报错。这正是有效测试的表现（实现变了它就响）。
{
  let allOk = true, detail = "";
  const step = D(QUANTUM.zpeCostGrowth).mul(QUANTUM.zpeCostExtraNerf ?? 1);
  for (const n of [0, 1, 5, 20]) {
    const manual = D(QUANTUM.zpeBaseCost).mul(step.pow(n));
    if (!quantumZpeRequirement(D(n)).eq(manual)) { allOk = false; detail = `n=${n}`; }
  }
  ok(`D1 量子门槛 = 1e10 × ${step}^已捕获对数`, allOk, detail || `n = 0/1/5/20 全部正确（步长 ${step}）`);
}

// D2. 量子三效果（按用户最终定义）
//
//   · 熵生产        ×(1+q)          —— 基础公式**最外层**的最终倍数加成
//   · 暗能量倍率     基础加成 +q²     —— a区，加进括号
//   · 暗能量获取     基础加成 +log10(q) —— a区，加进括号
{
  const q = D(100);
  ok("D2a 熵生产最终倍率 = 1+q", quantumEntropyMultiplier(q).eq(101), quantumEntropyMultiplier(q).toString());
  ok("D2b 暗能量倍率基础加成 = q²", quantumDeMultBonus(q).eq(10000), `+${quantumDeMultBonus(q)}`);
  ok("D2c 暗能量获取基础加成 = log10(q)", quantumDeGainBonus(q).eq(2), `+${quantumDeGainBonus(q)}`);
  // 边界：q=0 时加成必须为 0（否则会把括号顶起来）
  ok("D2d q=0 时两个基础加成都为 0",
    quantumDeMultBonus(D(0)).eq(0) && quantumDeGainBonus(D(0)).eq(0),
    `+${quantumDeMultBonus(D(0))} / +${quantumDeGainBonus(D(0))}`);
}

// D3. 无限点收益
{
  const cap = crunchThreshold();
  ok("D3a 未打破时固定 1", infinityPointGain(cap.mul(1000), false).eq(1));
  // 用**非边界**值，避开浮点边界（10^616.5094 再取 log10 会得到 616.50939999…）
  const cases = [[616.5094 * 2 + 1, 2], [308.2547 * 3 + 1, 3], [308.2547 * 4 + 1, 4]];
  let allOk = true, detail = "";
  for (const [e, k] of cases) {
    const got = infinityPointGain(D(10).pow(e), true).toNumber();
    const want = Math.floor(Math.pow((e) / 308.2547, 2));
    if (got !== want) { allOk = false; detail = `1e${e.toFixed(1)}: ${got} vs ${want}`; }
  }
  ok("D3b 打破后 = floor((log10 M / 308.2547)^2)", allOk, detail || "三组非边界值全部正确");
  // 边界行为单独记录（浮点导致可能差 1，但有 max(1,·) 兜底）
  const atCap = infinityPointGain(cap, true).toNumber();
  ok("D3c 阈值处至少给 1（max 兜底）", atCap >= 1, `1e308.2547 -> ${atCap}`);
}

// D4. S 判据的每一项都能手算复核
{
  const { S, parts } = computeS(newState());
  let manual = 0;
  for (const p of parts) manual += Math.log(p.m) / Math.log(p.r);
  ok("D4 S = Σ log(m)/log(r)", near(S, manual), `S = ${S.toFixed(6)}`);
  ok("D4b S < 1", S < 1, `余量 ${(1 - S).toFixed(4)}`);
}

// ══════════════════════════════════════════════════════════
console.log();
console.log(hr(72));
console.log(`  审计结果：${pass} 项通过，${fail} 项失败`);
console.log(hr(72));
console.log();
process.exit(fail ? 1 : 0);
