// engine.js - 游戏核心逻辑引擎
import GameState from './state.js';
import { SaveManager } from './saveSystem.js';

// 数值格式化：根据数值大小切换显示方式
function formatNumber(value) {
    if (!(value instanceof Decimal)) value = new Decimal(value);
    if (value.lt(0)) return '0.00';
    if (value.lt(1e7)) {
        return value.toFixed(2);
    } else if (value.lt(1e33)) {
        return value.toExponential(2);
    } else {
        const log10 = value.log10();
        const exponent = log10.toFixed(2);
        return `10^${exponent}`;
    }
}

// UI 映射
const UI = {
    entropy: document.getElementById('val-entropy'),
    matter: document.getElementById('val-matter'),
    particle: document.getElementById('val-particle'),
    trapCount: document.getElementById('trap-count'),
    trapEntropyRate: document.getElementById('trap-entropy-rate'),
    rateEntropy: document.getElementById('rate-entropy'),
    rateParticle: document.getElementById('rate-particle'),
    rateMatter: document.getElementById('rate-matter'),
    entropyRule: document.getElementById('entropy-rule'),
    dreamPoints: document.getElementById('dream-points'),
    globalMultiplier: document.getElementById('global-multiplier'),
    upgParticleLevel: document.getElementById('upg-particle-level'),
    upgParticleCost: document.getElementById('upg-particle-cost'),
    upgMatterLevel: document.getElementById('upg-matter-level'),
    upgMatterCost: document.getElementById('upg-matter-cost'),
    upgEntropyLevel: document.getElementById('upg-entropy-level'),
    upgEntropyCost: document.getElementById('upg-entropy-cost'),
    btnConvert: document.getElementById('btn-convert'),
    btnBuyTrap: document.getElementById('btn-buy-trap'),
    btnUpgParticle: document.getElementById('btn-upg-particle'),
    btnUpgMatter: document.getElementById('btn-upg-matter'),
    btnUpgEntropy: document.getElementById('btn-upg-entropy'),
    valZpe: document.getElementById('val-zpe'),
    rateZpe: document.getElementById('rate-zpe'),
    zpeMultiplier: document.getElementById('zpe-multiplier'),
    milestoneList: document.getElementById('milestone-list'),
    voidUpgradeList: document.getElementById('void-upgrade-list'),
    // 暗能量 UI
    valDE: document.getElementById('val-de'),
    rateDE: document.getElementById('rate-de'),
    deMultiplier: document.getElementById('de-multiplier'),
    deDreamLevel: document.getElementById('de-dream-level'),
    deDreamCost: document.getElementById('de-dream-cost'),
    dePhaseLevel: document.getElementById('de-phase-level'),
    dePhaseCost: document.getElementById('de-phase-cost'),
    deVacuumLevel: document.getElementById('de-vacuum-level'),
    deVacuumCost: document.getElementById('de-vacuum-cost'),
    deTransmuterStatus: document.getElementById('de-transmuter-status'),
    deZpePenalty: document.getElementById('de-zpe-penalty'),
    deMilestoneList: document.getElementById('de-milestone-list'),
    btnDeDream: document.getElementById('btn-de-dream'),
    btnDePhase: document.getElementById('btn-de-phase'),
    btnDeVacuum: document.getElementById('btn-de-vacuum'),
    deOverlay: document.getElementById('de-overlay'),
    deContent: document.getElementById('de-content'),
    btnUnlockTransmuter: document.getElementById('btn-unlock-transmuter'),
    unlockV8: document.getElementById('de-unlock-v8'),
    unlockMatter: document.getElementById('de-unlock-matter'),
    deProgressBar: document.getElementById('de-progress-bar'),
    deProgressText: document.getElementById('de-progress-text'),
    deProgressTime: document.getElementById('de-progress-time'),
    deProgressContainer: document.getElementById('de-progress-container'),
};

// ---------- 虚空升级购买函数（模块级） ----------
export function buyVoidUpgrade(id) {
    const config = GameState.voidUpgradeConfigs[id];
    if (!config) {
        console.warn('未知升级 ID:', id);
        return false;
    }
    if (GameState.voidUpgrades[id]) {
        console.warn('升级已购买');
        return false;
    }

    if (id === 'v9') {
        const allPrev = ['v1','v2','v3','v4','v5','v6','v7','v8'].every(k => GameState.voidUpgrades[k]);
        if (!allPrev) {
            console.warn('需要先购买所有前置虚空升级');
            return false;
        }
        if (GameState.zpe.lt(new Decimal(1e8))) {
            console.warn('需要 1e8 ZPE');
            return false;
        }
        if (GameState.dreamPoints.lt(1)) {
            console.warn('需要至少1梦想点');
            return false;
        }
        GameState.dreamPoints = GameState.dreamPoints.sub(1);
        config.effect();
        GameState.voidUpgrades[id] = true;
        SaveManager.save();
        console.log(`✅ 成功购买 ${config.name}`);
        if (window.engine && typeof window.engine.updateView === 'function') {
            window.engine.updateView();
        }
        return true;
    }

    if (GameState.zpe.lt(config.cost)) {
        console.warn(`ZPE 不足，需要 ${formatNumber(config.cost)}，当前 ${formatNumber(GameState.zpe)}`);
        return false;
    }
    GameState.zpe = GameState.zpe.sub(config.cost);
    config.effect();
    GameState.voidUpgrades[id] = true;
    if (config.rewardDream) {
        GameState.dreamPoints = GameState.dreamPoints.add(1);
    }
    SaveManager.save();
    console.log(`✅ 成功购买 ${config.name}`);
    if (window.engine && typeof window.engine.updateView === 'function') {
        window.engine.updateView();
    }
    return true;
}

// ---------- 购买熵阱 ----------
export function buyEntropyTrap() {
    let cost = GameState.trapCost.current;
    const hasMilestone5 = GameState.zpeMilestones.milestone5;
    const hasV9 = GameState.voidUpgrades.v9;
    const zpeMult = GameState.getZpeMultiplier();

    if (hasMilestone5 && hasV9) {
        const threshold = cost.div(zpeMult);
        const matter = GameState.resources.matter;
        if (matter.gte(threshold)) {
            GameState.resources.traps = GameState.resources.traps.add(1);
            const newCost = GameState.trapCost.base.mul(
                GameState.trapCost.multiplier.pow(GameState.resources.traps)
            );
            GameState.trapCost.current = newCost;
            return true;
        }
        return false;
    } else if (hasMilestone5) {
        cost = cost.div(zpeMult);
    }

    const matter = GameState.resources.matter;
    if (matter.gte(cost)) {
        GameState.resources.matter = matter.sub(cost);
        GameState.resources.traps = GameState.resources.traps.add(1);
        const newCost = GameState.trapCost.base.mul(
            GameState.trapCost.multiplier.pow(GameState.resources.traps)
        );
        GameState.trapCost.current = newCost;
        console.log(`🔄 购买熵阱 (消耗物质) 新价格: ${newCost.toString()}`);
        return true;
    }
    return false;
}

// ---------- 升级购买函数（改造） ----------
function buyParticleBoost() {
    const up = GameState.upgrades.particleBoost;
    let cost = up.getNextCost();
    const hasMilestone2 = GameState.zpeMilestones.milestone2;
    const hasV9 = GameState.voidUpgrades.v9;
    // 使用价格折扣函数（含里程碑4效果）
    const zpeMult = GameState.getEffectiveZpeMultiplierForPrice ? GameState.getEffectiveZpeMultiplierForPrice() : GameState.getZpeMultiplier();

    if (hasMilestone2 && hasV9) {
        const threshold = cost.div(zpeMult);
        if (GameState.resources.particle.gte(threshold)) {
            up.level = up.level.add(1);
            if (!GameState.dreamPointsAwarded.particleBoost) {
                GameState.dreamPoints = GameState.dreamPoints.add(1);
                GameState.dreamPointsAwarded.particleBoost = true;
            }
            return true;
        }
        return false;
    } else if (hasMilestone2) {
        cost = cost.div(zpeMult);
    }
    if (GameState.resources.particle.gte(cost)) {
        GameState.resources.particle = GameState.resources.particle.sub(cost);
        up.level = up.level.add(1);
        if (!GameState.dreamPointsAwarded.particleBoost) {
            GameState.dreamPoints = GameState.dreamPoints.add(1);
            GameState.dreamPointsAwarded.particleBoost = true;
        }
        return true;
    }
    return false;
}

function buyMatterBoost() {
    const up = GameState.upgrades.matterBoost;
    let cost = up.getNextCost();
    const hasMilestone2 = GameState.zpeMilestones.milestone2;
    const hasV9 = GameState.voidUpgrades.v9;
    const zpeMult = GameState.getEffectiveZpeMultiplierForPrice ? GameState.getEffectiveZpeMultiplierForPrice() : GameState.getZpeMultiplier();

    if (hasMilestone2 && hasV9) {
        const threshold = cost.div(zpeMult);
        if (GameState.resources.matter.gte(threshold)) {
            up.level = up.level.add(1);
            if (!GameState.dreamPointsAwarded.matterBoost) {
                GameState.dreamPoints = GameState.dreamPoints.add(1);
                GameState.dreamPointsAwarded.matterBoost = true;
            }
            return true;
        }
        return false;
    } else if (hasMilestone2) {
        cost = cost.div(zpeMult);
    }

    if (GameState.resources.matter.gte(cost)) {
        GameState.resources.matter = GameState.resources.matter.sub(cost);
        up.level = up.level.add(1);
        if (!GameState.dreamPointsAwarded.matterBoost) {
            GameState.dreamPoints = GameState.dreamPoints.add(1);
            GameState.dreamPointsAwarded.matterBoost = true;
        }
        return true;
    }
    return false;
}

function buyEntropyCoeff() {
    const up = GameState.upgrades.entropyCoeff;
    let cost = up.getNextCost();
    const hasMilestone2 = GameState.zpeMilestones.milestone2;
    const hasV9 = GameState.voidUpgrades.v9;
    const zpeMult = GameState.getEffectiveZpeMultiplierForPrice ? GameState.getEffectiveZpeMultiplierForPrice() : GameState.getZpeMultiplier();

    if (hasMilestone2 && hasV9) {
        const threshold = cost.div(zpeMult);
        if (GameState.resources.particle.gte(threshold)) {
            up.level = up.level.add(1);
            if (!GameState.dreamPointsAwarded.entropyCoeff) {
                GameState.dreamPoints = GameState.dreamPoints.add(1);
                GameState.dreamPointsAwarded.entropyCoeff = true;
            }
            return true;
        }
        return false;
    } else if (hasMilestone2) {
        cost = cost.div(zpeMult);
    }
    if (GameState.resources.particle.gte(cost)) {
        GameState.resources.particle = GameState.resources.particle.sub(cost);
        up.level = up.level.add(1);
        if (!GameState.dreamPointsAwarded.entropyCoeff) {
            GameState.dreamPoints = GameState.dreamPoints.add(1);
            GameState.dreamPointsAwarded.entropyCoeff = true;
        }
        return true;
    }
    return false;
}

// ---------- 暗能量升级购买函数 ----------
function buyDreamAnnihilation() {
    if (GameState.dreamAnnihilationLevel.gte(10)) return false;
    const level = GameState.dreamAnnihilationLevel;
    const costMatter = new Decimal(10).pow(new Decimal(10).add(level));
    if (GameState.dreamPoints.lt(1)) return false;
    if (GameState.resources.matter.lt(costMatter)) return false;
    GameState.dreamPoints = GameState.dreamPoints.sub(1);
    GameState.resources.matter = GameState.resources.matter.sub(costMatter);
    GameState.dreamAnnihilationLevel = GameState.dreamAnnihilationLevel.add(1);

        // 首次购买奖励梦想点
    if (!GameState.deFirstPurchase.dreamAnnihilation) {
        GameState.deFirstPurchase.dreamAnnihilation = true;
        GameState.dreamPoints = GameState.dreamPoints.add(1);
        console.log("💭 首次购买梦想烬灭虚无，获得1梦想点！");
    }
    console.log("✅ 升级梦想烬灭虚无");
    SaveManager.save();
    return true;
}

function buyPhaseShift() {
    const level = GameState.phaseShiftLevel;
    const costParticle = new Decimal(100).mul(new Decimal(1.5).pow(level));
    if (GameState.resources.particle.lt(costParticle)) return false;
    GameState.resources.particle = GameState.resources.particle.sub(costParticle);
    GameState.phaseShiftLevel = GameState.phaseShiftLevel.add(1);
        // 首次购买奖励梦想点
    if (!GameState.deFirstPurchase.phaseShift) {
        GameState.deFirstPurchase.phaseShift = true;
        GameState.dreamPoints = GameState.dreamPoints.add(1);
        console.log("💭 首次购买高效相变，获得1梦想点！");
    }
    console.log("✅ 升级高效相变");
    SaveManager.save();
    return true;
}

function buyVacuumAccel() {
    const level = GameState.vacuumAccelLevel;
    const costZPE = new Decimal(1).mul(new Decimal(10).pow(level));
    if (GameState.zpe.lt(costZPE)) return false;
    GameState.zpe = GameState.zpe.sub(costZPE);
    GameState.vacuumAccelLevel = GameState.vacuumAccelLevel.add(1);
        // 首次购买奖励梦想点
    if (!GameState.deFirstPurchase.vacuumAccel) {
        GameState.deFirstPurchase.vacuumAccel = true;
        GameState.dreamPoints = GameState.dreamPoints.add(1);
        console.log("💭 首次购买真空加速，获得1梦想点！");
    }
    console.log("✅ 升级真空加速");
    SaveManager.save();
    return true;
}
// ---------- 游戏引擎 ----------
class GameEngine {
    constructor(isLoaded = false) {
        this.lastTime = performance.now();
        this.isLoaded = isLoaded;
        this.isSaving = false;
        this.lastAutoClickTime = 0;
        this.zpeAccumulator = new Decimal(0);
        this.init();
        this.lastZpeTotal = new Decimal(0);
        this.autoPurchaseTimer = 0;
    }

    init() {
        this.startAutoSave();

        // 原有按钮绑定
        if (UI.btnConvert) {
            UI.btnConvert.addEventListener('click', () => this.handleClick());
        }
        if (UI.btnBuyTrap) {
            UI.btnBuyTrap.addEventListener('click', () => {
                if (buyEntropyTrap()) {
                    console.log("成功购买熵阱！");
                    this.saveIfNotSaving();
                } else {
                    console.log("物质不足！");
                }
            });
        }
        if (UI.btnUpgParticle) {
            UI.btnUpgParticle.addEventListener('click', () => {
                if (buyParticleBoost()) {
                    console.log("全局倍率升级成功！");
                    this.saveIfNotSaving();
                }
            });
        }
        if (UI.btnUpgMatter) {
            UI.btnUpgMatter.addEventListener('click', () => {
                if (buyMatterBoost()) {
                    console.log("物质速率升级成功！");
                    this.saveIfNotSaving();
                }
            });
        }
        if (UI.btnUpgEntropy) {
            UI.btnUpgEntropy.addEventListener('click', () => {
                if (buyEntropyCoeff()) {
                    console.log("熵凝聚升级成功！");
                    this.saveIfNotSaving();
                }
            });
        }

        // 虚空升级事件委托
        if (UI.voidUpgradeList) {
            UI.voidUpgradeList.addEventListener('click', (e) => {
                const btn = e.target.closest('.void-upgrade-btn');
                if (!btn || btn.disabled) return;
                const id = btn.dataset.id;
                if (id && typeof window.buyVoidUpgrade === 'function') {
                    window.buyVoidUpgrade(id);
                    if (window.engine) {
                        window.engine.updateView();
                        window.engine.saveIfNotSaving();
                    }
                } else {
                    console.warn('buyVoidUpgrade 未定义或 id 无效');
                }
            });
        }

        // 暗能量升级按钮
        if (UI.btnDeDream) {
            UI.btnDeDream.addEventListener('click', () => {
                if (buyDreamAnnihilation()) {
                    this.updateView();
                    this.saveIfNotSaving();
                }
            });
        }
        if (UI.btnDePhase) {
            UI.btnDePhase.addEventListener('click', () => {
                if (buyPhaseShift()) {
                    this.updateView();
                    this.saveIfNotSaving();
                }
            });
        }
        if (UI.btnDeVacuum) {
            UI.btnDeVacuum.addEventListener('click', () => {
                if (buyVacuumAccel()) {
                    this.updateView();
                    this.saveIfNotSaving();
                }
            });
        }

        if (this.isLoaded) {
            console.log("检测到历史存档，数据已恢复。");
        }
        if (UI.btnUnlockTransmuter) {
            UI.btnUnlockTransmuter.addEventListener('click', () => {
                if (GameState.phaseTransmuterUnlocked) return;
                const hasV8 = GameState.voidUpgrades.v8;
                const matter = GameState.resources.matter;
                if (hasV8 && matter.gte(new Decimal(1e8))) {
                    GameState.phaseTransmuterUnlocked = true;
                    if (!GameState.deMilestones.m0) {
                        GameState.deMilestones.m0 = true;
                        console.log("🏆 暗能量里程碑0达成");
                    }
                    this.saveIfNotSaving();
                    // 更新UI
                    this.updatePhaseTransmuterUI();
                    // 显示暗能量内容
                    console.log("🌌 相变仪已解锁！");
                }
            });
        }
        requestAnimationFrame((time) => this.loop(time));
    }

    handleClick() {
        const clickGain = GameState.rules.clickGain.mul(GameState.rules.clickGainMultiplier);
        GameState.resources.entropy = GameState.resources.entropy.add(clickGain);
        this.updateView();
        this.saveIfNotSaving();
    }

    // ---------- 里程碑检测 ----------
    checkMilestones() {
        const total = GameState.zpeTotal;
        const configs = GameState.milestoneConfigs;
        const milestones = GameState.zpeMilestones;
        let gained = false;
        for (const key in configs) {
            if (!milestones[key]) {
                if (total.gte(configs[key].require)) {
                    milestones[key] = true;
                    if (configs[key].effect) configs[key].effect();
                    GameState.dreamPoints = GameState.dreamPoints.add(1);
                    gained = true;
                    console.log(`🏆 达成里程碑: ${configs[key].description}`);
                }
            }
        }
        if (gained) this.saveIfNotSaving();
    }

    // ---------- 暗能量里程碑检测 ----------
    checkDEMilestones() {
        const total = GameState.darkEnergyTotal;
        const ms = GameState.deMilestones;
        // 里程碑1: 10
        if (!ms.m1 && total.gte(10)) {
            ms.m1 = true;
            GameState.zpeFixedMultiplier = GameState.zpeFixedMultiplier || new Decimal(1);
            GameState.zpeFixedMultiplier = GameState.zpeFixedMultiplier.mul(2);
            GameState.dreamPoints = GameState.dreamPoints.add(1); // ✅ 奖励梦想点
            console.log("🏆 暗能量里程碑1达成");
            this.saveIfNotSaving();
        }
        // 里程碑2: 100
        if (!ms.m2 && total.gte(100)) {
            ms.m2 = true;
            GameState.deMilestone2Active = true;
            GameState.dreamPoints = GameState.dreamPoints.add(1); // ✅ 奖励梦想点
            console.log("🏆 暗能量里程碑2达成");
            this.saveIfNotSaving();
        }
        // 里程碑3: 1000
        if (!ms.m3 && total.gte(1000)) {
            ms.m3 = true;
            GameState.deMilestone3Active = true;
            GameState.dreamPoints = GameState.dreamPoints.add(1); // ✅ 奖励梦想点
            console.log("🏆 暗能量里程碑3达成");
            this.saveIfNotSaving();
        }
        // 里程碑4: 10000
        if (!ms.m4 && total.gte(10000)) {
            ms.m4 = true;
            GameState.deMilestone4Active = true;
            GameState.dreamPoints = GameState.dreamPoints.add(1); // ✅ 奖励梦想点
            console.log("🏆 暗能量里程碑4达成");
            this.saveIfNotSaving();
        }
        // 里程碑5: 1e10
        if (!ms.m5 && total.gte(new Decimal(1e10))) {
            ms.m5 = true;
            GameState.deMilestone5Active = true;
            GameState.dreamPoints = GameState.dreamPoints.add(1); // ✅ 奖励梦想点
            console.log("🏆 暗能量里程碑5达成");
            this.saveIfNotSaving();
        }
    }
    // ---------- 主循环 ----------
    loop(currentTime) {
        const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1);
        this.lastTime = currentTime;

        this.calculateProduction(deltaTime);
        this.checkAutoConversion();
        this.checkMilestones();
        this.checkDEMilestones();
        this.updateView();

        // 自动点击
        if (GameState.dreamPoints.gte(1)) {
            const now = performance.now();
            if (now - this.lastAutoClickTime >= 1000) {
                const clickGain = GameState.rules.clickGain.mul(GameState.rules.clickGainMultiplier);
                GameState.resources.entropy = GameState.resources.entropy.add(clickGain);
                this.lastAutoClickTime = now;
            }
        }

        // 自动购买检测（每秒）
        this.autoPurchaseTimer += deltaTime;
        if (this.autoPurchaseTimer >= 1) {
            this.autoPurchaseTimer = 0;
            this.checkAutoPurchase();
        }

        requestAnimationFrame((time) => this.loop(time));
    }

    checkAutoPurchase() {
        // 虚空升级 v9 后，自动购买真空加速
        if (GameState.voidUpgrades.v9) {
            const level = GameState.vacuumAccelLevel;
            const costZPE = new Decimal(1).mul(new Decimal(10).pow(level));
            if (GameState.zpe.gte(costZPE)) {
                buyVacuumAccel();
                this.updateView();
                this.saveIfNotSaving();
            }

            // ---- 其他阈值自动获取（里程碑2和5） ----
            const hasM2 = GameState.zpeMilestones.milestone2;
            const hasM5 = GameState.zpeMilestones.milestone5;
            const zpeMult = GameState.getZpeMultiplier();

            // 自动购买熵阱（里程碑5）
            if (hasM5) {
                const cost = GameState.trapCost.current;
                const threshold = cost.div(zpeMult);
                if (GameState.resources.matter.gte(threshold)) {
                    GameState.resources.traps = GameState.resources.traps.add(1);
                    GameState.trapCost.current = GameState.trapCost.base.mul(
                        GameState.trapCost.multiplier.pow(GameState.resources.traps)
                    );
                    console.log("🔄 自动购买熵阱");
                }
            }

            // 自动升级（里程碑2）
            if (hasM2) {
                // 使用与手动购买相同的价格折扣倍率
                const zpeMultForPrice = GameState.getEffectiveZpeMultiplierForPrice ? GameState.getEffectiveZpeMultiplierForPrice() : GameState.getZpeMultiplier();

                // 全局倍率升级
                const upP = GameState.upgrades.particleBoost;
                let costP = upP.getNextCost();
                const thresholdP = costP.div(zpeMultForPrice); // 改用 zpeMultForPrice
                if (GameState.resources.particle.gte(thresholdP)) {
                    upP.level = upP.level.add(1);
                    if (!GameState.dreamPointsAwarded.particleBoost) {
                        GameState.dreamPoints = GameState.dreamPoints.add(1);
                        GameState.dreamPointsAwarded.particleBoost = true;
                    }
                    console.log("🔄 自动升级全局倍率");
                }

                // 物质速率升级
                const upM = GameState.upgrades.matterBoost;
                let costM = upM.getNextCost();
                const thresholdM = costM.div(zpeMultForPrice);
                if (GameState.resources.matter.gte(thresholdM)) {
                    upM.level = upM.level.add(1);
                    if (!GameState.dreamPointsAwarded.matterBoost) {
                        GameState.dreamPoints = GameState.dreamPoints.add(1);
                        GameState.dreamPointsAwarded.matterBoost = true;
                    }
                    console.log("🔄 自动升级物质速率");
                }

                // 熵凝聚升级
                const upE = GameState.upgrades.entropyCoeff;
                let costE = upE.getNextCost();
                const thresholdE = costE.div(zpeMultForPrice);
                if (GameState.resources.particle.gte(thresholdE)) {
                    upE.level = upE.level.add(1);
                    if (!GameState.dreamPointsAwarded.entropyCoeff) {
                        GameState.dreamPoints = GameState.dreamPoints.add(1);
                        GameState.dreamPointsAwarded.entropyCoeff = true;
                    }
                    console.log("🔄 自动升级熵凝聚");
                }
            }

            // 每次自动购买后保存一次（保险）
            if (this.isSaving) return;
            this.isSaving = true;
            SaveManager.save();
            setTimeout(() => this.isSaving = false, 500);
        }
    }

    // ---------- 生产计算 ----------
    calculateProduction(dt) {
        const r = GameState.resources;
        const rates = GameState.productionRates;
        const globalMult = GameState.getGlobalProductionMultiplier();
        const zpeMult = GameState.getZpeMultiplier();

        const entropyMult = GameState.entropyOutputMultiplier;
        const matterMult = GameState.matterConversionMultiplier;

        // ---- 1. 物质生产 ----
        const matterRateMult = GameState.upgrades.matterBoost.getCurrentEffect();
        let matterZpeFactor = new Decimal(1);
        const hasM3 = GameState.zpeMilestones.milestone3;
        const hasV9 = GameState.voidUpgrades.v9;
        if (hasM3) {
            const factor = hasV9 ? 1.0 : 0.5;
            matterZpeFactor = new Decimal(1).add(zpeMult.sub(1).mul(factor));
        }
        const matterGain = r.particle
            .mul(rates.matterPerParticle)
            .mul(matterRateMult)
            .mul(globalMult)
            .mul(matterZpeFactor)
            .mul(matterMult)
            .mul(dt);
        r.matter = r.matter.add(matterGain);

        // ---- 2. 熵阱产熵 ----
        let effectiveTraps = r.traps;
        const hasM4 = GameState.zpeMilestones.milestone4;
        if (hasM4) {
            const bonus = hasV9 ? 2 : 1;
            effectiveTraps = r.traps.mul(new Decimal(1).add(zpeMult.mul(bonus)));
        }
        // 应用里程碑3：暗能量倍率加成熵阱ZPE速度
        let entropyGain = effectiveTraps
            .mul(globalMult)
            .mul(GameState.trapProduction.baseRate)
            .mul(zpeMult)
            .mul(entropyMult)
            .mul(dt);
        if (GameState.deMilestone3Active) {
            const deMult = GameState.getDarkEnergyMultiplier();
            entropyGain = entropyGain.mul(deMult);
        }
        r.entropy = r.entropy.add(entropyGain);

        // ---- 3. ZPE 产出 ----
        let zpeBase = GameState.zpeBaseMultiplier;
        let extraMult = new Decimal(1);
        if (GameState.voidUpgrades.v1) {
            const purchasedCount = Object.values(GameState.voidUpgrades).filter(v => v).length;
            extraMult = new Decimal(1).add(purchasedCount * 10);
        }
        GameState.currentZpeExtraMultiplier = extraMult;
        zpeBase = zpeBase.mul(extraMult);

        let zpeProductionMult = GameState.voidUpgrades.v6 ? zpeMult : new Decimal(1);
        if (GameState.zpeFixedMultiplier) {
            zpeProductionMult = zpeProductionMult.mul(GameState.zpeFixedMultiplier);
        }
        const zpePenalty = GameState.getZpeProductionPenalty();

        const zpeGain = effectiveTraps
            .mul(globalMult)
            .mul(zpeBase)
            .mul(zpeProductionMult)
            .mul(zpePenalty)
            .mul(dt);
        GameState.zpe = GameState.zpe.add(zpeGain);
        GameState.zpeTotal = GameState.zpeTotal.add(zpeGain);

        // ---- 4. 暗能量生成 ----
        if (GameState.phaseTransmuterUnlocked) {
            const actualZpeRate = zpeGain.div(dt); // 实际ZPE速率（未乘dt）
            this.zpeAccumulator = this.zpeAccumulator.add(actualZpeRate.mul(dt));
            const threshold = new Decimal(1e8);
            let baseGainPerConversion = new Decimal(1);
            const phaseMult = new Decimal(1.5).pow(GameState.phaseShiftLevel);
            baseGainPerConversion = baseGainPerConversion.mul(phaseMult);
            if (GameState.deMilestone5Active) {
                const deMult = GameState.getDarkEnergyMultiplier();
                baseGainPerConversion = baseGainPerConversion.mul(deMult);
            }
            let totalGain = new Decimal(0);
            while (this.zpeAccumulator.gte(threshold)) {
                this.zpeAccumulator = this.zpeAccumulator.sub(threshold);
                totalGain = totalGain.add(baseGainPerConversion);
            }
            if (totalGain.gt(0)) {
                GameState.darkEnergy = GameState.darkEnergy.add(totalGain);
                GameState.darkEnergyTotal = GameState.darkEnergyTotal.add(totalGain);
            }
            GameState.currentDarkEnergyRate = actualZpeRate.div(threshold).mul(baseGainPerConversion);
        } else {
            GameState.currentDarkEnergyRate = new Decimal(0);
        }

        // ---- 5. 更新所有显示速率 ----
        // 物质速率（每秒）
        GameState.currentMatterRate = r.particle
            .mul(rates.matterPerParticle)
            .mul(matterRateMult)
            .mul(globalMult)
            .mul(matterZpeFactor)
            .mul(matterMult);

        // 熵阱产熵速率（每秒）
        GameState.currentEntropyRate = effectiveTraps
            .mul(GameState.trapProduction.baseRate)
            .mul(globalMult)
            .mul(zpeMult)
            .mul(entropyMult)
            .mul(GameState.deMilestone3Active ? GameState.getDarkEnergyMultiplier() : 1);

        // ZPE 产出速率（每秒）
        GameState.currentZpeRate = effectiveTraps
            .mul(globalMult)
            .mul(zpeBase)
            .mul(zpeProductionMult)
            .mul(zpePenalty);

        // 陷阱当前速率（用于显示）
        GameState.trapProduction.currentRate = effectiveTraps
            .mul(GameState.trapProduction.baseRate)
            .mul(globalMult)
            .mul(zpeMult)
            .mul(entropyMult);
    }

    // ---------- 自动转化 ----------
    checkAutoConversion() {
        const r = GameState.resources;
        const upgrade3 = GameState.upgrades.entropyCoeff;
        let threshold = upgrade3.getCurrentCostThreshold();
        let output = GameState.rules.autoConvertOutput.add(upgrade3.getExtraOutput());
        const hasM6 = GameState.zpeMilestones.milestone6;
        const hasV9 = GameState.voidUpgrades.v9;
        if (hasM6) {
            const zpeMult = GameState.getZpeMultiplier();
            const divisor = hasV9 ? 2 : 1;
            threshold = threshold.div(zpeMult.mul(divisor));
        }
        // 里程碑2：阈值乘以暗能量倍率，产出乘以暗能量倍率
        if (GameState.deMilestone2Active) {
            const deMult = GameState.getDarkEnergyMultiplier();
            threshold = threshold.mul(deMult);
            output = output.mul(deMult);
        }
        while (r.entropy.gte(threshold)) {
            r.entropy = r.entropy.sub(threshold);
            r.particle = r.particle.add(output);
        }
    }

    // ---------- UI 更新 ----------
    updateView() {
        const r = GameState.resources;
        // ---- 基本资源数值 ----
        UI.entropy.textContent = formatNumber(r.entropy);
        UI.matter.textContent = formatNumber(r.matter);
        UI.particle.textContent = formatNumber(r.particle);
        UI.dreamPoints.textContent = formatNumber(GameState.dreamPoints);
        UI.globalMultiplier.textContent = formatNumber(GameState.getGlobalProductionMultiplier());

        // ---- 速率 ----
        UI.rateEntropy.textContent = `+${formatNumber(GameState.currentEntropyRate)}/s`;
        UI.rateMatter.textContent = `+${formatNumber(GameState.currentMatterRate)}/s`;
        const particleRate = GameState.rules.autoConvertOutput
            .add(GameState.upgrades.entropyCoeff.getExtraOutput())
            .mul(GameState.currentEntropyRate);
        UI.rateParticle.textContent = `+${formatNumber(particleRate)}/分钟`;
        UI.trapEntropyRate.textContent = formatNumber(GameState.trapProduction.currentRate);

        // ---- 熵阱数量（实际生效数量） ----
        let effectiveTraps = r.traps;
        const hasM4 = GameState.zpeMilestones.milestone4;
        const hasV9 = GameState.voidUpgrades.v9;
        if (hasM4) {
            const zpeMult = GameState.getZpeMultiplier();
            const bonus = hasV9 ? 2 : 1;
            effectiveTraps = r.traps.mul(new Decimal(1).add(zpeMult.mul(bonus)));
        }
        UI.trapCount.textContent = `${formatNumber(r.traps)} (实际 ${formatNumber(effectiveTraps)})`;

        // ---- 熵凝聚转化规则 ----
        const up3 = GameState.upgrades.entropyCoeff;
        let threshold = up3.getCurrentCostThreshold();
        const hasM6 = GameState.zpeMilestones.milestone6;
        if (hasM6) {
            const zpeMult = GameState.getZpeMultiplier();
            const divisor = hasV9 ? 2 : 1;
            threshold = threshold.div(zpeMult.mul(divisor));
        }
        // 应用里程碑2（仅显示效果，实际逻辑已在 checkAutoConversion 中处理）
        let displayOutput = GameState.rules.autoConvertOutput.add(up3.getExtraOutput());
        if (GameState.deMilestone2Active) {
            const deMult = GameState.getDarkEnergyMultiplier();
            threshold = threshold.mul(deMult);
            displayOutput = displayOutput.mul(deMult);
        }
        UI.entropyRule.textContent = `消耗 ${formatNumber(threshold)} 熵 → ${formatNumber(displayOutput)} 粒子`;

        // ---- 陷阱购买价格 ----
        let trapCostDisplay = GameState.trapCost.current;
        const hasM5 = GameState.zpeMilestones.milestone5;
        if (hasV9) {
            const zpeMult = GameState.getZpeMultiplier();
            const thresholdDisplay = trapCostDisplay.div(zpeMult);
            UI.btnBuyTrap.textContent = `🕳️ 购买熵阱 (达到 ${formatNumber(thresholdDisplay)} 物质时自动获取)`;
        } else if (hasM5) {
            const zpeMult = GameState.getZpeMultiplier();
            trapCostDisplay = trapCostDisplay.div(zpeMult);
            UI.btnBuyTrap.textContent = `🕳️ 购买熵阱 (花费 ${formatNumber(trapCostDisplay)} 物质)`;
        } else {
            UI.btnBuyTrap.textContent = `🕳️ 购买熵阱 (花费 ${formatNumber(trapCostDisplay)} 物质)`;
        }

        // ---- 升级价格（应用里程碑4） ----
        const up = GameState.upgrades;
        const hasM2 = GameState.zpeMilestones.milestone2;
        // 获取用于价格的ZPE倍率（可能受里程碑4影响）
        const zpeMultForPrice = GameState.getEffectiveZpeMultiplierForPrice ? GameState.getEffectiveZpeMultiplierForPrice() : GameState.getZpeMultiplier();
        const getDisplayCost = (baseCost) => {
            if (hasM2 && hasV9) {
                return { display: baseCost.div(zpeMultForPrice), auto: true };
            }
            if (hasM2) {
                return { display: baseCost.div(zpeMultForPrice), auto: false };
            }
            return { display: baseCost, auto: false };
        };

        let pCost = up.particleBoost.getNextCost();
        let pDisplay = getDisplayCost(pCost);
        UI.upgParticleLevel.textContent = formatNumber(up.particleBoost.level);
        UI.upgParticleCost.textContent = formatNumber(pDisplay.display);
        UI.upgParticleCost.style.color = pDisplay.auto ? '#66ff88' : '';

        let mCost = up.matterBoost.getNextCost();
        let mDisplay = getDisplayCost(mCost);
        UI.upgMatterLevel.textContent = formatNumber(up.matterBoost.level);
        UI.upgMatterCost.textContent = formatNumber(mDisplay.display);
        UI.upgMatterCost.style.color = mDisplay.auto ? '#66ff88' : '';

        let eCost = up.entropyCoeff.getNextCost();
        let eDisplay = getDisplayCost(eCost);
        UI.upgEntropyLevel.textContent = formatNumber(up.entropyCoeff.level);
        UI.upgEntropyCost.textContent = formatNumber(eDisplay.display);
        UI.upgEntropyCost.style.color = eDisplay.auto ? '#66ff88' : '';

        // ---- ZPE 信息 ----
        UI.valZpe.textContent = formatNumber(GameState.zpe);
        UI.rateZpe.textContent = `+${formatNumber(GameState.currentZpeRate)}/s`;
        UI.zpeMultiplier.textContent = formatNumber(GameState.getZpeMultiplier());
        // ZPE 产出倍率详情
        const prodMult = document.getElementById('zpe-prod-multiplier');
        const prodExtra = document.getElementById('zpe-prod-extra');
        if (prodMult) {
            const baseMult = GameState.zpeBaseMultiplier;
            const extraMult = GameState.currentZpeExtraMultiplier || new Decimal(1);
            const zpeMult = GameState.getZpeMultiplier();
            const totalMult = baseMult.mul(extraMult).mul(zpeMult);
            prodMult.textContent = `×${formatNumber(totalMult)}`;
            if (prodExtra) {
                prodExtra.textContent = `(基础 ×${formatNumber(baseMult)} × 额外 ×${formatNumber(extraMult)})`;
            }
        }

        // ---- 暗能量信息 ----
        if (UI.valDE) {
            UI.valDE.textContent = formatNumber(GameState.darkEnergy);
            UI.deMultiplier.textContent = formatNumber(GameState.getDarkEnergyMultiplier());
            // ---- 暗能量进度条 ----
        if (GameState.phaseTransmuterUnlocked) {
            UI.deProgressContainer.style.display = 'block';
            const threshold = new Decimal(1e8);
            const accumulator = this.zpeAccumulator || new Decimal(0);
            // 进度百分比（上限100%）
            const progress = Decimal.min(accumulator.div(threshold), 1);
            const percent = progress.mul(100);
            UI.deProgressBar.style.width = percent.toFixed(2) + '%';
            UI.deProgressText.textContent = percent.toFixed(1) + '%';

            // 预估时间
            const zpeRate = GameState.currentZpeRate || new Decimal(0);
            if (zpeRate.gt(0) && accumulator.lt(threshold)) {
                const remaining = threshold.sub(accumulator);
                const seconds = remaining.div(zpeRate);
                let displayTime;
                if (seconds.lt(60)) {
                    displayTime = seconds.toFixed(1) + ' 秒';
                } else if (seconds.lt(3600)) {
                    displayTime = seconds.div(60).toFixed(1) + ' 分钟';
                } else {
                    displayTime = seconds.div(3600).toFixed(1) + ' 小时';
                }
                UI.deProgressTime.textContent = `预计 ${displayTime} 后转化`;
            } else if (accumulator.gte(threshold)) {
                UI.deProgressTime.textContent = '✨ 即将转化！';
            } else {
                UI.deProgressTime.textContent = '等待ZPE积累...';
            }
        } else {
            UI.deProgressContainer.style.display = 'none';
        }
        }
        // 升级等级与成本
        if (UI.deDreamLevel) {
            UI.deDreamLevel.textContent = GameState.dreamAnnihilationLevel.toString();
            const dreamLevel = GameState.dreamAnnihilationLevel;
            const dreamCostMatter = new Decimal(10).pow(new Decimal(10).add(dreamLevel));
            UI.deDreamCost.textContent = formatNumber(dreamCostMatter);
            // 按钮禁用状态
            const canBuy = GameState.dreamAnnihilationLevel.lt(10) && GameState.dreamPoints.gte(1) && GameState.resources.matter.gte(dreamCostMatter);
            UI.btnDeDream.disabled = !canBuy;
        }
        if (UI.dePhaseLevel) {
            UI.dePhaseLevel.textContent = GameState.phaseShiftLevel.toString();
            const phaseCost = new Decimal(100).mul(new Decimal(1.5).pow(GameState.phaseShiftLevel));
            UI.dePhaseCost.textContent = formatNumber(phaseCost);
            const canBuy = GameState.resources.particle.gte(phaseCost);
            UI.btnDePhase.disabled = !canBuy;
        }
        if (UI.deVacuumLevel) {
            UI.deVacuumLevel.textContent = GameState.vacuumAccelLevel.toString();
            const vacuumCost = new Decimal(1).mul(new Decimal(10).pow(GameState.vacuumAccelLevel));
            UI.deVacuumCost.textContent = formatNumber(vacuumCost);
            const canBuy = GameState.zpe.gte(vacuumCost);
            UI.btnDeVacuum.disabled = !canBuy;
        }

        // 相变仪状态
        if (UI.deTransmuterStatus) {
            UI.deTransmuterStatus.textContent = GameState.phaseTransmuterUnlocked ? '✅ 已解锁' : '🔒 未解锁';
        }
        // ZPE削弱提示
        if (UI.deZpePenalty) {
            if (GameState.darkEnergy.gt(0)) {
                UI.deZpePenalty.textContent = `暗能量 ${formatNumber(GameState.darkEnergy)})`;
            } else {
                UI.deZpePenalty.textContent = '无削弱';
            }
        }

        // ---- 里程碑与虚空升级渲染 ----
        this.renderMilestones();
        this.updateVoidUpgrades();
        this.renderDEMilestones();
        this.updatePhaseTransmuterUI();
    }

    renderDEMilestones() {
        const list = UI.deMilestoneList;
        if (!list) return;
        const configs = [
            { key: 'm0', require: 0, desc: '解锁相变仪' },
            { key: 'm1', require: 10, desc: 'ZPE 倍率 ×2' },
            { key: 'm2', require: 100, desc: '暗能量影响熵凝聚' },
            { key: 'm3', require: 1000, desc: '暗能量加成ZPE速度' },
            { key: 'm4', require: 10000, desc: 'ZPE折扣翻倍' },
            { key: 'm5', require: 1e10, desc: '暗能量加速自身生成' },
        ];
        const milestones = GameState.deMilestones;
        const total = GameState.darkEnergyTotal;
        let html = '';
        for (const cfg of configs) {
            const claimed = milestones[cfg.key];
            const reached = total.gte(new Decimal(cfg.require));
            let statusText = '🔒 未达成';
            let statusClass = 'locked';
            if (claimed) {
                statusText = '✅ 已领取';
                statusClass = 'claimed';
            } else if (reached) {
                statusText = '✨ 可领取';
                statusClass = 'unlocked';
            }
            html += `<div class="de-milestone-item ${claimed ? 'claimed' : ''}">
                <span>${cfg.desc}</span>
                <span class="milestone-status ${statusClass}">${statusText}</span>
            </div>`;
        }
        list.innerHTML = html;
    }

    updateVoidUpgrades() {
        const configs = GameState.voidUpgradeConfigs;
        const purchased = GameState.voidUpgrades;
        const zpe = GameState.zpe;
        const dreamPoints = GameState.dreamPoints;

        for (const id in configs) {
            const cfg = configs[id];
            const isPurchased = purchased[id];
            const isV9 = id === 'v9';

            const btn = document.getElementById(`void-btn-${id}`);
            const costSpan = document.getElementById(`void-cost-${id}`);
            if (!btn) continue;

            let canAfford = false;
            let reason = '';
            if (isV9) {
                const allPrev = ['v1','v2','v3','v4','v5','v6','v7','v8'].every(k => purchased[k]);
                const hasZpe = zpe.gte(new Decimal(1e8));
                const hasDream = dreamPoints.gte(1);
                if (!allPrev) reason = '需先购买所有前置升级';
                else if (!hasZpe) reason = '需 1e8 ZPE';
                else if (!hasDream) reason = '需 1 梦想点';
                else canAfford = true;
            } else {
                const cost = cfg.cost;
                if (zpe.gte(cost)) {
                    canAfford = true;
                } else {
                    reason = `需 ${formatNumber(cost)} ZPE`;
                }
            }

            btn.disabled = isPurchased || !canAfford;
            if (isPurchased) {
                btn.textContent = '✅ 已购买';
                btn.classList.add('purchased');
            } else if (canAfford) {
                btn.textContent = '⚡ 购买';
                btn.classList.remove('purchased');
            } else {
                btn.textContent = `⛔ ${reason}`;
                btn.classList.remove('purchased');
            }

            if (costSpan) {
                const costDisplay = isV9 ? '1 梦想点 + 1e8 ZPE' : formatNumber(cfg.cost) + ' ZPE';
                costSpan.textContent = costDisplay;
            }
        }
    }

    renderMilestones() {
        const list = UI.milestoneList;
        if (!list) return;
        const configs = GameState.milestoneConfigs;
        const milestones = GameState.zpeMilestones;
        const hasV9 = GameState.voidUpgrades.v9;
        let html = '';
        for (const key in configs) {
            const cfg = configs[key];
            const claimed = milestones[key];
            const reached = GameState.zpeTotal.gte(cfg.require);
            let statusText = '🔒 未达成';
            let statusClass = 'locked';
            if (claimed) {
                statusText = '✅ 已领取';
                statusClass = 'claimed';
            } else if (reached) {
                statusText = '✨ 可领取';
                statusClass = 'unlocked';
            }
            let extra = '';
            if (claimed && hasV9 && (key === 'milestone2' || key === 'milestone5')) {
                extra = ' (自动获取)';
            }
            html += `<div class="milestone-item ${claimed ? 'claimed' : ''}">
                <span class="milestone-desc">${cfg.description}${extra}</span>
                <span class="milestone-status ${statusClass}">${statusText}</span>
            </div>`;
        }
        list.innerHTML = html;
    }

    startAutoSave() {
        setInterval(() => this.saveIfNotSaving(), 30000);
        window.addEventListener('beforeunload', () => this.saveIfNotSaving());
    }

    saveIfNotSaving() {
        if (this.isSaving) return;
        this.isSaving = true;
        SaveManager.save();
        setTimeout(() => this.isSaving = false, 500);
    }
    updatePhaseTransmuterUI() {
    const hasV8 = GameState.voidUpgrades.v8;
    const matter = GameState.resources.matter;
    const canUnlock = hasV8 && matter.gte(new Decimal(1e8));

    // 更新状态指示
    if (UI.unlockV8) {
        UI.unlockV8.textContent = hasV8 ? '✅' : '❌';
    }
    if (UI.unlockMatter) {
        UI.unlockMatter.textContent = matter.gte(new Decimal(1e8)) ? '✅' : '❌';
    }

    // 更新按钮
    if (UI.btnUnlockTransmuter) {
        UI.btnUnlockTransmuter.disabled = !canUnlock;
        UI.btnUnlockTransmuter.textContent = canUnlock ? '⚡ 解锁相变仪' : '🔒 解锁相变仪';
    }

    // 如果已经解锁，显示内容，隐藏覆盖层
    if (GameState.phaseTransmuterUnlocked) {
        if (UI.deOverlay) UI.deOverlay.style.display = 'none';
        if (UI.deContent) {
            UI.deContent.style.display = 'block';
            UI.deContent.classList.add('active');
        }
    } else {
        if (UI.deOverlay) UI.deOverlay.style.display = 'block';
        if (UI.deContent) {
            UI.deContent.style.display = 'none';
            UI.deContent.classList.remove('active');
        }
    }
}
}

export default GameEngine;