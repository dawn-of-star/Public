// saveSystem.js
import GameState from "./state.js";

const SAVE_KEY = 'UniverseClicker_SaveData_v6'; // 版本升级

export const SaveManager = {
    save() {
        try {
            const saveData = {
                version: '6.0',
                resources: {
                    entropy: GameState.resources.entropy.toString(),
                    matter: GameState.resources.matter.toString(),
                    particle: GameState.resources.particle.toString(),
                    traps: GameState.resources.traps.toString()
                },
                trapCost: {
                    current: GameState.trapCost.current.toString()
                },
                upgrades: {
                    particleBoost: { level: GameState.upgrades.particleBoost.level.toString() },
                    matterBoost: { level: GameState.upgrades.matterBoost.level.toString() },
                    entropyCoeff: { level: GameState.upgrades.entropyCoeff.level.toString() }
                },
                dreamPoints: GameState.dreamPoints.toString(),
                dreamPointsAwarded: {
                    particleBoost: GameState.dreamPointsAwarded.particleBoost,
                    matterBoost: GameState.dreamPointsAwarded.matterBoost,
                    entropyCoeff: GameState.dreamPointsAwarded.entropyCoeff
                },
                zpe: GameState.zpe.toString(),
                zpeTotal: GameState.zpeTotal.toString(),
                zpeMilestones: { ...GameState.zpeMilestones },
                voidUpgrades: { ...GameState.voidUpgrades },
                zpeBaseMultiplier: GameState.zpeBaseMultiplier.toString(),
                entropyOutputMultiplier: GameState.entropyOutputMultiplier.toString(),
                matterConversionMultiplier: GameState.matterConversionMultiplier.toString(),
                dreamCoefficient: GameState.dreamCoefficient.toString(),
                zpeMultiplierExtra: GameState.zpeMultiplierExtra.toString(),
                // ===== 新增暗能量系统 =====
                darkEnergy: GameState.darkEnergy.toString(),
                // saveData 中
                deFirstPurchase: { ...GameState.deFirstPurchase },
                darkEnergyTotal: GameState.darkEnergyTotal.toString(),
                dreamAnnihilationLevel: GameState.dreamAnnihilationLevel.toString(),
                phaseShiftLevel: GameState.phaseShiftLevel.toString(),
                vacuumAccelLevel: GameState.vacuumAccelLevel.toString(),
                deMilestones: { ...GameState.deMilestones },
                phaseTransmuterUnlocked: GameState.phaseTransmuterUnlocked
            };
            localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
            console.log("💾 游戏已保存");
        } catch (e) {
            console.error('💾 存档失败:', e);
        }
    },

    load() {
        try {
            const data = localStorage.getItem(SAVE_KEY);
            if (!data) return false;

            const parsed = JSON.parse(data);
            const saved = parsed;

            const r = GameState.resources;
            r.entropy = new Decimal(saved.resources?.entropy || 0);
            r.matter = new Decimal(saved.resources?.matter || 0);
            r.particle = new Decimal(saved.resources?.particle || 0);
            r.traps = new Decimal(saved.resources?.traps || 0);

            if (saved.trapCost?.current) {
                GameState.trapCost.current = new Decimal(saved.trapCost.current);
            } else {
                GameState.trapCost.current = GameState.trapCost.base.mul(
                    GameState.trapCost.multiplier.pow(r.traps)
                );
            }

            const up = GameState.upgrades;
            if (saved.upgrades) {
                if (saved.upgrades.particleBoost)
                    up.particleBoost.level = new Decimal(saved.upgrades.particleBoost.level || 0);
                if (saved.upgrades.matterBoost)
                    up.matterBoost.level = new Decimal(saved.upgrades.matterBoost.level || 0);
                if (saved.upgrades.entropyCoeff)
                    up.entropyCoeff.level = new Decimal(saved.upgrades.entropyCoeff.level || 0);
            }

            if (saved.dreamPoints) {
                GameState.dreamPoints = new Decimal(saved.dreamPoints);
            }
            if (saved.dreamPointsAwarded) {
                GameState.dreamPointsAwarded.particleBoost = saved.dreamPointsAwarded.particleBoost || false;
                GameState.dreamPointsAwarded.matterBoost = saved.dreamPointsAwarded.matterBoost || false;
                GameState.dreamPointsAwarded.entropyCoeff = saved.dreamPointsAwarded.entropyCoeff || false;
            }

            if (saved.zpe) {
                GameState.zpe = new Decimal(saved.zpe);
            } else {
                GameState.zpe = new Decimal(0);
            }
            if (saved.zpeTotal) {
                GameState.zpeTotal = new Decimal(saved.zpeTotal);
            } else {
                GameState.zpeTotal = new Decimal(0);
            }
            if (saved.zpeMilestones) {
                for (const key in GameState.zpeMilestones) {
                    GameState.zpeMilestones[key] = saved.zpeMilestones[key] || false;
                }
            }
            if (saved.voidUpgrades) {
                for (const key in GameState.voidUpgrades) {
                    GameState.voidUpgrades[key] = saved.voidUpgrades[key] || false;
                }
            } else {
                for (const key in GameState.voidUpgrades) {
                    GameState.voidUpgrades[key] = false;
                }
            }

            if (saved.zpeBaseMultiplier) {
                GameState.zpeBaseMultiplier = new Decimal(saved.zpeBaseMultiplier);
            }
            if (saved.entropyOutputMultiplier) {
                GameState.entropyOutputMultiplier = new Decimal(saved.entropyOutputMultiplier);
            }
            if (saved.matterConversionMultiplier) {
                GameState.matterConversionMultiplier = new Decimal(saved.matterConversionMultiplier);
            }
            if (saved.dreamCoefficient) {
                GameState.dreamCoefficient = new Decimal(saved.dreamCoefficient);
            }
            if (saved.zpeMultiplierExtra) {
                GameState.zpeMultiplierExtra = new Decimal(saved.zpeMultiplierExtra);
            }

            // ===== 恢复暗能量系统 =====
            if (saved.darkEnergy) {
                GameState.darkEnergy = new Decimal(saved.darkEnergy);
            } else {
                GameState.darkEnergy = new Decimal(0);
            }
            if (saved.darkEnergyTotal) {
                GameState.darkEnergyTotal = new Decimal(saved.darkEnergyTotal);
            } else {
                GameState.darkEnergyTotal = new Decimal(0);
            }
            if (saved.dreamAnnihilationLevel) {
                GameState.dreamAnnihilationLevel = new Decimal(saved.dreamAnnihilationLevel);
            } else {
                GameState.dreamAnnihilationLevel = new Decimal(0);
            }
            if (saved.phaseShiftLevel) {
                GameState.phaseShiftLevel = new Decimal(saved.phaseShiftLevel);
            } else {
                GameState.phaseShiftLevel = new Decimal(0);
            }
            if (saved.vacuumAccelLevel) {
                GameState.vacuumAccelLevel = new Decimal(saved.vacuumAccelLevel);
            } else {
                GameState.vacuumAccelLevel = new Decimal(0);
            }
            if (saved.deMilestones) {
                for (const key in GameState.deMilestones) {
                    GameState.deMilestones[key] = saved.deMilestones[key] || false;
                }
            } else {
                for (const key in GameState.deMilestones) {
                    GameState.deMilestones[key] = false;
                }
            }
            if (saved.phaseTransmuterUnlocked !== undefined) {
                GameState.phaseTransmuterUnlocked = saved.phaseTransmuterUnlocked;
            } else {
                GameState.phaseTransmuterUnlocked = false;
            }
            if (saved.deFirstPurchase) {
                for (const key in GameState.deFirstPurchase) {
                    GameState.deFirstPurchase[key] = saved.deFirstPurchase[key] || false;
                }
            } else {
                for (const key in GameState.deFirstPurchase) {
                    GameState.deFirstPurchase[key] = false;
                }
            }

            console.log("💾 存档加载成功！");
            return true;
        } catch (e) {
            console.error('❌ 加载存档时发生错误:', e);
            return false;
        }
    },

    reset() {
        if (!confirm('⚠️ 确定要重置宇宙？所有进度将永久丢失！')) return false;

        localStorage.removeItem(SAVE_KEY);
        const r = GameState.resources;
        r.entropy = new Decimal(0);
        r.matter = new Decimal(0);
        r.particle = new Decimal(0);
        r.traps = new Decimal(0);

        GameState.trapCost.current = new Decimal(GameState.trapCost.base);

        const up = GameState.upgrades;
        up.particleBoost.level = new Decimal(0);
        up.matterBoost.level = new Decimal(0);
        up.entropyCoeff.level = new Decimal(0);

        GameState.currentMatterRate = new Decimal(1);
        GameState.currentEntropyRate = new Decimal(1);
        GameState.trapProduction.currentRate = new Decimal(1);

        GameState.dreamPoints = new Decimal(0);
        GameState.dreamPointsAwarded = {
            particleBoost: false,
            matterBoost: false,
            entropyCoeff: false
        };

        GameState.zpe = new Decimal(0);
        GameState.zpeTotal = new Decimal(0);
        for (const key in GameState.zpeMilestones) {
            GameState.zpeMilestones[key] = false;
        }
        for (const key in GameState.voidUpgrades) {
            GameState.voidUpgrades[key] = false;
        }

        GameState.zpeBaseMultiplier = new Decimal(1);
        GameState.entropyOutputMultiplier = new Decimal(1);
        GameState.matterConversionMultiplier = new Decimal(1);
        GameState.dreamCoefficient = new Decimal(0.02);
        GameState.zpeMultiplierExtra = new Decimal(1);

        // 重置暗能量
        GameState.darkEnergy = new Decimal(0);
        GameState.darkEnergyTotal = new Decimal(0);
        GameState.dreamAnnihilationLevel = new Decimal(0);
        GameState.phaseShiftLevel = new Decimal(0);
        GameState.vacuumAccelLevel = new Decimal(0);
        for (const key in GameState.deMilestones) {
            GameState.deMilestones[key] = false;
        }
        GameState.phaseTransmuterUnlocked = false;

        GameState.deFirstPurchase = {
            dreamAnnihilation: false,
            phaseShift: false,
            vacuumAccel: false
        };

        console.log("宇宙已彻底重置");
        return true;
    }
};