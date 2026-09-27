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
      return [];
    },
    closest(sel) {
      const cls = sel.replace(/^\./, "");
      if (this._classes.has(cls)) return this;
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
  };
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
for (const m of html.matchAll(/id="([\w-]+)"/g)) {
  byId.set(m[1], makeEl("div", m[1]));
  staticIds++;
}

// 顺带检查 ui.js 的 cache 数组是否都能在 html 里找到
const uiSrc = readFileSync(join(ROOT, "src", "ui.js"), "utf8");
const cacheBlock = uiSrc.match(/const ids = \[([\s\S]*?)\];/)[1];
const cachedIds = [...cacheBlock.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
const missingIds = cachedIds.filter((id) => !html.includes(`id="${id}"`));

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

process.exit(caught ? 1 : 0);
