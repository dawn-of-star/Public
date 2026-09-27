#!/usr/bin/env node
/**
 * serve.mjs —— 零依赖静态服务器
 *
 * 为什么需要它：
 *   双击 index.html 走的是 file:// 协议。浏览器在 file:// 下会：
 *     · 拦截所有 ES 模块 import（CORS 报错）
 *     · 拦截 import map 里的相对路径解析
 *   所以本地开发必须走 http://。
 *
 * 用法：
 *   node serve.mjs            默认 http://127.0.0.1:8321/
 *   PORT=9000 node serve.mjs  换端口
 *
 * 不需要 npm install，不需要任何扩展。
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8321);
const HOST = process.env.HOST ?? "127.0.0.1";

/** 这些 MIME 类型必须正确，否则浏览器会拒绝把文件当模块执行。 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",   // ← ES 模块必须是 text/javascript
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

/** 把 URL 路径安全地映射到磁盘路径，挡住 ../ 穿越。 */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const normalized = normalize(decoded).replace(/^([/\\])+/, "");
  const target = join(ROOT, normalized);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  try {
    let target = resolveSafe(req.url ?? "/");
    if (!target) {
      res.writeHead(403).end("403 Forbidden");
      return;
    }

    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target).catch(() => null);
    }
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404 Not Found\n${req.url}\n\n（服务器根目录：${ROOT}）`);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      // 开发期禁用缓存，改完刷新就是新的
      "cache-control": "no-store, must-revalidate",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`500 ${err?.message ?? err}`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[serve] 端口 ${PORT} 被占用了。\n` +
      `        换一个： PORT=9000 node serve.mjs\n` +
      `        或者关掉占用它的进程。\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] root = ${ROOT}`);
  // ↓ 这一行是给 .vscode/tasks.json 的 background matcher 用的，别改掉 "ready" 这个词
  console.log(`[serve] ready on http://${HOST}:${PORT}/`);
  console.log(`[serve] 按 Ctrl+C 停止`);
});
