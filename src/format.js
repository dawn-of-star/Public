/**
 * format.js —— **数字 / 时长的格式化（唯一实现）**
 *
 * 为什么单独成模块（2025）：
 *   `fmt` / `sci` / `fmtMult` / `fmtTime` 原来住在 `ui.js` 里，但 `engine.js` 的**日志**
 *   也要用它们（`pushLog` 里拼 `1e${...}` 的那些）。
 *   而 `ui.js` 已经 `import` 了 `engine.js` ⇒ 若 `engine.js` 反过来 import `ui.js`
 *   就成了**循环依赖**（ESM 下大概率拿到未初始化的绑定 ⇒ ReferenceError）✗
 *   ⇒ 抽到这一层：**两边都 import 它**，谁都不依赖谁 ✓
 *
 * ★★★ 2025（用户裁定）：**统一科学计数法 = `1.00e308`**
 *   ⚠️ 项目里原有一批**手拼的 `1e${log10}`**（如 `1e308.2547`）—— 那个写法**是误导的**：
 *     它的意思是 `10^308.2547` = **1.80e308**，但字面看着像"e 后面跟了个小数" ✗
 *   ⇒ 规范写法 = 尾数 `.toFixed(2)` + `e` + **整数**指数 ✓（`sci()` 就是干这个的）
 *   **用法**：把 `` `1e${x.log10().toFixed(2)}` `` 换成 `sci(x)`（传**值**，不是 log10）
 */
import Decimal from "../dist/break_eternity.esm.js";

/** 大数格式化：1000 以下保留小数，之后走科学计数，layer >= 2 用 e 的 e */
export function fmt(value, places = 2) {
  const d = value instanceof Decimal ? value : new Decimal(value);
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

/**
 * **规范科学计数法** `1.00e308` —— 用户裁定的统一格式。
 * @param {Decimal|number} value 要显示的数（**不是它的 log10**）
 */
export function sci(value) {
  const d = value instanceof Decimal ? value : new Decimal(value ?? 0);
  if (!d.isFinite()) return d.sign > 0 ? "∞" : "-∞";
  if (d.lte(0)) return "0";
  if (d.lt(1e6)) return d.toNumber().toFixed(d.lt(1000) ? 2 : 0);
  const exp = Math.floor(d.log10().toNumber());
  const mant = d.div(Decimal.pow(10, exp)).toNumber();
  return `${mant.toFixed(2)}e${exp}`;
}

/** 倍率格式化（`×1.00e308`）—— 大数也走 `sci` 的规范格式 */
export function fmtMult(value) {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (d.lt(1000)) return `×${d.toNumber().toFixed(2)}`;
  return `×${sci(d)}`;
}

/** 时长格式化 */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
