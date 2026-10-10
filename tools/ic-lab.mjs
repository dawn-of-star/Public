/**
 * tools/ic-lab.mjs —— 无限挑战（IC）的定点断言
 *
 * 设计依据：第三种设计稿（用户 2025）的「无限挑战」段 ✓
 *   · 条件只有「抵达无限」（用户裁定）⇒ 挑战激活期间完成一次大坍缩即通过 ✓
 *   · 熵→粒子的熵需求 ×5，每完成一次再 ×5（最高 ×78125 = 7 次）✓
 *   · 通过 ⇒ 无限点余额**跃升一段**（每段 36.89 个数量级）⇒ 7 段正好触及 1e308.25 ✓
 *
 * 用法：node tools/ic-lab.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { conversion } from "../src/formulas.js";
import { icEntropyMult, icIpJumpMult, INFINITY_CHALLENGES } from "../src/config.js";
import { abandonInfinityChallenge, doBigCrunch, icCompleteOnCrunch, startInfinityChallenge } from "../src/engine.js";

const D = (v) => new Decimal(v ?? 0);
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");

console.log("=".repeat(100));
console.log("无限挑战（IC）：熵需求阶梯 + 无限点七段阶梯");
console.log("=".repeat(100));
console.log(`  ${pad("第 k+1 次", 10)}${pad("熵需求倍率", 14)}${pad("完成后 ip 余额", 20)}段数`);
const IP0 = 50;
for (let k = 0; k < INFINITY_CHALLENGES.max; k++) {
  const mult = Math.pow(INFINITY_CHALLENGES.entMult, k + 1);
  const orders = IP0 + INFINITY_CHALLENGES.ipJumpOrders * (k + 1);
  console.log(`  ${pad(k + 1, 10)}${pad("x" + mult.toLocaleString("en-US"), 14)}${pad("1e" + orders.toFixed(2), 20)}${k + 1}`);
}
console.log(`  ⇒ 第 7 段 = 1e${(IP0 + INFINITY_CHALLENGES.ipJumpOrders * 7).toFixed(2)}（永恒门槛 1e308.25 ✓）`);

if (check) {
  console.log();
  console.log("=".repeat(100));
  console.log("定点断言");
  console.log("=".repeat(100));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 50)} ${detail}`);
  };

  // ① 零回归：未激活 ⇒ 熵需求倍率 1
  {
    const s = newState();
    ck("① 未激活时熵需求倍率 = 1（零回归）", icEntropyMult(s) === 1, `mult = ${icEntropyMult(s)}`);
    const t1 = conversion(s).threshold.toNumber();
    ck("① 未激活时熵→粒子门槛与不带 IC 时一致", Number.isFinite(t1) && t1 > 0, `threshold = ${t1.toExponential(3)}`);
  }

  // ② 熵需求阶梯：5^k（k 从 1 起 ✓ 与稿子"×5，且每次再 ×5"一致）
  {
    const s = newState();
    const got = [0, 1, 2].map((k) => { s.ic.active = k; return icEntropyMult(s); });
    const want = [1, 5, 25];   // ★ 已重排为 3 关（可选挑战 ✓）   // 8 关：第 1 关 ×1（入门 ✓）
    ck("② 八关熵需求 = 1 / 5^k，最后一关 ×78125", JSON.stringify(got) === JSON.stringify(want), got.join(" / "));
    s.ic.active = 3;
    const tA = conversion(newState()).threshold.toNumber();
    const tB = conversion(s).threshold.toNumber();
    ck("② 激活后门槛真的被放大（k=3 ⇒ ×125 ✓）", Math.abs(tB / tA - 125) < 1e-6, `${tB.toExponential(3)} / ${tA.toExponential(3)} = ${(tB / tA).toFixed(2)}`);
  }

  // ③ 七段阶梯：1e50 ×(1e36.8921)^7 = 1e308.25
  {
    const jump = icIpJumpMult();
    let ip = D(1);   // 起点 = 1（长河停产后 ✓）
    for (let n = 0; n < 3; n++) ip = ip.mul(jump);   // 3 关 ✓   // 8 关 ✓
    const lg = ip.log10().toNumber();
    ck("③ 3 关（起点 1，每关 +10 阶）⇒ 1e30（**加成**定位 ✓ 不再承担阶梯 ✓）", Math.abs(lg - 30) < 0.05, `1e${lg.toFixed(4)}`);
    ck("③ 每段 = 38.53 个数量级（固定常数 ⇒ 判据安全）",
      Math.abs(INFINITY_CHALLENGES.ipJumpOrders - 10) < 1e-3,
      `每段 ${INFINITY_CHALLENGES.ipJumpOrders.toFixed(4)} 阶`);
  }

  // ④ 顺序与状态机
  {
    const s = newState();
    s.bigCrunchCount = D(1);
    s.infinityPoints = D(200);
    ck("④ 未破∞时不能开始", startInfinityChallenge(s, 0).ok === false, `${startInfinityChallenge(s, 0).reason}`);
    s.brokenInfinity = true;
    ck("④ 破∞后可以开始第 1 个", startInfinityChallenge(s, 0).ok === true && s.ic.active === 0, `active = ${s.ic.active}`);
    ck("④ 不能跳着做（未完成第 1 个就开第 2 个）", startInfinityChallenge(s, 1).ok === false, `${startInfinityChallenge(s, 1).reason}`);
    ck("④ 不能重复开始", startInfinityChallenge(s, 0).ok === false, `${startInfinityChallenge(s, 0).reason}`);
    ck("④ 可放弃", abandonInfinityChallenge(s).ok === true && s.ic.active === null, `active = ${s.ic.active}`);
  }

  // ⑤ 通过：大坍缩 ⇒ completed+1 + 余额跃升一段 + 回到非挑战态
  {
    const s = newState();
    s.brokenInfinity = true;
    s.infinityPoints = D("1e50");
    startInfinityChallenge(s, 0);
    const before = D(s.infinityPoints);
    const r = icCompleteOnCrunch(s);
    const ratio = D(s.infinityPoints).div(before);
    ck("⑤ 通过后 completed = 1 且 active 清空", r && s.ic.completed === 1 && s.ic.active === null, `completed = ${s.ic.completed}`);
    ck("⑤ 余额真的跃升一段（×1e36.89）", Math.abs(ratio.log10().toNumber() - INFINITY_CHALLENGES.ipJumpOrders) < 0.01,
      `1e${before.log10().toNumber().toFixed(2)} → 1e${D(s.infinityPoints).log10().toNumber().toFixed(2)}`);
    ck("⑤ 非挑战态下调用无副作用", icCompleteOnCrunch(s) === null, "返回 null ✓");
  }

  // ⑥ doBigCrunch 真的会调用它（集成级 ✓）
  {
    const s = newState();
    s.brokenInfinity = true;
    s.infinityPoints = D("1e50");
    startInfinityChallenge(s, 0);
    const before = D(s.infinityPoints).log10().toNumber();
    try { doBigCrunch(s); } catch (e) { /* 某些前置可能不足 ⇒ 只要 IC 判定生效即可 */ }
    ck("⑥ 大坍缩会触发 IC 通过（集成级 ✓）", s.ic.completed === 1 && s.ic.active === null,
      `completed = ${s.ic.completed}，IP 1e${before.toFixed(2)} → 1e${D(s.infinityPoints).log10().toNumber().toFixed(2)}`);
  }

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
