/**
 * static-protocol.cjs —— 把项目静态文件用 app:// 协议伺服出去
 *
 * ═══════════════════════════════════════════════════════════
 * 这个模块存在的唯一理由
 * ═══════════════════════════════════════════════════════════
 * 游戏是原生 ES 模块（<script type="module" src="./src/main.js">）。
 * Chromium 在 file:// 协议下会把模块脚本当成跨源请求（origin 是 "null"）
 * 直接拒绝加载 —— 和「双击 index.html 白屏」是同一个原因。
 * 所以不能简单地 win.loadFile("index.html")。
 *
 * 这里注册一个 app:// 自定义协议充当假 HTTP 服务器，等价于开发时的 serve.mjs。
 * 声明成 standard + secure 之后页面就是安全上下文，
 * navigator.clipboard（「导出存档」按钮要用）也能正常工作。
 *
 * 抽成独立模块是为了让 tools/smoke-electron.cjs 能复用同一套逻辑做端到端自检，
 * 避免「主进程改了、测试还在测旧的」。
 */

"use strict";

const { protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/** 项目根目录。打包后位于 app.asar 内部，fs 被 Electron 打过补丁，照常可读。 */
const PROJECT_ROOT = path.join(__dirname, "..");

const SCHEME = "app";
const HOST = "game";
const INDEX_URL = `${SCHEME}://${HOST}/index.html`;

/** 这些 MIME 必须正确，否则浏览器拒绝把文件当模块执行。与 serve.mjs 保持一致。 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", // ← ES 模块必须是 text/javascript
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
};

/**
 * 必须在 app ready **之前**调用。
 * 把 app:// 声明成「标准 + 安全」协议。
 */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,   // 有正常的 host/path 语义，相对路径 ./src/main.js 才能解析
        secure: true,     // 视为安全上下文 → clipboard / crypto 等 API 可用
        supportFetchAPI: true,
        stream: true,
        allowServiceWorkers: true,
        codeCache: true,
      },
    },
  ]);
}

/**
 * 把 URL 路径安全地映射到磁盘路径。
 * 与 serve.mjs 的 resolveSafe() 逻辑一致（并额外显式拒绝 .. 段）。
 *
 * ⚠️ 这里为什么要在 normalize **之前**单独拦 `..`
 *   path.normalize 会把「根目录之上」的 .. 直接丢掉：
 *       win32 : normalize("/../../package.json") === "\\package.json"
 *       posix : normalize("/../../package.json") === "/package.json"
 *   结果虽然**没有**逃出 ROOT（所以不是漏洞），但
 *   `app://game/%2e%2e%2f%2e%2e%2fpackage.json` 会静悄悄地
 *   把项目自己的 package.json 伺服出去 —— 语义含糊，也不好排查。
 *   显式拒绝更清楚：想穿越就直接 403。
 *
 * @param {string} urlPath
 * @returns {string|null} 越界、含 .. 段或转义非法时返回 null
 */
function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null; // 非法百分号转义
  }

  // 先按 / 和 \ 切段，任何一段是 ".." 就拒绝
  if (decoded.split(/[/\\]+/).includes("..")) return null;

  const normalized = path.normalize(decoded).replace(/^([/\\])+/, "");
  const target = path.join(PROJECT_ROOT, normalized);
  if (target !== PROJECT_ROOT && !target.startsWith(PROJECT_ROOT + path.sep)) return null;
  return target;
}

/** 必须在 app ready **之后**调用。装上线上的处理函数。 */
function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let target = resolveSafe(url.pathname || "/");

    if (!target) {
      return new Response("403 Forbidden", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // 目录 → 目录下的 index.html
    let info = await fs.promises.stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = path.join(target, "index.html");
      info = await fs.promises.stat(target).catch(() => null);
    }

    // 根路径兜底给 index.html
    if (!info?.isFile() && (url.pathname === "/" || url.pathname === "")) {
      target = path.join(PROJECT_ROOT, "index.html");
      info = await fs.promises.stat(target).catch(() => null);
    }

    if (!info?.isFile()) {
      return new Response(`404 Not Found\n${request.url}`, {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    try {
      const body = await fs.promises.readFile(target);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-store, must-revalidate",
        },
      });
    } catch (err) {
      return new Response(`500 ${err?.message ?? err}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  });
}

module.exports = {
  PROJECT_ROOT,
  SCHEME,
  HOST,
  INDEX_URL,
  MIME,
  registerSchemes,
  registerAppProtocol,
  resolveSafe,
};
