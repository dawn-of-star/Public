#!/usr/bin/env node
/** tools/quantum-growth-tune.mjs —— 扫描 zpeCostGrowth，看量子数与节奏 */
import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, VOID_UPGRADES, DE_UPGRADES, QUANTUM } from "../src/config.js";
import { newState } from "../src/state.js";
import { buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick } from "../src/engine.js";
import { globalMultiplier, matterRate } from "../src/formulas.js";

const D = (v) => new Decimal(v);
const pad = (s, n) => String(s).padEnd(n);

/** 跑一轮，记录到达 1e27 时的增长率、以及整轮耗时 */
function run(growth) {
  QUANTUM.zpeCostGrowth = growth;
  const s = newState();
  let rateAt27 = null, qAt27 = null, crunchAt = null, maxQ = 0;
  for (let i = 0; i < 30000; i++) {
    if (s.resources.traps.lt(3) || s.resources.entropy.lt(1)) for (let c = 0; c < 10; c++) doClick(s);
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(s, id, true);
    buyTrap(s, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(s, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(s, id);

    const M = s.resources.matter;
    const mL = M.gt(0) ? M.log10().toNumber() : 0;
    if (rateAt27 === null && mL >= 27) {
      rateAt27 = matterRate(s).div(M).div(Math.LN10).toNumber();
      qAt27 = s.quantum.toNumber();
    }
    if (s.quantum.toNumber() > maxQ) maxQ = s.quantum.toNumber();

    const b0 = s.bigCrunchCount.toNumber();
    tick(s, 1);
    if (s.bigCrunchCount.toNumber() > b0) { crunchAt = i; break; }
  }
  return { rateAt27, qAt27, crunchAt, maxQ };
}

console.log("=".repeat(90));
console.log("扫描 zpeCostGrowth —— 「攒得越快，爆得越快」是否成立");
console.log("=".repeat(90));
console.log();
console.log(`  ${pad("增长倍率", 14)} ${pad("到达1e27时量子", 16)} ${pad("该点增长率(阶/秒)", 20)} ${pad("整轮耗时", 14)} 评价`);
console.log("  " + "-".repeat(84));

const LIST = [10, 100, 1000, 1e4, 1e6, 1e10];
const out = [];
for (const g of LIST) {
  const r = run(g);
  const rl = r.rateAt27;
  const verdict = rl === null ? "未到 1e27"
    : rl > 1e6 ? "❌ 瞬爆"
      : rl > 1e2 ? "⚠️ 仍然很快"
        : rl > 1 ? "✅ 可控"
          : "✅ 慢而稳";
  out.push({ g, ...r, verdict });
  console.log(
    `  ${pad(g.toExponential(0), 14)} ${pad(r.qAt27 ?? "—", 16)} ` +
    `${pad(rl === null ? "—" : rl.toExponential(3), 20)} ` +
    `${pad(r.crunchAt === null ? "未坍缩" : r.crunchAt + "s", 14)} ${verdict}`,
  );
}
QUANTUM.zpeCostGrowth = 10;

console.log();
console.log("  说明：");
console.log(`    · 「到达 1e27 时的量子」= 第一次临界坍缩触发前玩家已攒到的量子数`);
console.log(`    · 「该点增长率」= d(log10 M)/dt，1 表示每秒涨 1 个数量级`);
console.log(`    · 增长率 > 1e6 就意味着 1e27 -> 1e308 在毫秒内完成（「3 秒无限」）`);
console.log();
