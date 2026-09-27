// main.js - 程序入口
import GameEngine from './engine.js';
import { SaveManager } from './saveSystem.js';
import { buyVoidUpgrade } from './engine.js';

window.buyVoidUpgrade = buyVoidUpgrade;

window.onload = () => {
    console.log("系统启动：自动转化引擎已上线");
    const loadSuccess = SaveManager.load();
    let engine;
    try {
        engine = new GameEngine(loadSuccess);
    } catch (e) {
        console.error('❌ GameEngine 初始化失败:', e);
        alert('游戏初始化失败，请刷新页面重试。错误详情见控制台。');
        return;
    }
    window.engine = engine;
};

// 重置按钮绑定
document.getElementById('btn-reset').addEventListener('click', () => {
    if (SaveManager.reset()) {
        location.reload();
    }
});