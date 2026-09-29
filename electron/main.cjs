/**
 * main.cjs —— Electron 主进程（打包成 exe / 桌面端调试用）
 *
 * 静态文件的伺服逻辑在 electron/static-protocol.cjs 里，这里只管窗口和菜单。
 * 为什么不能直接 win.loadFile("index.html")，见那个文件的注释。
 *
 * 为什么是 .cjs 而不是 .js：
 *   package.json 里有 "type": "module"，.js 会被当成 ESM。
 *   主进程用 CommonJS 最稳，.cjs 后缀强制按 CommonJS 解析。
 */

"use strict";

const { app, BrowserWindow, Menu, shell } = require("electron");
const {
  INDEX_URL,
  registerSchemes,
  registerAppProtocol,
} = require("./static-protocol.cjs");

// ═══════════════════════════════════════════════════════════
// 必须在 app ready 之前：声明 app:// 为「标准 + 安全」协议
// ═══════════════════════════════════════════════════════════
registerSchemes();

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 880,
    minHeight: 600,
    title: "空想增量 demo",
    backgroundColor: "#000000", // AMOLED，避免启动时白闪
    autoHideMenuBar: true,
    show: false,                // 等首帧画好再显示，避免白屏
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 游戏不需要任何 Node 能力，保持默认的严格沙箱
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 外链一律丢给系统浏览器，别在游戏窗口里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadURL(INDEX_URL);
}

/**
 * 精简菜单栏。autoHideMenuBar 下按 Alt 才会显示，
 * 但保留「重新加载 / 开发者工具 / 全屏」这些调试和游玩都用得上的项。
 */
function buildMenu() {
  const template = [
    {
      label: "游戏",
      submenu: [
        { label: "自动存档：每 15 秒一次", enabled: false },
        { type: "separator" },
        { label: `版本 ${app.getVersion()}`, enabled: false },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "F5", role: "reload" },
        { label: "强制重新加载", accelerator: "CommandOrControl+F5", role: "forceReload" },
        { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ═══════════════════════════════════════════════════════════
// 生命周期
// ═══════════════════════════════════════════════════════════

// 存档目录用 ASCII 名，避免中文路径在不同系统语言下出乱子。
// localStorage 落在 %APPDATA%\CosmosOrigin 下，跨版本升级不会丢档。
//
// ⚠️ 游戏显示名已改为「空想增量」，但**这个目录名刻意不改**：
//    改掉它 = 所有老存档立刻找不到（等价于强制重开）。
//    要改就得配一次性迁移（把旧目录搬过去），那需要在本机跑一次 electron 验证。
app.setName("CosmosOrigin");
app.setAppUserModelId("com.kongxiang.incremental");

// 只允许开一个实例，第二次启动就聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // Windows 上关掉窗口就退出
    app.quit();
  });
}
