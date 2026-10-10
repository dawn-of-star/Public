#!/usr/bin/env node
/**
 * tools/run-all.mjs —— 一次跑完所有自检（`npm test`）
 *
 * 为什么需要它：自检脚本已经有 40+ 个，名字记不住，改完东西不知道该跑哪个
 * —— 结果就是「不敢改」。这里全跑一遍，只把**失败**的细节打出来。
 *
 * 自动发现 `tools/*.mjs|cjs`，跳过需要 GUI / 打包产物的（见 SKIP）。
 *
 * ⚠️ 用**临时文件**接子进程输出，不用管道：
 *    某些受限环境里 Node 的 `stdio: "pipe"` 会因为拿不到命名管道而 EPERM。
 *    临时文件走的是普通文件 IO，到哪都能跑。
 *
 * ══════════════════════════════════════════════════════════
 * ★★★ 2025 提速（用户裁定：「跑全套太耗时间了，建议再提速几个数量级」）
 * ══════════════════════════════════════════════════════════
 *   原来：`for` + `spawnSync` **纯串行** ⇒ 实测 **705s**（12 核机器上浪费 12 倍）
 *   现在：**并发池**，并发度默认 = `min(核数 - 1, 8)`（可用 `-j N` 覆盖）
 *     ⚠️ 并发度**不取满核数**：这些 lab 会吃满一个核，留 1~2 个核给系统更稳。
 *     ⚠️ 输出**按文件名排序后统一打印**（不是完成即打）⇒ 报告顺序与串行一致，
 *        不要为了"实时感"牺牲可比性。
 *   另外：`--check` 之前**根本没有被批跑调用**（盲区，见 docs/TODO.md J5）——
 *        现在默认把 `--check` 也跑一遍（见 CHECK_PASS），失败同样计入 ✗
 *        想跳过用 `--no-check`（快速冒烟用）。
 *
 * 用法：
 *   node tools/run-all.mjs                 # 全部（含 --check 第二轮）
 *   node tools/run-all.mjs -j 4            # 并发 4
 *   node tools/run-all.mjs --no-check      # 只跑主轮（快）
 *   node tools/run-all.mjs dom-smoke       # 只跑名字含 dom-smoke 的
 *   node tools/run-all.mjs --list          # 只列出会被跑的脚本
 */
import {
  readdirSync, mkdtempSync, readFileSync, rmSync, openSync, closeSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, availableParallelism } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 需要 GUI（electron）或打包产物的脚本，不进自动批跑 */
const SKIP = new Set(["run-all.mjs", "smoke-electron.cjs", "inspect-asar.cjs"]);

/**
 * ★★★ 2025 提速：**重诊断脚本**（默认不跑，需要时显式点名）。
 *
 *   用户裁定：「跑全套确认太耗时间了，建议再提速几个数量级」。
 *   实测（并发 8，47 脚本）总墙钟 **355s**，其中前 4 个就占 **300s**：
 *     engine-mech-lab   354s（串行值）｜baseline-034  107s｜tier4-timing  88s｜zpe-ceiling  54s
 *
 *   ⚠️ 这些**不能靠"放大模拟步长"提速** —— 已实测：`engine-mech-lab` 步长 2s ⇒ 引擎 1447 级，
 *      步长 20s ⇒ **173672 级**（差 120 倍 ✗）。因为收手是**按时间**判的，
 *      步长大会漏掉收手时机 ⇒ 数字全废。
 *   ⇒ 它们的定位是"**标定 / 重诊断**"（要跑几分钟、看长时标轨迹），
 *     不是"改一行就要跑一遍的回归测试" ⇒ 放进本名单**默认跳过** ✓
 *
 *   手动跑：`node tools/run-all.mjs engine-mech-lab`（过滤器会命中它 ✓）
 *   想连它们一起跑：`node tools/run-all.mjs --all`
 */
const HEAVY = new Set([
  "engine-mech-lab.mjs",   // 168h 长时标标定（~354s）
  "baseline-034.mjs",      // 版本基线快照（~107s）
  "tier4-timing.mjs",      // 第四层节奏（~88s）
  "zpe-ceiling-lab.mjs",   // ZPE 天花板（~54s）
]);

// ── 参数 ──
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optVal = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : d;
};
/**
 * ★★★ 2025：`--check` 第二轮 —— **默认不跑**，用 `--strict` 开启。
 *
 *   为什么先不设默认（诚实说明）：
 *     我把 `--check` 接进批跑后，**当场暴露出 10 个失败**（见 `docs/TODO.md` M 段）——
 *     也就是说过去那些「47 脚本全绿」的报告**从来没有验证过断言**（盲区 ✗）。
 *     但那 10 个是**过期断言 + 2 个坏工具 + 数值漂移**，不是坏实现。
 *   ⇒ 在逐个清掉之前，把它设成默认会让每次改一行都看到 10 条红 ⇒ 反而没人看报告 ✗
 *   ⇒ 折中：**默认绿、`--strict` 红**。逐条修完后再改回默认（TODO M 段的验收条件）。
 *
 *   用法：`node tools/run-all.mjs --strict`（配合过滤器可只跑几个：`--strict dom-smoke`）
 */
const noCheck = flag("--no-check");
const strict = flag("--strict");
const listOnly = flag("--list");
const all = flag("--all");            // ★ 连 HEAVY（重诊断）一起跑
const only = argv.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a));

const cores = (() => { try { return availableParallelism(); } catch { return 4; } })();
const CONC = Math.max(1, Math.min(optVal("-j", Math.min(cores - 1, 8)) || 1, 32));

const files = readdirSync(HERE)
  .filter((f) => /\.(mjs|cjs)$/.test(f) && !SKIP.has(f))
  // 重诊断默认跳过；`--all` 或**显式点名**时照跑（点名优先，否则没法单独调它 ✓）
  .filter((f) => all || only.length || !HEAVY.has(f))
  .filter((f) => (only.length ? only.some((o) => f.includes(o)) : true))
  .sort();

if (!files.length) { console.error("没有匹配的脚本"); process.exit(1); }
if (listOnly) { for (const f of files) console.log(f); process.exit(0); }

const logs = mkdtempSync(join(tmpdir(), "dsh-selftest-"));
console.log("=".repeat(78));
console.log(`自检批跑：${files.length} 个脚本${only.length ? `（过滤：${only.join(",")}）` : ""}`
  + `｜并发 ${CONC}/${cores} 核${noCheck ? "｜跳过 --check" : ""}`);
console.log("=".repeat(78));

/** 跑一个脚本一次，返回 { file, args, ok, status, out } —— 输出走临时文件（不用管道，见头注） */
function runOne(file, extraArgs = []) {
  return new Promise((resolve) => {
    const tag = extraArgs.length ? `${file}${extraArgs.join("")}` : file;
    const log = join(logs, `${tag.replace(/[^\w.-]/g, "_")}.log`);
    const fd = openSync(log, "w");
    const c = spawn(process.execPath, [join(HERE, file), ...extraArgs], {
      stdio: ["ignore", fd, fd],
      cwd: join(HERE, ".."),
    });
    const done = (status) => {
      try { closeSync(fd); } catch { /* 已关 */ }
      let out = "";
      try { out = readFileSync(log, "utf8"); } catch { out = ""; }
      resolve({ file, args: extraArgs, ok: status === 0, status, out });
    };
    c.on("exit", (code) => done(code ?? -1));
    c.on("error", () => done(-1));
  });
}

const t0 = Date.now();

/** 并发池：按 `files` 顺序取任务，结果收集后**统一排序**（报告顺序与串行一致 ✓） */
async function pool(items, conc, fn) {
  const out = [];
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      out.push(await fn(items[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  out.sort((a, b) => a.file.localeCompare(b.file));
  return out;
}

// ── 第一轮：主跑 ──
const main = await pool(files, CONC, (f) => runOne(f));
for (const r of main) {
  const last = r.out.trim().split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
  console.log(`  ${r.ok ? "✅" : "❌"} ${r.file.padEnd(26)} ${r.ok ? last.slice(0, 46) : `exit=${r.status}`}`);
}

// ── 第二轮：`--check`（**只在 `--strict` 时跑**；见上文说明）──
//   此前从未被批跑调用 ⇒ "全绿"掩盖了断言坏掉（见 docs/TODO.md J5 / M）✗
//   只对**主轮通过**的脚本跑（主轮就挂了 ⇒ 再跑 check 无意义）
const checks = (noCheck || !strict) ? [] : await pool(
  main.filter((r) => r.ok).map((r) => r.file),
  CONC,
  (f) => runOne(f, ["--check"]),
);
if (checks.length) {
  console.log();
  console.log(`  ── --check 第二轮（${checks.length} 个）──`);
  for (const r of checks) {
    const last = r.out.trim().split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.file.padEnd(26)} ${r.ok ? last.slice(0, 46) : `exit=${r.status}`}`);
  }
}

const failed = [...main, ...checks].filter((r) => !r.ok);
console.log();
for (const { file, args, out, status } of failed) {
  console.log("─".repeat(78));
  console.log(`❌ ${file}${args.length ? " " + args.join(" ") : ""}（exit ${status}）最后 20 行：`);
  console.log("─".repeat(78));
  console.log(out.trim().split("\n").slice(-20).join("\n"));
  console.log();
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log("=".repeat(78));
if (failed.length) {
  console.log(`  ❌ ${failed.length} 个失败：${failed.map((x) => x.file).join(", ")}`
    + `（${files.length} 个脚本，${secs}s，并发 ${CONC}）`);
} else {
  console.log(`  ✅ 全部通过（${files.length} 个脚本${checks.length ? ` + ${checks.length} 个 --check` : ""}，${secs}s，并发 ${CONC}）`);
}
console.log("=".repeat(78));
rmSync(logs, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
