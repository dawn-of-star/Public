/**
 * _del-unspent-iptime.mjs —— 彻底删除「沉潜蓄能 unspentBoost」与「无限长河 ipTime」
 *   用户 2025 裁定：直接删除，无视任何条件 ✓
 *
 * 这次严格按今天血换的教训做 ✓：
 *   ① 只按**块边界**删（export const/function … 到配对的收尾 ✓ 括号计数 ✓）
 *   ② 对象字面量里的**成员**也按括号配对删 ✓（不按行删 ✗）
 *   ③ import 名单只做**文本剥名** ✓（不整行删 ✗）
 *   ④ 数组字面量（INFINITY_ORDER）按方括号配对改 ✓（那次两次破坏 config 的教训 ✓）
 *   ⑤ 删完由调用方跑 dom-smoke + 全量套件，逐步收尾 ✓
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const NAMES = ["unspentBoost", "ipTime", "ipTimeAccrued", "ipTimeBought", "timeIPPerSecond", "timeIPCapSeconds", "timeInfinityPointGain", "unspentBoostBought", "unspentBoostMult", "TIME_IP"];
const re = new RegExp("\\b(" + NAMES.join("|") + ")[A-Za-z]*\\b");

/** 从 open 位置（指向 { 或 [）找到配对的收尾下标 */
function matchBracket(s, open) {
  const o = s[open], c = o === "{" ? "}" : "]";
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) d++;
    else if (s[i] === c) { d--; if (d === 0) return i; }
  }
  return -1;
}

let touched = 0, blocks = 0, members = 0;
for (const dir of ["src", "tools"]) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) continue;
  for (const f of fs.readdirSync(base)) {
    if (!/\.(js|mjs|cjs)$/.test(f)) continue;
    const p = path.join(base, f);
    let s = fs.readFileSync(p, "utf8");
    if (!re.test(s)) continue;
    const before = s;
    let n = 0, m = 0;

    // ① export const/function 块（含其前面的注释块）
    const headRe = /(^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*\r?\n)?^export (const|function|let) ([A-Za-z0-9_$]+)[^\n]*/gm;
    let mt;
    const spans = [];
    while ((mt = headRe.exec(s))) {
      if (!re.test(mt[3])) continue;
      const openIdx = s.indexOf("{", mt.index);
      const openArr = s.indexOf("[", mt.index);
      const isObj = openIdx >= 0 && (openArr < 0 || openIdx < openArr);
      const open = isObj ? openIdx : openArr;
      if (open < 0) continue;
      const close = matchBracket(s, open);
      if (close < 0) continue;
      spans.push([mt.index, close + 1]);
      n++;
    }
    for (let i = spans.length - 1; i >= 0; i--) s = s.slice(0, spans[i][0]) + s.slice(spans[i][1]);

    // ② 对象字面量里的成员（形如 `unspentBoost: { … },` 或 `ipTime: { … },`）
    for (const name of NAMES) {
      const memRe = new RegExp("^[ \\t]*" + name + "[A-Za-z0-9_$]*\\s*:\\s*([\\{\\[\\[]) *", "m");
      let mm;
      while ((mm = memRe.exec(s))) {
        const open = s.indexOf(mm[1], mm.index);
        const close = matchBracket(s, open);
        if (close < 0) break;
        let end = close + 1;
        while (s[end] === "," || s[end] === " ") end++;
        if (s[end] === "\n") end++;
        s = s.slice(0, mm.index) + s.slice(end);
        m++;
      }
    }

    // ③ INFINITY_ORDER 之类的数组：按方括号配对，移除其中的相关字符串
    const orderRe = /(export const INFINITY_ORDER = )(\[)/g;
    let om;
    while ((om = orderRe.exec(s))) {
      const open = s.indexOf("[", om.index);
      const close = matchBracket(s, open);
      if (close < 0) continue;
      const inner = s.slice(open + 1, close);
      const kept = inner.split(",").filter((x) => !NAMES.some((nm) => x.includes(nm)));
      s = s.slice(0, open + 1) + kept.join(",") + s.slice(close);
      break;
    }

    // ④ import 名单：只剥名字（不整行删）
    for (const nm of NAMES) {
      const esc = nm + "[A-Za-z0-9_$]*";
      s = s.replace(new RegExp(esc + "\\s*,\\s*", "g"), "");
      s = s.replace(new RegExp("\\s*,\\s*" + esc + "\\b", "g"), "");
    }

    // ⑤ tools 里：提到它们的整行可以放心删（都是测试断言 ✓）
    if (dir === "tools") {
      const kept = [];
      for (const l of s.split(/\r?\n/)) {
        if (re.test(l)) { m++; continue; }
        kept.push(l);
      }
      s = kept.join("\n");
    }

    if (s !== before) {
      fs.writeFileSync(p, s);
      touched++; blocks += n; members += m;
      console.log(`  ${dir}/${f}: 块 ${n} 个｜成员/行 ${m} 个`);
    }
  }
}
console.log(`\n合计：${touched} 文件｜块 ${blocks}｜成员/行 ${members}`);
