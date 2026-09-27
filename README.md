# 宇宙起源（Cosmos Origin）

网页增量游戏。原生 ES 模块 + `break_eternity.js`，**零构建、零 npm install**。

当前版本：**0.4.5**

---

## 三种拿到游戏的方式

| 你想干嘛 | 用什么 | 需要装什么 |
|---|---|---|
| **点开就玩（最省事）** | **https://dawn-of-star.github.io/Public/** | 只需要浏览器 |
| **下载到本地玩** | Release 里的 `CosmosOrigin-0.4.5-win-x64.exe` | **什么都不用装**，双击即玩 |
| 在本机改着玩 | `node serve.mjs` → http://127.0.0.1:8321/ | Node.js |
| 改代码 / 自己打包 | 见下面「打包成 exe」 | Node.js + 首次 `npm install` |

> 网页版和 exe 版是**两份独立存档**（`localStorage` 按源隔离），互不相通。

> 便携版 exe 里已经打进了完整的 Chromium 内核，**不依赖系统 WebView2、不依赖 Node、
> 不依赖任何运行库**，Windows 10 1809+ / 11（x64）都能直接双击运行。

---

## 怎么跑起来

### ⚠️ 不能双击 index.html

`index.html` 里加载的 `js/main.js` 是 `<script type="module">`。
浏览器在 `file://` 协议下会以 CORS 为由拒绝加载 ES 模块，页面会一片空白。

**必须走 HTTP 服务器**：

```bash
node serve.mjs
# 然后打开 http://127.0.0.1:8321/
```

不需要 `npm install`（没有任何依赖，`break_eternity.js` 已经内置在 `dist/`）。

### VSCode 里一键启动

按 **F5**，选「🚀 Edge：启动服务器 + 调试」。
它会自动起服务器、等就绪、开浏览器、挂调试器（可以直接下断点）。

---

## 目录结构

```
test-034/
├── .github/workflows/           GitHub Actions：打 tag 自动构建 exe 并发 Release
├── .vscode/                     VSCode 配置（F5 / 任务都在这）
├── index.html                   ★ 唯一入口（AMOLED，走 src/）
├── css/amoled.css               AMOLED 主题（配色取自 Antares Dimensions）
├── serve.mjs                    零依赖静态服务器（浏览器开发用）
├── package.json                 版本号 + 依赖 + 打包配置（build 字段）
├── .npmrc                       Electron 下载源换成国内镜像
├── .gitignore / .gitattributes  node_modules、release、换行符与语言统计
├── electron/
│   ├── main.cjs                 Electron 主进程：开窗口 + 菜单 + 单实例
│   └── static-protocol.cjs      ★ 注册 app:// 协议，把静态文件当 HTTP 伺服
├── build/
│   ├── icon.ico                 ★ 应用图标（进过 exe）
│   └── make-icon.py             图标生成脚本（纯标准库，零依赖）
├── src/                         ★ 新实现（分层，纯逻辑可无头测试）
│   ├── config.js                全部内容与数值（唯一数据源）
│   ├── state.js                 状态工厂 + 序列化（纯数据）
│   ├── formulas.js              全部计算（纯函数，不碰 DOM）
│   ├── engine.js                tick / 离线闭式解 / 购买动作
│   ├── save.js                  localStorage 存档
│   ├── ui.js                    所有 DOM 操作（唯一碰 DOM 的地方）
│   └── main.js                  装配 + requestAnimationFrame 主循环
├── tools/                       开发期脚本（★ 不参与打包）
│   ├── smoke-protocol.cjs       自检：驱动真实的 app:// 处理函数发请求
│   ├── smoke-electron.cjs       自检：真起 Electron 加载页面
│   ├── inspect-asar.cjs         自检：列出放进 exe 的文件清单
│   ├── headless.mjs             无头模拟 + S 判据自检
│   └── …                        其余曲线/审计脚本
├── dist/                        break_eternity.js 2.1.3（第三方库）
│   ├── break_eternity.esm.js    ← src/ 直接 import 这个
│   └── break_eternity.min.js    ← legacy/index.html 用（全局 Decimal）
├── legacy/                      原稿代码（0.3.4 的 engine/state/saveSystem/main）
│   ├── index.html               原稿入口，留着做行为对照
│   ├── style.css                原稿样式（0 个 CSS 变量，70 处硬编码颜色）
│   ├── js/                      原稿 JS
│   └── 注意！                    这个文件夹的说明
└── release/                     打包产物（git 忽略，不提交）
```

⚠️ **`dist/` 是游戏自己的第三方库目录，不是打包输出目录。**
electron-builder 默认输出到 `dist/`，会和它撞名并把 break_eternity.js 清掉。
所以 `package.json` 里显式设了 `build.directories.output = "release"` —— **别删这一行**。


---

## 打包成 exe

依赖只在**打包时**用得到（`electron` + `electron-builder`），游戏本体依然零依赖。

```bash
npm install          # 只需第一次，会下载约 100MB 的 Electron
npm run dist         # 产出 release/ 下的便携版 exe + zip
```

产物：

| 文件 | 说明 |
|---|---|
| `release/CosmosOrigin-0.4.5-win-x64.exe` | **给玩家的推荐版本**。单个自解压 exe，双击即玩，卸载就是删文件 |
| `release/CosmosOrigin-0.4.5-win-x64.zip` | 解压即用的绿色目录。部分杀软会误报自解压包，备一个这个 |

想快速验证打包有没有问题，用 `npm run dist:dir`（只出 `release/win-unpacked/`，几十秒）。

### 自检

```bash
npm run smoke            # app:// 伺服层 + 路径穿越，纯 Node，秒级出结果
npm run smoke:electron   # 真的起一个 Electron 加载页面，验证 ES 模块确实跑通了
node tools/inspect-asar.cjs release/win-unpacked/resources/app.asar   # 核对打进包的文件清单
```

`npm run smoke` 值得在每次动过 `electron/`、或调整 `index.html` 里的资源路径之后跑一遍。
理由是：**ES 模块的 MIME 只要给错一个字，窗口照样能开，但游戏是死的**
（模块被浏览器拒绝执行），而且不打开控制台根本看不出原因 —— 看起来就像「打包坏了」。
这个脚本直接驱动生产代码里的 `protocol.handle` 处理函数发真实请求，能把这类问题挡在前面。

### 打包产物为什么自带 Chromium

`release/` 里那个 exe 有 95 MB，因为 Electron 把整个 Chromium 内核打进去了。
换来的是：玩家电脑上**不需要** WebView2、不需要 Node、不需要任何运行库，
Win10 1809+ / Win11（x64）双击就能跑。发给不特定的人玩，这个交换是划算的。

---

## 踩过的坑（以及怎么绕）

| 症状 | 原因 | 怎么办 |
|---|---|---|
| `npm : 无法加载文件 npm.ps1，因为在此系统上禁止运行脚本` | Windows 默认执行策略是 Restricted，拦住所有 `.ps1` | 用 `npm.cmd` 代替 `npm`（`.vscode/tasks.json` 里已经这么写了）；或一次性放行：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `npm install` 卡在 Electron 下载，几十分钟不动，临时文件 0 字节 | Electron 的二进制（150 MB）默认从 GitHub Releases 拉，国内经常连不上 | 已经在本项目 `.npmrc` 里换成 npmmirror 镜像。若 npm 12 之后该配置失效，改用环境变量：`$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"` |
| `npm warn Unknown project config "electron_mirror"` | npm 11 开始对未知配置项报警告 | 无害，忽略即可。它只是提示这个写法在未来 npm 大版本会失效 |
| 打包报 `EPERM: rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'` | 有进程（杀软扫描 / 编辑器文件监听 / 索引服务）持有刚解压出来的文件句柄，Windows 下目录就无法重命名 | 等一会儿重试；或在 VSCode 里把项目文件夹临时关掉；实在不行把输出目录换到别处：`npm run dist -- --config.directories.output=D:\cosmos-build` |
| 玩家反馈「双击 exe 没反应」 | 自解压型便携版 exe 常被杀软拦 | 让他下 `...-win-x64.zip` 那个解压版，或者把 exe 加进白名单 |
| 想清掉存档重开 | 存档在 `%APPDATA%\CosmosOrigin` | 删掉这个目录即可（别删游戏目录，那里没有存档） |

---

### 为什么要走 Electron，而不是直接双击 index.html

游戏是原生 ES 模块。Chromium 在 `file://` 下会以 CORS 为由拒绝加载 `<script type="module">`，
页面直接白屏 —— 浏览器和 Electron 都是这个规则。

`electron/main.cjs` 里注册了一个 `app://` 自定义协议，用正确的 MIME 类型把静态文件伺服出去，
等价于开发时的 `serve.mjs`。所以打包后的 exe 里，模块加载走的是「假 HTTP」，不是 `file://`。

> 也正因为用的是 Electron 自带的 Chromium，**不依赖系统 WebView2**。
> 换成 Tauri / Neutralino 这类方案体积能小到几 MB，但要求玩家系统里有 WebView2 ——
> 老一点的 Win10 上不一定有，玩家就会看到白屏。要发给别人玩，Electron 更稳。

---

## 上传到 GitHub

仓库还没初始化，第一次要跑这几条（在项目根目录）：

```bash
git init
git add .
git commit -m "chore: 宇宙起源 0.4.5，加入 Electron 打包与自动构建"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 网页上新建一个 **Public** 仓库（**不要**勾选 Add README / .gitignore，否则会有冲突）。

### 发一个版本给玩家下载

```bash
# 先把 package.json 的 version 和 tag 对齐
git tag v0.4.5
git push origin v0.4.5
```

推上去之后 GitHub Actions 会自动：装依赖 → 打包 exe → 创建 Release 把两个文件挂上去。
几分钟后仓库的 **Releases** 页面就有一个可下载的 exe，把那个链接发给别人就行。

> 也可以不依赖 Actions，在本机 `npm run dist` 后在 Release 页面手动拖拽上传。两条路都通。

---

## 部署到 GitHub Pages（在线直接玩）

线上地址：**https://dawn-of-star.github.io/Public/**

推一下 `master` 就会自动重新部署。**首次需要手动开一下**（一次性，10 秒）：

> 仓库页 → **Settings** → 左侧 **Pages** → Build and deployment → **Source** 选 **GitHub Actions**

工作流里的 `configure-pages` 带了 `enablement: true` 会尝试自动开启，但那一步依赖
`GITHUB_TOKEN` 的权限，未必成功 —— **手动开是最稳的**，开完再推一次即可。

### 为什么不能直接把整个仓库发布出去

发布前要先挑文件。游戏真正需要的只有 4 个：`index.html`、`css/`、`src/`、`dist/`。
`legacy/`（0.3.4 原稿）、`tools/`（20 个开发脚本）、`electron/`、`build/` 都不该公开可访问。

`tools/check-web-bundle.cjs` 负责这件事，它做两步：

1. **只把白名单里的 4 项复制到 `_site/`**，然后只发布 `_site/`
2. **把整张 import 图从 `index.html` 走一遍**，任何一个被引用却不存在的文件都直接报错

第 2 步才是关键。ES 模块少一个文件就是**整页白屏**，而且**只在线上白屏** ——
本地 `serve.mjs` 跑的是完整仓库，永远看不出问题。

```bash
npm run check:web     # 本地先跑一遍，等价于 CI 里那步
```

它会顺带查出「大小写写错」这类问题：GitHub Pages 跑在 Linux 上**大小写敏感**，
Windows 本地不敏感，所以 `import "./Formulas.js"` 这种错在你机器上一切正常、一上线就白屏。

> ⚠️ 脚本里的 `FILES` 白名单必须和 `package.json` 里的 `build.files` 保持一致。
> 两边不一致的典型后果：**exe 能玩、网页白屏**，或者反过来。

### 网页版和 exe 版的存档不互通

浏览器版跑在 `dawn-of-star.github.io` 源下，exe 版跑在 `app://game` 源下，
`localStorage` 按源隔离，所以是**两份独立存档**。
想搬存档目前只能靠「导出存档」按钮（复制到剪贴板），还没有导入功能。

---

## 已知问题

这一版经过评估，**加权不可维护性 64.3%**，判定为「保留 HTML/CSS，重写 JS 层」。
完整报告见 `../incremental-base/docs/MIGRATION-034.md`。

### 已经修掉的（工程化缺失）

- [x] `index.html` 原本从 CDN 加载 break_eternity（离线会白屏）→ 改成引用本地 `dist/`
- [x] HTML 标签配对（原本多 2 个 `</div>`，级联出 3 处报错）
- [x] 补上 `<meta name="viewport">`（移动端）
- [x] `package.json` / `README.md` 原本是 **break_eternity 库的原文件**，已换成游戏自己的
- [x] 新增 `serve.mjs` + `.vscode/`

### 还没修的结构性问题（都在 `legacy/` 原稿里，新实现在 `src/`）

- [ ] `legacy/js/engine.js` 1154 行里有 **55 处 `getElementById`**，逻辑和 DOM 完全缠在一起
- [ ] `legacy/style.css` **0 个 CSS 变量**，70 处硬编码颜色、25 种色值
- [ ] `legacy/style.css` **0 个 `@media`**，双列 flex 布局在窄屏会挤爆
- [ ] `legacy/style.css` 有 9 条死规则（53 行，9.4%）
- [ ] 数值层违反 `../incremental-base/SPEC.md` 的判据 **P10（S < 1）**，
      当前 S = 2.93，整局会在几十分钟内跑飞

---

## 数据流

```
index.html
  └─ <script type="module" src="./src/main.js">
        ├─ import Decimal from "../dist/break_eternity.esm.js"   （无全局变量）
        ├─ load()                  读 localStorage
        ├─ initUI(handlers)        绑定按钮 → 动作
        └─ requestAnimationFrame(frame)
             ├─ tick(state, dt)        纯逻辑，不碰 DOM
             ├─ save(state)            每 15 秒自动存档
             └─ render(state)          节流到 20fps，唯一碰 DOM 的地方
```

打包后的 exe 里，最外面多一层壳：

```
CosmosOrigin.exe
  └─ electron/main.cjs（主进程）
       ├─ protocol.handle("app://", …)   把静态文件当 HTTP 伺服
       └─ BrowserWindow.loadURL("app://game/index.html")
            └─ 页面内部和上面完全一样
```

**所有大数运算都用 `Decimal`，不要用 `Math.pow`。**
JS 的 `Number` 上限是 1.8e308，`Math.pow(4, 512)` 就会溢出成 `Infinity` 并污染整条链。

---

## 第三方库

`dist/` 是 [break_eternity.js](https://github.com/Patashu/break_eternity.js) **2.1.3**（MIT），
作者 Patashu。它能把数字表示到 `10^^1e308`。

**需要更新时优先更新它**，然后把 `dist/` 里的文件整体替换掉。
`LICENSE` 是它的，保留是 MIT 的要求。
