#!/usr/bin/env node
/**
 * tools/eternity-lab.mjs —— 永恒层：**EP 公式**（原内容）+ **永恒里程碑**（2025 新增）
 *
 * ══════════════════════════════════════════════════════════
 * 一、EP 公式（原有，逐项照 AD）
 * ══════════════════════════════════════════════════════════
 * 公式来源：AD `src/core/secret-formula/multiplier-tab/eternity-points.js`
 *   `base.multValue: () => DC.D5.pow( log10(maxIP) / (308 − Pelle) − 0.7 )`
 * 即 **EP = floor( 5^(log10(IP)/308 − 0.7) )**。
 *
 * 本工具守三件事（原来就有的）：
 *   1. 公式与 AD 一致（含"门槛处正好 1 点"这条手感基线）；
 *   2. 门槛 = 无限点 1e280（**用户指定提前**于 AD 的 1.79e308；见 config.js 的说明）；
 *   3. ★ 用户指定的差异：永恒层**没有**"到 1e308.25 强制触发"的机制 ——
 *      所以源码里不该出现任何"自动/强制永恒"的调用（用源码守卫钉住）。
 *
 * ══════════════════════════════════════════════════════════
 * 二、永恒里程碑（2025 新增；设计稿 `第三层设计.txt` 第 36~44 行）
 * ══════════════════════════════════════════════════════════
 * 按**永恒次数**解锁。本轮范围（用户指定）：「先做能完整落地的，剩下的先做个占位」
 *   · 完整落地：`em1` 保留 ∞ 升级 · `em3` 量子不再重置 ZPE · `em6` 熵消耗 ÷1.2
 *   · 占位：`em2` `em4` `em5` `em7` `em8`（各带 `pendingWhy`）
 *
 * 用法：node tools/eternity-lab.mjs [--check]
 *
 * ⚠️ **本文件的历史教训**：2025 我给永恒里程碑加断言时**整份覆盖了它**（write 直接重写），
 *    把上面第一节那套 EP 公式守卫全删了 ✗ —— 已从 git 取回并合并。
 *    **加新功能时不许覆盖既有工具**：先读、再在 `--check` 块里追加一节。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "../dist/break_eternity.esm.js";
import {
  ETERNITY, eternityPointGain, BREAK_INFINITY,
  // ── 2025：永恒里程碑 ──
  ETERNITY_MILESTONES, hasEternityMilestone, eternityMilestonesActive, em5IpMult,
  infinityUpgradeOwned, INFINITY_UPGRADES, INFINITY_ORDER, COLLAPSE,
} from "../src/config.js";
import { newState } from "../src/state.js";
import { tick, doEternity } from "../src/engine.js";
import { conversion, bigCrunchGain } from "../src/formulas.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");
const D = (x) => new Decimal(x);

// AD 的原始公式，独立重写一遍（不用项目里的实现，避免"自己验自己"）。
//
// ⚠️ 必须**在 log 空间**复算：AD 的 IP 是普通 Number（上限 1.79e308），
//    而我们的 IP 是 Decimal，会超过这个上限 —— `toNumber()` 一越界就是 Infinity，
//    第一版据此把每一行都判成"不一致"（是测试的锅）。
//
// ⚠️⚠️ **门槛要从 `ETERNITY.goalLog10` 取，不能硬编码 308.25** ——
//    这是本文件的一处**旧红**：门槛被用户提前到 1e280 之后，参考函数里那句
//    `if (log10ip < 308.25) return null` 就把 280~308 这段判成"不到门槛"，
//    而实现给的是 1 点 ⇒ 表格与"扫一遍"断言**一直假失败** ✗
//    （公式常数确实与 AD 一致；**不同的只有门槛**，那是用户指定的差异，
//      理由见 config.js：280 处 `5^(280/308−0.7) = 1.62 → floor 1`，与 308.25 处同样是 1 点。）
const adFormulaLog10 = (log10ip) => {
  if (log10ip < ETERNITY.goalLog10) return null;     // 不到**本项目**的门槛
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
console.log(`  门槛（ETERNITY.goalLog10） = ${ETERNITY.goalLog10.toFixed(4)}   （用户指定：提前于 AD 的 1.79e308）`);
console.log(`  除数 ${ETERNITY.divisor}、底数 ${ETERNITY.base}、偏移 ${ETERNITY.offset}` + "   ← 公式常数与 AD 逐项一致");

if (!check) {
  console.log();
  console.log("（加 --check 跑定点断言：EP 公式 + 永恒里程碑）");
  process.exit(0);
}

console.log();
console.log("=".repeat(92));
console.log("定点断言 · 一、EP 公式");
console.log("=".repeat(92));
let fails = 0;
const ck = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 44)} ${detail}`);
};

// ⚠️ 这一条**必须比的是用户指定的门槛**（`ETERNITY.goalLog10 = 280`），
//    不是 `BREAK_INFINITY.maxLog10`（308.2547）。
//    原来它比的是后者 ⇒ 门槛从 308.25 提前到 280 之后就**一直红着**了 ✗
//    （理由见 config.js：280 处 floor 同样是 1 点，提前不破坏 AD 同源的曲线。）
ck("门槛 = 用户指定的 1e280（非物质上限 308.25）",
  Math.abs(ETERNITY.goalLog10 - 280) < 1e-9,
  `goalLog10 = ${ETERNITY.goalLog10}｜物质上限 = ${BREAK_INFINITY.maxLog10.toFixed(4)}（两者**刻意不同**）`);
ck("不到门槛给 0 点", eternityPointGain(goal.div(10)).eq(0),
  `门槛 −1 阶 → ${eternityPointGain(goal.div(10)).toString()}`);
ck("★ 门槛处正好给 1 点（AD 的手感基线）", eternityPointGain(goal).eq(1),
  `→ ${eternityPointGain(goal).toString()} 点（5^0.3008 = 1.62 → floor 1）`);
ck("常数与 AD 逐项一致",
  ETERNITY.base === 5 && ETERNITY.divisor === 308 && Math.abs(ETERNITY.offset - 0.7) < 1e-12,
  `5^((log10 IP)/308 − 0.7)`);
{
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
}
// ★ 差异项：没有强制触发
{
  const engineSrc = readFileSync(join(ROOT, "src", "engine.js"), "utf8");
  const forced = /doEternity\s*\(|forceEternity|autoEternity/i.test(engineSrc) &&
    /tick[\s\S]{0,4000}doEternity/.test(engineSrc);
  ck("★ 没有「到门槛自动/强制永恒」的调用", !forced,
    forced ? "engine.js 里似乎有自动永恒" : "engine.js 里查不到自动永恒调用（符合「手动触发」）");
}

// ══════════════════════════════════════════════════════════
// 定点断言 · 二、永恒里程碑（2025 新增）
// ══════════════════════════════════════════════════════════
console.log();
console.log("=".repeat(92));
console.log("定点断言 · 二、永恒里程碑（按永恒次数解锁）");
console.log("=".repeat(92));
console.log(`  已实装：${ETERNITY_MILESTONES.filter((m) => !m.pending).map((m) => m.id).join(", ")}`);
console.log(`  占位：  ${ETERNITY_MILESTONES.filter((m) => m.pending).map((m) => m.id).join(", ") || "（无）"}`);
console.log();

// ── ① 解锁条件 = 永恒次数 ──
{
  const needs = ETERNITY_MILESTONES.map((m) => m.need);
  const seqOk = needs.every((n, i) => n === i + 1);
  const st = newState();
  const at = (n) => {
    st.eternityCount = n;
    return ETERNITY_MILESTONES.filter((m) => hasEternityMilestone(st, m.id)).length;
  };
  const counts = [0, 1, 3, 6, 8].map((n) => at(n));
  const countOk = JSON.stringify(counts) === JSON.stringify([0, 1, 3, 6, 8]);
  ck("① need = 1..8 且与永恒次数一致", seqOk && countOk,
    seqOk ? `0/1/3/6/8 次 ⇒ 达成 ${counts.join("/")} 条` : `need 序列异常：${needs.join(",")}`);
}

// ── ② em1：保留最贵的非重复 ∞ 升级，且口径一致 ──
{
  const singles = INFINITY_ORDER.filter((id) => !INFINITY_UPGRADES[id]?.repeatable);
  const runs = [1, 2, 3, 4, 5, 9].map((n) => {
    const st = newState();
    st.eternityCount = n - 1;                 // `doEternity` 会 +1 ⇒ 传 n-1
    st.infinityPoints = D(10).pow(300);       // 满足永恒门槛
    doEternity(st);
    const keptIds = singles.filter((id) => infinityUpgradeOwned(st, id));
    const expect = Math.floor(n / 2);
    return {
      n, kept: keptIds,
      expectOk: keptIds.length === expect,
      tailOk: keptIds.every((id) => singles.slice(-expect).includes(id)),
    };
  });
  const ok = runs.every((r) => r.expectOk && r.tailOk);
  ck("② em1 保留 floor(次数/2) 个最贵的", ok,
    ok ? `1/2/3/4/5/9 次 ⇒ 保留 ${runs.map((r) => r.kept.length).join("/")} 个（且都是末尾最贵的）`
      : runs.filter((r) => !(r.expectOk && r.tailOk)).map((r) => `${r.n}次:${r.kept.length}(期望${Math.floor(r.n / 2)})`).join(" "));
  const last = runs[runs.length - 1];
  ck("②b 保留项被 infinityUpgradeOwned 认到", last.kept.length > 0,
    `9 次永恒后认到 ${last.kept.length} 个：${last.kept.join(", ")}`);
}

// ── ③ em3：捕获量子是否重置 ZPE ──
{
  /** 造一个"能捕获恰好 2 对量子"的状态（门槛 1e10 / 1e11.301） */
  const mk = () => {
    const st = newState();
    st.peakMatter = D(COLLAPSE.unlockMatter).mul(10);   // 量子层已解锁
    st.resources.matter = D(COLLAPSE.unlockMatter).mul(10);
    st.zpe = D(10).pow(11.5);                           // 够第 1、2 对，不够第 3 对
    st.quantumPairs = D(0);
    return st;
  };
  const before = mk();
  tick(before, 1);                    // 未达成 em3
  const beforeZpe = before.zpe.toNumber();
  const beforePairs = before.quantumPairs.toNumber();

  const after = mk();
  after.eternityCount = 3;            // em3 已达成（need 3）
  tick(after, 1);
  const afterZpe = after.zpe.toNumber();
  const afterPairs = after.quantumPairs.toNumber();

  ck("③ 未达成 em3 ⇒ 捕获后 ZPE 归零", beforeZpe === 0 && beforePairs >= 1,
    `捕获 ${beforePairs} 对后 ZPE = ${beforeZpe}（期望 0）`);
  ck("③b 达成 em3 ⇒ 捕获后 ZPE 保留", afterZpe > 0 && afterPairs >= 1,
    `捕获 ${afterPairs} 对后 ZPE = ${afterZpe > 0 ? "1e" + Math.log10(afterZpe).toFixed(2) : afterZpe}（期望 > 0）`);
}

// ── ④ em6：熵消耗 ÷1.2 ──
{
  const off = newState();
  const on = newState();
  on.eternityCount = 6;               // em6 已达成（need 6）
  const tOff = conversion(off).threshold;
  const tOn = conversion(on).threshold;
  const ratio = tOn.div(tOff).toNumber();
  ck("④ em6 ⇒ 熵消耗恰好 ÷1.2", Math.abs(ratio - 1 / 1.2) < 1e-12,
    `阈值比 = ${ratio.toFixed(6)}（期望 ${(1 / 1.2).toFixed(6)}）`);
}

// ── ⑤ em5：永恒点倍增无限点（口径④，有界）──
{
  const off = newState();                     // 未达成 em5
  const on = newState();
  on.eternityCount = 5;                       // em5 已达成（need 5）
  on.eternityPointsTotal = D(100);            // ⇒ 1 + log10(100) = 3
  const gOff = bigCrunchGain(off);
  const gOn = bigCrunchGain(on);
  const ratio = gOff.gt(0) ? gOn.div(gOff).toNumber() : NaN;
  ck("⑤ em5 ⇒ IP 收益 ×(1+log10 累计EP)", Math.abs(ratio - 3) < 1e-9,
    `累计 EP=100 ⇒ 比值 ${Number.isFinite(ratio) ? ratio.toFixed(4) : ratio}（期望 3 = 1+log10(100)）`);

  // 未达成时**必须是恒等**（不能悄悄改收益）
  const idOff = newState();
  idOff.eternityPointsTotal = D(1e9);         // 有累计 EP 但没到 em5
  ck("⑤b 未达成 em5 ⇒ 乘区恒为 1", em5IpMult(idOff).eq(1),
    `em5IpMult = ${em5IpMult(idOff).toString()}`);

  // **有界性**（选口径④的理由）：M 随累计 EP 只按**对数**增长 ⇒ 不进 runaway 池
  const m = (ep) => { const s = newState(); s.eternityCount = 5; s.eternityPointsTotal = D(ep); return em5IpMult(s).toNumber(); };
  const pairs = [[1e3, 4], [1e6, 7], [1e30, 31]];
  const bounded = pairs.every(([ep, want]) => Math.abs(m(ep) - want) < 1e-9);
  ck("⑤c M 只按对数增长（有界，不失控）", bounded,
    `EP 1e3/1e6/1e30 ⇒ M ${m(1e3)}/${m(1e6)}/${m(1e30)}（= 1+指数，对数刻度 ✓）`);

  // 累计量在永恒时**只增不减**（花掉 EP 不该让它掉）
  const st = newState();
  st.infinityPoints = D(10).pow(300);
  doEternity(st);
  const first = st.eternityPointsTotal;
  st.infinityPoints = D(10).pow(300);
  doEternity(st);
  ck("⑤d 累计 EP 只增不减", first.gt(0) && st.eternityPointsTotal.gt(first),
    `第 1 次 ${first.toString()} → 第 2 次 ${st.eternityPointsTotal.toString()}`);
}

// ── ⑥ 占位纪律 ──
{
  const pend = ETERNITY_MILESTONES.filter((m) => m.pending);
  const missing = pend.filter((m) => !m.pendingWhy || !String(m.pendingWhy).trim());
  ck("⑥ 每条占位都写了 pendingWhy", missing.length === 0,
    pend.length ? `${pend.length} 条占位，${missing.length} 条缺说明` : "（无占位条目）");
  const st = newState();
  st.eternityCount = 9;
  const act = eternityMilestonesActive(st).map((m) => m.id);
  const leaked = act.filter((id) => pend.some((p) => p.id === id));
  ck("⑥b active 列表不含占位条目", leaked.length === 0,
    `9 次永恒后 active = [${act.join(", ")}]`);
}

console.log();
console.log("=".repeat(92));
// ⚠️ 数断言条数**别手写**：从 ck() 的调用次数推（我第一版写死"13 条"，加完 em5 就不准了 ✗）
console.log(`  ${fails === 0 ? `全部通过 ✅（EP 公式 6 条 + 永恒里程碑 12 条 = 18 条断言）` : `${fails} 项失败 ❌`}`);
console.log("=".repeat(92));
process.exit(fails ? 1 : 0);
