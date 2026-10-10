#!/usr/bin/env node
/**
 * tools/undefined-ident-ref.mjs —— **未定义标识符**守卫
 *
 * ── 为什么必须有它 ──
 *   2025 出现了一类**两个现有守卫都抓不到**的 bug：
 *     · `node --check` 只查**语法**，未定义标识符是**运行时**错误 ⇒ 放行 ✗
 *     · `dom-smoke` 原来的 `addEventListener` 是**空函数** ⇒ 点了什么也不会发生 ⇒ 放行 ✗
 *   实际后果（用户报「点大坍缩和购买 zpe 引擎目前无效（点了没反映）」）：
 *     · `main.js` 调用 `doBigCrunch` / `doEternity` / `unlockZpeEngine` / `buyZpeEngineLevel`
 *       —— **四个都没 import** ⇒ 每次点击抛 `ReferenceError`，表现就是"点了没反应" ✗
 *     · `engine.js` 的 `doEternity` 调用 `canEternity` —— **也没 import** ✗
 *     · `ui.js` 的 zpe 解锁判定用了 `D(0)` —— **`D` 在 ui.js 里根本没定义** ✗
 *   ⇒ 本脚本把它们一次全扫出来，并进 `npm test` 自动批跑。
 *
 * ── 判定方式（刻意**不依赖行号**）──
 *   踩过：模板字面量里含换行时，`src.split("\n")` 与原文行号会错位 ⇒ 误报 ✗
 *   ⇒ 改为**看形状**：
 *     · 定义形状：`function NAME(` / `NAME(...) {`（方法简写，`{` 紧跟 `)`）
 *     · 调用形状：`NAME(` 且**不是**上面两种
 *   ⇒ 两者都出现的名字直接放行（例如 `renderQuantum(state, R);` 调用 + `function renderQuantum(` 声明）。
 *
 * 退出码：0 = 干净；1 = 有未定义标识符（run-all 会据此判失败）
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

/** 语言内置 / 宿主全局 —— 不是"未定义" */
const GLOBALS = new Set([
  "window", "document", "console", "localStorage", "sessionStorage", "globalThis", "navigator",
  "JSON", "Math", "Number", "Object", "Array", "String", "Boolean", "Map", "Set", "WeakMap",
  "Promise", "Date", "RegExp", "Error", "TypeError", "RangeError", "SyntaxError",
  "Infinity", "NaN", "undefined", "null", "true", "false", "this", "super", "arguments",
  "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "performance", "structuredClone", "fetch",
  "confirm", "alert", "prompt", "queueMicrotask", "atob", "btoa",
]);

/** JS 关键字 —— `return (` / `if (` / `for (` 这类会被"名字("的扫描误当成函数调用 */
const KEYWORDS = new Set([
  "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "try", "catch", "finally", "throw", "new", "typeof", "instanceof", "delete", "void", "in", "of",
  "await", "async", "yield", "function", "class", "const", "let", "var", "import", "export", "from",
  "static", "extends", "get", "set", "this", "super",
]);

/** 去掉注释与字符串/模板字面量，避免把里面的词当代码 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    // 模板字面量里的 `${...}` 是真代码，但整个替换成占位符对本判定足够安全（只找标识符名）
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/** 从一行里抽出「这个文件定义了哪些名字」 */
function definedNames(src, declared) {
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  // 解构：const { a, b: c } = / const [a, b] =
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().split(":").pop().trim().replace(/[=].*$/s, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().replace(/[=].*$/s, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  // 形参（含箭头函数、方法简写、function）
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().replace(/[=:{].*$/s, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  for (const m of src.matchAll(/function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().replace(/[={].*$/s, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*([A-Za-z_$][\w$]*)\s+of\s/g)) declared.add(m[1]);
}

let problems = 0;
const files = readdirSync(SRC).filter((f) => f.endsWith(".js")).sort();
console.log("=".repeat(74));
console.log(`未定义标识符扫描：src/ 共 ${files.length} 个模块`);
console.log("=".repeat(74));

for (const f of files) {
  const raw = readFileSync(join(SRC, f), "utf8");
  const src = strip(raw);

  const imported = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().split(/\s+as\s+/).pop().trim();
      if (n) imported.add(n);
    }
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) imported.add(m[1]);

  const declared = new Set();
  definedNames(src, declared);

  // ① 名字是否以「定义形状」出现过：`function NAME(` 或 `NAME(...) {`（方法简写 / 箭头前）
  // ① 名字是否以「定义形状」出现过。
  //   ⚠️ **必须在 `raw` 上判，不能用 `strip` 后的文本** ——
  //      踩过：`strip()` 的模板字面量正则会被**落单的反引号**带偏，
  //      一路吃掉后面的函数声明 ⇒ `function renderQuantum(` 消失 ⇒ 误报 ✗
  //      （本项目的 `--check` 输出与注释里都有反引号，落单很常见。）
  const hasDefShape = (n) => new RegExp(`\\bfunction\\s+${n}\\s*\\(`).test(raw)
    || new RegExp(`(?<![.\\w$])${n}\\s*\\([^()]*\\)\\s*\\{`).test(raw);

  // ② 名字是否以「调用形状」出现过（在 strip 后的文本上找，避开注释与字符串里的假调用）
  const calls = new Map();
  for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = m[1];
    if (imported.has(n) || declared.has(n) || GLOBALS.has(n) || KEYWORDS.has(n)) continue;
    calls.set(n, (calls.get(n) ?? 0) + 1);
  }

  const bad = [];
  for (const [n, count] of calls) {
    if (hasDefShape(n)) continue;                  // 它自己在本文件里有定义 ⇒ 不是未定义
    bad.push({ n, count });
  }
  if (!bad.length) continue;

  console.log(`\n  ❌ ${f}`);
  for (const { n, count } of bad) {
    console.log(`       ${n.padEnd(24)} 调用了 ${count} 次，但既没 import 也没声明`);
  }
  problems += bad.length;
}

console.log();
console.log("=".repeat(74));
if (problems) {
  console.log(`  ❌ 发现 ${problems} 个未定义标识符 —— 它们会在运行时抛 ReferenceError`);
  console.log("     （`node --check` 查不出这类问题：那是语法检查，这是运行时错误）");
  console.log("=".repeat(74));
  process.exit(1);
}
console.log("  ✅ 没有未定义标识符（全项目 import / 声明都对得上）");
console.log("=".repeat(74));
