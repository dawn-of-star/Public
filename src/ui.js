import { OVERLOAD } from "./config.js";
import { infinityUpgradeEffect } from "./engine.js";
import { infinityUpgradeOwned } from "./config.js";
import { infinityUpgradeCost } from "./config.js";
import { BREAK_INFINITY } from "./config.js";
import { quantumToIPGain } from "./config.js";
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
// ⚠️ 注意：`D` 由下面 `./config.js` 的 import 提供（第 39 行）⇒ **不要在这里再定义** ✗
//   （我加过一个 `const D = ...`，触发 "Identifier 'D' has already been declared"）
import { buildIcUI, renderIc } from "./ui-ic.js";
// ★★★ 2025（`docs/NEKO.md`）：宿主探测（猫猫子页显示"接没接上"用）
import { nekoHostPresent } from "./neko.js";
import {
  REPEATABLE, VOID_UPGRADES, ZONES, ZONE_OF, ZPE_ENGINE, ZPE_EXPONENT, ZPE_MILESTONES,
  overloadThreshold, quantumDeGainBonus, quantumDeMultBonus,
  matterSpanExponent, matterSpanMult, matterSpanStatus,
  quantumEntropyMultiplier, quantumStepMult, quantumZpeRequirement,
  zpeEngineCost, zpeEngineCountFreqUnlocked, zpeEngineAddBonus, zpeEngineMultBonus, zpeEngineLevel,
  zpeEngineProdMult, zpeEngineUnlocked, quantumZpeMultBonus, qOf, zoneOf, TIER_MILESTONES, DE_UPGRADES, DE_MILESTONES, DREAM_UPGRADES, INFINITY_ORDER, INFINITY_UPGRADES, BASE, ETERNITY, eternityPointGain, ipDoubleMult, tierMilestonesDone, matterTotalExponent, MATTER_B_KNEE, MATTER_B_KMAX, COLLAPSE, crunchThreshold, CRUNCH_AT_LABEL, pageUnlocked, markPageUnlocked,
  // ★★★ 2025：渲染时的**实时自愈**要遍历全部页面（见 `render` 开头）
  PAGE_KEYS,
  // ★ 2025：永恒里程碑（设计稿 36~44 行）
  ETERNITY_MILESTONES, hasEternityMilestone, em5IpMult,
  // ★★★ 2025：永恒升级「永恒增幅」（设计稿 33~35 行）
  epMultFactor, epMultPriceAt, epMultAffordableIn, ETERNITY_UPGRADES,
  // ★★★ 2025（`docs/NEKO.md` §7）：猫猫卡片 —— 与实发同源
  nekoGlobalExponent, nekoNextTier, NEKO, nekoDriftRoom, NEKO_ITEMS,
  // ★★★ 2025（设计稿第 24 行）：自动化状态卡要读"哪几条 DE 升级被自动买"
  dreamUpgradeEffects,
  // ★★★ 2025（设计稿第 27 行）：主面板折叠分组的定义（下拉条 + "记住"键）
  UI_FOLDS,
  // ★ 2025：引擎 5 条机制的参数（UI 文案要显示 A/knee/coeff，**从 config 取，不手写** ✗）
  ENGINE_MECH,
  // ★★★ 2025：① 无限增幅置顶行的渲染需要它
  //   （用户报告"买一次后仍显示 ×1"—— 根因是那一行从没被渲染过，见 renderInfinity 的说明）
  //   ⚠️ `INFINITY_UPGRADES` 上面第 29 行的 import 里**已经有了** ⇒ 别重复导入 ✗
  ipDoubleAffordableIn,
  // ★★★ 2025：量子面板必须含引擎账 ⇒ 显示 == 实发（见 renderQuantum 的说明）
  engineBonusMult } from "./config.js";   // ★ 补回（删铸币时同行的 zoneOf 被连带删掉 ✗）
import {
  D,   // ★ 2025 修复：`D(0)` 曾被用在 zpe 解锁判定里，但 **ui.js 从未定义/import 过 `D`** ✗
       //   ⇒ `bigCrunchCount` 为空那一帧会抛 `ReferenceError`，整帧 render 挂掉。
       //   `formulas.js` 本来就导出它，直接 import 即可（单一来源 ✓）
  bigCrunchGain, canBigCrunch, collapseUnlocked, conversion, darkEnergyMultiplier,
  darkEnergyRate, dreamCoefficient,
  effectiveTraps, entropyRate, countFreqAddTerm,
  globalMultiplier, globalMultiplierParts, isAutoAcquire, matterRate, overloadFactor, particleBoostRate, particleRate, repeatableCost, trapCost,  voidUpgradeCost, zpeBaseMultiplier, zpeMultiplier, zpeProductionPenalty, zpeRate,
  deUpgradeCost } from "./formulas.js";
import { deLevelOf, levelOf } from "./state.js";
import { tick, affordableCount, zpeEngineAffordable } from "./engine.js";   // ★ 补回：删铸币时整行被删 ✗

/**
 * 给元素加上乘区颜色 class，并附带一条 <span class="zone-tag">。
 *
 * ⚠️ 虹色（梦想系统）是特例：它没有单一颜色，走 `.rainbow-card` / `.rainbow` 那套，
 *   所以这里对 `z.rainbow` 分支单独处理 —— 否则会加一个不存在的 `zone-dream`。
 */
function applyZone(el, id, showTag = true) {
  // ★ 参数兼容守卫：历史上有 `applyZone(cfg.id)` 这种**只传 id** 的调用 ✗
  //   （把字符串当元素用 ⇒ el.classList 为 undefined ⇒ 构建期抛 TypeError ✗）
  if (typeof el === "string" && (id === undefined || id === null || !id.classList)) { const t = el; el = id; id = t; }
  if (!el || !el.classList) return;   // 拿不到元素就静默跳过 ✓（但不影响别的 ✓）
  const z = zoneOf(id);
  const key = ZONE_OF[id];
  if (z.rainbow) el.classList.add("rainbow-card");
  else if (key) el.classList.add("zone", `zone-${key}`);
  // ★ 2025：**未登记乘区** ⇒ 只回退到默认色，**不加** `zone-undefined` ✗
  //   （旧写法会加一个不存在的 class：按钮看着"没颜色"，但在 DOM 里查不出原因）
  else el.classList.add("zone");
  // ⚠️ 未登记的 id 要能**被发现**，不能静默 —— 项目规矩：漏登记过一次
  //   （deGainBase / convOutput / 四条梦想升级都漏过，表现为"加成区不对"）
  if (!key && typeof console !== "undefined") {
    console.warn(`[zone] id "${id}" 未在 ZONE_OF 登记 ⇒ 拿不到乘区色（见 config.js 的 ZONE_OF）`);
  }
  if (showTag) {
    const tag = document.createElement("span");
    tag.className = "zone-tag";
    tag.textContent = z.cn;
    const row = el.querySelector(".btn-row");
    if (row) row.appendChild(tag);
  }
}

// ══════════════════════════════════════════════════════════
// 数字格式化 —— ★ 2025 已抽到 `./format.js`（唯一实现）
//   为什么抽走：`engine.js` 的日志也要用 `sci()`，而 `ui.js` 已 import `engine.js`
//   ⇒ 若反向 import 会成**循环依赖** ✗ ⇒ 两边都从 `format.js` 取 ✓
//   ⚠️ **必须先 import 再 export** —— `export { x } from "…"` **不会**在本模块内
//      绑定 `x`（那样下面的 `fmt(...)` 调用会 ReferenceError ✗，实测踩过）
//   这里同时 import + 重新导出，保持既有调用方（`tools/dom-smoke.mjs` 等）不受影响 ✓
// ══════════════════════════════════════════════════════════
import { fmt, sci, fmtMult, fmtTime } from "./format.js";
export { fmt, sci, fmtMult, fmtTime };

const $ = (id) => document.getElementById(id);
const el = {};

/** 物质的对数（阶）—— 过载相关的显示都要它，且必须和引擎同源（都是 log10） */
const matterLog10 = (state) =>
  (state.resources.matter.gt(0) ? state.resources.matter.log10() : new Decimal(0));

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
    } });
  return node;
}

function cache() {
  const ids = [
    "offline-banner", "fatal", "zone-legend",
    "val-entropy", "rate-entropy", "val-particle", "rate-particle",
    "val-matter", "rate-matter", "val-dream", "val-zpe", "rate-zpe",
    "val-de", "rate-de", "global-multiplier", "countfreq-detail", "gm-dream", "gm-countfreq", "gm-de",
    "btn-click", "click-gain",
    "upgrade-list", "upgrade-count",
    "btn-buy-trap", "trap-lv", "trap-cost", "trap-badge", "trap-effective", "entropy-rule",
    "d-entropy-rate", "d-particle-rate", "d-matter-rate", "d-zpe-rate",
    "d-zpe-mult", "d-zpe-prod", "d-de-mult", "d-zpe-penalty",
    "d-clicks", "d-playtime",
    "log-panel",
    "tab-tag-void", "void-count", "zpe-multiplier", "void-upgrade-list", "milestone-list",
    "de-locked", "de-content", "de-unlock-cond", "btn-unlock-transmuter",
    // ★ 2025：各面板「已解锁过」的提示（第一次永恒后不再上锁，见 config.js 的 pageUnlocked）
    "de-locked-title", "de-perma-hint", "q-locked-title", "q-perma-hint",
    "inf-locked-title", "inf-perma-hint", "eternity-locked-title", "eternity-perma-hint",
    "de-multiplier", "de-penalty", "de-upgrade-list", "de-milestone-list",
    // ── 标签页 ──
    "tabs", "tab-void", "tab-de", "tab-quantum", "tab-infinity", "tab-eternity",
    "panel-void", "panel-zpe", "panel-de", "panel-quantum", "panel-infinity", "panel-eternity",
    // ★★★ 2025（用户裁定）：主控台的子页（梦想 / 猫猫）
    "panel-dream", "panel-neko",
    "tab-wrap-console", "tab-flyout-console", "flyout-console-core", "flyout-console-dream", "flyout-console-neko",
    "tab-tag-void", "tab-tag-de", "tab-tag-quantum", "tab-tag-infinity", "tab-tag-eternity",
    // ── 永恒（**先占位**：门槛 + 永恒点公式，内容待设计）──
    "eternity-locked", "eternity-content", "eternity-need", "eternity-have",
    "btn-eternity", "eternity-status",
    "val-eternity", "eternity-gain", "eternity-count",
    // ── 主控台（原左列的 5 张卡并进标签页后的第一个面板）──
    "panel-console",
    // ── 虚空科技的子页悬浮入口（悬停/聚焦时浮出两条）──
    "tab-wrap-void", "tab-flyout-void", "flyout-void-core", "flyout-void-zpe",
    // ── 无限的子页悬浮入口（悬停「无限」浮出两条）──
    "tab-wrap-infinity", "tab-flyout-infinity", "flyout-inf-core", "flyout-inf-deep", "panel-infdeep",
    // ── ZPE 引擎（虚空科技第二个子页）──
    "zpe-engine-locked", "zpe-engine-content", "zpe-engine-unlock-cost", "btn-unlock-zpe-engine",
    "zpe-engine-level", "zpe-engine-prod", "zpe-engine-exp", "zpe-engine-ip",
    "btn-buy-zpe-engine", "btn-buy-zpe-engine-max", "zpe-engine-afford",
    "zpe-engine-buy-desc", "zpe-engine-cost", "zpe-engine-mechanisms",
    // ── 量子（第四层，红色）──
    "q-locked", "q-content", "q-need",
    "val-quantum", "quantum-sub", "quantum-mult", "quantum-demult", "quantum-degain", "quantum-zpemult", "quantum-grow",
    // ★ 跨度层（2025）：k / 乘数 / 基准 / 徽标
    "span-badge", "span-de", "span-state", "span-k", "span-mult", "span-base",
    "quantum-pairs", "quantum-next-cost", "quantum-cur-zpe",
    "quantum-bar", "quantum-bar-text",
    "dream-badge", "dream-upgrade-list",
    
    // ── 相变环（暗能量页）──
    "de-ring-wrap", "de-ring-fill", "de-ring-pct", "de-ring-rate", "de-ring-de",
    // ── 无限（金色）──
    "inf-locked", "inf-content", "inf-need",
    "val-infinity", "bigcrunch-count", "bigcrunch-need",
    "bigcrunch-gain", "btn-bigcrunch", "bigcrunch-status",
    "bigcrunch-desc", "btn-break-infinity", "break-state", "overload-state",
    // ── 坍缩里程碑（铸币与坍缩加速器都已删除）──
    "tier-ms-badge", "tier-milestone-list",
    // ★ 2025：永恒里程碑（设计稿 36~44 行）
    "eternity-ms-badge", "eternity-milestone-list",
    // ★★★ 2025：永恒升级「永恒增幅」（设计稿 33~35 行）
    "btn-eternity-upg-epMult", "eternity-upg-epMult-lv", "eternity-upg-epMult-desc",
    "eternity-upg-epMult-cost", "btn-max-eternity-upg-epMult", "max-eternity-upg-epMult-n",
    // ★★★ 2025（NEKO.md §7 / 设计稿 §10）：猫猫**子页**（主控台 → 猫猫；两列布局）
    "neko-badge", "neko-affinity", "neko-exponent", "neko-next", "neko-bar", "neko-bar-text",
    "neko-drift", "neko-note", "neko-tier-list",
    // 左列：道具（定价按 `NEKO.md` §10；★ 2025 已实装 ⇒ 是三个真按钮）+ 调试按钮
    "neko-item-badge", "neko-item-list", "neko-item-note",
    "btn-neko-item-catFood", "neko-item-catFood-cost", "neko-item-catFood-gain",
    "btn-neko-item-lollipop", "neko-item-lollipop-cost", "neko-item-lollipop-gain",
    "btn-neko-item-paw", "neko-item-paw-cost", "neko-item-paw-gain",
    // 右列：对话（等 SDK）
    "neko-chat-badge", "neko-chat", "neko-msg-placeholder", "neko-sdk-state",
    // ★★★ 2025：梦想（自动化）子页（用户裁定归属主控台；目前是壳 + 自动化状态）
    "dream-page-badge",
    // ★ 2025（设计稿第 27 行）：**日志搬到梦想子页**后的徽标
    "log-badge",
    // ★★★ 2025（设计稿第 27 行）：主面板**折叠分组**（下拉条 + "记住"复选框）
    "fold-manual-head", "fold-manual-body", "fold-manual-remember", "fold-manual-hint",
    // ★★★ 2025：全局加成槽的**好感度指数**那一格（生效时才显示）
    "gm-neko",
    // ★★★ 2025：**自动化状态**（已移到梦想子页 ⇒ id 仍是这两个）
    "auto-acquire", "auto-de",
    // ★ 无限挑战（IC）的宿主：内容由 ui-ic.js 追加（2025 从 ZPE 引擎面板挪到这里）
    "ic-host",
    // ── ∞ 层：无限升级 ──
    "inf-upgrade-list", "inf-upgrade-count", "inf-income", "inf-elapsed",
    // ★ 2025：① 无限增幅置顶行（主按钮 + 买满按钮；形态与升级中心一致）
    "inf-ipdouble-row", "inf-btn-ipDouble", "inf-ipDouble-state", "inf-ipDouble-desc", "inf-ipDouble-cost",
    "btn-max-ipDouble", "max-ipDouble-n",
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
    // ★ 2025 修复：原来是 `applyZone(cfg.id)` —— **只传 id 没传元素** ✗
    //   兼容守卫换位后 `el` 仍是 undefined ⇒ 直接 return ⇒ **9 条虚空升级一个都没上色** ✗
    //   （用户报"加成按钮没有按乘区上色"的根因之一。）改为与暗能量同一写法 ✓
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
    `<span class="hint">颜色 = 加成作用的位置：同一颜色就是叠在同一个位置；` +
    `描述里带「最终」二字的另算一层</span>`;
}

/**
 * ∞ 层：无限升级（**2×n 网格**）。
 *
 * 为什么是网格：条目已经有 12 条（①~④ + 起点跃迁×4 + 速率解放×4），
 * 单列会把无限页拉得很长；两列刚好一屏。
 *
 * 颜色规则（用户指定）：
 *   · **不再一律用彩色/虹色**，而是按"加成落在哪个位置"取乘区色（`ZONE_OF`）；
 *   · 只有**作用于梦想系统**的条目才保留虹色（`z.rainbow`）。
 */
function buildInfinityUpgrades() {
  const box = el["inf-upgrade-list"];
  if (!box) return;
  box.innerHTML = "";

  // ★★ 2025：**① 无限增幅置顶、独立占一行**（用户要求），形态与
  //   「升级中心」里的可重复升级**一致**：主按钮 + 「买满」按钮（同一个 CSS 类 `btn-main`）。
  //   ⚠️ 外壳是**静态写在 index.html 里**的（这样 `cache()` 在 `initUI` 早期就能拿到这些 id）
  //      ⇒ 这里只补文案与**乘区色**，不重建 DOM ✓
  //   ⇒ 它不再出现在下面的 `.inf-grid` 里（下面的循环里 `continue` 跳过它 ✓）。
  const row = el["inf-ipdouble-row"];
  if (row) {
    el["inf-ipDouble-desc"].textContent = INFINITY_UPGRADES.ipDouble.desc;
    applyZone(el["inf-btn-ipDouble"], "ipDouble");
    el["btn-max-ipDouble"].classList.add("zone", `zone-${ZONE_OF.ipDouble}`);
  }

  for (const id of INFINITY_ORDER) {
    if (id === "ipDouble") continue;          // ★ 已置顶，不进网格
    const cfg = INFINITY_UPGRADES[id];
    const z = zoneOf(id);
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.id = `inf-btn-${id}`;
    btn.innerHTML = `
      <div class="btn-row">
        <span class="btn-name${z.rainbow ? " rainbow" : ""}">${cfg.name}</span>
        <span class="btn-lv" id="inf-${id}-state">未购买</span>
      </div>
      <div class="btn-desc" id="inf-${id}-desc">${cfg.desc}</div>
      <div class="btn-cost" id="inf-${id}-cost">—</div>
    `;
    box.appendChild(btn);
    // ★ 2025 修复：同样是"只传 id"✗ ⇒ 16 条无限升级没上色。改为传元素 ✓
    applyZone(btn, id);
  }
}

/**
 * 梦想点一次性升级（量子页）。
 *
 * 颜色规则与其他列表**同一套**：乘区色由 `ZONE_OF` 决定；这四条属于 dream 乘区，
 * 于是自动走虹色（`applyZone` 对 `z.rainbow` 加 `rainbow-card`）、名字加 `.rainbow`。
 *
 * ⚠️ 踩过两个坑，正是"虹色不动 / 加成区不对"的根因：
 *   1. 原来硬编码 `zone zone-dm` —— 它们不属于量子乘区（语义错，颜色也是错的）；
 *   2. 原来只给卡片加 `rainbow-card`（静态 `border-image`），名字上没有 `.rainbow`，
 *      而带动画的是 `.rainbow` —— 所以"颜色不动"。
 */
function buildDreamUpgrades() {
  const box = el["dream-upgrade-list"];
  if (!box) return;
  box.innerHTML = "";
  for (const d of DREAM_UPGRADES) {
    const z = zoneOf(d.id);
    const btn = document.createElement("button");
    btn.className = "btn q-card";
    btn.id = `dream-btn-${d.id}`;
    btn.innerHTML = `
      <div class="btn-row">
        <span class="btn-name${z.rainbow ? " rainbow" : ""}">${d.name}</span>
        <span class="btn-lv" id="dream-${d.id}-state">未购买</span>
      </div>
      <div class="btn-desc">${d.desc}</div>
      <div class="btn-cost" id="dream-${d.id}-cost">花费 ${d.cost} 梦想点</div>
    `;
    box.appendChild(btn);
    // ★ 2025 修复：同样是"只传 id"✗ ⇒ 4 条梦想升级没上色。改为传元素 ✓
    applyZone(btn, d.id);
  }
}


/** 标签页切换 */
function setupTabs() {
  const bar = el["tabs"];
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    // ★ 用 [data-tab] 而不是 .tab：虚空科技的**悬浮子页入口**也是 data-tab
    const tab = e.target.closest("[data-tab]");
    if (!tab || tab.classList.contains("locked")) return;
    activateTab(tab.dataset.tab);
  });
}

/**
 * 建 ZPE 引擎的「三条机制」卡片（**只在初始化时跑一次**）。
 *
 * 为什么不放在 `render()` 里：每帧 `innerHTML = …` 会重建 DOM，
 * 于是 `:hover` 与 CSS 过渡每帧被重置 —— 鼠标移上去就频繁闪烁（用户实测报的 bug）。
 * 这里把**不变的文案**（名字、条件）写死成静态 DOM，`render()` 只更新会变的那两处文本。
 */
function buildZpeMechanisms() {
  const box = el["zpe-engine-mechanisms"];
  if (!box) return;
  const cards = [
    {
      name: "① ZPE 倍率的加法区加成",
      at: `饱和式：+${ENGINE_MECH.add.A} 为上限（x = 等级/${ENGINE_MECH.add.knee}，x/(1+x) 收敛）⇒ 有终点 ✓` },
    {
      name: "② 按等级提速产出与倍率",
      at: `开根式：产出 ×(1 + ${ENGINE_MECH.prod.coeff}·√等级)、倍率 ×(1 + ${ENGINE_MECH.mult.coeff}·√等级)（增长极慢 ⇒ 实际到顶早）` },
    {
      name: "③ 吃「计数频率」与「量子」加成",
      at: `等级 ${ZPE_ENGINE.countFreqLevel} 解锁计数频率（纯阈值 ⇒ 本身就是终点）；量子再给 ZPE 倍率 +q³/10（加法区）` },
    {
      // ★ 2025：设计稿第 4 条**之前漏了**（面板只列了 3 条 ✗）—— 用户指出后补上 ✓
      name: "④ 引擎倍率也作用于暗能量倍率",
      at: `饱和式：×${ENGINE_MECH.de.A + 1} 为上限（x = 等级/${ENGINE_MECH.de.knee}）⇒ 有终点 ✓` },
    {
      // ★★ 2025 B8：**b区（指数区）** —— 用户裁定"b区的成员由引擎控制"
      //
      //   为什么需要这一条（结合前四条一起读）：
      //     ①②③④ 全都落在 **a区**（加法池 × 乘法池）⇒ 它们只改曲线的**高度**。
      //     但**物质层的成长速率由基础公式决定**：`d log10(物质)/dt = b`（b 由量子线给），
      //     a区 再怎么乘都改不了这个斜率 ✗
      //     ⇒ 实测：引擎从 0 涨到 100 多级，a区 加成翻了几十倍，物质峰值只从
      //        1e879 挪到 1e1134 —— **翻不过"每轮只推进几阶"那道墙** ✗
      //     ⑤ 的作用是**对整个 a区括号取幂**：
      //         `物质产出 = { ①…④ 那一整块 } ^ k`，`k = 1 + kMax·x/(1+x)`
      //     ⇒ 斜率被放大 k 倍 ⇒ 这才是唯一能改**形状**（而不只是高度）的落点 ✓
      name: "⑤ b区（指数区）：引擎给物质产出一个指数",
      at: `整块 a区括号取幂：物质产出 = { 前四条 } ^ k，k = 1 → ${1 + MATTER_B_KMAX}（${MATTER_B_KNEE} 级后饱和）` },
  ];
  box.innerHTML = cards.map((c, i) => `
      <div class="btn zone zone-zpe" id="zpe-mech-${i}" style="cursor:default">
        <div class="btn-row">
          <span class="btn-name">${c.name}</span>
          <span class="btn-lv" id="zpe-mech-${i}-state">未生效</span>
        </div>
        <div class="btn-desc" id="zpe-mech-${i}-now">—</div>
        <div class="btn-cost" style="color:var(--text-faint)">${c.at}</div>
      </div>`).join("");
}

/**
 * 建「坍缩里程碑」清单（**只建一次**，`render()` 里只切 class）。
 *
 * ⚠️ 结构必须与 `buildVoidUpgrades()` 里的里程碑**逐字一致**：
 *    `div.ms` + `span.dot / .txt / .need`，状态用 `done` / `next` 两个 class。
 *    第一版我用了 `ms-item` 这个**不存在的 class**，于是它在页面上和别的里程碑长得不一样。
 *    （这里刻意**不调** `applyZone()`：档位里程碑的效果落在好几格上，
 *      按项目规矩"落点不唯一就不上色"。）
 */
function buildTierMilestones() {
  const box = el["tier-milestone-list"];
  if (!box) return;
  box.innerHTML = "";
  for (const m of TIER_MILESTONES) {
    const d = document.createElement("div");
    d.className = "ms";
    d.id = `tms-${m.id}`;
    d.innerHTML = `<span class="dot"></span><span class="txt">${m.desc}</span>` +
      `<span class="need" id="tms-${m.id}-need">${m.at} 次大坍缩</span>`;
    box.appendChild(d);
  }
}

/**
 * ★★ 2025：**永恒里程碑**列表（设计稿 36~44 行；按永恒次数解锁）。
 *
 * 与档位里程碑同一套 DOM 约定（`.ms` + `.done` / `.next`），但多一个状态：
 * **`pending`（待实装）** —— 条目已登记、机制本体还没做。
 * 这一类**必须显式标出来**（用户指定"剩下的先做个占位"），
 * 否则玩家拿到后会以为有效果 ✗。`tools/eternity-lab.mjs` 有断言守这条。
 *
 * ⚠️ 刻意**不调 `applyZone()`**：永恒里程碑的效果落在好几处（IP 保留 / 量子 / 熵 / …），
 *   按项目规矩"落点不唯一就不上色"。
 */
function buildEternityMilestones() {
  const box = el["eternity-milestone-list"];
  if (!box) return;
  box.innerHTML = "";
  for (const m of ETERNITY_MILESTONES) {
    const d = document.createElement("div");
    d.className = "ms";
    d.id = `ems-${m.id}`;
    d.innerHTML = `<span class="dot"></span><span class="txt">${m.desc}</span>` +
      `<span class="need" id="ems-${m.id}-need">第 ${m.need} 次永恒</span>`;
    box.appendChild(d);
  }
}

/**
 * ★★★ 2025 新实现（第三层设计稿 33~35 行）：**永恒升级「永恒增幅」的渲染**。
 *
 * ⚠️ 与实发**同源**：等级/倍率/价格分别来自
 *   `state.epMultLevel` / `epMultFactor` / `epMultPriceAt`（唯一入口）⇒
 *   不可能出现"显示 ≠ 实发" ✓（本项目在这上面栽过 4 次）
 */
function renderEternityUpgrades(state) {
  const lv = Math.max(0, Number(state.epMultLevel ?? 0) || 0);
  const f = epMultFactor(state);
  const price = epMultPriceAt(lv);
  const ep = state.eternityPoints ?? D(0);
  const can = ep.gte(price);
  const nextF = f.mul(ETERNITY_UPGRADES.epMult.effectMult);

  if (el["eternity-upg-epMult-lv"]) el["eternity-upg-epMult-lv"].textContent = `Lv ${lv}`;
  if (el["eternity-upg-epMult-desc"]) {
    el["eternity-upg-epMult-desc"].textContent = lv > 0
      ? `最终获得的永恒点 ×${fmt(f, 0)}（下一级 ×${fmt(nextF, 0)}）`
      : ETERNITY_UPGRADES.epMult.desc;
  }
  if (el["eternity-upg-epMult-cost"]) {
    el["eternity-upg-epMult-cost"].textContent = `花费 ${fmt(price, 0)} 永恒点`;
  }
  if (el["max-eternity-upg-epMult-n"]) {
    el["max-eternity-upg-epMult-n"].textContent = fmt(epMultAffordableIn(lv, ep), 0);
  }
  const b = el["btn-eternity-upg-epMult"];
  if (b) {
    b.classList.toggle("affordable", can);
    b.disabled = !can;
  }
  const bm = el["btn-max-eternity-upg-epMult"];
  if (bm) bm.disabled = !(epMultAffordableIn(lv, ep) > 0);
}

/**
 * ★★★ 2025 新实现（`docs/NEKO.md` §7 / 设计稿 §10）：**猫猫卡片**。
 *
 * 守「显示 == 实发」：好感度 / 指数 / 下一档全部走 config 的
 *   `nekoGlobalExponent` / `nekoNextTier` / `NEKO`（**唯一入口**）⇒ 与实发不可能脱节 ✓
 *
 * ⚠️ 接入 N.E.K.O SDK 是**另一条线**（NEKO.md §3~§9，走 `neko-minigame-sdk`）。
 *   本卡片在**未接入**时也完整可用（好感度由游戏内原生机制驱动）——
 *   这正是 NEKO.md §7 明写的定位 ✓
 */
function renderNeko(state) {
  const a = Number(state?.nekoAffinity ?? 0) || 0;
  const exp = nekoGlobalExponent(state);
  const next = nekoNextTier(state);

  // ★★★ 2025（`docs/NEKO.md` §3~§9）：**宿主接入状态** ——
  //   用户原则「没有 ui 真的很容易误判」⇒ 接没接上必须看得见 ✓
  //   ⚠️ 判据**调真函数** `nekoHostPresent()`（读宿主注入的 `#neko-minigame-host-launch`），
  //      不是看 `window.lanlan_config`（那是**旧式集成**，soccer/badminton 用的另一条路 ✗）
  if (el["neko-sdk-state"]) {
    const host = nekoHostPresent(globalThis.document);
    el["neko-sdk-state"].textContent = host
      ? "已检测到宿主（本游戏尚未注册 ⇒ 暂不连接）"
      : "未接入（本页无宿主）";
  }
  if (el["neko-chat-badge"]) {
    el["neko-chat-badge"].textContent = nekoHostPresent(globalThis.document) ? "宿主已就绪" : "未接入";
  }

  if (el["neko-affinity"]) el["neko-affinity"].textContent = String(Math.round(a * 100) / 100);
  if (el["neko-exponent"]) {
    el["neko-exponent"].textContent = exp === 1
      ? "^1（未生效）"
      : `^${exp.toFixed(7)}（全局加成取这个幂）`;
  }
  if (el["neko-next"]) {
    el["neko-next"].textContent = next
      ? `好感度 > ${next.need} ⇒ 全局 ^${next.pow}` + (a <= next.need ? `（还差 ${(next.need - a).toFixed(1)}）` : "")
      : "已全部生效（^1.0221151）";
  }
  // 进度条：0 ⇒ 空、100 ⇒ 满（负值按 0 显示，因为负向不影响收益 ✓）
  if (el["neko-bar"] && el["neko-bar-text"]) {
    const pct = Math.max(0, Math.min(1, a / NEKO.max));
    el["neko-bar"].style.width = `${(pct * 100).toFixed(1)}%`;
    el["neko-bar-text"].textContent = `${Math.round(a)} / ${NEKO.max}`;
  }
  if (el["neko-drift"]) {
    const room = nekoDriftRoom(state);
    el["neko-drift"].textContent = room > 0
      ? `还剩 ${room} 点（每 5 分钟 < ${NEKO.driftMax} 点${room < NEKO.driftMax ? "，已用掉一部分" : ""}）`
      : `已用完（每 5 分钟 < ${NEKO.driftMax} 点）—— 等窗口过去`;
  }
  // ★★★ 2025（`NEKO.md` §10）：**道具**（三个）——
  //   判据全部走 `NEKO_ITEMS` + `nekoDriftRoom`（**同一套来源**，不在这里重写 ✗）
  {
    const room = nekoDriftRoom(state);
    let usable = 0;
    for (const it of Object.values(NEKO_ITEMS)) {
      const canRes = it.can(state) === true;
      const can = canRes && room > 0;
      if (canRes) usable++;
      const btn = el[`btn-neko-item-${it.id}`];
      if (btn) {
        btn.classList.toggle("affordable", can);
        btn.disabled = !can;
      }
      const cost = el[`neko-item-${it.id}-cost`];
      if (cost) {
        cost.textContent = !canRes ? `需要：${it.costText}`
          : room <= 0 ? `窗口额度已用完（每 5 分钟 < ${NEKO.driftMax} 点）`
            : it.costText;
      }
    }
    if (el["neko-item-badge"]) el["neko-item-badge"].textContent = `${usable} / ${Object.keys(NEKO_ITEMS).length} 可用`;
  }
  // ★ 档位阶梯：**只建一次 DOM，之后只改文本 + class** ✓
  //   （踩过：每帧 `innerHTML` 会重置 hover ⇒ 闪烁 ✗，见文件里其它渲染块的注释）
  const box = el["neko-tier-list"];
  if (box) {
    if (!box.dataset.built) {
      box.dataset.built = "1";
      for (const t of NEKO.tiers) {
        const d = document.createElement("div");
        d.id = `neko-tier-${t.need}`;
        box.appendChild(d);
      }
    }
    for (const t of NEKO.tiers) {
      const d = document.getElementById(`neko-tier-${t.need}`);
      if (!d) continue;
      const on = a > t.need;
      d.className = on ? "on" : "";
      d.innerHTML = `<span>好感度 &gt; ${t.need}</span><b>全局 ^${t.pow}${on ? "　✅ 已生效" : ""}</b>`;
    }
  }
}

/** 永恒里程碑的状态刷新（只在 `render()` 里调，不重建 DOM） */
function renderEternityMilestones(state) {
  const box = el["eternity-milestone-list"];
  if (!box) return;
  let doneCount = 0;
  let nextFound = false;
  for (const m of ETERNITY_MILESTONES) {
    const node = document.getElementById(`ems-${m.id}`);
    if (!node) continue;
    const reached = hasEternityMilestone(state, m.id);
    if (reached) doneCount++;
    const isNext = !reached && !nextFound;
    if (isNext) nextFound = true;
    node.classList.toggle("done", reached);
    node.classList.toggle("next", isNext);
    // `pending` 的条目**即使达成也标成待实装**（避免"拿到了却没效果"的误解）
    node.classList.toggle("pending", m.pending === true);
    const need = document.getElementById(`ems-${m.id}-need`);
    if (need) {
      if (m.pending) need.textContent = reached ? `已达成 · 待实装` : `第 ${m.need} 次永恒 · 待实装`;
      else if (m.id === "em5" && reached) need.textContent = `已达成 · 当前 ×${fmt(em5IpMult(state), 2)}`;
      else need.textContent = reached ? "已达成" : `第 ${m.need} 次永恒`;
    }
    if (m.pending && node.title !== (m.pendingWhy ?? "")) node.title = m.pendingWhy ?? "";
  }
  if (el["eternity-ms-badge"]) el["eternity-ms-badge"].textContent = `${doneCount} / ${ETERNITY_MILESTONES.length}`;
}

/** 虚空科技的父标签 / 子页映射（子页激活时父标签也要亮着） */
const TAB_PARENT = { void: "void", zpe: "void", de: "de", quantum: "quantum", infinity: "infinity", infdeep: "infinity", eternity: "eternity" };
/** 子页 → 它的父标签（父标签在子页激活时保持高亮） */
const SUB_WRAP = {
  zpe: "tab-wrap-void",
  infdeep: "tab-wrap-infinity",
  // ★★★ 2025（用户裁定）：主控台的**三个子页**（主控台本体 / 梦想 / 猫猫）
  //   —— 与虚空科技同一套表现形式 ✓
  dream: "tab-wrap-console",
  neko: "tab-wrap-console",
};
const ALL_PANELS = [
  "console", "dream", "neko",          // ★ 2025：主控台的三个子页
  "void", "zpe", "de", "quantum", "infinity", "infdeep", "eternity",
];

export function activateTab(name) {
  for (const t of el["tabs"].querySelectorAll("[data-tab]")) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on && !t.classList.contains("flyout-item"));
    if (t.classList.contains("flyout-item")) t.classList.toggle("active", on);
  }
  // 父标签高亮：表驱动（原来硬编码 void/zpe，加第二个子页时会漏）
  for (const [sub, wrapId] of Object.entries(SUB_WRAP)) {
    el[wrapId]?.classList.toggle("sub-active", name === sub);
  }
  for (const p of ALL_PANELS) {
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
 * 而 `formulas.js` 里的实际实现是 `countFreqAddTerm = 1 + 0.05×等级`（仿射）。
 * 100 级时卡片显示 ×13780，实际只有 ×6 —— 差 2000 倍。
 * 而且这个 bug 是从原稿 0.3.4 继承来的（那边 `getCurrentEffect()` 写 1.1^lv，
 * `engine.js` 用 1+lv×0.05）。
 *
 * 结论：**描述由公式算，就不会再脱节。**
 */
function effectText(state, id) {
  if (id === "particleBoost") {
    // 实际是仿射（加法）形式，不是 m^等级
    return `所有产出 ×${countFreqAddTerm(state).toNumber().toFixed(2)}`;
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

/** 上一次渲染进日志面板的内容签名（见 render() 里的说明） */
let lastLogSig = "";

export function render(state) {
  // ══════════════════════════════════════════════════════════
  // ★★★ 2025（用户裁定 + 用户质问「为什么要我再永恒一次？bug 还是特性？」）
  //        ⇒ **是 bug**，不该让玩家多跑一轮。这里做**实时自愈**。
  // ══════════════════════════════════════════════════════════
  // 正确语义：「永恒过的档 ⇒ 永恒前的所有页面**永久解锁**」
  //   所以判据就是 `eternityCount > 0` —— **不需要**依赖"那一刻打点成功"。
  //
  // 原来只有两条路：① 载入兜底（`deserialize`）② 永恒那一刻打点（`doEternity`）
  //   ⇒ 若玩家**当前内存里**的记录是空的（旧档、或当初那一刻没打点）
  //     ⇒ 必须**再永恒一次**才补上 ⇒ 玩家看到的就是"页面被重置" ✗
  //   （用户原话：「已经永恒一次了不应该一直解锁么」—— 对 ✓）
  //
  // ⇒ 加第三条路：**渲染时按 `eternityCount > 0` 补齐**。
  //   `markPageUnlocked` 是**幂等**的（已为 true 时直接 return false）⇒ 每帧调也无副作用 ✓
  //   ⇒ 玩家**下一帧**就自愈，不用再永恒一次 ✓
  if ((state.eternityCount ?? 0) > 0) {
    for (const k of PAGE_KEYS) markPageUnlocked(state, k);
  }
  buildIcUI();      // IC panel: create once
  renderIc(state);  // IC panel: text/class only
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

  // ── 顶部「全局加成」槽 ──
  //   它显示的是**真·全局**那个乘积，以及它的三个因子 —— 每个因子按自己的乘区上色，
  //   这样玩家一眼能分清「计数频率（那个升级）」和「全局（乘积）」。
  {
    const parts = globalMultiplierParts(state);
    el["global-multiplier"].textContent = fmtMult(parts.total);
    // ★ 只改文本，不重建 DOM（每帧 innerHTML = 每帧重解析 + hover 状态被重置）
    el["gm-dream"].textContent = `梦想点 ×${fmt(parts.dream, 2)}`;
    el["gm-countfreq"].textContent = `计数频率 ×${fmt(parts.countFreq, 2)}`;
    el["gm-de"].textContent = `暗能量 ×${fmt(parts.de, 2)}`;
    // ★★★ 2025（NEKO.md §7）：好感度那一层**指数**也必须显示出来 ——
    //   否则 `dream × countFreq × de ≠ total`（三因子相乘**再取幂**）⇒ 显示自相矛盾 ✗
    if (el["gm-neko"] && parts.nekoExp !== 1) {
      el["gm-neko"].textContent = `好感度 ^${parts.nekoExp.toFixed(7)}`;
      el["gm-neko"].hidden = false;
    } else if (el["gm-neko"]) {
      el["gm-neko"].hidden = true;
    }
  }

  // ── 猫猫卡片（主控台，无条件刷新：好感度**不受面板显隐影响**）──
  renderNeko(state);

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
    // ★ 门槛（requireZpe）必须同时进"可购买判定"与"文案" ——
    //   踩过（第五例"显示 ≠ 实发"）：界面只看 `costDream`，于是把 v9「传承启迪」
    //   标成可购买、价格写"花费 1 梦想点"，**而引擎会因 `requireZpe: 1e8` 拒绝** ✗
    //   ⇒ 玩家看到能买却买不动，且不知道缺什么。
    const zpeGateOk = cfg.requireZpe == null || state.zpe.gte(cfg.requireZpe);
    const can = !owned && zpeGateOk &&
      (cfg.costDream ? state.dreamPoints.gte(cfg.costDream) : state.zpe.gte(cost));
    btn.classList.toggle("affordable", can);
    btn.classList.toggle("maxed", owned);
    $(`void-${cfg.id}-state`).textContent = owned ? "已购买 ✓" : "未购买";
    const priceText = cfg.costDream
      ? `花费 ${cfg.costDream} 梦想点`
      : `花费 ${fmt(cost)} ZPE`;
    // 门槛单独写出来（用「｜」分隔），而不是把它混进价格里 —— 价格与门槛是两回事
    const gateText = cfg.requireZpe == null ? "" : `｜需 ZPE ≥ ${fmt(cfg.requireZpe)}`;
    $(`void-${cfg.id}-cost`).textContent = owned
      ? "已生效"
      : priceText + gateText;
  }
  el["void-count"].textContent = String(voidOwned);
  // ★ 总数从 config 推导，不写死 9 —— 加第 10 个虚空升级时这里要跟着变
  el["tab-tag-void"].textContent = `${voidOwned}/${Object.keys(VOID_UPGRADES).length}`;
  el["zpe-multiplier"].textContent = fmtMult(zpeMultiplier(state));

  // ── 永恒（**先占位**：只显示门槛与"本次可得"，还没有永恒动作）──
  {
    const goal = new Decimal(10).pow(ETERNITY.goalLog10);
    const can = state.infinityPoints.gte(goal);
    // ★★ 2025 补漏：永恒页**也**必须走「曾经解锁过」的永久记录 ——
    //   原来这里直接 `can ? "可永恒" : "锁"`，而 `can` 看的是**本轮 IP** ⇒
    //   永恒后 IP 归零，标签立刻变回"锁"，玩家以为自己丢了永恒页 ✗
    //   （用户实测反馈：「我的永恒页面也被重置了」—— 与量子/无限/暗能量同一个病，
    //     我上一轮只改了那三个，漏了这个 ✗）
    //   `perma` 的判据：跑过永恒（`eternityCount > 0`）**或**已有永久记录。
    //   第一次达成时下面会 `markPageUnlocked` 打点 ⇒ 此后永久为真 ✓
    const perma = pageUnlocked(state, "eternity") || (state.eternityCount ?? 0) > 0;
    el["eternity-locked"].hidden = can;
    el["eternity-content"].hidden = !can;
    if (!can) {
      if (el["eternity-perma-hint"]) el["eternity-perma-hint"].hidden = !perma;
      if (el["eternity-locked-title"]) el["eternity-locked-title"].textContent = perma ? "永恒 · 本轮待推进" : "永恒未解锁";
    }
    el["eternity-need"].textContent = sci(Decimal.pow(10, ETERNITY.goalLog10));
    el["eternity-have"].textContent = fmt(state.infinityPoints);
    el["val-eternity"].textContent = fmt(state.eternityPoints, 0);
    el["eternity-gain"].textContent = fmt(eternityPointGain(state.infinityPoints), 0);
    el["eternity-count"].textContent = String(state.eternityCount ?? 0);
    // 标签：解锁过就**永不加锁**（与量子/无限/暗能量同一套语义）
    el["tab-tag-eternity"].textContent = can ? "可永恒" : (perma ? "待推进" : "锁");
    el["tab-eternity"].classList.toggle("locked", !(perma || can));
    if (perma || can) markPageUnlocked(state, "eternity");   // 幂等打点
    // ★ 永恒按钮：到 1e280 才可用（用户指定），且**手动**触发
    const be = el["btn-eternity"];
    be.disabled = !can;
    be.classList.toggle("affordable", can);
    el["eternity-status"].textContent = can ? "可永恒" : "需要 1e280 无限点";
  }

  // ★★ 2025：**坍缩加速器的渲染块已整个删除**（用户裁定 —— "否则会对机制解读有极大污染"）

  // ── 坍缩里程碑（铸币已删 ⇒ 只剩 rate / lube 两类）──
  {
    // ★ 坍缩里程碑：与虚空/暗能量里程碑**同一套状态**（done / next），只切 class
    {
      const done = new Set(tierMilestonesDone(state).map((m) => m.id));
      let nextFound = false;
      for (const m of TIER_MILESTONES) {
        const node = document.getElementById("tms-" + m.id);
        if (!node) continue;
        const isDone = done.has(m.id);
        const isNext = !isDone && !nextFound;
        if (isNext) nextFound = true;
        node.classList.toggle("done", isDone);
        node.classList.toggle("next", isNext);
        const need = document.getElementById("tms-" + m.id + "-need");
        if (need) need.textContent = isDone ? "已达成" : m.at + " 次大坍缩";
      }
      el["tier-ms-badge"].textContent = done.size + " / " + TIER_MILESTONES.length;
      // ★ 2025：永恒里程碑（同一套 done/next 约定；额外有 pending 态）
      renderEternityMilestones(state);
      // ★★★ 2025：永恒升级「永恒增幅」（设计稿 33~35 行）
      renderEternityUpgrades(state);
    }

  }

  // ── ZPE 引擎（虚空科技的第二个子页）──
  {
    const unlocked = zpeEngineUnlocked(state);
    el["zpe-engine-locked"].hidden = unlocked;
    el["zpe-engine-content"].hidden = !unlocked;
    // ★ 2025：解锁条件改为「1 次大坍缩」并送 1 级（里程碑奖励，不再花无限点）
    el["zpe-engine-unlock-cost"].textContent = state.bigCrunchCount?.gte(1) ? "条件已满足" : "1 次大坍缩";
    const btnUnlock = el["btn-unlock-zpe-engine"];
    const canUnlock = !unlocked && (state.bigCrunchCount ?? D(0)).gte(1);   // ★ 2025：解锁条件已改成「1 次大坍缩」（不再花无限点 ✗）
    btnUnlock.classList.toggle("affordable", canUnlock);
    btnUnlock.disabled = unlocked;
    btnUnlock.textContent = unlocked ? "已解锁 ✓" : "解锁（1 次大坍缩，送 1 级）";

    const lv = zpeEngineLevel(state);
    const prod = zpeEngineProdMult(state);
    const addBonus = zpeEngineAddBonus(state);
    const multBonus = zpeEngineMultBonus(state);
    // ★ 2025：量子项的显示**必须含引擎账**（否则与 `zpeMultiplier` 的实发不符 ✗）
    const qTerm = quantumZpeMultBonus(qOf(state), engineBonusMult(state));
    el["zpe-engine-level"].textContent = lv.gte(1e6) ? `10^${lv.log10().toNumber().toFixed(2)}` : fmt(lv, 0);
    el["zpe-engine-prod"].textContent = fmtMult(prod);
    // ★ 2025：这一格从"公式指数"改成"加法区加成"（设计稿第 1 条 ✓）
    el["zpe-engine-exp"].textContent = fmtMult(addBonus.max(1));
    el["zpe-engine-ip"].textContent = fmt(state.infinityPoints, 0);

    const can = zpeEngineAffordable(state);
    const cost = zpeEngineCost(state);
    el["zpe-engine-afford"].textContent = can > 0 ? `可买 ${can} 级` : "买不起";
    el["zpe-engine-cost"].textContent = `花费 ${fmt(cost)} 无限点`;
    const btnBuy = el["btn-buy-zpe-engine"];
    btnBuy.classList.toggle("affordable", state.infinityPoints.gte(cost));
    // 下一级的产出倍率：用一个"等级 +1"的浅拷贝算，避免手写预测公式
    const nextProd = zpeEngineProdMult({ ...state, zpeEngineLevel: lv.add(1) });
    el["zpe-engine-buy-desc"].textContent =
      `ZPE 产出 ${fmtMult(prod)} → ${fmtMult(nextProd)}`;

    // ★ 引擎机制（**4 条**）：只更新文本与 class，绝不重建 DOM。
    //   踩过的坑：这里原来是每帧 `innerHTML = …` —— 每帧重建会重置 `:hover`
    //   与 CSS 过渡，玩家鼠标一挪上去就**频繁闪烁**（用户实测报的 bug）。
    //   所以卡片在 `buildZpeMechanisms()` 里建一次，这里只改两个文本 + 一个 class。
    const mech = [
      {
        on: unlocked,
        now: `当前 ZPE 倍率 +${fmt(addBonus)}（加法区）` },
      {
        on: unlocked,
        now: `产出 ${fmtMult(prod)}｜倍率 ${fmtMult(multBonus)}` },
      {
        on: zpeEngineCountFreqUnlocked(state),
        now: zpeEngineCountFreqUnlocked(state)
          ? `计数频率已生效｜量子项 +${fmt(qTerm)}（q³/10）`
          : `量子项 +${fmt(qTerm)}（q³/10）｜计数频率等级 ${ZPE_ENGINE.countFreqLevel} 解锁` },
      {
        // ★ 设计稿第 4 条（之前漏列 ✗）：暗能量倍率 ×2^等级
        on: unlocked,
        now: `暗能量倍率 ×${fmtMult(multBonus)}（= 2^等级）` },
      {
        // ★★ 2025 B8：第 5 条 —— b区（指数区）。**前四条都只是高度，这条才改形状**
        on: matterTotalExponent(state) > 1 + 1e-9,
        now: matterTotalExponent(state) > 1 + 1e-9
          ? `物质产出 = { 前四条 } ^ ${matterTotalExponent(state).toFixed(3)}（斜率 ×${matterTotalExponent(state).toFixed(2)}）`
          : `k = 1（引擎等级 0 ⇒ 不生效）｜${MATTER_B_KNEE} 级饱和到 k = ${(1 + MATTER_B_KMAX).toFixed(0)}` },
    ];
    mech.forEach((m, i) => {
      const card = $(`zpe-mech-${i}`);
      if (!card) return;
      card.classList.toggle("affordable", m.on);
      const st = $(`zpe-mech-${i}-state`);
      if (st) st.textContent = m.on ? "已生效" : "未生效";
      const now = $(`zpe-mech-${i}-now`);
      if (now) now.textContent = m.now;
    });
  }

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025：**自动化状态**（设计稿第 24 行）
  // ══════════════════════════════════════════════════════════
  // ⚠️ 位置：**主控台 → 梦想（自动化）子页**（用户裁定子页归属）
  //   ⇒ 从 ZPE 渲染块里**搬出来**、变成无条件刷新（它是独立面板，不随 ZPE 页显隐）✓
  // 用户原则：「**没有 ui 真的很容易误判**」—— 这批自动化早就实现了
  //   （`isAutoAcquire` 管升级/熵阱、梦想升级 `autoBuyDe` 管 5 条暗能量升级），
  //   但页面上**一处都不显示** ⇒ 看不出它在跑 ✗
  // ⚠️ 判据全部**调真函数**（`isAutoAcquire` / `dreamUpgradeEffects`），不在这里重写条件 ✓
  {
    const acqUp = isAutoAcquire(state, "upgrade");
    const acqTrap = isAutoAcquire(state, "trap");
    const v9 = !!state.voidUpgrades?.v9;
    if (el["auto-acquire"]) {
      el["auto-acquire"].textContent = acqUp || acqTrap
        ? `已开启（升级${acqUp ? "✓" : "✗"} / 熵阱${acqTrap ? "✓" : "✗"}）`
        : v9 ? "v9 已买，但门槛未满足" : "未开启（需虚空升级 v9）";
    }
    if (el["auto-de"]) {
      const ids = dreamUpgradeEffects(state).autoBuyDe ?? [];
      el["auto-de"].textContent = ids.length
        ? `已开启 ${ids.length} 条：${ids.join(" / ")}`
        : `未开启（需梦想升级，共 4 条）`;
    }
  }
  // 梦想子页的徽标：有自动化在跑就标"部分实装"，否则"壳子" ✓
  if (el["dream-page-badge"]) {
    const anyAuto = isAutoAcquire(state, "upgrade") || isAutoAcquire(state, "trap")
      || (dreamUpgradeEffects(state).autoBuyDe ?? []).length > 0;
    el["dream-page-badge"].textContent = anyAuto ? "自动化部分实装" : "壳子";
  }

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
  // ★★ 2025（用户裁定）：暗能量是靠**按钮**启动的（不是自动判定）——
  //   所以"保持解锁"的正确做法是：**标签永不上锁**（解锁过就一直可点进去），
  //   里面照旧显示"启动相变仪"的按钮与本轮条件（条件已随虚空升级清零 ⇒ 需重新满足）。
  //   原来标签在 `phaseTransmuterUnlocked === false` 时直接上锁 ⇒ 永恒后点不进去 ✗
  const perma = pageUnlocked(state, "de");
  const unlocked = state.phaseTransmuterUnlocked === true;
  el["tab-tag-de"].textContent = unlocked ? fmt(state.darkEnergy) : (perma ? "待推进" : "锁");
  el["tab-de"].classList.toggle("locked", !(perma || unlocked));
  el["de-locked"].hidden = unlocked;
  el["de-content"].hidden = !unlocked;

  if (!unlocked) {
    if (el["de-perma-hint"]) el["de-perma-hint"].hidden = !perma;
    if (el["de-locked-title"]) el["de-locked-title"].textContent = perma ? "相变仪 · 本轮待重启" : "相变仪未解锁";
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
      // ★ 把 state 也传进去：有些描述必须按实际状态算（例如凝聚斜率要看 v5 买没买）
      $(`de-${cfg.id}-desc`).textContent = cfg.desc(lv, state);
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

  // ── ★ 跨度层：**无条件刷新** ──
  //   它在 `renderQuantum` 里会因"量子页本轮未推进"被提前 return 跳过，
  //   而它恰恰在**打破无限之后**才生效 ⇒ 必须放在这里 ✓（见 renderSpanLayer 的说明）
  renderSpanLayer(state);

  // ── 无限面板（金色，独立标签页）──
  renderInfinity(state);

  // ── 日志 ──
  //
  // ⚠️ 判据不能只看**条数**（原来就是 `childElementCount !== state.log.length`）。
  //    state.log 有 LOG_MAX = 60 的上限，一旦写满，长度永远是 60、
  //    DOM 里也永远有 60 个子元素 —— 两边相等，于是**日志面板从此再也不刷新**，
  //    玩家看到的是冻结的旧消息（实测：第 61 条之后一条都进不去）。
  //    正确判据是「最近一条」的身份：长度 + 时间戳 + 文本。
  const logEl = el["log-panel"];
  const lastLog = state.log[state.log.length - 1];
  const logSig = `${state.log.length}|${lastLog ? lastLog.t : 0}|${lastLog ? lastLog.text : ""}`;
  if (logSig !== lastLogSig) {
    lastLogSig = logSig;
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
  // ★★ 2025（用户裁定）：**页面解锁与"本轮是否推进到"分开** ——
  //   · 曾经解锁过（`pageUnlocked`，**永不重置**）⇒ 标签**不再上锁**、
  //     但本轮还没摸到 1e25 时显示"已解锁 · 待推进"，而不是把页面收回去 ✗
  //   · 本轮 `peakMatter ≥ 1e25` ⇒ 正常显示内容
  //   原来只判 `collapseUnlocked`（= peakMatter）⇒ 永恒归零后整页重新上锁 ✗
  const perma = pageUnlocked(state, "quantum");
  const live = collapseUnlocked(state);
  const showContent = live;                       // 只有本轮真达到才显示内容
  const lockedBox = !live;                        // 未达到（无论是否解锁过）都显示提示框

  el["q-locked"].hidden = !lockedBox;
  el["q-content"].hidden = !showContent;
  el["q-need"].textContent = fmt(new Decimal(COLLAPSE.unlockMatter), 0);
  // 解锁过之后，提示框的措辞要变（否则会显示成"还没解锁"的误导文案）
  if (lockedBox) {
    if (el["q-perma-hint"]) el["q-perma-hint"].hidden = !perma;
    if (el["q-locked-title"]) el["q-locked-title"].textContent = perma ? "量子系统 · 本轮待推进" : "量子系统未解锁";
  }

  // 标签：解锁过就**永不加锁**（这是本次修复的核心）；未解锁才显示"锁"
  const tabUnlocked = perma || live;
  const qTab = el["tab-tag-quantum"];
  qTab.textContent = showContent ? fmt(state.quantum, 0) : (perma ? "待推进" : "锁");
  el["tab-quantum"].classList.toggle("locked", !tabUnlocked);

  if (!showContent) return;

  el["val-quantum"].textContent = fmt(state.quantum, 0);
  el["quantum-sub"].textContent =
    `已捕获 ${state.quantumPairs.toNumber()} 对 · 累计 ${state.quantumPairsTotal.toNumber()} 对`;

  // ── 量子涨落捕获（第三层）──
  const need = quantumZpeRequirement(state.quantumPairs, quantumStepMult(state), state);
  const needLog = need.log10().toNumber();
  const curZpeLog = state.zpe.gt(0) ? state.zpe.log10().toNumber() : 0;
  el["quantum-pairs"].textContent = `${state.quantumPairs.toNumber()} 对`;
  // ★ 2025 统一科学计数法：原 `1e${needLog}` 有歧义（e 后跟小数）⇒ 规范成 `1.00eN` ✓
  el["quantum-next-cost"].textContent = `${sci(Decimal.pow(10, needLog))} ZPE`;
  el["quantum-cur-zpe"].textContent = fmt(state.zpe);
  // 进度：用对数刻度量「离门槛还差几个数量级」
  const qProg = needLog > 0 ? Math.max(0, Math.min(1, curZpeLog / needLog)) : 0;
  el["quantum-bar"].style.width = `${(qProg * 100).toFixed(1)}%`;
  el["quantum-bar-text"].textContent = `${(qProg * 100).toFixed(1)}%`;

  // ── ★ 量子给出的 5 条加成（**必须含引擎账** ⇒ 显示 == 实发）──
  //   ⚠️ 2025 踩过：引擎账原来只乘在 `formulas.js` 的**调用处**，而这里显示"纯量子给的"部分
  //      ⇒ 实测**面板显示 +21600，实发 +1e36**（差 1e31.7）✗ 典型的"显示 ≠ 实发"
  //   ⇒ 修法：`engineBonusMult` 作为**第二参**传进同一个函数 ⇒ 两边共用一条公式 ✓
  const ebmQ = engineBonusMult(state);
  el["quantum-mult"].textContent = fmtMult(quantumEntropyMultiplier(state.quantum, ebmQ));
  el["quantum-degain"].textContent = fmtMult(new Decimal(1).add(quantumDeGainBonus(state.quantum, ebmQ)));
  // ★ 2025：R 退休后，这一行改显**粒子增幅速率 b**（替代 R 的那一位）。
  //   b = b0·(1+√q/10)·里程碑·档位加速·infinityRateMult ⇒ 阈值软上限。
  //   玩家看到的含义：粒子获得的时变增幅 `g = 10^(b·本轮时间)` 的**对数斜率**（阶/秒）。
  el["quantum-grow"].textContent = `${particleBoostRate(state).toFixed(4)} 阶/秒`;
  el["quantum-demult"].textContent = fmtMult(new Decimal(1).add(quantumDeMultBonus(state.quantum, ebmQ)));
  // ★ 2025 新增：**量子 → ZPE 倍率的加法区加成**（ZPE 引擎设计稿第 3 条 ✓）
  //   与引擎同一个函数 `quantumZpeMultBonus` ⇒ 显示即实发 ✓
  if (el["quantum-zpemult"]) el["quantum-zpemult"].textContent = `+${fmt(quantumZpeMultBonus(state.quantum, ebmQ))}`;

  // ── ★ 跨度层（2025 用户方案）：k 由量子给，把暗能量撬到 inf ──
  //    ⚠️⚠️ **不在这里渲染**：本函数在 `!showContent` 时**提前 return**（见上），
  //      而跨度层恰恰是"打破无限之后才生效"的机制 ——
  //      那时量子页可能显示「已解锁 · 待推进」⇒ 跨度层整块**永远不刷新** ✗
  //      （用户裁定：「ui 确保在**购买门槛压平后**正确显示就行」⇒ 就是这条）
  //    ⇒ 已抽成 `renderSpanLayer(state)`，在 `render()` 里**无条件**调用 ✓

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
  //   ⚠️ 跨度层**不在这里**渲染 —— 本函数会在 `!showContent` 时提前 return，
  //      而跨度层是"打破无限之后"才生效的 ⇒ 见 `renderSpanLayer`（在 render() 里无条件调用）✓
}

// ══════════════════════════════════════════════════════════
// 无限面板（金色）—— 独立标签页
// ══════════════════════════════════════════════════════════

function renderInfinity(state) {
  const cap = crunchThreshold();
  // ★★ 2025（用户裁定）：`perma` = 曾经解锁过（**永不重置**）⇒ 标签**不再上锁**；
  //   `live` = 本轮已经摸到物质硬顶或坍缩过 ⇒ 才显示内容。
  //   原来只判本轮条件 ⇒ 永恒把 `peakMatter` / `bigCrunchCount` 清零后整页重新上锁 ✗
  const perma = pageUnlocked(state, "infinity");
  const live = state.peakMatter.gte(cap) || state.bigCrunchCount.gt(0);

  el["inf-locked"].hidden = live;
  el["inf-content"].hidden = !live;
  el["inf-need"].textContent = CRUNCH_AT_LABEL;
  if (!live) {
    if (el["inf-perma-hint"]) el["inf-perma-hint"].hidden = !perma;
    if (el["inf-locked-title"]) el["inf-locked-title"].textContent = perma ? "无限系统 · 本轮待推进" : "无限系统未解锁";
  }

  const tab = el["tab-tag-infinity"];
  tab.textContent = live ? fmt(state.infinityPoints, 0) : (perma ? "待推进" : "锁");
  el["tab-infinity"].classList.toggle("locked", !(perma || live));

  if (!live) return;

  el["val-infinity"].textContent = fmt(state.infinityPoints, 0);
  el["bigcrunch-count"].textContent = String(state.bigCrunchCount.toNumber());
  el["bigcrunch-gain"].textContent = fmt(bigCrunchGain(state), 0);

  const broken = state.brokenInfinity;
  // ★★ 2025（用户裁定）：**过载按「物质获得速率」触发，不再按物质数量** ——
  //   阈值 = `Number.MAX_VALUE = 1.8e308`（双精度上限，卡的是"每秒获得多少"）。
  //   ⇒ 界面必须显示**速率**口径（原来显示"距拐点 N 阶"= 数量口径，已过时 ✗）
  const ovT = overloadThreshold(state);          // 仍用于"打破无限后的数量门槛"显示
  const preRate = matterRate(state);             // 未削减的获得速率（唯一入口）
  const ov = overloadFactor(state, preRate);
  el["bigcrunch-need"].textContent = broken
    // ★ 2025 统一科学计数法（原 `1e${ovT}` 有歧义：看着像 e 后跟小数）
    ? sci(Decimal.pow(10, ovT.toNumber()))
    : CRUNCH_AT_LABEL;
  if (!broken) {
    el["overload-state"].textContent = "硬顶（未打破）";
  } else if (ov.gte(1)) {
    // 距触发还差几个数量级（**对数域**算，避免 1e1943 溢出成 Infinity ✗）
    const gap = OVERLOAD.rateThresholdLog10.toNumber() - preRate.log10().toNumber();
    el["overload-state"].textContent = `无（速率距 1.8e308 还差 ${gap.toFixed(1)} 阶）`;
  } else {
    const over = preRate.log10().toNumber() - OVERLOAD.rateThresholdLog10.toNumber();
    el["overload-state"].textContent = `×${fmt(ov, 3)}（速率超 1.8e308 已 ${over.toFixed(1)} 阶）`;
  }

  const canCrunch = broken && canBigCrunch(state);
  const bb = el["btn-bigcrunch"];
  bb.disabled = !canCrunch;
  bb.classList.toggle("affordable", canCrunch);
  el["bigcrunch-status"].textContent = !broken
    ? "到顶强制触发"
    : canCrunch ? "可以坍缩" : "物质不足";
  el["bigcrunch-desc"].textContent = broken
    ? `手动触发。跑得越深收益越高；获得速率超过 1.8e308 后进入**过载**，速率按 1/(1+超出/${OVERLOAD.knee}) 渐近削弱`
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

  renderInfinityUpgrades(state);
}

/**
 * ∞ 层：无限升级的渲染。
 *
 * ⚠️ 价格走 `infinityUpgradeCost()`、效果从公式推导 —— 界面不许自己算一遍
 *    （consistency.mjs 的硬要求）。
 */
function renderInfinityUpgrades(state) {
  const ip = state.infinityPoints;
  let owned = 0;
  for (const id of INFINITY_ORDER) {
    const cfg = INFINITY_UPGRADES[id];
    const btn = $(`inf-btn-${id}`);

    // ★★★ 2025 修复（用户报告：「ip点倍增初始×1，购买一次后应该 ×2，但我看着还是 ×1」）：
    //   `ipDouble`（① 无限增幅）**被移到了置顶的静态壳**，它的 id 是 `inf-ipdouble-row`
    //   （小写 d！）而不是 `inf-btn-ipDouble` ⇒ 本循环的 `$(\`inf-btn-${id}\`)` 取不到
    //   ⇒ `if (!btn) continue` **每帧把它跳过** ⇒ 那一行的
    //      `inf-ipDouble-state`（"Lv N"）/ `inf-ipDouble-cost`（价格）/ `max-ipDouble-n`
    //      **从来没被更新过**，永远停在 index.html 的静态初值 "Lv 0" / "—" / "0" ✗
    //   （实发侧 `ipDoubleMult()` 一直是对的 ⇒ 这是纯"显示 ≠ 实发"的显示侧 bug）
    //   ⇒ 单独在这里渲染它，然后 continue（它没有走通用分支的那些元素）✓
    if (id === "ipDouble") {
      const lvIpD = state.ipDoubleLevel ?? D(0);
      const effIpD = infinityUpgradeEffect(state, id);       // ★ 与实发同源（唯一入口）
      const costIpD = infinityUpgradeCost(state, id);
      // ★★★ 2025（用户裁定）：**删掉"需先打破无限"这个门槛**。
      //   用户原话：「无限增幅开局买不了？我们无限一次的时间这么长，开局还买不到重要的升级不扯淡么？
      //             移除购买无限增幅需要打破无限这个要求。因为打破无限本身也需要 128 个无限点」
      //   ⇒ 合理：**IP 的第一个来源就是大坍缩**，而打破无限要 128 IP ⇒
      //     在打破之前，① 是**唯一**能花 IP 的地方 ⇒ 挡住它等于"IP 完全没用" ✗
      //   ⚠️ 实发侧本来就没这个门槛（`buyInfinityUpgrade` 只对 `thresholdFlat` 强制）
      //      ⇒ 这又是一处**"显示门槛 ≠ 实发门槛"**（显示比实发严）—— 修的是 UI ✓
      const canIpD = state.infinityPoints.gte(costIpD);
      if (el["inf-ipDouble-state"]) el["inf-ipDouble-state"].textContent = `Lv ${fmt(lvIpD, 0)}`;
      if (el["inf-ipDouble-cost"]) {
        el["inf-ipDouble-cost"].textContent = `花费 ${fmt(costIpD, 0)} 无限点`;
      }
      if (el["inf-ipDouble-desc"]) {
        // 与实发同源：`effIpD.mult` 就是 `ipDoubleMult(state)`（×2^等级）
        el["inf-ipDouble-desc"].textContent = lvIpD.gt(0)
          ? `无限点收益 ×${fmt(effIpD.mult, 0)}（下一级 ×${fmt(effIpD.mult.mul(cfg.effectMult), 0)}）`
          : cfg.desc;
      }
      const nIpD = ipDoubleAffordableIn(lvIpD.toNumber(), state.infinityPoints);
      if (el["max-ipDouble-n"]) el["max-ipDouble-n"].textContent = fmt(nIpD, 0);
      const bbIpD = el["inf-btn-ipDouble"];
      if (bbIpD) {
        bbIpD.classList.toggle("affordable", canIpD);
        bbIpD.disabled = !canIpD;
      }
      if (el["btn-max-ipDouble"]) el["btn-max-ipDouble"].disabled = !(nIpD > 0);
      owned += lvIpD.gt(0) ? 1 : 0;
      continue;
    }

    if (!btn) continue;
    const cost = infinityUpgradeCost(state, id);
    const bought = !cfg.repeatable && infinityUpgradeOwned(state, id);
    //   （原来这行还含 "coinage" ⇒ 删铸币时被整行删掉 ✗）
    const level = cfg.repeatable ? (state.ipDoubleLevel?.toNumber() ?? 0) : 0;
    if (bought || level > 0) owned++;
    // ★ 门槛与价格一样，必须**同源**地进"可购买判定 + 文案"。
    //   踩过（同一类，且这次是我自己埋的）：`thresholdFlat`（门槛压平）在引擎里被
    //   `brokenInfinity` 挡住，但界面只比 IP ⇒ 会把它标成可购买、也不说缺什么 ✗
    //   ⇒ 与虚空升级的 `requireZpe` 用同一套写法。
    const gateOk = id !== "thresholdFlat" || state.brokenInfinity;
    const can = !bought && gateOk && ip.gte(cost);
    btn.classList.toggle("affordable", can);
    btn.classList.toggle("maxed", bought);
    btn.disabled = bought;
    $(`inf-${id}-state`).textContent = cfg.repeatable
      ? `Lv ${fmt(state.ipDoubleLevel ?? 0, 0)}`
      : bought ? "已购买 ✓" : "未购买";
    $(`inf-${id}-cost`).textContent = bought
      ? "已生效"
      : `花费 ${fmt(cost, 0)} 无限点` + (gateOk ? "" : "｜需先打破无限");

    // ★ 效果文本从公式推导（不许手写），买下后显示**当前实际值**
    const eff = infinityUpgradeEffect(state, id);
    let descText = cfg.desc;
    if (id === "ipDouble" && level > 0) {
      descText = `无限点收益 ×${fmt(eff.mult, 0)}（下一级 ×${fmt(eff.mult.mul(cfg.effectMult), 0)}）`;
    } else if (id === "ipToZpe" && state.ipToZpeBought) {
      descText = `ZPE 倍率 +${fmt(eff.bonus)}（随无限点增长）`;
    } else if (id === "ipToTransmuter" && state.ipToTransmuterBought) {
      descText = `相变仪转换速率 ${fmtMult(eff.mult)}`;
    } else if (id === "ipTime" && state.ipTimeBought) {
      // ④ 实时产点：显示速率 + 本次已累计（封顶后提示该收了）
      const capTxt = eff.capGain ? `，单次上限 ${fmt(eff.capGain, 0)} 点` : "";
      descText = `每秒 +${fmt(eff.perSecond, 3)} 点（${fmt(eff.perHour, 0)} 点/小时${capTxt}）` +
        (eff.accrued.gt(0) ? `　本次已实时进账 ${fmt(eff.accrued)} 点` : "") +
        (eff.capped ? "　⚠️ 已到 30 分钟上限，该大坍缩了" : "");
    } else if (cfg.startLog10 != null) {
      descText = bought
        // ★ 2025 统一科学计数法（原 `1e${activeLog10}` 有歧义）
        ? `每次大坍缩后以 ${sci(Decimal.pow(10, eff.activeLog10))} 物质开局（当前生效的一档）`
        : cfg.desc;
    } else if (cfg.rateMult != null) {
      descText = bought
        ? `量子成长速率上限 ×${eff.totalMult.toFixed(3)}（已叠加）`
        : cfg.desc;
    }
    $(`inf-${id}-desc`).textContent = descText;
  }
  el["inf-upgrade-count"].textContent = `${owned} / ${INFINITY_ORDER.length}`;

  // 收入明细：深度部分 + 耗时部分（④）
  const elapsed = state.infinityElapsed ?? 0;
  // ★★ 2025：这里原来手写 `Decimal.pow(effectMult, 等级)` —— 与实发侧脱节的第二处 ✗
  //   统一走唯一入口 `ipDoubleMult(state)`（见 engine.js 同处的注释）
  const perHour = state.ipTimeBought
    ? new Decimal(3600).div(INFINITY_UPGRADES.ipTime.secondsPerPoint)
      .mul(ipDoubleMult(state))
    : new Decimal(0);
  el["inf-income"].textContent = perHour.gt(0)
    ? `${fmt(perHour, 0)} 点/小时（耗时部分）`
    : "只有深度收益（买「无限长河」后按耗时给）";
  el["inf-elapsed"].textContent = `${fmtTime(elapsed)} · 本次已攒 ${fmt(new Decimal(elapsed).div(INFINITY_UPGRADES.ipTime.secondsPerPoint), 0)} 点`;
}

// ══════════════════════════════════════════════════════════
// 事件绑定
// ══════════════════════════════════════════════════════════

/**
 * 给 **index.html 里静态写死**的那些"升级 / 解锁"按钮补上乘区色。
 *
 * 为什么要有这个函数（用户 2025 指出）：
 *   数据驱动的五张升级列表（主升级 / 虚空 / 暗能量 / 无限 / 梦想）都走 `applyZone()` ✓，
 *   但**静态按钮**（熵阱、ZPE 引擎升格、相变仪解锁、坍缩加速）的颜色是
 *   直接写死在 `index.html` 的 `class="btn zone zone-xxx"` 上的 ✗ —— 于是：
 *     · 换乘区时它们**不会跟着变**（两处数据源 ⇒ 迟早脱节）；
 *     · 而且 `-max`（买满）那几个**一个颜色都没有** ✗
 *   ⇒ 统一改成从这里按 `ZONE_OF` 上色：**唯一数据源**，与其它列表同一套规矩 ✓
 *
 * 判据仍是「只看**加成作用的位置**」，不看它属于哪个页面（见 config.js 的 `ZONE_OF`）。
 * 只建一次（与 `buildZpeMechanisms` 同理），在 `render()` 里做会每帧重建 ⇒ hover 闪烁 ✗
 */
function applyStaticZones() {
  const pairs = [
    ["btn-buy-trap", "trap"],                       // 熵阱 → 熵产出
    ["btn-unlock-zpe-engine", "zpeEngine"],         // 启动引擎 → ZPE
    ["btn-buy-zpe-engine", "zpeEngine"],
    ["btn-buy-zpe-engine-max", "zpeEngine"],
    ["btn-unlock-transmuter", "transmuter"],        // 相变仪 → 暗能量
    ["btn-bigcrunch", "bigcrunch"],                 // 大坍缩 → 无限点收益
    ["btn-break-infinity", "breakInfinity"],        // 打破无限 → 无限点收益
  ];
  for (const [elId, zoneId] of pairs) {
    const node = el[elId] ?? $(elId);
    if (node) applyZone(node, zoneId);
  }
}

/**
 * ★★★ 2025（设计稿第 27 行 / 用户裁定）：**折叠分组的唯一实现**。
 *
 * 需求（用户原话）：「我要是用户估计会倾向于 **b 方案**（可折叠）——
 *   建议有个**下拉条**，同时下拉条中有个**复选框**以确认**记住展开状态**」
 *
 * 行为：
 *   · 未勾"记住" ⇒ 每次打开页面都用 `defaultOpen`（**不记忆**）
 *   · 勾了"记住" ⇒ 把当前展开态写进 localStorage，下次按它还原 ✓
 *
 * ⚠️ 三个易错点，都在这一个函数里收口：
 *   ① 复选框在**标题行内部** ⇒ 点它**不能**连带折叠（`stopPropagation`）
 *   ② `localStorage` 可能抛（隐身模式 / 配额满）⇒ 全程 try/catch，
 *      失败就退化成"不记忆"（**绝不能因此让 UI 初始化失败** ✗）
 *   ③ 展开态必须同时反映到 `aria-expanded`（无障碍 + CSS 箭头）**和** `hidden`
 */
function setupFolds() {
  for (const f of Object.values(UI_FOLDS)) {
    const head = el[`fold-${f.id}-head`];
    const body = el[`fold-${f.id}-body`];
    const box = el[`fold-${f.id}-remember`];
    if (!head || !body) continue;

    const store = {
      read() {
        try {
          const v = localStorage.getItem(f.rememberKey);
          return v === "open" ? true : v === "closed" ? false : null;
        } catch { return null; }
      },
      write(open) {
        try { localStorage.setItem(f.rememberKey, open ? "open" : "closed"); } catch { /* 不记忆 */ }
      },
      clear() {
        try { localStorage.removeItem(f.rememberKey); } catch { /* 忽略 */ }
      },
    };

    // 初始态归 `applyFoldPreference` 管（**导出** ⇒ 断言能单独验"重启后按记忆还原"✓）
    applyFoldPreference(f, head, body, box, store);

    // 标题行 = 下拉条（`<button>` ⇒ Enter/Space 原生可用 ✓）
    head.addEventListener("click", () => {
      const nowOpen = body.hidden;              // 收起 ⇒ 这次要展开
      setFoldOpen(head, body, nowOpen);
      if (box?.checked) store.write(nowOpen);
    });

    // 复选框：勾上时**以当前状态为准**写入（而不是改状态）——
    //   否则"勾选"这个动作本身会顺带折叠一次，很反直觉 ✗
    box?.addEventListener("click", (e) => {
      e.stopPropagation();                      // ⚠️ 易错点①：别连带折叠
      if (e.target.checked) store.write(!body.hidden);
      else store.clear();                       // 取消勾选 ⇒ 回到"不记忆"
    });
  }
}

/** 折叠态的**唯一写入点**：`hidden` 与 `aria-expanded` 必须一起改（分开改必漏一个 ✗） */
export function setFoldOpen(head, body, open) {
  body.hidden = !open;
  head.setAttribute("aria-expanded", open ? "true" : "false");
}

/**
 * 折叠的**初始态**（导出 ⇒ 断言可以单独验"重开页面按记忆还原"，
 * 不必调整个 `initUI` —— 那样会**累积监听器**并需要全套 handlers ✗）。
 *
 * 规则：**只认"记住"勾选过的情况**下的存储值，否则用 `defaultOpen`。
 * ⚠️ "用户是否勾过记住"这件事本身也得记住 ⇒ 用同一个键的**存在性**表达 ✓
 */
export function applyFoldPreference(f, head, body, box, store) {
  const s = store ?? {
    read() {
      try {
        const v = localStorage.getItem(f.rememberKey);
        return v === "open" ? true : v === "closed" ? false : null;
      } catch { return null; }
    },
  };
  let remembered = false;
  try { remembered = localStorage.getItem(f.rememberKey) !== null; } catch { remembered = false; }
  if (box) box.checked = remembered;
  const saved = remembered ? s.read() : null;
  setFoldOpen(head, body, saved === null ? f.defaultOpen === true : saved);
  return { remembered, open: body.hidden === false };
}

/**
 * ★★★ 2025（用户裁定：「ui 确保在**购买门槛压平后**正确显示就行」）：**跨度层**渲染。
 *
 * ── 为什么必须独立成一个函数（而不是留在 `renderQuantum` 里）──
 *   `renderQuantum` 在"本轮还没推进到量子页"时**提前 return**（`if (!showContent) return`），
 *   而跨度层是**打破无限之后**才生效的机制 —— 那一刻量子页往往正显示
 *   「已解锁 · 待推进」⇒ 留在里面就**永远不刷新**（徽标停在静态 HTML 的初值）✗
 *   ⇒ 抽出来，在 `render()` 里**无条件**调用（与猫猫卡同一做法）✓
 *
 * ── 判据唯一来源 ──
 *   `matterSpanStatus(state)`（config.js）。原来这里自己写 `spanDeBase > 0`，
 *   而实发（`matterSpanMult`）看 `thresholdFlatBought`
 *   ⇒ "引擎到手 → 买到门槛压平"这段会显示「已开启」而实际乘数恒 ×1 ✗（显示 ≠ 实发）
 *   ⇒ 现在徽标只在**真的在乘**（`mult > 1`）时才说"已生效"，
 *     中间每个阶段都有**具体原因**（armed / 未超基准 / 未开启）✓
 */
function renderSpanLayer(state) {
  if (!el["span-badge"]) return;
  const st = matterSpanStatus(state);
  el["span-badge"].textContent = st.on ? "已生效"
    : st.armed ? "已开启（待超过基准）"
      : "未开启";
  el["span-badge"].classList.toggle("on", st.on);
  if (el["span-k"]) el["span-k"].textContent = st.k.toFixed(4);
  if (el["span-mult"]) el["span-mult"].textContent = fmtMult(st.mult);
  if (el["span-base"]) {
    el["span-base"].textContent = st.base.gt(0) ? sci(st.base) : "—";
  }
  // ★ 新增：**当前暗能量 / 基准** —— 玩家唯一能判断"离生效还差多少"的地方 ✓
  if (el["span-de"]) {
    el["span-de"].textContent = st.base.gt(0)
      ? `${sci(state.darkEnergy)} / ${sci(st.base)}` +
        (st.overBase ? `（有效量超出 ${(st.effectiveLog10 - st.base.log10().toNumber()).toFixed(1)} 阶）` : "")
      : "—";
  }
  if (el["span-state"]) el["span-state"].textContent = st.reason;
}

export function initUI(handlers) {
  cache();
  applyStaticZones();     // ★ 静态按钮的乘区色（唯一数据源 = ZONE_OF）
  buildUpgrades();
  buildVoidUpgrades();
  buildZpeMechanisms();   // ★ 三条机制只建一次（放在 render 里会每帧重建 → hover 闪烁）
  buildTierMilestones();  // ★ 档位里程碑同理
  buildEternityMilestones();  // ★ 2025：永恒里程碑（只建一次）
  buildDeUpgrades();
  buildMilestones();
  buildLegend();
  buildDreamUpgrades();
  buildInfinityUpgrades();
  setupTabs();
  setupFolds();           // ★ 2025：主面板折叠分组（设计稿第 27 行 + 用户裁定的下拉条/记住）
  // ★ 2025：默认打开「主控台」（原左列的 5 张卡并进标签页后成为第一个面板）
  activateTab("console");

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
  // ★★★ 2025：永恒升级「永恒增幅」（设计稿 33~35 行）
  //   ⚠️ 用 `?.` —— 元素若不在（旧 html 缓存）也不该让整段初始化抛错 ✗
  el["btn-eternity-upg-epMult"]?.addEventListener("click", () => handlers.onBuyEpMult(false));
  el["btn-max-eternity-upg-epMult"]?.addEventListener("click", () => handlers.onBuyEpMult(true));
  // ★★★ 2025：按乘区上色（新增的 `eternity` 乘区，见 config.js 的 ZONES / ZONE_OF）——
  //   用户要求：「所有的加成按钮都应根据代码中的加成落点提供颜色」
  applyZone(el["btn-eternity-upg-epMult"], "epMult");
  el["btn-max-eternity-upg-epMult"]?.classList.add("zone", `zone-${ZONE_OF.epMult}`);
  // ★★★ 2025（`NEKO.md` §10）：**三个好感度道具**的按钮 —— 全部走 `handlers.onUseNekoItem`
  //   （它内部调 `useNekoItem` = **唯一入口**，扣款与好感度写入都在那里 ✓）
  //   ⚠️ 那对 `±8` 调试按钮已**删除** —— 道具实装后不再需要（它们是"没有道具时的可见性补丁"）✓
  for (const it of Object.values(NEKO_ITEMS)) {
    el[`btn-neko-item-${it.id}`]?.addEventListener("click", () => handlers.onUseNekoItem(it.id));
  }

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
  for (const id of INFINITY_ORDER) {
    $(`inf-btn-${id}`)?.addEventListener("click", () => handlers.onBuyInfinity(id));
  }
  // ★ 2025：① 置顶行的「买满」（形态与升级中心的买满按钮一致）
  el["btn-max-ipDouble"]?.addEventListener("click", () => handlers.onBuyIpDoubleMax());

  // ── ZPE 引擎（虚空科技的第二个子页）──
  el["btn-unlock-zpe-engine"].addEventListener("click", handlers.onUnlockZpeEngine);
  el["btn-eternity"].addEventListener("click", handlers.onEternity);
  el["btn-buy-zpe-engine"].addEventListener("click", () => handlers.onBuyZpeEngine(false));
  el["btn-buy-zpe-engine-max"].addEventListener("click", () => handlers.onBuyZpeEngine(true));

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
