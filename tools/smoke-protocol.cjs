/**
 * smoke-protocol.cjs —— app:// 静态伺服层的自检（纯 Node，不需要 Electron）
 *
 * ═══════════════════════════════════════════════════════════
 * 它怎么能在没有 Electron 的情况下测 Electron 代码
 * ═══════════════════════════════════════════════════════════
 * 用 Module._load 钩子把 "electron" 这个模块替换成一个假的桩，
 * 把 registerAppProtocol() 传给 protocol.handle() 的**那个真实处理函数**
 * 截获下来，然后用真正的 Request / Response 对象去驱动它。
 *
 * 也就是说：测的是 electron/static-protocol.cjs 里正在跑的生产代码，
 * 不是复制一份出来的简化版。改了那边，这里立刻会红。
 *
 * ═══════════════════════════════════════════════════════════
 * 为什么值得单独测
 * ═══════════════════════════════════════════════════════════
 * 打包后的 exe 最容易坏的地方就是这一层：
 *   · JS 的 MIME 给成 application/octet-stream → 浏览器拒绝当模块执行 → 白屏
 *   · 目录没映射到 index.html → 根路径 404
 *   · 路径穿越没挡住 → 能读到项目外的文件
 * 这三条任何一条错，窗口能开但游戏是死的，而且不看控制台根本不知道原因。
 *
 * 用法：
 *   node tools/smoke-protocol.cjs
 *
 * 退出码：0 = 全部通过，1 = 有断言失败
 */

"use strict";

const Module = require("node:module");
const path = require("node:path");

// ═══════════════════════════════════════════════════════════
// 注入假的 electron 模块
// ═══════════════════════════════════════════════════════════
const realLoad = Module._load;
let capturedHandler = null;
let capturedSchemes = null;

Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      protocol: {
        registerSchemesAsPrivileged(schemes) {
          capturedSchemes = schemes;
        },
        handle(scheme, handler) {
          capturedHandler = { scheme, handler };
        },
      },
    };
  }
  return realLoad.apply(this, arguments);
};

const sp = require("../electron/static-protocol.cjs");

// ═══════════════════════════════════════════════════════════
// 断言
// ═══════════════════════════════════════════════════════════
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  console.log(`${ok ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? `  → ${detail}` : ""}`);
}

/** 把 app:// URL 喂给真实的 handler，取回真实 Response */
async function serve(url) {
  const res = await capturedHandler.handler(new Request(url));
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    body: buf,
    text: buf.toString("utf8"),
  };
}

(async () => {
  console.log("[protocol] 注册 scheme");
  sp.registerSchemes();
  check(
    "app:// 声明为 standard + secure",
    capturedSchemes?.[0]?.scheme === "app" &&
      capturedSchemes[0].privileges?.standard === true &&
      capturedSchemes[0].privileges?.secure === true,
  );

  console.log("\n[protocol] 注册 handler");
  sp.registerAppProtocol();
  check("protocol.handle 已注册 app://", capturedHandler?.scheme === "app");

  console.log("\n[protocol] 驱动真实请求");

  // ── 根路径 ──
  const root = await serve("app://game/");
  check("根路径 / → 200", root.status === 200, `status=${root.status}`);
  check("根路径 / 返回的是 index.html", root.text.includes("<title>"), `长度=${root.body.length}`);
  check(
    "index.html 的 MIME 正确",
    root.type.startsWith("text/html"),
    root.type,
  );

  // ── 显式 index.html ──
  const idx = await serve("app://game/index.html");
  check("index.html → 200", idx.status === 200, `status=${idx.status}`);

  // ── ES 模块：这条最关键 ──
  const mod = await serve("app://game/src/main.js");
  check("src/main.js → 200", mod.status === 200, `status=${mod.status}`);
  check(
    "★ ES 模块 MIME 必须是 text/javascript",
    mod.type.startsWith("text/javascript"),
    mod.type,
  );

  const cfg = await serve("app://game/src/config.js");
  check("src/config.js → 200 + text/javascript", cfg.status === 200 && cfg.type.startsWith("text/javascript"), cfg.type);

  // ── 第三方库 ──
  const dep = await serve("app://game/dist/break_eternity.esm.js");
  check(
    "dist/break_eternity.esm.js → 200 + text/javascript",
    dep.status === 200 && dep.type.startsWith("text/javascript"),
    `status=${dep.status} type=${dep.type}`,
  );

  // ── CSS ──
  const css = await serve("app://game/css/amoled.css");
  check("css/amoled.css → 200 + text/css", css.status === 200 && css.type.startsWith("text/css"), `status=${css.status} type=${css.type}`);

  // ── 目录自动补 index.html ──
  const dir = await serve("app://game/src/");
  check("目录 /src/ → 200（补 index.html 或 404 都算合理，不能 500）", dir.status !== 500, `status=${dir.status}`);

  // ── 404 ──
  const missing = await serve("app://game/definitely-missing.js");
  check("不存在的文件 → 404", missing.status === 404, `status=${missing.status}`);

  // ── 路径穿越 ──
  const trav1 = await serve("app://game/%2e%2e%2f%2e%2e%2fpackage.json");
  check("编码穿越 %2e%2e%2f → 403", trav1.status === 403, `status=${trav1.status}`);

  const trav2 = await serve("app://game/..%2f..%2fWindows/win.ini");
  check("穿越 ../../Windows/win.ini → 403", trav2.status === 403, `status=${trav2.status}`);

  const trav3 = await serve("app://game/%2e%2e%2foutside.txt");
  check("穿越 %2e%2e%2foutside.txt → 403", trav3.status === 403, `status=${trav3.status}`);

  // ── 非法转义不能把服务打崩 ──
  const bad = await serve("app://game/%ZZ");
  check("非法百分号转义 → 403（不是抛异常）", bad.status === 403, `status=${bad.status}`);

  // ── 纯函数直测 ──
  const within = sp.resolveSafe("/src/main.js");
  check("resolveSafe 放行项目内路径", typeof within === "string" && within.startsWith(sp.PROJECT_ROOT), String(within));
  check("resolveSafe 拦掉越界路径", sp.resolveSafe("/../../secret.txt") === null);

  // ── 打包白名单一致性：MIME 表要覆盖游戏实际用到的扩展名 ──
  const needed = [".html", ".js", ".css"];
  const missingMime = needed.filter((e) => !sp.MIME[e]);
  check("MIME 表覆盖 .html/.js/.css", missingMime.length === 0, missingMime.join(","));

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n[protocol] ${checks.length - failed.length}/${checks.length} 通过` +
      (failed.length ? `，失败：${failed.map((f) => f.name).join("、")}` : " ✅"),
  );
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("[protocol] 异常：", err);
  process.exit(2);
});
