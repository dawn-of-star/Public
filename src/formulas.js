import { quantumToIPGain } from "./config.js";
/**
 * formulas.js —— 全部计算（纯函数，不碰 DOM）
 *
 * 从 0.3.4 的 engine.js 移植。所有派生值都在这里算，state 只存原始数据。
 * 纯函数的好处：能在 Node 里直接跑无头测试（见 tools/headless.mjs）。
 *
 * ⚠️ 大数一律用 Decimal.pow，绝不用 Math.pow。
 *    JS 的 Number 上限是 1.8e308，Math.pow(4, 512) 就会溢出成 Infinity
 *    并被 D() 转成 dInf，污染整条链。SPEC §5.3
 */

import Decimal from "../dist/break_eternity.esm.js";
import { hasCollapse, transmuterIpMult,
  BASE, BREAK_INFINITY, CLIMB, COLLAPSE, DE_MILESTONES, DE_PENALTY, DE_UPGRADES, INFINITY_UPGRADES, OVERLOAD,
  REPEATABLE, piecewiseDeCost, overloadThreshold, infinityRateMult,
  VOID_UPGRADES, ZPE_EXPONENT, ZPE_MILESTONES, QUANTUM_MILESTONES, DE_SPAN, crunchThreshold,
  infinityPointGain, quantumDeGainBonus, quantumDeMultBonus,
  quantumEntropyMultiplier, dreamUpgradeEffects,
  zpeEngineCountFreqUnlocked, zpeEngineProdMult, voidBoostMult, icEntropyMult, ipDoubleMult, zpeEngineAddBonus, zpeEngineMultBonus,
  matterSpanMult, softCapB, qOf, quantumZpeMultBonus, ETERNITY, eternityPointGain, tierMilestonesDone, tierAccelMult, matterTotalExponent, CRUNCH_AT_LABEL,
  // ★ 2025：永恒里程碑（em6 = 熵消耗 ÷1.2；em5 = IP 收益 ×(1+log10 累计EP)）
  hasEternityMilestone, em5IpMult,
  // ★★★ 2025（用户裁定）：引擎等级对【量子加成】的乘数（= costGrowth^等级，与价格同速）
  engineBonusMult,
  // ★★★ 2025（`docs/NEKO.md` §7）：好感度 ⇒ 全局加成 ^指数（唯一入口）
  nekoGlobalExponent,
  // ★★★ 2026：「永恒之后」第一块 = 暗物质 / 第二台相变仪。
  //   ⚠️ 落点是**暗能量倍率的加法区**（**不是** `darkEnergyRate`）——
  //     唯一入口 `darkMatterAdditiveTerm()`（未解锁 ⇒ 恰好 0 ⇒ 零回归 ✓）
  darkMatterAdditiveTerm,
  // ★★★ 2026：`em4`「优化暗能量获取公式」的唯一入口（1.10 → 1.12，见 config.js 的说明）
  deGainBaseEffectMult } from "./config.js";
import { deLevelOf, hasDe, hasV9, hasVoid, hasZpe, levelOf } from "./state.js";

const D = (v) => new Decimal(v ?? 0);
export { D };

/**
 * `floor(x / y)`，并且**对 Decimal 除法的舍入免疫**。
 *
 * ⚠️ 这是一个真踩过的坑，不要退回 `x.div(y).floor()`：
 *
 *   break_eternity 的 `div` 只保留约 15~16 位有效数字，商会被**四舍五入**。
 *   当真实商非常接近整数、但落在整数下方时，`div` 会把它抬到整数上，
 *   于是 `floor()` 多出一格：
 *
 *       x = 16215948575620.594        y = 0.033665705190560606
 *       真值   x/y = 481675594906810.94   -> floor = …810
 *       div 给出   481675594906811       -> floor = …811   ← 多一格
 *
 *   后果（实测）：熵 → 粒子的转换多扣一次阈值，余量变成
 *   **-0.001953125**，界面上出现「余 -0.0019」这种负数。
 *   同一类隐患也在所有「闭式解反推买得起几级」的地方。
 *
 * 所以这里向下取整之后再回退校验一次：`q×y` 不许超过 `x`。
 * 最多退 4 次（真实误差只有 1 格，写 4 是为了防御性），常数代价。
 */
export function floorDiv(x, y) {
  let q = x.div(y).floor();
  for (let i = 0; i < 4 && q.gt(0) && q.mul(y).gt(x); i++) q = q.sub(1);
  return q;
}

/** 等比数列前 n 项和：`first × (r^n − 1)/(r − 1)`（r = 1 时退化成 first×n） */
export function geometricSum(first, r, n) {
  return r === 1
    ? first.mul(n)
    : first.mul(Decimal.pow(r, n).sub(1)).div(r - 1);
}

/**
 * 把「闭式解反推出的级数」下调到**真正买得起**的那一档。
 *
 * `log`/`div` 都有舍入，反推出来的 n 偶尔会比实际能买的级数多 1，
 * 此时总价会略微超过资源 —— 老代码是直接 `return 0`（玩家点了「买满」却什么都没发生）。
 */
export function clampToAffordable(first, r, pool, n) {
  let k = n;
  for (let i = 0; i < 4 && k > 1 && pool.lt(geometricSum(first, r, k)); i++) k -= 1;
  return k;
}

// ══════════════════════════════════════════════════════════
// 全局加成
// ══════════════════════════════════════════════════════════

/** 梦想点的系数。v4 把它从 0.02 提到 0.08。 */
export function dreamCoefficient(state) {
  return hasVoid(state, "v4") ? 0.08 : 0.02;
}

/**
 * 某个乘区里所有可重复升级的乘积。
 *
 * 升级按 config 里的 `kind` 归类，所以加一条新的乘法升级只需要在
 * config 的 REPEATABLE 里加一条，不用改这里。
 *
 * 这也是 SPEC 判据 P7 的体现：纯乘法链上因子位置无关，
 * 所以「作用在物质产出上的所有乘法升级」可以合成一个乘积。
 */
export function kindProduct(state, kind) {
  let m = D(1);
  for (const cfg of Object.values(REPEATABLE)) {
    if (cfg.kind !== kind) continue;
    const lv = levelOf(state, cfg.id);
    if (lv.lte(0)) continue;
    m = m.mul(Decimal.pow(cfg.effect, lv));
  }
  return m;
}

/** 计数频率里由可重复升级贡献的加法项：1 + Σ(k·等级) */
export function countFreqAddTerm(state) {
  let extra = D(1);
  for (const cfg of Object.values(REPEATABLE)) {
    if (cfg.kind !== "countFreqAdd") continue;
    extra = extra.add(levelOf(state, cfg.id).mul(cfg.effectPerLevel ?? 0.05));
  }
  // ★ cm2：计数频率每级系数翻倍（0.05 -> 0.10）⇒ 把"超出 1 的部分" ×2
  if (hasCollapse(state, "cm2")) extra = D(1).add(extra.sub(1).mul(2));
  return extra;
}

/**
 * **全局加成** = 梦想点项 × 计数频率项 × 暗能量项
 *
 * 它同时喂 `entropyRate` 与 `matterRate`（等于乘在环的两端），所以是**真·全局**：
 * 顶部有一个专门的「全局加成」槽显示这个乘积和它的三个因子（见 ui.js）。
 *
 * ⚠️ 命名歧义（踩过的坑）：`REPEATABLE.particleBoost` 那条升级叫「计数频率」，
 *    它只是这个乘积里的**一个因子**。别把两者混为一谈。
 *
 * ★ 原稿的 bug：算了 `dreamCoefficient` 但下面硬编码 0.02，导致 v4 完全无效。
 *   这里真的用它。
 */
export function globalMultiplier(state) {
  const dp = state.dreamPoints;
  const base = D(1).add(dp.mul(dreamCoefficient(state)));
  const total = base
    .mul(countFreqAddTerm(state))
    .mul(darkEnergyMultiplier(state));
  // ★★★ 2025（`docs/NEKO.md` §7 / §10）：**好感度 ⇒ 全局加成 ^指数**
  //   · 三档（>25 / >50 / >75）叠乘 ⇒ 指数 ∈ [1, 1.0221151]
  //   · 好感度为负 / 未达门槛 ⇒ 指数恒 1（**负面不影响游戏进程** ✓）
  //   · 幂运算必须走 `Decimal.pow`（`Math.pow` 在 1e308 量级会 Infinity ⇒ 本项目踩过 ✓）
  //   · 安全余量已论证（NEKO.md §7）：环增益 0.7263 → 0.7423，仍 < 1 ✓
  const nekoExp = nekoGlobalExponent(state);
  return nekoExp === 1 ? total : Decimal.pow(total, nekoExp);
  // ⚠️ 量子**不在这里**。
  //
  //   曾经把它放进 globalMultiplier（想让它「更全面」），但那是**最爆炸的乘区**：
  //   globalMultiplier 同时喂 entropyRate 和 matterRate，等于乘在环的两端，
  //   环增益拿到的是 Q² 而不是 Q。
  //
  //   实测（玩家反馈 + 隔离对照）：
  //     物质 1e27   有量子 2088s   无量子 4707s   -> 解锁瞬间给了约 52 倍加速
  //   而用户的原则是：**量子给的乘区不应该让物质一次跳到无限**。
  //
  //   现在量子作用在 entropyRate（单条产线），环增益只拿 Q。
}

/**
 * 全局加成的**分解**（顶部「全局加成」槽显示用）。
 *
 * 接口放在这里而不是 ui.js：显示必须来自同一个公式（SPEC「输出函数 == 运算函数」），
 * 否则又会出现「显示 ≠ 实际」。
 *
 * ★ 2025：加了好感度那一层**指数** ⇒ 分解里必须带上它，否则
 *   `dream × countFreq × de ≠ total`（三因子相乘再取幂）⇒ 显示会自相矛盾 ✗
 *   ⇒ 返回 `nekoExp`（1 = 未生效）与 `base`（取幂**之前**的乘积），
 *      让 UI 能显示 `base ^nekoExp` 这个**完整**表达式 ✓
 */
export function globalMultiplierParts(state) {
  const dream = D(1).add(state.dreamPoints.mul(dreamCoefficient(state)));
  const countFreq = countFreqAddTerm(state);
  const de = darkEnergyMultiplier(state);
  const base = dream.mul(countFreq).mul(de);
  const nekoExp = nekoGlobalExponent(state);
  const total = nekoExp === 1 ? base : Decimal.pow(base, nekoExp);
  return { dream, countFreq, de, base, nekoExp, total };
}

// ══════════════════════════════════════════════════════════
// 第四层：量子涨落 / 大坍缩
// ══════════════════════════════════════════════════════════
//
// ★ 原来的「临界坍缩阶梯」（阈值 ×1e5 递进 -> 暗物质 -> 10^DM）已整个删除。
//   它是「阶梯 3 秒」的形式性元凶：`10^DM` 把曲线平移了 1e560 个数量级。
//   现在第三层是**量子涨落**，由它提供指数成长速率（见 quantumGrowthRate）。
//
//   `collapseUnlocked` 保留原名（改名会波及 state/UI/工具），但语义已经变成
//   「**量子涨落是否已解锁**」—— 就是 `peakMatter >= 1e25`。

/** 第三层（量子涨落）是否已解锁 */
export function collapseUnlocked(state) {
  return state.peakMatter.gte(COLLAPSE.unlockMatter);
}

/** 能不能大坍缩（物质到双精度上限） */
export function canBigCrunch(state) {
  return collapseUnlocked(state) && state.resources.matter.gte(crunchThreshold());
}

/**
 * 大坍缩能拿多少无限点（**唯一数据源**：界面显示与引擎实际发点都必须走这里）。
 *
 * ⚠️ 踩过的坑：`doBigCrunch` 曾经自己算 `infinityPointGain × 3^①`，**没走这个函数** ——
 *    于是"显示"与"实发"会脱节（我加铸币倍率后立刻发生：界面乘了铸币、引擎没乘）。
 *    现在引擎直接 `const ip = bigCrunchGain(state)`，并由
 */
export function bigCrunchGain(state) {
  const ipMult = ipDoubleMult(state);
  // ① 的加成（3^等级） → 铸币倍率 → 量子铸币的额外点数
  // ★★ 2025：再乘 **em5**（永恒里程碑 5：永恒点倍增无限点 —— `1 + log10(累计EP)`）。
  //   放在**最外层**：它是"最终乘区"语义，乘在所有 IP 来源之后（与 ① 同一位置）✓
  // ★★★ 2025（用户裁定）：**量子 → IP 的加成也吃引擎倍率**（5 条量子加成之一）
  //   `engineBonusMult = costGrowth^引擎等级` ⇒ 买一级 ⇒ 价格 ×1.87、这条 ×1.87 ⇒ 同速 ✓
  return infinityPointGain(state.resources.matter, state.brokenInfinity, state)
    .mul(ipMult)
    .add(quantumToIPGain(state).mul(engineBonusMult(state)))
    .mul(em5IpMult(state));
}

// ══════════════════════════════════════════════════════════
// ZPE
// ══════════════════════════════════════════════════════════

/**
 * ZPE 倍率。
 *
 * 原稿：`1 + 0.1 × log10(ZPE+1)` —— 太弱（ZPE 从 1e10 到 1e100，倍率只从 ×2 到 ×11）
 * 现在：`(ZPE+1)^ZPE_EXPONENT`，其中 `ZPE_EXPONENT = 0.02`（**别写成 0.05，那是候选值**）。
 *     `1e10 → ×1.58`、`1e30 → ×3.98`、`1e100 → ×100`。
 *     0.02 是**刻意贴近原稿**的：在 1e30 处与原稿几乎相等，早期还略弱一点。
 *
 * ⚠️ 这个指数是**自反馈**的源头：ZPE 越高 → 倍率越高 → 产出越快 → ZPE 更高。
 *    它（以及它在 `zpeRate` 里被乘了几次）决定 ZPE 随时间是线性还是超线性增长 ——
 *    见 tools/zpe-engine-lab.mjs 的 `a < 1` 安全线。
 *
 * 用 `ZPE+1` 而不是 `ZPE`，是为了 ZPE=0 时得到 1 而不是 0。
 */
export function zpeMultiplier(state) {
  const z = state.zpe.gt(0) ? state.zpe : D(0);
  // ★ 2025：① 不再抬指数（旧的  已删除；指数恒为 ZPE_EXPONENT ✓）
  const exp = ZPE_EXPONENT;
  let m = z.add(1).pow(exp);
  // ① 加法区：`m += 等级 × addPerLevel`（与「零点耦合」同一写法）
  m = m.add(zpeEngineAddBonus(state));
  // ②b 乘算：`m ×= 2^等级`
  m = m.mul(zpeEngineMultBonus(state));
  // ★ 2025 设计稿修订：③ 改成**量子对 zpe 倍率的加成**（用户改）
  //
  //   为什么换掉原来的「暗能量倍率 ^1.03」：
  //     它把**暗能量倍率**塞进了 zpeMultiplier，而暗能量倍率依赖暗能量总量、
  //     暗能量又由相变仪从 ZPE 产出 ⇒ 它在**同一个 tick 里会变** ✗
  //     ⇒ 显示（瞬时快照）与实发（整步）用了不同时刻的值 ⇒ 实测 6% 偏差（consistency 抓到 ✗）
  //     （判别实验：关掉它 ⇒ consistency 立刻全绿 ✓；关掉 ④ ⇒ 仍红 ✗ ⇒ 元凶是它）
  //   换成**量子**的加成后：走**加法区**（与 darkEnergyMultiplier 里 `+q²` 同一形制 ✓），
  //     加法项的**相对**漂移极小 ⇒ 不再破坏"显示 == 实发" ✓
  // ⚠️ **暂时关闭**（2025）：`量子 → zpe 倍率` 这条一旦接上，`consistency` 会报
  //    物质 41% 偏差 ✗ —— 根因不是这条设计本身，而是**引擎取值时机**：
  //    `advance` 按 5 秒切 chunk，每 chunk 重算因子；量子是**阈值跳变**量
  //    ⇒ 后段 chunk 用的是跳变后的 q、而界面显示的是起始 q ⇒ 分叉 ✗
  //    ⇒ 修法是「步首快照」（把因子**传进** tick，而不是覆盖 state ✗），
  //      那需要一个专门的小重构 ⇒ 落成前这一行保持关闭 ✓
  // ⚠️ **关闭**（2025）—— 我试了三种修法（跨 chunk 快照 / 步末结算 / 步首结算），**三种都失败** ✗✗✗
  //   实测（`consistency.mjs` 物质那条）：
  //     未接线        ⇒ 全绿 ✓
  //     + 跨 chunk 快照 ⇒ 仍红（该测试**直接调 tick**，不走 advance ⇒ 快照用不上 ✗）
  //     + 步末结算     ⇒ 仍红 97.8%（捕获落在被测量的那一步里 ✗）
  //     + 步首结算     ⇒ 更坏：四条速率全 100% 偏（"待结算"在测量前就落到 state 里 ✗）
  //   ⇒ 三个假设全错 ⇒ **停止猜测** ✗
  //   ⇒ 正确下一步：**先打点**（把测量前后/步首步末的 q、zpeMultiplier、zf、matterCoeff 全打出来），
  //      看清差在哪一层再动 ✗ —— 而不是继续猜 ✓
  //   ⚠️ 另注：`qOf(state)` + `state.quantumFrozen` 的快照（`advance` 用）是**无害的改进** ✓ 已保留 ✓
  // ★ 2025 状态：**设计已确认可行，卡在"加成数量"上** ✗
  //   打点定位后的结论：
  //     · 之前 97.8% 的"显示≠实发"**与量子无关** ✗ —— 是 `consistency` 拿"瞬时速率"
  //       和"整步闭式解"比（`1 + c·dt/(2P0)`）✗；改成 dt=1e-7 后**速率 8/8 全一致** ✓
  //     · 但接上 `+q³` 后，另外 3 条暗能量检查变成 0.00% ✗：
  //       该场景 q≈16 ⇒ `+q³ = 4096`，而 ZPE 倍率基础只有 ≈12 ⇒ 量子项大 340 倍
  //       ⇒ **把暗能量升级的效果淹没了** ✗（高效相变 / 相变增幅 / 凝聚斜率 都看不出变化）
  //   ⇒ 所以这条设计的**落点没问题** ✓，要定的是**系数**（用户：得算数据 ✓）
  //     候选见 `quantumZpeMultBonus`：+q²（温和）/ +q³（强势，会压过暗能量层 ✗）/ 2^q（✗ 不推荐）
  // ★★★ 2025（用户裁定）：量子的 ZPE 加法项也吃引擎倍率（5 条之一）
  m = m.add(quantumZpeMultBonus(qOf(state), engineBonusMult(state)));   // ★ 系数 0.1（q³/10）
  if (state.zpeFixedMultiplier) m = m.mul(state.zpeFixedMultiplier);
  if (hasVoid(state, "v8")) m = m.mul(1.5).mul(voidBoostMult(state));
  // ★ dm1「ZPE 倍率 ×2」。
  //
  //   原来这条里程碑靠 `state.zpeFixedMultiplier` 传递，但**没有任何代码
  //   往那个字段里写值** —— 效果对象 `{kind:"zpeFixedMultiplier"}` 没有处理器。
  //   所以 dm1 从移植起就是**死的**（探针实测：切换 dm1 标记，zpeRate 完全不变）。
  //
  //   现在改成直接检查里程碑标记，和 dm2/dm3/dm5/dm4b 的写法一致，
  //   数值从 DE_MILESTONES 读（单一数据源，不抄）。
  const dm1 = DE_MILESTONES.find((x) => x.id === "dm1");
  if (dm1 && hasDe(state, "dm1")) m = m.mul(dm1.effect.value);
  // ★ ∞ 层 ②「零点耦合」：无限点数量加进 ZPE 倍率的**加法区**（a区）
  //   ⚠️ 位置是加法：`m = m + 1×IP`，不是乘。它会被后面引擎那类"最终加成"再乘一遍。
  if (state.ipToZpeBought) {
    m = m.add(D(INFINITY_UPGRADES.ipToZpe.perIp).mul(state.infinityPoints ?? 0));
  }
  // ★ ZPE 引擎 ③：让 ZPE 倍率**吃「计数频率」加成**（用户原案第三条）。
  //
  //   位置说明（乘区）：落点仍然是 **ZPE 倍率**（蓝色），计数频率是**跨乘区的输入**。
  //   效果：计数频率对 ZPE 产出的指数从 2.00 → 3.74（因为倍率在产出里出现 ~1.74 次）。
  //   它安全的原因：计数频率是**仿射**项（1+0.05×等级），随资源只按对数增长，
  //   所以不会把自反馈指数 a 顶上去（见 docs/ZPE-ENGINE.md 第 4 节）。
  if (zpeEngineCountFreqUnlocked(state)) {
    m = m.mul(countFreqAddTerm(state));
  }
  return m;
}

/**
 * ZPE 产出倍率。
 * v1 给 ×3，且「每拥有一个虚空升级 +1000%」（即 ×(1+10n)），买齐 9 个共 ×273。
 * v6 再给 ×5。
 */
export function zpeBaseMultiplier(state) {
  let b = D(1);
  if (hasVoid(state, "v1")) {
    b = b.mul(3);
    const count = Object.values(state.voidUpgrades).filter(Boolean).length;
    b = b.mul(D(1).add(D(count).mul(10)));
  }
  if (hasVoid(state, "v6")) b = b.mul(5).mul(voidBoostMult(state));
  return b;
}

/**
 * 暗能量对 ZPE 产出的惩罚。返回的是「乘数」，越小惩罚越重。
 *
 * ── 两处修正（原稿问题）──
 *
 * ① **指数 1.5 -> 0.5**（方案 B）
 *    原稿是 `1/(1 + 0.001 × DE^1.5 × (1−减免))` —— 惩罚**超线性**，
 *    而暗能量的唯一来源就是 ZPE。于是它掐住自己的水管，形成死亡螺旋：
 *        暗能量 1e0  -> 1.00e-6/秒
 *        暗能量 1e4  -> 3.65e-9/秒
 *        暗能量 1e10 -> 9.31e-18/秒     ← 单调递减
 *    改成 0.5 次方后，惩罚是**次线性**的，而全局加成是指数增长，
 *    所以获取速度会重新转正。
 *
 * ② **加下限**（方案 B 附带）
 *    保证 ZPE 永远不会被完全掐死（否则一旦踩进螺旋就没救）。
 *
 * ③ **减免曲线平滑化**（方案 C）
 *    见下面 reduction 的注释。
 */
export function zpeProductionPenalty(state) {
  const de = state.darkEnergy;
  if (de.lte(0)) return D(1);
  const lv = deLevelOf(state, "dreamAnnihilation");

  // ★ 方案 C（改）：减免 = 等级 / 满级 —— 线性、平滑，**满级正好 100%**
  //
  //   原稿是 `min(等级,3)/3`：3 级拉满，4~10 级完全无效，
  //   而且 0/1/2 级几乎没感觉、第 3 级突然跳 10 个数量级。
  //
  //   先用了几何曲线 `1−0.85^等级`，但 10 级只到 80.3%，**惩罚还在**。
  //   用户指出：原稿的设计意图是「暗能量升级满级后不再有 ZPE 削弱倍率」。
  //   所以改成线性 —— 每级 10%，第 10 级正好 100%，惩罚彻底归零。
  const maxLv = DE_UPGRADES.dreamAnnihilation.maxLevel ?? 10;
  const reduction = Decimal.min(lv, D(maxLv)).div(maxLv);

  // ★ 方案 B：总系数 0.001 × DE^0.5（原来是 DE^1.5）
  const total = D(DE_PENALTY.coeff).mul(de.pow(DE_PENALTY.exponent)).mul(D(1).sub(reduction));
  const penalty = D(1).div(D(1).add(total));

  // ★ 下限：ZPE 永远不会被完全掐死
  return Decimal.max(penalty, D(DE_PENALTY.floor));
}

// ══════════════════════════════════════════════════════════
// 暗能量
// ══════════════════════════════════════════════════════════

/**
 * 暗能量倍率。
 *   x = log2(DE + 1)
 *   系数 = min(0.1 + x/20 × 0.15, 0.25)     展开后是 1 + 0.1x + 0.0075x²
 *   倍率 = (1 + x × 系数) × 1.1^真空加速等级
 *
 * 前期线性、中期二次、后期线性 —— 平滑的分段强度曲线。
 */
export function darkEnergyMultiplier(state) {
  // ⚠️ 用 **darkEnergyTotal（历史总量）**，不是 darkEnergy（当前余额）。
  //
  // 踩过（用户报告：「买凝聚斜率后 1熵=N粒子 反而变小」）：
  //   阈值 = (100+3n) / ZPE倍率 / 【暗能量倍率】
  //   而 deMult 原来读**余额**。花暗能量买升级 -> 余额降 -> deMult 降
  //   -> 阈值升 -> 转换率降。实测：
  //       花费占余额  8%  -> +3.36%
  //       花费占余额 41%  -> +0.67%
  //       花费占余额 55%  -> ❌ -2.53%
  //       花费占余额 82%  -> ❌ -12.49%
  //   即「买升级反而变弱」——升级给的产出增量是固定绝对值，打不过余额损失。
  //
  //   darkEnergyTotal 从不被坍缩/大坍缩重置，所以「累计产出过多少」才是
  //   奖励的正确语义。这也是 dm5 里程碑同一个坑（那边已修）。
  //
  // 注意「双刃」的另一半**故意保留**：zpeProductionPenalty 仍然看余额 ——
  // 「囤着不用伤 ZPE」这个惩罚是有意设计，不该一起改掉。
  const de = state.darkEnergyTotal.gt(0) ? state.darkEnergyTotal : D(0);
  const x = de.add(1).log2();
  const coeff = Decimal.min(D(0.1).add(x.div(20).mul(0.15)), D(0.25));
  // ★ 量子：作为**基础加成**加进括号里（a区），量是 q²。
  //   `暗能量倍率 = (1 + 0.25·log2(暗能量)) + q²`
  // ★★★ 2025（用户裁定）：量子这项也吃引擎倍率（5 条之一）
  // ★★★ 2026：「永恒之后」第一块 —— 暗物质的转化值**加进同一个加法池**（与 q² 同形制）。
  //   未解锁 / n = 0 ⇒ 恰好 0 ⇒ **零回归** ✓
  //   ⚠️ 它是**加法区常数项** ⇒ 不进 `computeS`（那只统计可重复乘法升级），
  //      且常数只在 `∂ln(倍率)/∂ln(DE)` 的**分母**里 ⇒ 引擎环增益**下降** ⇒ 更安全 ✓
  const base = D(1).add(x.mul(coeff))
    .add(quantumDeMultBonus(qOf(state), engineBonusMult(state)))
    .add(darkMatterAdditiveTerm(state));
  const accel = Decimal.pow(
    dreamUpgradeEffects(state).vacuumAccelEffectMult,
    deLevelOf(state, "vacuumAccel"),
  );
  // ★ 2025 设计稿第 4 条：**ZPE 引擎提供的倍率也作用在暗能量倍率上**。
  //   ⇒ 与第 3 条（`暗能量倍率 ^1.03 → ZPE 倍率`）**闭合成环** ✗
  //   环增益验算见 `tools/zpe-engine-lab.mjs`：因为 `暗能量倍率 ∝ log2(暗能量)`（对数 ✓），
  //   所以 `∂ln(DE倍率)/∂ln(DE)` 极小 ⇒ 整环增益 ≈ 1e-3 量级 ⇒ **安全** ✓
  //   ⚠️ 但引擎等级不设上限时它会跟着 2^等级 一起膨胀 ⇒ **上限权在用户手里**（设计稿保留 ✓）
  return base.mul(accel).mul(zpeEngineMultBonus(state));
}

/** 每转换一次得到多少暗能量 */
export function darkEnergyGainPerConversion(state) {
  const d = dreamUpgradeEffects(state);
  let g = Decimal.pow(d.phaseShiftEffectMult, deLevelOf(state, "phaseShift"))
    .mul(d.phaseShiftBaseMult)
    // ★ 新增「相变增幅」：基础暗能量获取的乘法区
    //   ★★★ 2026：倍率改走 `deGainBaseEffectMult(state)` —— **em4「优化暗能量获取公式」的唯一入口**
    //   （em4 前 = 1.10，em4 后 = 1.12；**不许**在这里直接读 `DE_UPGRADES.deGainBase.effectMult` ✗）
    .mul(Decimal.pow(
      deGainBaseEffectMult(state),
      deLevelOf(state, "deGainBase"),
    ));
  if (hasDe(state, "dm5")) g = g.mul(darkEnergyMultiplier(state));
  // ★ 量子：作为**基础加成**加进括号里（a区），量是 log10(q)。
  //   `每次转换量 = ... × [1 + log10(q)]`
  // ★★★ 2025（用户裁定）：量子这项也吃引擎倍率（5 条之一）
  return g.mul(D(1).add(quantumDeGainBonus(qOf(state), engineBonusMult(state))));
}

// ══════════════════════════════════════════════════════════
// 熵阱
// ══════════════════════════════════════════════════════════

/**
 * 实际生效的熵阱数量。
 *
 * m4「ZPE 倍率影响熵阱实际生效数量」—— 放大**数量**。
 *
 * ⚠️ 量子**不在这里**，也**不在 zpeRate 里**（这里原先写「ZPE 产出倍率 ×(1+log10 量子数)
 *    只进 zpeRate」，那是更早一版的模型，已经不存在了）。量子现在一共 4 条作用：
 *      entropyRate            ×(1+q)          -> **c区**（最终倍率，作用在增量上）
 *      darkEnergyMultiplier   +q²（加法池）    -> a区
 *      darkEnergyGainPerConversion ×(1+log10 q) -> a区
 *      matterRate / tick      M×R(q)×ln10      -> 等价写法的 **b区**（见 engine.js）
 *    所以「ZPE / 暗能量涨不动、物质照样指数到 e308」是结构性的，不是显示问题。
 */
export function effectiveTraps(state) {
  let t = state.resources.traps;
  if (hasZpe(state, "m4")) {
    const bonus = hasV9(state) ? 2 : 1;
    t = t.mul(D(1).add(zpeMultiplier(state).mul(bonus)));
  }
  return t;
}

// ══════════════════════════════════════════════════════════
// 各产线速率（每秒）
// ══════════════════════════════════════════════════════════

/**
 * ★★★ 2025：**物质系数（唯一入口）** —— `dM/dt = particle × matterCoeff(state, particle)`
 *
 * ── 为什么搬到 formulas.js ──
 *   它原来在 `engine.js`，而 `matterRate()`（显示侧）在这里**各算一遍基础产出** ⇒
 *   两处极易分叉。项目已因此踩过 **4 次「显示 ≠ 实发」**：
 *     ① 铸币倍率只在界面生效
 *     ② `dm4b` 只加在 `darkEnergyRate()`
 *     ③ 沉潜蓄能只加在 `matterRate`
 *     ④ **2025 本轮**：`v3` 那里写裸 `D(1.5)`、`matterRate` 写 `D(1.5)×voidBoostMult`
 *        ⇒ 引擎 17 级时显示比实发大 **2.09e6**（再被 `^k` 放大）✗
 *   ⇒ 根治：**两边共用这一个函数**（`formulas.js` 里早先留的"理想解"注释，本次落实）✓
 *
 * ── 过载 / 爬升的落点 ──
 *   用户裁定「**有且只影响获得速率**」⇒ 两个因子乘在**系数**上：
 *     · 只改 `dM/dt`，不改物质存量、不改阈值 ✓
 *     · `matterRate` 读同一函数 ⇒ 显示 == 实发 ✓
 *
 * @param {object} state
 * @param {Decimal|number|null} particleCount 粒子数。
 *   ⚠️ **默认取 `state.resources.particle`** —— 因为「系数」按定义就是**完整**系数
 *     （含过载/爬升）。若默认给 null，`matterCoeff(state)` 与 `matterRate(state)` 就会
 *     给出不同的值（实测差 8.18e17）⇒ 又变成"两处各算一遍" ✗
 *     tick 里传**本片的 `P0`**（此刻 `state.resources.particle` 还是旧值）。
 */
export function matterCoeff(state, particleCount = undefined) {
  const P = particleCount === undefined
    ? (state.resources?.particle ?? null)
    : particleCount;
  const mb = kindProduct(state, "matterMul");
  let zf = D(1);
  if (state.zpeMilestones.m3) {
    const factor = state.voidUpgrades.v9 ? 1.0 : 0.5;
    zf = D(1).add(zpeMultiplier(state).sub(1).mul(factor));
  }
  const v3 = state.voidUpgrades.v3 ? D(1.5).mul(voidBoostMult(state)) : D(1);
  const coeff = D(BASE.matterPerParticle)
    .mul(mb)
    .mul(globalMultiplier(state))
    .mul(zf)
    .mul(v3)
    // ★★ 2025 B8：**b区** —— 对 a区括号整体取幂，指数由引擎等级给
    .pow(matterTotalExponent(state))
    // ★ 跨度层在**指数之外**：它是"第二路产物质"（ZPE→DE→物质）的独立机制
    .mul(matterSpanMult(state));

  //   ⚠️ 过载的触发量是「**未经削减的速率**」= `particle × coeff`
  //      （若用削减后的速率去触发 → 自我引用 ⇒ 恒为 1 或来回抖 ✗）
  const preRate = P != null
    ? (P instanceof Decimal ? P : D(P)).mul(coeff)
    : null;
  return coeff.mul(overloadFactor(state, preRate)).mul(climbFactor(state));
}

/** 熵产出速率 */
export function entropyRate(state) {
  const v2 = hasVoid(state, "v2") ? D(1.5).mul(voidBoostMult(state)) : D(1);
  let r = effectiveTraps(state)
    .mul(globalMultiplier(state))
    .mul(BASE.trapBaseRate)
    .mul(zpeMultiplier(state))
    .mul(v2)
    // ★ 量子：作用在**熵产出**这条单线上（不是全局加成）。
    //   理由见 globalMultiplier 的注释 —— 放全局加成等于乘在环的两端，
    //   环增益会变成 Q²，物质会一次跳到无限。
    // ★★★ 2025（用户裁定）：量子→熵 也吃引擎倍率（5 条之一）。
    //   ⚠️ 它会让"引擎 → 熵 → 物质"多一条路径 ⇒ 由 `consistency` 与
    //      `zpe-engine-lab` 的环增益断言守（跑完必看）。
    .mul(quantumEntropyMultiplier(qOf(state), engineBonusMult(state)));
  if (hasDe(state, "dm3")) r = r.mul(darkEnergyMultiplier(state));
  return r;
}

/**
 * 物质产出速率（依赖当前粒子数）。
 *
 * ⚠️ **必须包含量子那一段指数项** —— 引擎里 `tick` 的公式是它加上这一项。
 *    这条是「输出函数 == 运算函数」的硬约束：我在引擎里加了项却没加在这里，
 *    `consistency.mjs` 立刻报「物质速率误差 82.74%」。
 */
export function matterRate(state) {
  // ══════════════════════════════════════════════════════════
  // ★★★ 2025：**改为唯一入口的直接调用** —— 不再在这里重算一遍基础产出
  // ══════════════════════════════════════════════════════════
  //   `dM/dt = particle × matterCoeff` ⇒ 这里就**只做这一次乘法** ✓
  //
  //   ⚠️ 为什么不再展开：本函数原来把 `base = particle × 每粒子各项 × …` **重算了一遍**，
  //      与 `matterCoeff` 那套"各算一遍"⇒ 项目因此踩过 **4 次「显示 ≠ 实发」**
  //      （最近一次：`v3` 少了 `voidBoostMult` ⇒ 差 2.09e6 ✗；再往前是沉潜蓄能 / dm4b / 铸币）
  //   ⚠️ 我第一版改错：写成 `total.mul(matterCoeff(state))` —— 而 `total` **已含粒子数**
  //      （它是速率），再乘「每粒子系数」⇒ 变成 `particle² × coeff`，量纲错 ✗
  //      （实测比值 8.18e17 = particle × 2.09e6）
  //
  //   过载 / 爬升的软上限**在 `matterCoeff` 内**（用户裁定：有且只影响获得速率）✓
  return state.resources.particle.mul(matterCoeff(state));
}

/**
 * 爬升形状因子（路线 1）：`2^(−(L − knee)/halvingOrders)`，L ≤ knee 时恒为 1。
 *
 * 为什么需要它：物质的末端增长是 `dM/dt = M·R(q)·ln10`，即 `d(log10 M)/dt = R(q)` ——
 * **斜率恒定 = 直线**。玩家看到的是"每 25 阶一样慢"的节拍器。
 * 这个因子让 R 随深度递减，整条线变成 `L = knee + D·log2(1 + ln2·R₀·t/D)`，即 **log 形**。
 *
 * ⚠️ 与 `overloadFactor` 的区别：过载**只在打破无限之后**生效（管"越过旧硬顶能推多深"），
 *    爬升形状**任何阶段都生效**（管"这段爬升长什么样"）。
 * ⚠️ 必须被 `matterRate` 和 `tick` 同时使用（SPEC「输出函数 == 运算函数」）。
 */
export function climbFactor(state) {
  const L = state.resources.matter.gt(0) ? state.resources.matter.log10() : D(0);
  if (L.lte(CLIMB.knee)) return D(1);
  const over = L.sub(CLIMB.knee).toNumber();
  if (!(over > 1e-9)) return D(1);              // 拐点死区，避免 log10/pow 往返误差
  // ★★★ 2025 同 `overloadFactor` 的修正：**等效斜率必须与 k 无关**。
  //   它也**在 a区 内**（`matterRate` 里与 overload 相乘，再整体被 `^k` 取幂）
  //   ⇒ 不补偿的话，k=13.86 时 `2^(−over×13.86/100)`：
  //       M=1000（over=975）⇒ 2^−135 ≈ 1e−41 ⇒ 同样是"产出为 0" ✗
  //   ⇒ 步长按 k 放大，使有效斜率恒为 `CLIMB.halvingOrders`（100 阶）✓
  const kExp = Number(matterTotalExponent(state));
  const kScale = Number.isFinite(kExp) && kExp > 1 ? kExp : 1;
  const effHalving = CLIMB.halvingOrders * kScale;
  // ★★ 同 `overloadFactor`：用 **`Decimal.pow`**（`Math.pow` 会在 number 域下溢成 0 ✗）
  return new Decimal(2).pow(-over / effHalving);
}

/**
 * ★★★ 2025（用户裁定）：**过载的触发条件是「基础物质获得速率 > 1.8e308」，不是物质数量**。
 *
 * ── 用户原话 ──
 *   「过载机制生效的时间应该在**基础物质获得速率大于 1.8e308** 时生效
 *     （**有且只影响获得速率**）」
 *
 * ── 为什么这样才自洽 ──
 *   物质是 Decimal（可到 1e9e15），**没有** 1.8e308 这个上限；
 *   而 `Number.MAX_VALUE = 1.8e308` 是**双精度的上限** —— 它卡的是"每秒获得多少"，
 *   也就是**速率**。所以过载的语义应当是「速率逼近双精度上限时开始收」，
 *   而不是「物质数量跨过某个深度」。旧实现用 `matter.log10() > 拐点` ⇒ 触发点与速率无关 ✗
 *
 * ── 「只影响获得速率」怎么保证 ──
 *   落点放在 `engine.js` 的 `matterCoeff()`（tick 积分用的系数）里 ⇒
 *     · 它只乘进 `dM/dt`，**不改物质存量、不改阈值、不改任何"数量"**
 *     · `matterRate` 也读同一个 `matterCoeff` ⇒ 显示与实发同源（不再各乘一次）✓
 *
 * @param {object} state
 * @param {Decimal|number} baseRate  **未**被过载/爬升削减的物质获得速率
 */
export function overloadFactor(state, baseRate) {
  if (!state.brokenInfinity) return D(1);      // 未打破：硬顶，不走软上限
  const rate = baseRate == null
    ? D(0)
    : (baseRate instanceof Decimal ? baseRate : D(baseRate));
  // ★★ 触发阈：双精度上限 `Number.MAX_VALUE = 1.8e308`（**速率**上限，不是数量上限）
  //
  //   ⚠️ **必须在对数域比较**：物质的获得速率是 Decimal，实测 168h 已达 **1e1943**
  //     ⇒ 若写 `OVERLOAD.rateThreshold.log10()`，那是 `(1.8e308).log10() = 308.25`（没问题）；
  //       但若写 `rate.toNumber()` 或对 rate 取 `Number(...)`，**1e1943 会溢出成 Infinity**，
  //       一切比较都失真 ✗（我第一版就踩了这个：阈值判定恒为"超阈"）
  //   ⇒ 用 `rate.log10()`（Decimal 的 log10 是安全的）与**预先算好的常数量级**比较 ✓
  const rateLog = rate.gt(0) ? rate.log10() : D(0);
  if (rateLog.lte(OVERLOAD.rateThresholdLog10)) return D(1);
  const over = rateLog.sub(OVERLOAD.rateThresholdLog10).toNumber();
  if (!(over > 1e-9)) return D(1);

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 二次重做（用户裁定方案 B）：**渐近式**
  // ══════════════════════════════════════════════════════════
  //  用户质疑：「虽然是仿照 AD 中复制器的增长削弱逻辑，但**为什么能变成负增长**呢？」
  //  ⇒ 完全正确。根因是可算的：
  //
  //    `rate = base × factor(over)`，令 `s = |d ln(factor)/d over|`
  //    则 `d ln(rate)/d ln(base) = 1/(1 − k·s)`（k = 引擎的 b区指数）
  //    ⇒ **硬约束 `k·s < 1`**；越界则速率随 base 上升而**下降** = 负增长 ✗
  //
  //    旧指数式 `factor = 1.2^(−over/2.63)` 配 `tierShift`
  //      ⇒ `s = (ln1.2/2.63)·(1 + 0.25·档数)` —— **随档数无上界增长**
  //      ⇒ 实测 over=5000 时 `s = 8.72`、`k·s = 120` ≫ 1 ⇒ 必然负增长 ✗
  //
  //    渐近式 `factor = 1/(1 + over/knee)^p`
  //      ⇒ `s = (p/knee)/(1 + over/knee)` —— **随 over 递减**（在 over=0 取最大 `p/knee`）
  //      ⇒ 只要 `p/knee < 1/k` 就**永远**不越界（与 over 无关）⇒ **结构性安全** ✓
  //        本配置：`p/knee = 1/8430 = 1.19e-4`，`k` 上限 26 ⇒ `k·s ≤ 0.0031` ≪ 1 ✓
  //
  //  ⚠️ 语义差别（这是"变少"与"变慢"的分界）：
  //    AD 的 `scaleFactor = 1.2 > 1` 乘在 **interval**（时间）上 ⇒ 只让**变慢**
  //    我们曾把 `1/1.2 < 1` 乘在 **rate** 上 ⇒ 会让**变少**（可净下降）
  //    渐近式把因子压成"有下界、极缓"的形状 ⇒ 速率与 base **同阶增长** ⇒ 回到了"变慢" ✓
  //
  //  `knee = 8430` 的依据：用户要求「推进到 1e308.25 不费更多时间」。
  //    实测该点（11.13h）`over = 443.7` 阶 ⇒ 要因子 ≈ 1 就得 `knee ≫ 443.7`；
  //    目标「最多慢 5%」（因子 ≥ 0.95）⇒ `knee ≥ 443.7 × 0.95/0.05 = 8430` ✓
  const p = OVERLOAD.p ?? 1;
  return new Decimal(1).div(new Decimal(1).add(over / OVERLOAD.knee).pow(p));
}

/**
 * ★ 2025：**"这一轮跑够了"的单一判据**（自动坍缩 / 模拟器 / 界面提示共用）。
 *
 * 为什么必须有它：判据原来是**硬编码 `overloadFactor(s) < 0.05`**，散落在
 *   `tools/stage-timing.mjs`（两处）等处。而 `0.05` 与过载强度是**强耦合**的：
 *   过载一旦放松（因子变小 / 步长变大 / 开累进），这个值就可能**永远到不了**
 *   ⇒ 自动坍缩永不触发 ⇒ 模拟与玩法一起卡死 ✗
 * ⇒ 阈值改放 `OVERLOAD.crunchBelow`（与过载参数同一个 config 对象），
 *   并由 `tools/overload-lab.mjs` 断言「在合理深度内一定可达」✓
 *
 * ⚠️ 未打破无限时**不适用**（那时是硬顶强制坍缩，见 `tick`）。
 */
export function shouldCrunch(state, baseRate = undefined) {
  if (!state?.brokenInfinity) return false;
  if (!state.resources?.matter?.gt(0)) return false;
  // ══════════════════════════════════════════════════════════
  // ★★★ 2025（用户裁定）：**收手判据改成「按本轮时间」**
  // ══════════════════════════════════════════════════════════
  //   为什么必须挪掉「按速率」这条：
  //     `k`（b区指数）直接放大 rate ⇒ 按 rate 收手时 k↑ ⇒ **更早收手** ⇒ 深度变浅
  //     ⇒ "k 越大 = 越快但收入越低"，方向反了 ✗（实测：k 每 +1 ⇒ 收手深度 −3646 阶）
  //   改成按时间后：k↑ ⇒ 同样时间内推进更深 ⇒ 深度↑ ⇒ 收入↑ ✓ **k 变成纯收益**
  //   ⇒ 这也让用户要的机制成立：「基于最快的一次无限时间」给量子加成
  //     （k↑ ⇒ 更快 ⇒ T_best 更小 ⇒ 加成更高 ⇒ 正反馈，但被"时间上限"钉住 ⇒ 不发散 ✓）
  //
  //   ⚠️ 旧的 rate 判据**保留为兜底**：万一时间上限到不了，仍能把轮次结束掉 ⇒ 不卡死。
  //
  //   ⚠️⚠️ **2026 实测：它根本不是「万一」—— 兜底才是实际生效的那条，而且它承重** ✗
  //     · 实测每次大坍缩 ≈ **35 秒**（< `runSeconds = 300`）
  //       ⇒ 触发的**一直是下面这条 rate 判据**；主判据（按时间）从没到过 ✗
  //       ⚠️ 注意口径：必须只算**破∞之后**那一段（破∞前 `!brokenInfinity` ⇒ 一次坍缩都没有）
  //     · 关掉兜底的实测代价（lab：`tools/dark-matter-lab.mjs --crunchbelow=off`）：
  //         每轮永恒 **5.46h → 10.72h**（破∞时刻几乎不变 4.38h）
  //         ⇒ 慢的**全在「破∞→永恒」那一段**（0.8h → 3.0h）✗
  //     ⇒ 所以**不能删它**（删了尾段没法玩）。
  //     · ⚠️ 但它**不是**"乘区型加成没效果"的元凶 —— A/B 实测：关掉它之后
  //       暗物质的**相对**收益反而**变小**（24.9% → 17.9%，因为基线变长）✗
  //       真正的原因是"落点在生产乘区"本身 ⇒ 见 `docs/DARK-MATTER.md` §3 三/四
  const limit = OVERLOAD.runSeconds;
  if (limit != null && Number.isFinite(limit)) {
    const elapsed = Number(state.runElapsed ?? 0) || 0;
    if (elapsed >= limit) return true;
  }
  // ── 兜底：旧的 rate 判据 ──
  const rate = baseRate !== undefined
    ? baseRate
    : matterRate(state);
  return overloadFactor(state, rate).lt(OVERLOAD.crunchBelow ?? 0.05);
}

/**
 * ZPE 产出速率。
 *
 * ★ 方案 1（用户选定）：**全局加成进两次**。
 *
 *   `zpeRate = 熵阱 × globalMult × globalMult × zpe基础 × prodMult × 惩罚`
 *                        └───────── globalMult² ─────────┘
 *
 * ── 为什么 ──
 *   量子涨落靠「ZPE 跨过门槛」触发，但实测 **ZPE 全程只涨 2.8 个数量级**
 *   （1e12.9 -> 1e15.6），而每次捕获门槛 ×20 = 1.301 个数量级
 *   -> 整局只能多捕 **4 对（8 量子）**，涨得太慢。
 *
 *   两条路对照测过：
 *     · 全局加成再进一次（**乘法**）  -> ZPE 涨 **6.3 阶**，8 对 / 16 量子  ✅
 *     · 暗能量 ×(1+log10 DE)（**对数**）-> ZPE 只涨 3.6 阶，5 对 / 10 量子  ❌
 *   乘法赢 —— 对数形式的加成传不到 ZPE 上（DE 涨得快，但 log 吃掉大部分）。
 *
 *   实测副作用（都是正向）：
 *     阶梯 1.76h -> 1.67h（仍在 1~2h 目标区间）
 *     暗能量 1e22 -> 1e36（ZPE 喂暗能量的自然结果，顺带缓解「暗能量太慢」）
 *
 * ⚠️ **它引入了一个正反馈环**：
 *     量子 ↑ -> 暗能量倍率 +q² -> globalMult ↑ -> zpeRate∝globalMult² ↑
 *           -> ZPE ↑ -> 更多量子 -> …
 *   在**当前步长（×20，整局 16 量子）下实测没有跑飞**。
 *   若将来把门槛步长调小（比如 ×2，可捕 ~21 对 / 42 量子），
 *   `q²` 会大一个量级 —— **必须重新验证环增益，不能想当然。**
 *
 * ── 用户预告 ──
 *   无限之后会解锁一个**重点加成虚空系统**的新系统，届时 ZPE / 量子的定位可能调整。
 *   在那之前保持现状。
 */
export function zpeRate(state) {
  let prodMult = hasVoid(state, "v6") ? zpeMultiplier(state) : D(1);
  if (state.zpeFixedMultiplier) prodMult = prodMult.mul(state.zpeFixedMultiplier);
  return effectiveTraps(state)
    .mul(globalMultiplier(state))
    // ★ 方案 1：全局加成再进一次（见上方说明）
    .mul(globalMultiplier(state))
    .mul(zpeBaseMultiplier(state))
    .mul(prodMult)
    // ★ ZPE 引擎 ②：按**引擎等级**大幅提速 ZPE 产出（`(1 + 0.1×等级)²`）。
    //   等级用无限点买 ⇒ 随时间线性增长 ⇒ 这一项 ∝ t² ⇒ ZPE ∝ t³（越来越快）。
    //   它只改常数速率 c，不碰自反馈指数 a —— 见 docs/ZPE-ENGINE.md。
    .mul(zpeEngineProdMult(state))
    .mul(zpeProductionPenalty(state));
}

/**
 * 实际每次相变转换给多少暗能量（**含 dm4b**）。
 *
 * ⚠️ **必须两边共用这一个函数。**
 *
 * 踩过：dm4b 最初只加在 `darkEnergyRate()` 里，而 engine.js 的实际转换
 * 用的是 `darkEnergyGainPerConversion()` —— 于是 dm4b 变成死代码：
 * 界面上的速率显示变了，**实际产出一点没变**（玩家反馈「还是涨不动」）。
 *
 * 教训：一个效果如果有两条计算路径，它迟早只在一条上生效。
 * 正确做法是让两条路都走同一个函数。
 */
export function effectiveDarkEnergyGain(state) {
  let g = darkEnergyGainPerConversion(state);
  // ★ 里程碑 dm4b：全局加成作用于相变转换速率
  if (hasDe(state, "dm4b")) g = g.mul(globalMultiplier(state));
  return g;
}

/**
 * 暗能量生成速率（每秒）。
 *
 * ★ 里程碑 dm4b（1e6 暗能量）：**全局加成作用于相变转换速率**。
 *
 *   注意它和「熵凝聚转换速率」是两回事：
 *     · 熵凝聚（entropy→particle）在 particleRate 里，**不含 dm4b**
 *     · 相变（ZPE→暗能量）就是这里
 *
 *   所以 dm4b **完全不碰主环**：主环增益仍是 globalMult²，时间压缩不变。
 *   它只让暗能量积累变快：
 *     `dDE/dt = zpeRate/1e8 × gain × globalMult`
 *     而 globalMult 含 `deMult = 1 + 0.25·log2(DE)`
 *     => `dDE/dt ∝ log(DE)/DE^0.5`
 *     数学结论见 tools/de-milestone-model.mjs：峰值在 DE≈1e4.5，**不会失控**。
 */
export function darkEnergyRate(state) {
  if (!state.phaseTransmuterUnlocked) return D(0);
  const r = zpeRate(state).div(BASE.darkEnergyThreshold).mul(effectiveDarkEnergyGain(state));
  // ⚠️ 2026：暗物质的落点**不在这里**。
  //   我第一版按设计稿字面把它乘在这个函数里（"提升第一个相变仪的获取效率"），
  //   但用户 2026 重写的规则把落点定为**暗能量倍率的加法区** ⇒ 见 `darkEnergyMultiplier()` ✓
  // ★ ∞ 层 ③「相变超频」：无限点加速相变仪（ZPE → 暗能量）
  if (state.ipToTransmuterBought) {
    return r.mul(D(1).add(D(INFINITY_UPGRADES.ipToTransmuter.perIp).mul(state.infinityPoints ?? 0)));
  }
  return r;
}

// ══════════════════════════════════════════════════════════
// 熵 → 粒子
// ══════════════════════════════════════════════════════════

/**
 * 当前的转换规则。
 *
 * 产出与阈值**都是加法**：
 *   output    = 1 + 0.15n        （v5 后 1 + 0.65n）
 *   threshold = 100 + 3n
 *   净转换率 -> 0.15/3 = 0.05（v5 后 0.65/3 = 0.2167）
 *
 * ⚠️ 这个上限是**节拍器**，不是缺陷。曾经改成乘法（output = 1.07^n），
 *    400 级时转换率变成原稿的 93 亿倍，整局 15 分钟通关。
 *    详见 config.js 里 entropyCoeff 的注释和 tools/compare-pace.mjs。
 */
export function conversion(state) {
  const lv = levelOf(state, "entropyCoeff");
  const cfg = REPEATABLE.entropyCoeff;

  // ⚠️ 这里原来有一个 `qe.convUncap` 分支（旧量子升级「解耦」把产出改成乘法）。
  //    那套量子升级系统已整体删除，分支永远是死路，已移除。
  let perLevel = cfg.outputPerLevel;
  if (hasVoid(state, "v5")) perLevel += 0.5;
  if (hasCollapse(state, "cm5")) perLevel *= transmuterIpMult(state);   // ⑤ 相变仪随 IP（对数）
  // ★ 「凝聚斜率」：直接加在**斜率**上（不是乘一个倍率）。
  //   加法形式让转换率封顶在 perLevel/thresholdPerLevel；
  //   抬斜率才能把这个上限本身推高，而且因为 L ∝ log(资源)，
  //   上限只是**对数增长**，几乎不进 S 池。
  perLevel += DE_UPGRADES.convOutput.perLevel * deLevelOf(state, "convOutput").toNumber();
  const output = D(BASE.autoConvertOutput).add(lv.mul(perLevel));

  let threshold = D(BASE.autoConvertCost).add(lv.mul(cfg.thresholdPerLevel));
  // （原来这里乘 `qe.convThresholdMul`，旧量子升级「量纲压缩」——已随系统删除）

  if (hasZpe(state, "m6")) {
    const divisor = hasV9(state) ? 2 : 1;
    threshold = threshold.div(zpeMultiplier(state).mul(divisor));
  }
  // ★ 原稿这里同时乘了分子和分母，数学上精确抵消（SPEC 判据 P9）。
  //   现在只降阈值。
  if (hasDe(state, "dm2")) {
    threshold = threshold.div(darkEnergyMultiplier(state));
  }
  // ★ IC：挑战激活时，熵→粒子的**熵需求**被放大（唯一落点 ✓；放在所有阈值修正之后 ✓）
  threshold = threshold.mul(icEntropyMult(state));
  if (hasCollapse(state, "cm3")) threshold = threshold.mul(0.5);   // ③ 100:1 -> 50:1
  // ★★ 2025 em6（永恒里程碑 6）：「熵到粒子的熵消耗再除以 1.2」
  //   放在**所有修正的最后**（与 cm3、IC 同一个位置）—— 顺序不影响乘除结果，
  //   但集中在这里便于审计"阈值到底被谁改过" ✓
  if (hasEternityMilestone(state, "em6")) threshold = threshold.div(1.2);
  return { threshold, output };
}

/**
 * 粒子产出速率（每秒）。
 *
 * ★ 这里有一条**结构性**的边：量子升级「直接边」让 `物质 → 粒子` 直达。
 *
 * 为什么它重要：原本的链是
 *     物质 → 熵阱(价格×2, 产出+1) → 熵 → 粒子 → 物质
 * 而 `熵阱 ∝ log(物质)`，所以整条链是**亚指数**（实测 8.4 阶/对数时间）。
 *
 * 加上直接边后：
 *     dM/dt = k·P
 *     dP/dt = c + j·M          ← 新增的 j·M
 *     => d²M/dt² = k·c + k·j·M  ← M 自己出现在二阶导里 → **真指数**
 */
export function particleRate(state) {
  const { threshold, output } = conversion(state);
  // ⚠️ 这里原来有旧量子升级「直接边」的分支。那套系统已删除。
  //    （它当年会跑飞：d²M/dt² = k·c + k·j·M 里的 M 自反馈，
  //      增长率 √(k·j) 随全局加成一起涨，所以整条升级被废弃。）
  // ⚠️ dm4b **不在这里**。它作用于「相变转换速率」（ZPE→暗能量），
  //    不是「熵凝聚转换速率」（熵→粒子）。见 darkEnergyRate()。
  // ★ 量子 → 粒子获得的**时变增幅**（替代 R 的那个杠杆）：**必须与 `engine.js` 的 tick 同项**
  //   （踩过三次"显示 ≠ 实发"，根因每次都是"两处各算一遍基础产出"）。
  return entropyRate(state).div(threshold).mul(output).mul(particleTimeBoost(state));
}

// ══════════════════════════════════════════════════════════
// 价格
// ══════════════════════════════════════════════════════════

/**
 * 用于价格的 ZPE 倍率（m2 和 dm4 都会影响它）。
 * 原稿里这个函数的注释和代码差了 50 倍（注释说 0.001，代码是 0.05），这里统一成 0.05。
 */
export function effectiveZpeMultiplierForPrice(state) {
  let m = zpeMultiplier(state);
  if (hasDe(state, "dm4")) m = m.mul(D(1).add(state.darkEnergy.mul(0.05)));
  return m;
}

/** 可重复升级的价格（已应用折扣） */
export function repeatableCost(state, id) {
  const cfg = REPEATABLE[id];
  const lv = levelOf(state, id);
  let cost = D(cfg.baseCost).mul(Decimal.pow(cfg.costMult, lv));
  if (hasZpe(state, "m2")) cost = cost.div(effectiveZpeMultiplierForPrice(state));
  return cost;
}

/** 熵阱价格（已应用 m5 折扣 + 量子升级「退火」） */
export function trapCost(state) {
  // （原来这里读 `qe.trapCostMult` 覆盖基础增长 ——
  //   旧量子升级「退火」，已随整套系统删除，永远返回 null，所以直接去掉）
  const n = state.resources.traps;
  const mult = BASE.trapCostMult;
  let c = D(BASE.trapBaseCost).mul(Decimal.pow(mult, n));
  if (hasZpe(state, "m5")) c = c.div(zpeMultiplier(state));
  return c;
}

/** 虚空升级价格（固定） */
export function voidUpgradeCost(state, id) {
  return D(VOID_UPGRADES[id].cost);
}

/** 暗能量升级价格 */
export function deUpgradeCost(state, id) {
  const cfg = DE_UPGRADES[id];
  const lv = deLevelOf(state, id);
  const d = dreamUpgradeEffects(state);
  let particle = null;
  if (cfg.costParticle) {
    // 「相位锁定」会把高效相变的价格增长从 1.5 提到 2.0
    particle = id === "phaseShift"
      ? D(cfg.baseCost ?? 100).mul(Decimal.pow(d.phaseShiftCostMult, lv))
      : cfg.costParticle(lv);
  }
  let darkEnergy = null;
  if (cfg.costDarkEnergy) {
    // ★ 分段曲线（×3 -> ×1.5 -> ×2）用闭式解，不要循环
    darkEnergy = cfg.piecewise
      ? piecewiseDeCost(cfg.baseCost, lv)
      : D(cfg.baseCost).mul(Decimal.pow(cfg.costMult, lv));
  }
  return {
    dream: cfg.costDream ? D(cfg.costDream) : null,
    matter: cfg.costMatter ? cfg.costMatter(lv) : null,
    particle,
    zpe: cfg.costZpe ? cfg.costZpe(lv) : null,
    darkEnergy };
}

/**
 * 该升级在 v9 之后是否变成「达到阈值自动获取」（不扣钱）。
 * v9 会把 m2 / m5 的折扣升级成免费。
 */
export function isAutoAcquire(state, kind) {
  if (!hasV9(state)) return false;
  if (kind === "upgrade") return hasZpe(state, "m2");
  if (kind === "trap") return hasZpe(state, "m5");
  return false;
}

// ══════════════════════════════════════════════════════════
// 里程碑达成检测
// ══════════════════════════════════════════════════════════

/** 返回本次新达成的 ZPE 里程碑 id 列表 */
export function checkZpeMilestones(state) {
  const got = [];
  for (const m of ZPE_MILESTONES) {
    if (!state.zpeMilestones[m.id] && state.zpeTotal.gte(m.need)) {
      state.zpeMilestones[m.id] = true;
      got.push(m);
    }
  }
  return got;
}

/**
 * ★ 量子里程碑（2025 草案）：键在**累计量子对数**上（`quantumPairsTotal`，大坍缩不清零）。
 *
 * 为什么用累计量：当前量子数每次大坍缩归零 ⇒ 键在它上面的里程碑第一轮就拿完、之后形同虚设。
 * 这正是 AD 的手法③（`totalAMMult` 用累计反物质、`currentAMMult` 用当前值）。
 * 详见 docs/QUANTUM-MILESTONES.md。
 */
export function checkQuantumMilestones(state) {
  const got = [];
  const total = state.quantumPairsTotal ?? D(0);
  for (const m of QUANTUM_MILESTONES) {
    if (!state.quantumMilestones[m.id] && total.gte(m.need)) {
      state.quantumMilestones[m.id] = true;
      got.push(m);
    }
  }
  return got;
}

/** 已达成的量子里程碑 */
export function quantumMilestonesDone(state) {
  return QUANTUM_MILESTONES.filter((m) => state.quantumMilestones?.[m.id]);
}

/**
 * 粒子增幅速率常数 `b`（阶/秒）—— **替代 R 的那个杠杆**。
 *
 * `b = b0 · (1 + √q / 10) · 【量子里程碑的乘算加成】·【档位加速】`
 *   · `q` = 当前量子个数（每轮重置）
 *   · 档位加速：`qm2` 达成后，每档位 ×1.06（这是把 24 档压到 ~90h 的来源）
 *   · 硬封顶 `bMax`（用户既有要求：影响永恒阶段的东西必须有极强软上限）
 *
 * 时变增幅 `g(t) = 10^(b·本轮已过时间)`：**g 必须随时间增长**，否则只是"平移高度"到不了硬顶。
 */
export function particleBoostRate(state) {
  const b0 = DE_SPAN.b0;
  const q = Math.max(0, qOf(state).toNumber());
  let b = b0 * (1 + Math.sqrt(q) / 10);
  // 里程碑的乘算加成（qm1/qm3/qm6 是 b 加成；qm2 是"开启档位加速"）
  for (const m of quantumMilestonesDone(state)) {
    if (m.kind === "b") b *= m.value;
  }
  // 档位加速：qm2 达成后，每档位 ×1.0209（档位 = 已大坍缩次数）
  // ★ 2025 B1：改走 `tierAccelMult()` —— 原式 `Math.pow(tierAccel, 无界档位数)` 在
  //   破∞后的坍缩刷屏里会算出 Infinity ⇒ b=Infinity ⇒ softCapB 出 NaN ⇒ 全链冻结 ✗
  b *= tierAccelMult(state);
  // ★ 2025：R 退休后，原先"改成长速率"的三个旋钮里**只剩两个**
  //   （∞「速率解放」/ 档位 rate 里程碑）—— 「坍缩加速器」已整个删除（用户裁定）。
  //   `infinityRateMult()` 仍是它们的唯一汇总入口 ✓
  //   于是它们的作用从"抬 R"变成"抬 b"（同样是提速，但落点在粒子线，环外 ✓）
  b *= infinityRateMult(state).toNumber();
  // ★ 阈值软上限（用户 2025 选定）：不再用硬封顶 `min(b, bMax)` ✗
  //   低于阈值原样通过；超过则 `阈值 + 超出·2^(−超出/跨度)` ⇒ 有界、平滑 ✓
  return softCapB(b, state);
}

/**
 * 粒子获得的时变增幅 `g = 10^(b · 本轮已过时间)`（甲方案：时间**每轮重置**）。
 *
 * 用户选甲的理由：若用全局累计时间，堆叠会让时间失去意义（第二次大坍缩起瞬间到顶）。
 */
export function particleTimeBoost(state) {
  const b = particleBoostRate(state);
  const t = Math.max(0, (state.infinityElapsed ?? 0));      // 秒；大坍缩时归零
  return Decimal.pow(10, b * t);
}

/**
 * 暗能量里程碑的额外门槛。
 * dm0（相变仪）在原稿里要求「v8 已购 且 物质 ≥ 1e8」，见 config.js 的注释。
 */
function gateOpen(state, m) {
  if (!m.gate) return true;
  if (m.gate.voidUpgrade && !state.voidUpgrades[m.gate.voidUpgrade]) return false;
  if (m.gate.matter && state.resources.matter.lt(m.gate.matter)) return false;
  return true;
}

/**
 * 返回本次新达成的暗能量里程碑 id 列表。
 *
 * ⚠️ 判定用 **darkEnergyTotal（历史总量）**，不是 darkEnergy（当前余额）。
 *
 * 踩过：原来用余额判定，而界面显示的是总量 —— 两边不是同一个变量。
 * 玩家花暗能量买升级后余额 < 总量，于是看到「1.88e10 / 1e10」却判定未达成。
 *
 * 更糟的是这不只是显示问题：**如果玩家一直把暗能量花掉，
 * 余额可能永远攒不到门槛，里程碑就永远拿不到** —— 一个和玩家行为对赌的陷阱。
 *
 * darkEnergyTotal 从不被坍缩/大坍缩重置，所以「累计产出过多少」才是正确语义。
 */
export function checkDeMilestones(state) {
  const got = [];
  for (const m of DE_MILESTONES) {
    if (state.deMilestones[m.id]) continue;
    if (!gateOpen(state, m)) continue;
    if (state.darkEnergyTotal.gte(m.need)) {
      state.deMilestones[m.id] = true;
      got.push(m);
    }
  }
  return got;
}
