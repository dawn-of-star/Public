#!/usr/bin/env node
/**
 * tools/zone-audit.mjs —— 乘区审计（语义判据版）
 *
 * ══════════════════════════════════════════════════════════════
 * 乘区定义（config.js 的 ZONE_RULES 是唯一数据源）
 * ══════════════════════════════════════════════════════════════
 *
 *   最终显示数值 = { [ 上一轮运算值 × a区 ] ^ b区 } × c区
 *
 *   a区 = 加法池 × 乘法池（不带「最终」的所有加成）
 *   b区 = 指数区 —— 对**整个值**取幂 `{...}^e`
 *   c区 = 带「最终」二字的加成
 *
 * ── 关键判据（上一版搞错的地方）──
 *   ❌ 旧判据：「代码里出现 pow() 就是 b区」——**语法判据，错的**
 *   ✅ 新判据：只有**把值本身拿去取幂**才算 b区
 *
 *   区分方法看**底数是什么**：
 *     · `Decimal.pow(常量, 等级/数量)`  -> 一个**因子**（每级乘 m、价格 r^n）-> a区
 *     · `Decimal.pow(10, 暗物质)`       -> 一个**因子**（10^DM）          -> a区
 *     · `值.pow(指数)`                  -> **对值本身取幂**             -> b区 ✅
 *
 * ── 现状 ──
 *   b区 **是空的**。第一个成员将是「无限升级4」：给 ZPE 一个 `^1.048`。
 *   但 `zpeMultiplier = (ZPE+1)^0.02` 已经是「对值取幂」的形状 —— 需要你确认
 *   它算不算 b区（它现在被当作 a区 的一个倍率因子在用）。
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/([^:])\/\/.*$/gm, "$1");
const read = (f) => strip(readFileSync(join(SRC, f), "utf8"));
const pad = (s, n) => String(s).padEnd(n);
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

const files = { "formulas.js": read("formulas.js"), "config.js": read("config.js"), "engine.js": read("engine.js") };

console.log("=".repeat(90));
console.log("乘区审计 —— 语义判据：b区 = 「对值本身取幂」");
console.log("=".repeat(90));
console.log();

// ══════════════════════════════════════════════════════════
console.log("─".repeat(90));
console.log("[1] b区候选：**对值本身取幂**（形如 `某值.pow(指数)`）");
console.log("─".repeat(90));
console.log();
const bCandidates = [];
for (const [name, src] of Object.entries(files)) {
  // 所有 `.pow(` 调用，排除 `Decimal.pow(`（那是静态工厂，底数是常量 -> a区因子）
  //
  // ⚠️ 上一版用了负向断言 `(?<!Decimal\b)`，但它检查的是**匹配开始之前**的文本，
  //    而匹配从 "Decimal" 本身开始，所以断言永远通过 —— 结果 `Decimal.pow` 全被算成 b区。
  //    这个 bug 让工具报出「24 处 b区」的假象。改成匹配后显式过滤。
  for (const m of src.matchAll(/([\w.$]+(?:\.[\w$]+\([^)]*\))*)\.pow\(/g)) {
    const base = m[1];
    if (base === "Decimal") continue;              // 静态工厂 -> a区因子
    const ln = lineOf(src, m.index);
    const line = src.split("\n")[ln - 1].trim();
    bCandidates.push({ file: name, line: ln, base, text: line });
  }
}
if (bCandidates.length === 0) {
  console.log("  （无）");
} else {
  for (const h of bCandidates) {
    console.log(`  ${pad(h.file, 14)} :${pad(h.line, 5)} 底数=${pad(h.base, 16)} ${h.text.slice(0, 44)}`);
  }
}
console.log();
console.log(`  共 ${bCandidates.length} 处「对值取幂」。`);
console.log();

// ══════════════════════════════════════════════════════════
console.log("─".repeat(90));
console.log("[2] a区：`Decimal.pow(常量, 等级/数量)` —— 这些是**因子**，不是 b区");
console.log("─".repeat(90));
console.log();
const aFactors = [];
for (const [name, src] of Object.entries(files)) {
  for (const m of src.matchAll(/Decimal\.pow\(([^,]+),\s*([^)]+)\)/g)) {
    const ln = lineOf(src, m.index);
    const base = m[1].trim(), exp = m[2].trim();
    // 底数是数字字面量或常量 -> 因子；底数是值变量 -> 可疑
    const isConstBase = /^\d/.test(base) || /^[A-Z_]+$/.test(base) || /BASE|cfg\.|PIECEWISE/.test(base);
    aFactors.push({ file: name, line: ln, base, exp, isConstBase, text: src.split("\n")[ln - 1].trim() });
  }
}
console.log(`  ${pad("文件", 14)} ${pad("行", 6)} ${pad("底数", 22)} ${pad("指数", 16)} 类型`);
console.log("  " + "-".repeat(86));
for (const h of aFactors) {
  console.log(
    `  ${pad(h.file, 14)} ${pad(h.line, 6)} ${pad(h.base.slice(0, 20), 22)} ${pad(h.exp.slice(0, 14), 16)} ` +
    `${h.isConstBase ? "a区·因子" : "⚠️ 底数不是常量，查一下"}`,
  );
}
console.log();

// ══════════════════════════════════════════════════════════
console.log("─".repeat(90));
console.log("[3] c区：源码里出现「最终」字样的地方");
console.log("─".repeat(90));
console.log();
let cHits = 0;
for (const f of ["config.js", "formulas.js", "engine.js", "ui.js"]) {
  const raw = readFileSync(join(SRC, f), "utf8");
  for (const m of raw.matchAll(/最终/g)) {
    const ln = lineOf(raw, m.index);
    const line = raw.split("\n")[ln - 1].trim();
    console.log(`  ${pad(f, 14)} :${pad(ln, 5)} ${line.slice(0, 66)}`);
    cHits++;
  }
}
console.log();
console.log(`  共 ${cHits} 处提到「最终」。`);
console.log();
console.log("=".repeat(90));
console.log("结论");
console.log("=".repeat(90));
console.log();
console.log(`  · b区（对值取幂）：${bCandidates.length} 处 -> ${bCandidates.length ? "⚠️ 不为空" : "✅ 空的（符合预期）"}`);
console.log(`  · a区因子：${aFactors.length} 处（其中底数非常量 ${aFactors.filter((x) => !x.isConstBase).length} 处需人工确认）`);
console.log(`  · c区：源码提到「最终」${cHits} 处`);
console.log();
console.log("  第一个 b区 成员将是「无限升级4」：给 ZPE 一个 ^1.048 的指数加成（尚未实现）。");
console.log();
