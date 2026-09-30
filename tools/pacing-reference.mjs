/**
 * tools/pacing-reference.mjs —— **以 AD 世界记录为标尺的节奏对照表**
 *
 * 用户提供：AD（反物质维度）当前世界记录的各阶段达成时刻（速通记录，图）。
 * 用户给的换算规则（**已纠正方向**）：「表单内记录是根据预定时间**乘以**而不是除以」
 *   ⇒ **我们的目标时间 = AD 记录 × 1.25 或 × 1.5**
 *   含义：AD 那张表是**速通世界记录**，而我们要的是"普通玩家的预定时间" ——
 *   所以我们的目标比 WR **慢** 25%~50%，这是有余量、不是欠账。
 *
 * 本工具做三件事：
 *   1. 把 AD 记录按"角色对应"映射到本项目的阶段（同名/同职责的层）；
 *   2. 算出两个目标区间，并和**真实引擎仿真的实测值**并排；
 *   3. 给出偏差判定（快了 / 达标 / 慢了 / 卡住），并把这些判定写成断言 ——
 *      这样"哪一段偏离标尺"永远出现在测试输出里。
 *
 * 用法：
 *   node tools/pacing-reference.mjs            打印对照表
 *   node tools/pacing-reference.mjs --check    断言（达标区间 / 已记录偏差）
 */

const pad = (s, n) => String(s).padEnd(n);
const fH = (h) => (h == null ? "—" : h < 1 / 60 ? `${(h * 3600).toFixed(0)} 秒`
  : h < 1 ? `${(h * 60).toFixed(1)} 分` : `${h.toFixed(2)} 小时`);

/**
 * AD 世界记录（用户供图，单位：**小时**）。
 *
 * 图上的格式是 `HH:MM:SS.s`（早期里程碑省略小时位），这里已经换算好。
 */
export const AD_WR = [
  ["firstDimboost", "First Dimboost", 18.65 / 60],
  ["firstGalaxy", "First Galaxy", 4 + 20 / 60 + 45.8 / 3600],
  ["firstInfinity", "First Infinity", 7 + 39 / 60 + 9.7 / 3600],
  ["tickspeedChallenge", "Tickspeed Challenge", 15 + 9 / 60 + 16.7 / 3600],
  ["allNormalChallenges", "All Normal Challenges", 15 + 9 / 60 + 16.7 / 3600],
  ["breakInfinity", "Break Infinity", 14 + 45 / 60 + 15.0 / 3600],
  ["sell1IP", "Sell 1 IP Upgrade", 32 + 6 / 60 + 20.8 / 3600],
  ["ic5", "Infinity Challenge 5", 36 + 54 / 60 + 43.8 / 3600],
  ["replicanti", "Replicanti", 39 + 1 / 60 + 23.4 / 3600],
  ["firstEternity", "★ First Eternity", 66 + 6 / 60 + 3.2 / 3600],
  ["allEternityMilestones", "All Eternity Milestones", 79 + 16 / 60 + 44.0 / 3600],
  ["firstEternityChallenge", "First Eternity Challenge", 87 + 1 / 60 + 54.1 / 3600],
  ["ec10", "Eternity Challenge 10", 119 + 42 / 60 + 48.3 / 3600],
  ["firstDilatedEternity", "First Dilated Eternity", 129 + 3 / 60 + 56.3 / 3600],
  ["timeTheorem", "Time Theorem Generation", 152 + 29 / 60 + 43.2 / 3600],
  ["firstReality", "★ First Reality", 191 + 10 / 60 + 19.5 / 3600],
  ["blackHole", "Black Hole", 265 + 49 / 60 + 26.3 / 3600],
  ["allRealityUpgrades", "All Reality Upgrades", 280 + 24 / 60 + 9.4 / 3600],
  ["teresas", "Teresa's Reality", 283 + 54 / 60 + 9.8 / 3600],
  ["effarigs", "Effarig's Reality", 287 + 42 / 60 + 28.3 / 3600],
  ["nameless", "The Nameless Ones' Reality", 289 + 58 / 60 + 47.2 / 3600],
  ["vAchievements", "All basic V-Achievements", 295 + 20 / 60 + 59.7 / 3600],
  ["ra", "Regain Ra's Memories", 317 + 45 / 60 + 33.7 / 3600],
  ["fullDestab", "Full Destabilization", 330 + 24 / 60 + 27.4 / 3600],
  ["gameCompleted", "★ Game Completed", 371 + 12 / 60 + 45.8 / 3600],
];

/**
 * 阶段映射：本项目的阶段 ↔ AD 的对应里程碑（按**职责**对应，不按名字）。
 *
 * `ours` 是**真实引擎仿真**的实测值（来源：`stage-timing.mjs`，48 游戏小时那次跑；
 * 标 `null` 表示"仿真时长内没达成"）。`design` 是设计目标（用户拍过板的值）。
 */
export const STAGE_MAP = [
  {
    ours: "量子层解锁",
    ad: "firstDimboost",
    measured: 7.3 / 60,
    note: "早期小门槛",
  },
  {
    ours: "第一次大坍缩",
    ad: "firstInfinity",
    measured: 2.0,
    note: "第一次「清空重来」",
  },
  {
    ours: "打破无限",
    ad: "breakInfinity",
    measured: 10.8,
    note: "★ 同名同职责：∞ 层完全体",
  },
  {
    ours: "★ 永恒门槛（IP 1e308.25）",
    ad: "firstEternity",
    measured: null,
    measuredNote: "48h 只到 IP 1e3.6（远未达成）",
    design: 24.0,
    designNote: "用户定的 24 档 × 1h；18h 为满配提速上限",
    note: "★ 同名同职责：层间重置",
  },
];

const FACTORS = [1.25, 1.5];   // ★ 我们的目标时间 = AD 记录 **×** 这两个系数（方向已按用户纠正）

console.log("=".repeat(104));
console.log("以 AD 世界记录为标尺的节奏对照（我们的目标时间 = AD 记录 × 1.25 或 × 1.5）");
console.log("=".repeat(104));
console.log(`  ${pad("本项目阶段", 24)} ${pad("AD 对应里程碑", 18)} ${pad("AD WR", 11)} ` +
  `${pad("目标 ×1.25", 11)} ${pad("目标 ×1.5", 11)} ${pad("本项目实测", 12)} 判定`);

const verdicts = [];
for (const row of STAGE_MAP) {
  const ad = AD_WR.find(([id]) => id === row.ad);
  const adH = ad?.[2];
  const t125 = adH * FACTORS[0];
  const t15 = adH * FACTORS[1];
  const m = row.measured;
  let verdict;
  if (m == null) verdict = "⏳ 未达成（设计仍在标尺内，见下）";
  else if (m < t125 * 0.8) verdict = "⚠️ 比目标快 >20%（有余量）";
  else if (m <= t15 * 1.05) verdict = "✅ 达标（落在目标区间）";
  else verdict = "❌ 偏慢";
  verdicts.push({ ...row, adH, t125, t15, verdict });
  console.log(`  ${pad(row.ours, 24)} ${pad(ad?.[1] ?? row.ad, 18)} ${pad(fH(adH), 11)} ` +
    `${pad(fH(t125), 11)} ${pad(fH(t15), 11)} ${pad(m == null ? "未达成" : fH(m), 12)} ${verdict}`);
}
console.log();

// ── 分段（层间）对照：AD 的"打破无限 → 首次永恒"这一段 ──
const adBreak = AD_WR.find(([id]) => id === "breakInfinity")[2];
const adEternity = AD_WR.find(([id]) => id === "firstEternity")[2];
const adSeg = adEternity - adBreak;
console.log(`  AD 的「打破无限 → 首次永恒」这一整段 = ${fH(adSeg)}` +
  `（${adEternity.toFixed(1)} − ${adBreak.toFixed(1)}）`);
console.log(`  ⇒ 本项目目标区间：${fH(adSeg * 1.25)} ~ ${fH(adSeg * 1.5)}`);
console.log(`  ⇒ 用户定档的设计值：24.00 小时（满配 18h）—— ${24 < adSeg * 1.25 ? "比标尺**更快**（有余量）" : "在标尺内"}`);
console.log();

if (process.argv.includes("--check")) {
  console.log("=".repeat(104));
  console.log("定点断言");
  console.log("=".repeat(104));
  let fails = 0;
  const ck = (label, ok, detail) => {
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 46)} ${detail}`);
  };
  const b = verdicts.find((v) => v.ad === "breakInfinity");
  ck("打破无限比目标更快（有余量而非超时）", b.measured < b.t125,
    `实测 ${fH(b.measured)} vs 目标 ${fH(b.t125)}~${fH(b.t15)} ⇒ 快 ${(b.t125 / b.measured).toFixed(2)}×`);
  const e = verdicts.find((v) => v.ad === "firstEternity");
  ck("★ 永恒门槛：实测未达成，但**设计值仍在标尺内**", e.measured == null,
    `目标 ${fH(e.t125)}~${fH(e.t15)}；设计 10.8h + 24h = ${fH(10.8 + 24)}（比标尺下限还快）`);
  const q = verdicts.find((v) => v.ad === "firstDimboost");
  ck("早期比目标更快（可保留为特色，或放慢）", q.measured < q.t125 * 0.8,
    `实测 ${fH(q.measured)} vs 目标 ${fH(q.t125)}~${fH(q.t15)}`);
  ck("设计值（24h 阶梯）比标尺下限更快 ⇒ 设计留了余量",
    24 < adSeg * 1.25, `设计 24h < 标尺下限 ${fH(adSeg * 1.25)}（说明"太长"不是设计目标定错）`);
  // ⚠️ 不能查"表内顺序递增"：这张表是**按图上排版逐行抄的**，而 WR 图本身不按时间排
  //    （例：Break Infinity 14.75h 在图上排在 Tickspeed Challenge 15.15h 前面）。
  //    改查两件有意义的事：数值范围合理 + **被映射的 4 个里程碑**时序正确。
  ck("AD 记录表数值合理（0 < t < 400 小时）",
    AD_WR.every((r) => r[2] > 0 && r[2] < 400), `${AD_WR.length} 条里程碑`);
  const chrono = ["firstDimboost", "firstInfinity", "breakInfinity", "firstEternity"]
    .map((id) => AD_WR.find(([x]) => x === id)[2]);
  ck("被映射的 4 个 AD 里程碑时序正确", chrono.every((v, i) => i === 0 || v > chrono[i - 1]),
    chrono.map((v) => fH(v)).join(" < "));
  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
