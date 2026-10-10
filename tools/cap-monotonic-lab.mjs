/**
 * tools/cap-monotonic-lab.mjs —— **封顶/软化类函数必须单调**（防复发断言）
 *
 * 为什么要有这个 lab：
 *   2025 我把 `softCapB` 写成 `knee + x·2^(−x/span)` ✗ —— 它"有界"✓ 但**不单调** ✗：
 *   在 x > 1.443·span 之后**原始值越大、封顶后的值越小** ✗✗
 *   ⇒ 结果是"越后期越被惩罚"，与软上限的本意相反 ✗
 *   ⇒ 是 stage-timing 的 `b 随档位增长` 断言抓到的（b(20档) < b(0档) ✗）
 *
 * 本 lab 的规则（对所有封顶函数都适用 ✓）：
 *   ① 单调不减：入参越大 ⇒ 出参不得变小 ✓
 *   ② 有界：拐点 + 跨度是上界 ✓
 *   ③ 拐点以下原样通过（不提前干预）✓
 *   ④ 拐点处平滑（斜率 ≈ 1）✓
 *
 * 用法：node tools/cap-monotonic-lab.mjs [--check]
 */
import Decimal from "../dist/break_eternity.esm.js";
import { DE_SPAN, bThresholdOf, softCapB, tierAccelMult, matterTotalExponent, MATTER_B_KNEE, MATTER_B_KMAX } from "../src/config.js";
import { newState } from "../src/state.js";

const check = process.argv.includes("--check");
const pad = (s, n) => String(s).padEnd(n);
let fails = 0;
const ck = (label, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? "✅" : "❌"} ${pad(label, 52)} ${detail}`); };

const s = newState();
const knee = bThresholdOf(s);
const span = DE_SPAN.bSoftSpan;
console.log("=".repeat(100));
console.log("封顶类函数单调性检查（softCapB）");
console.log("=".repeat(100));
console.log(`  拐点 knee = ${knee.toFixed(6)}｜跨度 span = ${span}｜上界 = ${(knee + span).toFixed(6)}`);
console.log();

if (check) {
  // ① 单调不减：在拐点附近与远离拐点处都要成立（旧公式正是在远处反向 ✗）
  {
    let prev = -Infinity, mono = true, worst = "";
    const grid = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, 1e5, 1e10];
    for (const over of grid) {
      const v = softCapB(knee + over, s);
      if (v < prev - 1e-12) { mono = false; worst = `在 over=${over} 处下降（${prev.toFixed(6)} → ${v.toFixed(6)}）`; }
      prev = v;
    }
    ck("① 单调不减（旧式 x·2^(−x/span) 会在越过峰值后反向下降 ✗）", mono, mono ? `at(1e10) = ${softCapB(knee + 1e10, s).toFixed(6)} ✓` : worst);
  }

  // ② 有界：上界 = knee + span（且真的收敛到它 ✓）
  {
    const big = softCapB(knee + 1e12, s);
    ck("② 有界：封顶值 ≤ knee + span", big <= knee + span + 1e-9, `${big.toFixed(6)} ≤ ${(knee + span).toFixed(6)} ✓`);
    const half = softCapB(knee + span, s);
    ck("② 在 over = span 处已接近上界（半程）", Math.abs(half - (knee + span / 2)) < 1e-6, `${half.toFixed(6)}（应 ${(knee + span / 2).toFixed(6)}）`);
  }

  // ③ 拐点以下原样通过
  {
    const v = softCapB(knee * 0.5, s);
    ck("③ 拐点以下原样通过（不提前干预）", Math.abs(v - knee * 0.5) < 1e-12, `${v.toFixed(6)} = ${(knee * 0.5).toFixed(6)} ✓`);
    ck("③ 恰好等于拐点时 = knee", Math.abs(softCapB(knee, s) - knee) < 1e-12, `${knee.toFixed(6)} ✓`);
  }

  // ④ 拐点处平滑（斜率 ≈ 1 ⇒ 不与线性段产生折点）
  {
    const d = 1e-6;
    const slope = (softCapB(knee + d, s) - softCapB(knee, s)) / d;
    ck("④ 拐点处斜率 ≈ 1（平滑衔接）", Math.abs(slope - 1) < 1e-3, `斜率 = ${slope.toFixed(6)}`);
  }

  // ⑤ ★ 2025 B1 防复发：非有限入参必须落到有限上界，**不许出 NaN**
  //
  //   现场：破∞后坍缩刷屏（TODO B3）⇒ 档位数 7448 ⇒ `1.10^7448 = Infinity` ⇒ b=Infinity
  //   ⇒ 旧 `softCapB` 算 `over/span = Infinity`、`1+over/span = Infinity`
  //   ⇒ Infinity/Infinity = **NaN** ⇒ 粒子/物质全链冻结（stage-timing 的 `物质=1eNaN`）✗
  //   本 lab 原来的网格只到 knee+1e10（全是有限值）⇒ 漏掉了这一类 ✗
  {
    const inf = softCapB(Infinity, s);
    ck("⑤ softCapB(∞) 有限且有界（旧式 ⇒ NaN ✗）", Number.isFinite(inf) && inf <= knee + span + 1e-9, `${inf}`);
    const nan = softCapB(NaN, s);
    ck("⑤ softCapB(NaN) 落回有限上界（不把 NaN 传下去 ✗）", Number.isFinite(nan) && nan <= knee + span + 1e-9, `${nan}`);
    ck("⑤ 与有限大值一致（∞ 不该算出与 1e12 不同的东西）", Math.abs(inf - softCapB(knee + 1e12, s)) < 1e-9,
      `∞ → ${inf.toFixed(6)}｜1e12 → ${softCapB(knee + 1e12, s).toFixed(6)}`);
  }

  // ⑥ ★ 2025 B1 防复发：档位加速倍率也必须**有界**（NaN 的上游）
  {
    const mk = (n) => ({ ...newState(), quantumMilestones: { qm2: true }, bigCrunchCount: n });
    const vals = [0, 5, 12, 20, 24, 100, 1000, 7448, 1e9].map((n) => tierAccelMult(mk(n)));
    const allFinite = vals.every(Number.isFinite);
    const monoUp = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1e-12);
    ck("⑥ tierAccelMult 任意档位数均为有限值（7448 档 ⇒ 旧式 ∞ ✗）", allFinite, `7448 档 = ${tierAccelMult(mk(7448)).toFixed(4)}`);
    ck("⑥ tierAccelMult 单调不减", monoUp, vals.map((v) => v.toFixed(2)).join(" ≤ "));
    ck("⑥ 设计区间（≤24 档）不受软上限干预", Math.abs(tierAccelMult(mk(24)) - Math.pow(DE_SPAN.tierAccel, 24)) < 1e-9,
      `24 档 = ${tierAccelMult(mk(24)).toFixed(4)} vs 原式 ${Math.pow(DE_SPAN.tierAccel, 24).toFixed(4)}`);
  }

  // ⑦ ★ 2025 B7 防复发：b 的软上限**必须随引擎等级放开**（否则引擎的乘法被吃掉 ✗）
  //
  //   现场：原式上界恒为 knee+span = 0.22（与引擎无关）⇒ 是「效果封顶」✗
  //   实测：引擎倍数 1 → 1e12（12 个数量级），softCapB 后 b 只从 0.0335 → 0.22（**6.6 倍**）
  //   ⇒ 引擎接不了「打破无限 → 永恒」的主推进职责 ✗
  //   用户 2025 决策：**用成本曲线控节奏，不要效果封顶**（与 AD 一致：AD 封价格、不封效果）
  {
    const mkE = (lv) => ({ ...newState(), zpeEngineLevel: new Decimal(lv) });
    const upper = (lv) => softCapB(Infinity, mkE(lv));
    const base = upper(0);

    // ① 零回归：0 级必须与改前一致（= knee + span）
    ck("⑦ 引擎 0 级时上界不变（零回归 ✓）", Math.abs(base - (knee + span)) < 1e-9, `${base.toFixed(6)} = ${(knee + span).toFixed(6)}`);

    // ② 必须真的放开：高等级的上界要显著大于 0 级
    const hi = upper(10000);
    ck("⑦ 引擎 1e4 级时上界显著放大（旧式恒 0.22 ✗）", hi > base * 100, `1e4 级 → ${hi.toFixed(1)}（0 级 ${base.toFixed(3)}）`);

    // ③ 引擎倍数要能真的传到 b 上：给它一个巨大 b_raw，看实际放行多少
    const bRaw = 1e6;
    const passed = softCapB(bRaw, mkE(10000)) / softCapB(bRaw, mkE(0));
    ck("⑦ 引擎等级能把 b 的实际放行量放大（关键判据）", passed > 100, `放行倍数 = ${passed.toFixed(1)}×`);

    // ④ 单调不减 & 有界（同族形状的两条老规矩仍然成立）
    const lvs = [0, 1, 10, 100, 1000, 1e4, 1e5, 1e6];
    const ups = lvs.map(upper);
    ck("⑦ 上界随引擎等级单调不减", ups.every((v, i) => i === 0 || v >= ups[i - 1] - 1e-9),
      ups.map((v) => v.toFixed(2)).join(" ≤ "));

    // ⑤ 拐点以下仍原样通过（不提前干预 ✗）
    const st = mkE(1000);
    const below = bThresholdOf(st) * 0.5;
    ck("⑦ 拐点以下仍原样通过", Math.abs(softCapB(below, st) - below) < 1e-12, `${below.toFixed(4)} ✓`);
  }

  // ⑧ ★ 2025 B8：物质层的 b区（指数区）—— **必须单调、有界、0 级零回归**
  //
  //   用户裁定：b区 的成员由引擎控制；背景是"IP 全部来自基础物质，
  //   而 a区 只改高度改不了斜率"，所以要靠取幂改形状。
  //   ⚠️ 红线：k 若无界增长 ⇒ `d log10(物质)/dt = b·k` 随 t 二次增长 ⇒ 有限时间奇点 ✗
  //     （与 ZPE 的 a≥1 同一个病）⇒ 必须**单调饱和**。
  {
    const mkE = (lv) => ({ ...newState(), zpeEngineLevel: new Decimal(lv) });
    const k = (lv) => matterTotalExponent(mkE(lv));
    ck("⑧ 引擎 0 级 ⇒ k = 1（零回归 ✓）", Math.abs(k(0) - 1) < 1e-12, `k(0) = ${k(0)}`);
    const lvs = [0, 1, 10, 100, 1000, MATTER_B_KNEE, 1e4, 1e5, 1e6, 1e9];
    const ks = lvs.map(k);
    ck("⑧ k 单调不减", ks.every((v, i) => i === 0 || v >= ks[i - 1] - 1e-12), ks.map((v) => v.toFixed(2)).join(" ≤ "));
    ck("⑧ k 有界：≤ 1 + kMax（不许 runaway ✗）", ks.every((v) => v <= 1 + MATTER_B_KMAX + 1e-9),
      `最大 ${Math.max(...ks).toFixed(4)} ≤ ${1 + MATTER_B_KMAX}`);
    ck("⑧ knee 处到半程（k ≈ 1 + kMax/2）", Math.abs(k(MATTER_B_KNEE) - (1 + MATTER_B_KMAX / 2)) < 1e-9,
      `k(${MATTER_B_KNEE}) = ${k(MATTER_B_KNEE).toFixed(4)}`);
    ck("⑧ 极端等级仍有限（防 Infinity ⇒ 幂运算污染全链 ✗）", Number.isFinite(k(1e15)), `k(1e15) = ${k(1e15)}`);
  }

  console.log();
  console.log(`  ${fails === 0 ? "全部通过 ✅" : `${fails} 项失败 ❌`}`);
  process.exit(fails ? 1 : 0);
}
