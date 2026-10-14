import { quantumToIPGain } from "./config.js";
import { buyVoidUpgrade } from "./engine.js";   // ★ 自动补（删铸币的连带损伤 ✓）
import { buyTrap } from "./engine.js";   // ★ 自动补（删铸币的连带损伤 ✓）
import { doClick } from "./engine.js";   // ★ 自动补（删铸币的连带损伤 ✓）
/**
 * main.js —— 装配 + 主循环
 *
 * 这一层只做三件事：
 *   1. 把 state / engine / ui / save 接起来
 *   2. 跑 requestAnimationFrame 循环
 *   3. 处理离线结算和自动存档
 *
 * 主循环用 requestAnimationFrame 而不是 setInterval：
 * SPEC §5.1 —— 推进靠「真实经过了多少秒」，不靠定时器精度。
 * 掉帧、切后台、断点调试都不会让产出失真。
 */

import { BASE, DE_MILESTONES, qOf, quantumZpeMultBonus, ETERNITY, eternityPointGain, tierMilestonesDone, COLLAPSE, crunchThreshold, CRUNCH_AT_LABEL,
  // ★★★ 2025（`docs/NEKO.md` §7）：好感度的**唯一写入点** + 窗口额度常量
  addNekoAffinity, NEKO, useNekoItem,
  // ★★★ 2025（`docs/NEKO.md` §6）：动作白名单的清单 + 限流上限
  NEKO_ACTIONS, NEKO_MAX_ACTIONS_PER_TICK,
  // ★ 2025：`has*` 探针要用的 id 表（**白名单不自己抄一份** ✓）
  REPEATABLE, VOID_UPGRADES, DE_UPGRADES, INFINITY_UPGRADES,
  // ★★★ 2025：离线时间上限的**唯一入口** —— 基础 4h + 「离线时长扩展」等级 × 1h ✓
  //   （原来这里直接读 `BASE.offlineCapSeconds`，两处各读一次 ⇒ 加了升级必然不一致 ✗）
  offlineCapSeconds } from "./config.js";
import {
  advance, breakInfinity, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade, buyIpDoubleMax, buyRepeatable, affordableCount, zpeEngineAffordable, tick,
  // ★★★ 2025：永恒升级「永恒增幅」（第三层设计稿 33~35 行）
  buyEpMult,
  // ★★ 2025 修复：这四个**被 handlers 调用却从未 import** ⇒ 每次点击都抛
  //   `ReferenceError: xxx is not defined`，表现就是「点了没反应」✗
  //   （用户报：「点大坍缩和购买 zpe 引擎目前无效」）
  //   根因：主循环侧的 import 不在任何自检的覆盖范围内 ——
  //     `node --check` 只查语法、查不出未定义标识符；而 `dom-smoke` 原来的
  //     `addEventListener` 是空函数 ⇒ 点了什么也不会发生，这类 bug **测不出来** ✗
  //   ⇒ 现在 dom-smoke 会真的派发 click（见那里的 `click()`）并断言状态变化 ✓
  doBigCrunch, doEternity, unlockZpeEngine, buyZpeEngineLevel,
  // ★★★ 2026：获取暗物质（消耗永恒点）
  buyDarkMatter } from "./engine.js";
// ★★★ 2025（`docs/NEKO.md` §5）：状态快照要**现算**速率与乘区 ——
//   必须走引擎/公式的**既有函数**（快照里绝不重算公式 ⇒ 不会与实发脱节 ✓）
import { entropyRate, matterRate, particleRate, globalMultiplierParts } from "./formulas.js";
import { clear as clearSave, load, save } from "./save.js";
import { newState, pushLog, setLogSink } from "./state.js";
// ★★★ 2025（`docs/NEKO.md`）：N.E.K.O 接入层（**无宿主时全部 no-op** ✓）
//   `dispatchNekoActions` = §6 动作白名单的派发器（三条约束都实现在 `neko.js` 里）
import { createNekoBridge, dispatchNekoActions } from "./neko.js";
// ★★★ 2025：**性能监视器**（用户报「数字跳动速率及其低下」⇒ 装仪表而不是猜）
import { perfFrame, perfOn, perfSummary, perfToggle, perfFrames, perfSections } from "./perf.js";
// ★★★ 2025：**真实 DOM 写入计数** + **构建标记**（区分"代码 bug"与"浏览器旧缓存"）
import { domWriteStats, domResetStats, UI_BUILD } from "./ui.js";
import { flashSave, initUI, render, showOfflineBanner } from "./ui.js";

const AUTOSAVE_SECONDS = 15;

// ══════════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════════

let state = newState();
let offlineReport = null;

const loaded = load();
if (loaded) {
  state = loaded.state;
  if (loaded.offlineSeconds > 5) {
    // ★★★ 2025：上限走**唯一入口** `offlineCapSeconds(state)` ✓
    //   它 = 基础 4 小时 + 已买的「离线时长扩展」等级 × 1 小时
    //   ⚠️ 原来这里**两处各自**读 `BASE.offlineCapSeconds` ⇒ 加了升级后
    //      "结算用的上限"与"提示是否被截断用的上限"会不一致 ✗
    //      （正是本项目反复出现的"同一件事两条路"）
    const cap = offlineCapSeconds(state);
    const capped = Math.min(loaded.offlineSeconds, cap);
    advance(state, capped);
    offlineReport = { seconds: capped, capped: loaded.offlineSeconds > cap, cap };
  }
  pushLog(state, "检测到历史存档，数据已恢复");
}

// ══════════════════════════════════════════════════════════
// ★★★ 2025：N.E.K.O 接入层（`docs/NEKO.md`）—— **无宿主版本**
// ══════════════════════════════════════════════════════════
// 纪律（用户裁定「先做无宿主版本」）：**没有宿主时一切 no-op**，
//   游戏主流程一行都不因为它而改变 ✓
//   三件事：① 日志出口挂到桥上 ② 探测宿主并连接（连不上就静默）③ 定期推状态快照
// ⚠️ 顺序要紧：`nekoBridgeLastPhase` **必须先声明**（`onStatus` 闭包里会读写它，
//   而且 `connect()` 可能在造桥后**同步**触发一次 onStatus ⇒ 声明在后会 TDZ 报错 ✗）
let nekoBridgeLastPhase = null;
/**
 * ★★★ 2025（`docs/NEKO.md` §6）：动作派发用的**引擎函数集合**（注入给 `neko.js`）。
 *
 * ⚠️ 为什么用注入而不是让 `neko.js` 直接 import engine：
 *   ① `neko.js` 的定位是**零依赖接入层**（也避免循环依赖 ✗）
 *   ② 这样"白名单里有哪些动作"**一眼可见**（就在下面这张表里），
 *      而 id 合法性问 `has*` 探针（**不在这里抄 id 表** ⇒ 不会与 config 脱节）✓
 * ⚠️ 约束②（只走既有购买函数）：下面每一个 `fn` 都是 **engine 的导出**，零自写扣款 ✓
 */
const nekoActionApi = {
  maxPerTick: NEKO_MAX_ACTIONS_PER_TICK,
  hasRepeatable: (id) => id in REPEATABLE,
  hasVoid: (id) => id in VOID_UPGRADES,
  hasDe: (id) => id in DE_UPGRADES,
  hasInfinity: (id) => id in INFINITY_UPGRADES,
  buyRepeatable,
  buyVoidUpgrade,
  buyDeUpgrade,
  buyInfinityUpgrade,
  doBigCrunch,
  doEternity,
};

const nekoBridge = createNekoBridge({
  getState: () => state,
  onStatus: (phase, detail) => {
    // 只在**状态真的变了**时写日志，避免每帧刷屏（宿主探测每帧都会跑）
    if (phase === nekoBridgeLastPhase) return;
    nekoBridgeLastPhase = phase;
    if (phase === "host-ready-but-unregistered") {
      pushLog(state, "🐍 检测到 N.E.K.O 宿主，但本游戏**尚未注册** ⇒ 暂不连接（见 docs/NEKO.md §8）");
    } else if (phase === "error") {
      pushLog(state, `🐍 N.E.K.O 接入错误：${detail?.message ?? String(detail)}`);
    }
  },
});
// ① 把**全部** `pushLog` 自动导向宿主（无宿主 ⇒ 桥内部直接丢弃 ✓）
setLogSink((entry) => nekoBridge.sendLog(entry));
// ② 探测（不阻塞：失败就是"没有宿主"，正常单机玩）
nekoBridge.connect();
// ③ 快照节流推送（无宿主 ⇒ no-op；有宿主 ⇒ 每 5 秒一份）
let nekoSnapshotAccum = 0;
const NEKO_SNAPSHOT_SECONDS = 5;

// ══════════════════════════════════════════════════════════
// 动作
// ══════════════════════════════════════════════════════════

function afterAction() {
  render(state);
}

const handlers = {
  onClick() {
    doClick(state);
    afterAction();
  },
  /** @param {boolean} max 是否一次买满（闭式解） */
  onBuyRepeatable(id, max) {
    buyRepeatable(state, id, !!max);
    afterAction();
  },
  /** ★ 2025：① 无限增幅「买满」（分段闭式；与升级中心的买满同一套路） */
  onBuyIpDoubleMax() {
    if (buyIpDoubleMax(state) > 0) {
      save(state);
      afterAction();
    }
  },
  /**
   * ★★★ 2025 新实现（第三层设计稿 33~35 行）：永恒升级「永恒增幅」。
   * @param {boolean} max true = 买满（闭式反解），false = 买一级
   */
  onBuyEpMult(max) {
    if (buyEpMult(state, max === true ? null : 1) > 0) {
      save(state);
      afterAction();
    }
  },
  /**
   * ★★★ 2026（用户 2026 重写的规则）：**获取暗物质**（消耗永恒点）。
   *
   * 落点是暗能量倍率的加法区（`darkEnergyMultiplier` 里的 `darkMatterAdditiveTerm`）——
   * 所以这里只负责买 + 存档 + 重绘；**效果由引擎侧同一函数给出**（显示 == 实发）✓
   * @param {boolean} max true = 买满（逐级真价之和），false = 买一个
   */
  onBuyDarkMatter(max) {
    if (buyDarkMatter(state, max === true ? null : 1) > 0) {
      save(state);
      afterAction();
    }
  },
  /**
   * ★★★ 2025（`docs/NEKO.md` §10）：**使用一个好感度道具**（猫条 / 棒棒糖 / 猫爪）。
   *
   * 走 `useNekoItem`（**唯一入口**）—— 扣款与好感度写入都在那里，这里只负责存档+重绘 ✓
   * ⚠️ 它取代了原来的 `onNekoTest`（那对 ±8 调试按钮）——
   *   道具实装后调试按钮已删除（它们是"没有道具时的可见性补丁"）✓
   */
  onUseNekoItem(id) {
    const r = useNekoItem(state, id);
    if (r.ok) {
      pushLog(state, `🐍 用了「${id}」，好感度 +${r.gain}（现 ${Number(state.nekoAffinity)}）`);
      save(state);
      afterAction();
    } else if (r.reason) {
      pushLog(state, `🐍 用不了「${id}」：${r.reason}`);
      afterAction();
    }
  },
  /** @param {boolean} max 右键或买满 */
  onBuyTrap(max) {
    buyTrap(state, max === true);
    afterAction();
  },
  onBuyVoid(id) {
    if (buyVoidUpgrade(state, id)) save(state);
    afterAction();
  },
  /** @param {boolean} max 连续购买直到买不起 */
  onBuyDe(id, max) {
    if (max) {
      let n = 0;
      while (n < 500 && buyDeUpgrade(state, id)) n++;
      if (n > 0) save(state);
    } else if (buyDeUpgrade(state, id)) {
      save(state);
    }
    afterAction();
  },
  onUnlockTransmuter() {
    const gate = DE_MILESTONES.find((m) => m.id === "dm0")?.gate;
    if (!gate) return;
    const hasVoidOk = !gate.voidUpgrade || state.voidUpgrades[gate.voidUpgrade];
    const matterOk = !gate.matter || state.resources.matter.gte(gate.matter);
    if (!hasVoidOk || !matterOk) return;
    // 复刻原稿的手动按钮：解锁 + 记 dm0
    state.deMilestones.dm0 = true;
    state.phaseTransmuterUnlocked = true;
    pushLog(state, "🌌 相变仪已解锁！暗能量工程开始运作");
    save(state);
    afterAction();
  },

  // ── 第四层：量子 / 大坍缩 ──
  // ★ `onCollapse` 已删除 —— 「临界坍缩」体系整个移除（暗物质不应存在）。
  //   第三层现在是**量子涨落**：ZPE 到门槛自动捕获，不需要按钮。
  /** 大坍缩：打破无限后**手动**触发；未打破时由 tick 强制触发 */
  onBigCrunch() {
    if (!state.brokenInfinity) return;
    if (doBigCrunch(state)) {
      save(state);
      afterAction();
    }
  },
  onBreakInfinity() {
    if (breakInfinity(state)) {
      save(state);
      afterAction();
    }
  },
  onBuyDream(id) {
    if (buyDreamUpgrade(state, id)) {
      save(state);
      afterAction();
    }
  },
  /** @param {string} id 无限升级 id（∞ 层，用无限点购买） */
  onBuyInfinity(id) {
    if (buyInfinityUpgrade(state, id).ok) {
      save(state);
      afterAction();
    }
  },
  /** 永恒：手动触发（门槛 = 无限点 1e308.25，见 `ETERNITY.goalLog10`） */
  onEternity() {
    if (doEternity(state)) {
      save(state);
      afterAction();
    }
  },
  /** ZPE 引擎：解锁（条件 = **1 次大坍缩**，里程碑奖励、不花无限点、送 1 级） */
  onUnlockZpeEngine() {
    if (unlockZpeEngine(state)) {
      save(state);
      afterAction();
    }
  },
  /** ZPE 引擎：买等级（max = 买满） */
  onBuyZpeEngine(max) {
    if (buyZpeEngineLevel(state, max) > 0) {
      save(state);
      afterAction();
    }
  },
  onSave() {
    save(state);
    flashSave();
  },
  onExport() {
    // ★ 先把当前状态写进 localStorage 再取 —— 否则导出的是「上一次自动存档」
    //   的内容（最多差 15 秒），而且刚开局还没存过档时会导出一个空的 "{}"。
    save(state);
    const json = localStorage.getItem(BASE.saveKey) ?? "";
    if (!json) {
      pushLog(state, "⚠️ 没有可导出的存档");
      afterAction();
      return;
    }
    navigator.clipboard?.writeText(json).then(
      () => pushLog(state, "📋 存档已复制到剪贴板"),
      () => pushLog(state, "⚠️ 复制失败，请手动从控制台取 window.__game.export()"),
    );
    afterAction();
  },
  onReset() {
    if (!confirm("确定要重置宇宙吗？所有进度都会消失。")) return;
    clearSave();
    state = newState();
    pushLog(state, "☢️ 宇宙已重置");
    afterAction();
  } };

// ══════════════════════════════════════════════════════════
// 主循环
// ══════════════════════════════════════════════════════════

let lastFrame = performance.now();
let lastRender = 0;
/** ★ 2025：上一帧的**真实**时间戳（与节流的 lastRender 不同 —— 它每帧都更新） */
let lastFrameReal = 0;
let autosaveAccum = 0;
let errorCount = 0;
let lastErrorKey = "";
let lastErrorAt = 0;

/**
 * 报错但**不停机**。
 *
 * ⚠️ 这是硬性要求，不是可选项。
 * 如果 render() 抛异常而没被捕获，`requestAnimationFrame(frame)` 那一行
 * 永远不会执行 —— 循环就永久停住了，页面看着有内容但完全不动。
 * （真实踩过的坑：ui.js 里写了一个已经被删掉的 id，第一帧就抛 TypeError。）
 */
function reportRuntimeError(err, phase) {
  const key = `${phase}:${err?.message ?? err}`;
  const now = performance.now();
  // 同一种错误 3 秒内只报一次，避免刷屏
  if (key === lastErrorKey && now - lastErrorAt < 3000) return;
  lastErrorKey = key;
  lastErrorAt = now;
  errorCount++;

  console.error(`[${phase}] 第 ${errorCount} 次异常：`, err);

  const box = document.getElementById("fatal");
  if (box) {
    box.style.display = "block";
    box.textContent =
      `运行时异常（${phase}）：\n${err?.stack ?? err}\n\n` +
      `游戏循环**仍在运行**，但这个错误会反复出现。\n` +
      `累计 ${errorCount} 次。把上面这段发给我就能定位。`;
  }
}

// ══════════════════════════════════════════════════════════
// 主循环
// ══════════════════════════════════════════════════════════

/**
 * 渲染节流。
 *
 * 逻辑按 rAF 跑（约 60fps），但 **DOM 不跟着跑** —— 一个增量游戏里
 * 绝大多数数字每秒才变一次，60fps 重写 79 个元素纯属浪费。
 * 20fps 肉眼看不出差别，但 DOM 写入量降到 1/3。
 */
const RENDER_INTERVAL_MS = 50;

function frame(nowMs) {
  // 帧间隔上限 1 秒：标签页切后台回来时不要一次性补太多
  const dt = Math.min((nowMs - lastFrame) / 1000, 1);
  const frameGap = nowMs - lastFrameReal;      // ★ 真实帧间隔（性能监视器用）
  lastFrameReal = nowMs;
  lastFrame = nowMs;

  let tickMs = 0, renderMs = 0;

  if (dt > 0) {
    const t0 = performance.now();
    try {
      tick(state, dt);
      state.playTimeMs += dt * 1000;
    } catch (err) {
      reportRuntimeError(err, "tick");
    }
    tickMs = performance.now() - t0;

    autosaveAccum += dt;
    if (autosaveAccum >= AUTOSAVE_SECONDS) {
      autosaveAccum = 0;
      try { save(state); } catch { /* 存档失败不该影响游戏 */ }
    }

    // ★ ③ 状态快照：节流推给宿主（**无宿主时是 no-op** ✓）
    //   节奏与存档同族（都按秒累计）⇒ 不引入新的时间源 ✓
    nekoSnapshotAccum += dt;
    if (nekoSnapshotAccum >= NEKO_SNAPSHOT_SECONDS) {
      nekoSnapshotAccum = 0;
      try {
        // 速率/乘区/档位里程碑由**引擎既有函数**现算后注入 ⇒ 快照不重算公式 ✓
        state.__nekoRates = {
          entropy: entropyRate(state),
          particle: particleRate(state),
          matter: matterRate(state),
        };
        state.__nekoMultipliers = globalMultiplierParts(state);
        state.__nekoTierMilestones = tierMilestonesDone(state).map((m) => m.id ?? m.at);
        nekoBridge.publishSnapshot();
      } catch { /* 快照失败不影响游戏 */ }
    }
  }

  // ── 节流渲染 ──
  if (nowMs - lastRender >= RENDER_INTERVAL_MS) {
    lastRender = nowMs;
    const t0 = performance.now();
    // ★ 每帧把写入计数清零 —— HUD 显示的就是"**上一帧**真实碰了几次 DOM" ✓
    if (perfOn()) domResetStats();
    try {
      render(state);
    } catch (err) {
      reportRuntimeError(err, "render");
    }
    renderMs = performance.now() - t0;
  }

  // ★ 性能监视器：关闭时 `perfFrame` 立刻返回 ⇒ 开销 ≈ 0 ✓
  perfFrame({ frameMs: frameGap, dtMs: dt * 1000, tickMs, renderMs });
  if (perfOn()) perfDraw();

  // ★ 这一行必须在 try 之外，否则异常会让循环停住
  requestAnimationFrame(frame);
}

/**
 * ★★★ 2025：性能监视器的**绘制**（右上角一块小面板；只在打开时跑）。
 *
 * ⚠️⚠️ 原来"每 20 帧才更新一次文字"—— 那个想法在 **6fps** 下是**灾难性的误导**：
 *   20 帧 = **3 秒** ⇒ 用户截图时看到的可能是好几秒前的旧文本，
 *   于是"我加的行没出现"被误判成"跑的是旧代码" ✗（我为此浪费了好几轮）
 * ⇒ 改成**每帧都刷**（1 个元素的 textContent，代价可忽略；
 *   而且它已经在 `perfOn()` 分支里 ⇒ 关掉监视器时完全不跑）✓
 */
function perfDraw() {
  const el = document.getElementById("perf-hud");
  if (!el) return;
  el.hidden = false;
  const s = perfSummary();
  if (!s) { el.textContent = "性能监视（采样中…）"; return; }
  const f = (v) => v.toFixed(1);
  // ★★★ 2025：**分段表 + 真实写入数 + 构建标记** ——
  //   用户连续两轮 FAQ"HUD 没变" ⇒ 无法区分"代码 bug"与"浏览器旧缓存" ✗
  //   ⇒ 把构建标记打在 HUD 上，一眼可辨 ✓
  const secs = perfSections();
  const secTxt = secs.length
    ? "\n── render 分段（累计 / max）──\n" +
      secs.slice(0, 7).map((r) => `${r.label}  ${r.ms.toFixed(0)}ms / ${r.max.toFixed(0)}ms`).join("\n")
    : "\n（分段表为空 —— 说明跑的**不是**最新 ui.js）";
  el.textContent =
    `[${UI_BUILD}]\n` +
    `FPS ${f(s.fps)}（间隔 ${f(s.frameAvg)}ms，p95 ${f(s.frameP95)}ms）\n` +
    `tick ${f(s.tickAvg)}ms（max ${f(s.tickMax)}）\n` +
    `render ${f(s.renderAvg)}ms（p95 ${f(s.renderP95)}，max ${f(s.renderMax)}）\n` +
    `我们的占用 ${f(s.busyAvg)}ms/帧\n` +
    `真实 DOM 写入 ${domWriteStats.text + domWriteStats.html + domWriteStats.cls + domWriteStats.bool}` +
    `（text ${domWriteStats.text} / html ${domWriteStats.html} / cls ${domWriteStats.cls} / bool ${domWriteStats.bool}）\n` +
    `被去重拦掉 ${domWriteStats.skipped}\n` +
    (s.browserSide
      ? "⇒ 瓶颈在**浏览器侧**（样式重算/布局/绘制）"
      : "⇒ 瓶颈在**我们的 JS**（tick/render）") +
    `\n样本 ${s.n} 帧` +
    secTxt;
}

// ══════════════════════════════════════════════════════════
// 起跑
// ══════════════════════════════════════════════════════════

initUI(handlers);

// 首次渲染也要防：它抛异常的话整个模块就挂了，画面完全不动
try {
  render(state);
} catch (err) {
  reportRuntimeError(err, "首次渲染");
}

requestAnimationFrame(frame);

if (offlineReport) showOfflineBanner(offlineReport.seconds, offlineReport.capped, offlineReport.cap);

window.addEventListener("beforeunload", () => save(state));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") save(state);
});

/**
 * ★★★ 2025：`F8` = 性能监视器开关（用户在 Edge 上跑，`performance.now()` 通用 ✓）
 * ⚠️ 用 `F8` 而不是 `F12`（那是开发者工具，浏览器会吃掉）；也不与游戏内的空格冲突 ✓
 */
document.addEventListener("keydown", (e) => {
  if (e.code === "F8") {
    e.preventDefault();
    const on = perfToggle();
    const hud = document.getElementById("perf-hud");
    if (hud) hud.hidden = !on;
  }
});

// 控制台调试入口
window.__game = {
  get state() { return state; },
  tick, advance, doClick,
  buyRepeatable, buyTrap, buyVoidUpgrade, buyDeUpgrade, buyDreamUpgrade, buyInfinityUpgrade,
  save: () => save(state),
  // ★ 返回的是**存档 JSON 原文**（可直接粘贴）。
  //   原来写的是 JSON.stringify(localStorage.getItem(...)) —— 那是把 JSON
  //   再包一层引号（双重编码），控制台里复制出来根本没法用。
  export: () => { save(state); return localStorage.getItem(BASE.saveKey) ?? ""; },
  reset: () => { clearSave(); state = newState(); render(state); },
  /**
   * ★★★ 2025（`docs/NEKO.md` §6）：**动作白名单的手动验证入口**。
   *
   * 为什么需要它：`controls.on` 那条路要**有宿主**才会触发，而我们现在是纯单机
   *   ⇒ 派发器写完**无法验证** ⇒ 就会变成"写了但没人知道对不对"✗
   *   （用户原则：「没有 ui 真的很容易误判」的同族问题：**没有调用方 = 无法验证**）
   * ⇒ 在控制台里可以手动喂一批动作，与宿主下发**走完全同一条路** ✓
   *   用法：`__game.nekoActions([{type:"buyRepeatable",payload:{id:"m1",max:true}}])`
   */
  nekoActions: (batch) => {
    const r = dispatchNekoActions(state, batch, nekoActionApi);
    render(state);
    return r;
  },
  /** 白名单清单（给控制台/文档看） */
  nekoActionList: () => Object.keys(NEKO_ACTIONS),
  /** ★ 2025：**性能监视器**（`__game.perf(true)` 打开 / `__game.perf()` 切换 / `F8`） */
  perf: (force) => {
    const on = perfToggle(force);
    const hud = document.getElementById("perf-hud");
    if (hud) hud.hidden = !on;      // 关掉时立刻藏起来（否则留着最后一帧的数字）
    return on;
  },
  perfSummary,
  perfFrames,
};

console.log(
  // 版本号由 index.html 的内联脚本从 package.json 读出后广播到 window（见那里的注释）。
  // 它是异步取的，极端情况下可能还没到 —— 那就退化成不带版本号的横幅，不影响调试。
  `%c[空想增量${window.__APP_VERSION ? " v" + window.__APP_VERSION : ""}]%c 控制台可用 window.__game 调试（.state / .advance(秒) / .reset()）`,
  "color:#2fa6f7;font-weight:bold", "color:#757575",
);
