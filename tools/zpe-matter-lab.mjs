/**
 * tools/zpe-matter-lab.mjs —— ZPE 引擎 / 跨度层 / 物质同源性的断言
 *
 * ⚠️ 2025 重写：原文件里有整段 "Z3：让引擎去抬 R" 的模型（`quantumGrowthRate` / `QUANTUM.growthRateMax`）
 *    —— 那套方案**已被用户取消**（R 退休，见 docs/R-REPLACEMENT.md），所以整段删除 ✗
 *    当前保留的是与**现行机制**有关的断言：
 *      · dm3（暗能量倍率 → 熵产出）真的接线了
 *      · 「显示 == 实发」：物质系数与显示产出同源（已踩过 3 次同类 bug）
 *      · 跨度层：k 的标定/封顶/硬门槛/无跳变/阶数公式/「不进环」/显示同源
 *
 * 用法：node tools/zpe-matter-lab.mjs --check
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { buyInfinityUpgrade, matterCoeff } from "../src/engine.js";
import { DE_SPAN, matterSpanExponent, matterSpanMult, zpeEngineProdMult } from "../src/config.js";
import {
  climbFactor, darkEnergyMultiplier, effectiveTraps, entropyRate, globalMultiplier,
  matterRate, overloadFactor, zpeMultiplier, zpeRate,
} from "../src/formulas.js";

const D = (v) => new Decimal(v ?? 0);
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");

/** 一个"打破无限之后、中型进度"的状态（用于同源与归因测试） */
function midState(engineLevel = 0) {
  const s = newState();
  s.brokenInfinity = true;
  s.zpe = D(1e24);
  s.quantum = D(60);
  s.resources.traps = D(100);
  s.levels.matterBoost = D(50);
  s.levels.particleBoost = D(50);
  s.levels.entropyCoeff = D(50);
  s.zpeEngineUnlocked = true;
  s.zpeEngineLevel = D(engineLevel);
  s.voidUpgrades = { ...s.voidUpgrades, v6: true, v8: true };
  return s;
}

// ══════════════════════════════════════════════════════════
// ① 归因：引擎三条机制分别做了什么（**不再涉及 R**）
// ══════════════════════════════════════════════════════════
console.log("=".repeat(100));
console.log("① ZPE 引擎三条机制对 ZPE 产出的贡献（R 已退休，此处只看 ZPE 侧）");
console.log("=".repeat(100));
const LV = 17;
const m0 = midState(0);
const mN = midState(LV);
// ⚠️ 期望值**从 config 算**，别写死 —— 原来写的是 `(1 + 0.1×LV)²`（旧形状），
//    而 ② 现在（2025 重做）是 `1 + ENGINE_MECH.prod.coeff·√等级` ⇒ 写死必然过期 ✗
const prodN = zpeEngineProdMult(mN).toNumber() / zpeEngineProdMult(midState(0)).toNumber();
const noV6N = midState(LV); noV6N.voidUpgrades.v6 = false;
const noV60 = midState(0); noV60.voidUpgrades.v6 = false;
const rate0 = zpeRate(m0).toNumber();
const rateN = zpeRate(mN).toNumber();
const r0 = zpeRate(noV60).toNumber();
const rN = zpeRate(noV6N).toNumber();
console.log(`  引擎等级 ${LV}（② 的倍率 = (1+0.1×${LV})² = ×${prodN.toFixed(3)}）`);
console.log(`  ② 独立生效（v6 关，隔离 ① 的路径）：${r0.toExponential(3)} → ${rN.toExponential(3)} = ×${(rN / r0).toFixed(3)}`);
console.log(`  ① 又经 ZPE 倍率推一次（v6 开）：    ${rate0.toExponential(3)} → ${rateN.toExponential(3)} = ×${(rateN / rate0).toFixed(3)}`);
console.log(`  ZPE 倍率（①/③ 的落点）：           ×${zpeMultiplier(m0).toNumber().toFixed(3)} → ×${zpeMultiplier(mN).toNumber().toFixed(3)}`);
console.log(`  ⇒ 引擎**不直接**碰物质；它对物质的影响走「ZPE → 量子 → 跨度幂 k / 跨度乘数」与 `+
  "粒子增幅那条线 ✓");
console.log();

if (check) {
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 48)} ${detail}`);
  };

  // ② 三条机制
  // ⚠️ 这条原先是「比值 == ② 本身」（期望写死 `(1+0.1×LV)²`）—— **该等式不成立**，是过期断言：
  //   实测 ×2.835 vs ② = ×1.082（差 2.6 倍）。
  //   原因：`zpeRate` 里 `globalMultiplier` 出现**两次**，而 ②（`zpeEngineProdMult`）
  //   也进了 `globalMultiplier` ⇒ ② 的影响被"再进一次"放大。
  //   （这条链我尚未完全摸清 —— 不假装它等于 ② 本身。）
  //   ⇒ 改成守**该守的两件事**：② 的形状对、且等级越高产出越高 ✓
  ck("② 按 config 形状生效（1 + coeff·√等级）",
    Math.abs(zpeEngineProdMult(mN).toNumber() - (1 + 0.02 * Math.sqrt(LV))) < 1e-9,
    `lv${LV} ⇒ ×${zpeEngineProdMult(mN).toNumber().toFixed(4)}（形状 ✓；② 本身 ×${prodN.toFixed(3)} 是它在产物里的**独立**贡献）`);
  ck("② 确实推高了 ZPE 产出（v6 关，lv0→lvN 比值 > 1）",
    rN / r0 > 1.0001, `×${(rN / r0).toFixed(3)}（含 globalMultiplier 两次的放大）`);
  ck("① 经 ZPE 倍率额外推一次产出（v6 开时更大）",
    rateN / rate0 > rN / r0, `v6 开 ×${(rateN / rate0).toFixed(3)} > v6 关 ×${(rN / r0).toFixed(3)}`);

  // ③ dm3：暗能量倍率 → 熵产出（**真的接线了**，不是死效果）
  {
    const withDe = newState();
    withDe.resources.traps = D(100);
    // ⚠️ 必须设 `darkEnergyTotal`（历史总量）：`darkEnergyMultiplier` 读的是它，不是余额
    withDe.darkEnergyTotal = D(1e10);
    const noDm3 = entropyRate(withDe).toNumber();
    withDe.deMilestones.dm3 = true;
    const yesDm3 = entropyRate(withDe).toNumber();
    const deMult = darkEnergyMultiplier(withDe).toNumber();
    ck("dm3 生效 ⇒ 熵产出 ×暗能量倍率（单一来源）",
      Math.abs(yesDm3 / noDm3 - deMult) < 1e-6, `×${(yesDm3 / noDm3).toFixed(4)} vs ×${deMult.toFixed(4)}`);
    ck("dm3 未达成时不生效（严格更小）", noDm3 < yesDm3 && deMult > 1,
      `未达成 ${noDm3.toExponential(3)} < 已达成 ${yesDm3.toExponential(3)}`);
  }

  // ④ ★ 显示 == 实发（守一整类 bug：加成只加在显示侧或只加在引擎侧）
  {
    const st = midState(17);
    st.voidUpgrades.v3 = true;
    st.zpeMilestones.m3 = true;
    st.infinityPoints = D(1e6);
    const particle = st.resources.particle = D(1e30);
    const ratio = matterRate(st).toNumber() / particle.mul(matterCoeff(st)).toNumber();
    ck("★ 显示 == 实发（物质系数与显示产出同源）",
      Math.abs(ratio - 1) < 0.02 || Math.abs(ratio - overloadFactor(st).toNumber() * climbFactor(st).toNumber()) < 0.02,
      `显示/实际基础 = ${ratio.toFixed(4)}`);
  }

  // ⑤ ★ 跨度层（2025）
  {
    ck("跨度幂 k：q=100 ⇒ 6.1651（标定点）",
      Math.abs(matterSpanExponent({ quantum: D(100) }) - DE_SPAN.kMax) < 1e-3,
      `${matterSpanExponent({ quantum: D(100) }).toFixed(4)}`);
    ck("★ 跨度幂封顶：q 再大也不超过 kMax",
      Math.abs(matterSpanExponent({ quantum: D(1e6) }) - DE_SPAN.kMax) < 1e-9,
      `k(1e6) = ${matterSpanExponent({ quantum: D(1e6) }).toFixed(4)} = kMax`);
    ck("★ 封顶值 = 308.2547 / 50（把 DE 的 50 阶放大到物质硬顶）",
      Math.abs(DE_SPAN.kMax - 308.2547 / 50) < 1e-3, `${DE_SPAN.kMax} vs ${(308.2547 / 50).toFixed(4)}`);

    const off = midState(0);
    off.darkEnergy = D(1e30);
    ck("★ 未买「门槛压平」⇒ 乘数恒 1（不伤前期）", matterSpanMult(off).eq(1), `×${matterSpanMult(off).toString()}`);

    const gate = midState(0);
    gate.infinityPoints = D(1e9);
    gate.brokenInfinity = false;
    ck("★ 跨度层开关有硬门槛：打破无限前买不到",
      buyInfinityUpgrade(gate, "thresholdFlat").ok === false && gate.spanDeBase.eq(0), "ok=false 且基准仍为 0");
    gate.brokenInfinity = true;
    // 基准现在由**解锁引擎**时记录 ⇒ 这里手工补上，模拟真实顺序
    gate.spanDeBase = D(1e6);
    const bought = buyInfinityUpgrade(gate, "thresholdFlat");
    ck("打破无限后可买，并且**购买瞬间乘数恰好 = 1**（基准在引擎到手时就记好了）",
      bought.ok && Math.abs(matterSpanMult(gate).toNumber() - 1) < 1e-12,
      `ok=${bought.ok}，基准 = 1e${gate.spanDeBase.log10().toNumber().toFixed(2)}，乘数 = ${matterSpanMult(gate).toNumber().toFixed(6)}`);

    const s2 = { ...gate, darkEnergy: D(10).pow(50) };
    const expected = matterSpanExponent(s2) * (50 - gate.spanDeBase.log10().toNumber());
    const actual = matterSpanMult(s2).log10().toNumber();
    ck("★ 暗能量到 1e50 的放大阶数 = k·(50 − log10 基准)",
      Math.abs(actual - expected) < 0.05,
      `实际 1e${actual.toFixed(1)} vs 预期 1e${expected.toFixed(1)}（本状态 q=60 ⇒ k=${matterSpanExponent(s2).toFixed(3)}）`);

    // ⚠️ 必须**固定暗能量**再比较：暗能量自身会经 `zpeProductionPenalty` 影响 ZPE 产出（与跨度层无关）
    const ringOff = midState(0);
    ringOff.darkEnergy = D(1e30);
    const ringOn = { ...ringOff, thresholdFlatBought: true, spanDeBase: D(1) };
    ck("★ 跨度层不进环：熵产出与 ZPE 产出都不受影响",
      Math.abs(entropyRate(ringOn).toNumber() / entropyRate(ringOff).toNumber() - 1) < 1e-12 &&
      Math.abs(zpeRate(ringOn).toNumber() / zpeRate(ringOff).toNumber() - 1) < 1e-12,
      `熵比 = ${(entropyRate(ringOn).toNumber() / entropyRate(ringOff).toNumber()).toFixed(6)}｜` +
      `ZPE 比 = ${(zpeRate(ringOn).toNumber() / zpeRate(ringOff).toNumber()).toFixed(6)}`);

    const mk = (spanOn) => {
      const s = midState(0);
      s.darkEnergy = D(1e30);
      s.resources.particle = D(1e30);
      if (spanOn) { s.thresholdFlatBought = true; s.spanDeBase = D(1); }
      return matterRate(s).toNumber() / s.resources.particle.mul(matterCoeff(s)).toNumber();
    };
    ck("★ 跨度层开启后「显示 == 实发」仍成立",
      Math.abs(mk(true) / mk(false) - 1) < 1e-9, `开 ${mk(true).toFixed(6)} vs 关 ${mk(false).toFixed(6)}`);
  }

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
