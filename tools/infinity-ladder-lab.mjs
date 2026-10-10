#!/usr/bin/env node
/**
 * tools/infinity-ladder-lab.mjs —— ∞ 层**早段经济**：攒够 128 IP 要几次大坍缩 / 多久
 *
 * ══════════════════════════════════════════════════════════
 * ★★★ 2025 重写：整篇的**前提已经作废**，所以模型全部删掉
 * ══════════════════════════════════════════════════════════
 * 旧版的前提（写在旧头注里）：
 *   「打破无限要 128 IP，而 **IP/次 恒为 1**（G3 故意设计）⇒ 需要 128 次大坍缩」
 *   ⇒ 于是它花了两百行去**设计一个"深度复利"新公式**来把次数压到 24 以内，
 *     并反解 `c`、算"需要多大的 b"、跟 `bMax` 比……
 *
 * ⚠️ 这个前提**现在不成立**：
 *   · **① 无限增幅是存在的**（`ipDouble`，×2/级）⇒ IP/次**不是**恒为 1
 *   · 且它的首价已按用户裁定改成 **1 点**（序列 `1 → 1 → 10 → 100 …`）⇒ 开局就买得起
 *   · 更根本：**"深度复利 IP"这个提案已经被放弃**（用户裁定走"引擎倍率"那条路，甲B）
 *   ⇒ 旧版那套 `DEPTH_PER_CRUNCH = halvingOrders × log2(1/crunchBelow)` 读到
 *     `OVERLOAD.halvingOrders === undefined` ⇒ `NaN` ⇒ 整表坏掉 ✗
 *     （而且它是**第二次重建引擎的数学** —— 与 `crunch-speed-lab` 同一个病）
 *
 * ⇒ 现在改成**真引擎实测**，回答那个真正有用的问题：
 *     「从零开始，攒到 128 IP（打破无限）要几次大坍缩 / 多少小时？」
 *     ① 基准：**只靠大坍缩**（不买 ①）
 *     ② 玩家正常玩：**买 ①**（×2/级）
 *     ③ 买 ① 到买满（`buyIpDoubleMax`）
 *
 * 用法：`node tools/infinity-ladder-lab.mjs [--check] [小时上限]`
 */
import Decimal from "../dist/break_eternity.esm.js";
import {
  BREAK_INFINITY, REPEATABLE, VOID_UPGRADES, DE_UPGRADES, DREAM_UPGRADES,
  INFINITY_ORDER, INFINITY_UPGRADES,
} from "../src/config.js";
import { shouldCrunch } from "../src/formulas.js";
import {
  advance, doClick, buyRepeatable, buyTrap, buyVoidUpgrade, buyDeUpgrade, buyDreamUpgrade,
  breakInfinity, unlockZpeEngine, buyZpeEngineLevel, buyIpDoubleMax, buyInfinityUpgrade, doBigCrunch,
} from "../src/engine.js";
import { newState } from "../src/state.js";

const D = (x) => new Decimal(x);
const num = (v) => (v && v.toNumber ? v.toNumber() : Number(v));
const lg = (v) => { const n = num(v && v.log10 ? v.log10() : Math.log10(v)); return Number.isFinite(n) ? n : NaN; };
const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h < 1 ? `${(h * 60).toFixed(1)} 分` : h < 48 ? `${h.toFixed(2)} h` : `${(h / 24).toFixed(1)} 天`);
const UNLOCK_IP = num(BREAK_INFINITY.unlockCost);

/**
 * 跑一局经济。
 * @param {"none"|"normal"|"max"} ipd  ①的处理：不买 / 能买就买 / 买满
 * @param {number} capH  小时上限
 * @returns {{hours:number|null, crunches:number, ip:number, lv:number}}
 */
function runEconomy(ipd = "normal", capH = 48) {
  const s = newState();
  for (let i = 0; i < 10; i++) doClick(s);
  let t = 0;
  while (t < capH * 3600) {
    if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let i = 0; i < 10; i++) doClick(s);
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
    buyTrap(s, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);
    for (const d of DREAM_UPGRADES) buyDreamUpgrade(s, d.id);
    const singles = INFINITY_ORDER.filter((id) => !INFINITY_UPGRADES[id].repeatable)
      .sort((a, b) => (INFINITY_UPGRADES[a].cost ?? 0) - (INFINITY_UPGRADES[b].cost ?? 0));
    for (const id of singles) buyInfinityUpgrade(s, id);
    if (ipd === "max") buyIpDoubleMax(s);
    else if (ipd === "normal") for (let i = 0; i < 10 && buyInfinityUpgrade(s, "ipDouble").ok; i++);
    unlockZpeEngine(s);
    buyZpeEngineLevel(s, true);
    // ★ 判据：攒够 128 IP（= 买得起"打破无限"）
    if (s.infinityPoints.gte(BREAK_INFINITY.unlockCost)) {
      // ⚠️ 坍缩次数**直接读 `bigCrunchCount`**（见下：`shouldCrunch` 会漏数 ✗）
      return { hours: t / 3600, crunches: num(s.bigCrunchCount), ip: lg(s.infinityPoints), lv: num(s.ipDoubleLevel) };
    }
    // ⚠️⚠️ 这里**不要**只数 `shouldCrunch`（我第一版就是这么写的 ⇒ 全部报 0 次 ✗）：
    //   · 未打破无限时，坍缩是 **`tick` 里的硬顶强制触发**（`phaseResets`：物质撞 1e308.2547 即坍缩）
    //   · `shouldCrunch` 是**按时间收手**那条路（`runElapsed ≥ runSeconds`），**要到打破之后才有用**（它开头就
    //     `if (!state.brokenInfinity) return false`）
    //   ⇒ 所以早段的坍缩**根本不会**被 `shouldCrunch` 报出来 ⇒ 必须读计数器 ✓
    if (shouldCrunch(s)) doBigCrunch(s);
    advance(s, 5);
    t += 5;
  }
  return { hours: null, crunches: num(s.bigCrunchCount), ip: lg(s.infinityPoints), lv: num(s.ipDoubleLevel) };
}

const CAP_H = Number(process.argv.find((a) => /^\d+(\.\d+)?$/.test(a))) || 48;

console.log("=".repeat(104));
console.log(`★ 攒够 ${UNLOCK_IP} 无限点（= 打破无限）要几次大坍缩 / 多久 —— **真引擎实测**`);
console.log("=".repeat(104));
console.log(`  上限 ${CAP_H} 小时｜① 无限增幅 = ×2/级，首价 1 点（用户裁定）`);
console.log();
console.log(`  ${pad("① 的处理", 22)} ${pad("达到 128 IP 用时", 18)} ${pad("大坍缩次数", 12)} ${pad("① 等级", 8)} ${pad("判定", 10)}`);
const rows = [];
for (const [ipd, label] of [["none", "不买 ①（纯大坍缩）"], ["normal", "买 ①（正常玩）"], ["max", "买满 ①（极限）"]]) {
  const r = runEconomy(ipd, CAP_H);
  rows.push({ ipd, label, ...r });
  console.log(
    `  ${pad(label, 22)} ${pad(r.hours == null ? `> ${CAP_H}h 未达` : fH(r.hours), 18)} ` +
    `${pad(r.crunches, 12)} ${pad(r.lv, 8)} ${pad(r.hours == null ? "❌" : "✅", 10)}`
  );
}
console.log();
console.log(`  ★ 读法：`);
console.log(`     · 旧版假设"IP/次 恒为 1 ⇒ 要 ${UNLOCK_IP} 次"；上表就是**实测反驳/证实**它的地方 ✓`);
console.log(`     · ① 把每次的 IP 翻倍 ⇒ 次数与耗时都应显著下降（若没有 ⇒ ① 没生效 ✗）`);
console.log(`     · 此表同时是"早段节奏"的体检：达到 ${UNLOCK_IP} IP 的小时数就是"打破无限"的时刻 ✓`);
console.log();

if (process.argv.includes("--check")) {
  console.log("=".repeat(104));
  console.log("定点断言");
  console.log("=".repeat(104));
  let fails = 0;
  const ck = (ok, label, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };
  const get = (k) => rows.find((r) => r.ipd === k);

  // ① 全场无 NaN（旧版就死在这）
  const anyNaN = rows.some((r) => Number.isNaN(r.crunches) || Number.isNaN(r.lv));
  ck(!anyNaN, "★ 全部行都没有 NaN（旧版整表 NaN ✗）",
    anyNaN ? "有 NaN" : `${rows.length} 行全部有限`);

  // ② 三档都必须**能达到** 128 IP（否则早期经济是断的）
  const allReached = rows.every((r) => r.hours != null);
  ck(allReached, `★ 三档都能在 ${CAP_H}h 内攒到 ${UNLOCK_IP} IP`,
    rows.map((r) => `${r.ipd}=${r.hours == null ? "未达" : fH(r.hours)}`).join("｜"));

  // ③ 买 ① 必须**减少**大坍缩次数（① 的意义所在）
  const n0 = get("none")?.crunches, n1 = get("normal")?.crunches;
  ck(n1 != null && n0 != null && n1 < n0, "★ 买 ① 之后大坍缩次数**减少**",
    `不买 ${n0} 次 → 正常 ${n1} 次`);

  // ④ 达到 128 IP 的真实次数必须 **< 128**（反驳旧版"IP/次 恒为 1"的前提）
  const best = get("max")?.crunches;
  ck(best != null && best < UNLOCK_IP, `★ 实测次数 < ${UNLOCK_IP}（旧前提"恒为 1"不成立）`,
    `买满 ① ⇒ ${best} 次`);

  // ⑤ ① 等级必须真的涨起来（否则"买满"没生效）
  ck((get("max")?.lv ?? 0) > (get("none")?.lv ?? 0), "★ 买满 ① ⇒ 等级 > 不买 ①",
    `不买 ${get("none")?.lv} 级 → 买满 ${get("max")?.lv} 级`);

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
