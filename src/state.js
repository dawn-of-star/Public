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
import { BASE, DE_MILESTONES, DE_UPGRADES, REPEATABLE, VOID_UPGRADES, ZPE_MILESTONES } from "./config.js";

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
      traps: D(0),
    },

    // ── 可重复升级的等级（价格从 config 推导，不存） ──
    levels: {
      particleBoost: D(0),
      matterBoost: D(0),
      entropyCoeff: D(0),
    },

    // ── 一次性购买标记 ──
    voidUpgrades: Object.fromEntries(Object.keys(VOID_UPGRADES).map((k) => [k, false])),

    // ── 里程碑 ──
    zpeMilestones: Object.fromEntries(ZPE_MILESTONES.map((m) => [m.id, false])),
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
    /** 无限点（大坍缩给） */
    infinityPoints: D(0),
    /** 已大坍缩次数 */
    bigCrunchCount: D(0),
    /**
     * 是否已「打破无限」。
     * false = 物质硬顶在 1e308.25，到顶强制大坍缩，收益固定
     * true  = 上限解除，手动大坍缩，收益随深度增长
     */
    brokenInfinity: false,
    /** 历史最高物质（用于显示和里程碑判定） */
    peakMatter: D(0),

    // ── ∞ 层：无限升级（用无限点买，不随大坍缩重置）──
    /** ① 无限增幅：无限点收益 ×2 的等级 */
    ipDoubleLevel: D(0),
    /** ② 零点耦合：无限点 → ZPE 倍率加法区（一次性） */
    ipToZpeBought: false,
    /** ③ 相变超频：无限点 → 相变仪速率（一次性） */
    ipToTransmuterBought: false,
    /** ④ 无限长河：本次无限的耗时换无限点（一次性） */
    ipTimeBought: false,
    /** 「起点跃迁 I~IV」已购标记（id -> true）：决定每次大坍缩的开局物质 */
    startBought: {},
    /** 「速率解放 I~IV」已购标记（id -> true）：抬高量子成长速率上限 */
    speedBought: {},
    /**
     * 本次无限已经过去的秒数（④ 的计量口径）。
     * tick 每帧累加、大坍缩清零 —— 和离线结算同源，不依赖 wall clock。
     */
    infinityElapsed: 0,

    // ── 量子（第三版模型：ZPE 门槛捕获）──
    /** 当前量子数量（每捕获一对 +2） */
    quantum: new Decimal(0),
    /** 已捕获对数（决定下一对的门槛，×10 递增） */
    quantumPairs: new Decimal(0),
    /** 历史累计捕获对数（统计用，大坍缩后保留） */
    quantumPairsTotal: new Decimal(0),
    /** 梦想点一次性升级（量子页）：已购 id -> true */
    dreamUpgrades: {},
    /**
     * 相变仪进度：距离下一次「1e8 ZPE → 暗能量」还攒了多少 ZPE。
     * **只用于显示那个环**（实际转换是连续除法，不走累加器）。
     */
    deAccum: new Decimal(0),

    // ── 梦想点：成就系统 ──
    /**
     * 设计本意：取代 AD 的成就系统。
     * 每获得一个**非重复**的加成（升级 / 里程碑 / 新机制）就 +1，永不重置。
     * 它同时是全局加成的来源（1 + 梦想点 × 系数）。
     */
    dreamPoints: D(0),
    /** 已经给过梦想点的加成 key，防止重复发 */
    dreamAwarded: {},
    // ── 统计（顺便给日志面板用） ──
    stats: {
      clicks: 0,
      totalEntropy: D(0),
    },
    /** 日志缓冲，最近 N 条 */
    log: [],
  };
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

/** ★ 原稿的 #log-panel 是死 UI（从没被写过）。这里补上。 */
export function pushLog(state, text) {
  state.log.push({ t: Date.now(), text });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
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
  s.ipToZpeBought = bool(raw.ipToZpeBought);
  s.ipToTransmuterBought = bool(raw.ipToTransmuterBought);
  s.ipTimeBought = bool(raw.ipTimeBought);
  s.startBought = raw.startBought && typeof raw.startBought === "object"
    ? Object.fromEntries(Object.entries(raw.startBought).filter(([, v]) => v === true))
    : {};
  s.speedBought = raw.speedBought && typeof raw.speedBought === "object"
    ? Object.fromEntries(Object.entries(raw.speedBought).filter(([, v]) => v === true))
    : {};
  s.infinityElapsed = num(raw.infinityElapsed, 0);

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
