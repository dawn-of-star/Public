# 加成清单（基于**基础公式**逐行导出）

> **状态：⚠️ 待同步（框架仍对，但具体数值/条目可能已被改动覆盖）** —— 最后核对 2025
> ⚠️ 本文是**当时**逐行读 `formulas.js` / `config.js` 的产物 ⇒ 公式改过之后，
>   **条目清单会漂移**。改完公式请回读一遍；`tools/zone-audit.mjs` 与
>   `tools/bonus-*.mjs` 那类工具能自动抓一部分。

> 来源：`src/formulas.js` 与 `src/config.js` 的产出函数**逐行读取**（2025 用户要求 ✓）
> 用途：给我自己和用户一份"谁加成谁、什么形状、上限在哪"的总账 ✓
> 形状约定：**线性** ✓ 多项式安全 ｜ **开根/对数** ✓ 最安全 ｜ **指数** ✗ 需软上限

> ★★★ **术语约定（用户 2026 裁定）**：用户说「**额外乘区**」时，
>   **一概指 a 区（加法区）** —— 即在 `darkEnergyMultiplier` 的 `[ 1 + … ]` 括号里**再加一项**，
>   与已有的 `q²`（量子）**同一形制** ✓ —— **不是**独立乘在整体上的因子。
>   · 为什么不用乘性因子：`darkEnergyMultiplier` 经 `globalMultiplier` **落在环的两端**
>     ⇒ 乘性因子会变成**平方级**环增益（量子那次实测"物质 1e27 的到达时间"4707s→2088s，
>     约 **52 倍加速**，用户判定不可接受 ✗）
>   · 判据：**加法区的常数项**不进 `computeS` 池，且只出现在
>     `∂ln(倍率)/∂ln(DE)` 的**分母**里 ⇒ 环增益反而**下降** ⇒ 安全 ✓
>   （落地例：暗物质 / 第二台相变仪 —— 见 `docs/DARK-MATTER.md`）

---

## 0. 资源产线总览（谁吃谁）

```
熵 ──▶(÷转换阈值 × 转换产出)──▶ 粒子 ──▶(×每粒子物质 × 若干乘区)──▶ 物质
                                                                    │
ZPE ──▶(÷阈值 × 相变仪增益)──▶ 暗能量 ──▶(跨度层 (DE/base)^k)──▶ 物质（第二路）
 │
 └──▶ 量子（对数阶梯）──▶ ZPE 倍率 / 熵倍率 / 跨度幂 k / 每对收益

物质深度 L ──▶(AD 型公式)──▶ 无限点 IP ──▶(AD 型公式)──▶ 永恒点 EP
```

---

## 1. 熵（`entropyRate`，formulas.js:438）

```
熵 = 熵阱(effectiveTraps)
   × 全局加成(globalMultiplier)
   × BASE.trapBaseRate
   × ZPE 倍率(zpeMultiplier)
   × v2（虚空「熵流加速」，×1.5，再 ×第5条机制 voidBoostMult）
   × 量子熵乘数(quantumEntropyMultiplier(q))
   ×【若买 dm3】暗能量倍率(darkEnergyMultiplier)
```
| 加成来源 | 层 | 形状 |
|---|---|---|
| 熵阱等级 / 点击获取熵 | 主面板 | 线性 |
| 计数频率（`countFreqAddTerm`） | 可重复升级 | 线性（**cm2 里程碑使其翻倍** ✓） |
| 梦想点系数（`dreamCoefficient`） | 梦想 | 线性 |
| 暗能量倍率 | 暗能量 | 见 §6（对数/开根族） |
| v2 虚空升级（×1.5） | 虚空 | 常数 ×第5条机制 |
| 量子熵乘数 | 量子 | 见 §5 |

## 2. 粒子（`particleRate`，formulas.js:688）

```
粒子 = 熵 ÷ 转换阈值(threshold) × 转换产出(output) × 粒子时变增幅(particleTimeBoost)
```
**阈值**受：熵转粒子等级 ｜ ZPE 里程碑 m6 ｜ 暗能量里程碑 dm2 ｜ **IC 熵需求倍率** ｜ **坍缩里程碑 cm3（×0.5）** ｜ 虚空 v9
**产出**受：熵转粒子等级（×perLevel）｜ 虚空 v5（+0.5/级）｜ DE 升级「凝聚升华」｜ **cm5 相变仪随 IP**（对数 ✓）

## 3. 物质（`matterRate`，formulas.js:460）

```
物质 = 粒子 × BASE.matterPerParticle
     × mb（kindProduct "matterMul"：物质倍率类升级）
     × 全局加成
     × zf（ZPE 里程碑 m3 ⇒ 把 ZPE 倍率按 0.5 或 1.0 折算进来）
     × v3（虚空「物质重组」×1.5 × 第5条机制）
     × 沉潜蓄能(unspentBoostMult)        ← ∞ 升级 ①：1 + (IP/2)^1.5，封顶 1e3 ✗ 超线性！
     × 跨度(matterSpanMult) = (DE / spanDeBase)^k，k = min(1+0.5165√q, 6.1651)
```

## 4. ZPE（`zpeRate`，formulas.js:563）

```
ZPE = 熵阱
    × 全局加成 × **全局加成（连乘两次 ✗ 待核对是否刻意）**
    × ZPE 基础倍率(zpeBaseMultiplier)     ← 虚空 v1 一族
    × prodMult（虚空 v6 ⇒ 再乘一次 ZPE 倍率；另有 zpeFixedMultiplier 快照）
    × **ZPE 引擎产出倍率**（1 + 0.01×引擎等级 ✓ 线性）
    × ZPE 产出惩罚(zpeProductionPenalty)
```

## 5. 量子（`quantumPerPair` + 门槛阶梯）

```
每对 = 2（买了 pairBoost ⇒ 3）+【cm6 ⇒ +1】
量子个数 q = 2·log20(ZPE/1e10) 形式（门槛阶梯 ×20，买 thresholdFlat ⇒ ×10）
量子作用：q → ZPE 倍率（q³/10 项 ✓）｜ q → 熵倍率 ｜ q → 跨度幂 k = min(1+0.5165√q, 6.1651)
```

## 6. 暗能量（`darkEnergyRate`，formulas.js:614 + 自增长）

```
相变仪：DE/秒 = zpeRate ÷ BASE.darkEnergyThreshold × 相变仪增益
                ×【∞升级 ipToTransmuter：×(1 + perIp × 无限点)】
自增长：d(DE)/dt = DE × a × ln10
        a = a0(0.003112) × 衰减(2^(−(log10DE−30)/8)，下限 aFloor 0.15)
            × qm4(×1.25) × **引擎 deEngineLevelBonus（1 + 0.10×等级 ✓ 线性）**   ← 破∞后段的主引擎
暗能量倍率(darkEnergyMultiplier)：
  倍率 = [ 1 + log2(DE累计)·coeff + q² + (暗物质转化值 − 1) ] × accel × 引擎倍率
         └───────────────── a 区（加法区）─────────────────┘
  a 区现有 **三项**：① DE 自身的对数项 ② 量子 `q²` ③ **暗物质 / 第二台相变仪**（2026 新增）
    ③ 的口径：「第二台相变仪本质是提供**额外乘区**」= 在 a 区再加一个区 ✓
    ⚠️ ③ 的**时序特征**（实测，`tools/dark-matter-lab.mjs --timeline`）：
       它读**暗能量余额**，而 `resetForCollapse` 每次大坍缩都把它置回 1
       ⇒ **每个大坍缩开始时 ③ 恰好为 0**，只有余额长起来后（尤其坍缩前最深那一下）才有量
       ⇒ 它是「**坍缩收尾**」型加成，**不是**「开局加速」型
       ——这是落点选"余额"的**必然结果**（用户裁定：累计无界、更容易爆），不是缺陷 ✓
```

## 7. 无限点（`infinityPointGain`，config.js:2228）—— **AD 型** ✓

```
IP = floor( 10^( log10(物质) / ipDivisor(state) − 0.75 ) × ipBase )
     · `ipDivisor(state)` = min(基准 308.2547, 未来各来源候选) ✓ 钩子已就位（保留"调用与影响"权力 ✓）
     · 其它 IP 来源：量子转 IP（∞升级 `ipFromQuantum`：`floor(peakQuantumRun^1.75)`；2026 由 `^2` 调弱）｜ 长河（ipDouble × 1 ÷ 60，封顶 1 IP/分钟 ✓）
     · IC 通关：每关 +10 阶（3 关 ✓ 可选挑战 ✓）
     · **铸币已彻底删除** ✓（原本是 IP 乘数之一 ✓）
```

## 8. 永恒点（`eternityPointGain`，config.js:486）—— AD 型 ✓

```
EP = floor( 5^( log10(IP) / 308 − 0.7 ) )
⇒ 门槛处（IP = 1e308.25）给 **1 点** ✓（与 AD 第一次永恒的手感一致）
⚠️ 2026 修正：除数一直是 **308**（AD 原文 `308 − Pelle`，Pelle = 0）；门槛原写作 1e280，
   与界面/文档一直写的 1e308.25 不符 ⇒ 已统一到 **308.25**（见 `src/config.js` 的 `ETERNITY`）
```

---

## 9. 全局乘区（`globalMultiplier`，formulas.js:124）

```
全局加成 = (1 + 梦想点 × dreamCoefficient) × 计数频率项 × 暗能量倍率
   ⚠️ 量子**不在这里**（刻意 ✓）：它喂 entropyRate 与 matterRate 两端会变成 Q² 环增益 ✗
   ⚠️ 全局加成在 zpeRate 里**连乘两次** ✗（§4 ✓ 待核对）
```

## 10. 软/硬上限一览（全部要保证**单调** ✓）

| 位置 | 形状 | 现值 |
|---|---|---|
| 物质硬顶（未打破无限） | 硬上限 | 1e308.2547 |
| 过载阈值 | `maxLog10 + 量子×延迟` | config OVERLOAD |
| b（粒子增幅速率） | **阈值软上限** `knee + 超出/(1+超出/span)` ✓ 单调 | knee 0.13 / span 0.09（cm? 可调） |
| 沉潜蓄能 | 硬封顶 | ×1e3 |
| 暗能量**有效量** | 渐近饱和（**暂 knee=300 等效关闭** ✓） | DE_EFF_CAP |
| 长河 | 硬封顶 | 1 IP/分钟 |
| 相变仪（⑤cm5） | 硬封顶 | ×100 |
| IP 除数 | min(候选) | 308.2547 |

## 11. 待定 / 未接线（用户已裁定保留 ✓）

```
· ipDouble（无限增幅）：已改**线性**（+10%/级 ✓）—— 破∞前主要 IP 引擎 ✓
· 无限长河（ipTime）：上限 1 IP/分钟 ✓ —— 破∞前 IP 引擎 ✓
· 自动化类暗能量升级（autoPhase / autoVacuum / autoDeGainBase / autoConvOutput）：
  为「永恒自动化页」预留 ✓ 尚未接线 ✓（已登记在 dead-code-audit 的 KNOWN_UNWIRED ✓）
· 永恒层：EP 消费/里程碑尚未建 ✓（稿子已写好 ✓）
```

## 12. 已知问题（写在清单里，免得忘 ✓）

```
① zpeRate 里全局加成**乘了两次** ✗（待确认是否刻意）
② 沉潜蓄能 1.5 次方**超线性** ✗（我改成线性后被回退过 ✓ 需重新决定）
③ 破∞后仿真在 t≈8h 出现 **NaN**（DE 路径 ✓ 三道守卫未治住 ⇒ 需继续查 ✓）
④ 坍缩刷屏：`start200` 让每次坍缩后物质 = 1e200 ⇒ 该值已满足坍缩条件 ⇒ 死循环 ✗
   （真人不会这么玩 ✓ 但仿真会 ✓ 且它把 DE 反复归零 ✓）
```
