#!/usr/bin/env node
/**
 * tools/dead-code-audit.mjs —— 找出「声明了但没实现」的效果
 *
 * ── 为什么需要它 ──
 * 今天连续抓到两个**完全失效**的功能：
 *   · dm4b：效果加在 darkEnergyRate()，但引擎实际转换走的是另一个函数
 *   · dm1 ：effect = {kind:"zpeFixedMultiplier"}，但没有任何代码读它
 * 两者都**没有语法错、没有异常、数值也「正常」** —— 普通测试完全查不出来。
 *
 * ── 判据（收紧版）──
 * 这个代码库的实现模式是「**检查 id**」：
 *     if (hasDe(state, "dm1")) ...         <- 字符串形式
 *     if (state.voidUpgrades.v9) ...       <- 属性形式
 * 所以：
 *   ① 只扫**真正的升级/里程碑数组**（VOID / ZPE里程碑 / 暗能量里程碑 /
 *      暗能量升级 / 可重复升级 / 梦想点升级），不扫乘区键名那种普通对象
 *   ② 一个 id 只要在代码里以**字符串字面量**或**属性访问**出现过就算被引用
 *   ③ 被列表迭代泛化处理的（如梦想点升级读 `d.effect`）不算死
 *
 * ── 已知局限 ──
 * 这是「引用存在性」检查，不是语义检查。一个 id 被引用了但仍可能行为错误
 * （dm4b 就是——它被引用了，只是引用错了地方）。所以它是**过滤网**，
 * 不是证明。真正的保证仍然要靠跑一遍真实流程。
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

const configSrc = readFileSync(join(SRC, "config.js"), "utf8");
const codeFiles = readdirSync(SRC).filter((f) => f.endsWith(".js") && f !== "config.js");

/**
 * ⚠️ 扫描前**必须剥掉注释**。
 * 自检时发现：把 `if (hasDe(state,"dm1"))` 注掉之后，工具仍然报「无死效果」——
 * 因为注释里还留着 `"dm1"` 字面量，被当成「已引用」了。
 * （和 dom-smoke.mjs 里 `el["x"]` 注释误报是同一个坑。）
 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/([^:])\/\/.*$/gm, "$1");   // 行尾注释（避免吃掉 http:// 这类）

const codeSrc = codeFiles
  .map((f) => stripComments(readFileSync(join(SRC, f), "utf8")))
  .join("\n");

/**
 * 取出某个导出常量块的源码。
 *
 * ⚠️ 必须同时认 `];` 和 `};` 两种结尾。
 * 最初只写了 `\n};`，于是**数组**（ZPE_MILESTONES 等）的块会一路吞到下一个
 * 对象常量的结尾 —— 自检时表现为「同一个假 id 同时出现在两个分组里」。
 */
function block(name) {
  const re = new RegExp(`export const ${name} = [\\[\\{]([\\s\\S]*?)\\n[\\]\\}]`, "m");
  const m = configSrc.match(re);
  return m ? m[1] : "";
}

/** 从块里取所有 id（对象键 或 id 字段） */
function idsOf(name) {
  const b = block(name);
  const out = new Set();
  for (const m of b.matchAll(/\bid:\s*"(\w+)"/g)) out.add(m[1]);
  for (const m of b.matchAll(/^\s{2}(\w+):\s*(?:\(\(\)\s*=>|\{|")/gm)) out.add(m[1]);
  return [...out];
}

const GROUPS = [
  ["虚空升级", "VOID_UPGRADES"],
  ["ZPE 里程碑", "ZPE_MILESTONES"],
  ["暗能量里程碑", "DE_MILESTONES"],
  ["暗能量升级", "DE_UPGRADES"],
  ["可重复升级", "REPEATABLE"],
  ["梦想点升级", "DREAM_UPGRADES"],
];

/** 这个 id 在代码里被引用了吗？（字符串字面量 或 属性访问） */
function referenced(id) {
  if (new RegExp(`["'\`]${id}["'\`]`).test(codeSrc)) return "字符串";
  if (new RegExp(`\\.${id}\\b`).test(codeSrc)) return "属性";
  return null;
}

const pad = (s, n) => String(s).padEnd(n);
console.log("=".repeat(78));
console.log("死代码审计：声明了但没有任何代码引用的效果");
console.log("=".repeat(78));
console.log();
console.log(`  扫描 src/ 下 ${codeFiles.length} 个文件（排除 config.js）`);
console.log();

/**
 * 泛化处理白名单。
 *
 * ⚠️ 这是**人工确认过的白名单**，不是自动推断 —— 往里加东西之前必须确认
 *    那一组真的是「按 effect.kind 泛化分发」的。
 *
 * 反例（曾经被错误地自动豁免，导致自检失效）：
 *   DE_MILESTONES 也会被 `for (const m of ...)` 迭代，但那只用于**阈值判定**，
 *   效果本身仍靠显式 id 检查实现。如果按「数组被迭代」自动豁免，
 *   往它里面塞一个没人处理的假里程碑也会被漏掉。
 *
 * DREAM_UPGRADES 是真的泛化：dreamUpgradeEffects() 读 `d.effect.kind` 分发，
 * 状态用 `dreamUpgrades[d.id]` 查 —— 全程不出现字面量。
 */
const GENERIC_GROUPS = new Set(["DREAM_UPGRADES"]);

const dead = [];
const generic = [];
let total = 0;
for (const [label, name] of GROUPS) {
  const ids = idsOf(name);
  total += ids.length;
  const miss = ids.filter((id) => !referenced(id));
  const hit = ids.length - miss.length;
  const exempt = GENERIC_GROUPS.has(name);
  console.log(
    `  ${pad(label, 14)} ${String(ids.length).padStart(3)} 个  ->  ${hit} 被引用, ` +
    `${miss.length} 未被引用${miss.length && exempt ? "  (白名单: 泛化分发)" : ""}`,
  );
  if (miss.length && exempt) generic.push(...miss.map((id) => ({ id, label })));
  else for (const id of miss) dead.push({ id, label });
}
console.log();
console.log("─".repeat(78));
if (dead.length === 0) {
  console.log("  ✅ 所有声明的 id 都被代码引用过");
} else {
  console.log(`  ❌ ${dead.length} 个 id 没有任何代码引用 —— 效果很可能是死的：`);
  console.log();
  for (const d of dead) console.log(`     ${pad(d.id, 20)} (${d.label})`);
}
console.log("─".repeat(78));
console.log();

// 对照：故意找一个肯定被引用的，证明检查不是永远报警
const sanity = ["matterBoost", "dm4b", "phaseShift", "v1"].map((id) => `${id}=${referenced(id) ?? "❌"}`);
console.log(`  对照（应当全部有值）：${sanity.join("  ")}`);
console.log();
console.log("=".repeat(78));
console.log(`  结果：共 ${total} 个 id，${dead.length === 0 ? "✅ 无死效果" : `❌ ${dead.length} 个未被引用`}`);
console.log("=".repeat(78));
console.log();
process.exit(dead.length ? 1 : 0);
