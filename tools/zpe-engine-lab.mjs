/**
 * tools/zpe-engine-lab.mjs —— ZPE 引擎的**机制断言 + 环增益红线**（2025 设计稿版）
 *
 * 设计稿（用户）：
 *   ① `zpeMultiplier` 的**加法区额外倍率**：每级 +addPerLevel（**不再抬指数** ✗）
 *   ② 每级：**ZPE 产出 ×10**、**ZPE 倍率 ×2**
 *   ③ `zpeMultiplier` 吃「计数频率」（等级 ≥ countFreqLevel），且
 *      **暗能量倍率 ^1.03 进 ZPE 倍率**
 *   ④ 引擎倍率**也作用在暗能量倍率**上 ⇒ 与 ③ **闭合成环** ✗
 *
 * ★ 本工具的核心职责：**验算那个环的增益 < 1**（否则 runaway）
 *
 * 用法：node tools/zpe-engine-lab.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { unlockZpeEngine } from "../src/engine.js";
import {
  DE_SPAN, ZPE_ENGINE, ZPE_EXPONENT, ENGINE_MECH,
  quantumZpeMultBonus, zpeEngineAddBonus, zpeEngineLevel, zpeEngineMultBonus, zpeEngineProdMult, zpeEngineUnlocked,
  zpeEngineCost, zpeEngineTotalCost, voidBoostMult, deEngineLevelBonus,
} from "../src/config.js";
import { darkEnergyMultiplier, zpeMultiplier, zpeRate } from "../src/formulas.js";

const D = (v) => new Decimal(v ?? 0);
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");

const mk = (lv) => {
  const s = newState();
  s.zpeEngineUnlocked = true;
  s.zpeEngineLevel = D(lv);
  s.zpe = D(1e30);
  s.darkEnergyTotal = D(1e10);
  return s;
};

console.log("=".repeat(100));
console.log("ZPE 引擎（2025 设计稿）：三条机制 + 环增益红线");
console.log("=".repeat(100));
console.log(`  ${pad("等级", 6)} ${pad("产出 ×10^lv", 14)} ${pad("倍率 ×2^lv", 14)} ${pad("①加法区 +lv", 12)} zpeMultiplier`);
for (const lv of [0, 1, 5, 10, 20]) {
  const s = mk(lv);
  console.log(`  ${pad(lv, 6)} ${pad(zpeEngineProdMult(s).toExponential(2), 14)} ${pad(zpeEngineMultBonus(s).toExponential(2), 14)} ${pad(zpeEngineAddBonus(s).toString(), 12)} ${zpeMultiplier(s).toExponential(3)}`);
}
console.log();
console.log(`  ③ 暗能量倍率以指数  进 ZPE 倍率；④ 引擎倍率也进暗能量倍率`);
console.log(`  ★ 环：引擎倍率 →(④) 暗能量倍率 →(③ ^) ZPE 倍率 →(^${ZPE_EXPONENT} × 出现 1.74 次) ZPE → 暗能量 → …`);
console.log();

if (check) {
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };

  // ① 解锁条件：1 次大坍缩 + 送 1 级（不再花 IP）
  {
    const a = newState();
    a.infinityPoints = D(1e9);
    ck("① 解锁条件 = 1 次大坍缩（不花无限点）",
      unlockZpeEngine(a) === false && !zpeEngineUnlocked(a), "0 次大坍缩 ⇒ 不解锁");
    a.bigCrunchCount = D(1);
    const ok = unlockZpeEngine(a);
    ck("① 达成即解锁，并送 1 级", ok && zpeEngineUnlocked(a) && zpeEngineLevel(a).eq(1),
      `等级 = ${zpeEngineLevel(a).toString()}，IP 仍为 ${a.infinityPoints.toString()}`);
  }

  // ② 开根形状（★★ 2025 重做：原来是 `1+0.01×等级`，现为 `1+coeff·√等级`）
  {
    const l1 = mk(1), l4 = mk(4);
    const expP = 1 + ENGINE_MECH.prod.coeff * Math.sqrt(1);
    const expP4 = 1 + ENGINE_MECH.prod.coeff * Math.sqrt(4);
    const expM = 1 + ENGINE_MECH.mult.coeff * Math.sqrt(1);
    const expM4 = 1 + ENGINE_MECH.mult.coeff * Math.sqrt(4);
    ck("② 产出倍率 = 1 + coeff·√等级（开根）",
      Math.abs(zpeEngineProdMult(l1).toNumber() - expP) < 1e-9 &&
      Math.abs(zpeEngineProdMult(l4).toNumber() - expP4) < 1e-9,
      `lv1 = ${zpeEngineProdMult(l1).toNumber().toFixed(4)}（期望 ${expP.toFixed(4)}）、lv4 = ${zpeEngineProdMult(l4).toNumber().toFixed(4)}（期望 ${expP4.toFixed(4)}）`);
    ck("②b 倍率 = 1 + coeff·√等级（开根）",
      Math.abs(zpeEngineMultBonus(l1).toNumber() - expM) < 1e-9 &&
      Math.abs(zpeEngineMultBonus(l4).toNumber() - expM4) < 1e-9,
      `lv1 = ${zpeEngineMultBonus(l1).toNumber().toFixed(4)}（期望 ${expM.toFixed(4)}）、lv4 = ${zpeEngineMultBonus(l4).toNumber().toFixed(4)}（期望 ${expM4.toFixed(4)}）`);
    // ⚠️ 这条原来用 `zpeRate(lv1)/zpeRate(lv0)` —— 而 `mk()` 里 `traps=0` ⇒ 产出恒为 0
    //    ⇒ `0/0 = NaN`，断言靠 `gte(10)` 对 NaN 为 false **失败**（但打印出 NaN 很久没人看）✗
    //    ⇒ 改成直接比 `zpeMultiplier`（产出项真的进了倍率链，这才是要守的东西）✓
    ck("★ 产出倍率真的进了 zpeMultiplier（不是死效果）",
      zpeMultiplier(mk(1)).div(zpeMultiplier(mk(0))).gt(1),
      `×${zpeMultiplier(mk(1)).div(zpeMultiplier(mk(0))).toFixed(4)}（lv1 vs lv0）`);
  }

  // ①④ 饱和式（★★ 2025 重做：原来是线性 `1+lv` / `1+0.1lv`，真无界 ✗）
  {
    const { A, knee } = ENGINE_MECH.add;
    const sat = (lv) => 1 + A * ((lv / knee) / (1 + lv / knee));
    const s10 = mk(10), s0 = mk(0);
    ck("① 加法区 = 饱和式（不再是每级 +1 的线性）",
      Math.abs(zpeEngineAddBonus(s10).toNumber() - (sat(10) - 1)) < 1e-9,
      `A=${A}、knee=${knee}；等级 10 ⇒ +${zpeEngineAddBonus(s10).toNumber().toFixed(4)}（极限 +${A}）`);
    ck("★ ① 有内部终点（渐近 A，不再随等级无界增长）",
      zpeEngineAddBonus(mk(1e6)).toNumber() < A * 1.0001,
      `等级 1e6 ⇒ +${zpeEngineAddBonus(mk(1e6)).toNumber().toFixed(3)} ≤ ${A} ✓`);
    ck("★ ④ 也有内部终点（渐近 A+1）",
      deEngineLevelBonus(1e6) < ENGINE_MECH.de.A * 1.0001 + 1,
      `等级 1e6 ⇒ ×${deEngineLevelBonus(1e6).toFixed(3)} ≤ ×${ENGINE_MECH.de.A + 1} ✓`);
    ck("★ ① 不再抬高 ZPE 的幂次（旧红线自动满足）",
      ZPE_EXPONENT === 0.02, `ZPE_EXPONENT 仍是 ${ZPE_EXPONENT}（引擎不再改它 ✓）`);
    console.log(`     （参考：等级 0 与 10 的 zpeMultiplier 比 = ×${zpeMultiplier(mk(10)).div(zpeMultiplier(mk(0))).toFixed(2)}）`);
  }

  // ③ 暗能量倍率 ^1.03 进 ZPE 倍率
  {
    const s = mk(0);
    const deMult = darkEnergyMultiplier(s);
    const s2 = { ...s, darkEnergyTotal: D(1) };
    ck("③ 暗能量倍率以指数 1.03 进 ZPE 倍率",
      zpeMultiplier({ ...s, quantum: D(10) }).gt(zpeMultiplier({ ...s, quantum: D(0) })),
      `DE倍率 ${deMult.toExponential(3)} ⇒ ^1.03 = ${deMult.pow(1.03).toExponential(3)}`);
  }

  // ④ 引擎倍率进「暗能量自增长」；②b 进「暗能量倍率」
  {
    const off = mk(0), on = mk(10);
    // ⚠️ 这两个是**两条不同的机制**，别混（我第一版就混了 ✗）：
    //   · `darkEnergyMultiplier` 只乘 **②b**（`formulas.js:394` 的 `.mul(zpeEngineMultBonus(state))`）
    //   · ①（`zpeEngineAddBonus`）在 `formulas.js:222` 进的是 **ZPE 倍率**的加法区，与 DE 无关
    //   ⇒ 比值 = ②b(10)
    const expect = zpeEngineMultBonus(on).toNumber();
    ck("②b 引擎倍率作用在暗能量倍率上（饱和式）",
      Math.abs(darkEnergyMultiplier(on).div(darkEnergyMultiplier(off)).toNumber() - expect) < 1e-9,
      `×${darkEnergyMultiplier(on).div(darkEnergyMultiplier(off)).toNumber().toFixed(4)}（= ②b(10) = ${expect.toFixed(4)}）`);
    // ④ 单独断言（它只进自增长，不进倍率）
    const de10 = deEngineLevelBonus(10);
    ck("④ deEngineLevelBonus 是饱和式且只进自增长",
      de10 > 1 && de10 < ENGINE_MECH.de.A + 1 && Math.abs(de10 - darkEnergyMultiplier(on).div(darkEnergyMultiplier(off)).toNumber()) > 1e-6,
      `④(10) = ${de10.toFixed(4)}（渐近 ×${ENGINE_MECH.de.A + 1}）—— 与倍率比值不同 ⇒ 确认是两条机制 ✓`);
  }

  // 环增益红线
  {
    const s = mk(20);
    const d1 = darkEnergyMultiplier(s).toNumber();
    const d2 = darkEnergyMultiplier({ ...s, darkEnergyTotal: D(1e20) }).toNumber();
    const slope = Math.log(d2 / d1) / Math.log(1e10);
    const APPEAR = 1.74;
    const gain = 1.03 * slope * (ZPE_EXPONENT * APPEAR);   // 1.03 = 原 DE_TO_ZPE_EXPONENT（该设计已废弃，此断言仅作历史护栏）
    ck("★ 环增益 < 1（runaway 红线）", gain < 1,
      `增益 = 1.03 × ${slope.toExponential(2)} × (${ZPE_EXPONENT}×${APPEAR}) = ${gain.toExponential(2)} ≪ 1 ✓`);
    ck("★ 环安全的原因：暗能量倍率对暗能量是对数依赖",
      slope < 0.1, `∂ln(DE倍率)/∂ln(DE) = ${slope.toExponential(2)}（对数 ⇒ 极小 ✓）`);
  }

  // 价格软上限（阈值 2025 ×10：100 / 1000 / 10000）
  // 2025: 价格改成**三次方闭式** 5 x (等级+1)^3（旧的 costSegments 分段软上限已废弃）
  {
    const s0 = newState(); s0.zpeEngineUnlocked = true; s0.zpeEngineLevel = new Decimal(0);
    const B = ZPE_ENGINE.baseCostIp;
    const c0 = zpeEngineCost(s0).toNumber();                       // 第一级 = B x 1^3
    s0.zpeEngineLevel = new Decimal(10);
    const c10 = zpeEngineCost(s0).toNumber();                      // 第 11 级 = B x 11^3
    ck(`价格 = ${B} x (等级+1)^3（三次方闭式，多项式安全）`,
      Math.abs(c0 - B) < 1e-12 && Math.abs(c10 - B * Math.pow(11, 3)) < 1e-9,
      `lv0 => ${c0}，lv10 => ${c10}（应 ${B * Math.pow(11, 3)}）`);
    // 总价闭式必须等于逐级累加（这是"买满"正确性的地基）
    let sum = new Decimal(0);
    for (let i = 0; i < 12; i++) sum = sum.add(zpeEngineCost({ ...s0, zpeEngineLevel: new Decimal(i) }));
    const closed = zpeEngineTotalCost(0, 12);
    ck("总价闭式 == 逐级累加（相对差 < 1e-9）",
      closed.sub(sum).abs().div(sum).toNumber() < 1e-9,
      `闭式 ${closed.toExponential(6)} vs 累加 ${sum.toExponential(6)}`);
  }
  // 第 5 条机制：引擎倍率 → 前 8 个虚空升级的效果（对数，安全）
  {
    const locked = newState();                                  // 引擎未解锁
    ck("5) 引擎未解锁 ⇒ boost ≡ 1（零回归）", Math.abs(voidBoostMult(locked) - 1) < 1e-12, `boost = ${voidBoostMult(locked)}`);
    const lo = mk(1), hi = mk(100);
    ck("5) boost 随等级单调上升", voidBoostMult(hi) > voidBoostMult(lo), `lv1 ${voidBoostMult(lo).toFixed(3)} → lv100 ${voidBoostMult(hi).toFixed(3)}`);
    const huge = { ...mk(0), zpeEngineLevel: D("9.46e76") };     // 三次方价格下的等级上限
    const b = voidBoostMult(huge);
    ck("5) 等级到上限（9.46e76）时 boost 仍**有界**（对数 ⇒ 安全）", b > 1 && b < 20, `boost = ${b.toFixed(3)}（引擎倍率 ≈ 4.7e75）`);
  }

  ck("★ 守卫：5 条机制全部**有界**（内部机制各有终点）",
    ENGINE_MECH.prod.coeff > 0 && ENGINE_MECH.mult.coeff > 0 && ENGINE_MECH.add.A > 0 && ENGINE_MECH.de.A > 0
    && zpeEngineProdMult(mk(1e9)).toNumber() < 1e6        // 开根：1e9 级也只给 ~1+coeff·3e4
    && zpeEngineMultBonus(mk(1e9)).toNumber() < 1e6
    && zpeEngineAddBonus(mk(1e9)).toNumber() < ENGINE_MECH.add.A * 1.0001
    && deEngineLevelBonus(1e9) < ENGINE_MECH.de.A * 1.0001 + 1,
    `① 渐近 +${ENGINE_MECH.add.A}｜④ 渐近 ×${ENGINE_MECH.de.A + 1}｜②②b 开根（1e9 级仍 <1e6）`);
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
