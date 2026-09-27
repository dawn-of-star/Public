#!/usr/bin/env node
/**
 * tools/tier4-lab.mjs —— 第四层数值实验台
 *
 * 问题：当前架构 8 小时到 e34 就停了（多项式增长），要到 e80 需要 115 天。
 * 假设：把 S 从 0.428 顶到 ~0.90，抬高收入天花板 log I = (log base + C)/(1−S)。
 *
 * 做法：运行时往 config.REPEATABLE 里注入假设的第四层升级（kind = matterMul），
 *       跑模拟看物质能到多少，从而反推需要多大的 S。
 *
 * 用法：node tools/tier4-lab.mjs
 */

import Decimal from "../dist/break_eternity.esm.js";
import { REPEATABLE, ZONE_OF, computeS } from "../src/config.js";
import { newState } from "../src/state.js";
import {
  buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick, tick,
} from "../src/engine.js";
import { DE_UPGRADES, VOID_UPGRADES } from "../src/config.js";

const pad = (s, n) => String(s).padEnd(n);
const log10 = (d) => (d.gt(0) ? d.log10().toNumber() : 0);
const clock = (s) => (s < 3600 ? `${(s / 60).toFixed(0)}m` : `${(s / 3600).toFixed(1)}h`);

// ══════════════════════════════════════════════════════════
// 注入器
// ══════════════════════════════════════════════════════════

const BASE_IDS = Object.keys(REPEATABLE);           // 记录原始的三条
let injected = [];

function resetTier4() {
  for (const id of injected) delete REPEATABLE[id];
  injected = [];
}

/**
 * @param {Array<{id:string,m:number,r:number,baseCost?:string,kind?:string}>} specs
 */
function addTier4(specs) {
  resetTier4();
  for (const s of specs) {
    REPEATABLE[s.id] = {
      id: s.id,
      name: s.id,
      kind: s.kind ?? "matterMul",
      currency: s.currency ?? "matter",
      baseCost: s.baseCost ?? "1e25",
      costMult: s.r,
      effect: s.m,
      desc: () => "",
      firstRewardDream: false,
    };
    ZONE_OF[s.id] = "dm";
    injected.push(s.id);
  }
}

// ══════════════════════════════════════════════════════════
// 跑一轮
// ══════════════════════════════════════════════════════════

function run(hours = 48) {
  const state = newState();
  const DT = 0.5;
  const MAX = hours * 3600;
  const ids = Object.keys(REPEATABLE);
  const ORDER = ["particleBoost", "matterBoost", "entropyCoeff", ...injected];

  for (let i = 0; i < 10; i++) doClick(state);

  let t = 0;
  const marks = {};
  const CHECK = [1e25, 1e30, 1e40, 1e50, 1e60, 1e70, 1e80, 1e90];

  while (t < MAX) {
    if (state.resources.traps.lt(3) || state.resources.entropy.lt(1)) {
      for (let i = 0; i < 10; i++) doClick(state);
    }
    for (const id of ORDER) if (REPEATABLE[id]) buyRepeatable(state, id, true);
    buyTrap(state, true);
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(state, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(state, id);

    tick(state, DT);
    t += DT;

    const e = log10(state.resources.matter);
    for (const c of CHECK) {
      if (marks[c] === undefined && e >= Math.log10(c)) marks[c] = t;
    }
    if (e >= 80) break; // 达标就停
  }

  return {
    seconds: t,
    matter: state.resources.matter,
    marks,
    levels: Object.fromEntries(ORDER.filter((i) => REPEATABLE[i]).map((i) => [i, state.levels[i]?.toNumber() ?? 0])),
  };
}

// ══════════════════════════════════════════════════════════
console.log("=".repeat(84));
console.log("第四层数值实验台");
console.log("=".repeat(84));
console.log();
console.log("  目标：把基础物质从 1e25 保送到 1e80");
console.log("  杠杆：S = Σ log(m)/log(r)，S 越接近 1 收入天花板越高");
console.log();

const base = computeS().S;
console.log(`  当前 S = ${base.toFixed(4)}（只有 particleBoost + matterBoost）`);
console.log();

// ══════════════════════════════════════════════════════════
// 候选方案
// ══════════════════════════════════════════════════════════

const CANDIDATES = [
  { name: "对照：不加第四层", specs: [] },
  { name: "3 条 r=10   m=1.38  (S→0.85)", specs: [
    { id: "dm1", m: 1.383, r: 10 }, { id: "dm2", m: 1.383, r: 10 }, { id: "dm3", m: 1.383, r: 10 },
  ] },
  { name: "3 条 r=10   m=1.44  (S→0.90)", specs: [
    { id: "dm1", m: 1.437, r: 10 }, { id: "dm2", m: 1.437, r: 10 }, { id: "dm3", m: 1.437, r: 10 },
  ] },
  { name: "3 条 r=10   m=1.47  (S→0.93)", specs: [
    { id: "dm1", m: 1.470, r: 10 }, { id: "dm2", m: 1.470, r: 10 }, { id: "dm3", m: 1.470, r: 10 },
  ] },
  { name: "3 条 r=1e3  m=2.8   (S→0.88)", specs: [
    { id: "dm1", m: 2.82, r: 1e3 }, { id: "dm2", m: 2.82, r: 1e3 }, { id: "dm3", m: 2.82, r: 1e3 },
  ] },
  { name: "3 条 r=1e6  m=7.9   (S→0.88)", specs: [
    { id: "dm1", m: 7.94, r: 1e6 }, { id: "dm2", m: 7.94, r: 1e6 }, { id: "dm3", m: 7.94, r: 1e6 },
  ] },
];

console.log("  " + "-".repeat(80));
console.log(`  ${pad("方案", 30)} ${pad("S", 9)} ${pad("到 1e40", 10)} ${pad("到 1e60", 10)} ${pad("到 1e80", 10)} 48h 物质`);
console.log("  " + "-".repeat(80));

for (const cand of CANDIDATES) {
  addTier4(cand.specs);
  const { S } = computeS();
  const r = run(48);
  const cell = (target) => (r.marks[target] !== undefined ? clock(r.marks[target]) : "未达成");
  console.log(
    `  ${pad(cand.name, 30)} ${pad(S.toFixed(4), 9)} ${pad(cell(1e40), 10)} ${pad(cell(1e60), 10)} ${pad(cell(1e80), 10)} 1e${log10(r.matter).toFixed(1)}`,
  );
  if (cand.specs.length) {
    console.log(`     等级：${Object.entries(r.levels).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
}

resetTier4();

// ══════════════════════════════════════════════════════════
console.log();
console.log("=".repeat(84));
console.log("读法");
console.log("=".repeat(84));
console.log();
console.log("  · S 是「收入天花板」的开关：S→1 时 1/(1−S)→∞，天花板急剧抬高");
console.log("  · 但 S 必须 < 1，否则整局跑飞（SPEC 判据 P10）");
console.log("  · r 决定「买得起几级」：r 越大，单级效果 m 可以越大，但买得越慢");
console.log("  · 同一贡献 log(m)/log(r) 下，r 大 = 少而强，r 小 = 多而弱");
console.log();
