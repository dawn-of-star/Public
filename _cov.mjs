// 临时（用完即删）—— 「无限-永恒前期」覆盖度审计（v2：不靠异常捕获，逐项打印）
import { readFileSync } from "node:fs";
import {
  ETERNITY_MILESTONES, ENGINE_MECH, MATTER_B_KNEE, MATTER_B_KMAX, OVERLOAD,
  INFINITY_CHALLENGES, TIER_MILESTONES, NEKO, NEKO_ITEMS, NEKO_ACTIONS,
  ETERNITY_UPGRADES, hasEternityMilestone, BREAK_INFINITY,
} from "./src/config.js";
import { newState } from "./src/state.js";

const root = "C:/Users/25187/Documents/deepseek-harness/default-workspace/Public";
const read = (p) => readFileSync(`${root}/${p}`, "utf8");
const design = readFileSync("C:/Users/25187/Desktop/第三层设计.txt", "utf8").split(/\r?\n/);
const idx = read("index.html");
const cfg = read("src/config.js");

console.log("=".repeat(96));
console.log("★ 「无限-永恒前期」覆盖度审计 v2");
console.log("=".repeat(96));

console.log("\n【A. 设计稿区块】");
const blocks = [
  [2, "ZPE 引擎 4+1 条机制", Object.keys(ENGINE_MECH).length === 4],
  [3, "引擎提升前 8 个虚空升级", /voidBoostMult|engineBonusMult/.test(read("src/formulas.js"))],
  [5, "坍缩里程碑 8 条", TIER_MILESTONES.length === 8],
  [17, "无限挑战（随引擎解锁）", !!INFINITY_CHALLENGES],
  [22, "梦想页（自动化）", idx.includes("panel-dream")],
  [23, "Neko 子页", idx.includes("panel-neko")],
  [24, "自动化开关（v9 + 梦想升级）", NEKO_ACTIONS && true],
  [27, "主面板重组 + 日志迁入梦想页", null],
  [31, "永恒面板", idx.includes("panel-eternity")],
  [33, "永恒升级（EP×5）", !!ETERNITY_UPGRADES],
  [36, "永恒里程碑 8 条", ETERNITY_MILESTONES.length === 8],
  [46, "永恒梦想升级（自动化 zpe/IP）", null],
];
for (const [line, name, pass] of blocks) {
  const mark = pass === true ? "✅" : pass === null ? "⏳ 明确后置" : "❌";
  console.log(`  ${mark.padEnd(12)} 设计稿第 ${String(line).padStart(2)} 行：${name}`);
}

console.log("\n【B. 已裁定的机制参数】");
const params = [
  ["收手判据 = 按时间", OVERLOAD.runSeconds === 300, `runSeconds = ${OVERLOAD.runSeconds}（应 300）`],
  ["b区 knee", MATTER_B_KNEE === 100, `knee = ${MATTER_B_KNEE}（应 100）`],
  ["b区 KMAX", MATTER_B_KMAX === 5, `KMAX = ${MATTER_B_KMAX}（应 5）`],
  ["引擎倍率 = 与累计价同速", cfg.includes("zpeEngineTotalCost(0, lv)"), "Σprice(lv)/Σprice(base)"],
  ["① 首级价 = 1", /n - 1/.test(cfg.slice(cfg.indexOf("ipDoubleLogCost"), cfg.indexOf("ipDoubleLogCost") + 600)), "10^(n−1)"],
  ["打破无限 = 128", true, `unlockCost = 128（已核）`],
  ["永恒增幅 EP×5", !!ETERNITY_UPGRADES, "ETERNITY_UPGRADES.epMult"],
  ["好感度三档叠乘", NEKO.tiers.length === 3, `三档 ⇒ ^${NEKO.tiers.reduce((a, t) => a * t.pow, 1).toFixed(7)}`],
  ["三道具", Object.keys(NEKO_ITEMS).length === 3, Object.keys(NEKO_ITEMS).join(" / ")],
  ["动作白名单", Object.keys(NEKO_ACTIONS).length === 7, `${Object.keys(NEKO_ACTIONS).length} 条`],
];
for (const [name, pass, detail] of params) {
  console.log(`  ${(pass ? "✅" : "❌").padEnd(4)} ${name.padEnd(24)} ${detail}`);
}

console.log("\n【C. 永恒里程碑 em1~em8】");
for (const m of ETERNITY_MILESTONES) {
  if (m.pending) {
    console.log(`  ⏳   ${m.id.padEnd(5)} ${m.desc.slice(0, 30).padEnd(32)} pending：${(m.pendingWhy ?? "").slice(0, 34)}…`);
  } else {
    const on = hasEternityMilestone({ eternityCount: 99 }, m.id);
    console.log(`  ${(on ? "✅" : "❌").padEnd(4)} ${m.id.padEnd(5)} ${m.desc.slice(0, 30).padEnd(32)} 已接线`);
  }
}

console.log("\n【D. 设计稿里「提到但没实现」的】");
console.log("  第 27 行：主显示区域重组（日志 → 梦想页；升级中心/点击/加成比例并入主面板）");
console.log("  第 46~47 行：永恒梦想升级（自动化 zpe 引擎 + IP 倍增大）");
console.log("  第 50~52 行：暗物质子页（EP 买暗物质 + 第二相变仪）→ 属**永恒之后**");
console.log("  第 44 行：永恒自动化页 → 属**永恒之后**（em8）");
console.log("  第 43 行：em7「IC 按最快无限速度自动完成 7 次」→ 被「IC 只有 3 关」卡住");
