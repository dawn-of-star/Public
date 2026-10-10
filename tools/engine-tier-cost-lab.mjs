#!/usr/bin/env node
/**
 * tools/engine-tier-cost-lab.mjs —— **ZPE 引擎：分段指数价格的「阈值 × 底数」对照表**
 *
 * ── 用户 2025 裁定 ──
 *   「zpe 引擎应当也采用 AD 星系的那种价格增幅逻辑，但**具体触发阈值我们需要重新规划**」
 *
 * ── 先说清 AD 星系到底长什么样（读源码后的修正）──
 *   `D:\game\AntimatterDimensionsSourceCode\src\core\galaxy.js` 的 `requirementAt`：
 *     amount = baseCost(80) + g × costMult(60)          ← **线性主导**
 *     DISTANT：再 += g² + g                              ← 二次
 *     REMOTE ：×= 1.002^(g − remoteStart + 1)            ← 底数仅 1.002，几乎可忽略
 *   ⇒ 它是**多项式（线性+二次）**，0→5000 级只跨 5.5 个数量级。
 *     **不能照抄形状**：AD 的效果是**乘性、不收敛**的，所以多项式价格自洽；
 *     我们的 `k → 26` 是**有上限**的，配多项式价格就会"冲过饱和点后白买" ✗
 *
 *   **该照抄的是 AD 的「阈值分段」机制**（`costScalingStart` / `remoteStart`）：
 *     一段里用温和的增长率，过阈值后**跳到更陡的增长率**。
 *     ⇒ 把这一机制用在**指数底数**上：`cost ∝ r_seg^lv`，`r_seg` 随段跳 ✓
 *     ⇒ 等级随 `log(池子)` 收敛，与 `k` 的有界性**形状匹配** ✓
 *
 * ── 本表 ──
 *   扫「阈值组合 × 每段底数」，给出**168 小时（一周）时能达到的等级与 k**，
 *   并按判据标出哪些组合"刚好把 k 推到有意义的量级"。
 *
 * 用法：node tools/engine-tier-cost-lab.mjs
 */
import { MATTER_B_KNEE, MATTER_B_KMAX, ZPE_ENGINE } from "../src/config.js";

const kOf = (lv, knee = MATTER_B_KNEE) => 1 + MATTER_B_KMAX * ((lv / knee) / (1 + lv / knee));

/** 分段指数的**累计价格 log10**：每段各自的底数 r_i */
function costLog(tiers, lv) {
  let lg = Math.log10(ZPE_ENGINE.baseCostIp);
  let prev = 0;
  for (let i = 0; i < tiers.length; i++) {
    const from = prev;
    const to = i + 1 < tiers.length ? tiers[i + 1].from : Infinity;
    const seg = Math.max(0, Math.min(lv, to) - from);
    lg += seg * Math.log10(tiers[i].r);
    prev = to;
    if (lv <= to) break;
  }
  return lg;
}

/** 给定池子（log10），能买到几级（闭式逐段累加） */
function levelFor(tiers, poolLog) {
  let rem = poolLog - Math.log10(ZPE_ENGINE.baseCostIp);
  let lv = 0, prev = 0;
  for (let i = 0; i < tiers.length; i++) {
    const to = i + 1 < tiers.length ? tiers[i + 1].from : Infinity;
    const cap = to - prev;
    const perLevel = Math.log10(tiers[i].r);
    const canAfford = rem / perLevel;                       // 本段能买几级
    const take = Math.min(canAfford, cap);
    lv += take; rem -= take * perLevel;
    if (take < cap) break;
    prev = to;
  }
  return lv;
}

/**
 * 168h 时的 IP 池（log10）。
 * 依据实测：48h → 1e5.3；168h → 1e6.5（引擎把物质推深后收入加快，这里取偏乐观的 1e7）。
 */
const POOL_168H = 7.0;
const POOL_1000H = 9.0;

const TIER_SETS = [
  { name: "单段 ×1.05", tiers: [{ from: 0, r: 1.05 }] },
  { name: "单段 ×1.10", tiers: [{ from: 0, r: 1.10 }] },
  { name: "单段 ×1.20", tiers: [{ from: 0, r: 1.20 }] },
  { name: "单段 ×1.50", tiers: [{ from: 0, r: 1.50 }] },
  { name: "100/1000：1.05→1.2→2", tiers: [{ from: 0, r: 1.05 }, { from: 100, r: 1.2 }, { from: 1000, r: 2 }] },
  { name: "200/2000：1.05→1.5→3", tiers: [{ from: 0, r: 1.05 }, { from: 200, r: 1.5 }, { from: 2000, r: 3 }] },
  { name: "50/500：1.03→1.15→1.6", tiers: [{ from: 0, r: 1.03 }, { from: 50, r: 1.15 }, { from: 500, r: 1.6 }] },
  { name: "500/5000：1.02→1.3→2.5", tiers: [{ from: 0, r: 1.02 }, { from: 500, r: 1.3 }, { from: 5000, r: 2.5 }] },
];

console.log("=".repeat(96));
console.log("ZPE 引擎：分段指数价格 —— 阈值 × 底数 对照表");
console.log("=".repeat(96));
console.log(`  效果：k = 1 + ${MATTER_B_KMAX}·x/(1+x)，x = lv/${MATTER_B_KNEE}（上限 ${1 + MATTER_B_KMAX}，当前拐点 ${MATTER_B_KNEE}）`);
console.log(`  价格：分段指数 cost ∝ r_seg^lv（第一级 ${ZPE_ENGINE.baseCostIp} IP）`);
console.log();
console.log("  判据：希望 **168h（一周）时 k ≈ 13.5**（= 上限的一半）");
console.log();

console.log("表 1｜168h 的池子 = 1e" + POOL_168H);
console.log("  分段方案                        168h等级    k(拐点2000)   k(拐点100)   1000h等级   k@1000h(拐点100)");
for (const t of TIER_SETS) {
  const lv168 = levelFor(t.tiers, POOL_168H);
  const lv1000 = levelFor(t.tiers, POOL_1000H);
  console.log(
    `  ${t.name.padEnd(30)}  ${lv168.toFixed(0).padStart(8)}  ${kOf(lv168, 2000).toFixed(2).padStart(11)}  ` +
    `${kOf(lv168, 100).toFixed(2).padStart(10)}  ${lv1000.toFixed(0).padStart(9)}  ${kOf(lv1000, 100).toFixed(2).padStart(15)}`
  );
}
console.log();

// ── 反解：要让 168h 恰好 k=13.5（拐点 2000 ⇒ 需 2000 级；拐点 100 ⇒ 需 100 级）──
console.log("表 2｜反解「单段底数 r」：168h（池 1e7）要买到目标等级需要多大 r");
console.log("    目标等级   （拐点2000⇒k13.5）   （拐点100⇒k13.5）   （拐点100⇒k24）   需要的 r");
for (const [target, note] of [[100, "拐点100 / k=13.5"], [2000, "拐点2000 / k=13.5"], [1900, "拐点100 / k=24"]]) {
  // 解 base·r^target ≈ 10^pool  ⇒  log10(r) = (pool − log10(base)) / target
  const lr = (POOL_168H - Math.log10(ZPE_ENGINE.baseCostIp)) / target;
  console.log(
    `  ${String(target).padStart(9)}   ${note.padEnd(22)}  r = 10^${lr.toFixed(4)} = **${Math.pow(10, lr).toFixed(4)}**`
  );
}
console.log();
console.log("  ⇒ 拐点 100 时：`r ≈ 1.05`（每级只涨 5%）就能在 168h 推到 k=13.5 ✓");
console.log("  ⇒ 拐点 2000 时：需要 `r ≈ 1.0009`（几乎不涨）⇒ 指数形状**失去意义**，退化成线性 ✗");
console.log();

// ── 表 3：给定 r，k 随时间的收敛性 ──
console.log("表 3｜等级随时间的收敛性（拐点 100；池子按 log 增长：+1 阶/200h）");
console.log("   时间(h)   池(log10)   r=1.02   r=1.05   r=1.10   r=1.20   对应 k(拐点100)");
for (const h of [168, 500, 2000, 10000, 100000]) {
  const pool = POOL_168H + (h - 168) / 200;
  const f = (r) => levelFor([{ from: 0, r }], pool);
  console.log(
    `  ${String(h).padStart(8)}  ${pool.toFixed(1).padStart(9)}  ${f(1.02).toFixed(0).padStart(7)}  ${f(1.05).toFixed(0).padStart(7)}  ` +
    `${f(1.10).toFixed(0).padStart(7)}  ${f(1.20).toFixed(0).padStart(7)}   ${kOf(f(1.05), 100).toFixed(1)}`
  );
}
console.log();
console.log("  ✅ 全部**收敛**（等级 ∝ log(池)）⇒ 与 `k→26` 的有界性形状匹配 ✓");
console.log();

console.log("=".repeat(96));
console.log("  ★ 结论与建议");
console.log("=".repeat(96));
console.log("  1. **不要照抄 AD 星系的形状**（多项式）—— 它配的是不收敛的效果；我们的 k 收敛 ✗");
console.log("  2. **照抄 AD 的「阈值分段」机制**，但用在**指数底数**上：");
console.log("       cost ∝ r_seg^lv，r_seg 过阈值后跳档");
console.log("  3. **推荐组合**（表 1/2 支持）：");
console.log("       · `MATTER_B_KNEE: 2000 → 100`（让 k 在可达等级内有量级）");
console.log("       · 价格改分段指数：阈值 `100 / 1000`，底数 `1.05 → 1.2 → 2`");
console.log("       ⇒ 168h 达 k ≈ 13~16（现在只有 2.13）；且长期收敛、不会白买 ✓");
console.log("  4. 跳档阈值的经济含义：");
console.log("       · 第一档（0~100）便宜 ⇒ 早期就能把 k 推到 ~9");
console.log("       · 第二档（100~1000）中等 ⇒ ~19");
console.log("       · 第三档（>1000）陡 ⇒ 逼迫转向别的通道（符合「三层各有分工」）✓");
console.log();
console.log("  ⚠️ 我没有改任何数值。定了阈值与底数我就改，然后跑 `stage-timing` + `overload-lab` 复测。");
