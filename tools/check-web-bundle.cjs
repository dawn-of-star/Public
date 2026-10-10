/**
 * check-web-bundle.cjs —— 组装「网页版」静态目录，并校验模块依赖图完整
 *
 * ═══════════════════════════════════════════════════════════
 * 它解决什么问题
 * ═══════════════════════════════════════════════════════════
 * 把这个游戏放上 GitHub Pages 会踩两个坑：
 *
 *   1. 【发多了】整个仓库推上去 = legacy/ 原稿、tools/ 36 个开发脚本
 *      全部公开可访问。所以要先挑出游戏真正需要的文件。
 *
 *   2. 【发少了】ES 模块少一个文件 = 整页白屏，而且**只在线上白屏**，
 *      本地开发服务器照跑不误（因为本地是完整仓库）。
 *      这类问题在浏览器里只表现为「控制台一行 404」，很容易查半天。
 *
 * 所以这个脚本不只搬运文件，还会从 index.html 出发把整张 import 图走一遍，
 * 任何一个被引用却不存在的文件都会让它在**推送之前**就失败。
 *
 * 用法：
 *   node tools/check-web-bundle.cjs            # 组装到 _site/ 并校验
 *   node tools/check-web-bundle.cjs out-dir    # 指定输出目录
 *
 * 退出码：0 = 通过，1 = 缺文件，2 = 用法错误
 *
 * ⚠️ 下面的 FILES 白名单必须和 package.json 里的 build.files 保持一致。
 *    （两边不一致的典型后果：exe 能玩、网页白屏，或者反过来。）
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** 网页版需要的文件 / 目录（相对项目根）。改这里要同步改 package.json 的 build.files。 */
const FILES = ["index.html", "css", "src", "dist"];

const PROJECT_ROOT = path.join(__dirname, "..");
const outDirName = process.argv[2] ?? "_site";
// ★★★ 2025 堵洞：**参数名不能是 `-` 开头的旗标**。
//
//   踩过（真实事故）：某次把 `--check` 当成"输出目录名"传了进来 ⇒ 本工具老老实实
//   在项目根建了一个叫 `--check/` 的目录（18 个文件）⇒ 看起来像个神秘垃圾目录，
//   而且 `_site/` 在 .gitignore 里、`--check/` 不在 ⇒ **会被误提交** ✗
//   （本工具会把输出目录 `rmSync` 后重建 ⇒ 传错参数会**删掉同名真实目录**，风险更高）
//   ⇒ 直接拒绝：旗标一律不是合法目录名 ✓
if (outDirName.startsWith("-")) {
  console.error(
    `[web] ❌ 拒绝：输出目录名不能是旗标形式（收到 \`${outDirName}\`）。\n` +
    "      用法：node tools/check-web-bundle.cjs [输出目录名]   默认 `_site`\n" +
    "      （本工具会先 rm -rf 输出目录 ⇒ 旗标当路径是危险用法，见源码注释）",
  );
  process.exit(2);
}
const OUT = path.isAbsolute(outDirName) ? outDirName : path.join(PROJECT_ROOT, outDirName);

/** 把逻辑路径（永远用 / 分隔）转成当前平台的文件系统路径 */
function toFs(rel) {
  return path.join(OUT, ...rel.split("/"));
}

// ═══════════════════════════════════════════════════════════
// 第一步：组装
// ═══════════════════════════════════════════════════════════
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
function copyRecursive(srcAbs, relPath) {
  const st = fs.statSync(srcAbs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(srcAbs)) {
      // 跳过 .map 之类的调试文件，它们不该上线
      if (name.endsWith(".map")) continue;
      copyRecursive(path.join(srcAbs, name), `${relPath}/${name}`);
    }
    return;
  }
  const dest = toFs(relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(srcAbs, dest);
  copied++;
}

for (const entry of FILES) {
  const srcAbs = path.join(PROJECT_ROOT, entry);
  if (!fs.existsSync(srcAbs)) {
    console.error(`[web] ❌ 白名单里的 ${entry} 不存在`);
    process.exit(1);
  }
  copyRecursive(srcAbs, entry);
}

// Actions 部署方式本来就不跑 Jekyll，这行纯属保险
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

console.log(`[web] 已组装 ${copied} 个文件 → ${path.relative(PROJECT_ROOT, OUT) || "."}/`);
console.log(`[web] 白名单：${FILES.join("  ")}`);

// ═══════════════════════════════════════════════════════════
// 第二步：从 index.html 出发遍历 import 图
// ═══════════════════════════════════════════════════════════
const visited = new Set();
const missing = [];   // { from, ref }
const external = [];  // 外链，只提示不报错
const queue = ["index.html"];

/**
 * ★★★ 2025 修复：**剥掉 JS 注释**再抽引用。
 *
 *   踩过（我自己埋的）：`format.js` 的 JSDoc 里有一句
 *     `**用法**：把 `` `1e${x.log10().toFixed(2)}` `` 换成 `sci(x)`（传**值**，不是 log10）`
 *   而 `extractRefs` 的正则是 `\bfrom\s*["']([^"']+)["']` —— 它**不看上下文**，
 *   于是把注释里任何 `from "…"` 都当成 import ⇒ 抽出假路径 `src/…` ⇒ 报"文件不存在"
 *   ⇒ **构建被一个纯注释挡住** ✗
 *   （HTML 早就剥了注释，JS 一直没剥 ⇒ 这是同一个病的另一半）
 *
 *   剥法：块注释 + 行注释。**不处理字符串/模板字面量里的注释形态** ——
 *   那需要真解析器；漏网的假阳性会以"文件不存在"暴露出来，不会静默放过 ✓
 */
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")     // 块注释（含 JSDoc）
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // 行注释（避开 `https://` 里的 `//`）
}

/** 从一份文件内容里抽出所有相对引用 */
function extractRefs(rel, src) {
  const refs = [];

  if (rel.endsWith(".html")) {
    // ⚠️ 先剥掉 HTML 注释再找引用。
    // index.html 里正好有一段说明性注释被注释掉的
    //   <script src="dist/break_eternity.min.js">
    // 不剥的话会被当成真实引用（假阳性）。
    const cleaned = src.replace(/<!--[\s\S]*?-->/g, "");

    // <script type="module" src="...">
    for (const m of cleaned.matchAll(/<script[^>]*\btype\s*=\s*["']module["'][^>]*>/gi)) {
      const s = m[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      if (s) refs.push(s[1]);
    }
    // 普通 <script src="..."> 也要能解析（万一以后加了）
    for (const m of cleaned.matchAll(/<script(?![^>]*\btype\s*=\s*["']module["'])[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      refs.push(m[1]);
    }
    // <link href="...">
    for (const m of cleaned.matchAll(/<link[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
      refs.push(m[1]);
    }
  } else if (rel.endsWith(".js") || rel.endsWith(".mjs") || rel.endsWith(".cjs")) {
    // ★ 先剥注释（见 `stripJsComments` 的说明）——
    //   ⚠️ 必须剥，否则 JSDoc 里的 `from "…"` 会被当成真 import ✗
    const clean = stripJsComments(src);
    for (const m of clean.matchAll(/\bfrom\s*["']([^"']+)["']/g)) refs.push(m[1]);
    for (const m of clean.matchAll(/\bimport\s*["']([^"']+)["']/g)) refs.push(m[1]);
    for (const m of clean.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) refs.push(m[1]);
  } else if (rel.endsWith(".css")) {
    for (const m of src.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)) refs.push(m[1]);
    for (const m of src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push(m[1]);
  }

  return refs;
}

while (queue.length) {
  const rel = queue.shift();
  if (visited.has(rel)) continue;
  visited.add(rel);

  const abs = toFs(rel);
  if (!fs.existsSync(abs)) {
    missing.push(rel);
    continue;
  }

  const src = fs.readFileSync(abs, "utf8");
  const dir = path.posix.dirname(rel);

  for (let ref of extractRefs(rel, src)) {
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) {
      external.push(ref);
      continue;
    }
    ref = ref.split("?")[0].split("#")[0];
    if (!ref) continue;
    // 逻辑路径一律用 posix 语义解析，再转成平台路径
    const resolved = path.posix.normalize(path.posix.join(dir, ref));
    if (!visited.has(resolved)) queue.push(resolved);
  }
}

console.log(`\n[web] 从 index.html 出发遍历到 ${visited.size} 个文件：`);
for (const f of [...visited].sort()) {
  const size = fs.existsSync(toFs(f)) ? fs.statSync(toFs(f)).size : 0;
  console.log(`  ${String(size).padStart(7)}  ${f}`);
}

if (external.length) {
  console.log(`\n[web] 外链引用（不检查，共 ${new Set(external).size} 个）：`);
  for (const e of [...new Set(external)].sort()) console.log(`  ${e}`);
}

if (missing.length) {
  console.error(`\n[web] ❌ 有 ${missing.length} 个被引用的文件不存在，线上会白屏：`);
  for (const m of missing) console.error(`  ${m}`);
  console.error(`\n  检查方向：是不是漏放进 FILES 白名单，或者路径大小写不对`);
  console.error(`  （GitHub Pages 跑在 Linux 上，大小写敏感；Windows 本地不敏感，所以本地看不出来）`);
  process.exit(1);
}

console.log(`\n[web] ✅ 模块依赖图完整，可以部署`);
