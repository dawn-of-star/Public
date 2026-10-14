/**
 * tools/render-profile.mjs —— ★★★ 2025：**render() 逐段插桩**（找 170ms 在哪）
 *
 * ── 为什么要这个工具 ──
 *   用户 HUD 实测：`tick 0.4ms` 但 **`render 170.5ms`**（我在 Node 里复现只有 3~4ms）✗
 *   `performance.now()` 只量**同步 JS** ⇒ 那 170ms 真的是**卡在 JS 里**，
 *   不是"浏览器样式重算"（那种情况 frameMs 会大、renderMs 不会）。
 *   ⇒ 必须知道**哪一段**。本工具把 `render()` 的每个子渲染器逐个包起来计时，
 *     并**统计调用次数**（次数异常 = 有循环放大）✓
 *
 * ── 怎么用 ──
 *   `node tools/render-profile.mjs`（用假 DOM，无需浏览器）
 *   它会打印每个子渲染器的 总耗时 / 次数 / 单次 / 最大
 *
 * ⚠️ 它**不改生产代码**：用的是"从 config.js 里取出真函数再包一层"的方式，
 *   而 `ui.js` 的内部函数拿不到 ⇒ 改为**在源码里插桩**（`perfSection`），
 *   本工具只负责**跑 + 汇总**。插桩点在 `ui.js` 的 `render()` 里，默认零开销 ✓
 */
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const byId = new Map();
function makeEl(tag = "div") {
  const node = {
    tagName: String(tag).toUpperCase(), id: "", className: "", hidden: false,
    children: [], style: {}, dataset: {}, checked: false, value: "", disabled: false,
    _classes: new Set(), _handlers: {}, _attrs: new Map(), _innerHTML: "",
    get classList() { const s = this._classes; return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c), toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; } }; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); this._children = []; for (const m of String(v).matchAll(/id="([\w-]+)"/g)) { const c = makeEl("div"); c.id = m[1]; byId.set(m[1], c); this._children.push(c); } },
    appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() {}, insertBefore() {}, replaceChildren() {},
    querySelector(sel) { return queryIn(this, sel); }, querySelectorAll() { return []; }, contains() { return false; },
    get firstChild() { return this.children[0] ?? null; },
    get childElementCount() { return this.children.length; },
    addEventListener(t, fn) { (this._handlers[t] ??= []).push(fn); },
    removeEventListener() {}, setAttribute(n, v) { this._attrs.set(String(n), String(v)); },
    getAttribute(n) { return this._attrs.has(String(n)) ? this._attrs.get(String(n)) : null; },
    focus() {}, click() {},
  };
  let _t = "";
  Object.defineProperty(node, "textContent", { get() { return _t; }, set(v) { _t = String(v); }, configurable: true });
  return node;
}
function queryIn(root, sel) {
  if (!sel) return null;
  if (sel.startsWith("#")) return byId.get(sel.slice(1)) ?? null;
  if (sel.startsWith(".")) return (root.children ?? []).find((c) => c._classes.has(sel.slice(1))) ?? null;
  return null;
}
for (const m of html.matchAll(/id="([\w-]+)"/g)) { const n = makeEl("div"); n.id = m[1]; byId.set(m[1], n); }
globalThis.document = { getElementById: (id) => byId.get(id) ?? null, createElement: (t) => makeEl(t), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: makeEl("body"), visibilityState: "visible" };
globalThis.window = { addEventListener() {}, location: { reload() {} } };
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const Dec = (await import(new URL("../dist/break_eternity.esm.js", import.meta.url).href)).default;
const { newState } = await import(new URL("../src/state.js", import.meta.url).href);
const { render, initUI } = await import(new URL("../src/ui.js", import.meta.url).href);
const perf = await import(new URL("../src/perf.js", import.meta.url).href);
const D = (x) => new Dec(x);

/** 尽量贴近用户的真实后期局面（值/等级都可从命令行覆盖） */
const engineLv = Number(process.argv[2] ?? 1447);
const quantumN = Number(process.argv[3] ?? 500);
const matterLg = Number(process.argv[4] ?? 3270);
const logN = Number(process.argv[5] ?? 60);
function lateGame() {
  const s = newState();
  s.brokenInfinity = true; s.thresholdFlatBought = true;
  s.zpeEngineUnlocked = true; s.zpeEngineLevel = D(engineLv);
  s.quantum = D(quantumN); s.quantumPairs = D(quantumN * 3); s.bigCrunchCount = D(200);
  s.darkEnergy = D("1e167"); s.spanDeBase = D("1e6");
  s.resources.matter = D(10).pow(matterLg);
  s.resources.particle = D(10).pow(matterLg / 3);
  s.resources.entropy = D(10).pow(matterLg / 6);
  s.zpe = D("1e300"); s.dreamPoints = D(50);
  s.eternityPoints = D("1e10"); s.eternityCount = 20; s.epMultLevel = 15;
  s.infinityPoints = D("1e395");
  s.phaseTransmuterUnlocked = true; s.collapseUnlocked = true;
  s.pageUnlocked = { quantum: true, infinity: true, eternity: true, de: true, void: true, zpe: true };
  s.zpeMilestones = { m1: true, m2: true, m3: true, m4: true, m5: true };
  s.deMilestones = { dm1: true, dm2: true, dm3: true, dm4: true, dm5: true, dm6: true, dm7: true, dm8: true };
  for (const k of Object.keys(s.voidUpgrades)) s.voidUpgrades[k] = true;
  for (const k of Object.keys(s.dreamUpgrades)) s.dreamUpgrades[k] = true;
  s.ipDoubleLevel = D(30);
  s.nekoAffinity = 80;
  for (let i = 0; i < logN; i++) s.log.push({ t: Date.now() - i * 1000, text: `🌌 日志第 ${i} 条` });
  return s;
}

initUI(new Proxy({}, { get: () => () => {} }));
const s = lateGame();
console.log("=".repeat(100));
console.log(`★ render 逐段插桩｜引擎 ${engineLv}｜量子 ${quantumN}｜物质 1e${matterLg}｜日志 ${logN} 条`);
console.log("=".repeat(100));

perf.perfToggle(true);
for (let i = 0; i < 5; i++) render(s);          // 预热（一次性工作跑掉）
perf.perfResetSections();
const N = 40;
const t0 = performance.now();
for (let i = 0; i < N; i++) render(s);
const t1 = performance.now();
const total = (t1 - t0) / N;

console.log(`  render() 总耗时：**${total.toFixed(2)} ms/帧**`);
console.log();
console.log("  段落                       次数/帧     累计/帧(ms)   单次(ms)   最大(ms)   占比");
let sum = 0;
for (const r of perf.perfSections()) {
  const per = r.ms / r.n;
  const perFrame = r.ms / N;
  sum += perFrame;
  console.log(`  ${r.label.padEnd(24)}${String((r.n / N).toFixed(1)).padStart(9)}${perFrame.toFixed(3).padStart(13)}${per.toFixed(3).padStart(12)}${r.max.toFixed(2).padStart(11)}${(perFrame / total * 100).toFixed(1).padStart(9)}%`);
}
console.log();
console.log(`  已插桩合计 ${sum.toFixed(2)}ms / 总 ${total.toFixed(2)}ms｜**未插桩部分 ${(total - sum).toFixed(2)}ms**（资源条/升级列表/里程碑/日志等）`);
console.log();
console.log("=".repeat(100));
console.log("★ 真实 DOM 规模（含动态创建的节点）");
console.log("=".repeat(100));
// 模拟 DOM 的节点总数 = byId 里所有元素 + 它们 _children 递归展开
let nodeCount = 0, maxDepth = 0, idCount = byId.size;
const seen = new Set();
const walk = (n, d) => {
  if (!n || seen.has(n)) return;
  seen.add(n); nodeCount++;
  if (d > maxDepth) maxDepth = d;
  for (const c of n.children ?? []) walk(c, d + 1);
  for (const c of n._children ?? []) walk(c, d + 1);
};
for (const n of byId.values()) walk(n, 0);
console.log(`  元素节点总数（估算）：**${nodeCount}**（含动态）｜id 数：${idCount}｜最大嵌套深度：${maxDepth}`);
console.log(`  ⚠️ 若这个数远大于 index.html 的静态 606 ⇒ 动态建的内容是规模来源`);

