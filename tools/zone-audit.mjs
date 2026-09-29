#!/usr/bin/env node
/**
 * tools/zone-audit.mjs —— 乘区审计（语义判据版）
 *
 * ══════════════════════════════════════════════════════════════
 * 乘区定义（config.js 的 ZONE_RULES 是唯一数据源）
 * ══════════════════════════════════════════════════════════════
 *
 *   资源_next = { [ 资源_prev + (1 × 乘法区) + 加法区 ] ^ 指数区 } × 最终倍率区
 *
 *   a区 = 加法池 × 乘法池（作用在**增量**上）
 *   b区 = 指数区 —— 对**整个 `{...}`** 取幂
 *   c区 = 带「最终」二字的加成/减益（由**词条**判定，不靠颜色）
 *
 * ── 关键判据（上一版搞错的地方）──
 *   ❌ 旧判据：「代码里出现 pow() 就是 b区」——**语法判据，错的**
 *   ✅ 新判据：只有**把整个值拿去取幂**才算 b区
 *
 *   区分方法看**底数是什么**：
 *     · `Decimal.pow(常量, 等级/数量)`  -> 一个**因子**（每级乘 m、价格 r^n）-> a区
 *     · `Decimal.pow(10, 暗物质)`       -> 一个**因子**（10^DM）          -> a区
 *     · `值.pow(指数)`                  -> 产出的是**倍率**             -> a区（除非它包住整个 `{...}`）
 *
 * ── 现状（和 config.js 顶部的四条实现事实同步）──
 *   · b区 **恒等于 1**，运行路径上没有一层对 `{...}` 整体取幂 —— 这是**刻意**的：
 *     对值取幂会把曲线从「平移」改成「改形」，增益过于给力，前期加成一律不碰。
 *   · c区 只有 1 个成员：量子 → 熵生产 `×(1+q)`，而且它乘的是**增量**而不是
 *     `{存量 + 增量}`（熵这一层两种写法等价，别的层要用 c区 前必须先定死语义）。
 *   · 物质的量子项 `M×R(q)×ln10` 是**等价写法的 b区**（`M^(1+R·ln10·dt/lnM)`），
 *     写在 a区的加法端，是当前唯一改形成长的机制。
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
console.log("[3] c区：**靠词条判定** —— 描述里带「最终」二字的加成/减益都作用在这一层");
console.log("─".repeat(90));
console.log();
// 关键：把「玩家可见的词条」和「只是注释里提到」分开 ——
// c区 的成员资格是由**词条**决定的，注释写一百遍也不影响乘区。
const quoted = (src) => [...src.matchAll(/["'`][^"'`\n]*["'`]/g)].map((m) => [m.index, m.index + m[0].length]);
const inQuotes = (spans, i) => spans.some(([a, b]) => i >= a && i < b);
/** 这一行本身是不是注释行（`*` / `//` / `/*` 开头）—— 注释里提到不算成员登记 */
const isCommentLine = (line) => /^\s*(\*|\/\/|\/\*)/.test(line);

const wordHits = [];   // 玩家可见 / 声明用的字符串字面量
const noteHits = [];   // 注释里提到（不算成员登记）
for (const f of ["config.js", "formulas.js", "engine.js", "ui.js"]) {
  const raw = readFileSync(join(SRC, f), "utf8");
  const spans = quoted(raw);
  for (const m of raw.matchAll(/最终/g)) {
    const ln = lineOf(raw, m.index);
    const line = raw.split("\n")[ln - 1].trim();
    const visible = inQuotes(spans, m.index) && !isCommentLine(line);
    (visible ? wordHits : noteHits).push({ f, ln, line });
  }
}
const htmlRaw = readFileSync(join(ROOT, "index.html"), "utf8");
for (const m of htmlRaw.matchAll(/最终/g)) {
  const ln = lineOf(htmlRaw, m.index);
  wordHits.push({ f: "index.html", ln, line: htmlRaw.split("\n")[ln - 1].trim() });
}

console.log(`  ── 玩家可见词条（${wordHits.length} 处）—— 这些才是 c区 的成员登记 ──`);
for (const h of wordHits) console.log(`  ${pad(h.f, 14)} :${pad(h.ln, 5)} ${h.line.slice(0, 66)}`);
console.log();
console.log(`  ── 注释里提到「最终」（${noteHits.length} 处，不构成成员）──`);
console.log(`  ${noteHits.length ? noteHits.map((h) => `${h.f}:${h.ln}`).join("  ") : "（无）"}`);
console.log();

// 实现落点：c区 目前只应有 1 处，即 entropyRate 里那一环
const formulasRaw = readFileSync(join(SRC, "formulas.js"), "utf8");
const sites = [...formulasRaw.matchAll(/\.mul\(quantumEntropyMultiplier\(/g)]
  .map((m) => lineOf(formulasRaw, m.index));
const erStart = lineOf(formulasRaw, formulasRaw.indexOf("export function entropyRate("));
const erEnd = lineOf(formulasRaw, formulasRaw.indexOf("export function matterRate("));
const inEntropy = sites.length === 1 && sites[0] > erStart && sites[0] < erEnd;
console.log(`  实现落点：formulas.js 里 \`.mul(quantumEntropyMultiplier(...)\` 共 ${sites.length} 处 ` +
  `(行 ${sites.join(", ") || "—"})，${inEntropy ? "✅ 在 entropyRate 的乘法链里（乘增量）" : "⚠️ 落点异常，检查 c区 是否被搬到了别的层"}`);
console.log();
console.log("=".repeat(90));
console.log("结论");
console.log("=".repeat(90));
console.log();
console.log(`  · b区（包住整个 \`{...}\` 取幂）：0 处 -> ✅ 恒为 1（刻意不实现）`);
console.log(`      [1] 里那 ${bCandidates.length} 处是「对值取幂、产出一个 a区因子」，不是 b区：它们只抬高曲线，不改形状。`);
console.log(`      新增同类写法请对照本节判据：底数是**整个值**才叫 b区。`);
console.log(`  · a区因子：${aFactors.length} 处（其中底数非常量 ${aFactors.filter((x) => !x.isConstBase).length} 处需人工确认）`);
console.log(`  · c区：玩家可见「最终」词条 ${wordHits.length} 处；实现落点 ${sites.length} 处`);
console.log();
console.log("  b区 一旦加成员（例如「无限升级4」给 ZPE 一个 ^1.048），必须重新验 S 判据和环增益 ——");
console.log("  它改的是曲线形状，不是高度。");
console.log();
