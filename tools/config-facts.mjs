#!/usr/bin/env node
/**
 * tools/config-facts.mjs —— **从代码生成 `docs/CONFIG-FACTS.md`**
 *
 * ══════════════════════════════════════════════════════════════
 * ── 为什么用"生成"而不是"手写" ──
 *   手抄必然漂移：本次文档整理时实测发现
 *     · `docs/ZONES.md` 写「`ZONES` **11** 个 / `ZONE_OF` **50** 个 id」
 *       而实际是 **12 / 56** ✗
 *     · `docs/README-STATUS.md` 写「47 个脚本全绿」（实际 45 + `--strict` 7 个失败）✗
 *   ⇒ 凡是**能从代码问出来**的数字，就**不要让文档持有它** ——
 *     生成一份 `docs/CONFIG-FACTS.md`，并在文首写明"本文件由脚本生成、不要手改" ✓
 *
 * ── 用法 ──
 *   node tools/config-facts.mjs          # 校验（不写盘）：docs/CONFIG-FACTS.md 是否与代码一致
 *   node tools/config-facts.mjs --write  # 重新生成
 *
 * ⚠️ 校验模式**故意不自动写盘** —— 否则"文档漂移"会被静默修掉、
 *   人也不会注意到机制改了 ⇒ 让它**报红**，逼人确认 ✓
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "CONFIG-FACTS.md");
const WRITE = process.argv.includes("--write");

const c = await import(new URL("../src/config.js", import.meta.url).href);

/** 逐项事实（**只放能从代码直接读出来的**，不放解释性文字） */
const facts = () => [
  ["COLLAPSE_MILESTONES（坍缩里程碑）", c.COLLAPSE_MILESTONES.length, "cm1~cm" + c.COLLAPSE_MILESTONES.length],
  ["TIER_MILESTONES（档位里程碑）", c.TIER_MILESTONES.length, "与坍缩里程碑**不是一回事**"],
  ["INFINITY_ORDER（∞ 层升级）", c.INFINITY_ORDER.length, "含置顶的 ipDouble"],
  ["DE_UPGRADES（暗能量升级）", Object.keys(c.DE_UPGRADES).length, ""],
  ["DE_MILESTONES（暗能量里程碑）", c.DE_MILESTONES.length, ""],
  ["VOID_UPGRADES（虚空升级）", Object.keys(c.VOID_UPGRADES).length, "v1~v9"],
  ["QUANTUM_MILESTONES（量子里程碑）", c.QUANTUM_MILESTONES.length, "qm1~qm" + c.QUANTUM_MILESTONES.length],
  ["ZPE_MILESTONES（ZPE 里程碑）", c.ZPE_MILESTONES.length, ""],
  ["ETERNITY_MILESTONES（永恒里程碑）", c.ETERNITY_MILESTONES.length, "em1~em" + c.ETERNITY_MILESTONES.length],
  ["ETERNITY_MILESTONES 占位中", c.ETERNITY_MILESTONES.filter((m) => m.pending).length,
    c.ETERNITY_MILESTONES.filter((m) => m.pending).map((m) => m.id).join(", ") || "（无）"],
  ["DREAM_UPGRADES（梦想升级）", c.DREAM_UPGRADES.length,
    "其中可重复 " + c.DREAM_UPGRADES.filter((x) => x.repeatable).length + " 条"],
  ["REPEATABLE（可重复升级）", Object.keys(c.REPEATABLE).length, ""],
  ["INFINITY_CHALLENGES.max（IC 关数）", c.INFINITY_CHALLENGES.max, "熵需求每关 ×" + c.INFINITY_CHALLENGES.entMult],
  ["INFINITY_CHALLENGES.ipJumpOrders", c.INFINITY_CHALLENGES.ipJumpOrders, "每关无限点跃升阶数"],
  ["ZONES（乘区）", Object.keys(c.ZONES).length, ""],
  ["ZONE_OF（id 乘区登记）", Object.keys(c.ZONE_OF).length, "由 dom-smoke 的「乘区登记」断言守"],
  ["NEKO.tiers（好感度档位）", c.NEKO.tiers.length,
    c.NEKO.tiers.map((t) => `>${t.need} ⇒ ×${t.pow}`).join("｜")],
  ["NEKO 叠乘总指数", c.NEKO.tiers.reduce((a, t) => a * t.pow, 1).toFixed(7), "em2 达成后 ×2 加成部分"],
  ["NEKO_BONUS_DOUBLE（em2 倍率）", c.NEKO_BONUS_DOUBLE, ""],
  ["ETERNITY.goalLog10（永恒门槛）", c.ETERNITY.goalLog10, "= 无限点 1e" + c.ETERNITY.goalLog10],
  ["BASE.offlineCapSeconds（基础上限）", c.BASE.offlineCapSeconds, "= " + c.BASE.offlineCapSeconds / 3600 + " 小时"],
  ["DREAM_BY_ID.offlineCap.maxLevel", c.DREAM_BY_ID.offlineCap.maxLevel,
    "每级 +" + c.DREAM_BY_ID.offlineCap.hoursPerLevel + "h ⇒ 上限 " +
    (c.BASE.offlineCapSeconds / 3600 + c.DREAM_BY_ID.offlineCap.maxLevel * c.DREAM_BY_ID.offlineCap.hoursPerLevel) + "h"],
  ["ZPE_ENGINE 字段数", Object.keys(c.ZPE_ENGINE).length, Object.keys(c.ZPE_ENGINE).join(", ")],
  // ★★★ 2025/2026：ZPE 引擎 2000 级后的价格增幅
  //   ⚠️ 语义是**逐级连乘**（ζ = mult^(lv−level+1)）⇒ `mult` = **每级再乘的倍率** ✓
  //   ⚠️ 曾在 2026 由 1e5 调到 **1e9**（用户：「一次能爬的还是太多了」）——
  //     这里**不写死数量级**，直接从常数算，避免注释再过期 ✓
  ["ZPE_ENGINE.steepAfter", JSON.stringify(c.ZPE_ENGINE.steepAfter),
    `level=生效级｜mult=**每级再乘的倍率**（ζ = mult^(lv−level+1)，逐级连乘）`
    + `｜⇒ 生效后每级 +${Math.log10(c.ZPE_ENGINE.costGrowth * (c.ZPE_ENGINE.steepAfter?.mult ?? 1e9)).toFixed(3)} 个数量级`],
  // ★★★ 2025：`IP_DOUBLE_AD.costCap` **已彻底删除**（用户裁定）——
  //   实测它没在防溢出（`Decimal.pow` 自己处理 e308 以上），唯一作用是**砍可买级数** ✗
  //   ⇒ 这里断言"**它不存在**"，防止有人手滑加回来 ✓
  ["IP_DOUBLE_AD 有 costCap 吗", String("costCap" in c.IP_DOUBLE_AD),
    "必须是 **false**（已删除；若变 true 说明价格又被封顶 ⇒ 可买级数会被钉死）"],
  ["IP_DOUBLE_AD 字段", Object.keys(c.IP_DOUBLE_AD).join(", "), ""],
  // ★★★ 2025：这两个是**文档最容易写错**的地方（本轮实测抓到）
  ["CLIMB", JSON.stringify(c.CLIMB), "爬升形状的一次性旋钮（与 climbFactor 一起改）"],
  ["QUANTUM 字段", Object.keys(c.QUANTUM).join(", "),
    "⚠️ **没有 growthRateMax / growthRateHalf** —— 已随 R 退休删除 ✗"],
  ["QUANTUM.growthRateMax 是否存在", String("growthRateMax" in c.QUANTUM),
    "必须是 **false**；若变 true 说明 R 被恢复了 ⇒ 回来重写相关文档"],
  ["growthRateHalf 是否存在", String("growthRateHalf" in c.QUANTUM), "同上"],
  ["epMult.costMultTiers", JSON.stringify(c.ETERNITY_UPGRADES.epMult.costMultTiers), ""],
  ["epMult.costThresholds", JSON.stringify(c.ETERNITY_UPGRADES.epMult.costThresholds),
    "末段 null = 永不切换（无封顶）"],
];

/**
 * 脚本口径（直接问 run-all，不自己数）。
 *
 * ⚠️⚠️ **2026 修 bug**：`defaultRun` 原来在 catch 里**留在字符串 `"-"`** ——
 *   于是「**无法测量**」被当成了「**测得 `-` 分**」：
 *     · 一次 `--write` 就把 `**-**` 写进权威事实表（污染 ✗）
 *     · 而校验模式拿文件里的 `-` 与代码算出的 `-` 一比 ⇒ **假绿** ✗✗
 *   实测触发条件：沙箱禁止**管道 stdio** ⇒ `execFileSync` 抛 `EPERM`。
 *   ⚠️ 这与「文件访问被拒」是**两套**限制 —— 修 ACL 治不了它（实测确认过）。
 * ⇒ 现在：**`null` = 未能测量**（与「测得 0」彻底区分），由调用方决定怎么办 ✓
 */
async function scriptFacts() {
  const { execFileSync } = await import("node:child_process");
  let defaultRun = null;                      // null = 未能测量（**不是** "-"）
  try {
    const out = execFileSync(process.execPath, [join(ROOT, "tools", "run-all.mjs"), "--list"], { encoding: "utf8" });
    defaultRun = out.split(/\r?\n/).filter((l) => /\.(mjs|cjs)$/.test(l.trim())).length;
  } catch (_) { defaultRun = null; }
  const { readdirSync } = await import("node:fs");
  const all = readdirSync(join(ROOT, "tools")).filter((n) => /\.(mjs|cjs)$/.test(n)).length;
  return [
    ["默认批跑脚本数", defaultRun, "权威来源 = `node tools/run-all.mjs --list`"],
    ["tools/ 下脚本总数", all, ".mjs + .cjs"],
    ["--strict 已知失败数", 7, "见 `docs/TODO.md` M 段（过期断言/坏工具/数值漂移）"],
  ];
}

function render() {
  const rows = [...facts(), ...scriptRows];
  const L = [];
  L.push("# 代码事实表（**由脚本生成 —— 不要手改**）");
  L.push("");
  L.push("> **状态：✅ 权威（机器生成）**");
  L.push("> 生成器：`node tools/config-facts.mjs --write`");
  L.push("> 校验器：`node tools/config-facts.mjs`（**报红而非静默改写** —— 逼人确认机制变更）");
  L.push("> 已接入 `npm test`：本文件与代码不一致时**测试会失败** ✓");
  L.push("");
  L.push("## 为什么要这份文件");
  L.push("");
  L.push("```");
  L.push("凡是**能从代码问出来**的数字，就不让别的文档持有它 —— 因为手抄必然漂移。");
  L.push("实证（2025 文档整理时实测）：");
  L.push("  · `docs/ZONES.md` 写「ZONES 11 个 / ZONE_OF 50 个 id」 ⇒ 实际 12 / 56 ✗");
  L.push("  · `docs/README-STATUS.md` 那句「脚本全绿」 ⇒ 漏写了 `--strict` 的失败 ✗");
  L.push("⇒ 数字集中到这里 + 自动校验；叙述性文档只写「是什么 / 为什么」 ✓");
  L.push("```");
  L.push("");
  L.push("## 事实表");
  L.push("");
  L.push("| 项 | 实测 | 备注 |");
  L.push("|---|---|---|");
  for (const [k, v, note] of rows) L.push(`| ${k} | **${v}** | ${note ?? ""} |`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("## 与本表冲突时的处理");
  L.push("");
  L.push("```");
  L.push("① 若**代码是对的**（机制就是这么定的）⇒ 改别的文档来对齐本表 ✓");
  L.push("② 若**代码是错的**（机制本该是文档写的那样）⇒ 改代码，然后 `--write` 重生成本表 ✓");
  L.push("③ 两者都不确定 ⇒ **停下来问用户**（本表只报事实，不判断意图 ✗）");
  L.push("```");
  return L.join("\n") + "\n";
}

const scriptRows = await scriptFacts();

// ── ★★ 2026：未能测量的行 ⇒ **沿用文件里已有的值**，绝不写 `-` ──
//   理由见 `scriptFacts()` 的说明。若文件里也没有可沿用的值 ⇒ **拒绝生成**
//   （宁可报错，也不要往权威事实表里塞一个假数）✓
const unmeasured = [];
if (scriptRows[0][1] === null) {
  const prev = existsSync(OUT)
    ? /\|\s*默认批跑脚本数\s*\|\s*\*\*(.+?)\*\*\s*\|/.exec(readFileSync(OUT, "utf8"))
    : null;
  if (!prev) {
    console.log("❌ 无法测量「默认批跑脚本数」（沙箱禁管道 stdio），且事实表里也没有可沿用的值");
    console.log("   ⇒ **拒绝生成**：请在没有该限制的环境里跑一次 `node tools/config-facts.mjs --write`");
    process.exit(1);
  }
  scriptRows[0][1] = prev[1];
  unmeasured.push("默认批跑脚本数");
}

const want = render();

if (WRITE) {
  writeFileSync(OUT, want, "utf8");
  console.log(`✅ 已生成 ${OUT.replace(ROOT, "").replace(/\\/g, "/")}（${want.split("\n").length} 行）`);
  if (unmeasured.length) {
    console.log(`  ⚠️ 但这些行**未重新测量**（已沿用文件里的旧值，不写假数）：${unmeasured.join(", ")}`);
  }
  process.exit(0);
}

console.log("=".repeat(96));
console.log("代码事实表校验（docs/CONFIG-FACTS.md vs src/config.js）");
console.log("=".repeat(96));
if (!existsSync(OUT)) {
  console.log("  ❌ docs/CONFIG-FACTS.md 不存在 ⇒ 跑 `node tools/config-facts.mjs --write`");
  process.exit(1);
}
const have = readFileSync(OUT, "utf8");
if (have === want) {
  console.log("  ✅ 一致（本文件与代码同步）");
  console.log(`  · 共 ${scriptRows.length + facts().length} 项事实被校验`);
  if (unmeasured.length) {
    console.log(`  ⚠️ 其中这些**未能测量**（沿用了文件里的旧值 ⇒ 这一项**没有被真正校验**）：${unmeasured.join(", ")}`);
  }
  process.exit(0);
}
// 逐行找差异，给出**可读的**报告
const hl = have.split("\n");
const wl = want.split("\n");
const diffs = [];
for (let i = 0; i < Math.max(hl.length, wl.length); i++) {
  if (hl[i] !== wl[i]) diffs.push({ line: i + 1, have: hl[i] ?? "(缺)", want: wl[i] ?? "(多余)" });
}
console.log(`  ❌ 与代码不一致（${diffs.length} 行差异）—— 说明机制改了、事实表没跟上：`);
for (const d of diffs.slice(0, 14)) {
  console.log(`     第 ${d.line} 行：`);
  console.log(`       文件有： ${String(d.have).slice(0, 96)}`);
  console.log(`       代码是： ${String(d.want).slice(0, 96)}`);
}
if (diffs.length > 14) console.log(`     …还有 ${diffs.length - 14} 行`);
console.log();
console.log("  处理：确认代码无误后跑 `node tools/config-facts.mjs --write` ✓");
console.log("=".repeat(96));
process.exit(1);
