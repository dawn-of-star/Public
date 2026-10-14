# 代码事实表（**由脚本生成 —— 不要手改**）

> **状态：✅ 权威（机器生成）**
> 生成器：`node tools/config-facts.mjs --write`
> 校验器：`node tools/config-facts.mjs`（**报红而非静默改写** —— 逼人确认机制变更）
> 已接入 `npm test`：本文件与代码不一致时**测试会失败** ✓

## 为什么要这份文件

```
凡是**能从代码问出来**的数字，就不让别的文档持有它 —— 因为手抄必然漂移。
实证（2025 文档整理时实测）：
  · `docs/ZONES.md` 写「ZONES 11 个 / ZONE_OF 50 个 id」 ⇒ 实际 12 / 56 ✗
  · `docs/README-STATUS.md` 那句「脚本全绿」 ⇒ 漏写了 `--strict` 的失败 ✗
⇒ 数字集中到这里 + 自动校验；叙述性文档只写「是什么 / 为什么」 ✓
```

## 事实表

| 项 | 实测 | 备注 |
|---|---|---|
| COLLAPSE_MILESTONES（坍缩里程碑） | **8** | cm1~cm8 |
| TIER_MILESTONES（档位里程碑） | **7** | 与坍缩里程碑**不是一回事** |
| INFINITY_ORDER（∞ 层升级） | **15** | 含置顶的 ipDouble |
| DE_UPGRADES（暗能量升级） | **5** |  |
| DE_MILESTONES（暗能量里程碑） | **7** |  |
| VOID_UPGRADES（虚空升级） | **9** | v1~v9 |
| QUANTUM_MILESTONES（量子里程碑） | **7** | qm1~qm7 |
| ZPE_MILESTONES（ZPE 里程碑） | **6** |  |
| ETERNITY_MILESTONES（永恒里程碑） | **8** | em1~em8 |
| ETERNITY_MILESTONES 占位中 | **1** | em8 |
| DREAM_UPGRADES（梦想升级） | **5** | 其中可重复 1 条 |
| REPEATABLE（可重复升级） | **3** |  |
| INFINITY_CHALLENGES.max（IC 关数） | **3** | 熵需求每关 ×5 |
| INFINITY_CHALLENGES.ipJumpOrders | **10** | 每关无限点跃升阶数 |
| ZONES（乘区） | **13** |  |
| ZONE_OF（id 乘区登记） | **58** | 由 dom-smoke 的「乘区登记」断言守 |
| NEKO.tiers（好感度档位） | **3** | >25 ⇒ ×1.002｜>50 ⇒ ×1.005｜>75 ⇒ ×1.015 |
| NEKO 叠乘总指数 | **1.0221151** | em2 达成后 ×2 加成部分 |
| NEKO_BONUS_DOUBLE（em2 倍率） | **2** |  |
| ETERNITY.goalLog10（永恒门槛） | **308.25** | = 无限点 1e308.25 |
| BASE.offlineCapSeconds（基础上限） | **14400** | = 4 小时 |
| DREAM_BY_ID.offlineCap.maxLevel | **12** | 每级 +1h ⇒ 上限 16h |
| ZPE_ENGINE 字段数 | **6** | baseCostIp, costGrowth, bonusGrowth, bonusBaseLevel, countFreqLevel, steepAfter |
| ZPE_ENGINE.steepAfter | **{"level":2000,"mult":1000000000}** | level=生效级｜mult=**每级再乘的倍率**（ζ = mult^(lv−level+1)，逐级连乘）｜⇒ 生效后每级 +9.272 个数量级 |
| IP_DOUBLE_AD 有 costCap 吗 | **false** | 必须是 **false**（已删除；若变 true 说明价格又被封顶 ⇒ 可买级数会被钉死） |
| IP_DOUBLE_AD 字段 | **base, stepShallow, stepSteep, costIncreaseThreshold, purchasesAtIncrease** |  |
| CLIMB | **{"knee":25,"halvingOrders":100}** | 爬升形状的一次性旋钮（与 climbFactor 一起改） |
| QUANTUM 字段 | **zpeBaseCost, zpeCostGrowth, zpeCostExtraNerf, captureTierFactor, perPair** | ⚠️ **没有 growthRateMax / growthRateHalf** —— 已随 R 退休删除 ✗ |
| QUANTUM.growthRateMax 是否存在 | **false** | 必须是 **false**；若变 true 说明 R 被恢复了 ⇒ 回来重写相关文档 |
| growthRateHalf 是否存在 | **false** | 同上 |
| epMult.costMultTiers | **[5,10,100,500]** |  |
| epMult.costThresholds | **["1e30","1e1000","1e10000",null]** | 末段 null = 永不切换（无封顶） |
| 默认批跑脚本数 | **47** | 权威来源 = `node tools/run-all.mjs --list` |
| tools/ 下脚本总数 | **54** | .mjs + .cjs |
| --strict 已知失败数 | **7** | 见 `docs/TODO.md` M 段（过期断言/坏工具/数值漂移） |

---

## 与本表冲突时的处理

```
① 若**代码是对的**（机制就是这么定的）⇒ 改别的文档来对齐本表 ✓
② 若**代码是错的**（机制本该是文档写的那样）⇒ 改代码，然后 `--write` 重生成本表 ✓
③ 两者都不确定 ⇒ **停下来问用户**（本表只报事实，不判断意图 ✗）
```
