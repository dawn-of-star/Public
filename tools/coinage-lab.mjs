/**
 * tools/coinage-lab.mjs —— 无限铸币 + IP 侧软上限的定点自检
 *
 * ⚠️ 铸币**设计未冻结**（用户保留最终修改权）。所以本工具守的是**结构事实**，
 *    不是"数值好不好玩"：
 *      1. 档位闸门必须严格（无坍缩 = 一级都买不了；等级 ≤ 30 × 坍缩次数）；
 *      2. IP 侧的每个循环都必须有**极强的软上限**（用户指定：影响永恒阶段的东西）；
 *      3. 铸币倍率必须真的进入**所有**无限点收入（深度 + ④ 耗时）；
 *      4. 源码守卫：不允许再出现"无界公比"的价格写法（那正是池驱动爆走的来源）。
 *
 * 用法：node tools/coinage-lab.mjs [--check]
 */
import { readFileSync } from "node:fs";
import Decimal from "../dist/break_eternity.esm.js";
import { newState } from "../src/state.js";
import { buyAccel, buyCoinage, buyInfinityUpgrade, doBigCrunch } from "../src/engine.js";
import {
  COINAGE, CRUNCH_ACCEL, IP_DOUBLE_SOFT_CAP, accelLevel, accelMult, coinageAffordableIn, coinageCap,
  coinageCapPerCrunch, coinageCost, coinageLevel, infinityRateMult, infinityUpgradeOwned, quantumToIPGain,
  INFINITY_UPGRADES, tierQuantumStepMult, tierRateMult,
  coinageMult, coinageTotalCost, infinityUpgradeCost, ipDoubleAffordableIn, ipDoubleLogCost,
} from "../src/config.js";
import { bigCrunchGain } from "../src/formulas.js";
import { timeIPPerSecond } from "../src/config.js";

const D = (v) => new Decimal(v);
const pad = (s, n) => String(s).padEnd(n);
const check = process.argv.includes("--check");
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// ══════════════════════════════════════════════════════════
const rows = [0, 1, 2, 5, 10, 24, 48];
console.log("=".repeat(90));
console.log("无限铸币：档位闸门（capPerCrunch = " + COINAGE.capPerCrunch + "）× 价格软上限");
console.log("=".repeat(90));
console.log(`  ${pad("大坍缩次数", 12)} ${pad("本档上限", 10)} ${pad("1e100 点能买", 14)} ${pad("买满后倍率", 16)}`);
for (const c of rows) {
  const s = newState();
  s.bigCrunchCount = D(c);
  const canBuy = coinageAffordableIn(s, D(1e100));
  s.infinityPoints = D(1e100);
  const got = buyCoinage(s, true);
  console.log(`  ${pad(c, 12)} ${pad(coinageCap(s), 10)} ${pad(canBuy, 14)} ${pad("1e" + coinageMult(s).log10().toNumber().toFixed(1), 16)}`);
  void got;
}
console.log();
console.log("  铸币价格（软上限从第 900 级起咬 —— 设计只需要 24 档 × 30 = 720 级）：");
for (const lv of [0, 30, 300, 719, 720, 899, 900, 901, 1200]) {
  console.log(`     lv ${pad(lv, 5)} 下一级 = 1e${coinageCost({ coinageLevel: D(lv) }).log10().toNumber().toFixed(2)}`);
}
console.log();
console.log("  ① 无限增幅的软上限（设计需要 A ≈ 50；60 级前与原式完全一致）：");
for (const lv of [0, 10, 30, 59, 60, 61, 90, 91]) {
  console.log(`     lv ${pad(lv, 5)} 价格 = 1e${ipDoubleLogCost(lv).toFixed(2)}` + (lv <= 60 ? "  （= 10^等级，原式）" : ""));
}
console.log();

if (check) {
  console.log("=".repeat(90));
  console.log("定点断言");
  console.log("=".repeat(90));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };

  // ① 闸门
  const s0 = newState();
  s0.infinityPoints = D(1e100);
  ck("无大坍缩时一级都买不了（闸门 = 0）", buyCoinage(s0, true) === 0 && coinageLevel(s0).eq(0),
    `买满返回 0，等级 ${coinageLevel(s0).toString()}`);
  const s24 = newState();
  s24.bigCrunchCount = D(24);
  // 池子给到 1e1000：这样约束才是**闸门**（铸币第 900 级后有 ×20 软上限，
  // 1e308 点时"买不动"测的是价格、不是闸门 —— 两者必须分开测）
  s24.infinityPoints = D(10).pow(1000);
  const got = buyCoinage(s24, true);
  // ⚠️ 每档放行量现在**随里程碑爬升**（30 → 46），断言必须用 `coinageCapPerCrunch`
  ck("闸门严格：等级 ≤ 每档放行量 × 坍缩次数",
    coinageLevel(s24).toNumber() === coinageCap(s24) && got === coinageCap(s24),
    `24 次坍缩 → 买到 ${coinageLevel(s24).toString()} / 上限 ${coinageCap(s24)}` +
    `（每档 ${coinageCapPerCrunch(s24)} 级）`);
  const s25 = newState();
  s25.bigCrunchCount = D(25);
  ck("多一次坍缩才放行下一批（放行量取当时的里程碑值）",
    coinageCap(s25) - coinageCap(s24) === coinageCapPerCrunch(s25),
    `+${coinageCap(s25) - coinageCap(s24)} 级/次（此时每档 ${coinageCapPerCrunch(s25)} 级）`);
  ck("闸门不依赖其它任何循环（禁加法耦合）", !/coinageCap[\s\S]{0,200}(ipDoubleLevel|zpeEngineLevel)/.test(
    readFileSync(ROOT + "src/config.js", "utf8")),
    "coinageCap 里查不到引擎/①等级项");

  // ② 软上限
  const g900 = Math.pow(10, coinageLogCostSafe(901) - coinageLogCostSafe(900));
  ck("铸币软上限：第 900 级起涨价 ×20", Math.abs(g900 - 20) < 1e-6, `实测 ×${g900.toFixed(2)}`);
  ck("软上限不干扰设计需求（720 级以内仍是 ×2）",
    Math.abs(Math.pow(10, coinageLogCostSafe(720) - coinageLogCostSafe(719)) - 2) < 1e-9,
    "第 720 级涨价仍是 ×2");
  const ipdBound = ipDoubleAffordableIn(0, D(1e308));
  ck("① 极强软上限：1e308 点买不到 200 级", ipdBound < 200,
    `买到 ${ipdBound} 级（无软上限时约 ${Math.floor(308 / Math.log10(10))} 级 = 池子的 log10）`);
  ck("① 软上限不影响设计需求（60 级前 = 原式 10^等级）",
    Math.abs(ipDoubleLogCost(59) - 59) < 1e-9 && Math.abs(ipDoubleLogCost(60) - 60) < 1e-9,
    `lv59 = 1e${ipDoubleLogCost(59).toFixed(2)}，lv60 = 1e${ipDoubleLogCost(60).toFixed(2)}`);

  // ③ 铸币倍率真的进了所有 IP 收入
  const s = newState();
  s.brokenInfinity = true;
  s.resources.matter = D(10).pow(308.25);
  s.ipTimeBought = true;
  s.ipDoubleLevel = D(10);
  const beforeDepth = bigCrunchGain(s).toNumber();
  const beforeTime = timeIPPerSecond(s).toNumber();
  s.coinageLevel = D(10);
  const want = Math.pow(COINAGE.effectPerLevel, 10);
  ck("铸币倍率进入深度收益", Math.abs(bigCrunchGain(s).toNumber() / beforeDepth - want) < 1e-6,
    `×${(bigCrunchGain(s).toNumber() / beforeDepth).toFixed(3)}（期望 ${want.toFixed(3)}）`);
  ck("铸币倍率进入 ④ 耗时收益", Math.abs(timeIPPerSecond(s).toNumber() / beforeTime - want) < 1e-6,
    `×${(timeIPPerSecond(s).toNumber() / beforeTime).toFixed(3)}`);

  // ④ 源码守卫：不许再有"无界公比"的 IP 侧价格
  const cfgSrc = readFileSync(ROOT + "src/config.js", "utf8");
  const badPattern = /Decimal\.pow\(cfg\.costMult,\s*lv\)/.test(cfgSrc);
  ck("源码守卫：IP 侧已无『无界公比』价格写法", !badPattern,
    badPattern ? "config.js 里仍有 costMult^lv" : "① / 铸币 / 引擎都走分段软上限");

  // ⑤ 24h 档的算术自洽（闸门放行的总量 vs 所需 306 阶）
  const ordersPerTier = COINAGE.capPerCrunch * Math.log10(COINAGE.effectPerLevel);
  ck("24 档 × 每档 30 级 ≈ 设计所需阶数（含 ① 的贡献）", ordersPerTier >= 11 && ordersPerTier <= 13,
    `铸币单独 ${ordersPerTier.toFixed(2)} 阶/档；模型实测（含 ①）12.73 阶/档 ≈ 306/24 = 12.75`);

  // ⑥ 坍缩加速器：效果 = 乘成长速率，硬封顶 ×2；一次大坍缩的耗时与它严格成反比
  const acc = newState();
  acc.infinityPoints = D(1e12);
  const before = accelMult(acc);
  const got6 = buyAccel(acc, true);
  ck("坍缩加速器可用无限点买、并按等级放大速率", got6 > 0 && accelMult(acc) > before,
    `买到 ${accelLevel(acc)} 级 → 速率 ×${accelMult(acc).toFixed(3)}`);
  const accMax = newState();
  accMax.accelLevel = D(9999);
  accMax.infinityPoints = D(1e300);
  ck("★ 效果硬封顶（不会变成第二个 runaway）", accelMult(accMax) === CRUNCH_ACCEL.maxMult,
    `等级被夹到 ${accelLevel(accMax)}，倍率恒为 ×${accelMult(accMax)}`);
  ck("18h 档的 ×1.35 落在可用范围内", accelMult({ accelLevel: D(15) }) > 1.34 &&
    accelMult({ accelLevel: D(15) }) < 1.36, `15 级 = ×${accelMult({ accelLevel: D(15) }).toFixed(3)}`);
  // 「耗时与速率严格成反比」由 tools/crunch-speed-lab.mjs 的断言守着
  // （那条积分模型只在那边有一份，这里不重复实现，避免两套口径）
  ck("加速器与「速率解放」共用一个入口（单一数据源）", /infinityRateMult[\s\S]{0,300}accelMult/.test(
    readFileSync(ROOT + "src/config.js", "utf8")),
    "infinityRateMult 里并入了 accelMult（quantumGrowthRate 只有一个入口）");

  // ⑦ 档位里程碑：抬高每档放行量（档数压缩）、给速率、给量子润滑
  const tm = newState();
  const capAt = (c) => { tm.bigCrunchCount = D(c); return coinageCapPerCrunch(tm); };
  ck("档位里程碑抬高『每档放行量』（档数压缩）", capAt(0) === 30 && capAt(3) === 33 && capAt(9) === 36 &&
    capAt(18) === 41 && capAt(24) === 46,
    `0/3/9/18/24 次坍缩 → ${capAt(0)}/${capAt(3)}/${capAt(9)}/${capAt(18)}/${capAt(24)} 级/档`);
  ck("每档放行量单调不减", [0, 1, 2, 3, 6, 9, 12, 15, 18, 21, 24, 30].every((c, i, arr) =>
    i === 0 || capAt(c) >= capAt(arr[i - 1])), "逐档检查通过");
  tm.bigCrunchCount = D(0);
  const r0 = tierRateMult(tm);
  tm.bigCrunchCount = D(15);
  ck("速率里程碑并入同一个入口（单一数据源）",
    Math.abs(tierRateMult(tm) - 1.1025) < 1e-9 && Math.abs(infinityRateMult(tm) - 1.1025) < 1e-9 && r0 === 1,
    `15 次坍缩 → ×${tierRateMult(tm).toFixed(4)}（infinityRateMult 同步）`);
  tm.bigCrunchCount = D(0);
  const step0 = 20 * tierQuantumStepMult(tm);
  tm.bigCrunchCount = D(12);
  const step12 = 20 * tierQuantumStepMult(tm);
  ck("量子润滑是**保守**改动（×20 → ×19.5）",
    Math.abs(step0 - 20) < 1e-9 && Math.abs(step12 - 19.5) < 1e-9,
    `步长 ${step0} → ${step12}（用户：先保守，惩罚若仍严重再回原方案）`);

  // ⑧ 档数压缩的算术自洽：前 18 档的平均放行量 → 估算总时长
  //    趋势取自 ip-economy-lab 的拟合表（h ≈ 700 / 每档级数；30 级/档 = 24h 档）
  const avgCap = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18].reduce((s, c) => s + capAt(c), 0) / 10;
  const hours = 700 / avgCap;
  ck("★ 档数压缩后总时长落在 18h 附近（用户定的提速上限）", hours > 16 && hours < 21,
    `前 18 档平均每档 ${avgCap.toFixed(1)} 级 → 估算 ${hours.toFixed(1)} h`);

  // ⑨ ★ 「显示 == 实发」：界面显示的本次收益必须与引擎实际发放完全一致。
  //   踩过的坑：`doBigCrunch` 曾自己算 `infinityPointGain × 3^①`，不走 `bigCrunchGain()`
  //   —— 我加铸币倍率后立刻出现"界面乘了、引擎没乘"。这条断言就是防它复发。
  {
    const pay = newState();
    pay.peakMatter = D(10).pow(310);          // ← 临界坍缩的解锁看的是**峰值**
    pay.brokenInfinity = true;
    pay.resources.matter = D(10).pow(310);
    pay.peakQuantumRun = D(83);
    pay.coinageLevel = D(10);
    pay.ipDoubleLevel = D(3);
    pay.infinityPoints = D(100);
    buyInfinityUpgrade(pay, "ipFromQuantum");
    const shown = bigCrunchGain(pay);
    const had = pay.infinityPoints;
    doBigCrunch(pay);
    const paid = pay.infinityPoints.sub(had);
    ck("★ 显示 == 实发（走同一个 bigCrunchGain）", paid.eq(shown),
      `显示 ${shown.toString()} / 实发 ${paid.toString()}`);
    ck("量子铸币生效且峰值随大坍缩归零", shown.gt(0) && pay.peakQuantumRun.eq(0),
      `q=83 → 额外 ${quantumToIPGain({ infinityFromQuantumBought: true, peakQuantumRun: D(83) })} 点；坍缩后峰值归零`);
  }

  // ⑩ ★ **通用守卫**：每一条"一次性 ∞ 升级"买了之后必须变成"已购"，
  //    否则 `buyInfinityUpgrade` 会**无限次重复卖**它（每次 5/50/100 IP）——
  //    实测后果是打破无限后的 IP 池永远停在个位数，"种子"永远攒不出来（本轮的真实元凶）。
  //    这条断言对**所有**非可重复升级生效，所以以后再加升级会自动被它看住。
  {
    const bad = [];
    for (const [id, cfg] of Object.entries(INFINITY_UPGRADES)) {
      if (cfg.repeatable) continue;
      const st = newState();
      st.infinityPoints = D(1e9);
      buyInfinityUpgrade(st, id);
      if (!infinityUpgradeOwned(st, id)) { bad.push(id); continue; }
      const ipBefore = st.infinityPoints;
      buyInfinityUpgrade(st, id);                    // 再买一次必须失败（且不扣钱）
      if (!st.infinityPoints.eq(ipBefore)) bad.push(id + "(重复扣款)");
    }
    ck("★ 一次性 ∞ 升级买了就变『已购』（不会重复卖）", bad.length === 0,
      bad.length ? `有问题：${bad.join(", ")}` : `${Object.values(INFINITY_UPGRADES).filter((c) => !c.repeatable).length} 条全部通过`);
  }

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}

/** 局部小工具：拿 log 价格（避免在上面的表格里重复 import） */
function coinageLogCostSafe(level) {
  return coinageCost({ coinageLevel: D(level) }).log10().toNumber();
}
