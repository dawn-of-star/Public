#!/usr/bin/env node
/**
 * tools/de-tune.mjs —— 把「暗能量速率峰值」推到指定的基础物质处
 *
 * ── 问题 ──
 * 暗能量速率 = zpeRate / 1e8 × 每次转换量
 * 而 zpeRate 里含着「暗能量对 ZPE 的惩罚」：
 *     penalty = 1 / (1 + coeff × DE^exponent × (1−减免))
 *
 * 这是自反馈：DE 越多 -> ZPE 越少 -> DE 涨得越慢。
 * 指数越大，惩罚越陡，速率峰值出现得越早。目标是让峰值出现在
 * **基础物质 = 1e308.25**（大坍缩阈值）附近，也就是整条阶梯跑完时。
 *
 * ── 方法 ──
 * 用一个**粗步长**跑完整的一轮无限周期（不是逐 tick，那跑不完），
 * 记录 (基础物质, 暗能量, 暗能量速率)，找出速率的峰值点。
 * `DE_PENALTY` 是普通对象、属性可写，所以可以直接改指数重跑。
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BASE, COLLAPSE, DE_PENALTY, DE_UPGRADES, QUANTUM, REPEATABLE, VOID_UPGRADES } from "../src/config.js";
import { newState, deLevelOf } from "../src/state.js";
import {
  affordableCount, buyDeUpgrade, buyRepeatable, buyTrap, buyVoidUpgrade, doClick,
  doBigCrunch, tick,
} from "../src/engine.js";
import { canBigCrunch, darkEnergyRate, zpeProductionPenalty } from "../src/formulas.js";

const D = (v) => new Decimal(v);
const pad = (s, n) => String(s).padEnd(n);
const DT = 2;               // 粗步长（秒）
const MAX_STEPS = 4000;     // 上限 8000 秒游戏时间
const TARGET_LOG = 308.2547; // 目标峰值位置

/** 跑一轮，返回 { peakMatterLog, peakRate, samples } */
function runOnce() {
  const st = newState();
  const samples = [];
  let peak = { log: 0, rate: 0 };

  for (let i = 0; i < MAX_STEPS; i++) {
    // ★ 启动：靠点击攒出最初的熵和熵阱，否则物质永远是 0
    //   （第一版漏了这一步，整个模拟卡在物质 = 1e0）
    if (st.resources.traps.lt(3) || st.resources.entropy.lt(1)) {
      for (let c = 0; c < 10; c++) doClick(st);
    }

    // 购买（和真实玩法一致，用闭式解买满）
    for (const id of Object.keys(REPEATABLE)) buyRepeatable(st, id, true);
    buyTrap(st, true);
    // ★ 虚空升级必须先买 —— 暗能量里程碑 m0 的门槛是「v8 + 1e8 物质」，
    //   不买 v8 的话暗能量系统永远不会解锁（第一版漏了，暗能量一直是 0）
    for (const id of Object.keys(VOID_UPGRADES)) buyVoidUpgrade(st, id);
    for (const id of Object.keys(DE_UPGRADES)) buyDeUpgrade(st, id);

    const rate = darkEnergyRate(st).toNumber();
    const mL = st.resources.matter.gt(0) ? st.resources.matter.log10().toNumber() : 0;
    if (rate > peak.rate) peak = { log: mL, rate };
    if (i % 20 === 0) samples.push({ log: mL, de: st.darkEnergy.toNumber(), rate, pen: zpeProductionPenalty(st).toNumber() });

    tick(st, DT);

    // 一轮结束：物质到大坍缩阈值（或物质开始回落 = 已坍缩）
    if (mL > 300 && canBigCrunch(st)) break;
    if (mL > 300 && st.resources.matter.lt(D("1e298"))) break;
  }
  return { peak, samples, st };
}

console.log("=".repeat(94));
console.log("暗能量速率峰值  vs  惩罚指数");
console.log("=".repeat(94));
console.log();
console.log(`  目标：峰值出现在基础物质 1e${TARGET_LOG.toFixed(2)}（大坍缩阈值）`);
console.log(`  固定：coeff = ${DE_PENALTY.coeff}，减免 = 1 − ${DE_PENALTY.dreamReductionBase}^等级，下限 ${DE_PENALTY.floor}`);
console.log(`  步长：${DT}s，上限 ${MAX_STEPS * DT / 60} 分钟游戏时间`);
console.log();

const EXPONENTS = [0.5, 0.35, 0.25, 0.15, 0.08, 0.05];
const original = DE_PENALTY.exponent;

console.log(`  ${pad("指数", 8)} ${pad("峰值处物质", 16)} ${pad("峰值速率", 14)} ${pad("终点暗能量", 16)} 评价`);
console.log("  " + "-".repeat(88));

const results = [];
for (const e of EXPONENTS) {
  DE_PENALTY.exponent = e;
  const { peak, st } = runOnce();
  const dev = Math.abs(peak.log - TARGET_LOG);
  const verdict =
    peak.log <= 0 ? "❌ 没跑起来"
      : dev < 15 ? "✅ 正合适"
        : peak.log < TARGET_LOG ? `⚠️ 峰值偏早（差 ${(TARGET_LOG - peak.log).toFixed(0)} 阶）`
          : "⚠️ 峰值偏晚";
  results.push({ e, peak, de: st.darkEnergy.toNumber(), verdict });
  console.log(
    `  ${pad(e, 8)} ${pad("1e" + peak.log.toFixed(1), 16)} ${pad(peak.rate.toExponential(3), 14)} ` +
    `${pad("1e" + Math.log10(Math.max(1, st.darkEnergy.toNumber())).toFixed(1), 16)} ${verdict}`,
  );
}
DE_PENALTY.exponent = original;

// 找最接近目标的
const best = results.reduce((a, b) =>
  Math.abs(a.peak.log - TARGET_LOG) < Math.abs(b.peak.log - TARGET_LOG) ? a : b);
console.log();
console.log("=".repeat(94));
console.log(`  最接近目标的指数：${best.e}（峰值在 1e${best.peak.log.toFixed(1)}）`);
console.log("=".repeat(94));
console.log();

// 输出最优指数下的采样曲线
DE_PENALTY.exponent = best.e;
const { samples } = runOnce();
DE_PENALTY.exponent = original;

console.log(`  指数 ${best.e} 下的采样（每 40 秒一次）：`);
console.log(`  ${pad("基础物质", 14)} ${pad("暗能量", 14)} ${pad("ZPE惩罚", 12)} ${pad("暗能量/秒", 14)}`);
console.log("  " + "-".repeat(58));
for (const s of samples.filter((_, i) => i % 3 === 0)) {
  console.log(
    `  ${pad("1e" + s.log.toFixed(1), 14)} ${pad("1e" + Math.log10(Math.max(1, s.de)).toFixed(1), 14)} ` +
    `${pad(s.pen.toExponential(2), 12)} ${pad(s.rate.toExponential(3), 14)}`,
  );
}
console.log();
