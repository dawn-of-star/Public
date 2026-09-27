/**
 * smoke-electron.cjs —— Electron 端的端到端自检
 *
 * ═══════════════════════════════════════════════════════════
 * 它在验证什么
 * ═══════════════════════════════════════════════════════════
 * 打包 exe 最容易坏的地方不是窗口代码，而是 **app:// 协议能不能把
 * ES 模块喂给渲染进程**。这个脚本真的起一个 Electron 实例、真的加载
 * app://game/index.html，然后检查：
 *
 *   1. 页面标题正常            → index.html 读到了
 *   2. window.__game 存在      → src/main.js 这一个 ES 模块**真的执行完了**
 *                                （它 import 了 config/engine/ui/save/state
 *                                 外加 dist/break_eternity.esm.js，任一环节
 *                                 MIME 给错都会在这里断掉）
 *   3. #fatal 是空的           → 主循环没有捕获到运行时异常
 *   4. 资源返回 200 + 正确 MIME → 静态伺服正常
 *   5. 路径穿越返回 403、不存在返回 404 → 伺服层没有被写漏
 *
 * 用法（必须在项目根目录）：
 *   npx electron tools/smoke-electron.cjs
 *
 * 退出码：0 = 全部通过，1 = 有断言失败，2 = 超时/异常
 */

"use strict";

const { app, BrowserWindow } = require("electron");
const {
  INDEX_URL,
  registerSchemes,
  registerAppProtocol,
} = require("../electron/static-protocol.cjs");

// 冒烟测试不需要 Chromium 沙箱。某些受限环境（CI 容器、企业终端管控、
// 以及某些自动化沙箱）里沙箱初始化会失败，进程直接以 0x80000003
// (STATUS_BREAKPOINT) 崩掉，连 --version 都打不出来。
// 这只影响这个测试脚本，打包出去的 exe 依然开着沙箱。
app.commandLine.appendSwitch("no-sandbox");
// 冒烟测试不需要 GPU：虚拟机 / 远程桌面 / CI 上 GPU 初始化失败会导致假阴性
app.disableHardwareAcceleration();

// 常见坑：如果环境里设了 ELECTRON_RUN_AS_NODE=1，Electron 会退化成普通 Node，
// require("electron") 只会返回一个 exe 路径字符串，app 就是 undefined。
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error(
    "[smoke] 环境变量 ELECTRON_RUN_AS_NODE 被设置了，Electron 会以纯 Node 模式运行。\n" +
      "        请先清除它：Remove-Item env:ELECTRON_RUN_AS_NODE",
  );
  process.exit(2);
}

registerSchemes();

/** 断言结果收集 */
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail ?? "" });
  console.log(`${ok ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? `  → ${detail}` : ""}`);
}

/** 保险丝：万一 loadURL 卡住，别让 CI 一直挂着 */
const FUSE = setTimeout(() => {
  console.error("\n[smoke] 超时 30 秒，强制退出");
  app.exit(2);
}, 30_000);

app.whenReady().then(async () => {
  registerAppProtocol();

  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    show: false, // 不要弹窗打扰正在用电脑的人
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 把渲染进程的 console 转发出来，出错时好定位
  win.webContents.on("console-message", (event, level, message) => {
    const msg = typeof message === "string" ? message : event?.message;
    if (msg) console.log(`  [renderer] ${msg}`);
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`  [renderer] did-fail-load ${code} ${desc} ${url}`);
  });

  console.log(`[smoke] 加载 ${INDEX_URL}`);
  try {
    await win.loadURL(INDEX_URL);
  } catch (err) {
    clearTimeout(FUSE);
    console.error(`[smoke] loadURL 失败：${err?.message ?? err}`);
    app.exit(2);
    return;
  }

  // 给主循环几帧时间
  await new Promise((r) => setTimeout(r, 1200));

  let probe;
  try {
    probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.title = (document.title || "").trim();
      out.hasGame = !!window.__game;
      out.gameKeys = window.__game ? Object.keys(window.__game).length : 0;
      out.fatal = (document.getElementById("fatal")?.textContent || "").trim().slice(0, 300);
      out.rateEntropy = document.getElementById("rate-entropy")?.textContent ?? null;
      out.wrapChildren = document.querySelector(".wrap")?.children.length ?? 0;
      out.scripts = document.querySelectorAll("script[type=module]").length;

      async function probe(url) {
        try {
          const r = await fetch(url);
          return { status: r.status, type: r.headers.get("content-type") };
        } catch (e) {
          return { status: "throw", type: String(e && e.message) };
        }
      }

      out.ok = await probe("app://game/src/config.js");
      out.missing = await probe("app://game/does-not-exist.js");
      out.traversal = await probe("app://game/%2e%2e%2f%2e%2e%2fpackage.json");
      return out;
    })()`);
  } catch (err) {
    clearTimeout(FUSE);
    console.error(`[smoke] executeJavaScript 失败：${err?.message ?? err}`);
    app.exit(2);
    return;
  }

  clearTimeout(FUSE);
  console.log("\n[smoke] 断言：");

  check("页面标题非空", probe.title.length > 0, JSON.stringify(probe.title));
  check(
    "src/main.js 已执行完（window.__game 存在）",
    probe.hasGame,
    `__game 成员数 = ${probe.gameKeys}`,
  );
  check("主循环无运行时异常（#fatal 为空）", probe.fatal === "", probe.fatal);
  check("DOM 已渲染（.wrap 有子元素）", probe.wrapChildren > 0, `子元素 = ${probe.wrapChildren}`);
  check("存在 ES 模块入口", probe.scripts > 0, `module 脚本数 = ${probe.scripts}`);
  check("资源伺服正常（config.js → 200）", probe.ok.status === 200, `status=${probe.ok.status}`);
  check(
    "MIME 正确（text/javascript）",
    String(probe.ok.type).startsWith("text/javascript"),
    String(probe.ok.type),
  );
  check("不存在的文件 → 404", probe.missing.status === 404, `status=${probe.missing.status}`);
  check("路径穿越 → 403", probe.traversal.status === 403, `status=${probe.traversal.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n[smoke] ${checks.length - failed.length}/${checks.length} 通过` +
      (failed.length ? `，失败：${failed.map((f) => f.name).join("、")}` : " ✅"),
  );

  app.exit(failed.length ? 1 : 0);
});
