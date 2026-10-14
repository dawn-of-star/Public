/**
 * src/ui-ic.js —— 「无限挑战（IC）」面板（自包含 ✓ 不动 index.html 与现有渲染逻辑 ✓）
 *
 * 设计依据：第三种设计稿（用户 2025）的「无限挑战」段 ✓
 *   · 作为**无限页面的子页面**（本实现挂在 ZPE 引擎面板的同一父节点后 ✓）
 *   · 7 个条目：熵需求 ×5^(k+1)、通过后无限点跃升一段 ✓
 *   · 条件只有「抵达无限」⇒ 挑战激活期间完成一次大坍缩即通过 ✓
 *
 * AMOLED 风格（项目主风格 ✓）：细线 + h2 小节 + detail 键值行 + stack 列表 + 徽标
 *   · **无图标、无 emoji** ✗（守卫区间 U+2600–27BF 连对勾都算 ✓）
 *   · 卡片只建一次 ✓、每帧只改文本与 class ✓（踩过 hover 闪烁的坑 ✗）
 */
import { INFINITY_CHALLENGES, icEntropyMult, COLLAPSE, crunchThreshold, CRUNCH_AT_LABEL } from "./config.js";
import { abandonInfinityChallenge, startInfinityChallenge, zpeEngineAffordable, tick } from "./engine.js";
// ★★★ 2025：统一科学计数法 `1.00e308`（用户裁定）+ Decimal（要自己造 10^k）
import Decimal from "../dist/break_eternity.esm.js";
// ★★★ 2025：em7 的"下一关还需多久"要格式化时长 ⇒ `fmtTime` ✓
import { sci, fmtTime } from "./format.js";

const $ = (id) => document.getElementById(id);
const fmtInt = (n) => Number(n).toLocaleString("en-US");

let built = false;

export function buildIcUI() {
  if (built) return;
  // ★★ 2025：锚点从 `zpe-engine-content` 换成 `ic-host` ——
  //   用户指定「无限挑战（IC）挪到无限的坍缩里程碑这边」（只挪位置，机制不动 ✓）。
  //   宿主 `<div id="ic-host">` 现在在 `panel-infdeep`（无限 → 坍缩里程碑 · 无限挑战）里。
  //   ⚠️ 稿子原文：「无限挑战…**作为无限页面的子页面存在**」✓ 挪完才符合原设计。
  const host = $("ic-host");
  if (!host) return;

  const h2 = document.createElement("h2");
  h2.style.marginTop = "16px";
  h2.innerHTML = `无限挑战 <span class="badge" id="ic-badge">未开启</span>`;

  const locked = document.createElement("div");
  locked.id = "ic-locked";
  locked.className = "locked";
  locked.innerHTML = `打破无限后开启「无限挑战」
    <div class="cond"><div>挑战期间熵转粒子的熵需求被放大；完成条件只有一条：抵达无限</div></div>`;

  const content = document.createElement("div");
  content.id = "ic-content";
  content.hidden = true;
  // ⚠️⚠️ 这里的数字**一律从 `INFINITY_CHALLENGES` 推、不许写死** ——
  //   我改 IC 时留下了三处**过期文案**（烟测与审计当时都没抓）：
  //     · `0 / 7`（实际 `max = 3`）
  //     · 「每段 36.89 个数量级」（实际 `ipJumpOrders = 10`）
  //     · 「七段正好触及永恒门槛 1e308.25」（现在 3 段 × 10 阶 = 1e30 阶，
  //        远不是"正好触及"——主线 IP 由**深度**提供，IC 只是加成 ✓）
  //   ⇒ 全改成插值 ✓
  content.innerHTML = `
    <div class="detail">
      <div><span>已完成</span><b id="ic-progress" class="glow-gold">0 / ${INFINITY_CHALLENGES.max}</b></div>
      <div><span>当前挑战</span><b id="ic-active" class="glow-accent">无</b></div>
      <div><span>当前熵需求倍率</span><b id="ic-mult" class="glow-dm">x1</b></div>
      <div><span>下一段奖励</span><b id="ic-reward" class="glow-gold">无限点跃升一段</b></div>
    </div>
    <div class="detail" style="margin-top:8px">
      <!-- ⚠️ 用 .glow-accent（存在）—— 原来的 glow-red / 我一度写的 glow-zpe
           在本项目的 CSS 里**都没有定义**（悬空类，不报错但没颜色）✗
           ⚠️ 本注释在**模板字符串内部** ⇒ 不许出现反引号（会提前结束模板）✗ -->
      <div><span>自动完成</span><b id="ic-auto" class="glow-accent">需 em7（第 7 次永恒）</b></div>
    </div>
    <div class="stack" id="ic-list" style="margin-top:10px"></div>
    <p class="note">
      通过条件：挑战激活期间完成一次大坍缩（= 抵达无限）。通过后无限点余额跃升一段
      （每段 **${INFINITY_CHALLENGES.ipJumpOrders} 个数量级**；共 ${INFINITY_CHALLENGES.max} 段）。
    </p>
    <p class="rule">
      熵需求：第 k 次挑战 = x${INFINITY_CHALLENGES.entMult}^k（最高 x${Math.pow(INFINITY_CHALLENGES.entMult, INFINITY_CHALLENGES.max).toLocaleString("en-US")}）。放弃可随时点，不扣任何东西。
    </p>
  `;

  host.appendChild(h2);
  host.appendChild(locked);
  host.appendChild(content);
  built = true;
}

export function renderIc(state) {
  if (!built) buildIcUI();
  const badge = $("ic-badge");
  const locked = $("ic-locked");
  const content = $("ic-content");
  if (!badge || !locked || !content) return;

  const on = !!state?.brokenInfinity;
  badge.textContent = on ? "已开启" : "未开启";
  locked.hidden = on;
  content.hidden = !on;
  if (!on) return;

  const done = state.ic?.completed ?? 0;
  const active = state.ic?.active ?? null;
  $("ic-progress").textContent = `${done} / ${INFINITY_CHALLENGES.max}`;
  $("ic-active").textContent = active == null ? "无" : `第 ${active + 1} 个`;
  $("ic-mult").textContent = `x${fmtInt(icEntropyMult(state))}`;
  $("ic-reward").textContent = done >= INFINITY_CHALLENGES.max
    ? "已全部完成"
    // ★ 2025 统一科学计数法（原 `1e${…}` 有歧义）⇒ 传**值**给 sci
    : `${sci(Decimal.pow(10, 50 + INFINITY_CHALLENGES.ipJumpOrders * (done + 1)))} 一档`;
  // ★★★ 2025 **em7**：挑战会被**自动**依次完成 ⇒ 必须把"下一次什么时候过"写出来，
  //   否则玩家会看到挑战**无声地**变成已完成、完全不知道发生了什么 ✗
  //   ⚠️ 读数全部来自状态（`fastestInfinitySec` / `icAutoTimer`），UI 不自己算时间 ✗
  const autoEl = $("ic-auto");
  if (autoEl) {
    const em7 = (state.eternityCount ?? 0) >= 7;
    const N = Number(state.fastestInfinitySec ?? 0) || 0;
    if (!em7) {
      autoEl.textContent = "自动完成：需 em7（第 7 次永恒）";
    } else if (done >= INFINITY_CHALLENGES.max) {
      autoEl.textContent = "自动完成：已全部完成 ✓";
    } else if (!(N > 0)) {
      autoEl.textContent = "自动完成：**尚无最快无限记录** —— 先手动完成一次无限";
    } else {
      const left = Math.max(0, N - (Number(state.icAutoTimer ?? 0) || 0));
      autoEl.textContent =
        `自动完成：每 ${fmtTime(N)} 一关（最快无限速度）｜下一关还需 ${fmtTime(left)}`;
    }
  }

  // 列表：只在"状态变化"时重建 ✓（否则每帧重建 ⇒ hover 闪烁 ✗）
  const list = $("ic-list");
  const key = `${done}-${active}`;
  if (list.dataset.builtFor !== key) {
    list.innerHTML = "";
    for (let k = 0; k < INFINITY_CHALLENGES.max; k++) {
      const mult = Math.pow(INFINITY_CHALLENGES.entMult, k + 1);
      const isDone = k < done;
      const isActive = active === k;
      const lockedRow = k > done && !isActive;

      const row = document.createElement("div");
      row.className = "btn zone zone-zpe";
      row.style.cursor = "default";
      row.innerHTML =
        `<div class="btn-row"><span class="btn-name">挑战 ${k + 1}</span>` +
        `<span class="btn-lv">${isDone ? "已完成" : isActive ? "进行中" : lockedRow ? "未解锁" : "可开始"}</span></div>` +
        `<div class="btn-desc">熵需求 x${fmtInt(mult)} ｜ 通过后无限点跃升一段` +
        `（${sci(Decimal.pow(10, 50 + INFINITY_CHALLENGES.ipJumpOrders * (k + 1)))} 一档）</div>`;

      if (!isDone && !lockedRow) {
        const b = document.createElement("button");
        b.className = "btn-max";
        b.textContent = isActive ? "放弃" : "开始";
        b.onclick = () => {
          if (isActive) abandonInfinityChallenge(state);
          else startInfinityChallenge(state, k);
          list.dataset.builtFor = "-1";
        };
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    list.dataset.builtFor = key;
  }
}
