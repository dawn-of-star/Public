#!/usr/bin/env node
/**
 * tools/run-all.mjs —— 一次跑完所有自检（`npm test`）
 *
 * 为什么需要它：自检脚本已经有 22 个，名字记不住，改完东西不知道该跑哪个
 * —— 结果就是「不敢改」。这里全跑一遍，只把**失败**的细节打出来。
 *
 * 自动发现 `tools/*.mjs|cjs`，跳过需要 GUI / 打包产物的（见 SKIP）。
 *
 * ⚠️ 用**临时文件**接子进程输出，不用管道：
 *    某些受限环境里 Node 的 `stdio: "pipe"` 会因为拿不到命名管道而 EPERM。
 *    临时文件走的是普通文件 IO，到哪都能跑。
 */
import { readdirSync, mkdtempSync, readFileSync, rmSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 需要 GUI（electron）或打包产物的脚本，不进自动批跑 */
const SKIP = new Set(["run-all.mjs", "smoke-electron.cjs", "inspect-asar.cjs"]);

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = readdirSync(HERE)
  .filter((f) => /\.(mjs|cjs)$/.test(f) && !SKIP.has(f))
  .filter((f) => (only.length ? only.some((o) => f.includes(o)) : true))
  .sort();

if (!files.length) { console.error("没有匹配的脚本"); process.exit(1); }

const logs = mkdtempSync(join(tmpdir(), "dsh-selftest-"));
console.log("=".repeat(78));
console.log(`自检批跑：${files.length} 个脚本${only.length ? `（过滤：${only.join(",")}）` : ""}`);
console.log("=".repeat(78));

const failed = [];
const t0 = Date.now();
for (const f of files) {
  const log = join(logs, `${f}.log`);
  const fd = openSync(log, "w");
  const r = spawnSync(process.execPath, [join(HERE, f)], {
    stdio: ["ignore", fd, fd],
    cwd: join(HERE, ".."),
  });
  closeSync(fd);
  const out = readFileSync(log, "utf8");
  const ok = r.status === 0;
  const last = out.trim().split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
  console.log(`  ${ok ? "✅" : "❌"} ${f.padEnd(26)} ${ok ? last.slice(0, 46) : `exit=${r.status}`}`);
  if (!ok) failed.push({ f, out, status: r.status });
}

console.log();
if (failed.length) {
  for (const { f, out, status } of failed) {
    console.log("─".repeat(78));
    console.log(`❌ ${f}（exit ${status}）最后 20 行：`);
    console.log("─".repeat(78));
    console.log(out.trim().split("\n").slice(-20).join("\n"));
    console.log();
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log("=".repeat(78));
console.log(`  ${failed.length ? `❌ ${failed.length} 个失败：${failed.map((x) => x.f).join(", ")}` : "✅ 全部通过"}（${files.length} 个脚本，${secs}s）`);
console.log("=".repeat(78));
rmSync(logs, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
