/**
 * tools/browser-probe.js —— ★★★ 2025：**在用户的浏览器里**逐个测函数耗时
 *
 * ── 为什么需要它 ──
 *   用户实测 `render() = 145ms`，而我用同一份代码在 Node 里量到 **3.7ms**（40× 差距）。
 *   我已经排除了：DOM 写入次数（每帧仅 10 次）、CSS（无大范围重绘）、
 *   强制同步布局（真 Edge 实测仅 0.8ms）、页面规模（450 节点）。
 *   ⇒ 剩下唯一可能：**某个具体函数在他的环境里慢**。那只能在他的环境里测。
 *
 * ── 怎么用（给用户的两步）──
 *   1. 打开游戏页面
 *   2. F12 → Console → 粘贴本文件的**全部内容** → 回车
 *   它会把结果打印到控制台（`console.table`），用户截图给我即可 ✓
 *
 * ⚠️ 它**只读**：不写存档、不改状态、只调用纯计算函数与 render ✓
 */
(async () => {
  // 从游戏自己的模块里取真函数（页面已经把 main.js 作为 module 加载 ⇒ 能动态 import 同一份）
  const base = new URL("./src/", location.href).href;
  const cfg = await import(base + "config.js");
  const fml = await import(base + "formulas.js");
  const fmtMod = await import(base + "format.js");
  const uiMod = await import(base + "ui.js");
  const stMod = await import(base + "state.js");
  // ⚠️ `dist/` 与 `src/` 是**兄弟目录** ⇒ 从 `src/` 走 `../dist/` 才对
  //   （我第一版在这里传了个 URL 对象当 base，路径算错了 ✗）
  const Dec = (await import(new URL("../dist/break_eternity.esm.js", base).href)).default;

  const g = globalThis.__game;
  const state = g?.state ?? stMod.newState();
  const D = (x) => new Dec(x);

  /** 单次调用计时（跑 n 次取平均） */
  const bench = (label, fn, n = 200) => {
    for (let i = 0; i < Math.min(n, 20); i++) fn();          // 预热
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    const ms = (performance.now() - t0) / n;
    return { 函数: label, "ms/次": Number(ms.toFixed(4)), "次数": n };
  };

  const rows = [];
  // ── 格式化 ──
  rows.push(bench("fmt(物质)", () => fmtMod.fmt(state.resources.matter)));
  rows.push(bench("fmt(暗能量)", () => fmtMod.fmt(state.darkEnergy)));
  rows.push(bench("sci(1e308)", () => fmtMod.sci(D("1e308"))));
  rows.push(bench("fmtMult(全局加成)", () => fmtMod.fmtMult(fml.globalMultiplier(state))));
  rows.push(bench("fmtTime(1000s)", () => fmtMod.fmtTime(1000)));
  // ── 速率类（每帧多次调用）──
  rows.push(bench("entropyRate", () => fml.entropyRate(state)));
  rows.push(bench("particleRate", () => fml.particleRate(state)));
  rows.push(bench("matterRate", () => fml.matterRate(state)));
  rows.push(bench("zpeRate", () => fml.zpeRate(state)));
  rows.push(bench("darkEnergyRate", () => fml.darkEnergyRate(state)));
  rows.push(bench("globalMultiplier", () => fml.globalMultiplier(state)));
  rows.push(bench("globalMultiplierParts", () => fml.globalMultiplierParts(state)));
  // ── 引擎/跨度（每帧多次）──
  rows.push(bench("engineBonusMult", () => cfg.engineBonusMult(state)));
  rows.push(bench("matterSpanMult", () => cfg.matterSpanMult(state)));
  rows.push(bench("matterSpanStatus", () => cfg.matterSpanStatus(state)));
  rows.push(bench("matterTotalExponent", () => cfg.matterTotalExponent(state)));
  rows.push(bench("zpeEngineCost", () => cfg.zpeEngineCost(state)));
  rows.push(bench("zpeEngineTotalCost(0,等级)", () => cfg.zpeEngineTotalCost(0, cfg.effectiveEngineLevel(state))));
  rows.push(bench("eternityPointGain", () => cfg.eternityPointGain(state.infinityPoints)));
  rows.push(bench("infinityUpgradeCost(ipDouble)", () => cfg.infinityUpgradeCost(state, "ipDouble")));
  rows.push(bench("ipDoubleAffordableIn", () => cfg.ipDoubleAffordableIn(0, state.infinityPoints)));
  rows.push(bench("epMultAffordableIn", () => cfg.epMultAffordableIn(0, state.eternityPoints)));
  // ── 整帧 ──
  rows.push(bench("render（整帧）", () => uiMod.render(state), 30));

  console.log("%c═══ 浏览器端性能探针 ═══", "color:#ff3b30;font-weight:bold");
  console.log("（ms/次 越小越好；render 若远大于各项之和 ⇒ 瓶颈在 render 内部的组合处）");
  console.table(rows);

  // 汇总：各项之和 vs render
  const sum = rows.filter((r) => r.函数 !== "render（整帧）").reduce((a, r) => a + r["ms/次"], 0);
  const rd = rows.find((r) => r.函数 === "render（整帧）")["ms/次"];
  console.log(`各项单次之和 = ${sum.toFixed(3)}ms｜render = ${rd.toFixed(2)}ms`);
  console.log("（render 里每个函数会被调用多次，所以 render 大于各项之和是正常的；" +
    "但如果 render 比「和 ×10」还大得多 ⇒ 有隐藏的重复调用）");

  // 顺带报版本与规模，便于我核对
  console.log("构建：", uiMod.UI_BUILD, "｜DOM 元素数：", document.querySelectorAll("*").length,
    "｜NO_DOM_WRAP =", String(globalThis.__NO_DOM_WRAP),
    "｜DevTools 开着（估算）：", String(performance.now() > 0));
})();
