/**
 * state.js —— 状态工厂与访问器（纯数据，不碰 DOM）
 *
 * 从 0.3.4 的 state.js 移植，但改了两件事：
 *   1. 所有「效果」不再是挂在状态上的函数，而是 config.js 里的声明式描述
 *   2. 派生值（各种倍率、速率）全部移到 formulas.js，状态只存**原始数据**
 *
 * 这样状态可以整体 JSON 序列化，存档和离线都不用特殊处理。
 */

import Decimal from "../dist/break_eternity.esm.js";
import { BASE, DE_MILESTONES, DE_UPGRADES, QUANTUM_MILESTONES, REPEATABLE, VOID_UPGRADES, ZPE_MILESTONES, quantumZpeMultBonus, ETERNITY, eternityPointGain, tierMilestonesDone, COLLAPSE, crunchThreshold, CRUNCH_AT_LABEL,
  // ★ 2025：旧档迁移要用（`eternityCount > 0` ⇒ 补全页面解锁记录）
  PAGE_KEYS,
  // ★★★ 2025（`docs/NEKO.md` §7）：好感度的范围常量（反序列化时要夹，防手改存档 ✗）
  NEKO } from "./config.js";

const D = (v) => new Decimal(v ?? 0);

// ══════════════════════════════════════════════════════════
// 新状态
// ══════════════════════════════════════════════════════════

export function newState() {
  return {
    version: BASE.saveVersion,
    startedAt: Date.now(),
    lastSavedAt: Date.now(),
    playTimeMs: 0,

    // ── 资源 ──
    resources: {
      entropy: D(0),
      particle: D(0),
      matter: D(0),
      traps: D(0) },

    // ★ 补回：stats 块原本是单行、且含 coinage 字段 ⇒ 删铸币时整行被删掉 ✗
    //   字段清单以**反序列化**处为准（clicks / totalEntropy ✓）
    stats: { clicks: 0, totalEntropy: D(0) },

    // ── 可重复升级的等级（价格从 config 推导，不存） ──
    levels: {
      particleBoost: D(0),
      matterBoost: D(0),
      entropyCoeff: D(0) },

    // ── 一次性购买标记 ──
    voidUpgrades: Object.fromEntries(Object.keys(VOID_UPGRADES).map((k) => [k, false])),
    // ★★ 2025：「曾经解锁过的页面」—— **永不重置**（见字段说明；用户裁定第一次永恒后保持解锁）
    pageUnlocked: {},

    // ── 里程碑 ──
    zpeMilestones: Object.fromEntries(ZPE_MILESTONES.map((m) => [m.id, false])),
    /**
     * ★ 量子里程碑（2025 草案）：键在**累计量子对数**上（大坍缩不清零），
     * **永恒会清除**（用户指定：与"除梦想系统外一切重置"一致）。
     * 见 docs/QUANTUM-MILESTONES.md。
     */
    quantumMilestones: Object.fromEntries(QUANTUM_MILESTONES.map((m) => [m.id, false])),
    deMilestones: Object.fromEntries(DE_MILESTONES.map((m) => [m.id, false])),

    // ── ZPE ──
    zpe: D(0),
    zpeTotal: D(0),
    /** dm1 给的一次性快照倍率 */
    zpeFixedMultiplier: null,

    // ── 暗能量 ──
    darkEnergy: D(0),
    darkEnergyTotal: D(0),
    /** ZPE 累积器，满 darkEnergyThreshold 换一次 */
    zpeAccumulator: D(0),
    phaseTransmuterUnlocked: false,
    deUpgradeLevels: Object.fromEntries(
      Object.keys(DE_UPGRADES).map((k) => [k, D(0)]),
    ),
    /** 每个暗能量升级的首次购买是否已发过梦想点 */
    deFirstPurchase: Object.fromEntries(
      Object.keys(DE_UPGRADES).map((k) => [k, false]),
    ),

    // ── 三合一：每种可重复升级的首次购买奖励 ──
    firstPurchase: Object.fromEntries(
      Object.keys(REPEATABLE).map((k) => [k, false]),
    ),

    // ── 第四层：大坍缩 ──
    // ★ `darkMatter` / `collapseCount` / `collapseThreshold` 已删除 ——
    //   「临界坍缩 + 暗物质」整个体系被移除（见 engine.js 的说明）。
    // ★ 补回：量子相关字段（删铸币时同一行被连带删掉 ✗）
    quantum: D(0),
    quantumPairs: D(0),
    peakQuantumRun: D(0),
    totalQuantumPairs: D(0),
    // ★ 批量补回（删铸币的连带损伤 ✓ 按反序列化清单推定类型 ✓）
    // ⚠️ 2025：`accelLevel` 已随「坍缩加速器」整个删除 ⇒ 不再有这个字段。
    //    老存档里若还有它，反序列化时会被忽略（不报错 ✓）
    dreamAwarded: {},
    dreamUpgrades: {},
    eternityCount: 0,
    eternityPoints: D(0),
    /**
     * ★★ 2025：**累计获得**的永恒点（只增不减）—— em5 的读数源。
     *
     * 为什么不用 `eternityPoints`（当前持有）：永恒升级会**花掉** EP ⇒
     * `log10(EP)` 随之掉下来、甚至归零（`log10(0) = -Infinity`）⇒
     * em5 的加成会**随消费反复丢失**，里程碑等于白拿 ✗
     * 与 AD 的手法一致（累计量做加成的键：`totalAMMult` vs `currentAMMult`）。
     */
    eternityPointsTotal: D(0),
    /**
     * ★★★ 2025（第三层设计稿 33~35 行）：**永恒升级「永恒增幅」的等级**。
     *
     * 效果 = 最终获得的永恒点 ×5/级（`epMultFactor(state)`，唯一入口见 config.js）。
     * ⚠️ 它**不随永恒重置**（永恒升级本来就是跨永恒的进度）——
     *    所以 `doEternity` / `resetForEternity` 里**不要**清它 ✓
     */
    epMultLevel: 0,
    /**
     * ★★★ 2025（`docs/NEKO.md` §7 / §10）：**好感度系统**（游戏原生，零依赖 SDK）。
     *
     * · `nekoAffinity`：当前好感度。规格 = 初始 **0**、范围 **[-100, 100]**、
     *   档位判定看"是否 **> 25 / > 50 / > 75**"（三档叠乘 ⇒ 全局 ^最高 1.0221151）
     * · `nekoDriftStamps`：**窗口预算**用的时间戳数组 `[[ms, delta], …]`
     *   —— 保证"每 5 分钟波动 < 8 点"（接入 SDK 后 < 16）✓
     * ⚠️ 这两个字段**不随任何重置清空**（好感度是跨轮次的长期进度）——
     *   所以 `doBigCrunch` / `doEternity` 里**不要**清它 ✓
     */
    nekoAffinity: 0,
    nekoDriftStamps: [],
    infinityElapsed: 0,
  // ★ 2025: 本轮时长（秒）—— 收手判据按时间；每次大坍缩归零（见 engine.js）
  runElapsed: 0,
    infinityFromQuantumBought: false,
    ipTimeAccrued: 0,
    ipTimeBought: false,
    ipToTransmuterBought: false,
    ipToZpeBought: false,
    pairBoostBought: false,
    quantumPairsTotal: D(0),
    speedBought: {},
    startBought: {},
    thresholdFlatBought: false,
    v9: false,
    zpeEngineLevel: D(0),
    zpeEngineUnlocked: false,
    // ★ 从代码扫描补回（删铸币连带损伤 ✓）
    deAccum: D(0),
    /** 无限点（大坍缩给） */
    infinityPoints: D(0),
    /** ★ 补回：删铸币时被连带删掉的梦想点字段 ✗（globalMultiplier 依赖它 ✓） */
    dreamPoints: D(0),
    /** 已大坍缩次数 */
    bigCrunchCount: D(0),
    /**
     * 是否已「打破无限」。
     * false = 物质硬顶在 1e308.25，到顶强制大坍缩，收益固定
     * true  = 上限解除，手动大坍缩，收益随深度增长
     */
    brokenInfinity: false,
    /**
     * ★ 跨度层基准（`D(0)` = 尚未开启）。
     *
     * 买下「门槛压平」时记下**当时的暗能量水位**，跨度乘数取
     * `(DE / spanDeBase)^k` —— 好处：
     *   · 购买瞬间乘数恰好 = 1（连续、无跳变）
     *   · 早期根本买不到该升级 ⇒ 乘数恒 1 ⇒ **不伤前期**
     *   · 基准由玩家的购买时刻确定，**不需要我发明一个魔法常数**
     * 见 docs/R-REPLACEMENT.md §11。
     */
    spanDeBase: D(0),
    /** 历史最高物质（用于显示和里程碑判定） */
    peakMatter: D(0),

    // ── ∞ 层：无限升级（用无限点买，不随大坍缩重置）──
    /** ① 无限增幅：无限点收益 ×2 的等级 */
    ipDoubleLevel: D(0),
  ic: { active: D(0), completed: 0 },
    /**
     * ★ 无限铸币等级（**设计未冻结：用户保留最终修改权**）。
     *    这是"24 小时档"的节流阀 —— 只卡铸币上限而其它 IP 循环不设限是无效的（模型实测）。
     */
    /** 日志缓冲，最近 N 条 */
    log: [] };
}

// ══════════════════════════════════════════════════════════
// 梦想点：成就系统
// ══════════════════════════════════════════════════════════

/**
 * 发一个「非重复加成」的梦想点。
 *
 * @param {object} state
 * @param {string} key   加成的唯一标识（如 "void:v1" / "zpeMs:m3" / "collapse:0"）
 * @param {string} label 显示用的名字
 * @returns {boolean}    是否是新成就（true = 发到了梦想点）
 */
export function awardDream(state, key, label) {
  if (state.dreamAwarded[key]) return false;
  state.dreamAwarded[key] = true;
  state.dreamPoints = state.dreamPoints.add(1);
  pushLog(state, `💭 新成就「${label}」 梦想点 +1（共 ${state.dreamPoints.toString()}）`);
  return true;
}

export function achievementCount(state) {
  return Object.keys(state.dreamAwarded).length;
}

// ══════════════════════════════════════════════════════════
// 里程碑查询（把「是否已达成」统一成一个函数，formulas 里好读）
// ══════════════════════════════════════════════════════════

export function hasZpe(state, id) {
  return state.zpeMilestones[id] === true;
}

export function hasDe(state, id) {
  return state.deMilestones[id] === true;
}

export function hasVoid(state, id) {
  return state.voidUpgrades[id] === true;
}

/** v9 已购 —— 影响很多地方，单独包一个 */
export function hasV9(state) {
  return state.voidUpgrades.v9 === true;
}

// ══════════════════════════════════════════════════════════
// 等级读写
// ══════════════════════════════════════════════════════════

export function levelOf(state, id) {
  return state.levels[id] ?? D(0);
}

export function addLevel(state, id, n = 1) {
  state.levels[id] = levelOf(state, id).add(n);
}

export function deLevelOf(state, id) {
  return state.deUpgradeLevels[id] ?? D(0);
}

// ══════════════════════════════════════════════════════════
// 日志
// ══════════════════════════════════════════════════════════

const LOG_MAX = 60;

/**
 * ★★★ 2025（`docs/NEKO.md` §9）：**日志的额外出口**（宿主桥）。
 *
 * 为什么用"注册回调"而不是让 `state.js` 直接 import `neko.js`：
 *   `pushLog` 有 **40+ 处调用点**，而它们全都只关心"记一条" ⇒
 *   在这里挂一个可选回调，就能让**全部**日志自动流向宿主桥，
 *   而**一处调用点都不用改** ✓（改 40 处必然漏，且会污染业务代码）
 * ⚠️ 回调必须**永不抛**（日志失败不该影响游戏）—— 这里包了 try/catch 兜底，
 *   但注册方也应自己吞异常（见 `neko.js` 的 `sendLog`）。
 */
let logSink = null;
export function setLogSink(fn) { logSink = typeof fn === "function" ? fn : null; }

/** ★ 原稿的 #log-panel 是死 UI（从没被写过）。这里补上。 */
export function pushLog(state, text, data = undefined) {
  const entry = { t: Date.now(), text };
  if (data !== undefined) entry.data = data;   // ★ §9：可选的结构化附加数据
  state.log.push(entry);
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
  // ★ 顺带推给宿主桥（无宿主时它是 no-op ✓）；失败绝不影响游戏
  if (logSink) { try { logSink(entry); } catch { /* 忽略 */ } }
}

/**
 * 重复购买类升级的**日志关键节点**：`1, 5, 10, 50, 100, 500, 1000, …`
 * （×5、×2 交替 —— 用户指定"1，5，10，50，100 以此类推"）。
 *
 * 为什么需要：自动获取模式下一帧能买几百级，逐级写日志会把面板刷爆
 * （也让"真正重要的事件"被冲走）。
 */
export const KEY_LEVELS = (() => {
  const out = [1];
  let v = 1, i = 0;
  while (v < 1e18) { v *= i++ % 2 === 0 ? 5 : 2; out.push(v); }
  return out;
})();

/** 这个等级本身是不是关键节点 */
export function isKeyLevel(n) {
  return KEY_LEVELS.includes(n);
}

/**
 * ★★★ 2025（用户裁定）：**量子的日志节点 = `1 / 5 / 25 / 125 / 625 …`（纯 ×5）**。
 *
 * 用户原话：「顺手优化下量子的日志输出，每 1/5/25/125/625（以此类推）对量子输出」
 *
 * ⚠️ 为什么不复用 `KEY_LEVELS`（它是 ×5、×2 **交替**）：
 *   那是给"重复购买类升级"用的（用户当年指定 1、5、10、50…）；
 *   量子要的是**纯 ×5** 序列 ⇒ 两套判据**语义不同，不能混用** ✗
 *   （混用会让日志在 2、10、50… 也冒出来，与用户要的序列不符）
 *
 * 上界 `1e18` 与 `KEY_LEVELS` 同族：再大就不可能在一局里达到（防除法/比较开销）✓
 */
export const QUANTUM_LOG_LEVELS = (() => {
  const out = [];
  for (let v = 1; v <= 1e18; v *= 5) out.push(v);
  return out;
})();

/** 这一对数量是不是量子日志的关键节点 */
export function isQuantumLogLevel(n) {
  return QUANTUM_LOG_LEVELS.includes(n);
}

/** 从 `from` 买到 `to` 的过程中**跨过的最高关键节点**（没跨过返回 0） */
export function crossedKeyLevel(from, to) {
  let hit = 0;
  for (const k of KEY_LEVELS) if (k > from && k <= to) hit = k;
  return hit;
}

/**
 * 重复购买类升级的等级日志：**只在跨过关键节点时写一条**。
 *
 * 统一入口 —— 手动买、自动获取、暗能量升级、无限升级① 全部走这里，
 * 免得以后有人加新升级时忘了这条规矩（日志策略只在一个地方定义）。
 *
 * @returns {boolean} 是否真的写了一条
 */
export function pushLevelLog(state, name, from, to) {
  const hit = crossedKeyLevel(from, to);
  if (!hit) return false;
  pushLog(state, `⬆「${name}」→ ${to} 级（跨过 ${hit} 级）`);
  return true;
}

// ══════════════════════════════════════════════════════════
// 序列化（所有 Decimal 转字符串）
// ══════════════════════════════════════════════════════════

export function serialize(state) {
  const enc = (v) => {
    if (v instanceof Decimal) return v.toString();
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = enc(val);
      return o;
    }
    return v;
  };
  return enc(state);
}

/** 反序列化：按 newState() 的骨架逐字段还原，缺失/损坏的字段回落到默认值。 */
export function deserialize(raw) {
  const fresh = newState();
  if (!raw || typeof raw !== "object") return { state: fresh, ok: false };

  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const dec = (v) => {
    try {
      const d = D(v);
      return d.isFinite() ? d : D(0);
    } catch {
      return D(0);
    }
  };
  const bool = (v) => v === true;

  const s = fresh;
  s.version = num(raw.version, fresh.version);
  s.startedAt = num(raw.startedAt, fresh.startedAt);
  s.lastSavedAt = num(raw.lastSavedAt, Date.now());
  s.playTimeMs = num(raw.playTimeMs, 0);

  const r = raw.resources ?? {};
  s.resources.entropy = dec(r.entropy);
  s.resources.particle = dec(r.particle);
  s.resources.matter = dec(r.matter);
  s.resources.traps = dec(r.traps);
  s.dreamPoints = dec(raw.dreamPoints);

  const lv = raw.levels ?? {};
  for (const k of Object.keys(fresh.levels)) s.levels[k] = dec(lv[k]);

  const vu = raw.voidUpgrades ?? {};
  for (const k of Object.keys(fresh.voidUpgrades)) s.voidUpgrades[k] = bool(vu[k]);

  const qm = raw.quantumMilestones ?? {};
  for (const k of Object.keys(fresh.quantumMilestones)) s.quantumMilestones[k] = bool(qm[k] === true);
  const zm = raw.zpeMilestones ?? {};
  for (const k of Object.keys(fresh.zpeMilestones)) s.zpeMilestones[k] = bool(zm[k]);

  const dm = raw.deMilestones ?? {};
  for (const k of Object.keys(fresh.deMilestones)) s.deMilestones[k] = bool(dm[k]);

  s.zpe = dec(raw.zpe);
  s.zpeTotal = dec(raw.zpeTotal);
  s.zpeFixedMultiplier = raw.zpeFixedMultiplier == null ? null : dec(raw.zpeFixedMultiplier);

  s.darkEnergy = dec(raw.darkEnergy);
  s.darkEnergyTotal = dec(raw.darkEnergyTotal);
  s.zpeAccumulator = dec(raw.zpeAccumulator);
  s.phaseTransmuterUnlocked = bool(raw.phaseTransmuterUnlocked);

  const dl = raw.deUpgradeLevels ?? {};
  for (const k of Object.keys(fresh.deUpgradeLevels)) s.deUpgradeLevels[k] = dec(dl[k]);

  const df = raw.deFirstPurchase ?? {};
  for (const k of Object.keys(fresh.deFirstPurchase)) s.deFirstPurchase[k] = bool(df[k]);

  const fp = raw.firstPurchase ?? {};
  for (const k of Object.keys(fresh.firstPurchase)) s.firstPurchase[k] = bool(fp[k]);

  const st = raw.stats ?? {};
  s.stats.clicks = num(st.clicks, 0);
  s.stats.totalEntropy = dec(st.totalEntropy);

  // ── 第四层：大坍缩 ──
  // ★ 旧存档里的 darkMatter / collapseCount / collapseThreshold 直接**忽略** ——
  //   那三样已经不存在了，读进来也没有字段可放。读旧档不会报错。
  s.infinityPoints = dec(raw.infinityPoints);
  s.bigCrunchCount = dec(raw.bigCrunchCount);
  s.brokenInfinity = raw.brokenInfinity === true;
  s.peakMatter = dec(raw.peakMatter);

  // ── ∞ 层：无限升级 ──
  s.ipDoubleLevel = dec(raw.ipDoubleLevel);
  s.ic = raw.ic ?? { active: D(0), completed: 0 };
  s.infinityFromQuantumBought = bool(raw.infinityFromQuantumBought);
  s.thresholdFlatBought = bool(raw.thresholdFlatBought);
  s.pairBoostBought = bool(raw.pairBoostBought);
  s.peakQuantumRun = dec(raw.peakQuantumRun);
  // ⚠️ 2025：不再读 `raw.accelLevel`（坍缩加速器已删除）。老存档带着它也无害 —— 直接忽略 ✓
  s.ipToZpeBought = bool(raw.ipToZpeBought);
  s.ipToTransmuterBought = bool(raw.ipToTransmuterBought);
  s.ipTimeBought = bool(raw.ipTimeBought);
  s.startBought = raw.startBought && typeof raw.startBought === "object"
    ? Object.fromEntries(Object.entries(raw.startBought).filter(([, v]) => v === true))
    : {};
  // ★★ 2025：**页面「曾经解锁过」的永久记录**（第一次永恒后保持解锁）
  //   ⚠️ 必须进反序列化 —— 否则刷新一次存档就从"已解锁"退回"锁" ✗
  //   只接受 `true`（与 startBought / speedBought 同一套写法）
  s.pageUnlocked = raw.pageUnlocked && typeof raw.pageUnlocked === "object"
    ? Object.fromEntries(Object.entries(raw.pageUnlocked).filter(([, v]) => v === true))
    : {};

  // ══════════════════════════════════════════════════════════
  // ★★★ 2025 **页面解锁的兜底**（用户实测报告：「永恒后还是会重置页面」）
  // ══════════════════════════════════════════════════════════
  // 病根：`pageUnlocked` 是 2025 才加的字段，**加之前存的档里根本没有它**。
  //   而 `markPageUnlocked` 只在"解锁那一刻"被打点 —— 旧档玩家早就过了那一刻
  //   ⇒ 记录永远是空的 ⇒ 永恒（或任何清空内容的重置）之后页面退回"待推进" ✗
  //
  // ⇒ ★ **用户裁定**：「永恒次数若 > 1 则解锁永恒前所有页面」
  //   ⚠️ 但实测证明**必须用 `> 0`**（我按字面改成 `> 1` 是错的 ✗）：
  //     用户的档是 `eternityCount = 1` 且 `pageUnlocked = {}`（旧档）——
  //     用 `> 1` 就**不补全** ⇒ 无限页（判据 `brokenInfinity`）与永恒页
  //     （判据 `eternityCount > 0`）都变成 `perma=false` ⇒ 退回"待推进" ✗
  //     而用 `> 0`：一次永恒即**证明**该档一路解锁过到永恒 ⇒ 补全全部 `PAGE_KEYS` ✓
  //   ⇒ 用户真正要的语义是「**永恒之前解锁过的所有页面**」—— 那就包含"永恒"这一页本身，
  //     判据就是"至少永恒过一次" = `> 0`。
  //
  //   ⚠️ 判据用 `raw.eternityCount`（**原始存档**），不是 `s.*` ——
  //      避免把"后续补的默认值"误当成旧档证据。
  //   ⚠️ 这是**载入时**的兜底：`deserialize` 只在读档时跑 ⇒ 活档期间的解锁
  //      仍走 `markPageUnlocked`（那是"解锁那一刻"的正规打点）✓
  const rawEternityCount = num(raw.eternityCount, 0);
  if (rawEternityCount > 0) {
    for (const k of PAGE_KEYS) s.pageUnlocked[k] = true;
  }

  s.speedBought = raw.speedBought && typeof raw.speedBought === "object"
    ? Object.fromEntries(Object.entries(raw.speedBought).filter(([, v]) => v === true))
    : {};
  s.infinityElapsed = num(raw.infinityElapsed, 0);
  s.ipTimeAccrued = num(raw.ipTimeAccrued, 0);
  s.zpeEngineUnlocked = bool(raw.zpeEngineUnlocked);
  s.zpeEngineLevel = dec(raw.zpeEngineLevel);
  s.eternityPoints = dec(raw.eternityPoints);
  s.eternityCount = num(raw.eternityCount, 0);
  // ★ 2025：累计 EP（em5 的读数源）。**旧存档没有这个字段** ⇒ 用当前持有量兜底
  //   （旧档的持有量 ≥ 0，兜底后行为正常；新档从此只增不减 ✓）
  s.eternityPointsTotal = raw.eternityPointsTotal != null
    ? dec(raw.eternityPointsTotal)
    : s.eternityPoints;
  // ★★★ 2025：永恒升级「永恒增幅」的等级（新字段；旧档没有 ⇒ 默认 0 ✓）
  s.epMultLevel = Math.max(0, num(raw.epMultLevel, 0));
  // ★★★ 2025（`docs/NEKO.md` §7）：好感度（跨轮次长期进度；旧档默认 0 ✓）
  //   ⚠️ 必须夹到 [NEKO.min, NEKO.max]（存档可被手改 ⇒ 不夹的话指数会失控 ✗）
  s.nekoAffinity = Math.max(NEKO.min, Math.min(NEKO.max, num(raw.nekoAffinity, 0)));
  // 窗口预算的时间戳：只接受 `[ms, delta]` 形状（防脏数据）
  s.nekoDriftStamps = Array.isArray(raw.nekoDriftStamps)
    ? raw.nekoDriftStamps
      .filter((x) => Array.isArray(x) && x.length === 2 && Number.isFinite(Number(x[0])) && Number.isFinite(Number(x[1])))
      .map((x) => [Number(x[0]), Number(x[1])])
      .slice(-64)                                   // 环形上限：够 5 分钟窗口用，防存档膨胀
    : [];

  // ── 量子 ──
  s.quantum = dec(raw.quantum);
  s.quantumPairs = dec(raw.quantumPairs);
  s.quantumPairsTotal = dec(raw.quantumPairsTotal);
  s.dreamUpgrades = raw.dreamUpgrades && typeof raw.dreamUpgrades === "object"
    ? Object.fromEntries(Object.entries(raw.dreamUpgrades).filter(([, v]) => v === true))
    : {};

  // ── 梦想点成就表 ──
  s.dreamAwarded = raw.dreamAwarded && typeof raw.dreamAwarded === "object"
    ? Object.fromEntries(Object.entries(raw.dreamAwarded).filter(([, v]) => v === true))
    : {};

  s.log = Array.isArray(raw.log)
    ? raw.log.slice(-LOG_MAX).map((e) => ({ t: num(e?.t, Date.now()), text: String(e?.text ?? "") }))
    : [];

  return { state: s, ok: true };
}