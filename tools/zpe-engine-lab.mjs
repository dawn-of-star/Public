/**
 * tools/zpe-engine-lab.mjs —— ZPE 引擎机制（打破无限后）的**数学模型 + 杠杆实测**
 *
 * ── 三条待设计的机制（用户原案）──
 *   ① 优化 ZPE 倍率公式，使其加成提升
 *   ② 基于数量大幅提速 ZPE 产出
 *   ③ 使 ZPE 倍率能受「计数频率」加成
 *   三者都落在 **zpe 乘区**（蓝色）→ 不需要新颜色。
 *
 * ── 核心不等式（本工具要证明的东西）──
 *   ZPE 是**自反馈**的：`dZ/dt = c·Z^a`，其中
 *       a = (ZPE 倍率公式的指数) × (它在 zpeRate 里被乘的次数) + (其它自反馈项的指数)
 *   解得 `Z ∝ t^(1/(1−a))`：
 *       a = 0    → Z ∝ t      （线性，温吞）
 *       a = 0.5  → Z ∝ t²     （大幅提速，安全）
 *       a = 0.9  → Z ∝ t^10   （猛）
 *       a ≥ 1    → **有限时间爆炸**（Z 在有限时间内到 ∞）—— 这是唯一的硬红线
 *   所以「让它更强」的正经做法是**抬 a**（留足余量），而不是加一个固定倍率。
 *
 * 用法：node tools/zpe-engine-lab.mjs [--check] [--hours=2]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState, deLevelOf } from "../src/state.js";
import {
  advance, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade, buyRepeatable, buyTrap,
  buyVoidUpgrade, doClick, unlockZpeEngine,
} from "../src/engine.js";
import { entropyRate, zpeMultiplier, zpeProductionPenalty, zpeRate } from "../src/formulas.js";
import {
  DE_PENALTY, DE_UPGRADES, DREAM_UPGRADES, INFINITY_ORDER, REPEATABLE, VOID_UPGRADES, ZPE_ENGINE,
  ZPE_EXPONENT, zpeEngineAffordableIn, zpeEngineLogCost, zpeEngineTotalCost, zpeEngineUnlocked,
} from "../src/config.js";

const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");
const hours = Number((process.argv.find((a) => a.startsWith("--hours=")) ?? "").split("=")[1]) || 6;

// ── 1. 跑一个成熟状态（贪心玩家 + ∞ 层采购）──
const s = newState();
for (let i = 0; i < 10; i++) doClick(s);
for (let t = 0; t < hours * 3600; t += 0.5) {
  if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
  for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
  buyTrap(s, true);
  for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
  for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
  for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);
  for (const id of INFINITY_ORDER) buyInfinityUpgrade(s, id);
  advance(s, 0.5);
}

const lg = (d) => (d.gt(0) ? d.log10().toNumber() : -Infinity);
console.log("=".repeat(96));
console.log(`ZPE 引擎杠杆实测（状态：${hours} 小时贪心玩家）`);
console.log("=".repeat(96));
console.log(`  ZPE = 1e${lg(s.zpe).toFixed(1)}   ZPE 倍率 = ×${zpeMultiplier(s).toNumber().toFixed(2)}` +
  `   ZPE 产出 = ${zpeRate(s).toExponential(2)}/s   量子 = ${s.quantum.toNumber()}`);
console.log(`  v6（ZPE 倍率再进一次产出）= ${s.voidUpgrades.v6}   m4（ZPE 倍率放大熵阱数量）= ${s.zpeMilestones.m4}`);

/**
 * 扰动某个量，量出它在 zpeRate 里的**指数** = Δlog10(率) / Δlog10(量)。
 * `valueOf` 给出被扰动的那个量本身（用来算真实倍数，不能假设正好 ×10 —— 我第一版就栽在这）。
 */
function exponent(name, valueOf, mutate) {
  const before = zpeRate(s).toNumber();
  const x0 = valueOf(s);
  const undo = mutate(s);
  const x1 = valueOf(s);
  const after = zpeRate(s).toNumber();
  undo();
  const dLogX = Math.log10(x1) - Math.log10(x0);
  const e = Math.log10(after / before) / dLogX;
  const factor = after / before;
  console.log(`  ${pad(name, 30)} 量 ×${Math.pow(10, dLogX).toFixed(2)} → 产出 ×${factor.toFixed(2)}   指数 ${e.toFixed(3)}`);
  return e;
}

const countFreq = (st) => 1 + 0.05 * st.levels.particleBoost.toNumber();     // = countFreqAddTerm（只有一条）
const dreamTerm = (st) => 1 + st.dreamPoints.toNumber() * (st.voidUpgrades.v4 ? 0.08 : 0.02);

console.log();
console.log("─".repeat(96));
console.log("一、各量在 `zpeRate` 里的**实际指数**（扰动实测，指数 = Δlog(率)/Δlog(量)）");
console.log("─".repeat(96));
const eSelf = exponent("ZPE 自身（自反馈，含 ② 的加法项）", (st) => st.zpe.toNumber(), (st) => {
  const old = st.zpe; st.zpe = old.mul(10);
  return () => { st.zpe = old; };
});
const eGlobalDream = exponent("全局加成里的梦想点项", dreamTerm, (st) => {
  const old = st.dreamPoints; st.dreamPoints = old.add(1e4);
  return () => { st.dreamPoints = old; };
});
const eCount = exponent("计数频率（countFreqAddTerm）", countFreq, (st) => {
  const old = st.levels.particleBoost; st.levels.particleBoost = old.add(200);
  return () => { st.levels.particleBoost = old; };
});
const eTraps = exponent("熵阱数量", (st) => st.resources.traps.toNumber(), (st) => {
  const old = st.resources.traps; st.resources.traps = old.mul(10);
  return () => { st.resources.traps = old; };
});
const eDE = exponent("暗能量（惩罚项）", (st) => st.darkEnergy.toNumber(), (st) => {
  const old = st.darkEnergy; st.darkEnergy = old.mul(10);
  return () => { st.darkEnergy = old; };
});

// ★ 结构杠杆：必须把 ②「零点耦合」的**加法项**关掉再测。
//   因为 `m = (Z+1)^0.02 × 3 + IP`：IP 一大就把幂次项淹没，
//   于是「ZPE ×10」几乎不改变 m（实测只有 ×1.004）—— 那是 κ（见下）变小，**不是**杠杆变了。
const eZpeSelfPure = (() => {
  const pure = { ...s, ipToZpeBought: false, zpeFixedMultiplier: null };
  const before = zpeRate(pure).toNumber();
  const old = pure.zpe;
  pure.zpe = old.mul(10);
  const after = zpeRate(pure).toNumber();
  pure.zpe = old;
  return Math.log10(after / before);
})();

const leverage = eZpeSelfPure / ZPE_EXPONENT;   // 倍率公式在产出里被乘了几次（结构值）
const kappa = eSelf / (ZPE_EXPONENT * leverage); // 幂次项在倍率里的**占比**（② 的加法项会压低它）
console.log();
console.log(`  ⇒ 结构杠杆：**ZPE 倍率公式在产出里出现了 ${leverage.toFixed(2)} 次**（关掉 ② 的加法项后实测）。`);
console.log(`     · ZPE 倍率 → 产出：指数 ${leverage.toFixed(2)}（m4 的熵阱路径 + v6 的产出路径）`);
console.log(`     · 全局加成 → 产出：指数 ${eGlobalDream.toFixed(2)}（zpeRate 里乘了两次）= 计数频率也吃同样的指数`);
console.log(`     · 计数频率当前对 ZPE 的指数 = ${eCount.toFixed(2)} —— ③ 号机制要把它再抬 ${leverage.toFixed(2)}（经倍率）`);
console.log(`     · 暗能量惩罚当前指数 = ${eDE.toFixed(2)}（见下）`);
console.log();
console.log(`  ⚠️ κ（幂次项占倍率的比例）= ${kappa.toFixed(3)}：` +
  `②「零点耦合」的加法项（+IP）已经把 (ZPE+1)^${ZPE_EXPONENT} 淹没了 ——`);
console.log(`     所以**自反馈 a 被自己人削弱**：a = 指数 × κ × 杠杆 = ${eSelf.toFixed(4)}（纯幂次时本该是 ${(ZPE_EXPONENT * leverage).toFixed(4)}）。`);

// ── 惩罚项现在处于哪种情形 ──
const pen = zpeProductionPenalty(s).toNumber();
const lvDream = deLevelOf(s, "dreamAnnihilation").toNumber();
const penCase = s.darkEnergy.lte(0) ? "暗能量还没开始（惩罚恒 1，这一格现在不是杠杆）"
  : lvDream >= (DE_UPGRADES.dreamAnnihilation.maxLevel ?? 10) ? "「梦想烬灭虚无」已满级 → 惩罚被完全移除（指数 0 是设计结果）"
  : pen <= DE_PENALTY.floor * 1.0001 ? `已钉在下限 ${DE_PENALTY.floor}（暗能量再涨也不会让 ZPE 更快）`
  : "仍在生效区间（暗能量涨 → ZPE 反而更慢）";
console.log();
console.log(`  暗能量 = ${s.darkEnergy.toExponential(2)}，减免等级 = ${lvDream}，惩罚现值 = ${pen.toExponential(3)}（下限 ${DE_PENALTY.floor}）`);
console.log(`  ⇒ ${penCase}`);

// ── 2. 自反馈指数 a 与增长形状 ──
console.log();
console.log("─".repeat(96));
console.log("二、自反馈指数 a 与 ZPE 的时间形状");
console.log("─".repeat(96));
console.log(`  当前 ZPE 倍率公式的指数 ZPE_EXPONENT = ${ZPE_EXPONENT}，在产出里出现 ${leverage.toFixed(2)} 次`);
console.log(`  ⇒ 纯幂次的自反馈指数 a = ${ZPE_EXPONENT} × ${leverage.toFixed(2)} = ${(ZPE_EXPONENT * leverage).toFixed(4)}；`);
console.log(`     实测 a = ${eSelf.toFixed(4)}（被 ② 的加法项压到 ${(kappa * 100).toFixed(0)}%）。**红线按保守值（κ=1）判**。`);
console.log();
console.log(`  ${pad("a", 8)} ${pad("ZPE 时间形状", 20)} ${pad("时间每 ×10 涨几阶", 20)} 备注`);
for (const a of [0, 0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
  const shape = a >= 1 ? "有限时间爆炸" : `t^${(1 / (1 - a)).toFixed(2)}`;
  const orders = a >= 1 ? Infinity : 1 / (1 - a);
  console.log(`  ${pad(a.toFixed(2), 8)} ${pad(shape, 20)} ${pad(Number.isFinite(orders) ? "+" + orders.toFixed(2) + " 阶" : "∞", 20)} ` +
    `${a === 0 ? "线性" : a >= 1 ? "❌ 红线" : a >= 0.5 ? "✅ 猛且安全" : "温吞但稳"}`);
}

console.log();
console.log("─".repeat(96));
console.log("三、量子捕获需要多快（这是 ZPE 的唯一活口）");
console.log("─".repeat(96));
const pairs = s.quantumPairs.toNumber();
const nextCost = Math.pow(10, 10 + pairs * Math.log10(20));
console.log(`  已捕获 ${pairs} 对，下一对需要 ZPE ${nextCost.toExponential(2)}（门槛每对 ×20 = 1.301 阶）`);
console.log(`  当前 ZPE = 1e${lg(s.zpe).toFixed(1)} → 还差 ${(Math.log10(nextCost) - lg(s.zpe)).toFixed(2)} 阶`);
console.log(`  ⇒ 「每对 1.301 阶」就是标尺：ZPE 的**涨阶速率**决定抓对速度。`);
console.log(`     a=0 时 ZPE 按常数阶/秒涨；a=0.5 时按 t 涨（越来越快）；a≥1 时有限时间到 ∞。`);
console.log(`     所以 ①②③ 三条机制要「有效」，必须去抬 a 或抬常数倍率 c，而不是抬一个固定值。`);

// ── 4. 三条机制的数学模型与建议参数 ──
const cf = countFreq(s);
console.log();
console.log("─".repeat(96));
console.log("四、三条机制各自改的是方程里的哪一项");
console.log("─".repeat(96));
console.log("  方程：`dZ/dt = c(t) · Z^a`，其中 a = ZPE_EXPONENT × (倍率在产出里出现的次数)");
console.log(`  当前：a = ${eSelf.toFixed(4)}，倍率出现 ${leverage.toFixed(2)} 次，ZPE 倍率 = ×${zpeMultiplier(s).toNumber().toFixed(2)}`);
console.log();
console.log(`  ① 优化倍率公式 = **抬 a**`);
for (const exp of [0.02, 0.05, 0.1, 0.25]) {
  const a = exp * leverage;
  const multNow = zpeMultiplier(s).toNumber();
  const multNew = Math.pow(Math.pow(10, lg(s.zpe)), exp) * (multNow / Math.pow(Math.pow(10, lg(s.zpe)), ZPE_EXPONENT));
  console.log(`     ZPE_EXPONENT ${ZPE_EXPONENT} → ${pad(exp.toFixed(2), 5)}：a = ${pad(a.toFixed(3), 6)} ` +
    `形状 ${pad(a >= 1 ? "爆炸❌" : "t^" + (1 / (1 - a)).toFixed(2), 10)} 当前倍率 ×${multNow.toFixed(1)} → ×${multNew.toFixed(1)}`);
}
console.log();
console.log(`  ② 基于数量提速 = **抬 c(t)**（不改 a 就不会跑飞）`);
console.log(`     标尺：每对量子 = 1.301 阶。实测 16 小时 ZPE 涨 12 阶 ⇒ 0.75 阶/小时 ⇒ 约 1.7 小时/对。`);
console.log(`     想「每 10 分钟一对」= 7.8 阶/小时 ⇒ 需要把涨阶速率抬 ~10 倍。`);
console.log(`     ⚠️ 若"数量"自己也随 ZPE 涨（例如用 ZPE 买引擎等级），要分清：`);
console.log(`        · 等级 ∝ log(ZPE) 且倍率 ∝ (1+lv)^k  → 只加"多项式"增长，a 几乎不变 ✅`);
console.log(`        · 等价于 ZPE^b 的形式              → **a 要加 b×${leverage.toFixed(2)}**，必须重算 a<1 ❌红线`);
console.log();
console.log(`  ③ 计数频率接进倍率 = **把已有成长接过来**（跨乘区输入，落点仍是 zpe）`);
console.log(`     计数频率对 ZPE 的指数：${eCount.toFixed(2)} → ${(eCount + leverage).toFixed(2)}`);
console.log(`     即时收益 = 计数频率^${leverage.toFixed(2)}：当前计数频率 = ${cf.toFixed(2)} → ×${Math.pow(cf, leverage).toFixed(1)} ` +
  `= +${(leverage * Math.log10(cf)).toFixed(2)} 阶`);
console.log(`     并且它**随计数频率一起涨**（买「粒子加速」等级 = 顺便加速 ZPE）→ 三条里唯一"持续且免费"的`);

if (check) {
  console.log();
  console.log("=".repeat(96));
  console.log("定点断言（结构事实，改坏了要拦住）");
  console.log("=".repeat(96));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 40)} ${detail}`);
  };
  ck("自反馈 a < 1（按保守值 κ=1 判）", ZPE_EXPONENT * leverage < 1,
    `a = ${(ZPE_EXPONENT * leverage).toFixed(4)}（实测 ${eSelf.toFixed(4)}，κ = ${kappa.toFixed(2)}）`);
  ck("ZPE 倍率在产出里出现 ≥1 次", leverage >= 1, `出现 ${leverage.toFixed(2)} 次`);
  ck("全局加成进两次（方案 1）", Math.abs(eGlobalDream - 2) < 0.1, `指数 = ${eGlobalDream.toFixed(3)}`);
  ck("计数频率对 ZPE 的指数 ≈ 全局的两倍路径", Math.abs(eCount - eGlobalDream) < 0.15,
    `计数频率指数 = ${eCount.toFixed(2)}（= 全局指数，因为计数频率是全局的因子之一）`);
  ck("熵阱线性进入 ZPE 产出", Math.abs(eTraps - 1) < 0.05, `指数 = ${eTraps.toFixed(3)}`);
  ck("暗能量惩罚已不是活杠杆（满级移除 或 钉在下限）", eDE < 0.01 &&
    (pen <= DE_PENALTY.floor * 1.0001 || lvDream >= (DE_UPGRADES.dreamAnnihilation.maxLevel ?? 10) || s.darkEnergy.lte(0)),
    `指数 = ${eDE.toFixed(3)}，惩罚 = ${pen.toExponential(2)}，减免等级 = ${lvDream}`);

  // ── ZPE 引擎三条机制 ──
  const eng = { ...s };                       // 借用同一个成熟状态（只读地改引擎字段）
  eng.infinityPoints = new Decimal(ZPE_ENGINE.unlockCostIp - 1);
  ck("引擎解锁必须花 10 无限点", unlockZpeEngine(eng) === false && zpeEngineUnlocked(eng) === false,
    `只有 ${ZPE_ENGINE.unlockCostIp - 1} 点时不解锁`);
  eng.infinityPoints = new Decimal(ZPE_ENGINE.unlockCostIp);
  ck("刚好 10 点可以解锁", unlockZpeEngine(eng) === true && zpeEngineUnlocked(eng) === true,
    `解锁后剩 ${eng.infinityPoints.toString()} 点，梦想点 ${eng.dreamPoints.toString()}`);

  // ② 产出倍率 = (1 + perLevel×等级)²
  //   ⚠️ 必须比 **0 级 vs 4 级**：5 级会开 ③、10 级会开 ①，混进来就测不出②了（踩过）
  const rateAt = (level) => zpeRate({ ...eng, zpeEngineLevel: new Decimal(level) }).toNumber();
  const r0 = rateAt(0), r4 = rateAt(4);
  const want4 = Math.pow(1 + ZPE_ENGINE.perLevel * 4, 2);
  ck("② 产出倍率 = (1+0.1×等级)²", Math.abs(r4 / r0 - want4) < 1e-6,
    `等级 4 → ×${(r4 / r0).toFixed(3)}（期望 ${want4.toFixed(3)}）`);

  // ③ 计数频率对 ZPE 的指数：等级 4 → 5 应当多出 leverage
  const cntExpAt = (level) => {
    const t = { ...eng, zpeEngineLevel: new Decimal(level) };
    const before = zpeRate(t).toNumber();
    const x0 = countFreq(t);
    t.levels = { ...t.levels, particleBoost: t.levels.particleBoost.add(200) };
    const x1 = countFreq(t);
    const after = zpeRate(t).toNumber();
    return Math.log10(after / before) / Math.log10(x1 / x0);
  };
  const e3off = cntExpAt(4), e3on = cntExpAt(5);
  ck("③ 等级 5 起计数频率才接进倍率", Math.abs(e3on - e3off - leverage) < 0.1,
    `指数 ${e3off.toFixed(2)} → ${e3on.toFixed(2)}（差 ${(e3on - e3off).toFixed(2)}，期望 ≈ ${leverage.toFixed(2)}）`);

  // ① 抬倍率公式指数：等级 9 → 10 开始生效
  const multAt = (level) => zpeMultiplier({ ...eng, zpeEngineLevel: new Decimal(level) }).toNumber();
  const m9 = multAt(9), m10 = multAt(10);
  const zLog = Math.log10(eng.zpe.toNumber() + 1);
  ck("① 等级 10 起抬高倍率公式的指数",
    Math.abs(Math.log10(m10 / m9) - ZPE_ENGINE.expPerLevel * zLog) < 0.02,
    `倍率 ×${(m10 / m9).toFixed(3)}（期望 ×${Math.pow(10, ZPE_ENGINE.expPerLevel * zLog).toFixed(3)}）`);

  // ★ 红线：① 拉满（指数封顶）后的 a 仍要远低于 1
  const aMax = (ZPE_EXPONENT + ZPE_ENGINE.expMax) * leverage;
  ck("① 拉满后 a 仍 < 0.5（留足余量）", aMax < 0.5,
    `a_max = (${ZPE_EXPONENT} + ${ZPE_ENGINE.expMax}) × ${leverage.toFixed(2)} = ${aMax.toFixed(3)}`);

  // ── ∞ 层：首次购买任意一条给 1 梦想点（只给一次）──
  const d = newState();
  d.infinityPoints = new Decimal(1e9);
  let gained = 0;
  for (const id of INFINITY_ORDER) {
    const b0 = d.dreamPoints.toNumber();
    buyInfinityUpgrade(d, id);
    buyInfinityUpgrade(d, id);              // 再买一次不该再给
    gained += d.dreamPoints.toNumber() - b0;
  }
  ck("∞ 升级首次购买各给 1 梦想点", gained === INFINITY_ORDER.length,
    `实际 ${gained} 点 / ${INFINITY_ORDER.length} 条升级`);

  // ── 引擎价格的**极强软上限**（用户指定：>10 → 涨价 ×10；>100 → 再 ^1.3；>1000 → 再 ^1.8）──
  {
    const g = (lv) => zpeEngineLogCost(lv) - zpeEngineLogCost(lv - 1);      // 该级的涨价倍率（log10）
    const seg1 = Math.pow(10, g(11));
    const seg2 = Math.pow(10, g(101));
    const seg3 = Math.pow(10, g(1001));
    ck("软上限 ①：>10 级起每级涨价 ×20", Math.abs(seg1 - 20) < 1e-6, `实测 ×${seg1.toFixed(2)}`);
    ck("软上限 ②：>100 级起涨价再 ^1.3（×49.1）", Math.abs(seg2 - Math.pow(20, 1.3)) < 1e-6,
      `实测 ×${seg2.toFixed(2)}`);
    ck("软上限 ③：>1000 级起涨价再 ^1.8（×219.7）", Math.abs(seg3 - Math.pow(20, 1.8)) < 1e-6,
      `实测 ×${seg3.toFixed(2)}`);
    // 买满必须取到"最大值"：花得起，而且再多买一级就买不起
    let maximal = true, detail = [];
    for (const e of [6, 12, 30, 100, 308]) {
      const pool = new Decimal(10).pow(e);
      const st = { zpeEngineLevel: new Decimal(0), zpeEngineUnlocked: true };
      const k = zpeEngineAffordableIn(st, pool);
      const spent = k > 0 ? zpeEngineTotalCost(0, k) : new Decimal(0);
      const next = zpeEngineTotalCost(0, k + 1);
      const ok = spent.lte(pool) && next.gt(pool);
      if (!ok) maximal = false;
      if (e === 6 || e === 308) detail.push(`1e${e}→${k} 级`);
    }
    ck("买满取到最大值（花得起、再多一级买不起）", maximal, detail.join("，"));
    // 软上限的意义：即使有 1e308 无限点，引擎等级也上不去
    const kEnd = zpeEngineAffordableIn({ zpeEngineLevel: new Decimal(0), zpeEngineUnlocked: true },
      new Decimal(10).pow(308));
    ck("1e308 点也买不到 250 级（软上限把引擎钉死）", kEnd < 250, `1e308 点 → ${kEnd} 级`);
  }

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

if (process.argv.includes("--cost")) {
  console.log();
  console.log("=".repeat(96));
  console.log("ZPE 引擎价格表（软上限：>10 ×20 ｜ >100 ^1.3 ｜ >1000 ^1.8）");
  console.log("=".repeat(96));
  console.log(`  ${pad("等级", 8)} ${pad("该级价格", 14)} ${pad("每级涨价", 10)} 备注`);
  for (const lv of [0, 1, 5, 9, 10, 11, 15, 20, 50, 100, 101, 200, 500, 1000, 1001, 2000]) {
    const lg = zpeEngineLogCost(lv);
    const growth = lv > 0 ? Math.pow(10, zpeEngineLogCost(lv) - zpeEngineLogCost(lv - 1)) : 1;
    const note = lv === 10 ? "← 下面开始 ×20" : lv === 100 ? "← 下面再 ^1.3" : lv === 1000 ? "← 下面再 ^1.8" : "";
    console.log(`  ${pad(lv, 8)} ${pad("1e" + lg.toFixed(2), 14)} ${pad("×" + growth.toFixed(1), 10)} ${note}`);
  }
  console.log();
  console.log("  买满能买几级（无限点池 → 等级）：");
  for (const e of [3, 6, 9, 12, 20, 50, 100, 308]) {
    const k = zpeEngineAffordableIn({ zpeEngineLevel: new Decimal(0), zpeEngineUnlocked: true },
      new Decimal(10).pow(e));
    console.log(`     池 1e${pad(e, 4)} → ${k} 级`);
  }
}
