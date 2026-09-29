# 空想增量（Kongxiang Incremental）

网页增量游戏。原生 ES 模块 + `break_eternity.js`，**零构建、零 npm install**。

当前版本：**0.5.1**

> **改完东西只想确认没搞坏？** 跑 `npm test`（或 `node tools/run-all.mjs`）——
> 一次跑完 22 个自检脚本，只把失败细节打出来。约 4 分钟。
> 不知道该改哪个文件？看下面[「想改一个数值」](#想改一个数值)那张表。

### 维护约定（改机制时必须同步的三处）

这个项目已经不靠「记得住」运转，而靠三样东西兜着。任何一次机制改动，这三处必须一起动：

1. **代码注释写清「为什么」** —— 踩过的坑、被否掉的方案、反例，都留在注释里（它们是防止回退的唯一记录）。
2. **`tools/` 里补一条定点断言** —— 每个机制至少有一条能被 `npm test` 抓到的检查；
   凡是「界面显示的东西」，都必须有「显示 == 实际运算」的守卫（`consistency.mjs` 那类）。
3. **README 与 `docs/` 同步** —— 新数值进「想改一个数值」表，新机制进对应章节。
   **没有断言与文档的机制，视为没做完。**

> 换个说法：数值住在 `src/config.js`，理由住在注释与 `docs/`，验收住在 `tools/`。
> 人只需要决定「要什么」，不需要同时记住「怎么算」。

---

## ⚠️ 重点声明（请先阅读）

> **本游戏的设计、大部分代码与灵感均参考自《反物质维度》（Antimatter Dimensions，简称 AD）。**
>
> - **原版 AD 源码**：https://github.com/IvarK/AntimatterDimensionsSourceCode （MIT 许可）
> - **原版 AD 网页版仓库**：https://github.com/IvarK/IvarK.github.io
> - **原版 AD 在线试玩**：https://ivark.github.io/
>
> **本项目的大多数代码由 AI 开发**，人工主要负责提出需求、验证与调整。
>
> 本项目并非 AD 的官方续作或衍生作品，与 AD 原作者（Hevipelle 及 IvarK 等贡献者）**无任何隶属或授权关系**；AD 的一切著作权归其原作者所有。本项目遵循 MIT 许可，如原作者认为本项目存在不当之处，请联系后我会立即处理。

---

## 三种拿到游戏的方式

| 你想干嘛 | 用什么 | 需要装什么 |
|---|---|---|
| **点开就玩（最省事）** | **https://dawn-of-star.github.io/Public/** | 只需要浏览器 |
| **下载到本地玩** | Release 里的 `KongxiangIncremental-0.5.1-win-x64.exe` | **什么都不用装**，双击即玩 |
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
├── css/amoled.css               AMOLED 主题（配色取自 Antimatter Dimensions）
├── serve.mjs                    零依赖静态服务器（浏览器开发用）
├── package.json                 版本号 + 依赖 + 打包配置（build 字段）
├── .npmrc                       Electron 下载源换成国内镜像
├── .gitignore / .gitattributes  node_modules、release、换行符与语言统计
├── docs/                        ★ 设计文档（不参与打包与发布）
│   └── INFINITY-UPGRADES.md     ∞ 层升级候选清单（含 AD 原版逐条对照）
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
│   ├── run-all.mjs              ★ `npm test`：一次跑完下面全部自检
│   ├── smoke-protocol.cjs       自检：驱动真实的 app:// 处理函数发请求
│   ├── smoke-electron.cjs       自检：真起 Electron 加载页面（需 npm install）
│   ├── inspect-asar.cjs         自检：列出放进 exe 的文件清单（需打包产物）
│   ├── headless.mjs             无头模拟 + S 判据自检
│   ├── infinity-sim.mjs         ∞ 层（无限升级）的定点自检 + 会玩的玩家模拟
│   ├── pace-model.mjs           ★ 节奏**数学模型**（解析式算时间，不跑游戏）
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
| `release/KongxiangIncremental-0.5.1-win-x64.exe` | **给玩家的推荐版本**。单个自解压 exe，双击即玩，卸载就是删文件 |
| `release/KongxiangIncremental-0.5.1-win-x64.zip` | 解压即用的绿色目录。部分杀软会误报自解压包，备一个这个 |

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
| 想清掉存档重开 | 存档在 `%APPDATA%\CosmosOrigin` | 删掉这个目录即可（别删游戏目录，那里没有存档）。<br>⚠️ 目录名**故意保留旧名**：改它 = 老存档立刻找不到 |

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
git commit -m "chore: 空想增量 0.5.1，加入 Electron 打包与自动构建"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 GitHub 网页上新建一个 **Public** 仓库（**不要**勾选 Add README / .gitignore，否则会有冲突）。

### 发一个版本给玩家下载

```bash
# 先把 package.json 的 version 和 tag 对齐
git tag v0.5.1
git push origin v0.5.1
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
空想增量.exe（打包后的实际文件名是 ASCII 的 `KongxiangIncremental.exe`，中文名只用做 productName）
  └─ electron/main.cjs（主进程）
       ├─ protocol.handle("app://", …)   把静态文件当 HTTP 伺服
       └─ BrowserWindow.loadURL("app://game/index.html")
            └─ 页面内部和上面完全一样
```

**所有大数运算都用 `Decimal`，不要用 `Math.pow`。**
JS 的 `Number` 上限是 1.8e308，`Math.pow(4, 512)` 就会溢出成 `Infinity` 并污染整条链。

---

## 想改一个数值

**关键是「唯一数据源」**：每个数值只有一处定义，改那里就够了；改完跑对应工具。
（不用记住全部 —— 跑了 `npm test` 就知道有没有牵动别处。）

| 你想改的东西 | 改哪里（唯一数据源） | 改完先跑这个 |
|---|---|---|
| 爬升快慢 / 曲线形状（e25→e308） | `QUANTUM.growthRateMax` + `CLIMB` | `npm run pace` → `pace:check` |
| 单次无限的收益上限（④ 的 30 分钟） | `INFINITY_UPGRADES.ipTime.capSeconds` | `npm run sim:infinity:check` |
| 量子门槛 / 捕获节奏 | `QUANTUM.zpeBaseCost` `zpeCostGrowth` `zpeCostExtraNerf` | `tools/quantum-curve.mjs`、`quantum-growth-tune.mjs` |
| 暗能量与惩罚 | `DE_PENALTY`、`DE_UPGRADES` | `tools/de-tune.mjs`、`de-milestone-model.mjs` |
| 无限门槛 / 无限升级 | `BREAK_INFINITY`、`INFINITY_UPGRADES` | `npm run sim:infinity:check` |
| 打破无限之后的软上限 | `OVERLOAD` | `tools/infinity-sim.mjs --check` |
| 价格曲线（含分段） | `REPEATABLE`、`VOID_UPGRADES`、`PIECEWISE` | `tools/audit.mjs` |
| 乘区颜色 / 词条 / 图例 | `ZONES`、`ZONE_OF` | `tools/dom-smoke.mjs`（乘区登记守卫） |
| 界面文字（卡片描述） | `config.js` 各条目的 `desc`（要**从公式算**） | `tools/dom-smoke.mjs`、`consistency.mjs` |

---

## 乘区与「全局加成」槽

颜色 = **加成作用的位置**（同一颜色 = 叠在同一个位置）。这一格一色，是为了让玩家
一眼看出「这两条升级是不是重复的」。**名字也必须各自唯一**，否则会出现
「叫全局的其实是计数、叫计数的其实是全局」这类歧义。

| 词条 | 乘区 | 谁在里面 |
|---|---|---|
| 熵 / 粒子 / 物质 / ZPE / 暗能量 | 五条产率线各自的位置 | 对应产线的升级与里程碑 |
| **计数频率**（青） | 全局加成里的 `1 + 0.05×等级` 那一项 | 只有「计数频率」那条可重复升级 |
| **全局**（金） | **真·全局**：`全局加成 = 梦想点项 × 计数频率项 × 暗能量项` | `v4`（抬梦想点系数） |
| **价格**（灰） | 不产生产出，只改「买得起 / 多贵 / 要不要钱」 | `v9`、`m2`、`dm4` |
| 量子（红） | 量子加成：熵 ×(1+q)、指数成长速率 R(q) | 第三层 |
| 无限点（品红） | ∞ 层自己的收益 | ①②④ |
| 梦想（虹） | 梦想点体系（花梦想点 / 作用于梦想系统） | 4 条自动化 + 烧梦想点的升级 |

**顶部有一个「全局加成」槽**，显示那个乘积以及它的三个因子（各按自己的乘区上色）：
`梦想点 ×1.4 · 计数频率 ×10.2 · 暗能量 ×8.7 = ×123`。
`tools/consistency.mjs` 会断言「槽里显示的总值 == 三因子之积 == `globalMultiplier()`」。

---

## ∞ 层：无限升级

大坍缩给**无限点**，无限点在「无限」页买升级（都不随大坍缩重置，UI 排成 **2×n 网格**，
颜色按"加成落在哪个位置"取乘区色；只有作用于梦想系统的条目才用虹色）：

| 名字 | 价格 | 效果 | 位置 |
|---|---|---|---|
| 无限增幅（可重复） | 1 起，每级 ×10 | 无限点收益 **×3/级** | 无限点 |
| 零点耦合 | 1 | ZPE 倍率 += 无限点数量 | a区·加法区 |
| 相变超频 | 1 | 相变仪速率 ×(1 + 无限点 × 0.5) | 暗能量 |
| 无限长河 | 3 | 每次无限额外获得「**耗时÷60**」点，**单次最多计 30 分钟** | 无限点 |
| 起点跃迁 I~IV | 20 / 40 / 80 / 300 | 每次大坍缩后以 **1e50 / 1e100 / 1e150 / 1e200** 物质开局 | 物质 |
| 速率解放 I~IV | 10 / 100 / 1e3 / 1e4 | 量子成长速率上限 **×1.10 / ×1.10 / ×1.15 / ×1.20**（合计 ×1.6698） | 量子 |

「打破无限」要 **128 点**。

### 为什么要 ④ 这么一条"按耗时给点"

大坍缩的深度收益是 `floor((log10M / 308.2547)²)`，而物质被硬顶在 `1e308.2547`，
所以**每次无限恰好 1 点**；而一次无限又要 100 分钟左右。光靠深度收益，攒 128 点要 200 小时 —— 整层不可达。

④ 把一部分收入改成**按耗时**给：`单次收入 = min(耗时, 30 分钟) ÷ 60 × 3^①等级`。
**单次最多计 30 分钟**（学 AD 的做法：给上限，不让挂机无限赚），于是
`IP/小时 = 60 × 3^① × min(T,1800)/T`：
单次 ≤30 分钟吃满，100 分钟只拿 30%。这就给「把单次无限压进 30 分钟」定了个明确目标，
速度类升级（起点跃迁 / 速率解放）也才有意义。而且这条收入不随深度指数膨胀，
"引擎 → 量子 → 上限"那类反馈环不会被点燃。

实测（`node tools/infinity-sim.mjs --hours=16`）：**约 10.4 小时 / 6 次无限**买下「打破无限」；
数学模型（`npm run pace`）算出来是 **10.5 小时 / 6 次**，两者一致。

### 为什么要「起点跃迁」和「速率解放」

`1e25 → 1e308.25` 这一段（量子层解锁后爬升）的斜率 = 量子成长速率 R，而 **a区 的产率升级
对它完全无效**（基础环比指数项小 1e200 倍，实测过）。所以只有两个真杠杆：

- **抬 R 的上限** → 速率解放（`t ∝ 1/R₀`，每 +10% → 单次无限 −9%）
- **缩短距离** → 起点跃迁（从 1e25 提到 1e200 → 单次 −37%）

### 爬升形状：从直线改成 log 形（路线 1）

原来 `d(log10M)/dt = R(q)` 是**常数** —— 曲线是一条直线，每 25 阶都是 8.5 分钟，像节拍器。
现在加了 `CLIMB` 因子让斜率随深度递减：

```
R_eff = R(q) · 2^(−(L − 25)/100)        （L ≤ 25 时恒为 1，所以 e25 之前不受影响）
⇒ L(t) = 25 + 100·log2(1 + ln2·R₀·t/100)      ← log 形
```

| 每 25 阶 | 改之前（直线） | 现在（log 形） |
|---|---|---|
| 25→50 | 8.5 min | **3.1 min** |
| 125→150 | 8.5 min | 6.2 min |
| 225→250 | 8.5 min | 12.4 min |
| 275→300 | 8.5 min | 17.5 min |
| **合计 e25→e308.25** | 96.7 min | **100.2 min** |

**总时长几乎不变，但形状从直线变成了 log**：前期快 2.7 倍、末期慢 2 倍。
`QUANTUM.growthRateMax` 必须和 `CLIMB.halvingOrders` 一起调（只改一个总时长会漂），
参数表与断言见 [`tools/pace-model.mjs`](tools/pace-model.mjs)（`npm run pace` / `npm run pace:check`）。

### 过载（打破无限之后的软上限）

未打破无限时物质被**硬顶**在 `1e308.2547`，到顶强制大坍缩（原样保留）。
**打破之后不再有硬顶**，改走过载：

```
拐点 = 308.2547 + log10(1.01) × 量子数           ← 量子推迟拐点（每量子 +1%）
超出后：d(log10 M)/dt = R(q) · 2^(−(L − 拐点)/10)  ← 每 10 阶速率减半
```

为什么必须是"软"的：硬顶会让「再深一点」变成不可能，于是任何"用无限点买的东西去抬上限"的设计
都会掉进 `cap = f(IP(cap))` 这个自指闭环 —— 要么卡死、要么刀刃爆炸（推导见
[`docs/INFINITY-UPGRADES.md`](docs/INFINITY-UPGRADES.md)）。
软上限把"能不能过去"换成"过去得有多慢"，进度永远有一点。

实测（`node tools/infinity-sim.mjs`）：打破无限后物质能越过旧硬顶（12 小时到 `5.85e326`，+18 阶），
而**前置段完全不变**（仍是硬顶 + 强制坍缩；6 次无限、约 9.7 小时买下「打破无限」）。

### 下一步要加的无限升级

16 格候选（含 AD 原版 16+2 条的逐条对照、以及「哪几条对 1e25→e308.25 段真的有效」的实测数字）
在 [`docs/INFINITY-UPGRADES.md`](docs/INFINITY-UPGRADES.md)。结论是：**这 16 格里真正能加速那段的只有
「抬 R 上限」与「抬高开局深度」两类**（已各实现 4 条），其余多数是结构性无效的装饰品 —— 原因见该文档第 0 节。

---

## 第三方库

`dist/` 是 [break_eternity.js](https://github.com/Patashu/break_eternity.js) **2.1.3**（MIT），
作者 Patashu。它能把数字表示到 `10^^1e308`。

**需要更新时优先更新它**，然后把 `dist/` 里的文件整体替换掉。
`LICENSE` 是它的，保留是 MIT 的要求。
