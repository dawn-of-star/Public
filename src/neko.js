/**
 * src/neko.js —— **N.E.K.O 接入层**（`docs/NEKO.md` §5 / §9）
 *
 * ══════════════════════════════════════════════════════════
 * ★★★ 定位：**无宿主版本**（用户裁定「我同意先做无宿主版本」）
 * ══════════════════════════════════════════════════════════
 * 我们是**纯静态**项目（可部署到 GitHub Pages）⇒ **不能假设宿主存在**。
 * 所以这一层的纪律是：
 *   ① 本文件**不 import 任何 N.E.K.O 的东西**（SDK 由宿主注入，不是我们的依赖）
 *   ② 对外接口在**没有宿主时全部优雅降级**（no-op / 返回 false），
 *      游戏主流程一行都不会因为它而改变 ✓
 *   ③ 它提供的是**我们这侧的数据契约**（§5 快照 / §9 日志 / §6 动作白名单）——
 *      这些东西**对内也有用**（调试、回放、断言），所以不依赖对面回话就能做 ✓
 *
 * ── 背景（实测，见 TODO「P9」）──
 *   · SDK 的传输机制 = **同源 HTTP**（不是 WebSocket / postMessage）：
 *     `POST /api/game/logs`、`POST /api/game/<type>/<op>`
 *   · 宿主在页面里注入 `#neko-minigame-host-launch`（JSON）→ bootstrap 吃掉它 →
 *     提供 `window.createNekoMiniGameSameOriginHost` → 我们 `connect()` 拿 transport
 *   · 宿主会校验 `manifest.id` / `manifest.version` 与注册表**完全一致**
 *     （不一致 ⇒ `code: 'game_unregistered'`）⇒ 所以**注册**是接入的前提（§8 问题 1）
 *   · ⚠️ **现有小游戏（badminton / soccer）都没用 SDK** ⇒ 我们**没有范例可抄**，
 *     这一层是我们自己钉的契约（用户原话：「我们是首个这么干的开发者/工具组」）
 *
 * ── 与 `NEKO.md` 的差异（诚实记录）──
 *   §9 写的是「日志格式 `{ t, kind, text, data }`，kind 用固定枚举」
 *   而实现里 `pushLog` 原来只推 `{ t, text }` ⇒ **文档与实现不一致** ✗
 *   本文件补上 `kind` / `data`，并**把判据写成"从既有文本推导"** ⇒ 不必改 40+ 处调用点 ✓
 */

/**
 * 快照 schema 版本（`NEKO.md` §9：字段**只增不删**，删则 bump）。
 * ⚠️ 改字段含义时**必须** bump，否则对面按旧含义解读 ⇒ 静默错 ✗
 */
export const NEKO_SNAPSHOT_SCHEMA = 1;

/**
 * 日志 kind 的**固定枚举**（`NEKO.md` §9 原文）：
 * `crunch` / `buy` / `milestone` / `quantum` / `system`
 *
 * ★ 判据：**从日志文本的 emoji 前缀推导**（不改 40+ 处 `pushLog` 调用点 ✓）。
 *   为什么用 emoji 而不是改签名：现有日志已经**稳定用这些前缀**表达分类
 *   （🌌 大坍缩 / ⬆·⚡ 购买 / 🏆 里程碑 / ⚛ 量子 / 💭 梦想 / ⏳ 永恒 / ⚙ 引擎…），
 *   把它**显式化**比给每个调用点加参数更省、也不会漏 ✓
 * ⚠️ 顺序有意义：**先匹配到的赢**（例如 `🌌` 同时出现在"大坍缩"与"相变仪解锁"里，
 *   前者才是 crunch ⇒ 具体模式写在前面）。
 */
const KIND_RULES = [
  // ⚠️ **顺序有意义：先匹配到的赢**，所以"更具体的文本模式"必须排在"宽泛的 emoji"前面。
  //   踩过：我原来把 `/无限挑战/` 和 `/🌌|💠/` 并成一条 ⇒
  //     「开始无限挑战 1／3」被判成 `crunch` ✗（它只是挑战开始，属 system）
  //   ⇒ 拆开 + 前置 ✓
  [/无限挑战/, "system"],
  // 大坍缩 / 打破无限 —— 无限层的"事件"
  [/🌌|💠/, "crunch"],
  // 量子
  [/⚛/, "quantum"],
  // 购买（含买满/跨级）
  [/⬆|⚡|∞ 购买|💭 (购买|首次购买|新成就)/, "buy"],
  // 里程碑 / 成就
  [/🏆|成就/, "milestone"],
  // 永恒 / 引擎 / 相变仪 / 存档等 —— 归 system
  [/⏳|⚙|🔒|⚠️|📋|☢️|🌊|检测到|已解锁|已开启/, "system"],
];

/**
 * 推导一条日志的 `kind`（`NEKO.md` §9 的固定枚举）。
 * @param {string} text 日志原文
 * @returns {"crunch"|"buy"|"milestone"|"quantum"|"system"}
 */
export function nekoLogKind(text) {
  const s = String(text ?? "");
  for (const [re, kind] of KIND_RULES) if (re.test(s)) return kind;
  return "system";        // 兜底：不认识的都算 system（**不猜**，宁可粗）
}

/**
 * 把内部日志条目转成 `NEKO.md` §9 的形状 `{ t, kind, text, data }`。
 * @param {{t:number,text:string,kind?:string,data?:object}} entry
 */
export function nekoLogEntry(entry) {
  const text = String(entry?.text ?? "");
  return {
    t: Number(entry?.t) || Date.now(),
    kind: entry?.kind ?? nekoLogKind(text),
    text,
    data: entry?.data ?? {},
  };
}

/**
 * ★★★ `NEKO.md` §5：**只读状态快照**（喂给宿主 `StatePublisher`）。
 *
 * 原则（§5 原文）：「只读、版本化、不暴露可写入口」
 * ⚠️ 字段名我**逐个核对过实际 state**（避免又一份"文档 ≠ 实现"）：
 *   · `entropy` / `particle` / `matter` 在 `resources` 下，其余多数在**顶层** ✓
 *   · `darkMatter` **不存在**（属后续阶段）⇒ 不写进来，**不许编** ✓
 * @param {object} state
 * @param {number} [nowMs] 快照时间（测试可注入，保证可断言）
 */
export function nekoSnapshot(state, nowMs = Date.now()) {
  const r = state?.resources ?? {};
  const num = (v) => (v && typeof v.toNumber === "function" ? v.toNumber() : Number(v) || 0);
  const log = (state?.log ?? []).slice(-40).map(nekoLogEntry);

  // 三项速率：用**引擎已有函数**的原始值（不在这里重算公式 ⇒ 不会与实发脱节 ✓）
  const rates = state?.__nekoRates ?? null;   // 由调用方注入（ui/main 有现成的 rate 函数）

  return {
    schema: NEKO_SNAPSHOT_SCHEMA,
    t: nowMs,
    resources: {
      entropy: num(r.entropy),
      particle: num(r.particle),
      matter: num(r.matter),
      zpe: num(state?.zpe),
      darkEnergy: num(state?.darkEnergy),
      quantum: num(state?.quantum),
      infinityPoints: num(state?.infinityPoints),
      eternityPoints: num(state?.eternityPoints),
      dreamPoints: num(state?.dreamPoints),
    },
    // 速率：没有注入就**给 null**（而不是编一个 0 —— 0 是"真的没产出"的意思 ✗）
    rates: rates ?? null,
    progress: {
      phaseTransmuterUnlocked: state?.phaseTransmuterUnlocked === true,
      brokenInfinity: state?.brokenInfinity === true,
      bigCrunchCount: num(state?.bigCrunchCount),
      quantumPairs: num(state?.quantumPairs),
      zpeMilestones: Object.entries(state?.zpeMilestones ?? {}).filter(([, v]) => v).map(([k]) => k),
      deMilestones: Object.entries(state?.deMilestones ?? {}).filter(([, v]) => v).map(([k]) => k),
      // ★ 档位里程碑：**调既有函数**（它返回对象数组，这里取 id）
      tierMilestones: (state?.__nekoTierMilestones ?? []),
      zpeEngine: {
        unlocked: state?.zpeEngineUnlocked === true,
        level: num(state?.zpeEngineLevel),
      },
      eternityCount: num(state?.eternityCount),
    },
    multipliers: state?.__nekoMultipliers ?? null,
    log,
  };
}

// ══════════════════════════════════════════════════════════
// 动作派发（`NEKO.md` §6 的**动作白名单**）
// ══════════════════════════════════════════════════════════
/**
 * 把宿主下发的一批动作**派发**到引擎上。
 *
 * ══════════════════════════════════════════════════════════
 * 三条硬约束怎么落实（`NEKO.md` §6）
 * ══════════════════════════════════════════════════════════
 * ① **阶段白名单**：每条动作有 `guard(state)`，没到该阶段 ⇒ `rejected`（**不替玩家越门槛**）
 * ② **只走既有购买函数**：`fn` 全部是 engine 的导出（**零自写扣款**）——
 *    这是本项目踩过坑之后的纪律（"自动化与手动双倍发放"）
 * ③ **限流 + 幂等**：
 *    · 限流 = 每批最多 `NEKO_MAX_ACTIONS_PER_TICK` 条，超出的记 `throttled`
 *    · 幂等 = **由购买函数本身保证**（`buyX` 买不起就返回 false ⇒ 重复调用天然不叠加）✓
 *
 * ⚠️ 为什么"幂等"不需要额外记账：我们**从不自己扣钱**，
 *   所以"调用两次"= "买两次"（这在游戏里是**合法行为**，不是重复发放）；
 *   而"重复调用同一条 `doBigCrunch`"也不会多发 —— 大坍缩的收益由深度算出 ✓
 *
 * @param {object} state
 * @param {Array<{type:string, payload?:object}>} actions 宿主给的批次
 * @param {object} api 引擎函数集合（**注入**，便于测试与避免循环依赖）
 * @returns {{applied:number, results:Array<object>, throttled:number}}
 */
export function dispatchNekoActions(state, actions, api) {
  const out = { applied: 0, results: [], throttled: 0 };
  const list = Array.isArray(actions) ? actions : [];
  const cap = api?.maxPerTick ?? 8;
  if (list.length > cap) out.throttled = list.length - cap;

  for (const a of list.slice(0, cap)) {
    const type = String(a?.type ?? "");
    const p = a?.payload ?? {};
    const spec = NEKO_ACTION_SPECS[type];

    // ── 未知动作：**不抛**，报 unknown_action（对面是 LLM，会发奇怪的东西）──
    if (!spec) {
      out.results.push({ type, status: "unknown_action" });
      continue;
    }
    // ── ① 阶段白名单 ──
    if (!evalGuard(spec, state, p, api)) {
      out.results.push({ type, status: "rejected", reason: spec.guardWhy });
      continue;
    }
    // ── ② 只走既有购买函数 ──
    let ok = false, detail = null;
    try {
      const r = spec.fn(state, p, api);
      ok = r === true || r?.ok === true;
      detail = typeof r === "object" && r !== null ? (r.reason ?? null) : null;
    } catch (err) {
      ok = false;
      detail = err?.message ?? String(err);
    }
    if (ok) out.applied++;
    out.results.push({ type, status: ok ? "ok" : "rejected", reason: ok ? null : detail });
  }
  return out;
}

/**
 * 白名单的**唯一实现**（动作名 → 守卫 + 引擎函数）。
 *
 * ⚠️ `api` 由调用方注入（见 `main.js`），**不在这里 import engine** ——
 *   否则 `neko.js` 就有了依赖，而它的定位是"零依赖的接入层"（也避免循环依赖）✓
 * ⚠️ `guard` 一律"保守"：判据不清楚时**拒绝**（宁可少做，不可越界）✓
 */
const NEKO_ACTION_SPECS = {
  buyRepeatable: {
    // ⚠️ id 合法性**问注入的 api**（不在这里抄一份 id 表 —— 抄了就会与 config 脱节 ✗）
    guard: (s, p, api) => typeof p?.id === "string" && api?.hasRepeatable?.(p.id) === true,
    guardWhy: "缺少或未知的升级 id",
    fn: (s, p, api) => api.buyRepeatable(s, p.id, p.max === true),
  },
  buyVoidUpgrade: {
    guard: (s, p, api) => typeof p?.id === "string" && api?.hasVoid?.(p.id) === true,
    guardWhy: "缺少或未知的虚空升级 id",
    fn: (s, p, api) => api.buyVoidUpgrade(s, p.id),
  },
  buyDeUpgrade: {
    guard: (s, p, api) => typeof p?.id === "string" && api?.hasDe?.(p.id) === true,
    guardWhy: "缺少或未知的暗能量升级 id",
    fn: (s, p, api) => api.buyDeUpgrade(s, p.id, p.max === true),
  },
  // ★ ① 无限增幅走它（`ipDouble`）；**未打破无限也能买**（见 K 段 bug #10）
  buyInfinityUpgrade: {
    guard: (s, p, api) => typeof p?.id === "string" && api?.hasInfinity?.(p.id) === true,
    guardWhy: "缺少或未知的无限升级 id",
    fn: (s, p, api) => api.buyInfinityUpgrade(s, p.id).ok === true,
  },
  // ★ 大坍缩：**必须已经打破无限**（打破前是硬顶强制触发，不该由猫娘代按）
  doBigCrunch: {
    guard: (s) => s?.brokenInfinity === true,
    guardWhy: "未打破无限（大坍缩是自动触发的，不该由猫娘代按）",
    fn: (s, p, api) => api.doBigCrunch(s) != null,
  },
  // ★ 永恒：门槛由 `canEternity` 自己判（这里只挡"没到过无限层"）
  doEternity: {
    guard: (s) => s?.brokenInfinity === true,
    guardWhy: "未打破无限（还没到过 ∞ 层）",
    fn: (s, p, api) => api.doEternity(s) != null,
  },
  /**
   * ★ **猫娘的自动化通道**（§6 末尾：不消耗梦想点、不占玩家已买槽位）。
   *
   * ⚠️ 本层**只登记契约、不做实现**，原因有二：
   *   ① 自动化在游戏内的实现是 `isAutoAcquire`（由 `v9` / `m2` / `m5` 推导）
   *      与梦想升级 `autoBuyDe` —— **都有各自的解锁前提**，
   *      猫娘"绕过前提"是**越界**（§6 约束①）⇒ 需要一个**玩家可授予**的开关，
   *      而那是 Neko 页面上还没做的 UI（等 SDK 接入后一起定）
   *   ② 现在硬做，就得在引擎里加一条"猫娘专用自动化"分支 ——
   *      正好是 §6 约束② 想避免的"自己写一套"✗
   * ⇒ 先返回 `rejected` 并**写清原因**（而不是假装成功）✓
   */
  setAuto: {
    guard: () => false,
    guardWhy: "尚未实装（需要玩家可授予的授权开关；见 TODO P9）",
    fn: () => false,
  },
};

/** `guard(state, payload, api)` 的统一调用点（`dispatchNekoActions` 里传 api） */
function evalGuard(spec, state, payload, api) {
  try { return spec.guard(state, payload, api) === true; } catch { return false; }
}


// ══════════════════════════════════════════════════════════
// 宿主桥（**无宿主时全部优雅降级**）
// ══════════════════════════════════════════════════════════

/**
 * 页面里有没有"宿主启动配置"。
 *
 * 判据来自 SDK 源码（`neko-minigame-same-origin-bootstrap.js`）：
 *   宿主模板必须在加载 bootstrap 前吐出一个 `<script id="neko-minigame-host-launch">`（JSON），
 *   bootstrap 会**同步吃掉并删掉**这个节点 ⇒ 所以**它此刻还在**就说明宿主刚启动 ✓
 * ⚠️ 不能只看 `window.lanlan_config` —— 那是**旧式集成**（soccer/badminton 用的），
 *   跟我们这条 SDK 路线不是一回事 ✗
 */
export function nekoHostPresent(doc = globalThis.document) {
  if (!doc?.getElementById) return false;
  if (doc.getElementById("neko-minigame-host-launch")) return true;
  // bootstrap 已经吃掉节点的情况：它会在 window 上留一个 Promise
  return typeof globalThis.nekoMiniGameSameOriginHostReady !== "undefined";
}

/**
 * 造一个**宿主桥**。没有宿主时全部方法都是安全的 no-op。
 *
 * @param {object} opts
 * @param {() => object} opts.getState   取当前 state（**函数**，因为 state 会被整体替换）
 * @param {(phase:string, detail?:object) => void} [opts.onStatus] 连接状态变化（UI 用）
 * @returns 桥对象（`available` 为 false 时方法仍可安全调用 ✓）
 */
export function createNekoBridge({ getState, onStatus } = {}) {
  const status = { available: false, connected: false, capabilities: [], lastError: null };
  const report = (phase, detail) => {
    status.lastError = phase === "error" ? (detail?.message ?? String(detail)) : status.lastError;
    try { onStatus?.(phase, detail); } catch { /* UI 回调不该影响游戏 */ }
  };

  const bridge = {
    /** 宿主在不在（**查询是纯读**，没有副作用） */
    get available() { return status.available; },
    get connected() { return status.connected; },
    get status() { return { ...status, capabilities: [...status.capabilities] }; },

    /**
     * 尝试连接宿主。**没有宿主就立刻返回 false**（不抛、不重试、不阻塞游戏）✓
     *
     * ⚠️ 现在**只做到"探测 + 就绪等待"** —— 真正的 `connect()` 需要：
     *   ① 宿主的注册表里有我们的 `id`/`version`（§8 问题 1，**等对面回话**）
     *   ② `window.createNekoMiniGameSameOriginHost` 的精确签名（**我还没逐字核**）
     *   ⇒ 两者都到位后，只需在这里接上（本层其余部分**不用改**）✓
     */
    async connect() {
      if (status.connected) return true;
      if (!nekoHostPresent()) {
        status.available = false;
        report("absent");
        return false;
      }
      status.available = true;
      report("detected");
      try {
        const ready = globalThis.nekoMiniGameSameOriginHostReady;
        if (ready && typeof ready.then === "function") await ready;
        // ★ 到这里说明宿主侧 bootstrap 已就绪。
        //   ⚠️ 但**注册与 transport 工厂签名未确认** ⇒ 本层在此**停住**，
        //     只上报"已探测到宿主"，不去猜 API（猜错的代价是握手失败 + 对面以为我们坏了）✗
        report("host-ready-but-unregistered");
        return false;
      } catch (err) {
        report("error", err);
        return false;
      }
    },

    /** 推一条日志给宿主（无宿主 ⇒ 丢弃，**不报错**） */
    sendLog(entry) {
      if (!status.connected) return false;
      const e = nekoLogEntry(entry);
      try {
        bridge.__client?.logger?.log?.(`[${e.kind}] ${e.text}`, e.data);
        return true;
      } catch (err) { report("error", err); return false; }
    },

    /** 推一份状态快照（无宿主 ⇒ 丢弃 ✓）*/
    publishSnapshot() {
      if (!status.connected) return false;
      try {
        bridge.__client?.state?.update?.("snapshot", nekoSnapshot(getState?.() ?? {}));
        return true;
      } catch (err) { report("error", err); return false; }
    },
  };
  return bridge;
}
