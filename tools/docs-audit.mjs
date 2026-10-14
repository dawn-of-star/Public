#!/usr/bin/env node
/**
 * tools/docs-audit.mjs —— **文档↔代码 一致性审计**（2025，用户要求「整理文档」）
 *
 * ══════════════════════════════════════════════════════════════
 * ── 为什么需要它（用户的顾虑：「这不可能犯错的吧」）──
 *   文档**没有编译器、没有断言**拦着 ⇒ 它必然漂移 ✗
 *   本项目已经出现过：`README-STATUS.md` 说「47 个脚本全绿」、
 *   而实测默认 44 个、`--strict` 还有 **7 个失败**（盲区没写明）。
 *   ⇒ 靠人肉读 17 篇 ≈ 一定会漏 ⇒ **把"能机械验证的部分"自动化** ✓
 *
 * ── 判据（只做**可信的机械检查**，不猜语义）──
 *   ① 文档里引用的**仓库内路径**必须存在（`src/x.js`、`tools/x.mjs`、`docs/x.md`…）
 *   ② 文档里写的**脚本数量 / 全绿结论**必须与 `run-all` 的实际行为一致
 *   ③ 文档里引用的 **config.js 常量名**必须真的存在（`export const/function`）
 *   ④ 文档里引用的 **乘区 id / 升级 id** 必须真的在 config 里
 *
 * ── 明确不做的事（避免假断言）──
 *   · 不判断"某段描述是否仍然正确"（那需要读语义 ⇒ 超出机械检查的能力）
 *   · 不判断历史/归档路径（`docs/archive/*` 是**故意保留**的已删代码快照 ✓）
 *   · 不判断"计划/待办"类文档里的**未来**对象（它们本来就还没实现）
 *
 * ── 局限（诚实写明）──
 *   这是**引用存在性**检查，不是语义检查 —— 一个名字被引用了，描述仍可能是错的。
 *   所以它是**过滤网**，真正的保证仍要靠"改代码时同步改文档"。
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const read = (p) => readFileSync(p, "utf8");
/**
 * ★ **src/ 下出现过的所有标识符**（不只是导出名）——
 *   ⚠️ 我第一版只查"是否 export" ⇒ 把**模块内局部常量**全误报成"不存在" ✗
 *   实测：`KIND_RULES` / `SUB_WRAP` / `ALL_PANELS` / `IP_DOUBLE_SOFT_CAP` /
 *     `CRUNCH_ACCEL` / `SCALE` 六个**代码里都有**，只是没 export。
 *   ⇒ 判据放宽为：**名字在 src/ 任一模块里出现过** ⇒ 视为有效引用 ✓
 *     （仍能抓到"真被删掉的常量"，如 `R_BASE` / `DE_GROWTH` —— 它们在 R-REPLACEMENT.md ✓）
 */
const ALL_SRC_TEXT = (() => {
  let out = "";
  for (const f of readdirSync(join(ROOT, "src"))) {
    if (f.endsWith(".js")) out += read(join(ROOT, "src", f));
  }
  for (const f of readdirSync(join(ROOT, "tools"))) {
    if (f.endsWith(".mjs")) out += read(join(ROOT, "tools", f));
  }
  return out;
})();
const nameInCode = (n) => ALL_SRC_TEXT.includes(n);

/** docs/ 下全部 .md（含子目录，但**排除** archive/ —— 那是已删代码的快照） */
function docFiles(dir = DOCS, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "archive" || e.name === "node_modules") continue;
      docFiles(p, out);
    } else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const problems = [];
const notes = [];
const add = (doc, kind, detail) => problems.push({ doc: basename(doc), kind, detail });

/**
 * ★★★ **"已作废 / 已归档"的文档只做「状态头」检查** ——
 *   它们**故意引用已删除的路径与常量**（那正是"已作废"的含义）⇒
 *   对这些文档查"引用存在性"必然全红、纯属假阳性 ✗
 *   （我第一版把 `DEPRECATED-INVENTORY.md` / `WIRING-*.md` /
 *     `COINAGE-TIER-ROLES.md` 全报成"引用路径不存在"，那没有意义）
 */
const ARCHIVED_RE = /已作废|已归档|作废|废弃|仅设计|未动代码|历史价值|记录过|仅清单|已退休|归档/;
const isArchived = (src) => ARCHIVED_RE.test(src.split(/\r?\n/).slice(0, 24).join("\n"));

// ══════════════════════════════════════════════════════════════
// ① 引用的仓库内路径必须存在
// ══════════════════════════════════════════════════════════════
/**
 * ⚠️ 只查**明确的仓库内相对路径**（`src/`、`tools/`、`docs/`、`css/`、`dist/` 开头），
 *   不查 `x.js` 这种裸文件名（那可能只是"某个文件"的口语说法）✓
 * ⚠️ 但要**排除引用外部仓库的路径** —— 文档里会引 AD 的源码做对照
 *   （如 `src/core/secret-formula/...`）⇒ 那是**别人的**仓库，不该查本仓库 ✓
 */
const PATH_RE = /`((?:src|tools|docs|css|dist)\/[\w./-]+)`/g;
const EXTERNAL_RE = /^(?:src|tools)\/core\//;          // AD 的目录结构特征
for (const f of docFiles()) {
  const src = read(f);
  if (isArchived(src)) continue;
  const seen = new Set();
  for (const m of src.matchAll(PATH_RE)) {
    const rel = m[1];
    if (seen.has(rel) || EXTERNAL_RE.test(rel)) continue;
    seen.add(rel);
    if (existsSync(join(ROOT, rel))) continue;
    // 指向 `docs/archive/` 的引用是**故意**的（归档快照）✓
    if (/tools\/[\w-]+(?:\.mjs)?$/.test(rel) && /archive/i.test(src)) continue;
    add(f, "引用路径不存在", `\`${rel}\``);
  }
}

// ══════════════════════════════════════════════════════════════
// ② 脚本数量 / 全绿结论 必须与 run-all 的实际行为一致
// ══════════════════════════════════════════════════════════════
{
  // ★ **不自己数文件**（我数错过：48/41，都错）⇒ 直接问 `run-all --list` ✓
  let defaultRun = -1;
  let total = -1;
  try {
    const out = execFileSync(process.execPath, [join(ROOT, "tools", "run-all.mjs"), "--list"], { encoding: "utf8" });
    defaultRun = out.split(/\r?\n/).filter((l) => /\.(mjs|cjs)$/.test(l.trim())).length;
  } catch (_) { /* 拿不到就跳过这条检查 */ }
  try {
    total = readdirSync(join(ROOT, "tools")).filter((n) => /\.(mjs|cjs)$/.test(n)).length;
  } catch (_) { /* ignore */ }
  notes.push(`脚本口径（**权威来源 = \`run-all --list\`**）：默认批跑 **${defaultRun}** 个｜tools/ 下共 ${total} 个 .mjs/.cjs`);
  notes.push(`\`--strict\` 已知 **7** 个失败（见 docs/TODO.md M 段）—— 文档写"全绿"时必须同时写明这条 ✓`);

  if (defaultRun > 0) {
    // ⚠️ 与"计数与代码不符"同一套判据：**整行含历史/对比词就跳过** ——
    //   否则"本文旧版写着「47 个脚本全绿」"这种**教训句**会被误报 ✗
    //   （两处判据必须一致，我第一版只给了一处加、立刻被绊到）
    const HIST_LINE = /原写|原为|曾|当时|此前|以前|应为|应当|实测是|改成|而实际|旧版|历史|不再|已改|教训/;
    for (const f of docFiles()) {
      const src = read(f);
      if (isArchived(src)) continue;
      for (const line of src.split(/\r?\n/)) {
        if (HIST_LINE.test(line)) continue;
        for (const m of line.matchAll(/(\d+)\s*个\s*脚本/g)) {
          const n = Number(m[1]);
          if (n !== defaultRun && n !== total) {
            add(f, "脚本数量对不上", `写「${n} 个脚本」，实际默认批跑 ${defaultRun} / 总 ${total}`);
          }
        }
      }
      // 「全绿」的说法必须同时写明 `--strict` 的真实状态
      const greenClaim = /(\d+\s*个[^。\n]{0,8}(全绿|全部通过))|((全绿|全部通过)[^。\n]{0,8}脚本)|npm test[^。\n]{0,12}(全绿|全部通过)/;
      if (greenClaim.test(src) && !/--strict/.test(src)) {
        add(f, "只说全绿、没写 --strict", `默认 ${defaultRun} 个全绿成立，但 \`--strict\` 有 7 个失败必须写明`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ③ 引用的标识符必须真的被导出（src/ + tools/ 全扫）
// ══════════════════════════════════════════════════════════════
{
  // 文档里 `NAME`（全大写 + 下划线，≥4 字符）当作常量引用
  const CONST_RE = /`([A-Z][A-Z0-9_]{3,})`/g;
  /** ⚠️ 白名单：**不是**代码标识符（文档术语 / 通用缩写 / 别的生态） */
  const NOT_CODE = new Set([
    "TODO", "README", "WIRING", "API", "URL", "JSON", "HTML", "CSS", "DOM", "SDK",
    "ID", "IDX", "OK", "AMOLED", "AD", "IP", "EP", "ZPE", "DE", "IC", "NEKO", "DM",
    "BONUS", "ZONES", "STATUS", "COINAGE", "RESONANCE", "EXCHANGE", "DEPRECATED",
    "HEAVY", "SKIP", "CHANGELOG", "PROGRESSION", "INFINITY", "QUANTUM", "COLLAPSE",
    "NEKO_DOC", "LICENSE", "GUID", "UUID", "LANG", "ENCODING",
  ]);
  for (const f of docFiles()) {
    const src = read(f);
    if (isArchived(src)) continue;
    const seen = new Set();
    for (const m of src.matchAll(CONST_RE)) {
      const name = m[1];
      if (seen.has(name) || NOT_CODE.has(name)) continue;
      seen.add(name);
      if (nameInCode(name)) continue;                 // ★ 在 src/ 里出现过即可 ✓
      add(f, "引用的标识符不存在", `\`${name}\` 在 src/ 与 tools/ 里都没出现过（可能已被删除）`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ④ 文档必须有一个「状态头」（否则读者无法判断它是否还有效）
// ══════════════════════════════════════════════════════════════
{
  for (const f of docFiles()) {
    const head = read(f).split(/\r?\n/).slice(0, 12).join("\n");
    if (!/状态|status|已作废|权威|有效|已归档/i.test(head)) {
      add(f, "缺状态头", `前 12 行里没说自己是"权威 / 待同步 / 已作废"`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ⑤ 凡是**能从代码问出来**的数字，别的文档不许写错
// ══════════════════════════════════════════════════════════════
/**
 * ★★★ 2025：本检查是"数字集中到 `docs/CONFIG-FACTS.md`"的**兜底**。
 *   实测抓到过：`docs/ZONES.md` 写「`ZONES` **11** 个 / `ZONE_OF` **50** 个 id」，
 *   而实际是 **12 / 56** ✗
 *
 * ⚠️ 判据要**精确**、只认"数字 + 量词 + 明确的被数对象"这种写法 ——
 *   松判据会把叙事里的数字（"3 次大坍缩内"）也误报 ✗
 */
{
  const c = await import(new URL("../src/config.js", import.meta.url).href);
  const FACTS = [
    { re: /(\d+)\s*个\s*乘区/g, want: Object.keys(c.ZONES).length, name: "乘区（ZONES）" },
    { re: /`ZONES`\s*(\d+)\s*个/g, want: Object.keys(c.ZONES).length, name: "乘区（ZONES）" },
    { re: /`ZONE_OF`\s*(\d+)\s*个/g, want: Object.keys(c.ZONE_OF).length, name: "乘区登记（ZONE_OF）" },
    { re: /坍缩里程碑\D{0,12}(\d+)\s*[条个]/g, want: c.COLLAPSE_MILESTONES.length, name: "坍缩里程碑" },
    { re: /量子里程碑\D{0,12}(\d+)\s*[条个]/g, want: c.QUANTUM_MILESTONES.length, name: "量子里程碑" },
    { re: /档位里程碑\D{0,12}(\d+)\s*[条个]/g, want: c.TIER_MILESTONES.length, name: "档位里程碑" },
    { re: /虚空升级\D{0,12}(\d+)\s*[条个]/g, want: Object.keys(c.VOID_UPGRADES).length, name: "虚空升级" },
    { re: /暗能量升级\D{0,12}(\d+)\s*[条个]/g, want: Object.keys(c.DE_UPGRADES).length, name: "暗能量升级" },
    { re: /暗能量里程碑\D{0,12}(\d+)\s*[条个]/g, want: c.DE_MILESTONES.length, name: "暗能量里程碑" },
    { re: /永恒里程碑\D{0,12}(\d+)\s*[条个]/g, want: c.ETERNITY_MILESTONES.length, name: "永恒里程碑" },
    { re: /梦想(?:点)?升级\D{0,12}(\d+)\s*[条个]/g, want: c.DREAM_UPGRADES.length, name: "梦想升级" },
    { re: /IC\D{0,10}(\d+)\s*关/g, want: c.INFINITY_CHALLENGES.max, name: "无限挑战关数" },
  ];
  for (const f of docFiles()) {
    const src = read(f);
    if (isArchived(src)) continue;                 // 归档文档写的是"当时"的数字 ✓
    // ⚠️⚠️ **按行判**：整行含"历史/对比"词就跳过该行 ——
    //   我第一版只看数字前 24 字符，结果被 `ZONES.md` 那句
    //   「本文**原写**「`ZONES` 11 个 …」**实测是** 12」绊到：
    //   标签名（`ZONES`）把"原写"与数字隔开了 ⇒ 前缀里没有"原写" ⇒ 误报 ✗
    //   按行判更省事，且这些词**不会**出现在真正的断言句里 ✓
    const HIST_LINE = /原写|原为|曾|当时|此前|以前|应为|应当|实测是|改成|而实际|旧版|历史|不再|已改/;
    const lines = src.split(/\r?\n/);
    for (const { re, want, name } of FACTS) {
      for (const line of lines) {
        if (HIST_LINE.test(line)) continue;
        for (const m of line.matchAll(re)) {
          const n = Number(m[1]);
          if (n === want) continue;
          add(f, "计数与代码不符", `${name}：文档写 **${n}**，实测 **${want}**（"${m[0].trim()}"）`);
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 输出
// ══════════════════════════════════════════════════════════════
console.log("=".repeat(96));
console.log("文档↔代码 一致性审计（引用存在性 + 状态头 + 数量口径）");
console.log("=".repeat(96));
for (const n of notes) console.log(`  · ${n}`);
console.log(`  · 文档 ${docFiles().length} 篇（不含 docs/archive/ —— 那是已删代码的快照 ✓）`);
console.log();

if (!problems.length) {
  console.log("  ✅ 没有发现问题");
} else {
  const byDoc = new Map();
  for (const p of problems) {
    if (!byDoc.has(p.doc)) byDoc.set(p.doc, []);
    byDoc.get(p.doc).push(p);
  }
  for (const [doc, list] of [...byDoc.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ❌ ${doc}  （${list.length} 处）`);
    for (const p of list.slice(0, 8)) console.log(`       [${p.kind}] ${p.detail}`);
    if (list.length > 8) console.log(`       …还有 ${list.length - 8} 处`);
  }
}
console.log();
console.log("=".repeat(96));
console.log(`  结果：${problems.length === 0 ? "✅ 文档与代码一致" : `❌ ${problems.length} 处待修（涉及 ${new Set(problems.map((p) => p.doc)).size} 篇文档）`}`);
console.log("  ⚠️ 这是**引用存在性**检查，不是语义检查 —— 名字对得上、描述仍可能是错的。");
console.log("     所以它是**过滤网**：改代码时仍必须同步改文档。");
console.log("=".repeat(96));
process.exit(problems.length ? 1 : 0);
