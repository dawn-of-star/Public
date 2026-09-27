/**
 * ui.js —— 所有 DOM 操作
 *
 * 这是分层架构里唯一碰 DOM 的地方（原稿的 55 处 getElementById 散在 engine.js 里）。
 * 好处：formulas.js 保持纯函数，能在 Node 里跑无头测试。
 *
 * 列表类 UI（虚空升级、两种里程碑、暗能量升级）全部**从 config.js 生成**，
 * 不写死在 HTML 里 —— 改数值只需要改 config。
 */

import Decimal from "../dist/break_eternity.esm.js";
import {
  BASE, BREAK_INFINITY, COLLAPSE, DE_MILESTONES, DE_UPGRADES, QUANTUM,
  REPEATABLE, VOID_UPGRADES, ZONES, ZONE_OF, ZPE_MILESTONES,
  CRUNCH_AT_LABEL, DREAM_UPGRADES, crunchThreshold, quantumDeGainBonus, quantumDeMultBonus,
  quantumEntropyMultiplier, quantumGrowthRate, quantumZpeRequirement, zoneOf,
} from "./config.js";
import {
  bigCrunchGain, canBigCrunch, collapseUnlocked, conversion, darkEnergyMultiplier,
  darkEnergyRate, dreamCoefficient,
  effectiveTraps, effectiveZpeMultiplierForPrice, entropyRate, globalAddTerm,
  globalMultiplier, isAutoAcquire, matterRate, particleRate, repeatableCost, trapCost,
  voidUpgradeCost, zpeBaseMultiplier, zpeMultiplier, zpeProductionPenalty, zpeRate,
  deUpgradeCost,
} from "./formulas.js";
import { deLevelOf, levelOf } from "./state.js";
import { affordableCount } from "./engine.js";

/** 给元素加上乘区颜色 class，并附带一条 <span class="zone-tag"> */
function applyZone(el, id, showTag = true) {
  const z = zoneOf(id);
  const key = ZONE_OF[id];
  el.classList.add("zone", `zone-${key}`);
  if (showTag) {
    const tag = document.createElement("span");
    tag.className = "zone-tag";
    tag.textContent = z.cn;
    const row = el.querySelector(".btn-row");
    if (row) row.appendChild(tag);
  }
}

// ══════════════════════════════════════════════════════════
// 数字格式化
// ══════════════════════════════════════════════════════════

const fmtCache = new Map();

/** 大数格式化：1000 以下保留小数，之后走科学计数，layer >= 2 用 e 的 e */
export function fmt(value, places = 2) {
  let d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) return d.sign > 0 ? "∞" : "-∞";
  if (d.sign < 0) return "-" + fmt(d.neg(), places);
  if (d.eq(0)) return "0";

  if (d.lt(1000)) {
    const n = d.toNumber();
    const s = n.toFixed(places);
    return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  }
  if (d.lt(1e6)) return d.toNumber().toFixed(0);

  const e = d.log10();
  const layer = d.layer ?? 0;
  if (layer >= 2 || e.gte(1e6)) return `e${fmt(e, places)}`;

  const exp = Math.floor(e.toNumber());
  const mant = d.div(Decimal.pow(10, exp)).toNumber();
  return `${mant.toFixed(places)}e${exp}`;
}

/** 倍率格式化 */
export function fmtMult(value) {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (d.lt(1000)) return `×${d.toNumber().toFixed(2)}`;
  return `×${fmt(d, 2)}`;
}

/** 时长格式化 */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

const $ = (id) => document.getElementById(id);
const el = {};

/**
 * textContent 的原生访问器。
 * 在 Node 环境下（tools/dom-smoke.mjs）没有 Node 全局，所以允许为 null。
 */
const TEXT_DESC = typeof Node !== "undefined" && Node.prototype
  ? Object.getOwnPropertyDescriptor(Node.prototype, "textContent")
  : null;

/**
 * 拦截重复的 textContent 写入。
 *
 * 为什么值得：给 textContent 赋值会标记节点 dirty，触发样式重算 + 布局。
 * 增量游戏里大部分数字每秒才变一次，20fps 下约 95% 的写入是白写的。
 *
 * ⚠️ 这里**必须用 defineProperty，不能用 Proxy**。
 *    Proxy 的问题：`proxy.appendChild(x)` 时 `this` 是 Proxy 而不是真实节点，
 *    而原生 DOM 方法要求 `this` 是真元素 —— 浏览器会抛
 *    `TypeError: Illegal invocation`。
 *    （踩过这个坑。defineProperty 直接改元素自身的属性，不碰 this。）
 */
function wrapEl(node) {
  if (!node || !TEXT_DESC) return node;
  let last;
  Object.defineProperty(node, "textContent", {
    configurable: true,
    enumerable: true,
    get() { return TEXT_DESC.get.call(this); },
    set(v) {
      if (last === v) return;      // 值没变 -> 完全不碰 DOM
      last = v;
      TEXT_DESC.set.call(this, v);
    },
  });
  return node;
}

function cache() {
  const ids = [
    "offline-banner", "fatal", "zone-legend",
    "val-entropy", "rate-entropy", "val-particle", "rate-particle",
    "val-matter", "rate-matter", "val-dream", "val-zpe", "rate-zpe",
    "val-de", "rate-de", "global-multiplier", "global-detail",
    "btn-click", "click-gain",
    "upgrade-list", "upgrade-count",
    "btn-buy-trap", "trap-lv", "trap-cost", "trap-badge", "trap-effective", "entropy-rule",
    "d-entropy-rate", "d-particle-rate", "d-matter-rate", "d-zpe-rate",
    "d-zpe-mult", "d-zpe-prod", "d-de-mult", "d-zpe-penalty",
    "d-clicks", "d-playtime",
    "log-panel",
    "tab-tag-void", "void-count", "zpe-multiplier", "void-upgrade-list", "milestone-list",
    "de-locked", "de-content", "de-unlock-cond", "btn-unlock-transmuter",
    "de-multiplier", "de-penalty", "de-upgrade-list", "de-milestone-list",
    // ── 标签页 ──
    "tabs", "tab-void", "tab-de", "tab-quantum", "tab-infinity",
    "panel-void", "panel-de", "panel-quantum", "panel-infinity",
    "tab-tag-void", "tab-tag-de", "tab-tag-quantum", "tab-tag-infinity",
    // ── 量子（第四层，红色）──
    "q-locked", "q-content", "q-need",
    "val-quantum", "quantum-sub", "quantum-mult", "quantum-demult", "quantum-degain", "quantum-grow",
    "quantum-pairs", "quantum-next-cost", "quantum-cur-zpe",
    "quantum-bar", "quantum-bar-text",
    "dream-badge", "dream-upgrade-list",
    
    // ── 相变环（暗能量页）──
    "de-ring-wrap", "de-ring-fill", "de-ring-pct", "de-ring-rate", "de-ring-de",
    // ── 无限（金色）──
    "inf-locked", "inf-content", "inf-need",
    "val-infinity", "bigcrunch-count", "bigcrunch-need",
    "bigcrunch-gain", "btn-bigcrunch", "bigcrunch-status",
    "bigcrunch-desc", "btn-break-infinity", "break-state",
    "btn-save", "btn-export", "btn-reset",
  ];
  const missing = [];
  for (const id of ids) {
    el[id] = wrapEl($(id));
    if (!el[id]) missing.push(id);
  }
  // ★ 防再犯：这里列出的 id 都必须在 index.html 里静态存在。
  //   少一个 -> render 里 `el["x"].textContent = ...` 会抛 TypeError
  //   -> 一旦没有 try/catch 包住，rAF 循环会**永久停住**（页面看着有内容但完全不动）。
  if (missing.length) {
    console.error(
      `[ui] 这些 id 在 index.html 里找不到：${missing.join(", ")}\n` +
      "     它们会在 render() 里抛 TypeError。请检查 index.html 是否漏了元素。",
    );
  }
}

// ══════════════════════════════════════════════════════════
// 静态结构：从 config 生成
// ══════════════════════════════════════════════════════════

/** 三条可重复升级：主按钮 + 买满按钮 */
function buildUpgrades() {
  el["upgrade-list"].innerHTML = "";
  for (const cfg of Object.values(REPEATABLE)) {
    const row = document.createElement("div");
    row.className = "btn-main";
    row.innerHTML = `
      <button class="btn" id="btn-upg-${cfg.id}">
        <div class="btn-row">
          <span class="btn-name">${cfg.name}</span>
          <span class="btn-lv" id="upg-${cfg.id}-lv">Lv 0</span>
        </div>
        <div class="btn-desc" id="upg-${cfg.id}-desc"></div>
        <div class="btn-cost" id="upg-${cfg.id}-cost">—</div>
      </button>
      <button class="btn-max" id="btn-max-${cfg.id}" title="一次买满（闭式解）">
        <span class="n" id="max-${cfg.id}-n">0</span>买满
      </button>
    `;
    el["upgrade-list"].appendChild(row);
    applyZone(row.querySelector(`#btn-upg-${cfg.id}`), cfg.id);
    const mx = row.querySelector(`#btn-max-${cfg.id}`);
    mx.classList.add("zone", `zone-${ZONE_OF[cfg.id]}`);
  }
}

/** 9 个虚空升级 */
function buildVoidUpgrades() {
  el["void-upgrade-list"].innerHTML = "";
  for (const cfg of Object.values(VOID_UPGRADES)) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.id = `void-btn-${cfg.id}`;
    btn.innerHTML = `
      <div class="btn-row">
        <span class="btn-name${cfg.costDream ? " rainbow" : ""}">${cfg.name}</span>
        <span class="btn-lv" id="void-${cfg.id}-state">未购买</span>
      </div>
      <div class="btn-desc">${cfg.desc}</div>
      <div class="btn-cost" id="void-${cfg.id}-cost">—</div>
    `;
    el["void-upgrade-list"].appendChild(btn);
    applyZone(btn, cfg.id);
  }
}

/** 3 个暗能量升级 */
function buildDeUpgrades() {
  el["de-upgrade-list"].innerHTML = "";
  for (const cfg of Object.values(DE_UPGRADES)) {
    const row = document.createElement("div");
    row.className = "btn-main";
    row.innerHTML = `
      <button class="btn" id="de-btn-${cfg.id}">
        <div class="btn-row">
          <span class="btn-name${cfg.costDream ? " rainbow" : ""}">${cfg.name}</span>
          <span class="btn-lv" id="de-${cfg.id}-lv">Lv 0</span>
        </div>
        <div class="btn-desc" id="de-${cfg.id}-desc"></div>
        <div class="btn-cost" id="de-${cfg.id}-cost">—</div>
      </button>
      <button class="btn-max" id="de-max-${cfg.id}" title="连续购买直到买不起">买满</button>
    `;
    el["de-upgrade-list"].appendChild(row);
    applyZone(row.querySelector(`#de-btn-${cfg.id}`), cfg.id);
    row.querySelector(`#de-max-${cfg.id}`).classList.add("zone", `zone-${ZONE_OF[cfg.id]}`);
  }
}

/** 两种里程碑 */
function buildMilestones() {
  el["milestone-list"].innerHTML = "";
  for (const m of ZPE_MILESTONES) {
    const d = document.createElement("div");
    d.className = "ms";
    d.id = `ms-${m.id}`;
    d.innerHTML = `<span class="dot"></span><span class="txt">${m.desc}</span><span class="need" id="ms-${m.id}-need">—</span>`;
    el["milestone-list"].appendChild(d);
    applyZone(d, m.id, false);
  }
  el["de-milestone-list"].innerHTML = "";
  for (const m of DE_MILESTONES) {
    const d = document.createElement("div");
    d.className = "ms";
    d.id = `dms-${m.id}`;
    d.innerHTML = `<span class="dot"></span><span class="txt">${m.desc}</span><span class="need" id="dms-${m.id}-need">—</span>`;
    el["de-milestone-list"].appendChild(d);
    applyZone(d, m.id, false);
  }
}

/** 乘区图例 */
function buildLegend() {
  const box = el["zone-legend"];
  if (!box) return;
  box.innerHTML =
    Object.entries(ZONES)
      .map(([key, z]) => {
        // 虹色乘区（梦想加成）走渐变色块，不是单一 color
        const swatch = z.rainbow
          ? `<span class="swatch swatch-rainbow"></span>`
          : `<span class="swatch" style="--zone:${z.color}"></span>`;
        return `<span class="item zone-${key}">${swatch}${z.name}</span>`;
      })
      .join("") +
    `<span class="hint">颜色 = 作用乘区。同一颜色的升级叠在同一个位置（SPEC 判据 P7）</span>`;
}

/** 梦想点一次性升级（量子页，红色） */
function buildDreamUpgrades() {
  const box = el["dream-upgrade-list"];
  if (!box) return;
  box.innerHTML = "";
  for (const d of DREAM_UPGRADES) {
    const btn = document.createElement("button");
    btn.className = "btn zone zone-dm q-card rainbow-card";
    btn.id = `dream-btn-${d.id}`;
    btn.innerHTML = `
      <div class="btn-row">
        <span class="btn-name">${d.name}</span>
        <span class="btn-lv" id="dream-${d.id}-state">未购买</span>
      </div>
      <div class="btn-desc">${d.desc}</div>
      <div class="btn-cost" id="dream-${d.id}-cost">花费 ${d.cost} 梦想点</div>
    `;
    box.appendChild(btn);
  }
}


/** 标签页切换 */
function setupTabs() {
  const bar = el["tabs"];
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab || tab.classList.contains("locked")) return;
    activateTab(tab.dataset.tab);
  });
}

export function activateTab(name) {
  for (const t of el["tabs"].querySelectorAll(".tab")) {
    t.classList.toggle("active", t.dataset.tab === name);
  }
  for (const p of ["void", "de", "quantum", "infinity"]) {
    const panel = el[`panel-${p}`];
    if (panel) panel.hidden = p !== name;
  }
}

/**
 * 升级卡片的「当前效果」文本。
 *
 * ⚠️ **必须从公式推导，不能手写字符串。**
 *
 * 踩过的坑：`config.js` 里 `particleBoost.desc` 写的是 `×1.1^等级`（乘法），
 * 而 `formulas.js` 里的实际实现是 `globalAddTerm = 1 + 0.05×等级`（仿射）。
 * 100 级时卡片显示 ×13780，实际只有 ×6 —— 差 2000 倍。
 * 而且这个 bug 是从原稿 0.3.4 继承来的（那边 `getCurrentEffect()` 写 1.1^lv，
 * `engine.js` 用 1+lv×0.05）。
 *
 * 结论：**描述由公式算，就不会再脱节。**
 */
function effectText(state, id) {
  if (id === "particleBoost") {
    // 实际是仿射（加法）形式，不是 m^等级
    return `所有产出 ×${globalAddTerm(state).toNumber().toFixed(2)}`;
  }
  if (id === "matterBoost") {
    const lv = levelOf(state, id);
    return `物质产出 ${fmtMult(Decimal.pow(REPEATABLE.matterBoost.effect, lv))}`;
  }
  if (id === "entropyCoeff") {
    // 直接用 conversion()，和熵凝聚规则那块显示的是同一个数
    const { threshold, output } = conversion(state);
    const rate = output.div(threshold);
    return rate.gte(1)
      ? `1 熵 = ${fmt(rate)} 粒子`
      : `消耗 ${fmt(threshold)} 熵 → ${fmt(output)} 粒子`;
  }
  return "";
}

// ══════════════════════════════════════════════════════════
// 渲染
// ══════════════════════════════════════════════════════════

export function render(state) {
  const R = state.resources;

  // ── 资源条 ──
  // ★ 熵是特例：**大数字放速率，小字放持有量**（HTML 里 id 也对调了）。
  //   熵凝聚斜率上去后（趋近 1 熵 = N 粒子），熵进来就被转走，
  //   持有量恒等于「不足一个阈值的余数」，**没有信息量**。
  el["rate-entropy"].textContent = `+${fmt(entropyRate(state))}/s`;
  el["val-entropy"].textContent = `余 ${fmt(R.entropy)}`;
  el["val-particle"].textContent = fmt(R.particle);
  el["val-matter"].textContent = fmt(R.matter);
  el["val-dream"].textContent = fmt(state.dreamPoints, 0);
  el["val-zpe"].textContent = fmt(state.zpe);
  el["val-de"].textContent = fmt(state.darkEnergy);

  el["rate-particle"].textContent = `+${fmt(particleRate(state))}/s`;
  el["rate-matter"].textContent = `+${fmt(matterRate(state))}/s`;
  el["rate-zpe"].textContent = `+${fmt(zpeRate(state))}/s`;
  el["rate-de"].textContent = state.phaseTransmuterUnlocked
    ? `+${fmt(darkEnergyRate(state))}/s`
    : "未解锁";

  el["global-multiplier"].textContent = fmtMult(globalMultiplier(state));
  el["global-detail"].textContent =
    `梦想点 ×${(1 + state.dreamPoints.toNumber() * dreamCoefficient(state)).toFixed(2)}`;

  // ── 点击 ──
  let clickGain = new Decimal(BASE.clickGain);
  if (state.zpeMilestones.m1) clickGain = clickGain.add(10);
  if (state.voidUpgrades.v7) clickGain = clickGain.mul(5);
  el["click-gain"].textContent = `+${fmt(clickGain)} 熵 / 次`;

  // ── 三条可重复升级 ──
  const autoUpgrade = isAutoAcquire(state, "upgrade");
  let affordable = 0;
  for (const cfg of Object.values(REPEATABLE)) {
    const lv = levelOf(state, cfg.id);
    const cost = repeatableCost(state, cfg.id);
    const pool = R[cfg.currency];
    const can = pool.gte(cost);
    if (can && !autoUpgrade) affordable++;
    const btn = $(`btn-upg-${cfg.id}`);
    if (btn) {
      // ★ 自动获取模式下不能手动买（否则会绕过扣款白送等级）
      btn.classList.toggle("affordable", can && !autoUpgrade);
      btn.classList.toggle("maxed", autoUpgrade);
      btn.disabled = autoUpgrade;
      $(`upg-${cfg.id}-lv`).textContent = `Lv ${fmt(lv, 0)}`;
      // ★ 用 effectText 从公式推导，不要用 cfg.desc（会和实现脱节）
      $(`upg-${cfg.id}-desc`).textContent = effectText(state, cfg.id);
      const currencyName = { particle: "粒子", matter: "物质" }[cfg.currency] ?? cfg.currency;
      $(`upg-${cfg.id}-cost`).textContent = autoUpgrade
        ? "⚡ 自动获取中（免费）"
        : `花费 ${fmt(cost)} ${currencyName}`;
    }
    // 买满按钮：显示当前能买几个（闭式解，O(1)）
    const n = autoUpgrade ? 0 : affordableCount(state, cfg.id);
    const mx = $(`btn-max-${cfg.id}`);
    if (mx) {
      mx.disabled = n <= 0;
      mx.classList.toggle("can", n > 0);
      $(`max-${cfg.id}-n`).textContent = n > 0 ? String(n) : "0";
    }
  }
  el["upgrade-count"].textContent = autoUpgrade ? "自动获取中" : `${affordable} 项可购买`;

  // ── 熵阱 ──
  const tCost = trapCost(state);
  const trapAuto = state.voidUpgrades.v9 && state.zpeMilestones.m5;
  el["trap-lv"].textContent = `${fmt(R.traps, 0)} 个`;
  el["trap-badge"].textContent = fmt(R.traps, 0);
  el["trap-cost"].textContent = trapAuto
    ? `达到 ${fmt(tCost)} 物质时自动获取`
    : `花费 ${fmt(tCost)} 物质`;
  const trapBtn = el["btn-buy-trap"];
  trapBtn.classList.toggle("affordable", trapAuto ? R.matter.gte(tCost) : R.matter.gte(tCost));
  el["trap-effective"].textContent = fmt(effectiveTraps(state), 0);

  const cv = conversion(state);
  // ★ 阈值会被 m6（÷ZPE倍率）和 dm2（÷暗能量倍率）压下去。
  //   压到 1 以下时，「消耗 X 熵 → Y 粒子」这个说法就没意义了 ——
  //   应该反过来显示「1 熵 = N 粒子」。
  const convRate = cv.output.div(cv.threshold);
  el["entropy-rule"].textContent = convRate.gte(1)
    ? `1 熵 = ${fmt(convRate)} 粒子`
    : `消耗 ${fmt(cv.threshold)} 熵 → ${fmt(cv.output)} 粒子`;

  // ── 数值明细 ──
  el["d-entropy-rate"].textContent = fmt(entropyRate(state));
  el["d-particle-rate"].textContent = fmt(particleRate(state));
  el["d-matter-rate"].textContent = fmt(matterRate(state));
  el["d-zpe-rate"].textContent = fmt(zpeRate(state));
  el["d-zpe-mult"].textContent = fmtMult(zpeMultiplier(state));
  el["d-zpe-prod"].textContent = fmtMult(zpeBaseMultiplier(state));
  el["d-de-mult"].textContent = fmtMult(darkEnergyMultiplier(state));
  const pen = zpeProductionPenalty(state);
  el["d-zpe-penalty"].textContent = pen.gte(1) ? "无" : `×${fmt(pen, 3)}`;
  el["d-clicks"].textContent = String(state.stats.clicks);
  el["d-playtime"].textContent = fmtTime(state.playTimeMs / 1000);

  // ── 虚空升级 ──
  let voidOwned = 0;
  for (const cfg of Object.values(VOID_UPGRADES)) {
    const owned = state.voidUpgrades[cfg.id];
    if (owned) voidOwned++;
    const btn = $(`void-btn-${cfg.id}`);
    if (!btn) continue;
    const cost = voidUpgradeCost(state, cfg.id);
    const can = !owned && (cfg.costDream ? state.dreamPoints.gte(cfg.costDream) : state.zpe.gte(cost));
    btn.classList.toggle("affordable", can);
    btn.classList.toggle("maxed", owned);
    $(`void-${cfg.id}-state`).textContent = owned ? "已购买 ✓" : "未购买";
    $(`void-${cfg.id}-cost`).textContent = owned
      ? "已生效"
      : cfg.costDream
        ? `花费 ${cfg.costDream} 梦想点`
        : `花费 ${fmt(cost)} ZPE`;
  }
  el["void-count"].textContent = String(voidOwned);
  el["tab-tag-void"].textContent = `${voidOwned}/9`;
  el["zpe-multiplier"].textContent = fmtMult(zpeMultiplier(state));

  // ── ZPE 里程碑 ──
  let nextFound = false;
  for (const m of ZPE_MILESTONES) {
    const d = $(`ms-${m.id}`);
    if (!d) continue;
    const done = state.zpeMilestones[m.id];
    const isNext = !done && !nextFound;
    if (isNext) nextFound = true;
    d.classList.toggle("done", done);
    d.classList.toggle("next", isNext);
    const needEl = $(`ms-${m.id}-need`);
    if (needEl) {
      needEl.textContent = done
        ? "已达成 ✓"
        : `${fmt(state.zpeTotal)} / ${fmt(new Decimal(m.need), 0)} ZPE`;
    }
  }

  // ── 暗能量面板 ──
  const unlocked = state.phaseTransmuterUnlocked;
  el["tab-tag-de"].textContent = unlocked ? fmt(state.darkEnergy) : "锁";
  el["de-locked"].hidden = unlocked;
  el["de-content"].hidden = !unlocked;

  if (!unlocked) {
    const g = DE_MILESTONES.find((m) => m.id === "dm0")?.gate;
    if (g) {
      const hasVoidOk = !g.voidUpgrade || state.voidUpgrades[g.voidUpgrade];
      const matterOk = !g.matter || R.matter.gte(g.matter);
      el["de-unlock-cond"].innerHTML =
        `<div class="${hasVoidOk ? "ok" : "no"}">${hasVoidOk ? "✓" : "✗"} 已购买「虚空永恒 v8」</div>` +
        `<div class="${matterOk ? "ok" : "no"}">${matterOk ? "✓" : "✗"} 物质 ≥ ${fmt(new Decimal(g.matter), 0)}（当前 ${fmt(R.matter)}）</div>`;
    }
    el["btn-unlock-transmuter"].hidden = false;
    const g2 = DE_MILESTONES.find((m) => m.id === "dm0")?.gate;
    const ready = g2 && (!g2.voidUpgrade || state.voidUpgrades[g2.voidUpgrade]) && R.matter.gte(g2.matter);
    const ub = el["btn-unlock-transmuter"];
    ub.classList.toggle("affordable", !!ready);
    ub.disabled = !ready;
    ub.textContent = ready ? "启动相变仪（已就绪）" : "启动相变仪（条件未满足）";
  } else {
    el["de-multiplier"].textContent = fmtMult(darkEnergyMultiplier(state));
    el["de-penalty"].textContent = pen.gte(1) ? "无" : `×${fmt(pen, 3)}`;

    // ── 相变环：ZPE → 暗能量 的转换进度 ──
    //    和原稿那个百分比条同一个用途：让玩家知道「现在没事干」是正常的。
    const th = new Decimal(BASE.darkEnergyThreshold);
    const acc = state.deAccum ?? new Decimal(0);
    const pct = Math.max(0, Math.min(1, acc.div(th).toNumber()));
    // 下一次转换要多久：还差多少 ZPE / ZPE 产出速率
    const zr = zpeRate(state);
    const eta = zr.gt(0) ? th.sub(acc).div(zr).toNumber() : Infinity;
    // 一轮 < 0.5 秒时填充环看不出变化 -> 切成高光旋转
    const instant = !Number.isFinite(eta) || eta < 0.5;

    el["de-ring-wrap"].classList.toggle("instant", instant);
    el["de-ring-pct"].textContent = instant ? "⟳" : `${(pct * 100).toFixed(0)}%`;
    // ★ 不再显示「下一次转换需要 1e8 ZPE」——
    //   实际转换是**连续**的（zpeRate/1e8），根本不存在「下一次」，
    //   而且在持续转换模式下那句话还和左边的环自相矛盾。改成显示速率。
    el["de-ring-rate"].textContent = `${fmt(zr.div(BASE.darkEnergyThreshold), 3)} 次/秒`;
    el["de-ring-de"].textContent = `${fmt(darkEnergyRate(state), 3)} /秒`;

    const dfill = el["de-ring-fill"];
    if (instant) {
      dfill.style.strokeDashoffset = "";   // 交给 CSS 动画，别用行内样式压住它
    } else {
      dfill.style.strokeDashoffset = String(263.9 * (1 - pct));
    }

    for (const cfg of Object.values(DE_UPGRADES)) {
      const lv = deLevelOf(state, cfg.id);
      const maxed = cfg.maxLevel != null && lv.gte(cfg.maxLevel);
      const c = deUpgradeCost(state, cfg.id);
      let can = !maxed;
      if (can && c.dream) can = state.dreamPoints.gte(c.dream);
      if (can && c.matter) can = R.matter.gte(c.matter);
      if (can && c.particle) can = R.particle.gte(c.particle);
      if (can && c.zpe) can = state.zpe.gte(c.zpe);
      if (can && c.darkEnergy) can = state.darkEnergy.gte(c.darkEnergy);   // ★ 新增
      const btn = $(`de-btn-${cfg.id}`);
      if (!btn) continue;
      btn.classList.toggle("affordable", can);
      btn.classList.toggle("maxed", maxed);
      $(`de-${cfg.id}-lv`).textContent = maxed ? `Lv ${fmt(lv, 0)} (满级)` : `Lv ${fmt(lv, 0)}`;
      $(`de-${cfg.id}-desc`).textContent = cfg.desc(lv);
      const parts = [];
      if (c.dream) parts.push(`${fmt(c.dream, 0)} 梦想点`);
      if (c.matter) parts.push(`${fmt(c.matter)} 物质`);
      if (c.particle) parts.push(`${fmt(c.particle)} 粒子`);
      if (c.zpe) parts.push(`${fmt(c.zpe)} ZPE`);
      // ★ 新增：暗能量计价的升级。
      //   最初漏了这一行 —— 两个新升级在界面上显示「花费 」后面空白，
      //   因为 parts 是空的、join 出来就是空字符串。截图抓到的就是这个。
      if (c.darkEnergy) parts.push(`${fmt(c.darkEnergy)} 暗能量`);
      $(`de-${cfg.id}-cost`).textContent = maxed ? "已满级" : `花费 ${parts.join(" + ")}`;
    }

    for (const m of DE_MILESTONES) {
      const d = $(`dms-${m.id}`);
      if (!d) continue;
      const done = state.deMilestones[m.id];
      const firstUndone = DE_MILESTONES.find((x) => !state.deMilestones[x.id]);
      d.classList.toggle("done", done);
      d.classList.toggle("next", !done && firstUndone?.id === m.id);
      const needEl = $(`dms-${m.id}-need`);
      if (needEl) {
        needEl.textContent = done
          ? "已达成 ✓"
          : m.gate
            ? "v8 + 1e8 物质"
            : `${fmt(state.darkEnergyTotal)} / ${fmt(new Decimal(m.need), 0)}`;
      }
    }
  }

  // ── 量子面板（第四层，红色）──
  renderQuantum(state, R);

  // ── 无限面板（金色，独立标签页）──
  renderInfinity(state);

  // ── 日志 ──
  const logEl = el["log-panel"];
  const want = state.log.length;
  if (logEl.childElementCount !== want) {
    logEl.innerHTML = state.log
      .map((e) => {
        const t = new Date(e.t);
        const hh = String(t.getHours()).padStart(2, "0");
        const mm = String(t.getMinutes()).padStart(2, "0");
        const ss = String(t.getSeconds()).padStart(2, "0");
        return `<div class="le"><span class="lt">${hh}:${mm}:${ss}</span>${escapeHtml(e.text)}</div>`;
      })
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ══════════════════════════════════════════════════════════
// 量子面板（第四层，红色）
// ══════════════════════════════════════════════════════════

function renderQuantum(state, R) {
  const unlocked = collapseUnlocked(state);

  el["q-locked"].hidden = unlocked;
  el["q-content"].hidden = !unlocked;
  el["q-need"].textContent = fmt(new Decimal(COLLAPSE.unlockMatter), 0);

  const qTab = el["tab-tag-quantum"];
  qTab.textContent = unlocked ? fmt(state.quantum, 0) : "锁";
  el["tab-quantum"].classList.toggle("locked", !unlocked);

  if (!unlocked) return;

  el["val-quantum"].textContent = fmt(state.quantum, 0);
  el["quantum-sub"].textContent =
    `已捕获 ${state.quantumPairs.toNumber()} 对 · 累计 ${state.quantumPairsTotal.toNumber()} 对`;

  // ── 量子涨落捕获（第三层）──
  const need = quantumZpeRequirement(state.quantumPairs);
  const needLog = need.log10().toNumber();
  const curZpeLog = state.zpe.gt(0) ? state.zpe.log10().toNumber() : 0;
  el["quantum-pairs"].textContent = `${state.quantumPairs.toNumber()} 对`;
  el["quantum-next-cost"].textContent = `1e${needLog.toFixed(0)} ZPE`;
  el["quantum-cur-zpe"].textContent = fmt(state.zpe);
  // 进度：用对数刻度量「离门槛还差几个数量级」
  const qProg = needLog > 0 ? Math.max(0, Math.min(1, curZpeLog / needLog)) : 0;
  el["quantum-bar"].style.width = `${(qProg * 100).toFixed(1)}%`;
  el["quantum-bar-text"].textContent = `${(qProg * 100).toFixed(1)}%`;

  el["quantum-mult"].textContent = fmtMult(quantumEntropyMultiplier(state.quantum));
  el["quantum-degain"].textContent = fmtMult(new Decimal(1).add(quantumDeGainBonus(state.quantum)));
  // ★ 指数成长速率：这个数字**就是**引擎里那个项，不是估算。
  //   玩家看到的速度 = d(log10 物质)/dt（单位：数量级/秒）
  el["quantum-grow"].textContent = `${quantumGrowthRate(state.quantum).toFixed(4)} 阶/秒`;
  el["quantum-demult"].textContent = fmtMult(new Decimal(1).add(quantumDeMultBonus(state.quantum)));

  // ── 梦想点一次性升级 ──
  let dOwned = 0;
  for (const d of DREAM_UPGRADES) {
    const has = state.dreamUpgrades[d.id] === true;
    if (has) dOwned++;
    const b = $(`dream-btn-${d.id}`);
    if (!b) continue;
    const canBuy = !has && state.dreamPoints.gte(d.cost);
    b.classList.toggle("affordable", canBuy);
    b.classList.toggle("owned", has);
    b.disabled = has;
    const stEl = $(`dream-${d.id}-state`);
    if (stEl) stEl.textContent = has ? "已购买 ✓" : "未购买";
    const c = $(`dream-${d.id}-cost`);
    if (c) c.textContent = has ? "已生效" : `花费 ${d.cost} 梦想点（持有 ${fmt(state.dreamPoints, 0)}）`;
  }
  el["dream-badge"].textContent = `${dOwned} / ${DREAM_UPGRADES.length}`;
}

// ══════════════════════════════════════════════════════════
// 无限面板（金色）—— 独立标签页
// ══════════════════════════════════════════════════════════

function renderInfinity(state) {
  const cap = crunchThreshold();
  const unlocked = state.peakMatter.gte(cap) || state.bigCrunchCount.gt(0);

  el["inf-locked"].hidden = unlocked;
  el["inf-content"].hidden = !unlocked;
  el["inf-need"].textContent = CRUNCH_AT_LABEL;

  const tab = el["tab-tag-infinity"];
  tab.textContent = unlocked ? fmt(state.infinityPoints, 0) : "锁";
  el["tab-infinity"].classList.toggle("locked", !unlocked);

  if (!unlocked) return;

  el["val-infinity"].textContent = fmt(state.infinityPoints, 0);
  el["bigcrunch-count"].textContent = String(state.bigCrunchCount.toNumber());
  el["bigcrunch-need"].textContent = CRUNCH_AT_LABEL;
  el["bigcrunch-gain"].textContent = fmt(bigCrunchGain(state), 0);

  const broken = state.brokenInfinity;
  const canCrunch = broken && canBigCrunch(state);
  const bb = el["btn-bigcrunch"];
  bb.disabled = !canCrunch;
  bb.classList.toggle("affordable", canCrunch);
  el["bigcrunch-status"].textContent = !broken
    ? "到顶强制触发"
    : canCrunch ? "可以坍缩" : "物质不足";
  el["bigcrunch-desc"].textContent = broken
    ? "手动触发。跑得越深收益越高，但每个数量级的收益递减"
    : "物质到 1e308.25 会强制大坍缩（收益固定）";

  const bk = el["btn-break-infinity"];
  const showBreak = !broken && state.infinityPoints.gte(BREAK_INFINITY.unlockCost);
  bk.hidden = !showBreak;
  if (showBreak) {
    bk.classList.add("affordable");
    el["break-state"].textContent = `花 ${BREAK_INFINITY.unlockCost} 无限点`;
  }

  // 大坍缩就绪时给标签一个提示
  el["tab-infinity"].classList.toggle("alert", canCrunch);
}

// ══════════════════════════════════════════════════════════
// 事件绑定
// ══════════════════════════════════════════════════════════

export function initUI(handlers) {
  cache();
  buildUpgrades();
  buildVoidUpgrades();
  buildDeUpgrades();
  buildMilestones();
  buildLegend();
  buildDreamUpgrades();
  setupTabs();
  activateTab("void");

  el["btn-click"].addEventListener("click", handlers.onClick);
  el["btn-buy-trap"].addEventListener("click", handlers.onBuyTrap);
  el["btn-save"].addEventListener("click", handlers.onSave);
  el["btn-export"].addEventListener("click", handlers.onExport);
  el["btn-reset"].addEventListener("click", handlers.onReset);
  el["btn-unlock-transmuter"].addEventListener("click", handlers.onUnlockTransmuter);
  // 临界坍缩是自动的，所以没有按钮可绑。
  // （曾经这里挂着 el["btn-collapse"] 的监听，删掉 HTML 后就成了悬空引用 ——
  //   是烟测的「el[] 未进 cache」反向检查抓出来的。）
  el["btn-bigcrunch"].addEventListener("click", handlers.onBigCrunch);
  el["btn-break-infinity"].addEventListener("click", handlers.onBreakInfinity);

  for (const cfg of Object.values(REPEATABLE)) {
    $(`btn-upg-${cfg.id}`)?.addEventListener("click", () => handlers.onBuyRepeatable(cfg.id, false));
    $(`btn-max-${cfg.id}`)?.addEventListener("click", () => handlers.onBuyRepeatable(cfg.id, true));
  }
  for (const cfg of Object.values(VOID_UPGRADES)) {
    $(`void-btn-${cfg.id}`)?.addEventListener("click", () => handlers.onBuyVoid(cfg.id));
  }
  for (const cfg of Object.values(DE_UPGRADES)) {
    $(`de-btn-${cfg.id}`)?.addEventListener("click", () => handlers.onBuyDe(cfg.id, false));
    $(`de-max-${cfg.id}`)?.addEventListener("click", () => handlers.onBuyDe(cfg.id, true));
  }
  // （原来这里还遍历 QUANTUM_UPGRADES 绑定量子升级按钮 ——
  //   旧量子升级系统已整体删除，那个数组现在是空的，循环也一并去掉）

  for (const d of DREAM_UPGRADES) {
    $(`dream-btn-${d.id}`)?.addEventListener("click", () => handlers.onBuyDream(d.id));
  }

  // 熵阱也支持买满（右键）
  el["btn-buy-trap"].addEventListener("contextmenu", (e) => {
    e.preventDefault();
    handlers.onBuyTrap(true);
  });

  // 空格也能点
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat && e.target === document.body) {
      e.preventDefault();
      handlers.onClick();
    }
  });
}

export function showOfflineBanner(seconds, capped) {
  const b = el["offline-banner"];
  if (!b) return;
  b.hidden = false;
  b.textContent = `欢迎回来！离线 ${fmtTime(seconds)}` +
    (capped ? `（已按 ${fmtTime(BASE.offlineCapSeconds)} 上限结算）` : "");
}

export function flashSave() {
  const b = el["btn-save"];
  if (!b) return;
  const old = b.textContent;
  b.textContent = "已保存 ✓";
  b.classList.add("on");
  setTimeout(() => { b.textContent = old; b.classList.remove("on"); }, 1100);
}

export { el, $ };
