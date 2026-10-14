/**
 * src/perf.js —— **性能监视器**（用户报「数字跳动速率及其低下」时的诊断工具）
 *
 * ── 为什么需要它 ──
 *   我在 Node 里用假 DOM 量到：`tick()` ≤ 0.57ms、`render()` ≈ 1.5ms
 *   ⇒ **都远低于 20fps 的 50ms 预算**。但 mock **测不到**真实浏览器的
 *   样式重算 / 布局 / 绘制成本 —— 而那正是"数字跳动很慢"最可能的原因 ✗
 *   ⇒ 与其继续猜，不如把**真实数据**暴露出来 ✓
 *
 * ── 它量什么（以及**为什么不**量"DOM 写入次数"）──
 *   · 量：真实帧间隔（⇒ FPS）、`tick()` 耗时、`render()` 耗时
 *   · 不量：DOM 写入次数 —— 那需要在 ui.js 的每个 setter 里插桩（300+ 处）✗
 *     **代价大于收益**，而且 `renderMs` **已经隐含**了样式重算的成本
 *     （`render()` 返回后浏览器才真正重算样式，所以 renderMs 反映的是 JS 侧；
 *       而"帧间隔远大于 tick+render"就说明**瓶颈在浏览器侧**——这正是它要区分的）
 *
 * ⚠️ 默认**关闭**（关闭时 `perfFrame` 立刻返回 ⇒ 开销≈0）✓
 *   打开方式：按 `F8`，或控制台 `__game.perf(true)`
 */

const N = 120;
const frames = [];
let on = false;

/** 记录一帧（关闭时是 no-op） */
export function perfFrame(rec) {
  if (!on) return;
  frames.push(rec);
  if (frames.length > N) frames.shift();
}

/** 读取开关（关闭时立刻返回，避免任何额外开销） */
export function perfOn() { return on; }

/** 开关（返回新状态） */
export function perfToggle(force) {
  on = force === undefined ? !on : !!force;
  if (!on) { frames.length = 0; sections.clear(); }
  else sections.clear();          // 打开时从干净状态开始统计 ✓
  return on;
}

export function perfFrames() { return frames; }

// ══════════════════════════════════════════════════════════
// ★★★ 2025：**分段计时**（找"render 里哪一段慢"）
// ══════════════════════════════════════════════════════════
// 背景：用户的 HUD 显示 `render 170.5ms`（我 mock 里只有 1.5ms ⇒ 慢 100×）
//   ⇒ 光知道"render 慢"没用，要知道**哪一段**慢 ✗
// ⚠️ 关闭时 `perfSection` 立即返回 ⇒ 零开销（不在热路径上加计时器）✓
const sections = new Map();

/** 包住一段代码计时（关闭时直接执行，不碰 `performance.now()`） */
export function perfSection(label, fn) {
  if (!on) return fn();
  const t0 = performance.now();
  try { return fn(); } finally {
    const dt = performance.now() - t0;
    const o = sections.get(label) ?? { n: 0, ms: 0, max: 0 };
    o.n++; o.ms += dt;
    if (dt > o.max) o.max = dt;
    sections.set(label, o);
  }
}

/** 取分段结果（按累计耗时降序） */
export function perfSections(reset = false) {
  const rows = [...sections.entries()]
    .map(([label, o]) => ({ label, n: o.n, ms: o.ms, max: o.max }))
    .sort((a, b) => b.ms - a.ms);
  if (reset) sections.clear();
  return rows;
}

/** 清空（打开监视器时调一次，让统计从干净状态开始） */
export function perfResetSections() { sections.clear(); }

/** 汇总：平均 / 最大 / p95 */
export function perfSummary() {
  if (!frames.length) return null;
  const stat = (arr) => {
    const a = arr.filter((v) => Number.isFinite(v));
    if (!a.length) return { avg: 0, max: 0, p95: 0 };
    const s = [...a].sort((x, y) => x - y);
    return {
      avg: a.reduce((x, y) => x + y, 0) / a.length,
      max: s[s.length - 1],
      p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    };
  };
  // ⚠️ 只统计"渲染过的那一帧"的 tick/render（未渲染的帧它们为 0 ⇒ 会把均值拉低 ✗）
  const drawn = frames.filter((f) => f.renderMs > 0);
  const fm = stat(frames.map((f) => f.frameMs));
  const tk = stat(frames.map((f) => f.tickMs));
  const rd = stat((drawn.length ? drawn : frames).map((f) => f.renderMs));
  const gap = fm.avg;                                  // 真实帧间隔
  const busy = tk.avg + rd.avg;                        // 我们自己的占用（按帧均值）
  return {
    n: frames.length,
    fps: gap > 0 ? 1000 / gap : 0,
    frameAvg: fm.avg, frameP95: fm.p95, frameMax: fm.max,
    tickAvg: tk.avg, tickMax: tk.max,
    renderAvg: rd.avg, renderP95: rd.p95, renderMax: rd.max,
    busyAvg: busy,
    /**
     * ★ **瓶颈归属**：帧间隔远大于 (tick + render) ⇒ 时间花在**浏览器侧**
     *   （样式重算 / 布局 / 绘制），而不是我们的 JS ✓
     */
    browserSide: gap > busy * 2 && gap > 24,
  };
}
