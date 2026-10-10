# 技术文档状态索引（2025-最后更新）

> 目的：**一眼看出哪些文档还有效、哪些已作废、以哪份为准**。
> 起因：今天删掉了两个机制（铸币、接线），又改了很多数值/公式 ⇒ 旧文档里有过期表述 ✓

## ✅ 权威（有效，可作为实现依据）

| 文档 | 说明 |
|---|---|
| **ZONES.md** | 11 个乘区 / 50 个 id 的乘区归属（**改乘区必看** ✓） |
| **BONUS-INVENTORY.md** | ★ **加成总账**：8 条产线的全部乘区、来源、形状、上限 + 12 条已知问题 |
| **QUANTUM-MILESTONES.md** | 量子里程碑（qm1~qm7）的定义与阈值 |
| **IP-ECONOMY.md** | 无限点经济（**注意**：IP 公式已改为 AD 型 ✓ 见下"待同步"） |
| **INFINITY-UPGRADES.md** | ∞ 层升级清单（**注意**：`ipDouble` 已改线性、`ipTime` 待删 ✓） |
| **ZPE-ENGINE.md** | ZPE 引擎（**注意**：效果已改线性、价格已改三次方、新增第 5 条机制 ✓） |
| **PROGRESSION.md** | 主线节奏与标尺（**注意**：深度复利已删、tierAccel 已改 1.10 ✓） |
| **NEKO.md** | Neko 集成（待办 ✓ 与本文档无关 ✓） |

## ⚠️ 待同步（内容框架仍对，但**具体数值/机制**已被今天的改动覆盖）

| 文档 | 需要同步的点 |
|---|---|
| IP-ECONOMY.md | IP = `10^(log10(物质)/div − 0.75)` ✓ ｜ `ipDivisor` 钩子 ✓ ｜ 量子转IP / IC 奖励 ✓ |
| INFINITY-UPGRADES.md | `ipDouble` = **线性 +10%/级** ✓ ｜ `unspentBoost` 与 `ipTime` **待删**（清单见下） ✓ |
| ZPE-ENGINE.md | 产出/倍率/DE 三系数 = **线性** ✓ ｜ 价格 = `5×(等级+1)³` ✓ ｜ 第 5 条机制 = `1+0.1·log10(引擎倍率)` 提升前 8 虚空升级 ✓ |
| PROGRESSION.md | 深度复利**已删** ✓ ｜ `tierAccel` = 1.10 ✓ ｜ IC = **3 关可选挑战** ✓ ｜ 铸币**已删** ✓ |
| COLLAPSE-MILESTONES-8.md | 上线方式已定：**方案 A**（新 8 条替换旧 7 条 ✓ 铸币随之删除 ✓）｜ IC 数量已重排为 3 ✓ |
| DEPRECATED-INVENTORY.md | 状态推进：D1 接线**已删** ✓ ｜ D3 铸币**已删** ✓ ｜ D6 深度复利**已删** ✓ ｜ D12 部分完成 ✓ |

## 🗄️ 已作废 / 已归档（保留作历史，**不要作为实现依据** ✗）

| 文档/目录 | 状态 |
|---|---|
| **COINAGE-TIER-ROLES.md** | 铸币已彻底删除 ⇒ 该设计文档**作废** ✓（历史价值：记录过"铸币/档位"的取舍 ✓） |
| **WIRING-NETWORK.md** | 接线子系统已整体删除（代码归档在 `docs/archive/` ✓）⇒ **作废** ✓ |
| **WIRING-STEP1-PLAN.md** | 同上 ⇒ **作废** ✓ |
| **RESONANCE-AND-EXCHANGE.md** | 共振/兑换方案（从未实现 ✗）⇒ **作废** ✓ |
| **R-REPLACEMENT.md** | R 已退休 ⇒ 记录**替换过程**（历史价值高 ✓ 但不作为当前依据 ✓） |
| **docs/archive/** | 已删代码的快照：wiring.js / ui-wiring.js / 两个 wiring lab / runaway lab / infinity-sim / pace-model / post-break-engine-lab 的 `.txt` ✓ |

## 📌 当前唯一未完成的机制删除（清单已备 ✓）

```
unspentBoost（沉潜蓄能）+ ipTime（无限长河）—— 用户裁定直接删除 ✓ 落点清单见上一轮对话（约 40 处、6 文件）
⚠️ 必须**一次做完** ✗（今天三次半删都留下孤儿 ✓ 代价极大 ✓）
```

## 🧪 测试工具现状

```
✅ 47 个脚本全绿 ✓（依赖图 ✅ 可部署 ✓ dom-smoke 12/12 ✓）
🗄️ 三个被删机制破坏的模型类 lab 已归档：infinity-sim / pace-model / post-break-engine-lab ✗
   （它们的内容已残缺 ✓ 若要用需重写 ✓）
```
