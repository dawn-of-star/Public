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

import { BASE, DE_MILESTONES } from "./config.js";
import {
  advance, breakInfinity, buyDeUpgrade, buyDreamUpgrade, buyRepeatable,
  buyTrap, buyVoidUpgrade, doBigCrunch, doClick, tick,
} from "./engine.js";
import { clear as clearSave, load, save } from "./save.js";
import { newState, pushLog } from "./state.js";
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
    const capped = Math.min(loaded.offlineSeconds, BASE.offlineCapSeconds);
    advance(state, capped);
    offlineReport = { seconds: capped, capped: loaded.offlineSeconds > BASE.offlineCapSeconds };
  }
  pushLog(state, "检测到历史存档，数据已恢复");
}

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
  },
};

// ══════════════════════════════════════════════════════════
// 主循环
// ══════════════════════════════════════════════════════════

let lastFrame = performance.now();
let lastRender = 0;
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
  lastFrame = nowMs;

  if (dt > 0) {
    try {
      tick(state, dt);
      state.playTimeMs += dt * 1000;
    } catch (err) {
      reportRuntimeError(err, "tick");
    }

    autosaveAccum += dt;
    if (autosaveAccum >= AUTOSAVE_SECONDS) {
      autosaveAccum = 0;
      try { save(state); } catch { /* 存档失败不该影响游戏 */ }
    }
  }

  // ── 节流渲染 ──
  if (nowMs - lastRender >= RENDER_INTERVAL_MS) {
    lastRender = nowMs;
    try {
      render(state);
    } catch (err) {
      reportRuntimeError(err, "render");
    }
  }

  // ★ 这一行必须在 try 之外，否则异常会让循环停住
  requestAnimationFrame(frame);
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

if (offlineReport) showOfflineBanner(offlineReport.seconds, offlineReport.capped);

window.addEventListener("beforeunload", () => save(state));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") save(state);
});

// 控制台调试入口
window.__game = {
  get state() { return state; },
  tick, advance, doClick,
  buyRepeatable, buyTrap, buyVoidUpgrade, buyDeUpgrade, buyDreamUpgrade,
  save: () => save(state),
  // ★ 返回的是**存档 JSON 原文**（可直接粘贴）。
  //   原来写的是 JSON.stringify(localStorage.getItem(...)) —— 那是把 JSON
  //   再包一层引号（双重编码），控制台里复制出来根本没法用。
  export: () => { save(state); return localStorage.getItem(BASE.saveKey) ?? ""; },
  reset: () => { clearSave(); state = newState(); render(state); },
};

console.log(
  "%c[宇宙起源 v0.4]%c 控制台可用 window.__game 调试（.state / .advance(秒) / .reset()）",
  "color:#2fa6f7;font-weight:bold", "color:#757575",
);
