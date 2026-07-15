// ============================================================
// AetherNarrator · save.js（由 game.js 拆分：会话/存档管理）
// 说明：本模块聚合「会话失效 + 存档读写 + 世界加载」逻辑，
// 仅依赖 storage / simulation / render / prompt / theme / migrations / utils，
// 不反向依赖 game.js，避免循环引用。
// ============================================================
import { S } from "./store.js";
import { saveSaves, saveState, saveWorlds, clearCurrentRunState } from "./storage.js";
import {
    stopTypewriter, showScreen, renderLog, renderChoices, updateGameDayInfo,
    updateInputState, startTypewriter, showToast, closeModal, restoreLastChoices,
    checkDeathBanner, renderSaveList, renderWorldList
} from "./render.js";
import { normalizeSimulationState } from "./simulation.js";
import { deepClone, defaultInitialState } from "./utils.js";
import { invalidateSystemPromptCache, rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";
import { formatWorldTime } from "./theme.js";
import { LATEST_SAVE_SCHEMA_VERSION, migrateSaveRecord } from "./migrations.js";

export function abortCurrentRequest() {
    if (S.currentAbortController) {
        try { S.currentAbortController.abort(); } catch (e) {}
        S.currentAbortController = null;
    }
    for (const controller of S.auxiliaryControllers) {
        try { controller.abort(); } catch (_) {}
    }
    S.auxiliaryControllers.clear();
    S.currentSession.epoch++; // 任何尚未返回的响应将因 epoch 不匹配而被丢弃
}

export async function startGame(opts = {}) {
    abortCurrentRequest(); // ★ P0: 失效在途请求，避免旧响应串入新周目
    closeModal("worldDetailModal");
    if (!S.currentWorld) return;
    stopTypewriter();
    S.currentSession.worldId = S.currentWorld.id;

    // 新周目使用独立运行态；世界模板永不承载游玩过程中产生的记忆。
    S.activeBehaviorRecords = [];
    S.aiEnhanced = !!S.currentWorld.ai_enhanced_default;
    S.lastLoreReviewMsgCount = 0;
    S._loreRevisionBuffer = null;

    // 加载该世界的初始状态
    if (S.currentWorld.initial_state) {
        S.gameState = normalizeSimulationState(deepClone(S.currentWorld.initial_state));
    } else {
        S.gameState = normalizeSimulationState(deepClone(defaultInitialState()));
        S.gameState.name = S.currentWorld.hero ? "主角" : "玩家";
    }

    // ★ B7：从世界出厂默认深拷贝知识库为当前存档副本（后续编辑只改副本）
    S.activeLoreKB = S.currentWorld.lore_kb ? deepClone(S.currentWorld.lore_kb) : null;

    // ★ P0/P1: 重置缓存 + 聊天历史 + 摘要
    invalidateSystemPromptCache();
    S.conversationHistory = [];
    S.chatHistory = [];  // ★ 开场白已注入 system prompt，chatHistory 从空开始
    S.chatSummary = [];
    saveState();

    showScreen("gameScreen");
    document.getElementById("gameWorldName").textContent = S.currentWorld.name;
    updateGameDayInfo();
    renderLog(true);
    renderChoices([]);
    updateInputState(); // ★ P2.2.13: 重开新周目时复位输入（死亡态禁用的输入框在 gameState 重置为 is_alive:true 后重新启用）

    // 开场白（UI 展示，不推入 chatHistory）
    const openingText = S.currentWorld.opening_narrative
        ? S.currentWorld.opening_narrative
        : `你进入了「${S.currentWorld.name}」。\n\n${S.currentWorld.desc}\n\n旅程即将开始，请做出你的第一个行动。`;
    S.conversationHistory.push({
        player: "",
        narrative: openingText,
        retrieved: [],
        period: S.gameState.current_date.period,
        day: S.gameState.current_date.day,
        key_facts: []
    });
    // ★ P1: 开场白已注入 system prompt（固定，命中缓存），不再作为首条 chatHistory 消息
    // 第一轮 API 请求结构：[system(含开场白), user1] — 与 DeepSeek 官方 Example 1 一致

    saveState();
    createOrUpdateSave(); // ★ P1.2.7: 开场即生成可读存档列表项（否则要等首轮结束才出现）
    renderLog();
    await startTypewriter(S.conversationHistory.length - 1);

    // 打字完成后显示开场选项
    if (S.currentWorld.initial_choices && S.currentWorld.initial_choices.length) {
        S.currentChoices = S.currentWorld.initial_choices;
        renderChoices(S.currentChoices);
    }
}

export function continueLatestSave(worldId) {
    const save = S.saves.find(s => s.worldId === worldId);
    if (save) loadSave(save.id);
}

export function loadSave(saveId) {
    abortCurrentRequest(); // ★ P0: 失效在途请求
    const stored = S.saves.find(s => s.id === saveId);
    const save = stored ? migrateSaveRecord(stored, S.worlds.find(w => w.id === stored.worldId)) : null;
    if (!save) return;
    stopTypewriter();
    S.currentWorld = S.worlds.find(w => w.id === save.worldId);
    S.currentSession.worldId = save.worldId;
    invalidateSystemPromptCache();
    if (save.state) S.gameState = normalizeSimulationState(deepClone(save.state));
    // ★ B7：恢复存档独立知识库（若存档无副本则从 world 出厂默认深拷贝，兼容老存档）
    S.activeLoreKB = (save.lore_kb) ? deepClone(save.lore_kb) : (S.currentWorld && S.currentWorld.lore_kb ? deepClone(S.currentWorld.lore_kb) : null);
    S.activeBehaviorRecords = deepClone(save.behavior_records || []);
    S.aiEnhanced = save.ai_enhanced === true;
    S.lastLoreReviewMsgCount = save.last_lore_review_msg_count || 0;
    S._loreRevisionBuffer = deepClone(save.pending_lore_revision || null);
    if (save.history) S.conversationHistory = deepClone(save.history);
    S.chatHistory = save.chatHistory ? deepClone(save.chatHistory) : rebuildChatFromHistory(save.history);
    S.chatSummary = (save.chatSummary && save.chatSummary.length) ? deepClone(save.chatSummary) : rebuildSummaryFromHistory(save.history);
    showToast(`加载存档：${save.worldName}`, "success");
    showScreen("gameScreen");
    document.getElementById("gameWorldName").textContent = save.worldName;
    updateGameDayInfo();

    // 检查存档是否为死亡状态
    checkDeathBanner();

    renderLog(true);
    renderChoices([]);
    updateInputState();

    // ★ 从历史恢复最后一条有选项的记录
    restoreLastChoices();
}

export function deleteSave(saveId) {
    if (!confirm("确定要删除这个存档吗？")) return;
    S.saves = S.saves.filter(s => s.id !== saveId);
    saveSaves();
    renderSaveList();
    showToast("存档已删除", "success");
}

export function deleteWorld(worldId) {
    const world = S.worlds.find(w => w.id === worldId);
    if (!world) return;
    if (!confirm(`确定要删除世界「${world.name}」吗？\n该世界的所有记忆库、状态、存档将被一并删除，此操作不可撤销。`)) return;
    // 删除该世界的存档
    S.saves = S.saves.filter(s => s.worldId !== worldId);
    saveSaves();
    // 如果当前正在玩的就是这个世界，清除运行状态
    if (S.currentWorld && S.currentWorld.id === worldId) {
        S.currentWorld = null;
        S.gameState = null;
        S.conversationHistory = [];
        S.chatHistory = [];
        invalidateSystemPromptCache();
        clearCurrentRunState();
    }
    // 从世界列表中移除
    S.worlds = S.worlds.filter(w => w.id !== worldId);
    saveWorlds();
    renderWorldList();
    showToast(`世界「${world.name}」已删除`, "success");
}

export function createOrUpdateSave() {
    if (!S.currentWorld || !S.gameState) return;
    const existing = S.saves.find(s => s.worldId === S.currentWorld.id);
    const progress = formatWorldTime(S.gameState);
    const now = new Date().toLocaleString("zh-CN", { hour12: false });
    const cleanHistory = S.conversationHistory.filter(e => !e.isWarning);
    const cleanChat = deepClone(S.chatHistory);
    // 预序列化，共享给 saveState，避免重复 JSON.stringify
    const stateStr = JSON.stringify(S.gameState);
    const historyStr = JSON.stringify(S.conversationHistory);
    const cleanHistoryStr = JSON.stringify(cleanHistory);
    if (existing) {
        existing.progress = progress; existing.updatedAt = now;
        existing.state = JSON.parse(stateStr);
        existing.history = JSON.parse(cleanHistoryStr);
        existing.chatHistory = cleanChat;
        existing.chatSummary = S.chatSummary;
        existing.schema_version = LATEST_SAVE_SCHEMA_VERSION;
        existing.lore_kb = deepClone(S.activeLoreKB);
        existing.behavior_records = deepClone(S.activeBehaviorRecords);
        existing.ai_enhanced = S.aiEnhanced === true;
        existing.last_lore_review_msg_count = S.lastLoreReviewMsgCount;
        existing.pending_lore_revision = deepClone(S._loreRevisionBuffer);
    } else {
        S.saves.unshift({
            id: "s" + Date.now(), worldId: S.currentWorld.id, worldName: S.currentWorld.name,
            progress, updatedAt: now,
            state: JSON.parse(stateStr), history: JSON.parse(cleanHistoryStr), chatHistory: cleanChat,
            chatSummary: [...S.chatSummary],
            schema_version: LATEST_SAVE_SCHEMA_VERSION,
            lore_kb: deepClone(S.activeLoreKB),
            behavior_records: deepClone(S.activeBehaviorRecords),
            ai_enhanced: S.aiEnhanced === true,
            last_lore_review_msg_count: S.lastLoreReviewMsgCount,
            pending_lore_revision: deepClone(S._loreRevisionBuffer)
        });
    }
    saveSaves();
    // 使用已序列化的字符串保存 localStorage，避免 saveState 再次序列化
    saveState({ state: stateStr, history: historyStr, chatHistory: JSON.stringify(S.chatHistory) });
}
