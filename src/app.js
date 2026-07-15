// ============================================================
// AetherNarrator · app（入口）.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { STORAGE_KEYS } from "./store.js";
import { deepClone, migrateGameState } from "./utils.js";
import { applyFontSize, applyTheme, changeFontSize, toggleTheme, updateTempLabel } from "./theme.js";
import { loadConfig, loadSaves, loadWorlds, saveApiConfig } from "./storage.js";
import { idbGet } from "./idb.js";
import { clearSourceFile, handleFileSelect } from "./files.js";
import { closeModal, closeStatusPanel, hideStatusPanel, onWorldTypeChange, renderSaveList, renderWorldList, selectStyleRef, showApiModal, showCreateWorldModal, showSettingsModal, showStatusPanel, showWorldDetail, skipTypewriter, switchStatusTab, toggleCustomPrefix, toggleWorldPrefix, updatePlotFreedomLabel } from "./render.js";
import { addLoreEntry, backToHomeAfterGameOver, chooseOption, confirmLoreRevision, confirmRestart, deleteMemory, doRestartConfirmed, continueLatestSave, deleteLoreEntry, deleteSave, deleteWorld, editWorldLore, exportDebugLog, exportMemoryPack, exportStory, generateWorld, goHome, importMemoryPack, loadSave, openLoreReview, rejectLoreRevision, restToNextDay, reviewDeathScene, saveAuthorNote, saveLoreReview, saveTimeConfig, showAuthorNoteModal, showGameSettings, showLoreGraph, showSaveList, showTimeConfigModal, showWorldList, startGame, submitInput, toggleAIEnhanced, toggleLoreSpoiler, toggleLoreSpoilerSettings, togglePinMemory, triggerMemoryPackImport } from "./game.js";

async function init() {
    applyTheme();
    applyFontSize();
    await loadConfig();

    // 逐个加载数据文件，各自独立降级，一个失败不影响其他
    try {
        const res = await fetch("./data/lore_kb.json");
        if (!res.ok) throw new Error("HTTP " + res.status);
        S.loreKB = await res.json();
    } catch (e) { console.warn("lore_kb.json 加载失败:", e.message); S.loreKB = { ip: "默认世界", snippets: [] }; }

    try {
        const res = await fetch("./data/lore_kb_with_embeddings.json");
        if (res.ok) S.loreEmbeddings = await res.json();
    } catch (e) { console.warn("向量知识库加载失败:", e.message); S.loreEmbeddings = null; }

    try {
        const res = await fetch("./data/system_prompt_template.md");
        if (!res.ok) throw new Error("HTTP " + res.status);
        S.systemPromptTemplate = await res.text();
    } catch (e) { console.warn("system_prompt_template.md 加载失败:", e.message); S.systemPromptTemplate = ""; }

    try {
        const res = await fetch("./data/initial_state.json");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const state = await res.json();
        const saved = await idbGet(STORAGE_KEYS.state);
        if (saved) {
            try { S.gameState = JSON.parse(saved); migrateGameState(S.gameState); } catch (e) { S.gameState = deepClone(state); }
        } else {
            S.gameState = deepClone(state);
        }
    } catch (e) { console.warn("initial_state.json 加载失败:", e.message); S.gameState = null; }

    // loreKB 已就绪，现在创建 demo 世界
    await loadWorlds();
    // 存档迁移依赖世界模板（用于旧知识库/行为记忆的兼容复制），必须后加载。
    await loadSaves();

    const savedHistory = await idbGet(STORAGE_KEYS.history);
    if (savedHistory) {
        try { S.conversationHistory = JSON.parse(savedHistory); } catch (e) { S.conversationHistory = []; }
    }
    const savedChat = await idbGet(STORAGE_KEYS.chatHistory);
    if (savedChat) {
        try { S.chatHistory = JSON.parse(savedChat); } catch (e) { S.chatHistory = []; }
    }
    const savedSummary = await idbGet(STORAGE_KEYS.chatSummary);
    if (savedSummary) {
        try { S.chatSummary = JSON.parse(savedSummary); } catch (e) { S.chatSummary = []; }
    }
    renderWorldList();
    renderSaveList();

    // 后台预热 embedding 模型
    if (S.loreEmbeddings && typeof window.transformers !== "undefined") {
        setTimeout(async () => {
            try {
                if (!S.embeddingModel) {
                    S.embeddingModel = await window.transformers.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
                    console.log("Embedding model pre-warmed");
                }
            } catch (e) { console.warn("Embedding model pre-warm failed:", e.message); }
        }, 500);
    }

    // iOS 键盘适配
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", () => {
            document.body.style.height = window.visualViewport.height + "px";
        });
    }
}

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" && e.key !== "Tab") return;
    const openModal = document.querySelector(".modal-overlay.show .modal");
    if (!openModal) return;
    if (e.key === "Escape") {
        e.preventDefault();
        const closeBtn = openModal.querySelector(".modal-close");
        if (closeBtn) closeBtn.click();
        return;
    }
    // Tab 焦点陷阱：在模态内循环
    const focusables = openModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
    }
});

function dispatchEvent(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "statusPanelStop") { e.stopPropagation(); return; }
    if ((el.dataset.event || "click") !== e.type) return; // 仅响应声明的事件类型
    const handler = ACTIONS[action];
    if (typeof handler !== "function") return;
    handler(el, e);
}

document.addEventListener("click", dispatchEvent);

document.addEventListener("change", dispatchEvent);

document.addEventListener("input", dispatchEvent);

const ACTIONS = {
    // 通用 UI
    toggleTheme: () => toggleTheme(),
    showGameSettings: () => showGameSettings(),
    showApiModal: () => showApiModal(),
    showWorldList: () => showWorldList(),
    showSaveList: () => showSaveList(),
    showSettingsModal: () => showSettingsModal(),
    showCreateWorldModal: () => showCreateWorldModal(),
    showStatusPanel: () => showStatusPanel(),
    exportStory: () => exportStory(),
    exportDebugLog: () => exportDebugLog(),
    goHome: () => goHome(),
    submitInput: () => submitInput(),
    hideStatusPanel: () => hideStatusPanel(),
    saveApiConfig: () => saveApiConfig(),
    generateWorld: () => generateWorld(),
    backToHomeAfterGameOver: () => backToHomeAfterGameOver(),
    reviewDeathScene: () => reviewDeathScene(),
    // 模态关闭
    closeModal: (el) => closeModal(el.dataset.modal),
    // 字体
    changeFontSize: (el) => changeFontSize(el.dataset.size),
    // 滑块/下拉
    updateTempLabel: () => updateTempLabel(),
    updatePlotFreedomLabel: (el) => updatePlotFreedomLabel(el.value),
    onWorldTypeChange: (el) => onWorldTypeChange(el.value),
    handleFileSelect: (el, e) => handleFileSelect(e),
    // radio 组
    selectStyleRef: (el) => selectStyleRef(el.value, el.closest(".radio-option")),
    toggleWorldPrefix: (el) => toggleWorldPrefix(el.value === "on", el.closest(".radio-option")),
    toggleCustomPrefix: (el) => toggleCustomPrefix(el.value === "on", el.closest(".radio-option")),
    // 开局
    startGame: (el) => startGame(el.dataset.opts ? JSON.parse(el.dataset.opts) : undefined),
    // 世界详情/存档（动态生成）
    showWorldDetail: (el) => showWorldDetail(el.dataset.id),
    continueLatestSave: (el) => continueLatestSave(el.dataset.id),
    confirmRestart: (el) => confirmRestart(el.dataset.id),
    doRestartConfirmed: () => doRestartConfirmed(),
    restToNextDay: () => restToNextDay(),
    loadSave: (el) => loadSave(el.dataset.id),
    deleteSave: (el) => deleteSave(el.dataset.id),
    deleteWorld: (el) => deleteWorld(el.dataset.id),
    // 状态面板
    closeStatusPanel: () => closeStatusPanel(),
    switchStatusTab: (el) => switchStatusTab(el.dataset.key),
    togglePinMemory: (el) => togglePinMemory(el.dataset.id),
    deleteMemory: (el) => deleteMemory(el.dataset.id),
    exportMemoryPack: () => exportMemoryPack(),
    triggerMemoryPackImport: () => triggerMemoryPackImport(),
    importMemoryPack: (el) => importMemoryPack(el.files && el.files[0]),
    clearSourceFile: () => clearSourceFile(),
    // 选择按钮（修复：此前 choice-chip 仅渲染无监听，点击无效）
    chooseOption: (el) => chooseOption(Number(el.dataset.index)),
    // ★ B2：导演提示 / 持续约束
    showAuthorNoteModal: () => showAuthorNoteModal(),
    saveAuthorNote: () => saveAuthorNote(),
    showTimeConfigModal: () => showTimeConfigModal(),
    saveTimeConfig: () => saveTimeConfig(),
    // ★ B3：知识库编辑面板
    editWorldLore: (el) => editWorldLore(el.dataset.id),
    openLoreReview: () => openLoreReview(),
    addLoreEntry: () => addLoreEntry(),
    deleteLoreEntry: (el) => deleteLoreEntry(el.dataset.idx),
    saveLoreReview: () => saveLoreReview(),
    confirmLoreRevision: () => confirmLoreRevision(),
    rejectLoreRevision: () => rejectLoreRevision(),
    toggleLoreSpoiler: () => toggleLoreSpoiler(),
    toggleLoreSpoilerSettings: () => toggleLoreSpoilerSettings(),
    toggleAIEnhanced: () => toggleAIEnhanced(),
    showLoreGraph: () => showLoreGraph(),
};

document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const el = e.target.closest && e.target.closest("[data-action]");
    if (!el) return;
    const name = el.dataset.action;
    if (name === "statusPanelStop") return; // 该容器仅用于阻止冒泡，不应触发
    const tag = el.tagName;
    // 原生可聚焦元素（button/input/select/textarea/a）由浏览器自行处理，避免重复触发
    if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "A") return;
    e.preventDefault();
    el.click();
});

(function () {
    const area = document.getElementById("fileUploadArea");
    const input = document.getElementById("sourceFile");
    if (area && input) area.addEventListener("click", (e) => { if (e.target === area) input.click(); });
})();

document.getElementById("gameLog").addEventListener("click", () => {
    skipTypewriter();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && document.activeElement !== document.getElementById("playerInput"))) {
        skipTypewriter();
    }
});

const playerInputEl = document.getElementById("playerInput");

if (playerInputEl) {
    playerInputEl.addEventListener("keydown", (e) => {
        if (!e.isComposing && e.key === "Enter") submitInput();
    });
}

init();
