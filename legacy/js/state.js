// state.js - 全局状态与配置中心
// Decimal 已在全局，直接使用

export const GameState = {
    resources: {
        entropy: new Decimal(0),
        matter: new Decimal(0),
        particle: new Decimal(0),
        traps: new Decimal(0)
    },
    trapProduction: {
        baseRate: new Decimal(1),
        currentRate: new Decimal(1)
    },
    trapCost: {
        base: new Decimal("0.1"),
        current: new Decimal("0.1"),
        multiplier: new Decimal(2)
    },
    productionRates: {
        matterPerParticle: new Decimal("0.1"),
        entropyPerMatter: new Decimal("0.1"),
    },
    rules: {
        clickGain: new Decimal(10),
        clickGainMultiplier: new Decimal(1), 
        autoConvertCost: new Decimal(100),
        autoConvertOutput: new Decimal(1)
    },
    dreamPoints: new Decimal(0),
    dreamPointsAwarded: {
        particleBoost: false,
        matterBoost: false,
        entropyCoeff: false
    },
        // ========== 新增 ZPE 相关 ==========
    zpe: new Decimal(0),           // 当前余额
    zpeTotal: new Decimal(0),      // 累计获得总量（用于里程碑检测）
    zpeMilestones: {
        // 每个里程碑是否已领取（true表示已领过，不再重复奖励）
        milestone1: false,
        milestone2: false,
        milestone3: false,
        milestone4: false,
        milestone5: false,
        milestone6: false
    },
    // 里程碑配置（描述、需求、效果函数）
    milestoneConfigs: {
        milestone1: {
            require: new Decimal(10),
            description: '永久提升手动点击熵的获取，+10',
            effect: () => {
                // 永久提升 clickGain +10
                GameState.rules.clickGain = GameState.rules.clickGain.add(10);
            }
        },
        milestone2: {
            require: new Decimal(100),
            description: '所有升级价格除以 ZPE 倍率',
            effect: () => {
                // 标记，在购买升级时动态应用（无需永久存储）
                // 实际逻辑在 engine.js 中判断此里程碑是否已领取
            }
        },
        milestone3: {
            require: new Decimal(500),
            description: 'ZPE 倍率以一半效率影响粒子和物质产出',
            effect: () => {
                // 标记，engine 中判断
            }
        },
        milestone4: {
            require: new Decimal(1000),
            description: 'ZPE 倍率影响熵阱实际生效数量',
            effect: () => {
                // 标记，engine 中判断
            }
        },
        milestone5: {
            require: new Decimal(10000),
            description: '购买熵阱价格除以 ZPE 倍率',
            effect: () => {
                // 标记，engine 中判断
            }
        },
        milestone6: {
            require: new Decimal(1e8),
            description: 'ZPE 倍率除以熵凝聚阈值',
            effect: () => {
                // 标记，engine 中判断
            }
        }
    },
    // ========== 虚空升级 ==========
    voidUpgrades: {
        v1: false, v2: false, v3: false, v4: false,
        v5: false, v6: false, v7: false, v8: false,
        v9: false
    },
    // 虚空升级配置（ID、名称、描述、价格ZPE、奖励梦想点标记）
    voidUpgradeConfigs: {
        v1: {
            name: '虚空过载',
            desc: 'ZPE 产出 ×3',
            cost: new Decimal(20000),
            rewardDream: true,
            effect: () => {
                // 通过乘数实现
                GameState.zpeBaseMultiplier = GameState.zpeBaseMultiplier.mul(3);
            }
        },
        v2: {
            name: '熵流加速',
            desc: '熵产出 ×1.5',
            cost: new Decimal(50000),
            rewardDream: true,
            effect: () => {
                GameState.entropyOutputMultiplier = GameState.entropyOutputMultiplier.mul(1.5);
            }
        },
        v3: {
            name: '物质重组',
            desc: '粒子→物质 ×1.5',
            cost: new Decimal(100000),
            rewardDream: true,
            effect: () => {
                GameState.matterConversionMultiplier = GameState.matterConversionMultiplier.mul(1.5);
            }
        },
        v4: {
            name: '虚空共鸣',
            desc: '梦想点全局倍率系数从 0.02 → 0.08',
            cost: new Decimal(300000),
            rewardDream: true,
            effect: () => {
                GameState.dreamCoefficient = new Decimal(0.08);
            }
        },
        v5: {
            name: '凝聚升华',
            desc: '熵凝聚每级产出增量 +0.5',
            cost: new Decimal(1000000),
            rewardDream: true,
            effect: () => {
                // 直接修改升级配置中的 effectPerLevel
                GameState.upgrades.entropyCoeff.effectPerLevel = GameState.upgrades.entropyCoeff.effectPerLevel.add(0.5);
            }
        },
        v6: {
            name: '虚空汲取',
            desc: 'ZPE 产出 ×5',
            cost: new Decimal(3000000),
            rewardDream: true,
            effect: () => {
                GameState.zpeBaseMultiplier = GameState.zpeBaseMultiplier.mul(5);
            }
        },
        v7: {
            name: '超光速引擎',
            desc: '手动点击 ×5',
            cost: new Decimal(10000000),
            rewardDream: true,
            effect: () => {
                GameState.rules.clickGainMultiplier = GameState.rules.clickGainMultiplier.mul(5);
            }
        },
        v8: {
            name: '虚空永恒',
            desc: 'ZPE 倍率 ×1.5',
            cost: new Decimal(80000000),
            rewardDream: true,
            effect: () => {
                GameState.zpeMultiplierExtra = GameState.zpeMultiplierExtra.mul(1.5);
            }
        },
        v9: {
            name: '传承启迪',
            desc: '消耗1梦想点，所有里程碑效果翻倍，折扣类改为阈值自动获取',
            cost: new Decimal(0), // 实际消耗梦想点
            rewardDream: false,
            effect: () => {
                // 标记 v9 已购买，后续在逻辑中检查
                // 里程碑翻倍效果在计算时动态应用，折扣类改为阈值检查
            }
        }
    },
    // 虚空升级购买后的效果乘数（初始值）
    zpeBaseMultiplier: new Decimal(1),        // V1, V6
    entropyOutputMultiplier: new Decimal(1),  // V2
    matterConversionMultiplier: new Decimal(1), // V3
    dreamCoefficient: new Decimal(0.02),      // V4 会改为 0.08
    zpeMultiplierExtra: new Decimal(1),       // V8

    // ========== 暗能量系统（第三层） ==========
    darkEnergy: new Decimal(0),          // 当前暗能量余额
    darkEnergyTotal: new Decimal(0),     // 累计生成量
    darkEnergyMultiplier: new Decimal(1), // 当前暗能量倍率（用于全局）
    darkEnergyGenRate: new Decimal(0),   // 每秒生成速率（显示用）
    // 升级等级
    dreamAnnihilationLevel: new Decimal(0),   // 梦想烬灭虚无等级 (0-10)
    phaseShiftLevel: new Decimal(0),          // 高效相变等级
    vacuumAccelLevel: new Decimal(0),         // 真空加速等级
    // 暗能量里程碑
    deMilestones: {
        m0: false,
        m1: false,
        m2: false,
        m3: false,
        m4: false,
        m5: false
    },
    // 是否已解锁相变仪
    phaseTransmuterUnlocked: false,
    deFirstPurchase: {
        dreamAnnihilation: false,
        phaseShift: false,
        vacuumAccel: false
    },
    deMilestone4Active: false,
    deMilestone2Active: false,
    deMilestone3Active: false,
    deMilestone5Active: false,
    zpeFixedMultiplier: null,
    // ========== 新增 ZPE 倍率计算 ==========
    getZpeMultiplier() {
        const zpe = this.zpe.gt(0) ? this.zpe : new Decimal(0);
        const logVal = zpe.add(1).log10();
        let mult = new Decimal(1).add(logVal.mul(0.1));
        mult = mult.mul(this.zpeMultiplierExtra);
        return mult;
    },
    getDarkEnergyMultiplier() {
        const de = this.darkEnergy.gt(0) ? this.darkEnergy : new Decimal(0);
        // 对数基数：log2(DE + 1)
        const logVal = de.add(1).log2();
        // 动态系数：从 0.1 到 0.25 渐变，避免前期暴涨
        const logValCoeff = Decimal.min(
            new Decimal(0.1).add(logVal.div(20).mul(0.15)), // 从0.1开始，逐渐提升到0.25
            new Decimal(0.25)
        );
        const mult = new Decimal(1).add(logVal.mul(logValCoeff));
        const accelMult = new Decimal(1.1).pow(this.vacuumAccelLevel);
        return mult.mul(accelMult);
    },
    getZpeProductionPenalty() {
        if (this.darkEnergy.lte(0)) return new Decimal(1);
        const level = this.dreamAnnihilationLevel;
        // 前3级每级减少1/3惩罚，3级后惩罚为0
        let penaltyReduction = Decimal.min(level, 3).div(3);
        // 基础惩罚系数：幂函数，指数0.5，系数0.001
        const baseCoeff = new Decimal(0.001).mul(this.darkEnergy.pow(0.5));
        const penaltyCoeff = baseCoeff.mul(new Decimal(1).sub(penaltyReduction));
        const penalty = new Decimal(1).add(this.darkEnergy.mul(penaltyCoeff));
        // 返回削弱因子（即ZPE产出要除以这个值）
        return new Decimal(1).div(penalty);
    },
    // 修正全局倍率（保持不变）
    getGlobalProductionMultiplier() {
        const dp = this.dreamPoints;
        const particleLevel = this.upgrades.particleBoost.level;
        const coefficient = this.dreamCoefficient;
        const base = new Decimal(1).add(dp.mul(0.02));
        const extra = new Decimal(1).add(particleLevel.mul(0.05));
        const deMult = this.getDarkEnergyMultiplier();
        return base.mul(extra).mul(deMult);
    },
    getEffectiveZpeMultiplierForPrice() {
        // 基础 ZPE 倍率，可能受暗能量里程碑4影响（翻倍）
        let mult = this.getZpeMultiplier();
        if (this.deMilestone4Active) {
        // 暗能量加成：每 1 暗能量提供 0.001 额外折扣倍率
        // 公式：mult = 基础ZPE倍率 × (1 + 暗能量 × 0.001)
            const deBonus = new Decimal(1).add(this.darkEnergy.mul(0.05));
            mult = mult.mul(deBonus);
        }
        return mult;
    },
    upgrades: {
        particleBoost: {
            level: new Decimal(0),
            baseCost: new Decimal(1),
            costMult: new Decimal(2),
            effect: new Decimal(1.1),
            getCurrentEffect() {
                return this.effect.pow(this.level);
            },
            getNextCost() {
                return this.baseCost.mul(this.costMult.pow(this.level));
            }
        },
        matterBoost: {
            level: new Decimal(0),
            baseCost: new Decimal(5),
            costMult: new Decimal(1.5),
            effect: new Decimal(1.125),
            getCurrentEffect() {
                return this.effect.pow(this.level);
            },
            getNextCost() {
                return this.baseCost.mul(this.costMult.pow(this.level));
            }
        },
        entropyCoeff: {
            level: new Decimal(0),
            baseCost: new Decimal(5),
            costMult: new Decimal(1.5),
            effectPerLevel: new Decimal(0.15),
            costPenaltyPerLevel: new Decimal(3),
            getExtraOutput() {
                return this.effectPerLevel.mul(this.level);
            },
            getCurrentCostThreshold() {
                return GameState.rules.autoConvertCost.add(
                    this.costPenaltyPerLevel.mul(this.level)
                );
            },
            getNextCost() {
                return this.baseCost.mul(this.costMult.pow(this.level));
            }
        }
    },
    currentMatterRate: new Decimal(1),
    currentEntropyRate: new Decimal(1)
};

export default GameState;