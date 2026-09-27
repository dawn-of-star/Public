/**
 * inspect-asar.cjs —— 检查打包后的 app.asar 里到底装了什么
 *
 * 打包最容易出两种事故：
 *   1. 该进包的文件没进去（白名单写漏）→ 双击 exe 白屏
 *   2. 不该进包的文件进去了（legacy/、tools/、node_modules/）→ 体积虚高、源码外泄
 * 这个脚本不开 Electron，直接解析 asar 头部把文件清单列出来核对。
 *
 * 用法：
 *   node tools/inspect-asar.cjs <path-to-app.asar>
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const target = process.argv[2];
if (!target) {
  console.error("用法: node tools/inspect-asar.cjs <path-to-app.asar>");
  process.exit(2);
}

/**
 * asar 头部布局（Electron 官方格式，实测确认）：
 *   [0..3]   uint32 = 4                      （第一个 pickle 的负载长度）
 *   [4..7]   uint32 = header pickle 总长
 *   [8..11]  uint32 = header pickle 负载长（= 4 + JSON 长度 + padding）
 *   [12..15] uint32 = header JSON 字符串长度
 *   [16..]   header JSON
 *
 *   数据段起点 = 8 + u32@4（**不是** 16 + JSON 长度 —— 中间还有 padding）。
 *   文件在 header 里的 offset 是相对数据段起点的**十进制字符串**
 *   （别按十六进制解析：实测 "727854" 就是十进制 727854）。
 */
const fd = fs.openSync(target, "r");
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerPickleSize = head.readUInt32LE(4);
const jsonSize = head.readUInt32LE(12);
const dataStart = 8 + headerPickleSize;
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
fs.closeSync(fd);

const header = JSON.parse(jsonBuf.toString("utf8"));

/** offset 是十进制字符串（相对于数据段起点） */
function resolveOffset(entry) {
  return Number(entry.offset ?? 0);
}

/** 递归展开 asar 头部里的文件树 */
function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: entry.size ?? 0 });
  }
  return out;
}

const files = walk(header, "", []).sort((a, b) => a.path.localeCompare(b.path));

console.log(`app.asar: ${target}`);
console.log(`共 ${files.length} 个文件，解包后 ${(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB\n`);
for (const f of files) {
  console.log(`  ${String(f.size).padStart(8)}  ${f.path}`);
}

// ── 断言 ──
const paths = new Set(files.map((f) => f.path));
const mustHave = [
  "package.json",
  "index.html",
  "src/main.js",
  "src/config.js",
  "src/engine.js",
  "src/ui.js",
  "src/save.js",
  "src/state.js",
  "src/formulas.js",
  "css/amoled.css",
  "dist/break_eternity.esm.js",
  "electron/main.cjs",
  "electron/static-protocol.cjs",
];
const mustNotHave = ["serve.mjs", "tools/headless.mjs", "legacy/index.html", "legacy/js/engine.js"];

console.log("\n必须存在的文件：");
let bad = 0;
for (const p of mustHave) {
  const ok = paths.has(p);
  if (!ok) bad++;
  console.log(`  ${ok ? "[PASS]" : "[FAIL]"} ${p}`);
}

console.log("\n不应进包的文件：");
for (const p of mustNotHave) {
  const leaked = paths.has(p);
  if (leaked) bad++;
  console.log(`  ${leaked ? "[FAIL]" : "[PASS]"} ${p}${leaked ? "（漏进去了）" : ""}`);
}

// main 字段指向的入口必须真的在包里
try {
  const pkgNode = header.files["package.json"];
  if (pkgNode) {
    const dataOffset = dataStart + resolveOffset(pkgNode);
    const buf = Buffer.alloc(pkgNode.size);
    const fd2 = fs.openSync(target, "r");
    fs.readSync(fd2, buf, 0, pkgNode.size, dataOffset);
    fs.closeSync(fd2);
    const pkg = JSON.parse(buf.toString("utf8"));
    const mainPath = String(pkg.main ?? "").replace(/^[./\\]+/, "").replace(/\\/g, "/");
    const ok = paths.has(mainPath);
    if (!ok) bad++;
    console.log(`\npackage.json main = ${pkg.main} → 在包里: ${ok ? "[PASS]" : "[FAIL]"}`);
    console.log(`package.json version = ${pkg.version}`);
  } else {
    bad++;
    console.log("\n[FAIL] asar 里没有 package.json");
  }
} catch (err) {
  console.log(`\n[FAIL] 读取 asar 内 package.json 失败：${err.message}`);
  bad++;
}

console.log(bad ? `\n❌ ${bad} 项不合格` : "\n✅ 全部合格");
process.exit(bad ? 1 : 0);
