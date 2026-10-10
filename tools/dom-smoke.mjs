#!/usr/bin/env node
/**
 * tools/dom-smoke.mjs —— 不开浏览器，把 main.js + ui.js 真跑一遍
 *
 * 为什么需要：上一轮线上出现「页面有内容但完全不动」，根因是 ui.js 写了一个
 * 已经被删掉的 id，第一帧就抛 TypeError，而异常杀死了 rAF 循环。
 * 静态语法检查抓不到这种 bug，必须真的执行一遍 render()。
 *
 * 做法：写一个极简 DOM 桩（元素表 + innerHTML 里的 id 扫描 + classList），
 *       然后动态 import main.js，手动跑若干帧。
 *
 * 用法：node tools/dom-smoke.mjs [--frames=120]
 */

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : d;
};

// ══════════════════════════════════════════════════════════
// 极简 DOM 桩
// ══════════════════════════════════════════════════════════

/** 全局 id 表：getElementById 从这里查 */
const byId = new Map();
/** 记录所有 textContent 写入次数，用来验证「重复写被跳过了」 */
const stats = { textWrites: 0, textSkipped: 0 };

function makeEl(tag = "div", id = "") {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    textContent: "",
    _innerHTML: "",
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    _children: [],
    _classes: new Set(),
    get className() { return [...this._classes].join(" "); },
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    /**
     * 真实浏览器的 childElementCount。
     * 桩里只有两种子元素：
     *   · innerHTML 里带 id="..." 的（已登记进 _children）
     *   · 日志面板那种不带 id 的 <div class="le">（只能从 innerHTML 数）
     * ⚠️ 少了这个属性，ui.js 里「靠子元素个数判断要不要重画日志」那类
     *    bug 会在桩上**永远看不出来**（undefined !== 60 恒真 = 每帧都重画）。
     */
    get childElementCount() {
      const fromHtml = (this._innerHTML.match(/<div class="le">/g) ?? []).length;
      return Math.max(this._children.length, fromHtml);
    },
    classList: {
      add: (...c) => c.forEach((x) => node._classes.add(x)),
      remove: (...c) => c.forEach((x) => node._classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !node._classes.has(c) : !!force;
        if (on) node._classes.add(c); else node._classes.delete(c);
        return on;
      },
      contains: (c) => node._classes.has(c),
    },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v);
      // 扫描里面的 id="..."，登记成子元素
      this._children = [];
      for (const m of String(v).matchAll(/id="([\w-]+)"/g)) {
        const child = makeEl("div", m[1]);
        // 顺手解析 class="..."
        const around = String(v).slice(Math.max(0, m.index - 120), m.index + 120);
        const cm = around.match(/class="([^"]+)"/);
        if (cm) child.className = cm[1];
        byId.set(m[1], child);
        this._children.push(child);
      }
    },
    appendChild(c) {
      // ★ 模拟原生行为：DOM 方法要求 this 是真实节点。
      //   这条校验专门抓「用 Proxy 包 DOM 元素」那类 bug ——
      //   浏览器会抛 `TypeError: Illegal invocation`，而普通桩会静默通过。
      assertThis(this, node, "appendChild");
      this._children.push(c);
      if (c.id) byId.set(c.id, c);
      return c;
    },
    removeChild(c) {
      assertThis(this, node, "removeChild");
      this._children = this._children.filter((x) => x !== c);
      return c;
    },
    querySelector(sel) { assertThis(this, node, "querySelector"); return queryIn(this, sel); },
    querySelectorAll(sel) {
      assertThis(this, node, "querySelectorAll");
      if (sel === ".tab") return (this._children ?? []).filter((c) => c._classes.has("tab"));
      // ★ 2025 补：`[data-tab]`（activateTab 用它给标签打 active class）。
      //   缺了它 ⇒ `activateTab` 的 class 循环**空转** ⇒ 连"默认打开哪个面板"都验不了 ✗
      //   （这是**测试替身的缺口**，不是产品代码的 bug —— 真实浏览器里 querySelectorAll 是好的）
      if (sel === "[data-tab]") return [...byId.values()].filter((el2) => el2?.dataset && el2.dataset.tab != null);
      return [];
    },
    closest(sel) {
      const cls = sel.replace(/^\./, "");
      if (this._classes.has(cls)) return this;
      return null;
    },
    addEventListener(type, fn) {
      assertThis(this, node, "addEventListener");
      // ★ 2025：**记下来**，这样测试能真的派发点击（原来是个空函数 ⇒
      //   "按钮点了没反应"这类 bug 在烟测里**根本测不出来** ✗）
      if (typeof fn !== "function") return;
      this._handlers ??= {};
      (this._handlers[type] ??= []).push(fn);
    },
    /**
     * 测试用：真的把点击事件派发给已注册的监听器。
     *
     * ★★★ 2025：**事件对象必须够真** —— 原来只给 `{ target, preventDefault }`，
     *   于是任何用到 `e.stopPropagation()` 的代码在烟测里**当场抛**
     *   （真实浏览器里它有 ⇒ 是 mock 不完整，不是代码错 ✗）。
     *   我就是在折叠分组的复选框上撞到这条的。
     * ⚠️ 也顺带模拟浏览器行为：`checkbox` 被点会自动翻转 `checked` ✓
     */
    click() {
      if (this.type === "checkbox" || "checked" in this) {
        this.checked = !this.checked;
      }
      const ev = {
        target: this,
        currentTarget: this,
        // ★★★ 2025：记账 —— 断言要能验证"代码真的调了 stopPropagation"
        //   ⚠️ 本 mock **没有冒泡链**（`click()` 只调自己节点上的监听器）⇒
        //      "点复选框不连带折叠"这条**测不出来**（我自检时发现：拿掉
        //      `e.stopPropagation()` 断言照样全绿 ⇒ 那是个假断言 ✗）
        //   ⇒ 改成直接看"有没有调"（真正的冒泡语义由浏览器保证，不必在这里重造）
        __stopPropagationCalled: false,
        __preventDefaultCalled: false,
        preventDefault() { this.__preventDefaultCalled = true; },
        stopPropagation() { this.__stopPropagationCalled = true; },
        stopImmediatePropagation() { this.__stopPropagationCalled = true; },
      };
      this.__lastEvent = ev;
      for (const fn of this._handlers?.click ?? []) fn(ev);
    },
    removeEventListener() {},
    // ★★★ 2025：原来 `setAttribute` 是**空函数**、`getAttribute` 永远 `null`
    //   ⇒ "属性真的被设上了"这类 bug **测不出来**（与当初 `addEventListener` 是空函数
    //      导致"按钮点了没反应"测不出来，是**同一类**问题 ✗）
    //   ⇒ 真正记账。`aria-expanded` 这类无障碍属性现在是可断言的 ✓
    setAttribute(name, value) { assertThis(this, node, "setAttribute"); this._attrs.set(String(name), String(value)); },
    getAttribute(name) { assertThis(this, node, "getAttribute"); return this._attrs.has(String(name)) ? this._attrs.get(String(name)) : null; },
    hasAttribute(name) { return this._attrs.has(String(name)); },
    focus() {},
  };
  node._attrs = new Map();
  // textContent 写入计数（验证 Proxy 优化生效）
  let _t = "";
  Object.defineProperty(node, "textContent", {
    get() { return _t; },
    set(v) { _t = String(v); stats.textWrites++; },
    configurable: true,
  });
  return node;
}

/** 模拟原生：DOM 方法被解绑/代理后调用会抛 Illegal invocation */
function assertThis(self, expected, method) {
  if (self !== expected) {
    throw new TypeError(
      `Illegal invocation（${method}）：this 不是真实节点。` +
      `如果这里失败，说明有代码用 Proxy 包了 DOM 元素 —— 浏览器会直接抛这个错。`,
    );
  }
}

function queryIn(root, sel) {
  if (!sel) return null;
  if (sel.startsWith("#")) return byId.get(sel.slice(1)) ?? null;
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return (root._children ?? []).find((c) => c._classes.has(cls)) ?? null;
  }
  return null;
}

/** 预扫描 index.html，把所有静态 id 登记进去 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const html = readFileSync(join(ROOT, "index.html"), "utf8");
let staticIds = 0;
for (const m of html.matchAll(/<[^>]*\bid="([\w-]+)"[^>]*>/g)) {
  const tag = m[0];
  const el2 = makeEl("div", m[1]);
  // ★ 2025 补：把 `data-*` 解析进 `dataset`（原来一直是空的 ⇒ `[data-tab]` 查不到、
  //   `activateTab` 的 class 循环空转 ⇒ "默认打开哪个面板"根本验不了 ✗）
  for (const d of tag.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) {
    el2.dataset[d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d[2];
  }
  byId.set(m[1], el2);
  staticIds++;
}

// 顺带检查 ui.js 的 cache 数组是否都能在 html 里找到
const uiSrc = readFileSync(join(ROOT, "src", "ui.js"), "utf8");
const cacheBlock = uiSrc.match(/const ids = \[([\s\S]*?)\];/)[1];
const cachedIds = [...cacheBlock.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
// ★ 2025：这些 id 现在是**静态写进 index.html** 的（① 置顶行的外壳），
//   所以不再需要动态白名单 —— 保留一个空的 Set 只是给将来留口子。
const DYNAMIC_IDS = new Set();
const missingIds = cachedIds.filter((id) => !html.includes(`id="${id}"`) && !DYNAMIC_IDS.has(id));

// ── 守卫（反方向）：代码里 el["x"] 用到但没进 cache 数组的 ──
// 只查 cache -> HTML 是单向的，抓不到这类：HTML 有 id、代码用了 el["x"]，
// 但忘了往 ids 数组里加 -> el["x"] 是 undefined -> 运行时报
//   TypeError: Cannot set properties of undefined (setting 'textContent')
// 踩过：dream-badge 崩溃 + dream-upgrade-list 静默失效（按钮从来不出现）。
// 先剥掉注释 —— 否则注释里举的例子（`el["x"].textContent`）会被误报
const uiCode = uiSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const usedByCode = new Set([...uiCode.matchAll(/el\["([\w-]+)"\]/g)].map((m) => m[1]));
const notCached = [...usedByCode].filter((id) => !cachedIds.includes(id));

// ── 守卫：REPEATABLE（有等级的升级）不许写死 desc ──
// 它的效果随等级变，手写字符串迟早和 formulas.js 脱节。
// 踩过：particleBoost.desc 写 `×1.1^等级`，实现却是 `1+0.05×等级`，100 级差 2000 倍。
const configSrc = readFileSync(join(ROOT, "src", "config.js"), "utf8");
const repeatableBlock = configSrc.match(/export const REPEATABLE = \{([\s\S]*?)\n\};/)?.[1] ?? "";
const hardcodedDescs = [...repeatableBlock.matchAll(/\bdesc\s*:/g)].length;

globalThis.document = {
  getElementById: (id) => byId.get(id) ?? null,
  createElement: (tag) => makeEl(tag),
  querySelector: (sel) => queryIn({ _children: [...byId.values()] }, sel),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl("body"),
  visibilityState: "visible",
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

globalThis.window = { addEventListener() {}, location: { reload() {} } };
// ⚠️ Node 24 里 navigator / performance 是只读的 getter，直接赋值会抛
//    "Cannot set property navigator of #<Object> which has only a getter"
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: () => Promise.resolve() } },
  configurable: true, writable: true,
});
globalThis.alert = () => {};
globalThis.confirm = () => false;

/** 手动驱动的 rAF 队列 */
const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };

let simNow = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => simNow },
  configurable: true, writable: true,
});

// ══════════════════════════════════════════════════════════
console.log("=".repeat(74));
console.log("DOM 烟测：真的跑一遍 main.js + ui.js");
console.log("=".repeat(74));
console.log();
console.log(`  index.html 静态 id  ${staticIds}`);
console.log(`  ui.js cache 声明    ${cachedIds.length}`);
console.log(`  缺失的 id           ${missingIds.length ? "❌ " + missingIds.join(", ") : "✅ 无"}`);
console.log(`  el[] 未进 cache     ${notCached.length ? "❌ " + notCached.join(", ") : "✅ 无"}`);
console.log(`  REPEATABLE 写死 desc ${hardcodedDescs === 0 ? "✅ 无（都由 effectText 推导）" : `❌ ${hardcodedDescs} 处（会与实现脱节）`}`);
console.log();

// ══════════════════════════════════════════════════════════
// 加载 main.js（它会自己起 rAF 循环）
// ══════════════════════════════════════════════════════════

// ★ 2025：CSS 规则查询提到**顶层**（原来定义在后面的块里，前面的断言用不到 ✗）
//   ⚠️ 实现要点：**不能用 `([^{}]+)\{` 抓选择器** —— `@media (...) {` 也会被当成一个"选择器头"，
//      于是媒体查询里的规则全都匹配不到 ✗（我就踩了这个：`.tabs` 的 sticky 检不出来）。
//   ⇒ 直接按「选择器名 + `{`」定位规则体：用 `(?:^|[};])\s*<sel>\s*\{([^}]*)\}`。
const cssTextAll = readFileSync(join(ROOT, "css", "amoled.css"), "utf8");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ruleOf = (sel) => {
  const re = new RegExp(`(?:^|[};])\\s*${esc(sel)}\\s*\\{([^}]*)\\}`, "gm");
  return [...cssTextAll.matchAll(re)].map((m) => m[1]).join("\n");
};
const clipsOverflowOf = (body) =>
  [...body.matchAll(/overflow(?:-[xy])?\s*:\s*([a-z]+)/g)].some((m) => m[1] !== "visible");

let caught = null;
const origError = console.error;
console.error = (...a) => { if (!caught) caught = a.join(" "); origError(...a); };

await import(new URL("../src/main.js", import.meta.url).href);

console.log(`  模块加载            ${caught ? "❌ 有错误" : "✅ 无异常"}`);
if (caught) { console.log(`     ${caught.split("\n")[0]}`); }

// ══════════════════════════════════════════════════════════
// 跑帧
// ══════════════════════════════════════════════════════════

const FRAMES = arg("frames", 300);
const writesBefore = stats.textWrites;
const game = globalThis.window.__game;

for (let i = 0; i < FRAMES; i++) {
  // 模拟玩家点击：熵阱少的时候靠手点（开局唯一的熵来源）
  // 注意 __game.doClick 是引擎原始函数，签名是 doClick(state)
  if (game && i < FRAMES * 0.8) {
    for (let k = 0; k < 8; k++) game.doClick(game.state);
  }
  simNow += 16.67;
  const fn = rafQueue.shift();
  if (!fn) { console.log(`  ⚠️ 第 ${i} 帧后 rAF 队列空了 —— 循环停了`); break; }
  try { fn(simNow); } catch (e) {
    console.log(`  ❌ 第 ${i} 帧抛异常：${e.message}`);
    caught = e.message;
    // 模拟 main.js 的行为：继续投递下一帧
    globalThis.requestAnimationFrame(() => {});
  }
}

const writes = stats.textWrites - writesBefore;

console.log();
console.log("=".repeat(74));
console.log("结果");
console.log("=".repeat(74));
console.log();
console.log(`  跑了              ${FRAMES} 帧（约 ${(FRAMES * 16.67 / 1000).toFixed(1)} 秒游戏时间）`);
console.log(`  rAF 队列剩余      ${rafQueue.length}  ${rafQueue.length > 0 ? "✅ 循环还活着" : "❌ 循环停了"}`);
console.log(`  textContent 写入  ${writes} 次`);
console.log();

const state = globalThis.window.__game?.state;
if (state) {
  console.log("  游戏状态：");
  console.log(`    熵              ${state.resources.entropy.toString()}`);
  console.log(`    粒子            ${state.resources.particle.toString()}`);
  console.log(`    物质            ${state.resources.matter.toString()}`);
  console.log(`    熵阱            ${state.resources.traps.toString()}`);
  console.log(`    ZPE             ${state.zpe.toString()}`);
  console.log(`    量子            ${state.quantum.toString()}`);
  console.log(`    梦想点          ${state.dreamPoints.toString()}`);
  // 注意：熵会被立即转成粒子，所以正常运行时「熵」本来就接近 0。
  // 判断「逻辑在跑」要看**粒子/物质是否增长**，不能看熵。
  const advanced =
    state.resources.particle.gt(0) || state.resources.matter.gt(0) ||
    state.zpe.gt(0) || state.dreamPoints.gt(0);
  console.log();
  console.log(`  ${advanced ? "✅ 逻辑在随时间推进" : "❌ 什么都没动 —— 逻辑没跑起来"}`);
  if (advanced) {
    console.log("     （熵会立刻被转成粒子，所以熵=0 是正常的）");
  }
} else {
  console.log("  ❌ window.__game 不存在，main.js 可能没跑完");
}
console.log();

// ══════════════════════════════════════════════════════════
// 回归守卫：日志面板在写满 LOG_MAX（60）条之后必须还在刷新
// ══════════════════════════════════════════════════════════
// 踩过：render() 判断「要不要重画日志」用的是
//     logEl.childElementCount !== state.log.length
//   state.log 的上限正好是 60。写满之后长度恒为 60、
//   DOM 子元素也恒为 60 —— 两边永远相等，于是日志面板**冻在旧内容上**，
//   第 61 条以后一条都不显示（只有刷新页面清空日志才恢复）。
// 这个守卫就是防止有人把那行判断改回去。
let logGuard = "未跑";
if (state) {
  const { pushLog } = await import(new URL("../src/state.js", import.meta.url).href);
  // ★ 必须**一条一条**地灌、每条之间都渲染一次。
  //   一次灌 70 条再渲染是抓不到这个 bug 的：那时 DOM 里的条数还是旧的，
  //   「条数不等」仍然成立，于是最后一次渲染恰好把最新一条画了进去。
  for (let i = 1; i <= 70; i++) {
    pushLog(state, `回归守卫 #${i}`);
    // 渲染节流到 20fps（50ms），16.67ms/帧 —— 推 3 帧必轮到一次 render
    for (let k = 0; k < 3; k++) {
      simNow += 16.67;
      const fn = rafQueue.shift();
      if (fn) fn(simNow);
    }
  }
  const html = byId.get("log-panel")?._innerHTML ?? "";
  const ok = html.includes("回归守卫 #70");
  logGuard = ok ? "✅ 写满 60 条后仍会刷新" : "❌ 日志面板写满 60 条后冻结了";
  console.log(`  日志面板刷新    ${logGuard}`);
  console.log();
}
const guardFailed = typeof logGuard === "string" && logGuard.startsWith("❌");

// ══════════════════════════════════════════════════════════
// 回归守卫：∞ 层（无限升级）面板必须真的画出来，且买下后文本跟随公式
// ══════════════════════════════════════════════════════════
// 这一层是「数据驱动生成 UI」的第三处（另两处是虚空升级、梦想点升级），
// 踩过的坑同源：config 里加了条目、ui.js 忘了 build，于是面板永远空白。
// 所以这里既查"四个按钮都画出来了"，也查"买下后描述会从公式刷新"。
let infGuard = "未跑";
if (state) {
  const engine = await import(new URL("../src/engine.js", import.meta.url).href);
  const { crunchThreshold, INFINITY_ORDER } = await import(new URL("../src/config.js", import.meta.url).href);
  const infIds = INFINITY_ORDER;                 // ★ 数据驱动：加一条升级就自动纳入守卫
  const drawn = infIds.filter((id) => byId.get(`inf-btn-${id}`)).length;
  // ⚠️ 无限面板要解锁后才会渲染升级行（renderInfinity 会提前 return），
  //    所以这里先把 peakMatter 顶到阈值 —— 否则测的是"隐藏状态下的空描述"。
  state.peakMatter = crunchThreshold();
  state.infinityPoints = state.infinityPoints.add(1e6);      // 给足点数，直接买 ④
  for (let i = 0; i < 3; i++) { simNow += 16.67; const fn = rafQueue.shift(); if (fn) fn(simNow); }
  const desc = "";   // ipTime 卡片已随机制删除 ⇒ 这里不再取它的描述 ✓
    state.brokenInfinity = true;   // dom-smoke: thresholdFlat 需要已打破无限才可买 ✓
    const bought = engine.buyInfinityUpgrade(state, "thresholdFlat");   // ipTime 已删 ⇒ 换一个仍存在的 id
    const ok = drawn === infIds.length && bought.ok;
  infGuard = ok ? `✅ ${infIds.length} 个升级已渲染（2×n 网格），买下后文本跟随公式` : `❌ 异常（画了 ${drawn}/${infIds.length}，买入=${bought.ok}，描述="${desc}"）`;
  console.log(`  ∞ 面板          ${infGuard}`);

  // ★ 再过一遍「已打破无限 + 落在过载区」的分支。
  //   renderInfinity 里那段只有打破之后才走；不显式构造的话，线上是第一次执行它 ——
  //   而"render 抛异常 → rAF 循环永久停住"正是这个项目踩过的坑。
  const { overloadThreshold } = await import(new URL("../src/config.js", import.meta.url).href);
  const { default: Dec } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);
  state.brokenInfinity = true;
  state.resources.matter = Dec.pow(10, overloadThreshold(state).add(15));
  // ⚠️ **2025 口径变了**：过载现在按**物质获得速率**（> `Number.MAX_VALUE = 1.8e308`）触发，
  //   **不是按物质数量** ⇒ 只设 `matter`（数量）不再能让过载生效 ✗
  //   ⇒ 必须把**速率**推过阈值：`particle` 给到 `1.8e308 × 1e50`（超阈 ~55 阶 ⇒ 已过收手点）
  state.resources.particle = new Dec(Number.MAX_VALUE).mul(Dec.pow(10, 50));
  for (let i = 0; i < 3; i++) { simNow += 16.67; const fn = rafQueue.shift(); if (fn) fn(simNow); }
  const ovText = byId.get("overload-state")?.textContent ?? "";
  // 新文案：`×0.001（速率超 1.8e308 已 N 阶）`
  const ovOk = /速率超 1\.8e308 已 [0-9.]+ 阶/.test(ovText) && /×[0-9.]+/.test(ovText);
  console.log(`  过载显示        ${ovOk ? "✅ 已打破且速率超阈时显示因子与超出阶数" : `❌ 异常（"${ovText}"）`}`);
  console.log();
  if (!ovOk) infGuard = `❌ 过载显示异常（"${ovText}"）`;
}
const guardFailed2 = guardFailed || infGuard.startsWith("❌");

// ══════════════════════════════════════════════════════════
// 回归守卫：乘区登记完整性 + 梦想卡的虹色
// ══════════════════════════════════════════════════════════
// 用户截图报的两个问题，根因都是"数据登记漏了一条"：
//   ① `deGainBase` / `convOutput` 没进 ZONE_OF —— 卡片拿不到乘区色（加成区看起来不对）
//   ② 梦想卡只加了 `rainbow-card`（静态 border-image），名字上没有 `.rainbow` ——
//      所以"第一个颜色不动"（虹色文字才有 dreamHue 动画）
// 所以这里既查数据（每个会被 UI 渲染的 id 都要有乘区），也查渲染结果（虹色类必须在）。
let zoneGuard = "未跑";
{
  const cfgMod = await import(new URL("../src/config.js", import.meta.url).href);
  const ids = [
    ...Object.keys(cfgMod.REPEATABLE),
    ...Object.keys(cfgMod.VOID_UPGRADES),
    ...Object.keys(cfgMod.DE_UPGRADES),
    ...cfgMod.DREAM_UPGRADES.map((d) => d.id),
    ...cfgMod.INFINITY_ORDER,
    ...cfgMod.ZPE_MILESTONES.map((m) => m.id),
    ...cfgMod.DE_MILESTONES.map((m) => m.id),
  ];
  const missing = ids.filter((id) => {
    const key = cfgMod.ZONE_OF[id];
    return !key || !cfgMod.ZONES[key];
  });
  // 渲染结果：梦想卡的名字必须带 rainbow（否则虹色是静态的）
  const dreamHtml = cfgMod.DREAM_UPGRADES
    .map((d) => byId.get(`dream-btn-${d.id}`)?.innerHTML ?? "")
    .join("");
  const dreamRainbow = cfgMod.DREAM_UPGRADES.length > 0 &&
    cfgMod.DREAM_UPGRADES.every((d) => /class="btn-name rainbow"/.test(byId.get(`dream-btn-${d.id}`)?.innerHTML ?? ""));
  const undefinedZone = [...byId.keys()].filter((k) => (byId.get(k)?.className ?? "").includes("zone-undefined"));
  // ★ 顶部「全局加成」槽必须真的显示三个因子（各带自己的乘区色）——
  //   它是「全局（乘积）」和「计数频率（那个升级）」不再混淆的**可视依据**。
  //   ⚠️ 现在是**三个稳定的子 span**（`gm-dream/…/gm-de`），不再是 render 里拼 innerHTML
  //      —— 每帧 innerHTML 会重置 hover 状态，是"鼠标移上去闪烁"的根因。
  //   乘区色是**静态**的（写死在 HTML 标签上），所以从标签里查；数值读运行时文本。
  const tagOf = (id) => (html.match(new RegExp(`<span[^>]*id="${id}"[^>]*>`)) ?? [""])[0];
  const slotText = ["gm-dream", "gm-countfreq", "gm-de"]
    .map((id) => byId.get(id)?.textContent ?? "").join("  ");
  const slotOk = [["gm-dream", "zone-dream"], ["gm-countfreq", "zone-countfreq"], ["gm-de", "zone-de"]]
    .every(([id, cls]) => tagOf(id).includes(cls)) &&
    /梦想点 ×[\d.]+/.test(slotText) && /计数频率 ×[\d.]+/.test(slotText) && /暗能量 ×[\d.]+/.test(slotText);
  const slot = slotText;
  // ★ 乘区图例：每个乘区必须恰好出现一次，且虹色那一格用渐变块
  //   （加新乘区时最容易忘的就是图例 —— 词条上色了但图例里没有）
  const legend = byId.get("zone-legend")?.innerHTML ?? "";
  const zoneKeys = Object.keys(cfgMod.ZONES);
  const legendBad = zoneKeys.filter((k) => (legend.split(`item zone-${k}`).length - 1) !== 1);
  const rainbowSwatch = (legend.split("swatch-rainbow").length - 1) ===
    zoneKeys.filter((k) => cfgMod.ZONES[k].rainbow).length;
  const legendOk = legendBad.length === 0 && rainbowSwatch && legend.includes("zone-cost") && legend.includes("zone-global");
  const ok = missing.length === 0 && dreamRainbow && undefinedZone.length === 0 && slotOk && legendOk;
  zoneGuard = ok
    ? `✅ ${ids.length} 个 id 都有乘区；图例 ${zoneKeys.length} 格各一次；梦想卡虹色动画类齐全；全局加成槽显示三因子分解`
    : `❌ 缺乘区登记：${missing.join(",") || "无"}｜图例异常：${legendBad.join(",") || "无"}（彩虹块 ${rainbowSwatch}）` +
      `｜梦想卡彩虹：${dreamRainbow}｜zone-undefined：${undefinedZone.join(",") || "无"}｜槽分解：${slotOk}（"${slot.slice(0, 90)}"）`;
  console.log(`  乘区登记        ${zoneGuard}`);
  console.log();

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**所有升级按钮都必须按 `ZONE_OF` 上色**
  // ══════════════════════════════════════════════════════════
  // 用户原话：「加成页面中所有的升级按钮要根据增幅的乘区提供颜色」。
  // 现场：数据驱动的五张列表走 applyZone ✓，但 **index.html 里静态写死**的按钮
  //   （熵阱 / ZPE 引擎升格 / 相变仪 / 坍缩加速 / 大坍缩 / 打破无限）颜色是
  //   硬编码在 class 上的 ✗ —— 换乘区时不会跟着变，而且有几个颜色直接漏了 ✗
  // 现在统一由 `applyStaticZones()` 按 ZONE_OF 上色（唯一数据源）。
  // ⇒ 本断言从 **index.html 原文**收集所有 `btn-*-buy*` 形态的按钮 id，逐个查渲染结果。
  let btnZoneGuard;
  {
    const htmlRaw2 = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const btnIds = [...htmlRaw2.matchAll(/<button[^>]*\bid="(btn-[^"]+)"/g)].map((m) => m[1]);
    // 只查"会带来加成/花费"的那类按钮（解锁按钮也算 —— 它们同样该指出落点）
    const relevant = btnIds.filter((id) => /^btn-(buy|unlock|max)/.test(id) || id === "btn-bigcrunch" || id === "btn-break-infinity");
    const uncolored = relevant.filter((id) => {
      const cls = byId.get(id)?.className ?? "";
      return !/\bzone-[a-z]+\b/.test(cls) && !cls.includes("rainbow-card");
    });

    // ★ 2025 加强：**加成按钮的颜色必须与 `ZONE_OF` 一致**（不只是"有没有颜色"）
    //
    //   用户要求：「所有的加成按钮（除去所有的里程碑）应该都类似于暗物质界面下的那些升级一样，
    //              **根据代码中的加成落点提供颜色**」
    //   踩过的坑：`buildVoidUpgrades()` 里写的是 `applyZone(cfg.id)` —— **只传 id 没传元素** ✗，
    //     兼容守卫换位后 `el` 仍是 undefined ⇒ 直接 return ⇒ **9 条虚空升级一个都没上色** ✗
    //     而旧断言只查"静态按钮有没有颜色"，查不到这一类 ⇒ 这次按 **id 前缀**逐个覆盖。
    const bonusBtnRows = [
      ...Object.keys(cfgMod.REPEATABLE).map((id) => [`btn-upg-${id}`, id]),
      ...Object.keys(cfgMod.VOID_UPGRADES).map((id) => [`void-btn-${id}`, id]),
      ...Object.keys(cfgMod.DE_UPGRADES).map((id) => [`de-btn-${id}`, id]),
      ...cfgMod.DREAM_UPGRADES.map((d) => [`dream-btn-${d.id}`, d.id]),
      ...cfgMod.INFINITY_ORDER.map((id) => [`inf-btn-${id}`, id]),
    ];
    const wrongZone = [];
    const noNode = [];
    for (const [elId, zoneId] of bonusBtnRows) {
      const node = byId.get(elId);
      if (!node) { noNode.push(elId); continue; }
      const want = cfgMod.ZONE_OF[zoneId];
      const cls = node.className ?? "";
      if (!want) { wrongZone.push(`${elId}(未登记)`); continue; }
      const rain = cfgMod.ZONES[want]?.rainbow;
      const okColor = rain ? cls.includes("rainbow-card") : new RegExp(`\\bzone-${want}\\b`).test(cls);
      if (!okColor) wrongZone.push(`${elId}→缺 zone-${want}`);
    }
    const dynamicOk = wrongZone.length === 0 && noNode.length === 0;

    btnZoneGuard = (uncolored.length === 0 && dynamicOk)
      ? `✅ 静态 ${relevant.length} 个 + 动态 ${bonusBtnRows.length} 个加成按钮，颜色都=ZONE_OF`
      : `❌ 静态未上色：${uncolored.join(", ") || "无"}` +
        `｜动态不对：${wrongZone.slice(0, 6).join(", ") || "无"}${wrongZone.length > 6 ? ` …共${wrongZone.length}` : ""}` +
        `｜未渲染：${noNode.join(", ") || "无"}`;
    console.log(`  按钮乘区色      ${btnZoneGuard}`);
    console.log();
  }
  if (btnZoneGuard.startsWith("❌")) process.exitCode = 1;

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**无限挑战（IC）必须挂在「无限的坍缩里程碑」子页里**
  // ══════════════════════════════════════════════════════════
  // 用户指定：「无限挑战也挪到无限的坍缩里程碑这边」。
  //   稿子原文：「无限挑战…**作为无限页面的子页面存在**」。
  //   原来它挂在 `zpe-engine-content` 的父节点 —— 也就是**虚空科技的 ZPE 引擎面板** ✗
  //   现在锚点是 `panel-infdeep` 里的 `#ic-host`。
  //   本断言查两件事：① 宿主真的被填充；② 它**不在** ZPE 面板里（防回归）。
  {
    const host = byId.get("ic-host");
    const badge = byId.get("ic-badge");
    const list = byId.get("ic-list");
    const filled = !!badge && !!list && (host?._children?.length ?? 0) > 0;
    // 位置检查：用 **HTML 的索引区间**（shim 不维护父链 ⇒ 不能用 parentElement ✗；
    //   也不能用"正则全文找"——`panel-zpe` 在 `ic-host` 之前，那样必然误命中 ✗ 我第一版就是这么错的）
    //   规则：`#ic-host` 必须落在 `id="panel-infdeep"` 到**下一个** `class="tab-panel"` 之间。
    const hostIdx = html.indexOf('id="ic-host"');
    const start = html.indexOf('id="panel-infdeep"');
    const nextPanel = html.indexOf('class="tab-panel"', start + 1);
    const inInfdeep = start >= 0 && hostIdx > start && (nextPanel < 0 || hostIdx < nextPanel);
    // 反向：它绝不能落在 zpe 面板区间里
    const zStart = html.indexOf('id="panel-zpe"');
    const zNext = html.indexOf('class="tab-panel"', zStart + 1);
    const inZpe = zStart >= 0 && hostIdx > zStart && (zNext < 0 || hostIdx < zNext);
    const icPlaceGuard = (filled && inInfdeep && !inZpe)
      ? `✅ #ic-host 在 panel-infdeep 内且已填充（子节点 ${host?._children?.length ?? 0} 个）`
      : `❌ 填充=${filled}（badge=${!!badge} list=${!!list}）｜在 infdeep=${inInfdeep}｜误在 ZPE 面板=${inZpe}`;
    console.log(`  无限挑战挂载    ${icPlaceGuard}`);
    console.log();
    if (icPlaceGuard.startsWith("❌")) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**原左列 5 张卡必须并进标签页的「主控台」面板**
  // ══════════════════════════════════════════════════════════
  // 用户要求：「左侧的主页面也最好并入右侧列表，标题为主控台」。
  //   原来那 5 张卡是**标签页系统之外**的独立左列 ⇒ 切标签时它们永远在，
  //   占用半屏却与当前页无关。并进 `#panel-console` 后由 `activateTab` 统一管理 ✓
  //
  // ★★★ 2025（设计稿第 27 行 / 用户裁定）：**主面板重组**之后位置变了：
  //   · **日志**搬去**梦想子页**（设计稿同句前半句）
  //   · 其余 4 张收进主控台里的**折叠组**（用户选 b 方案：可折叠 + 下拉条 + "记住"复选框）
  //   ⇒ 断言必须跟着改，否则它就变成"钉死旧布局的假断言"✗
  //   ⚠️ 但**不能只改成"4 张卡在 panel-console 里"** —— 那样折叠组的存在、以及
  //      "收起时 `hidden`、展开时可见"就没人守了（折叠最容易坏的就是这条）✗
  {
    const consolePanel = byId.get("panel-console");
    const consoleTab = byId.get("tab-console");
    // 4 张"手动操作"卡必须**都在折叠组（fold-manual-body）里**，而折叠组在主控台内
    const marks = ["btn-click", "upgrade-list", "btn-buy-trap", "d-entropy-rate"];
    const pIdx = html.indexOf('id="panel-console"');
    const pNext = html.indexOf('class="tab-panel"', pIdx + 1);
    const seg = pIdx >= 0 ? html.slice(pIdx, pNext < 0 ? undefined : pNext) : "";
    const foldIdx = seg.indexOf('id="fold-manual-body"');
    const inside = marks.filter((m) => {
      const i = seg.indexOf(`id="${m}"`);
      return i >= 0 && foldIdx >= 0 && i > foldIdx;      // 必须在折叠组**之内**
    });
    // 日志必须**在梦想子页**里（而不是主控台）
    const dIdx = html.indexOf('id="panel-dream"');
    const dNext = html.indexOf('class="tab-panel"', dIdx + 1);
    const dreamSeg = dIdx >= 0 ? html.slice(dIdx, dNext < 0 ? undefined : dNext) : "";
    const logInDream = dreamSeg.includes('id="log-panel"') && !seg.includes('id="log-panel"');
    // 折叠组的三件套（下拉条 / 内容 / 记住复选框）都在，且**默认收起**
    const foldOk = !!byId.get("fold-manual-head") && !!byId.get("fold-manual-body")
      && !!byId.get("fold-manual-remember")
      && byId.get("fold-manual-body")?.hidden === true
      && byId.get("fold-manual-head")?.getAttribute?.("aria-expanded") === "false";
    // 默认打开的是主控台
    const active = (byId.get("tab-console")?.className ?? "").includes("active");
    // ★ 2025：**标签栏必须在所有面板之前**。
    //   踩过的坑：把 5 张卡并进标签页时，`#tabs` 留在了面板**后面**，
    //   于是标签条渲染在内容**下面**（面板 500+ 行 ⇒ 标签跑到页面最底）✗
    const tabsIdx = html.indexOf('id="tabs"');
    const firstPanelIdx = html.indexOf('class="tab-panel"');
    const tabsFirst = tabsIdx >= 0 && firstPanelIdx >= 0 && tabsIdx < firstPanelIdx;
    const guarded = !!consolePanel && !!consoleTab && inside.length === marks.length
      && logInDream && foldOk && active && tabsFirst;
    console.log(`  主控台          ${guarded
      ? `✅ 4 张手动卡都在**折叠组内**（${inside.length}/${marks.length}）且默认收起 ✓`
        + `｜日志已在**梦想子页** ✓｜下拉条/记住复选框都在 ✓｜默认打开；标签栏在面板之前`
      : `❌ 面板=${!!consolePanel} 标签=${!!consoleTab} 卡在折叠组内=${inside.length}/${marks.length}`
        + ` 日志在梦想页=${logInDream} 折叠组=${foldOk} 默认打开=${active} 标签栏在前=${tabsFirst}`}`);
    console.log();
    if (!guarded) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 新增（设计稿第 27 行 / 用户裁定）：
  //   **折叠分组真的能折** + **"记住展开状态"复选框真的记**
  // ══════════════════════════════════════════════════════════
  // 用户原话：「建议有个**下拉条**，同时下拉条中有个**复选框**以确认**记住展开状态**」
  //   ⇒ 三件必须真的成立的事：
  //     ① 点下拉条 ⇒ `hidden` 与 `aria-expanded` **同步**翻转（最容易只改一个 ✗）
  //     ② 点复选框 ⇒ **不能连带折叠**（它在标题行内部 ⇒ 冒泡会误触）
  //     ③ 勾了"记住"后 ⇒ 展开态写进 localStorage，重启按它还原 ✓
  {
    const { UI_FOLDS: FOLDS } = await import(new URL("../src/config.js", import.meta.url).href);
    const f = FOLDS.manual;
    // ⚠️⚠️ **不要**为了测"重启"而再调一次 `initUI`：
    //   ① 它会给同一个节点**再挂一遍监听器**（累积 ⇒ 一次点击触发两次）✗
    //   ② 它还要求**全套 handlers**（我加上后当场 `handlers.onBuyZpeEngine is not a function`）✗
    //   ⇒ 拉一个**全新的模块实例**（`?fresh` 绕开 ESM 缓存），把导出的
    //      `applyFoldPreference` / `setFoldOpen` 拿来对**自己的节点**做纯验证 ✓
    const fresh = await import(new URL("../src/ui.js?fold-probe", import.meta.url).href);
    const head = byId.get("fold-manual-head");
    const body = byId.get("fold-manual-body");
    const box = byId.get("fold-manual-remember");

    const LSKEY = f.rememberKey;
    const LOG = [];
    const makeStore = (init = {}) => {
      const m = new Map(Object.entries(init));
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); LOG.push([k, String(v)]); },
        removeItem: (k) => { m.delete(k); LOG.push([k, null]); },
        _map: m,
      };
    };
    const savedLS = globalThis.localStorage;

    // ── ① 点下拉条：`hidden` 与 `aria-expanded` **同步**翻转 ──
    //   折叠最经典的 bug 就是"只改了一个"⇒ 这里两个都查 ✓
    globalThis.localStorage = makeStore();
    head?.click?.();                                   // 默认收起 ⇒ 这一下应展开
    const opened = body?.hidden === false && head?.getAttribute?.("aria-expanded") === "true";
    head?.click?.();
    const closed = body?.hidden === true && head?.getAttribute?.("aria-expanded") === "false";

    // ── ② 点复选框**不该连带折叠**（它在标题行内部 ⇒ 冒泡会误触）──
    //   ⚠️⚠️ 本 mock **没有冒泡链** ⇒ "折叠态没变"这句**测不出**代码有没有调
    //      `stopPropagation`（我自检时发现：拿掉那一行，断言照样全绿 ⇒ 假断言 ✗）
    //   ⇒ 判据改成**直接的**：这次点击的事件对象上，"停止冒泡"必须被调用过 ✓
    //      （真正的冒泡语义由浏览器保证，没必要在这里重造一套事件系统）
    const before = body.hidden;
    box?.click?.();                                    // mock 会像浏览器那样翻转 checked
    const stopCalled = box?.__lastEvent?.__stopPropagationCalled === true;
    const noSideEffect = body.hidden === before && box.checked === true;

    // ── ③ "记住"：勾上后每次折叠都写入，且**重开页面按它还原** ──
    head?.click?.();                                   // 展开 ⇒ 写入 "open"
    const wroteOpen = globalThis.localStorage._map.get(LSKEY) === "open";
    // 模拟"重开页面"：用**同一份 localStorage** 跑一次初始化
    const r1 = fresh.applyFoldPreference(f, head, body, box);
    const restored = r1.open === true && r1.remembered === true
      && body.hidden === false && head.getAttribute("aria-expanded") === "true";

    // 收起 ⇒ 应写入 "closed"（记忆是双向的）
    head?.click?.();
    const wroteClosed = globalThis.localStorage._map.get(LSKEY) === "closed";
    const r2 = fresh.applyFoldPreference(f, head, body, box);
    const restoredClosed = r2.open === false && body.hidden === true;

    // ── ④ 取消勾选 ⇒ 清键 + 回到默认（收起）──
    box?.click?.();                                    // checked → false
    const cleared = globalThis.localStorage._map.get(LSKEY) === undefined && box.checked === false;
    const r3 = fresh.applyFoldPreference(f, head, body, box);
    const backToDefault = r3.remembered === false && r3.open === f.defaultOpen;

    globalThis.localStorage = savedLS;

    const foldOk = opened && closed && stopCalled && noSideEffect && wroteOpen && restored
      && wroteClosed && restoredClosed && cleared && backToDefault;
    console.log(`  折叠分组        ${foldOk
      ? `✅ 点下拉条：hidden 与 aria-expanded 同步翻转 ✓｜点复选框不连带折叠 ✓`
        + `｜点复选框时调了 stopPropagation ✓（不连带折叠）｜勾"记住"⇒ 写入 open/closed 且**重开页面双向还原** ✓｜取消勾选 ⇒ 清键并回默认（收起）✓`
      : `❌ 展开=${opened}｜再收起=${closed}｜点复选框无副作用=${noSideEffect}`
        + `｜stopPropagation=${stopCalled}｜写open=${wroteOpen}｜重启还原开=${restored}｜写closed=${wroteClosed}｜重启还原关=${restoredClosed}`
        + `｜取消勾选清键=${cleared}｜回默认=${backToDefault}｜记录=${JSON.stringify(LOG.slice(-3))}`}`);
    console.log();
    if (!foldOk) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**① 无限增幅置顶 + 带「买满」**（形态与升级中心一致）
  // ══════════════════════════════════════════════════════════
  {
    const g = (cfgMod.INFINITY_ORDER.indexOf("ipDouble"));
    const inGrid = (byId.get("inf-upgrade-list")?._innerHTML ?? "").includes("inf-btn-ipDouble");
    const btn = byId.get("inf-btn-ipDouble");
    const mx = byId.get("btn-max-ipDouble");
    const colored = (btn?.className ?? "").includes("zone-ip") && (mx?.className ?? "").includes("zone-ip");
    const ok = g >= 0 && !inGrid && !!btn && !!mx && colored;
    console.log(`  ① 置顶行        ${ok ? "✅ 独占一行（不在网格里）+ 买满按钮 + 乘区色 = ZONE_OF.ip" 
      : `❌ 在 INFINITY_ORDER=${g >= 0}｜误留网格里=${inGrid}｜按钮=${!!btn} 买满=${!!mx}｜乘区色=${colored}`}`);
    console.log();
    if (!ok) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 新增（用户报告的 bug）：**① 那一行的 state/cost 必须随等级更新**
  // ══════════════════════════════════════════════════════════
  // 用户原话：「ip点倍增初始*1购买一次后ip点倍增应该*2了，但我目前看着还是*1」
  // 根因：`INFINITY_ORDER` 的循环里 `$(\`inf-btn-${id}\`)` 取不到 ①（它的壳 id 是小写 d 的
  //   `inf-ipdouble-row`）⇒ `if (!btn) continue` **每帧跳过它**
  //   ⇒ `inf-ipDouble-state` / `inf-ipDouble-cost` / `max-ipDouble-n` **从没被更新**
  //   ⇒ 永远停在 index.html 的静态初值 "Lv 0" / "—" / "0" ✗（实发侧一直是对的）
  // ⚠️ 这条断言就是"数值会不会更新"—— 老的"① 置顶行"只查了结构，所以漏了它 ✗
  {
    // ⚠️ 用**独立的 import**（别用 `Dec` —— 它是在另一个块里声明的，这里取不到 ✗）
    const { default: DecIpD } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);
    const st = state;
    st.brokenInfinity = true;
    st.infinityPoints = new DecIpD("1e12");
    st.ipDoubleLevel = new DecIpD(0);
    for (let i = 0; i < 3; i++) { simNow += 16.67; const fn = rafQueue.shift(); if (fn) fn(simNow); }
    const lv0 = byId.get("inf-ipDouble-state")?.textContent ?? "";
    const c0 = byId.get("inf-ipDouble-cost")?.textContent ?? "";
    // 直接给 3 级再渲染一次
    st.ipDoubleLevel = new DecIpD(3);
    for (let i = 0; i < 3; i++) { simNow += 16.67; const fn = rafQueue.shift(); if (fn) fn(simNow); }
    const lv3 = byId.get("inf-ipDouble-state")?.textContent ?? "";
    const d3 = byId.get("inf-ipDouble-desc")?.textContent ?? "";
    const n3 = byId.get("max-ipDouble-n")?.textContent ?? "";
    // 3 级 ⇒ 倍率 2^3 = 8 ⇒ desc 应含 "×8"
    const ok = /Lv\s*0/.test(lv0) && /Lv\s*3/.test(lv3) && /×8/.test(d3) && /花费/.test(c0) && n3 !== "0";
    console.log(`  ① 行数值更新    ${ok ? `✅ Lv0→"${lv0.trim()}"｜Lv3→"${lv3.trim()}"｜desc 含 ×8 ✓｜买满数 = ${n3.trim()}`
      : `❌ **那一行没随等级更新**｜Lv0="${lv0.trim()}"｜Lv3="${lv3.trim()}"（应 Lv 3）｜desc="${d3.trim()}"（应含 ×8）｜max-n="${n3.trim()}"`}`);
    console.log();
    if (!ok) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**标签栏必须常驻顶部**（CSS 粘性）
  // ══════════════════════════════════════════════════════════
  // 用户反馈：「主控台中标签在 tm 的最底下」—— 两个成因，都已修：
  //   ① DOM 顺序：`#tabs` 写在面板**后面** ⇒ 渲染在内容下方（见主控台那条断言 ✓）
  //   ② 粘性对象错了：原先把整张卡设为 sticky，但卡里有 8 个面板、高度远超视口
  //      ⇒ `position: sticky` **不生效** ✗ ⇒ 往下滚就看不到标签
  //   ⇒ 正解：只把**标签栏**粘住（一行高）。它同时必须**不含 overflow**
  //      （否则裁掉子页浮出层 ✗）—— 这条由上面的"会裁剪的祖先"覆盖 ✓
  {
    const tabsBody = ruleOf(".tabs");
    const sticky = /position\s*:\s*sticky/.test(tabsBody);
    const opaque = /background\s*:/.test(tabsBody);
    const ok = sticky && opaque;
    console.log(`  标签栏粘性      ${ok ? "✅ .tabs 为 position:sticky 且有不透明底（滚动时常驻顶部）"
      : `❌ sticky=${sticky}｜不透明底=${opaque}（缺底会透出下方内容）`}`);
    console.log();
    if (!ok) process.exitCode = 1;
  }

  // ══════════════════════════════════════════════════════════
  // ★ 2025 新增：**按钮真的能点动**（派发真实 click，验状态变化）
  // ══════════════════════════════════════════════════════════
  // 用户报：「点大坍缩和购买 zpe 引擎目前无效（点了没反映）」。
  //   引擎侧我单独验过是好的 ⇒ 说明断在 UI 接线/禁用态。
  //   而原来的烟测里 `addEventListener` 是**空函数** ⇒ 这类 bug 根本测不出来 ✗
  //   ⇒ 现在监听器会被记下，`click()` 真的派发（见 makeEl 的 addEventListener/click）。
  {
    const engine2 = await import(new URL("../src/engine.js", import.meta.url).href);
    const cfg2 = await import(new URL("../src/config.js", import.meta.url).href);
    const { default: Dec2 } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);
    const { render: render2 } = await import(new URL("../src/ui.js", import.meta.url).href);
    const st = game.state;

    // ── ① 大坍缩按钮 ──
    st.brokenInfinity = true;
    st.resources.matter = cfg2.crunchThreshold().mul(2);
    st.peakMatter = new Dec2(10).pow(310);
    render2(st);
    const bb = byId.get("btn-bigcrunch");
    const bbDisabled = !!bb.disabled;
    const c0 = Number(st.bigCrunchCount ?? 0);
    const ip0 = st.infinityPoints.toString();
    bb.click();
    const c1 = Number(st.bigCrunchCount ?? 0);
    const ip1 = st.infinityPoints.toString();
    const crunchOk = !bbDisabled && c1 > c0 && ip1 !== ip0;
    console.log(`  大坍缩按钮      ${crunchOk ? `✅ 可点且生效（大坍缩 ${c0} → ${c1}；IP 变了）`
      : `❌ disabled=${bbDisabled}｜crunch ${c0} → ${c1}｜IP ${ip0} → ${ip1}`}`);

    // ══════════════════════════════════════════════════════════
    // ★★★ 2025 新增（用户报的 bug）：**未打破无限时，① 无限增幅也要能买**
    // ══════════════════════════════════════════════════════════
    // 用户原话：「无限增幅开局买不了？我们无限一次的时间这么长，开局还买不到重要的升级不扯淡么？
    //           移除购买无限增幅需要打破无限这个要求。因为打破无限本身也需要 128 个无限点」
    // 根因：实发侧（`buyInfinityUpgrade`）**本来就没这个门槛**（只对 `thresholdFlat` 强制），
    //   而 UI 的 `canIpD` 多写了 `state.brokenInfinity &&`，价格文案也在没打破时显示
    //   "需先打破无限" ⇒ **显示门槛比实发严**（玩家以为买不了）✗
    {
      const { newState: ns5 } = await import(new URL("../src/state.js", import.meta.url).href);
      const { buyInfinityUpgrade: buy5 } =
        await import(new URL("../src/engine.js", import.meta.url).href);
      const { infinityUpgradeCost: iuc5 } =
        await import(new URL("../src/config.js", import.meta.url).href);
      const s5 = ns5();
      s5.brokenInfinity = false;              // ★ 未打破
      s5.infinityPoints = new Dec2(1000);
      // ⚠️ **必须让无限页 `live=true`**，否则 `inf-content` 是 hidden 的
      //   ⇒ 面板里那条渲染分支**根本不跑** ⇒ `inf-ipDouble-cost` 停在**上一次渲染的旧值**
      //   ⇒ 看起来像"渲染算错了"，其实只是没渲染 ✗（我在这里查了半天，靠"打印现场"才定位）
      s5.peakMatter = new Dec2("1e400");
      let renderErr = null;
      const r5 = buy5(s5, "ipDouble");
      const lv5 = Number(s5.ipDoubleLevel ?? 0);
      try { render2(s5); } catch (e) { renderErr = e; }
      const stateTxt = (byId.get("inf-ipDouble-state")?.textContent ?? "").trim();
      const costTxt = (byId.get("inf-ipDouble-cost")?.textContent ?? "").trim();
      const rawCost = String(iuc5(s5, "ipDouble"));
      // 三者必须自洽：等级 1｜价格文案 == **函数返回的那个数**（不写死数字 ✗）
      //   ⚠️ 这里原来写死 `/100/` —— 而用户后来把 ① 首价裁定成 **1 点**
      //     ⇒ 断言当场过期报红 ✗（我又犯了一次"断言里写死业务数字"）
      //   ⇒ 改成"文案里必须出现函数返回的那个数字"，这样价格怎么调它都对 ✓
      const rawCostNum = Number(rawCost);
      const costShownOk = Number.isFinite(rawCostNum)
        ? new RegExp(String(rawCostNum)).test(costTxt) || /e\+/.test(costTxt)
        : false;
      const ok5 = r5.ok === true && lv5 === 1 && !renderErr
        && /Lv\s*1/.test(stateTxt)
        && costShownOk && !/打破/.test(costTxt)
        && rawCost === "1";
      console.log(`  ① 未打破可买    ${ok5
        ? `✅ 未打破时 ok=true｜${stateTxt}｜${costTxt}（= 函数返回 ${rawCost}）✓｜且不再提"需先打破" ✓`
        : `❌ ok=${r5.ok}｜等级=${lv5}（应 1）｜state="${stateTxt}"｜cost="${costTxt}"｜函数=${rawCost}`
          + `｜异常=${renderErr ? renderErr.message : "无"}`}`);
      console.log();
      if (!ok5) process.exitCode = 1;
    }

    // ── ② ZPE 引擎「启动引擎」按钮 ──
    //   ⚠️ 解锁**不花无限点**（界面文案：「解锁 1 次大坍缩，送 1 级，不花无限点」）
    //      ⇒ 断言要验"解锁 + 送 1 级"，**不能**验"IP 被扣" ✗（我第一版就写错了）
    st.bigCrunchCount = new Dec2(1);
    st.infinityPoints = new Dec2(1e6);
    st.zpeEngineUnlocked = false;
    st.zpeEngineLevel = new Dec2(0);
    render2(st);
    const bu = byId.get("btn-unlock-zpe-engine");
    const before = !!st.zpeEngineUnlocked;
    const lv0 = Number(st.zpeEngineLevel ?? 0);
    bu.click();
    const after = !!st.zpeEngineUnlocked;
    const lv1 = Number(st.zpeEngineLevel ?? 0);
    const engineOk = !before && after && lv1 > lv0;
    console.log(`  ZPE 启动按钮    ${engineOk ? `✅ 可点且生效（解锁 ✓，送 1 级：${lv0} → ${lv1}）`
      : `❌ before=${before} after=${after}｜等级 ${lv0} → ${lv1}`}`);

    if (!crunchOk || !engineOk) process.exitCode = 1;

    // ── ③ ZPE 引擎「引擎升格」买级按钮（同一批未 import 的函数之一）──
    const buyBtn = byId.get("btn-buy-zpe-engine");
    const lvA = Number(st.zpeEngineLevel ?? 0);
    const ipA = st.infinityPoints.toString();
    buyBtn.click();
    const lvB = Number(st.zpeEngineLevel ?? 0);
    const buyOk = lvB > lvA && st.infinityPoints.toString() !== ipA;
    console.log(`  ZPE 买级按钮    ${buyOk ? `✅ 可点且生效（等级 ${lvA} → ${lvB}；IP 被扣）`
      : `❌ 等级 ${lvA} → ${lvB}｜IP ${ipA} → ${st.infinityPoints.toString()}`}`);

    // ── ④ 永恒按钮（同一批；门槛 = 无限点 1e280）──
    st.infinityPoints = new Dec2(10).pow(300);
    render2(st);
    const etBtn = byId.get("btn-eternity");
    const e0 = Number(st.eternityCount ?? 0);
    etBtn.click();
    const e1 = Number(st.eternityCount ?? 0);
    const etOk = e1 > e0 && st.eternityPoints.gt(0);
    console.log(`  永恒按钮        ${etOk ? `✅ 可点且生效（永恒次数 ${e0} → ${e1}；EP = ${st.eternityPoints.toString()}）`
      : `❌ 次数 ${e0} → ${e1}｜EP = ${st.eternityPoints.toString()}`}`);

    if (!buyOk || !etOk) process.exitCode = 1;

    // ══════════════════════════════════════════════════════════
    // ★★ 2025 新增：**旧档迁移** —— 老存档（无 `pageUnlocked` 字段）也能保持解锁
    // ══════════════════════════════════════════════════════════
    // 用户第二次实测报告：「刚才又永恒了一次，前面的所有页面（包括永恒页面）
    //   应该都处于解锁状态的呀」
    // 病根：`pageUnlocked` 是 2025 才加的字段 ⇒ **加之前的档里没有它**；
    //   而打点只在"解锁那一刻"发生（旧档玩家早已过了那一刻）⇒ 记录永远为空
    //   ⇒ 永恒后整排页面重新上锁 ✗
    // 修法：`deserialize` 里加迁移 —— `eternityCount > 0` 即证明一路解锁过 ⇒ 补全。
    {
      const { deserialize: de2, serialize: se2, newState: ns2 } = await import(new URL("../src/state.js", import.meta.url).href);
      // ⚠️ 用**独立的 import**，不要引用后面块里的 `cfg3`（作用域不同 ⇒ ReferenceError ✗）
      const { PAGE_KEYS: PK, pageUnlocked: pu } = await import(new URL("../src/config.js", import.meta.url).href);

      /** 造一份"旧版存档"：有永恒次数，但**没有** pageUnlocked 字段 */
      const legacy = (n) => {
        const s = ns2();
        s.eternityCount = n;
        const raw = se2(s);
        delete raw.pageUnlocked;                 // ← 关键：模拟加字段之前的存档
        return JSON.parse(JSON.stringify(raw));
      };

      // ★ 2025 用户裁定（读图后更正）：判据是「**永恒之前解锁过的所有页面**」
      //   ⇒ 那必然包含"永恒"这一页本身 ⇒ 用 `> 0`（至少永恒过一次）✓
      //   ⚠️ 我曾按字面改成 `> 1`，结果用户那个 `eternityCount=1 且记录为空` 的档
      //      **不补全** ⇒ 无限/永恒两页退回"待推进" ✗（用户截图证实）
      const rows = [0, 1, 2, 7].map((n) => {
        const { state: st2 } = de2(legacy(n));
        return { n, got: PK.filter((k) => pu(st2, k)).length };
      });
      // eternityCount=0 的新档应当**保持为空**（不能把新档也全解锁）
      const zeroOk = rows[0].got === 0;
      const migratedOk = rows.slice(1).every((r) => r.got === PK.length);
      const ok = zeroOk && migratedOk;
      console.log(`  旧档页面迁移    ${ok
        ? `✅ 0 次保持 0 个 ✓｜永恒过的档补全 ${PK.length} 个 ✓（1/2/7 次都覆盖）`
        : `❌ 0次=${rows[0].got}（应 0）｜` +
          rows.slice(1).filter((r) => r.got !== PK.length).map((r) => `${r.n}次→${r.got}`).join(",")}`);
      console.log();
      if (!ok) process.exitCode = 1;

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增：**永恒那一刻要把全部页面打点**（用户报的第二个病）
      // ══════════════════════════════════════════════════════════
      // 用户截图：永恒 1 次后，「无限」「永恒」两页显示"待推进"（记录为空 ⇒ perma=false）
      // 修法：`doEternity` 里 `eternityCount+1` 之后把全部 PAGE_KEYS 打点 ✓
      //   这条断言就是钉住"永恒 = 记录补全"，且**不依赖载入时的兜底**（那是另一条路）
      {
        const { newState: ns3 } =
          await import(new URL("../src/state.js", import.meta.url).href);
        // ⚠️ `doEternity` 在 engine.js，而 `canEternity` 在 **config.js**（别都从 engine 取 ✗）
        const { doEternity: doEternity3 } =
          await import(new URL("../src/engine.js", import.meta.url).href);
        const { canEternity: canEternity3, ETERNITY: ET3 } =
          await import(new URL("../src/config.js", import.meta.url).href);
        const s3 = ns3();
        s3.pageUnlocked = {};                       // ← 模拟"记录为空"的旧档
        // ⚠️ 用**本块自己的 import**（`DecIpD` 是另一个块的局部变量 ⇒ 这里取不到 ✗）
        const { default: DecIpD3 } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);
        s3.eternityPoints = new DecIpD3(0);
        // 造到"可永恒"：IP 过门槛
        s3.infinityPoints = DecIpD3.pow(10, ET3.goalLog10);
        const canBefore = canEternity3(s3);
        const r3 = doEternity3(s3);
        const got = PK.filter((k) => pu(s3, k)).length;
        const ok3 = canBefore && r3 != null && s3.eternityCount === 1 && got === PK.length;
        console.log(`  永恒打点        ${ok3
          ? `✅ 可永恒=${canBefore}｜永恒后 count=1 ✓｜**记录补全 ${got}/${PK.length} 个** ✓（不依赖载入兜底）`
          : `❌ 可永恒=${canBefore}｜返回=${r3 == null ? "null" : "ok"}｜count=${s3.eternityCount}（应 1）｜记录 ${got}/${PK.length}`}`);
        console.log();
        if (!ok3) process.exitCode = 1;
      }

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增：**实时自愈**（用户质问「为什么要我再永恒一次？bug 还是特性？」）
      // ══════════════════════════════════════════════════════════
      // 正确语义：「永恒过的档 ⇒ 永恒前的所有页面永久解锁」
      //   ⇒ 判据就是 `eternityCount > 0`，**不该**依赖"那一刻打点成功"。
      //   ⚠️ 原来只有 ① 载入兜底 ② 永恒那刻打点 ⇒ 玩家**内存里**记录为空时
      //      必须**再永恒一次**才补上 ⇒ 看起来就是"页面被重置" ✗
      //   ⇒ 现在 `render()` 开头按 `eternityCount > 0` 补齐（幂等）⇒ 下一帧自愈 ✓
      //   这条断言模拟的就是"用户当前那个档"：count=1、记录为空、**没有**再永恒
      {
        const { newState: ns4 } = await import(new URL("../src/state.js", import.meta.url).href);
        const s4 = ns4();
        s4.eternityCount = 1;
        s4.pageUnlocked = {};                      // ← 关键：记录为空（用户当前状态）
        const before = PK.filter((k) => pu(s4, k)).length;
        // 触发一次 render（正是主循环每帧做的事）
        const { render: render4 } = await import(new URL("../src/ui.js", import.meta.url).href);
        render4(s4);
        const after = PK.filter((k) => pu(s4, k)).length;
        const ok4 = before === 0 && after === PK.length;
        console.log(`  实时自愈        ${ok4
          ? `✅ render 前 ${before} 个 ⇒ render 后 **${after}/${PK.length} 个** ✓（count=1、记录空，无需再永恒）`
          : `❌ render 前 ${before}（应 0）｜render 后 ${after}（应 ${PK.length}）｜count=${s4.eternityCount}`}`);
        console.log();
        if (!ok4) process.exitCode = 1;
      }

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增（用户裁定）：「**确保永恒 1 次后的页面不再有任何可能重新锁定**」
      // ══════════════════════════════════════════════════════════
      // 上面那条守的是"记录为空时能自愈"。这条守**更强的不变量**：
      //   **三条冗余路径**都在 ⇒ 任何一条单独失效，页面也不会锁：
      //     ① 载入兜底（`deserialize`：`eternityCount > 0` ⇒ 补全）
      //     ② 永恒那刻打点（`doEternity`）
      //     ③ 渲染时自愈（`render()` 开头）
      //   ⚠️ 还要守住"**没有任何路径能把它写回 false**"（否则三条路都白搭）
      {
        const { newState: ns6, serialize: se6, deserialize: de6 } =
          await import(new URL("../src/state.js", import.meta.url).href);
        const { doEternity: doE6 } =
          await import(new URL("../src/engine.js", import.meta.url).href);
        const { ETERNITY: ET6, PAGE_KEYS: PK6, pageUnlocked: pu6, markPageUnlocked: mark6 } =
          await import(new URL("../src/config.js", import.meta.url).href);
        const cnt = (st) => PK6.filter((k) => pu6(st, k)).length;
        // ⚠️ 本块自己的 Decimal import（`DecIpD3` 是**另一个块**的局部变量 ⇒ 这里取不到 ✗）
        const { default: Dec6 } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);

        // ① 真实路径：造出"刚永恒完"，那一刻必须已补全
        const a = ns6();
        a.infinityPoints = Dec6.pow(10, ET6.goalLog10 + 30);
        const did = doE6(a) != null;
        const r1 = did && a.eternityCount === 1 && cnt(a) === PK6.length;

        // ② 存盘→读档（含旧档"记录为空"的最恶劣情况）
        const b = de6(se6(a)).state;
        const r2 = cnt(b) === PK6.length;
        const c = de6(se6(a)).state;
        c.pageUnlocked = {};                      // 清空 = 旧档 / 损坏
        const ci = await import(new URL("../src/state.js", import.meta.url).href);
        // 走真实 deserialize 的兜底路径
        const cRaw = se6(c);
        const c2 = ci.deserialize(cRaw).state;
        const r3 = cnt(c2) === PK6.length;

        // ③ 渲染自愈（把记录再清空一次，只靠 render 修）
        const d = de6(se6(a)).state;
        d.pageUnlocked = {};
        const { render: render6 } = await import(new URL("../src/ui.js", import.meta.url).href);
        render6(d);
        const r4 = cnt(d) === PK6.length;

        // ④ **静态**：没有任何路径把 pageUnlocked 写回 false / 清空
        const { readFileSync: rf6 } = await import("node:fs");
        const cfgSrc = rf6(new URL("../src/config.js", import.meta.url), "utf8");
        const engSrc = rf6(new URL("../src/engine.js", import.meta.url), "utf8");
        const noWriteFalse = !/pageUnlocked\[[^\]]+\]\s*=\s*(false|0|null|undefined)/.test(cfgSrc)
          && !/pageUnlocked\s*=\s*\{\s*\}/.test(engSrc)
          && !/delete\s+[^\n]*pageUnlocked/.test(engSrc);

        // ⑤ 4 个会锁的主标签，判据都必须含 perma（子标签 void/zpe 从不上锁）
        const uiSrc6 = rf6(new URL("../src/ui.js", import.meta.url), "utf8");
        const lockLines = uiSrc6.split(/\r?\n/).filter((l) => /classList\.toggle\("locked"/.test(l));
        const allHavePerma = lockLines.length === 4
          && lockLines.every((l) => /perma|tabUnlocked/.test(l));

        const ok6 = r1 && r2 && r3 && r4 && noWriteFalse && allHavePerma;
        console.log(`  页面永不重锁    ${ok6
          ? `✅ 永恒那刻 ${cnt(a)}/${PK6.length} ✓｜读档 ${cnt(b)} ✓｜兜底 ${cnt(c2)} ✓｜渲染自愈 ${cnt(d)} ✓`
            + `｜无路径写回 false ✓｜4 处锁判据都含 perma ✓`
          : `❌ 永恒那刻=${r1}(${cnt(a)})｜读档=${r2}(${cnt(b)})｜兜底=${r3}(${cnt(c2)})`
            + `｜自愈=${r4}(${cnt(d)})｜无写回false=${noWriteFalse}｜判据含perma=${allHavePerma}(${lockLines.length}处)`}`);
        console.log();
        if (!ok6) process.exitCode = 1;
      }

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增（`docs/NEKO.md` §7 / 设计稿 §10）：**猫猫卡片 + 好感度指数**
      // ══════════════════════════════════════════════════════════
      // 守「显示 == 实发」：卡片上的好感度 / 指数 / 下一档必须与
      //   `nekoGlobalExponent` / `nekoNextTier`（唯一入口）一致 ✓
      // 另守：**默认态零回归**（好感度 0 ⇒ 指数 1 ⇒ `gm-neko` 那一格隐藏）
      {
        const { newState: nsN } = await import(new URL("../src/state.js", import.meta.url).href);
        const { nekoGlobalExponent: expN, nekoNextTier: nextN } =
          await import(new URL("../src/config.js", import.meta.url).href);
        const { render: renderN } = await import(new URL("../src/ui.js", import.meta.url).href);

        // ⚠️⚠️ 期望值**独立复现**，**不要**拿 `nekoGlobalExponent` 的输出当期望 ✗
        //   （我第一版就是那样写的 ⇒ 自检时把叠乘改成"取最后一档"，断言**照样全绿** ⇒
        //     这条断言等于自证，抓不到任何东西。教训：期望值必须来自 spec，不能来自被测函数。）
        //   spec（`docs/NEKO.md` §7）：三档 **>25 / >50 / >75** ⇒ `^1.002 / ^1.005 / ^1.015` **叠乘**
        const WANT = 1.002 * 1.005 * 1.015;            // = 1.02211515
        const wantStr = WANT.toFixed(7);

        const sN = nsN();
        renderN(sN);                                   // 默认：好感度 0
        const aff0 = (byId.get("neko-affinity")?.textContent ?? "").trim();
        const exp0 = (byId.get("neko-exponent")?.textContent ?? "").trim();
        const gm0 = byId.get("gm-neko")?.hidden;

        // 顺带用**独立期望**验一遍函数本身（三档边界：25 不给、26 给）
        const fnOk = expN({ nekoAffinity: 25 }) === 1
          && Math.abs(expN({ nekoAffinity: 26 }) - 1.002) < 1e-12
          && Math.abs(expN({ nekoAffinity: 51 }) - 1.002 * 1.005) < 1e-12
          && Math.abs(expN({ nekoAffinity: 100 }) - WANT) < 1e-12;

        sN.nekoAffinity = 100;                         // 全档
        renderN(sN);
        const aff1 = (byId.get("neko-affinity")?.textContent ?? "").trim();
        const exp1 = (byId.get("neko-exponent")?.textContent ?? "").trim();
        const gm1 = byId.get("gm-neko")?.hidden;
        const gmTxt = (byId.get("gm-neko")?.textContent ?? "").trim();

        const okN = fnOk
          && aff0 === "0" && /未生效/.test(exp0) && gm0 === true
          && aff1 === "100" && exp1.includes(wantStr) && gm1 === false
          && gmTxt.includes(wantStr)
          && nextN(sN) === null;
        console.log(`  猫猫卡片        ${okN
          ? `✅ 三档边界(25→^1 / 26→^1.002 / 51→^1.00701 / 100→^${wantStr}) ✓`
            + `｜卡片默认「${aff0} / ${exp0}」指数格隐藏 ✓｜满档「${aff1} / ^${wantStr}」显示 ✓`
          : `❌ 三档函数=${fnOk}｜默认[${aff0}|${exp0}|hidden=${gm0}]`
            + `｜满档[${aff1}|${exp1}|hidden=${gm1}|gm="${gmTxt}"]｜**独立期望 ^${wantStr}**`}`);
        console.log();
        if (!okN) process.exitCode = 1;
      }

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增（用户原则「没有 ui 真的很容易误判」）：
      //   **自动化状态** + **好感度档位阶梯** + **调试按钮可交互**
      // ══════════════════════════════════════════════════════════
      // 这三条守的都是"**已实现的机制必须有 UI 出口**"：
      //   · ∞ 层自动化（`isAutoAcquire` / 梦想升级 `autoBuyDe`）—— 早就实现了，一直零 UI ✗
      //   · 好感度三档阶梯 —— 好感度恒 0 时整张卡会像装饰 ✗
      //   · 调试按钮 —— 必须真的改到 state（走唯一写入点 `addNekoAffinity`）
      {
        const { newState: nsA } = await import(new URL("../src/state.js", import.meta.url).href);
        const { render: renderA } = await import(new URL("../src/ui.js", import.meta.url).href);
        const { NEKO: NKA } = await import(new URL("../src/config.js", import.meta.url).href);

        // ① 自动化状态：未开启时要有**指明怎么开**的文案（不能只写"未开启"）
        const sA = nsA();
        renderA(sA);
        const auto0 = (byId.get("auto-acquire")?.textContent ?? "").trim();
        const autoDe0 = (byId.get("auto-de")?.textContent ?? "").trim();
        const autoOk0 = /未开启/.test(auto0) && /v9/.test(auto0) && /未开启/.test(autoDe0) && /梦想升级/.test(autoDe0);

        // 开启后必须变成"已开启"
        sA.voidUpgrades.v9 = true;
        sA.zpeMilestones.m2 = true;             // m2/m5 是 isAutoAcquire 的判据
        sA.dreamUpgrades.autoPhase = true;
        renderA(sA);
        const auto1 = (byId.get("auto-acquire")?.textContent ?? "").trim();
        const autoDe1 = (byId.get("auto-de")?.textContent ?? "").trim();
        const autoOk1 = /已开启/.test(auto1) && /已开启/.test(autoDe1) && /autoPhase|phaseShift/.test(autoDe1);

        // ② 档位阶梯：三条都在，且生效的会被标 on
        const tiers = NKA.tiers.map((t) => byId.get(`neko-tier-${t.need}`));
        const tiersExist = tiers.every(Boolean);
        const sT = nsA();
        sT.nekoAffinity = 30;                   // 只过第一档（>25）
        renderA(sT);
        const onCount = tiers.filter((d) => (d?.className ?? "").includes("on")).length;
        const tierOk = tiersExist && onCount === 1;

        // ③ **道具按钮**：点一下必须真的改到 state（走 `useNekoItem` 唯一入口）
        //   ⚠️⚠️ 必须用 `game.state`（= **main.js 自己的** state），不能自己 `newState()` ✗
        //      —— 按钮的 handler 闭包捕获的是 main.js 的 state；
        //         拿自己 new 的 state 去读 ⇒ 永远读到 0（我第一版就栽在这，看起来像"按钮没接上"）
        //   ★ 2025：原来这里点的是**临时调试按钮** `btn-neko-test-up`；道具实装后
        //     调试按钮**已删除** ⇒ 改成点**真道具**（猫条，免费 ⇒ 一定能点动）✓
        const sB = game.state;
        sB.nekoAffinity = 0;
        sB.nekoDriftStamps = [];                // 清掉窗口预算，保证这次点击能足额进账
        renderA(sB);
        const btnCatFood = byId.get("btn-neko-item-catFood");
        btnCatFood?.click?.();
        const afterClick = Number(sB.nekoAffinity ?? 0);
        // 猫条名义 +1（`NEKO_ITEMS.catFood.gain`）
        const clickOk = afterClick === 1;
        // 顺带验：**棒棒糖会清空物质**（§10 的"消耗当前所有物质"）—— 这是最容易写错的一条
        const { default: DecItem } = await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href);
        sB.nekoDriftStamps = [];
        sB.resources.matter = DecItem.pow(10, 20);
        renderA(sB);
        byId.get("btn-neko-item-lollipop")?.click?.();
        const lolliOk = sB.resources.matter.eq(0) && Number(sB.nekoAffinity) === 1 + 3;

        const okAll = autoOk0 && autoOk1 && tierOk && clickOk && lolliOk;
        console.log(`  机制可见性      ${okAll
          ? `✅ 自动化未开启时指明 v9/梦想升级 ✓｜开启后显示已生效 ✓｜档位阶梯 3 条且只亮 1 档 ✓`
            + `｜猫条 +${afterClick} ✓｜棒棒糖清空物质（${sB.resources.matter.toString()}）且 +3 ✓`
          : `❌ 自动化0[${auto0}|${autoDe0}]${autoOk0 ? "" : " ✗"}`
            + `｜自动化1[${auto1}|${autoDe1}]${autoOk1 ? "" : " ✗"}`
            + `｜档位存在=${tiersExist} 亮${onCount}档（应1）`
            + `｜点击后好感度=${afterClick}（应 ${NKA.driftMax}）`}`);
        console.log();
        if (!okAll) process.exitCode = 1;
      }

      // ══════════════════════════════════════════════════════════
      // ★★★ 2025 新增（`docs/NEKO.md` §5 / §9）：**N.E.K.O 接入层（无宿主版本）**
      // ══════════════════════════════════════════════════════════
      // 用户裁定：「先做无宿主版本」。所以这条断言守的是**降级契约**：
      //   ① 「没有宿主时一切 no-op」—— 游戏主流程不受影响（**最重要**）
      //   ② §9 的日志形状 `{ t, kind, text, data }` + kind 的**固定枚举**
      //   ③ §5 的快照形状：schema 版本、**不许编造不存在的字段**（如 darkMatter）、
      //      没有注入速率时给 `null`（而不是假的 0 ✗）
      //   ④ `pushLog` 的出口真的挂上了桥
      {
        const { nekoLogKind: kindN, nekoSnapshot: snapN, nekoLogEntry: entryN,
          createNekoBridge: mkBridge, nekoHostPresent: hostN } =
          await import(new URL("../src/neko.js", import.meta.url).href);
        const { newState: nsNk, pushLog: pushNk, setLogSink: setSinkNk } =
          await import(new URL("../src/state.js", import.meta.url).href);

        // ① kind 的固定枚举（§9）+ **最易错的那条**：无限挑战 ≠ crunch
        const KIND_CASES = [
          ["🌌 大坍缩！物质触及 1.80e308 上限", "crunch"],
          ["💠 打破无限！物质上限解除", "crunch"],
          ["开始无限挑战 1／3（熵需求 ×5）", "system"],
          ["⚛ 捕获第 1 对量子", "quantum"],
          ["⚡ 购买虚空升级「v1」", "buy"],
          ["🏆 达成虚空里程碑：x", "milestone"],
          ["随便一条没有任何前缀的", "system"],
        ];
        const kindBad = KIND_CASES.filter(([t, w]) => kindN(t) !== w);

        // ② 四元组形状（§9）
        const e0 = entryN({ t: 7, text: "🏆 达成里程碑" });
        const shapeOk = e0.t === 7 && e0.kind === "milestone" && e0.text === "🏆 达成里程碑"
          && typeof e0.data === "object" && e0.data !== null;

        // ③ 快照形状（§5）：schema / 不编字段 / 未注入速率给 null
        const stNk = nsNk();
        const snap = snapN(stNk, 4242);
        const snapOk = snap.schema === 1 && snap.t === 4242
          && snap.resources && typeof snap.resources.matter === "number"
          && snap.progress && typeof snap.progress.brokenInfinity === "boolean"
          && snap.rates === null                       // ← 未注入 ⇒ null（**不是 0**）
          && Array.isArray(snap.log)
          && !("darkMatter" in snap.resources);        // ← 不许编造后续阶段的字段

        // ④ **无宿主降级**：available=false，且 sendLog / publishSnapshot 都不抛、返回 false
        const br = mkBridge({ getState: () => stNk });
        br.connect();                                   // 测试环境没有宿主节点
        let threw = null;
        let logRet = null, snapRet = null;
        try {
          logRet = br.sendLog({ t: 1, text: "🌌 大坍缩" });
          snapRet = br.publishSnapshot();
        } catch (err) { threw = err; }
        const degradeOk = br.available === false && br.connected === false
          && threw === null && logRet === false && snapRet === false
          && hostN(globalThis.document) === false;

        // ⑤ `pushLog` 的出口真的挂上了桥（用哨兵 sink 验，不动真实桥）
        let seen = null;
        setSinkNk((en) => { seen = en; });
        pushNk(stNk, "⚡ 购买虚空升级「哨兵」");
        setSinkNk(null);                               // ★ 还原，别影响后续断言
        const sinkOk = seen && seen.text === "⚡ 购买虚空升级「哨兵」";

        const okNk = kindBad.length === 0 && shapeOk && snapOk && degradeOk && sinkOk;
        console.log(`  N.E.K.O 接入层   ${okNk
          ? `✅ 无宿主时全 no-op（available=false、sendLog/publishSnapshot 返回 false 且不抛）✓`
            + `｜日志形状 {t,kind,text,data} ✓｜kind 枚举 7/7 ✓（含"无限挑战≠crunch"）`
            + `｜快照 schema=1、未注入速率给 null、不编 darkMatter ✓｜pushLog 出口已挂桥 ✓`
          : `❌ kind 错 ${kindBad.length} 条${kindBad.length ? "(" + kindBad.map(([t, w]) => `${kindN(t)}≠${w}`).join(",") + ")" : ""}`
            + `｜四元组=${shapeOk}｜快照=${snapOk}｜降级=${degradeOk}(threw=${threw ? threw.message : "无"})`
            + `｜出口=${sinkOk}`}`);
        console.log();
        if (!okNk) process.exitCode = 1;

        // ── ★★★ 动作白名单（`NEKO.md` §6 的三条硬约束）──
        //   ① 阶段白名单：没到该阶段 ⇒ 拒绝（**不替玩家越门槛**）
        //   ② 只走既有购买函数：断言 `fn` **就是** engine 的导出（同一函数对象）
        //   ③ 限流 + 幂等：每批最多 N 条；买不起由购买函数自己拒（天然幂等）
        //   ⚠️⚠️ 判别式必须含 **`applied < total`** —— 否则"把一切都拒绝"的退化实现
        //        也能拿全绿（假断言 ✗，本项目踩过同类）
        {
          const { dispatchNekoActions: dispNk } = await import(new URL("../src/neko.js", import.meta.url).href);
          const engineNk = await import(new URL("../src/engine.js", import.meta.url).href);
          const cfgNk = await import(new URL("../src/config.js", import.meta.url).href);
          const { newState: nsAct } = await import(new URL("../src/state.js", import.meta.url).href);

          const calls = [];
          // ⚠️ `maxPerTick` 必须 **≥ 样本条数** —— 否则后面的样本会被**限流**截掉，
          //   于是 `results[i]` 是 `undefined`，看起来像"守卫没生效" ✗
          //   （我第一版用 3 配 6 条样本，就栽在这）
          //   限流本身用**第二段**单独验（见下）✓
          const apiNk = {
            maxPerTick: 8,
            hasRepeatable: (id) => id in cfgNk.REPEATABLE,
            hasVoid: (id) => id in cfgNk.VOID_UPGRADES,
            hasDe: (id) => id in cfgNk.DE_UPGRADES,
            hasInfinity: (id) => id in cfgNk.INFINITY_UPGRADES,
            // ⚠️ 这里**刻意用假函数记调用**（只为验派发逻辑）；
            //    "fn 就是引擎导出"由下面第 ② 条断言**独立**验（不靠这个假 api）
            buyRepeatable: () => { calls.push("repeatable"); return true; },
            buyVoidUpgrade: () => { calls.push("void"); return true; },
            buyDeUpgrade: () => { calls.push("de"); return true; },
            buyInfinityUpgrade: () => { calls.push("inf"); return { ok: true }; },
            doBigCrunch: () => { calls.push("crunch"); return 1; },
            doEternity: () => { calls.push("eternity"); return 1; },
          };
          const sAct = nsAct();
          const firstId = Object.keys(cfgNk.REPEATABLE)[0];
          const batch = [
            { type: "buyRepeatable", payload: { id: firstId, max: false } },   // 合法 ⇒ ok
            { type: "buyRepeatable", payload: { id: "根本不存在" } },           // 未知 id ⇒ rejected
            { type: "doBigCrunch" },                                            // 未打破 ⇒ rejected
            { type: "setAuto" },                                                // 未实装 ⇒ rejected
            { type: "瞎写的动作" },                                              // unknown_action
            { type: "buyInfinityUpgrade", payload: { id: "ipDouble" } },        // 合法 ⇒ ok
          ];
          const rAct = dispNk(sAct, batch, apiNk);
          const byStatus = (x) => rAct.results.filter((r) => r.status === x).length;
          const find = (t) => rAct.results.find((r) => r.type === t);

          const guardOk2 = find("buyRepeatable")?.status === "ok"
            && rAct.results[1]?.status === "rejected"                  // 未知 id
            && find("doBigCrunch")?.status === "rejected"              // 阶段未到
            && find("setAuto")?.status === "rejected"                  // setAuto 未实装
            && find("瞎写的动作")?.status === "unknown_action";         // 不认识的动作不抛
          // ⚠️ 判别式：**必须真的执行了一些**（applied>0）且**不是全执行**（applied<total）
          const appliedOk = rAct.applied === 2 && rAct.applied < batch.length;

          // ── ③ 限流：单独一批，样本数 > maxPerTick ──
          const smallApi = { ...apiNk, maxPerTick: 3 };
          const rLim = dispNk(nsAct(), [
            { type: "buyRepeatable", payload: { id: firstId } },
            { type: "buyRepeatable", payload: { id: firstId } },
            { type: "buyRepeatable", payload: { id: firstId } },
            { type: "buyRepeatable", payload: { id: firstId } },
            { type: "buyRepeatable", payload: { id: firstId } },
          ], smallApi);
          const limitOk = rLim.results.length === 3 && rLim.throttled === 2 && rLim.applied === 3;
          // ② 「只走既有购买函数」的机械证明：
          //   · 白名单里的动作名**必须**在 engine 里是真函数（否则接线写错 → 点了没反应 ✗）
          //   · 且 `main.js` 注入的 api 必须**就是**这些 engine 导出（不是自己抄的一份）
          //   ⚠️ dom-smoke 拿不到 main.js 内部的 api 对象 ⇒ 只能验"engine 侧存在"；
          //      "注入的是同一函数"由 `main.js` 里那张表**结构上保证**（每项都是 engine 导出）✓
          const ENGINE_FNS = ["buyRepeatable", "buyVoidUpgrade", "buyDeUpgrade",
            "buyInfinityUpgrade", "doBigCrunch", "doEternity"];
          const fnMissing = ENGINE_FNS.filter((n) => typeof engineNk[n] !== "function");
          // 白名单的 6 个"可派发"动作名（`setAuto` 是第 7 个，但**故意未实装**）
          const WL = Object.keys(cfgNk.NEKO_ACTIONS);
          const wlOk = WL.length === 7 && WL.includes("setAuto");

          const okAct = guardOk2 && limitOk && appliedOk && fnMissing.length === 0 && wlOk;
          console.log(`  猫娘动作白名单   ${okAct
            ? `✅ 派发批次：合法 2 条执行 ✓｜未知id / 阶段未到(doBigCrunch) / setAuto未实装 各拒绝 ✓`
              + `｜未知名不抛(${byStatus("unknown_action")} 条 unknown_action) ✓｜applied=${rAct.applied} < 总数${batch.length} ✓`
              + `｜限流单独验：5 条样本 / 上限 3 ⇒ 执行 ${rLim.applied}、截掉 ${rLim.throttled} ✓`
              + `｜白名单 ${WL.length} 个动作、engine 侧 6 个派发函数全在 ✓`
            : `❌ 合法条=${find("buyRepeatable")?.status}/${find("buyInfinityUpgrade")?.status}（应 ok/ok）`
              + `｜未知id=${rAct.results[1]?.status}｜阶段未到=${find("doBigCrunch")?.status}`
              + `｜setAuto=${find("setAuto")?.status}｜未知名=${find("瞎写的动作")?.status}`
              + `｜限流: 结果${rLim.results.length}/应3、截掉${rLim.throttled}/应2、执行${rLim.applied}/应3`
              + `｜applied=${rAct.applied}（应 2）｜engine 缺函数=${fnMissing.join(",") || "无"}｜白名单=${WL.length} 个（应 7）`}`);
          console.log();
          if (!okAct) process.exitCode = 1;
        }
      }
    }

    // ══════════════════════════════════════════════════════════
    // ★★ 2025 新增：**永恒后相关页面保持解锁**（用户玩完第一轮的反馈）
    // ══════════════════════════════════════════════════════════
    // 原来各面板的解锁判定全建立在**会被 `doEternity` 清零的值**上：
    //   · 量子/无限 = `collapseUnlocked`（`peakMatter ≥ 1e25`）
    //   · 暗能量   = `phaseTransmuterUnlocked`
    //   · ZPE 引擎 = `zpeEngineUnlocked`
    //   · 虚空     = 由 `v1` 等虚空升级推导
    // ⇒ 永恒后整排标签重新上锁，把玩家玩过的内容收回去 ✗
    //   ⇒ 修复：解锁记进 `state.pageUnlocked`（**永不重置**），UI 读它判"标签是否上锁"。
    {
      const cfg3 = await import(new URL("../src/config.js", import.meta.url).href);
      const { render: render3 } = await import(new URL("../src/ui.js", import.meta.url).href);
      const st3 = game.state;
      const { pageUnlocked, markPageUnlocked, PAGE_KEYS } = cfg3;

      // ① 进入一次"什么都已经解锁"的状态，然后永恒
      st3.peakMatter = new Dec2(10).pow(26);
      st3.phaseTransmuterUnlocked = true;
      st3.zpeEngineUnlocked = true;
      st3.bigCrunchCount = new Dec2(30);
      st3.voidUpgrades = { ...(st3.voidUpgrades ?? {}), v1: true };
      for (const k of PAGE_KEYS) markPageUnlocked(st3, k);
      st3.infinityPoints = new Dec2(10).pow(300);          // 满足永恒门槛
      const beforeKeys = PAGE_KEYS.filter((k) => pageUnlocked(st3, k));

      engine2.doEternity(st3);

      // ② 永恒把「数值」清零（这是应当的）
      const wiped = {
        peakMatter: st3.peakMatter.lte(0),
        transmuter: st3.phaseTransmuterUnlocked === false,
        engine: st3.zpeEngineUnlocked === false,
        cruches: st3.bigCrunchCount.lte(0),
        v1: st3.voidUpgrades?.v1 === false,
      };
      // ③ 但「解锁记录」必须还在
      const afterKeys = PAGE_KEYS.filter((k) => pageUnlocked(st3, k));

      // ④ 最硬的判据：**渲染之后标签不能带 locked class**
      //   ⚠️ 必须把**所有**有 locked 概念的标签都列进来 —— 第一版漏了 `eternity`，
      //      结果"永恒页永恒后仍上锁"这个 bug 没被这条断言抓到 ✗
      //      （用户实测反馈：「我的永恒页面也被重置了」）
      render3(st3);
      const tabIds = {
        void: "tab-void", de: "tab-de", quantum: "tab-quantum",
        infinity: "tab-infinity", eternity: "tab-eternity",
      };
      const lockedTabs = Object.entries(tabIds)
        .filter(([, id]) => (byId.get(id)?.className ?? "").includes("locked"))
        .map(([k]) => k);

      const wipedOk = Object.values(wiped).every(Boolean);
      const keysOk = afterKeys.length === PAGE_KEYS.length && beforeKeys.length === PAGE_KEYS.length;
      const tabsOk = lockedTabs.length === 0;
      // ⑤ 标签文字也不该退回"锁"（`locked` class 与 badge 是两个独立落点）
      const badgeLocked = Object.keys(tabIds).filter((k) => {
        const tag = byId.get(`tab-tag-${k}`);
        return tag && String(tag.textContent ?? "").trim() === "锁";
      });
      const badgeOk = badgeLocked.length === 0;
      const ok = wipedOk && keysOk && tabsOk && badgeOk;
      console.log(`  永恒后页面解锁  ${ok ? `✅ 数值清零 ✓ 解锁记录保留 ✓ ${Object.keys(tabIds).length} 个标签都不上锁、badge 也不显示"锁" ✓`
        : `❌ 数值清零=${wipedOk}${wipedOk ? "" : `（${Object.entries(wiped).filter(([, v]) => !v).map(([k]) => k).join(",")} 没清零）`}` +
          `｜解锁记录=${afterKeys.length}/${PAGE_KEYS.length}｜仍上锁的标签=${lockedTabs.join(",") || "无"}` +
          `｜badge 显示"锁"的=${badgeLocked.join(",") || "无"}`}`);
      console.log();
      if (!ok) process.exitCode = 1;
    }
  }
}
const guardFailed3 = guardFailed2 || zoneGuard.startsWith("❌");

// ══════════════════════════════════════════════════════════
// 回归守卫：虚空科技的子页（悬停浮出两条入口 + ZPE 引擎面板）
// ══════════════════════════════════════════════════════════
// 踩过的同类坑：加了面板却忘了接进 activateTab 的白名单 -> 页面永远不显示。
// 所以这里既查静态 HTML（浮出层两条入口），也真的切一次子页看面板显隐。
let subGuard = "未跑";
{
  // ★ 通用化：每个 `.tab-wrap`（虚空科技、无限）都必须浮出**两条**入口
  const wraps = [...html.matchAll(/id="(tab-(?:wrap|flyout)-[\w-]+|flyout-[\w-]+)"/g)].map((m) => m[1]);
  // ★★★ 2025（用户裁定）：主控台也有**三个子页**了（主控台 / 梦想 / 猫猫）——
  //   「neko 页面与梦想页面（自动化）应该归属于主控台的子页面（类似虚空科技下的子页面表现形式）」
  const flyoutOk = /id="tab-flyout-void"[\s\S]{0,400}id="flyout-void-core"[\s\S]{0,400}id="flyout-void-zpe"/.test(html) &&
    /id="tab-flyout-infinity"[\s\S]{0,400}id="flyout-inf-core"[\s\S]{0,400}id="flyout-inf-deep"/.test(html) &&
    /id="tab-flyout-console"[\s\S]{0,500}id="flyout-console-core"[\s\S]{0,500}id="flyout-console-dream"[\s\S]{0,500}id="flyout-console-neko"/.test(html) &&
    (html.match(/data-tab="zpe"/g) ?? []).length >= 1 &&
    (html.match(/data-tab="infdeep"/g) ?? []).length >= 1 &&
    (html.match(/data-tab="dream"/g) ?? []).length >= 1 &&
    (html.match(/data-tab="neko"/g) ?? []).length >= 1 && wraps.length >= 10;
  const { activateTab } = await import(new URL("../src/ui.js", import.meta.url).href);
  activateTab("zpe");
  const toZpe = byId.get("panel-zpe")?.hidden === false && byId.get("panel-void")?.hidden === true;
  activateTab("infdeep");
  const toDeep = byId.get("panel-infdeep")?.hidden === false && byId.get("panel-infinity")?.hidden === true;
  // ★ 主控台子页：切到"猫猫"与"梦想"必须各显示对应面板、且**互斥**
  activateTab("neko");
  const toNeko = byId.get("panel-neko")?.hidden === false
    && byId.get("panel-console")?.hidden === true && byId.get("panel-dream")?.hidden === true;
  activateTab("dream");
  const toDream = byId.get("panel-dream")?.hidden === false
    && byId.get("panel-console")?.hidden === true && byId.get("panel-neko")?.hidden === true;
  // 猫猫子页必须是**两列**（用户裁定：对话功能 ⇒ 左右两列）
  const nekoTwoCol = /class="neko-cols"/.test(html)
    && (html.match(/class="neko-cols"/g) ?? []).length === 1
    && /grid-template-columns:\s*minmax\(0,\s*5fr\)\s*minmax\(0,\s*7fr\)/.test(ruleOf(".neko-cols"));
  activateTab("void");
  const backToVoid = byId.get("panel-void")?.hidden === false && byId.get("panel-zpe")?.hidden === true &&
    byId.get("panel-infdeep")?.hidden === true && byId.get("panel-neko")?.hidden === true;

  // ★ 浮出层不能被祖先**裁剪**。踩过的坑：`.tabs` 上写了 `overflow-x: auto`，
  //   于是（CSS 规范：一轴非 visible 时另一轴的 visible 会算成 auto）标签条成了滚动容器，
  //   绝对定位的浮出层被裁掉、而滚动条又被藏起来 —— 现象就是「看不到，要滚轮才滚出来」。
  //   ⚠️ 判定必须**提取所有 overflow 声明再看值**：
  //      第一版用 `(?!visible)` 前后查找，被正则回溯绕过（`overflow: visible` 也判成裁剪）；
  //      而且只写 `overflow:` 会漏掉分轴写法 `overflow-x/-y` —— 那正是真凶。
  // ★ 2025：改成**按选择器精确匹配规则头**（原来用 `\.card\s*\{` 这种子串正则，
  //   会被 `.layout > .col > .card {` 误命中 ⇒ 报假阳性 ✗ 我自己就踩到了）。
  //   （`ruleOf` / `clipsOverflowOf` 已在文件顶层定义 ✓）
  const clipsOverflow = clipsOverflowOf;
  const clipping = [".tabs", ".card", ".wrap", ".col"].filter((sel) => {
    const body = ruleOf(sel);
    return body && clipsOverflow(body);
  });
  // 顺带确认浮出层用的是绝对定位 + 有层级（不然会被面板盖住或跟着文档流排）
  const flyoutCss = ruleOf(".tab-flyout");
  const flyoutStyle = /position\s*:\s*absolute/.test(flyoutCss) && /z-index\s*:/.test(flyoutCss);

  const ok = flyoutOk && toZpe && toDeep && backToVoid && toNeko && toDream && nekoTwoCol
    && clipping.length === 0 && flyoutStyle;
  subGuard = ok
    ? "✅ 三组悬浮子页（虚空/无限/主控台）；主控台的梦想+猫猫互斥切换正常；猫猫为两列；无祖先裁剪"
    : `❌ 悬浮入口=${flyoutOk}｜切到 zpe=${toZpe}｜切到 infdeep=${toDeep}｜切回 void=${backToVoid}` +
      `｜切到 neko=${toNeko}｜切到 dream=${toDream}｜猫猫两列=${nekoTwoCol}` +
      `｜会裁剪的祖先=${clipping.join(",") || "无"}｜浮出层样式=${flyoutStyle}`;
  console.log(`  标签子页        ${subGuard}`);
  console.log();
}

// ══════════════════════════════════════════════════════════
// 风格守卫：**面板正文里不许出现 emoji**
// ══════════════════════════════════════════════════════════
// 踩过的坑：优化「无限 / ZPE 引擎」文案时我顺手把 0.3.4 原稿的 emoji 一起搬了过来，
// 用户当场指出「emoji 不要啊，没让你全学习啊，amoled 主风格不要了？」——
// 原稿是霓虹 emoji 风，AMOLED 是**细线 + 大写小节标题 + 徽标 + 无图标**。
// 所以：文案写法可以借（箭头短句），**图标不许借**。锁图标一律用 HTML 实体（&#9881;）。
{
  const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "");   // 注释里的 ★ 不算
  const panelOf = (id) => {
    const start = html.indexOf(`id="${id}"`);
    if (start < 0) return "";
    const next = html.indexOf('class="tab-panel"', start);
    return strip(html.slice(start, next < 0 ? undefined : next));
  };
  // 只匹配真正的 emoji 区段（刻意排除 → U+2192 这类"箭头标点" —— 它是文案写法，不是图标）
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  // 全部面板都查（回填文案时最容易顺手搬 emoji）
  const bad = ["panel-void", "panel-zpe", "panel-de", "panel-quantum", "panel-infinity", "panel-eternity"]
    .filter((id) => EMOJI.test(panelOf(id)));
  const okStyle = bad.length === 0;
  console.log(`  AMOLED 风格    ${okStyle ? "✅ 六个面板正文无 emoji（图标只用 HTML 实体）" : `❌ 面板里出现了 emoji：${bad.join(", ")}`}`);
  console.log();
  if (!okStyle) process.exit(1);
  console.log();
}
const guardFailed4 = guardFailed3 || subGuard.startsWith("❌");

process.exit(caught || guardFailed4 ? 1 : 0);
