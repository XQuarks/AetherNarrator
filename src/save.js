// ============================================================
// AetherNarrator · save.js（由 game.js 拆分：会话/存档管理）
// 说明：本模块聚合「会话失效 + 存档读写 + 世界加载」逻辑，
// 仅依赖 storage / simulation / render / prompt / theme / migrations / utils / turn-lifecycle，
// 不反向依赖 game.js，避免循环引用。
// ============================================================
import { S, syncVariablesToSchema, initBondsFromWorld } from "./store.js";
import { saveSaves, saveState, saveWorlds, clearCurrentRunState } from "./storage.js";
import {
    stopTypewriter, showScreen, renderLog, renderChoices, updateGameDayInfo,
    updateInputState, startTypewriter, showToast, closeModal, closeAllModals, restoreLastChoices,
    checkDeathBanner, renderSaveList, renderWorldList
} from "./render.js";
import { normalizeSimulationState } from "./simulation.js";
import { deepClone, defaultInitialState, resolveOpeningTokens, detectTimeConflict, formatConflictMessage } from "./utils.js";
import { defaultWorldRuntime } from "./store.js"; // ★ 57：双轨知识库运行态
import { invalidateSystemPromptCache, rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";
import { formatWorldTime, stepOf, ensureTimelineState, getTimeConfig } from "./theme.js";
import { normalizeCurrentDate } from "./calendar.js";
import { LATEST_SAVE_SCHEMA_VERSION } from "./migrations.js";
import { invalidateAllLoreAnn } from "./ann-index.js";
import { sanitizeModules, ensureEventsWorldReady } from "./modules.js"; // ★ C1：读档/切换世界时确保 world.modules 完整；事件系统确保体力变量就位
import { abortCurrentRequest } from "./turn-lifecycle.js";

export async function startGame(opts = {}) {
    abortCurrentRequest(S); // ★ P0: 失效在途请求，避免旧响应串入新周目
    invalidateAllLoreAnn(); // ★ Phase 1：切换/重开世界，释放旧 ANN 索引
    closeModal("worldDetailModal");
    if (!S.currentWorld) return;
    stopTypewriter();
    S.currentSession.worldId = S.currentWorld.id;
    // ★ 多存档槽位：新周目默认开"新槽位"（不覆盖任何已有存档）；opts.keepSlot 时复用当前槽位（重新开始=覆盖重置）
    if (!opts.keepSlot) S.currentSession.saveId = "s" + Date.now();

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
    // 方案 B：current_date 按世界时间模式规范化（旧档 dated 回推为原生年/月/日）
    S.gameState.current_date = normalizeCurrentDate(S.gameState.current_date, getTimeConfig().timeConfig);
    // Phase 2：多世界时初始化/补齐全线 current_date（非多世界为 no-op）
    ensureTimelineState(S.gameState, getTimeConfig());
    // ★ 事件系统：开启 events 时确保体力变量定义就位（须在 syncVariablesToSchema 之前，使开局按 default 初始化体力）
    ensureEventsWorldReady(S.currentWorld);
    // ★ B2：按世界 variable_schema 初始化/同步运行时变量值（开局补默认、清脏 key）
    S.gameState.variables = syncVariablesToSchema(S.currentWorld, S.gameState.variables);
    // ★ B4：新游戏从世界定义初始化好感度 map（characters + initial_state.relationships 二者纳入）
    S.gameState.bonds = initBondsFromWorld(S.currentWorld);

    // ★ B7：从世界出厂默认深拷贝知识库为当前存档副本（后续编辑只改副本）
    S.activeLoreKB = S.currentWorld.lore_kb ? deepClone(S.currentWorld.lore_kb) : null;
    // ★ 57：双轨知识库运行态随新周目清空（原著永不承载游玩产物）
    S.worldRuntime = defaultWorldRuntime();

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

    // 开场白（UI 展示，不推入 chatHistory）；S5-3：含占位符时先展开为开局起点日期
    const rawOpening = S.currentWorld.opening_narrative || "";
    const openingText = rawOpening
        ? resolveOpeningTokens(rawOpening, getTimeConfig().timeConfig, S.gameState.current_date)
        : `你进入了「${S.currentWorld.name}」。\n\n${S.currentWorld.desc}\n\n旅程即将开始，请做出你的第一个行动。`;
    S.conversationHistory.push({
        player: "",
        narrative: openingText,
        retrieved: [],
        period: S.gameState.current_date.period,
        day: stepOf(S.gameState.current_date),
        tcd: deepClone(S.gameState.current_date),
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
    const worldSaves = S.saves.filter(s => s.worldId === worldId);
    if (!worldSaves.length) { startGame(); return; }
    const latest = worldSaves.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    loadSave(latest.id);
}

// ★ 载入会话：把存档数据灌入运行时（S.currentWorld / S.gameState / S.activeLoreKB / 历史等），不跳转界面。
// loadSave 与「存档详情-存档知识库」编辑共用，保证进入游戏前/知识库编辑前状态一致。
export function prepareSessionFromSave(save) {
    abortCurrentRequest(S); // ★ P0: 失效在途请求
    invalidateAllLoreAnn(); // ★ Phase 1：载入存档/切换世界，释放旧 ANN 索引
    stopTypewriter();
    S.currentWorld = S.worlds.find(w => w.id === save.worldId);
    S.currentSession.worldId = save.worldId;
    sanitizeModules(S.currentWorld); // ★ C1：确保当前世界 modules 完整（核心模块恒开）
    invalidateSystemPromptCache();
    if (save.state) S.gameState = normalizeSimulationState(deepClone(save.state));
    if (S.gameState) S.gameState.current_date = normalizeCurrentDate(S.gameState.current_date, getTimeConfig().timeConfig);
    // Phase 2：多世界时恢复/补齐全线 current_date（非多世界为 no-op）
    ensureTimelineState(S.gameState, getTimeConfig());
    // ★ 事件系统：读档时若 events 模块开启且世界尚无 stamina 变量，补入默认定义（须在 syncVariablesToSchema 之前）
    ensureEventsWorldReady(S.currentWorld);
    // ★ B2：读档时按当前世界 variable_schema 同步变量（新增变量补默认、已删变量清除）
    if (S.gameState) S.gameState.variables = syncVariablesToSchema(S.currentWorld, S.gameState.variables);
    // ★ B4：读档仅兜底 bonds 字段（不回填老档 → 不兼容旧存档，老档关系页签只显示文字层）
    if (S.gameState) S.gameState.bonds = (S.gameState.bonds && typeof S.gameState.bonds === "object" && !Array.isArray(S.gameState.bonds)) ? S.gameState.bonds : {};

    // ★ B7：恢复存档独立知识库（若存档无副本则从 world 出厂默认深拷贝，兼容老存档）
    S.activeLoreKB = (save.lore_kb) ? deepClone(save.lore_kb) : (S.currentWorld && S.currentWorld.lore_kb ? deepClone(S.currentWorld.lore_kb) : null);
    // ★ 57：恢复双轨知识库运行态（无则按默认空）
    S.worldRuntime = (save.world_runtime) ? deepClone(save.world_runtime) : defaultWorldRuntime();
    S.activeBehaviorRecords = deepClone(save.behavior_records || []);
    S.aiEnhanced = save.ai_enhanced === true;
    S.lastLoreReviewMsgCount = save.last_lore_review_msg_count || 0;
    S._loreRevisionBuffer = deepClone(save.pending_lore_revision || null);
    // ★ C4：读档时恢复玩家私人备忘（无则空串兼容老存档）
    S.playerNotes = (typeof save.player_notes === "string") ? save.player_notes : "";
    if (save.history) S.conversationHistory = deepClone(save.history);
    S.chatHistory = save.chatHistory ? deepClone(save.chatHistory) : rebuildChatFromHistory(save.history);
    S.chatSummary = (save.chatSummary && save.chatSummary.length) ? deepClone(save.chatSummary) : rebuildSummaryFromHistory(save.history);
}

export function loadSave(saveId) {
    const stored = S.saves.find(s => s.id === saveId);
    const save = stored || null;
    if (!save) return;
    // ★ 防御：存档所属世界已被删除时，禁止进入游戏（currentWorld 为 null 会崩溃），给出提醒后返回
    if (!S.worlds.find(w => w.id === save.worldId)) {
        showToast(`存档「${save.worldName}」所属的世界已被删除，无法继续游玩`, "warn", 3500);
        return;
    }
    prepareSessionFromSave(save);
    S.currentSession.saveId = saveId; // ★ 多存档槽位：绑定会话到所读槽位，之后自动存档只更新它
    showToast(`加载存档：${save.worldName}`, "success");
    closeAllModals();
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

    // S5-4：进游戏时若开场白/系统提示时间与世界起始时间冲突，弹不阻塞提示（避免"改了起点却进游戏才发现开场白冲突"）
    const tc = detectTimeConflict(S.currentWorld);
    if (tc.conflict) showToast("⚠ 时间可能冲突：" + formatConflictMessage(tc), "warn", 4000);
}

export function deleteSave(saveId) {
    if (!confirm("确定要删除这个存档吗？")) return;
    if (S.currentSession.saveId === saveId) S.currentSession.saveId = null; // ★ 多存档槽位：删掉当前活动档则解绑，避免悬空
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
    // ★ 多存档槽位：按"当前槽位 id"定位（不再按 worldId 覆盖，避免同世界多存档互相抹掉）
    const saveId = S.currentSession.saveId;
    let existing = saveId ? S.saves.find(s => s.id === saveId) : null;
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
        existing.player_notes = (typeof S.playerNotes === "string") ? S.playerNotes : ""; // ★ C4：写回玩家备忘
        existing.world_runtime = deepClone(S.worldRuntime); // ★ 57：双轨运行态随存档持久化
    } else {
        const newId = saveId || ("s" + Date.now());
        S.currentSession.saveId = newId;
        S.saves.unshift({
            id: newId, worldId: S.currentWorld.id, worldName: S.currentWorld.name,
            name: defaultSlotName(S.currentWorld.id, S.currentWorld.name),
            progress, updatedAt: now,
            state: JSON.parse(stateStr), history: JSON.parse(cleanHistoryStr), chatHistory: cleanChat,
            chatSummary: [...S.chatSummary],
            schema_version: LATEST_SAVE_SCHEMA_VERSION,
            lore_kb: deepClone(S.activeLoreKB),
            world_runtime: deepClone(S.worldRuntime), // ★ 57：双轨运行态随存档持久化
            behavior_records: deepClone(S.activeBehaviorRecords),
            ai_enhanced: S.aiEnhanced === true,
            last_lore_review_msg_count: S.lastLoreReviewMsgCount,
            pending_lore_revision: deepClone(S._loreRevisionBuffer),
            player_notes: (typeof S.playerNotes === "string") ? S.playerNotes : "" // ★ C4：写回玩家备忘
        });
    }
    saveSaves();
    // 使用已序列化的字符串保存 localStorage，避免 saveState 再次序列化
    saveState({ state: stateStr, history: historyStr, chatHistory: JSON.stringify(S.chatHistory) });
}

// ★ 多存档槽位：默认槽位名 = 世界名 + " · 存档 N"（N 为该世界现有档数 + 1）
function defaultSlotName(worldId, worldName) {
    const n = S.saves.filter(s => s.worldId === worldId).length + 1;
    return (worldName || "世界") + " · 存档 " + n;
}

// ★ 多存档槽位：保存当前槽位（带 toast 反馈）
export function saveCurrentSlot() {
    createOrUpdateSave();
    showToast("已保存当前存档", "success");
}

// ★ 多存档槽位：把当前进度另存为一个全新的存档槽位（分叉新线），随后切到该槽位
export function saveAsNewSave(name) {
    if (!S.currentWorld || !S.gameState) { showToast("请先进入一个世界并开始游玩", "warn"); return; }
    const progress = formatWorldTime(S.gameState);
    const now = new Date().toLocaleString("zh-CN", { hour12: false });
    const cleanHistory = S.conversationHistory.filter(e => !e.isWarning);
    const cleanHistoryStr = JSON.stringify(cleanHistory);
    const stateStr = JSON.stringify(S.gameState);
    const historyStr = JSON.stringify(S.conversationHistory);
    const slotName = (name && name.trim()) ? name.trim().slice(0, 60) : defaultSlotName(S.currentWorld.id, S.currentWorld.name);
    const newId = "s" + Date.now();
    S.saves.unshift({
        id: newId, worldId: S.currentWorld.id, worldName: S.currentWorld.name,
        name: slotName, progress, updatedAt: now,
        state: JSON.parse(stateStr), history: JSON.parse(cleanHistoryStr), chatHistory: deepClone(S.chatHistory),
        chatSummary: [...S.chatSummary],
        schema_version: LATEST_SAVE_SCHEMA_VERSION,
        lore_kb: deepClone(S.activeLoreKB),
        world_runtime: deepClone(S.worldRuntime), // ★ 57：双轨运行态随存档持久化
        behavior_records: deepClone(S.activeBehaviorRecords),
        ai_enhanced: S.aiEnhanced === true,
        last_lore_review_msg_count: S.lastLoreReviewMsgCount,
        pending_lore_revision: deepClone(S._loreRevisionBuffer),
        player_notes: (typeof S.playerNotes === "string") ? S.playerNotes : ""
    });
    S.currentSession.saveId = newId;
    saveSaves();
    saveState({ state: stateStr, history: historyStr, chatHistory: JSON.stringify(S.chatHistory) });
    showToast("已另存为新存档：" + slotName, "success");
}
