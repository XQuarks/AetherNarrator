// ============================================================
// AetherNarrator · app（入口）.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { STORAGE_KEYS } from "./store.js";
import { warmupEmbeddingWorker } from "./rag.js";
import { deepClone, logError } from "./utils.js";
import { installGlobalErrorGuard } from "./error-guard.js";
import { applyFontSize, applyTheme, changeFontSize, toggleTheme, changeNarrativePacing, changeNarrativeLength, changeReadingSpeed, updateNarrativePacingButtons, updateNarrativeLengthButtons, updateReadingSpeedButtons, toggleHlNames, toggleHlItems, toggleHlDialogue, toggleHlAiMarks } from "./theme.js";
import { loadConfig, loadSaves, loadWorlds, saveApiConfig, applyProviderPreset, resetRunCache, wipeAllSaves, wipeAllData } from "./storage.js";
import { idbGet } from "./idb.js";
import { clearSourceFile, handleFileSelect } from "./files.js";
import { closeModal, closeStatusPanel, hideStatusPanel, renderSaveList, renderWorldList, showApiModal, showCreateWorldModal, showSettingsModal, showSettingsScreen, showStatusPanel, showWorldDetail, skipTypewriter, switchStatusTab, toggleCustomPrefix, toggleWorldPrefix, updatePlotFreedomLabel, updateWorldTempLabel, selectTagPref, onCustomTagInput, collectStylePrefs, showToast, renderEventPanel, showModal, openSaveMenu, openWorldSaveChooser, showEndingTracker, openRewindTurn } from "./render.js";
import { wizardNextStep, wizardPrevStep, wizardSkipStep, gotoWizardStep, selectStyleTemplate, updateNarrativeStyleCount, toggleStyleGridExpand } from "./wizard-editor.js";
import { backToHomeAfterGameOver, chooseOption, confirmRestart, deleteMemory, doRestartConfirmed, exportDebugLog, exportMemoryPack, exportStory, generateWorld, goHome, importMemoryPack, importWorld, showExportWorldChoice, exportWorldChoice, triggerWorldPackImport, restToNextDay, reviewDeathScene, saveAuthorNote, showAuthorNoteModal, showGameSettings, showSaveList, showSaveDetail, returnFromSaveDetail, showWorldList, submitInput, toggleAIEnhanced, togglePinMemory, triggerMemoryPackImport, switchTimeline, showPlayerNoteModal, savePlayerNote, showPreviewModal, handlePredictBranches, saveWorldModules, removeBannedSentence, ignoreBannedTerm, regenerateTurn, startPrivateChat, endPrivateChat, requestDaily, commitChannelAction, addContactChannelRow, removeContactChannelRow, rewindToTurnInGame } from "./game.js";
import { continueLatestSave, deleteSave, deleteWorld, loadSave, startGame, createOrUpdateSave, saveCurrentSlot, saveAsNewSave } from "./save.js";
import { triggerWorldCritic, confirmCriticRevision, rejectCriticRevision } from "./critic.js";
import { addLoreEntry, confirmLoreRevision, deleteLoreEntry, editWorldLore, editSaveLore, openLoreReview, rejectLoreRevision, saveLoreReview, toggleLoreRequireConfirm, extractAndMergeSourceLore, syncTimeConfigFromDOM, updateTimeConflictBadge, regenerateOpening, applyOpeningFix, rejectOpeningFix, optimizeOpening, updateTcTempLabel, refreshCustomCalendarEditor, refreshMultiverseEditor, timeStructChanged, mvAddLine, mvDelLine, mvSetActive, mvRenameId, mvRenName, mvCalChanged, mvRenEra, mvRenDate, mvRenWeather, mvMoveLine, mvTpl, defaultStrategyChanged, mvLineStrategy, mvAddSync, mvDelSync, mvSyncRef, mvSyncRatio, ccAddMonth, ccDelMonth, ccMoveMonth, ccRenMonthName, ccRenMonthDays, ccRenLabel, ccLeapMonth, ccPreset, ccClearMonths } from "./lore-ui.js";
import { openRuleEditor, addRule, deleteRule, ruleTypeChange, selectRuleType, importBannedAsRules, saveRuleReview, openCharacterEditor, addCharacter, deleteCharacter, saveCharacterReview, generateCharactersAI, openVariableEditor, addVariable, deleteVariable, saveVariableReview, openItemEditor, addItem, deleteItem, saveItemReview, openDeadlineEditor, addDeadline, deleteDeadline, dlPolicyChanged, saveDeadlineReview, setRuleFilter } from "./lore-editors.js";
import { clearLoreAnnCache } from "./ann-index.js";
import { isModuleEnabled } from "./modules.js"; // ★ 事件系统：支线事件门禁判断

// 小工具（docs/34 #7 消重）：fetch 数据文件，失败时告警并返回兜底值，各文件独立降级互不影响
async function fetchDataSafe(url, fallback, asText = false) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return asText ? await res.text() : await res.json();
    } catch (e) { console.warn(url + " 加载失败:", e.message); return fallback; }
}

// 小工具（docs/34 #7 消重）：读 IndexedDB 并 JSON.parse，缺失/损坏返回兜底值
async function idbGetJson(key, fallback) {
    const raw = await idbGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
}

async function init() {
    installGlobalErrorGuard();
    applyTheme();
    applyFontSize();
    // ★ P0：初始化时同步叙事节奏/字数/阅读速度的按钮高亮态
    updateNarrativePacingButtons();
    updateNarrativeLengthButtons();
    updateReadingSpeedButtons();
    await loadConfig();

    // 逐个加载数据文件，各自独立降级，一个失败不影响其他
    S.loreKB = await fetchDataSafe("./data/lore_kb.json", { ip: "默认世界", snippets: [] });
    S.loreEmbeddings = await fetchDataSafe("./data/lore_kb_with_embeddings.json", null);
    S.systemPromptTemplate = await fetchDataSafe("./data/system_prompt_template.md", "", true);

    const initialState = await fetchDataSafe("./data/initial_state.json", null);
    if (initialState) {
        // 优先用已存档的运行时状态，缺失/损坏则回退初始状态模板
        S.gameState = await idbGetJson(STORAGE_KEYS.state, null) || deepClone(initialState);
    } else {
        S.gameState = null;
    }

    // loreKB 已就绪，现在创建 demo 世界
    await loadWorlds();
    // 存档迁移依赖世界模板（用于旧知识库/行为记忆的兼容复制），必须后加载。
    await loadSaves();

    const savedHistory = await idbGetJson(STORAGE_KEYS.history, null);
    if (savedHistory) S.conversationHistory = savedHistory;
    const savedChat = await idbGetJson(STORAGE_KEYS.chatHistory, null);
    if (savedChat) S.chatHistory = savedChat;
    const savedSummary = await idbGetJson(STORAGE_KEYS.chatSummary, null);
    if (savedSummary) S.chatSummary = savedSummary;
    renderWorldList();
    renderSaveList();

    // 后台预热 embedding 模型（★ P0-3-E：改在 Web Worker 内加载，主线程不卡 UI）
    setTimeout(() => { try { warmupEmbeddingWorker(); } catch (e) { /* Worker 不可用则运行时回落主线程 */ } }, 800);

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

// 下拉菜单：点击菜单项或外部区域时自动关闭
document.addEventListener("click", (e) => {
    const openDds = document.querySelectorAll(".dropdown.open");
    if (!openDds.length) return;
    if (e.target.closest(".dropdown-item") || !e.target.closest(".dropdown")) {
        openDds.forEach(d => d.classList.remove("open"));
    }
});

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
    showSettingsScreen: () => showSettingsScreen(),
    showCreateWorldModal: () => showCreateWorldModal(),
    showStatusPanel: () => showStatusPanel(),
    showEndingTracker: () => showEndingTracker(),
    setRuleFilter: (el) => setRuleFilter(el),
    exportStory: () => exportStory(),
    exportDebugLog: () => exportDebugLog(),
    // 设置界面：清除向量索引缓存（两次点击确认，禁用原生 confirm）
    clearAnnCache: (el) => handleClearAnnCache(el),
    // 设置界面·数据管理：清除游戏缓存 / 删除全部存档 / 完全重置（两次点击确认）
    clearRunCache: (el) => handleDataManage(el, "cache"),
    wipeAllSaves: (el) => handleDataManage(el, "saves"),
    resetAllData: (el) => handleDataManage(el, "all"),
    goHome: () => goHome(),
    submitInput: () => submitInput(),
    hideStatusPanel: () => hideStatusPanel(),
    saveApiConfig: () => saveApiConfig(),
    generateWorld: () => generateWorld(),
    // 下拉菜单开关（⋯ 更多）
    toggleDropdown: (el) => { const dd = el.closest(".dropdown"); if (dd) dd.classList.toggle("open"); },
    // 类 select 风格的下拉：点 item 后关菜单 + 同步 trigger 文本 + 切 sub
    selectRule: (el) => {
        const dd = el.closest(".dropdown-select");
        if (!dd) return;
        // 1) 同步 trigger label
        const label = dd.querySelector(".dropdown-label");
        if (label) label.textContent = el.textContent.trim();
        // 2) 标记 selected
        dd.querySelectorAll(".dropdown-item").forEach(it => it.classList.toggle("selected", it === el));
        // 3) 关闭菜单
        dd.classList.remove("open");
        // 4) 切 sub（直接调 lore-editors 的快路径，避免伪造 el.closest）
        const row = dd.closest(".rule-row");
        const idx = parseInt(el.dataset.idx);
        const kind = el.dataset.kind;
        const value = el.dataset.value;
        if (typeof selectRuleType === "function") {
            selectRuleType(row, kind, idx, value);
        }
    },
    backToHomeAfterGameOver: () => backToHomeAfterGameOver(),
    reviewDeathScene: () => reviewDeathScene(),
    // 模态关闭
    closeModal: (el) => closeModal(el.dataset.modal),
    // ★ C4：玩家备注 + 分支前瞻
    showPlayerNoteModal: () => showPlayerNoteModal(),
    savePlayerNote: () => savePlayerNote(),
    showPreviewModal: () => showPreviewModal(),
    predictBranches: () => handlePredictBranches(),
    // 字体
    changeFontSize: (el) => changeFontSize(el.dataset.size),
    changeNarrativePacing: (el) => changeNarrativePacing(el.dataset.mode),
    changeNarrativeLength: (el) => changeNarrativeLength(el.dataset.mode),
    changeReadingSpeed: (el) => changeReadingSpeed(el.dataset.mode),
    // 滑块/下拉
    updatePlotFreedomLabel: (el) => updatePlotFreedomLabel(el.value),
    updateWorldTempLabel: () => updateWorldTempLabel(),
    worldTempChanged: () => updateTcTempLabel(),
    // ★ docs/58：世界类型下拉已移除，onWorldTypeChange 不再存在
    onProviderChange: (el) => applyProviderPreset(el.value),
    handleFileSelect: (el, e) => handleFileSelect(e),
    // ★ docs/62：创建向导分步导航（上一步/下一步/跳过/步骤条回跳）
    wizardNextStep: () => wizardNextStep(),
    wizardPrevStep: () => wizardPrevStep(),
    wizardSkipStep: () => wizardSkipStep(),
    wizardGotoStep: (el) => gotoWizardStep(parseInt(el.dataset.step, 10)),
    selectStyleTemplate: (el) => selectStyleTemplate(el.dataset.preset),
    toggleStyleGridExpand: () => toggleStyleGridExpand(),
    onNarrativeStyleInput: () => updateNarrativeStyleCount(),
    selectTagPref: (el) => selectTagPref(el),
    onCustomTagInput: (el) => onCustomTagInput(el),
    toggleWorldPrefix: (el) => toggleWorldPrefix(el.value === "on", el.closest(".radio-option")),
    toggleCustomPrefix: (el) => toggleCustomPrefix(el.value === "on", el.closest(".radio-option")),
    // 开局
    startGame: (el) => startGame(el.dataset.opts ? JSON.parse(el.dataset.opts) : undefined),
    // 世界详情/存档（动态生成）
    showWorldDetail: (el) => showWorldDetail(el.dataset.id),
    // ★ docs/58：世界类型编辑动作已移除（editWorldType / onEditWorldTypeChange / saveWorldTypeEdit）
    continueLatestSave: (el) => continueLatestSave(el.dataset.id),
    confirmRestart: (el) => confirmRestart(el.dataset.id),
    doRestartConfirmed: () => doRestartConfirmed(),
    restToNextDay: () => restToNextDay(),
    switchTimeline: (el) => switchTimeline(el.dataset.id),
    loadSave: (el) => loadSave(el.dataset.id),
    showSaveDetail: (el) => showSaveDetail(el.dataset.id),
    returnFromSaveDetail: () => returnFromSaveDetail(),
    editSaveLore: (el) => editSaveLore(el.dataset.id),
    deleteSave: (el) => deleteSave(el.dataset.id),
    openSaveMenu: () => openSaveMenu(),
    openWorldSaveChooser: (el) => openWorldSaveChooser(el.dataset.id),
    startNewSave: (el) => { const w = S.worlds.find(x => x.id === el.dataset.id); if (w) { S.currentWorld = w; startGame(); } },
    saveCurrentSlot: () => saveCurrentSlot(),
    saveAsNewSlot: () => { const name = (document.getElementById("saveAsNewName") || {}).value || ""; saveAsNewSave(name); closeModal("saveMenuModal"); },
    deleteWorld: (el) => deleteWorld(el.dataset.id),
    showExportWorldChoice: (el) => showExportWorldChoice(el.dataset.id),
    exportWorldChoiceLite: () => exportWorldChoice(true),
    exportWorldChoiceFull: () => exportWorldChoice(false),
    triggerWorldPackImport: () => triggerWorldPackImport(),
    importWorld: (el) => importWorld(el.files && el.files[0]),
    // 状态面板
    closeStatusPanel: () => closeStatusPanel(),
    switchStatusTab: (el) => switchStatusTab(el.dataset.key),
    togglePinMemory: (el) => togglePinMemory(el.dataset.id),
    deleteMemory: (el) => deleteMemory(el.dataset.id),
    exportMemoryPack: () => exportMemoryPack(),
    triggerMemoryPackImport: () => triggerMemoryPackImport(),
    importMemoryPack: (el) => importMemoryPack(el.files && el.files[0]),
    // ★ docs/69：章节化回溯
    openRewindTurn: (el) => openRewindTurn(el.dataset.turn),
    confirmRewind: () => {
        const turn = S._rewindTargetTurn;
        if (!turn) return;
        const clear = !!(document.getElementById("rewindClearMemory") && document.getElementById("rewindClearMemory").checked);
        rewindToTurnInGame(turn, { clearMemory: clear });
    },
    rewindAndFork: () => {
        const turn = S._rewindTargetTurn;
        if (!turn) return;
        const clear = !!(document.getElementById("rewindClearMemory") && document.getElementById("rewindClearMemory").checked);
        saveAsNewSave(); // 先另存为新存档（保留当前进度 = 分支），再回溯
        rewindToTurnInGame(turn, { clearMemory: clear });
    },
    clearSourceFile: () => clearSourceFile(),
    // 选择按钮（修复：此前 choice-chip 仅渲染无监听，点击无效）
    chooseOption: (el) => chooseOption(Number(el.dataset.index)),
    // ★ 事件系统：支线事件面板
    showEventPanel: () => showEventPanel(),
    enterSideEvent: (el) => enterSideEvent(el),
    // ★ B2：导演提示 / 持续约束
    showAuthorNoteModal: () => showAuthorNoteModal(),
    saveAuthorNote: () => saveAuthorNote(),
    // ★ C1：保存模块开关设置
    saveWorldModules: (el) => saveWorldModules(el.dataset.id),
    // ★ docs/53：NPC 私聊 / 世界日报
    privateChat: (el) => startPrivateChat(el.dataset.npc),
    endPrivateChat: () => endPrivateChat(),
    requestDaily: () => requestDaily(),
    commitChannel: (el) => commitChannelAction(el.dataset.name, el.dataset.kind),
    addContactChannel: () => addContactChannelRow(),
    removeContactChannel: (el) => removeContactChannelRow(el),
    // ★ IP#6：生成后硬扫描提示条的三个动作
    removeBannedSentence: (el) => removeBannedSentence(Number(el.dataset.idx), el.dataset.term),
    ignoreBannedTerm: (el) => ignoreBannedTerm(Number(el.dataset.idx), el.dataset.term),
    regenerateTurn: (el) => regenerateTurn(Number(el.dataset.idx)),
    // ★ B3：知识库编辑面板
    editWorldLore: (el) => editWorldLore(el.dataset.id),
    openLoreReview: () => openLoreReview(),
    addLoreEntry: () => addLoreEntry(),
    deleteLoreEntry: (el) => deleteLoreEntry(el.dataset.idx),
    saveLoreReview: () => saveLoreReview(),
    confirmLoreRevision: () => confirmLoreRevision(),
    rejectLoreRevision: () => rejectLoreRevision(),
    toggleLoreRequireConfirm: (el) => toggleLoreRequireConfirm(el),
    // ★ docs/63：剧情文本高亮开关（设置面板「高亮」分区）
    toggleHlNames: (el) => { toggleHlNames(el); showToast("人物名字高亮已" + (S.highlightNames ? "开启" : "关闭"), "success", 2500); },
    toggleHlItems: (el) => { toggleHlItems(el); showToast("背包物品高亮已" + (S.highlightItems ? "开启" : "关闭"), "success", 2500); },
    toggleHlDialogue: (el) => { toggleHlDialogue(el); showToast("人物对白高亮已" + (S.highlightDialogue ? "开启" : "关闭"), "success", 2500); },
    toggleHlAiMarks: (el) => { toggleHlAiMarks(el); showToast("AI 重点标记已" + (S.highlightAiMarks ? "开启" : "关闭"), "success", 2500); },
    toggleAIEnhanced: () => toggleAIEnhanced(),
    // ★ Phase 3：AI 审稿人（criticModal）
    triggerWorldCritic: () => triggerWorldCritic(S.currentWorld && S.currentWorld.id),
    extractAndMergeSourceLore: () => extractAndMergeSourceLore(S.currentWorld && S.currentWorld.id),
    confirmCriticRevision: () => confirmCriticRevision(),
    rejectCriticRevision: () => rejectCriticRevision(),
    // ★ Phase 2：世界规则 DSL 编辑器
    openRuleEditor: (el) => openRuleEditor(el.dataset.id),
    addRule: () => addRule(),
    deleteRule: (el) => deleteRule(el.dataset.idx),
    ruleTypeChange: (el) => ruleTypeChange(el),
    importBannedAsRules: () => importBannedAsRules(),
    saveRuleReview: () => saveRuleReview(),
    // ★ B1：人物卡编辑器
    openCharacterEditor: (el) => openCharacterEditor(el.dataset.id),
    addCharacter: () => addCharacter(),
    deleteCharacter: (el) => deleteCharacter(el.dataset.idx),
    saveCharacterReview: () => saveCharacterReview(),
    generateCharactersAI: () => generateCharactersAI(),
    openVariableEditor: (el) => openVariableEditor(el.dataset.id),
    addVariable: () => addVariable(),
    deleteVariable: (el) => deleteVariable(el.dataset.idx),
    saveVariableReview: () => saveVariableReview(),
    // ★ B3：初始物品编辑器
    openItemEditor: (el) => openItemEditor(el.dataset.id),
    addItem: () => addItem(),
    deleteItem: (el) => deleteItem(el.dataset.idx),
    saveItemReview: () => saveItemReview(),
    // ★ S5-4：编辑卡时间体系字段改动 → 写回 schema 并实时刷新冲突徽章
    timeConfigChanged: () => { syncTimeConfigFromDOM(); updateTimeConflictBadge(); refreshCustomCalendarEditor(); },
    // ★ UI-2 多时间线可视化配置器（docs/43 方案 C）
    timeStructChanged: () => timeStructChanged(),
    mvAddLine: () => mvAddLine(),
    mvDelLine: (el) => mvDelLine(el),
    mvSetActive: (el) => mvSetActive(el),
    mvRenameId: (el) => mvRenameId(el),
    mvRenName: (el) => mvRenName(el),
    mvCalChanged: (el) => mvCalChanged(el),
    mvRenEra: (el) => mvRenEra(el),
    mvRenDate: (el) => mvRenDate(el),
    mvRenWeather: (el) => mvRenWeather(el),
    mvTpl: (el) => mvTpl(el),
    // ★ UI-1：自定义历法可视化编辑器（docs/35 方案 C，支持顶层 / 某条时间线）
    ccAddMonth: (el) => ccAddMonth(el.dataset.ccLine || null),
    ccDelMonth: (el) => ccDelMonth(el.dataset.ccLine || null, Number(el.dataset.idx)),
    ccMoveMonth: (el) => ccMoveMonth(el.dataset.ccLine || null, Number(el.dataset.from), Number(el.dataset.to)),
    ccRenMonthName: (el) => ccRenMonthName(el.dataset.ccLine || null, Number(el.dataset.idx), el.value),
    ccRenMonthDays: (el) => ccRenMonthDays(el.dataset.ccLine || null, Number(el.dataset.idx), el.value),
    ccRenLabel: (el) => ccRenLabel(el.dataset.ccLine || null, el.value),
    ccLeapMonth: (el) => ccLeapMonth(el.dataset.ccLine || null, Number(el.dataset.after)),
    ccPreset: (el) => ccPreset(el.dataset.ccLine || null, el.dataset.preset),
    ccClearMonths: (el) => ccClearMonths(el.dataset.ccLine || null),
    // ★ UI-4：世界级默认时间穿越策略 + 每线覆盖
    defaultStrategyChanged: (el) => defaultStrategyChanged(el),
    mvLineStrategy: (el) => mvLineStrategy(el),
    // ★ UI-3：流速同步规则
    mvAddSync: (el) => mvAddSync(el),
    mvDelSync: (el) => mvDelSync(el),
    mvSyncRef: (el) => mvSyncRef(el),
    mvSyncRatio: (el) => mvSyncRatio(el),
    // ★ UI-5：世界时限 / 截止事件编辑器
    openDeadlineEditor: (el) => openDeadlineEditor(el.dataset.id),
    addDeadline: () => addDeadline(),
    deleteDeadline: (el) => deleteDeadline(el.dataset.idx),
    dlPolicyChanged: (el) => dlPolicyChanged(el),
    saveDeadlineReview: () => saveDeadlineReview(),
    // ★ S5-4' + S5-7：开场白时间冲突一键修复
    regenerateOpening: () => regenerateOpening("regenerate"),
    convertOpeningToPlaceholders: () => regenerateOpening("toPlaceholders"),
    // ★ 新功能：开场白剧情向优化（复用 openingFix 弹窗确认写回）
    optimizeOpening: () => optimizeOpening(),
    applyOpeningFix: () => applyOpeningFix(),
    rejectOpeningFix: () => rejectOpeningFix(),
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
        // Enter 发送，Shift+Enter 换行（输入框已改为多行 textarea）
        if (!e.isComposing && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitInput();
        }
    });
    // 多行输入框自动增高（上限由 CSS max-height 控制）
    playerInputEl.addEventListener("input", () => {
        playerInputEl.style.height = "auto";
        playerInputEl.style.height = Math.min(playerInputEl.scrollHeight, 120) + "px";
    });
}

// 设置界面「清除索引缓存」：两次点击确认（禁用原生 confirm；第一次点变「确认清除？再次点击」，4 秒后自动复位）
let _clearAnnPending = false;
let _clearAnnTimer = null;
async function handleClearAnnCache(el) {
    if (!el) return;
    if (!_clearAnnPending) {
        _clearAnnPending = true;
        const original = el.textContent;
        el.textContent = "确认清除？再次点击";
        el.classList.add("danger");
        _clearAnnTimer = setTimeout(() => {
            _clearAnnPending = false;
            el.textContent = original;
            el.classList.remove("danger");
        }, 4000);
        return;
    }
    clearTimeout(_clearAnnTimer);
    _clearAnnPending = false;
    const original = el.textContent;
    el.textContent = "清除中…";
    el.disabled = true;
    el.classList.remove("danger");
    try {
        const n = await clearLoreAnnCache();
        showToast(`已清除 ${n} 个索引缓存，下次进入世界将重新构建`, "success");
    } catch (e) {
        showToast("清除索引缓存失败（不影响存档与剧情）", "error");
    } finally {
        el.textContent = "清除索引缓存";
        el.disabled = false;
    }
}

// 设置界面「数据管理」：两次点击确认（禁用原生 confirm；第一次点变「确认？再次点击」，4 秒后自动复位）
// 三档：cache=清除游戏缓存（保留世界/存档） / saves=删除全部存档 / all=完全重置（回出厂）
const DM_ACTIONS = {
    cache: {
        run: async () => { resetRunCache(); showToast("已清除游戏缓存（世界与存档保留）", "success"); },
        label: "清除游戏缓存"
    },
    saves: {
        run: async () => { await wipeAllSaves(); showToast("已删除全部存档", "success"); renderSaveList(); renderWorldList(); },
        label: "删除全部存档"
    },
    all: {
        run: async () => { await wipeAllData(); showToast("已重置全部数据，即将刷新…", "success"); setTimeout(() => location.reload(), 800); },
        label: "完全重置"
    }
};
let _dmPendingKind = null;
let _dmTimer = null;
function handleDataManage(el, kind) {
    if (!el) return;
    const cfg = DM_ACTIONS[kind];
    if (!cfg) return;
    if (_dmPendingKind !== kind) {
        _dmPendingKind = kind;
        const original = el.textContent;
        el.dataset.dmOriginal = original;
        el.textContent = "确认？再次点击";
        el.classList.add("danger");
        _dmTimer = setTimeout(() => {
            _dmPendingKind = null;
            el.textContent = el.dataset.dmOriginal || cfg.label;
            el.classList.remove("danger");
        }, 4000);
        return;
    }
    clearTimeout(_dmTimer);
    _dmPendingKind = null;
    const original = el.dataset.dmOriginal || cfg.label;
    el.textContent = "处理中…";
    el.disabled = true;
    el.classList.remove("danger");
    (async () => {
        try { await cfg.run(); }
        catch (e) { logError("dataManage", e); showToast("操作失败：" + ((e && e.message) || e), "error"); }
        finally { el.textContent = original; el.disabled = false; }
    })();
}

// ★ 事件系统：打开支线事件面板（门禁：events 模块未启用则提示并返回）
function showEventPanel() {
    if (!S.currentWorld || !isModuleEnabled(S.currentWorld, "events")) { showToast("本世界未启用支线事件", "warn"); return; }
    renderEventPanel(S.pendingSideEvents || []);
    showModal("eventPanelOverlay");
}

// ★ 事件系统：进入指定支线事件（校验体力 → 标记消耗 → 填输入框 → 自动提交普通回合）
function enterSideEvent(el) {
    const idx = parseInt(el && el.dataset ? el.dataset.idx : "-1", 10);
    const evs = S.pendingSideEvents || [];
    const ev = evs[idx];
    if (!ev) return;
    if (!S.currentWorld || !isModuleEnabled(S.currentWorld, "events")) { showToast("本世界未启用支线事件", "warn"); return; }
    const cur = (S.gameState && S.gameState.variables && typeof S.gameState.variables.stamina === "number") ? S.gameState.variables.stamina : null;
    const cost = Number(ev.cost_stamina) || 0;
    if (cur !== null && cost > cur) { showToast("体力不足，无法进入该支线", "warn"); return; }
    // 标记本次进入的支线消耗，applyNormalTurn 套用时扣减（computeVariableUpdates 绝对值语义）
    S.enteringSideEvent = { cost_stamina: cost, cost_time: ev.cost_time || "", title: ev.title };
    const input = document.getElementById("playerInput");
    if (input) input.value = `（主动触发支线：${ev.title}）`;
    closeModal("eventPanelOverlay");
    submitInput();
}

init();
