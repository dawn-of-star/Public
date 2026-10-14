# 空想增量 × N.E.K.O 接入说明

> **状态：✅ 权威（本文是 N.E.K.O 接入的唯一依据）** —— 最后核对 2025（本次文档整理）
> ⚠️ 文中提到的"脚本全绿"是**默认批跑**的口径；`--strict` 另有已知失败（见 `README-STATUS.md`）✓
> **版本：0.6.17（本轮完成态）** · 维护者：空想增量（Kongxiang Incremental）侧
> 本文档用于与 N.E.K.O 开发者交流。写的是**我们想接入什么、我们能提供什么、需要你们确认什么**，
> 以及**我们这一侧已经做到了哪一步**。
>
> ⚠️ **一句话现状**：**游戏侧（无宿主版本）已全部完成并可独立验证；
> 接入的唯一硬阻塞是「让宿主注册表里有我们的 id/version」**（见 §8 问题 1）。

---

## 0. 本轮（0.6.17）完成态速览

| 部分 | 状态 | 落点 |
|---|---|---|
| **好感度系统**（原生，零依赖 SDK） | ✅ 完成 | `src/config.js` 的 `NEKO` / `nekoGlobalExponent` / `addNekoAffinity` / `nekoDriftRoom` |
| **三道具**（猫条 / 棒棒糖 / 猫爪） | ✅ 完成 | `NEKO_ITEMS` + **`useNekoItem`（唯一入口）** |
| **结构化日志**（§9 的形状） | ✅ 完成 | `pushLog(state, text, data?)` + `setLogSink()` |
| **状态快照**（§5 的形状） | ✅ 完成 | `src/neko.js` 的 `nekoSnapshot(state, nowMs)` |
| **动作白名单 + 派发器**（§6 三条约束） | ✅ 完成 | `neko.js` 的 `dispatchNekoActions(state, actions, api)` |
| **无宿主优雅降级** | ✅ 完成并断言 | `createNekoBridge()` —— 无宿主时全部 no-op |
| **UI**（主控台 ▸ 猫猫子页，两列） | ✅ 完成 | `index.html` 的 `panel-neko` + `ui.js` 的 `renderNeko` |
| **SDK 连接**（真握手） | ⏳ **仅差注册** | 契约已 100% 核清（见 §3.6）；`connect()` 里接 4 行即可 |

**自觉的定位**：我们核对过 Steam 发行版 —— **现有的 badminton / soccer 两个小游戏都*没有*用 SDK**
（它们走的是旧式的 `window.lanlan_config` + 同源 fetch）。
⇒ **我们大概率是第一个走 `neko-minigame-sdk` 这条路的第三方**。
所以我们倾向于**把契约写得比需要的更明确**，方便你们核对我们的理解是否正确。

---

## 1. 我们是什么

一个**纯静态、零依赖的网页放置游戏**：

- 原生 ES 模块 + 一个第三方大数库（`break_eternity.js`），**没有构建步骤、没有 npm 运行时依赖**；
- 单页应用，`index.html` + `src/*.js` + `css/*.css`，可被任意静态服务器伺服；
- 同时有 Electron 壳（`app://` 协议伺服同一份静态文件），所以**也跑在桌面端**；
- 全部状态在一个可序列化的 `state` 对象里，**有导出/导入存档**，并且**已经有一份结构化日志**。

游戏内的层：熵 → 粒子 → 物质 → 真空零点能（ZPE）→ 暗能量 → 量子 → 无限（大坍缩）→ 永恒。

> ⚠️ **因为我们能部署成纯静态站（GitHub Pages）**，所以有一条自我约束：
> **没有宿主时游戏必须完整可玩**。本轮的"无宿主版本"就是按这条做的（见 §5.4）。

---

## 2. 我们想接入什么（一句话）

让 N.E.K.O 的猫娘**读得到游戏状态、能替玩家做一些操作、并且有对话与长期记忆**，
同时在游戏内保留一个"她在旁边"的位置（**好感度 + 聊天**）。

---

## 3. 接入路径：**走 `neko-minigame-sdk`，不走 plugin 系统**

我们在你们的仓库里读到两套东西：

| 路径 | 我们读到的东西 | 判断 |
|---|---|---|
| **`static/game/sdk/neko-minigame-sdk.js` + `.d.ts`** | `Manifest` / `CommandContract` / `Capabilities` / `HostHandshakeRequest` / `StatePublisher` / `ResultPublisher` / `Events` / `Controls` / `Commands` / `Dialogue` / `ContextReader` / `MemoryConsentState` / `MemorySubmission` | ✅ **我们要的这条**（Web 游戏原生） |
| `plugin/`（`NekoPluginBase`、`@plugin`、`ctx.`、`PLUGIN_DEVELOPMENT_GUIDE.md`） | Python 侧插件体系（让 AI 转述 / 安静通知 / HUD 通知） | ⏸ 备选：只在需要"Python 侧扩展"时才用 |

理由：我们是浏览器里的静态游戏，`neko-minigame-sdk` 提供的
**宿主握手 + 状态发布 + 指令契约 + 对话/记忆**几乎逐项对上我们的需求；
而插件系统解决的是"服务端 agent 扩展"，与"游戏内互动"不是一层。

### 3.5 可行性核查（**实测 Steam 发行版**，不只是源码）

我们在 `E:\SteamLibrary\steamapps\common\n.e.k.o`（公开的 Steam 打包版本）里核对了这条路线：

| 核查项 | 结果 |
|---|---|
| SDK 是否随包发布 | ✅ `resources/bin/static/game/sdk/neko-minigame-sdk.js`（217.7 KB）+ `.d.ts`（19 KB） |
| **权威契约** | ✅ `static/game/sdk/neko-minigame-manifest.schema.json`（15.8 KB，**JSON Schema**） |
| 宿主侧文件 | ✅ `neko-minigame-{audio,avatar,same-origin-bootstrap,same-origin-host}.js`、`system/game-audio-system.js` |
| 已有小游戏放在哪 | ✅ `static/game/games/{badminton,soccer}/`，入口页 `templates/{badminton,soccer}_demo.html` |
| **真实的调用方式** | ✅ 见 §3.6（**已逐字核清**，包括工厂与 connect 的签名） |

### 3.6 ★ 接入契约（0.6.17 逐字核对，技术侧**无未知项**）

#### 3.6.1 页面引导顺序

```html
<!-- ① 宿主模板（由你们的 Python 侧渲染）必须在加载 bootstrap 前吐出这段 JSON。
         我们的判据就是"这个节点此刻还在不在"（bootstrap 会同步吃掉并删除它）。 -->
<script type="application/json" id="neko-minigame-host-launch">
  { "registrations": { "<我们的 id>": { "gameId": "...", "version": "...",
      "mode": "registered|development", "publisherId": "...", "allowedCapabilities": [...] } } }
</script>
<!-- ② 同源加载引导（它内部再加载适配器、暴露下面那个 Promise） -->
<script src="/static/game/sdk/neko-minigame-same-origin-bootstrap.js"></script>
<script src="/static/game/sdk/neko-minigame-sdk.js"></script>
```

#### 3.6.2 我们这一侧的连接代码（4 行）

```js
const factory   = await window.nekoMiniGameSameOriginHostReady;  // 引导暴露的 Promise
const transport = factory({ gameType: "<注册过的 id>" });         // ← 未注册 ⇒ **构造就抛**
const client    = await window.NekoMiniGame.connect(manifest, { transport });
// 之后：client.logger / client.state / client.controls / client.dialogue / client.memory ...
```

#### 3.6.3 我们核到的关键签名（供你们确认我们的理解）

| 项 | 事实 |
|---|---|
| 全局入口 | `window.NekoMiniGame = Object.freeze({ version, protocolVersion, supportedCapabilities, mandatoryCapabilities, connect, Error })` |
| 工厂 | `window.createNekoMiniGameSameOriginHost(options)` —— **只需 `{ gameType }`**；内部 `new NekoMiniGameSameOriginHost({ ...options, launchRegistration: HOST_BOOTSTRAP.registrations.get(gameType) \|\| null })` |
| **构造的门槛** | `launchRegistration` 为空 ⇒ **抛** `game_unregistered`（"A host-issued launchRegistration is required"）；`options.gameType/gameVersion` 与注册不一致 ⇒ **也抛** |
| `connect(manifest, options)` | **只需 `options.transport`**；`windowImpl` / `documentImpl` / `AbortController` 均可注入（⇒ 测试友好） |
| 握手校验 | `connectGame()` 里 `manifest.id !== registration.gameId \|\| manifest.version !== registration.version` ⇒ `{ accepted:false, code:'game_unregistered' }` |
| manifest 必填 | `["id","version","requiredCapabilities"]`，且 `requiredCapabilities` **必须 contains `{ const: "logging" }`** |

#### 3.6.4 传输机制 = **同源 HTTP**（不是 WebSocket / postMessage）

| 方向 | 端点 |
|---|---|
| 我们 → 你们 | `POST /api/game/logs`（**logging 是唯一强制能力**）、`POST /api/game/logs/enable` |
| 双向 | `POST /api/game/<gameType>/<op>`，`op ∈ { protocol, route/start, route/heartbeat, route/drain, route/voice-transcript, chat, speak, speech/preload, mirror-assistant, character, context/read, realtime-context, memory/submit, end }` |

端点由适配器里的 `_gameEndpoint(p) => /api/game/${encodeURIComponent(gameType)}/${p}` 拼出
⇒ **`gameType` 是路径段**。

> 证据：适配器里全是 `this._post(...)`；`WebSocket` / `EventSource` **零**引用；
> `postMessage` 仅 1 处（avatar bridge，非主通道）。

#### 3.6.5 现有小游戏**没有**用 SDK（我们的重要发现）

```
templates/badminton_demo.html （10546 行）：0 处 SDK 引用
static/game/games/soccer/soccer-demo.js（6878 行）：0 处 SDK 引用
两者都是旧式集成：读 window.lanlan_config / ?lanlan_name&session_id，然后同源 fetch
⇒ 我们**没有范例可抄**。若我们的理解有偏差，请直接指出（这也是本文档写得啰嗦的原因）。
```

---

## 4. 能力映射（我们的用法）

| SDK 能力 | 我们打算怎么用 | 现状 |
|---|---|---|
| `Manifest` / `HostHandshakeRequest` | 声明本游戏的身份、版本、入口，完成宿主握手 | ⏳ 等注册（§8 问题 1）|
| `StatePublisher` | **发布游戏状态快照**给猫娘读（见 §5） | ✅ 快照已就绪（`nekoSnapshot`），等宿主推送 |
| `CommandContract` / `Controls` | **声明可执行指令白名单**（见 §6），由猫娘调用 | ✅ 白名单 + 派发器已就绪（§6.4）|
| `ResultPublisher` | 回执：某条指令做了什么、结果是什么 | ✅ 结果对象已定义（`NEKO_ACTION_RESULT`）|
| `Dialogue` | 猫娘与玩家在游戏内的对话（我们提供一个"她"的面板位置） | ✅ **UI 位置已留**（猫猫子页右列），⏳ 待接 |
| `ContextReader` / `MemorySubmission` / `MemoryConsentState` | 把**关键进度**长期留存在她的记忆里 | ⏳ 待接（需要你们确认保留策略，§8 问题 5）|
| `avatar` / `audio` / `speech-output` / `voice-input` | 有兴趣接（形象/语音），但希望先确认是否为接入必需项 | ⏳ 待确认（§8 问题 4）|

---

## 5. 我们对外提供的**只读状态快照**（喂给 `StatePublisher`）

原则：**只读、版本化、不暴露可写入口**（写能力只走 §6 的白名单指令）。

### 5.1 形状（`src/neko.js` 的 `nekoSnapshot`，**已实现**）

```js
{
  schema: 1,                       // 版本号；字段增删会 bump，避免对面猜
  t: 1699999999999,                // 快照时间（可注入，便于测试）
  resources: {                     // 关键资源（字段名**逐个核对过实际 state**）
    entropy, particle, matter, zpe, darkEnergy, quantum,
    infinityPoints, eternityPoints, dreamPoints,
  },
  rates: { entropy, particle, matter } | null,   // ← 由调用方注入引擎函数现算
  progress: {                      // 阶段与关键节点
    phaseTransmuterUnlocked, brokenInfinity, bigCrunchCount, quantumPairs,
    zpeMilestones: [...], deMilestones: [...], tierMilestones: [...],
    zpeEngine: { unlocked, level }, eternityCount,
  },
  multipliers: { dream, countFreq, de, base, nekoExp, total } | null,
  log: [ { t, kind, text, data } ],  // 结构化日志（见 §9）
}
```

### 5.2 两条**刻意的诚实设计**（请按这个语义读）

| 情况 | 我们的行为 | 为什么 |
|---|---|---|
| 速率 / 乘区**尚未注入** | `rates: null` / `multipliers: null` | **不编 0** —— 0 的意思是"真的没产出"，与"没测"是两回事 ✗ |
| 后续阶段才有的字段（如 `darkMatter`） | **不存在** | **不编造字段** —— 对面不该看到"我们还没有的东西" |

### 5.3 推送节奏

每 **5 秒**一份（与存档同族的秒级累计，不引入新的时间源）。无宿主时该步骤是 **no-op**。

### 5.4 无宿主时的行为（我们最在意的约束）

```
没有宿主 ⇒ nekoBridge 全部方法 no-op：
  · available = false、connected = false
  · sendLog(...) → false（不抛）｜publishSnapshot() → false（不抛）
  · 游戏主流程**一行都不改变**（我们的 dom-smoke 会断言这一条）
```

---

## 6. 猫娘可以做的操作（**动作白名单**）

我们愿意开放一批**动作**给猫娘调用，但有三条硬约束（也是我们的既有判据）：

1. **阶段白名单**：动作只能作用于玩家**已经到达**的阶段（不会替玩家越过门槛）；
2. **只走既有购买函数**：不自己写扣款逻辑（我们踩过"自动化与手动双倍发放"的坑）；
3. **限流 + 幂等**：每批最多 N 次动作；重复调用同一动作不叠加。

### 6.1 清单（`src/config.js` 的 `NEKO_ACTIONS`，**唯一来源**）

| 动作 | 含义 | 我们加的守卫 |
|---|---|---|
| `buyRepeatable(id, max)` | 买三条主升级 | `id` 必须在 `REPEATABLE` 里 |
| `buyVoidUpgrade(id)` | 买虚空升级 | `id` 必须在 `VOID_UPGRADES` 里 |
| `buyDeUpgrade(id, max)` | 买暗能量升级 | `id` 必须在 `DE_UPGRADES` 里 |
| `buyInfinityUpgrade(id)` | 买无限升级（含 ① 无限增幅） | `id` 必须在 `INFINITY_UPGRADES` 里 |
| `doBigCrunch()` | 大坍缩 | **必须已打破无限**（打破前是硬顶自动触发，不该由猫娘代按）|
| `doEternity()` | 永恒 | 必须已打破无限（门槛由 `canEternity` 自己判）|
| `setAuto(...)` | 开关自动化 | ⏳ **故意返回 `rejected`**，见 §6.3 |

### 6.2 限流

`NEKO_MAX_ACTIONS_PER_TICK = 8`。超出的动作**丢掉并计数**（`throttled`），**不整批失败**
（对面是 LLM，多发了不该让整批作废）。

### 6.3 ⚠️ `setAuto` 为什么**还没做**（而不是"忘了"）

§10 原文要求：「猫娘驱动的自动化**不花游戏内的梦想点**，也不占用玩家已买的自动化升级槽位」。

⇒ 那是一条**独立通道**，而游戏内现有的自动化都**各有解锁前提**
（`isAutoAcquire` 由虚空升级 `v9` 推导；暗能量那 5 条由梦想升级推导）。
若猫娘绕过前提去开，等于**替玩家越门槛**（违反约束 1）；
若在引擎里另加一条"猫娘专用分支"，又正是约束 2 想避免的"自己写一套" ✗

⇒ **它需要一个"玩家可授予的授权开关"**（UI 还没做）。在那之前，我们让 `setAuto`
**明确返回 `rejected` 并带上原因**，而不是假装成功。

### 6.4 派发器（已实现，可独立验证）

`src/neko.js` 的 `dispatchNekoActions(state, actions, api)` 是三条约束的**唯一实现**：

- `api` 由调用方注入（`src/main.js` 的 `nekoActionApi`），**每一项都是引擎的导出**；
- 白名单**不自己抄一份 id 表** —— 合法性问注入的 `has*` 探针；
- 未知动作 ⇒ `unknown_action`（**不抛**）；守卫不过 ⇒ `rejected` + 原因。

**我们自己的验证方式**（无需宿主）：控制台 `__game.nekoActions([...])` 走**完全同一条路**。

### 6.5 三条约束的断言（`tools/dom-smoke.mjs`）

```
✅ 合法动作执行 ✓｜未知 id / 阶段未到 / setAuto 未实装 各拒绝 ✓
✅ 未知名不抛（unknown_action）✓｜`applied < 总数`（防止"全部拒绝"的退化实现拿全绿）✓
✅ 限流单独验：5 条样本 / 上限 3 ⇒ 执行 3、截掉 2 ✓
```

---

## 7. 好感度系统：**我们游戏的原生系统**（接入后可由猫娘主动调控）

> **先声明（用户原话）**：好感度系统是**我们这边游戏的原生部分**，
> **不接入 SDK 也照常开发**；**接入之后**，额外开放一条通道，让**猫娘可以主动调控**它。
> ✅ **本轮（0.6.17）已按这条实现完毕。**

### 7.1 已实现的规格

| 项 | 值 | 备注 |
|---|---|---|
| 范围 | 初始 **0**，`[-100, 100]` | 正值**档位判定**不受 100 限制 |
| **全局加成** | 好感度 > **25 / 50 / 75** ⇒ 全局 **`^1.002` / `^1.005` / `^1.015`**（**叠乘**）| 三档全开 = `^1.02211515` |
| **负面好感度** | **不影响游戏进程** | 指数恒 `1`（只向上偏）|
| **波动边界** | 每 **5 分钟**波动 `< 8` 点 | 接入 SDK 后放宽到 `< 16` |
| 落点 | `全局加成 ^= nekoGlobalExponent(state)` | **一处实现**（`config.js` 的 `nekoGlobalExponent`）|
| 存档 | `nekoAffinity` / `nekoDriftStamps` | **不随任何重置清空**；反序列化时**夹到 [-100,100]**（防手改存档 ✗）|

**安全性（用户已论证，我们照此实现）**：本作有一条"环增益总和 < 1"的判据，当前值 **0.7263**；
三档全叠也只有 **0.7423** ⇒ **留有余量** ⇒ **不需要额外的软上限**。

### 7.2 三个道具（§10 原文 + 我们补的部分）

| 道具 | 成本 | 好感度 | 来源 |
|---|---|---|---|
| **猫条** | **免费** | +1 | 原文「免费的猫条」 |
| **棒棒糖** | **当前所有物质** | +3 | 原文「需要当前所有物质购买」 |
| **猫爪** | **当前所有 ZPE** | +5 | 原文「所有 zpe 换取」 |

⚠️ **「给多少好感度」原文没写，是我们补的**（按"越贵给越多"：1 / 3 / 5）。
   已在 `config.js` 注释里**显式标注**，不假装是原文的。

**实测发现（值得你们知道的设计含义）**：三个道具**共用同一个 8 点窗口**
⇒ `1+3+5 = 9` 会被削成 8（猫爪实得 4）。这是 §7 波动边界的**必然结果**，
⇒ **从 0 爬到第三档（>75）至少需要 10 个窗口 ≈ 50 分钟** —— 好感度是个**慢变量**。
若你们希望"猫娘快速拉高好感度"，那要动的是 §7 的 8/16 点上限，不是道具。

### 7.3 UI 位置（用户裁定）

**主控台 ▸ 猫猫子页**（与"梦想（自动化）"并列，表现形式同"虚空科技"的悬浮子页）：

```
┌ 左列（窄）───────────────┬ 右列（宽）────────────────┐
│ 好感度卡：当前值 / 全局加成^ / 下一档 / 进度条        │ 对话卡：消息流          │
│           **档位阶梯**（三档，生效的高亮）             │        （未接入 ⇒ 占位）  │
│           **本轮波动额度**（还剩 N 点）                │                        │
│ 道具卡：猫条 / 棒棒糖 / 猫爪（三个真按钮 + 成本文案）   │ 接入状态卡：SDK 状态    │
└──────────────────────────┴────────────────────────┘
```

> ⚠️ 用户要求「由于要有**对话功能**，子页面下分出**两列**（左侧和右侧）」⇒ 已按此布局。

### 7.4 边界谁在管（接入后）

| 场景 | 谁在驱动好感度 | 游戏侧行为 |
|---|---|---|
| 未接入 SDK | **我们游戏自己**（道具等原生机制） | 完整可用，不依赖任何外部进程 |
| 已接入 SDK | **猫娘**（她主动写入）＋ 原生机制仍可用 | 我们只提供**带边界的写入通道**（`addNekoAffinity` = 唯一写入点）并原样展示 |

无论谁驱动，**§7.1 的波动边界都生效**（`sdk = true` 时用 16 点档）。

---

## 8. 我们**不能**提供 / 需要你们确认的问题

| # | 问题 | 为什么需要 | 状态 |
|---|---|---|---|
| 1 | **第三方小游戏怎么注册进邀请列表**？我们照 `static/game/games/<id>/` + `templates/<id>_demo.html` 放文件就够，还是需要后端加一条路由与邀请配置？ | **这是接入的唯一硬阻塞**：`gameType` 必须在你们的 `registrations` 里，否则我们 `factory({gameType})` **当场抛 `game_unregistered`** | ⏳ **等你们** |
| 2 | `neko-minigame-manifest.schema.json` 的**版本与必填字段**：我们按发行版那份 schema（15.8 KB）写就行吗？ | 契约写错会在握手阶段直接失败 | ✅ 我们已按发行版 schema 核出必填 3 项（§3.6.3），**请确认** |
| 3 | **页面被打开时**：`lanlan_name` / `session_id` 之外还有哪些 query / 运行时配置元素是我们应该读的？`#<id>-runtime-config` 这个约定是我们自己起名，还是宿主会注入？ | 决定我们初始化代码怎么写 | ⏳ 等你们 |
| 4 | `Capabilities` 里 avatar / audio / vision 是**必需还是可选**？我们想先接最小集（状态发布 + 对话 + 记忆），形象/语音后接 | 决定首版范围 | ⏳ 等你们 |
| 5 | `MemorySubmission` / `MemoryConsentState` 的**同意流程与保留策略** | 用户要求"关键信息长期暴露"，需要知道保留边界 | ⏳ 等你们 |
| 6 | `neko-minigame-same-origin-bootstrap.js` 的**适用场景与用法**（我们会被嵌在同源 iframe 里吗） | 决定引入方式（我们已按同源页面理解，见 §3.6.1）| ⏳ 等你们 |
| 7 | "小游戏生命周期与清理合同"的**具体检查项**，以及 `tests/frontend/` 里 SDK 集成测试**能不能我们自跑** | 我们想复用你们的测试来自证合规 | ⏳ 等你们 |
| 8 | 鉴权：host 与游戏页之间是否需要 token？（我们有两种部署：被 N.E.K.O 打开 / 玩家自己开浏览器） | 安全边界 | ⏳ 等你们 |

---

## 9. 我们这边的约定（可用于对齐）

- **游戏版本号**：跟随 `CHANGELOG.md`；接入相关改动会写明"接入"。
- **只读接口的 schema 版本**：从 `1` 起，字段只增不删（删则 bump）。
- **日志格式**：`{ t, kind, text, data }`，`kind` 用固定枚举：
  **`crunch` / `buy` / `milestone` / `quantum` / `system`**。
  ✅ **本轮已实现**：`pushLog` 现在带 `kind` 与可选 `data`
  （`kind` 由日志文本的前缀**推导**，判据集中在 `src/neko.js` 的 `KIND_RULES`）。
  - 日志**不被任何重置清空**（游戏内既有约定）⇒ 适合做"长期暴露"的数据源。
  - 环形缓冲 `LOG_MAX = 60`；快照里给最近 40 条。
- **任何自动化都不得绕过扣款**，并且我们会为每条白名单动作写断言（这是我们项目对"机制"的硬要求）。
- **没有宿主时必须完整可玩**（因为我们要能部署成纯静态站）✓ 已断言。

---

## 10. 附：用户最初的好感度设计原文（保留原样，便于对照）

> 此阶段neko/猫猫/猫娘（之后会接入project N.E.K.O.的sdk，后者能通过梦想系统帮助用户主动完成自动化，同时不占用现有自动化升级。换言之就是不消耗梦想点的同时替用户自动化本没有解锁的该阶段及其之前的自动化）有一条独特的好感度系统（初始0，+-100分化，但正值可以超过100）（同时若接入sdk这段数据由猫娘自己控制。）。好感度系统在大于25/50/75的时候会使全局加成^1.002/^1.005/^1.015，反之并不会影响游戏进程。
> 好感度系统有一些道具，免费的猫条，需要当前所有物质购买的棒棒糖与所有zpe换取的猫爪。每5分钟好感度系统不会波动大于等于8点，若接入sdk则不会大于等于16点
> 同时会在左侧的主控台多一个标签页，内有接入sdk的基本聊天和对方反馈。先搞这么多
> 在永恒阶段后用户会继续补充，但日志系统在此阶段后会暴露给sdk让neko读取，之后不再被任何重置重置。
> 若没有接入则保持原状

### 10.1 我们对原文的**偏离/补充**记录（诚实清单）

| 原文 | 我们的处理 | 原因 |
|---|---|---|
| 「道具」未说给多少好感度 | 补 `+1 / +3 / +5` | 不补就没法实现；已在代码注释显式标注 ✓ |
| 「所有 zpe 换取猫爪」未说是否清零 | 实现成**清零** | "换取"= 交换出去 ✓ |
| 原文自标的套利风险（"重置前买等于免费；ZPE 会自己长回来"）| **本轮不处理**（用户裁定"先按目前要求做，不管平衡性"）| 由 §7 的 8 点窗口天然兜住一部分；真要处理应改窗口上限，而不是道具 ✗ |
| 「左侧的主控台多一个标签页」 | 实现为**主控台的悬浮子页**（与"梦想（自动化）"并列）| 用户后续裁定：「neko 页面与梦想页面应归属主控台的子页面（类似虚空科技下的子页面表现形式）」✓ |
| 「接入 sdk 的**基本聊天**和对方反馈」 | **UI 位置已留**（右列对话卡 + 接入状态卡），逻辑待接 | 聊天要走 `client.dialogue`，需要先完成握手（§8 问题 1）⏳ |
