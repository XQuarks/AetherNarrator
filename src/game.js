// ============================================================
// AetherNarrator · game.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_ORDER, LINK_RELATION_LABELS, STORAGE_KEYS, getActiveConditionTags, getBannedConceptRules, getBannedConcepts } from "./store.js";
import { analyzeWorldTags, capSource, chunkText, deepClone, defaultInitialState, defaultWorldSchema, escapeHtml, getWorldSchema, isNonStoryResponse, mergeLoreSnippets, runPool, sanitizeWorldConfig, validateStateShape } from "./utils.js";
import { getPeriodLabel, getTemperature, getTimeConfig, formatWorldTime } from "./theme.js";
import { saveSaves, saveState, saveWorlds, clearCurrentRunState, importWorldPack } from "./storage.js";
import { clearSourceFile } from "./files.js";
import { addBehaviorRecords, ensureLoreEmbeddings, getWorldLoreKB, retrieve, summarizeFactsFromChanges } from "./rag.js";
import { detectPromptInjection, invalidateSystemPromptCache, pushChatTurn, rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";
import { callLLM, callWorldGenerationLLM, callLoreChunkLLM, callLoreRevisionLLM, judgeWorldviewConsistency } from "./llm.js";
import { checkDeathBanner, closeModal, getSelectedStyleRef, hideLoading, renderChoices, renderLog, renderSaveDetail, renderSaveList, renderStatusPanel, renderWorldList, restoreLastChoices, showGameOver, showLoading, showModal, showScreen, showToast, skipTypewriter, startTypewriter, stopTypewriter, updateGameDayInfo, updateInputState, isSourceFileUploaded } from "./render.js";
import { LATEST_SAVE_SCHEMA_VERSION, migrateSaveRecord } from "./migrations.js";
import { filterStateChangesByWorldview, findWorldviewViolations, isEnhancementContextCurrent, shouldRunAIEnhancements } from "./worldview.js";
import { createMemoryPack, mergeMemoryPack } from "./memory-transfer.js";
import { createWorldPack } from "./world-transfer.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { advanceWorldTime, collectDueDeadlines, hydrateWorldTime } from "./time-engine.js";
import { applySimulationChanges, createRestEvent, normalizeSimulationState } from "./simulation.js";
import { getChunkConcurrency } from "./providers.js";
import { acquireTurn, isSessionContextCurrent, releaseTurn } from "./turn-lifecycle.js";

// 以下函数体已拆分至 save.js / lore-ui.js；此处重新导出以保持 app.js / render.js 的导入不变
import { abortCurrentRequest, startGame, continueLatestSave, loadSave, deleteSave, deleteWorld, createOrUpdateSave } from "./save.js";
import { openLoreReview, editWorldLore, editSaveLore, addLoreEntry, deleteLoreEntry, saveLoreReview, triggerLoreRevision, confirmLoreRevision, rejectLoreRevision, toggleLoreSpoiler } from "./lore-ui.js";
export { abortCurrentRequest, startGame, continueLatestSave, loadSave, deleteSave, deleteWorld, createOrUpdateSave };
export { openLoreReview, editWorldLore, editSaveLore, addLoreEntry, deleteLoreEntry, saveLoreReview, triggerLoreRevision, confirmLoreRevision, rejectLoreRevision, toggleLoreSpoiler };

export function goHome() {
    abortCurrentRequest();
    showScreen("homeScreen");
}

export function exportDebugLog() {
    const blob = new Blob([JSON.stringify(S.debugLog, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = "aether_debug_log_" + new Date().toISOString().slice(0, 10) + ".json";
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    showToast("调试日志已导出 (" + S.debugLog.turns.length + " 轮对话记录)", "success");
}

export function exportStory() {
    if (!S.conversationHistory || !S.conversationHistory.length) {
        showToast("还没有剧情可以导出", "warn");
        return;
    }
    const worldName = S.currentWorld ? S.currentWorld.name : "未知世界";
    let text = worldName + " · 剧情记录\n";
    text += "导出时间：" + new Date().toLocaleString() + "\n";
    text += "=".repeat(50) + "\n\n";

    S.conversationHistory.forEach((entry, i) => {
        if (entry.isWarning) return;
        if (entry.player) {
            text += "【玩家 · 第 " + entry.day + " 天 · " + (entry.period || "") + "】\n";
            text += "> " + entry.player + "\n\n";
        }
        text += entry.narrative + "\n\n";
        text += "-".repeat(40) + "\n\n";
    });

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = worldName.replace(/[\\/:*?"<>|]/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = safeName + "_" + dateStr + ".txt";
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    showToast("剧情已导出为 TXT 文件", "success");
}

export async function generateWorld() {
    const name = document.getElementById("worldName").value.trim();
    const type = document.getElementById("worldType").value;
    const desc = document.getElementById("worldDesc").value.trim();
    const hero = document.getElementById("heroDesc").value.trim();
    const ipName = type === "ip" ? document.getElementById("ipName").value.trim() : "";
    const styleRef = getSelectedStyleRef();
    const customStyle = styleRef === "custom" ? document.getElementById("customStyle").value.trim() : "";
    const plotFreedom = parseInt(document.getElementById("plotFreedom").value);
    const prefixEnabled = document.querySelector("input[name='customPrefixEnable']:checked");
    const customPrefix = (prefixEnabled && prefixEnabled.value === "on") ? document.getElementById("customPrefix").value.trim() : "";
    const worldPrefixEnabled = document.querySelector("input[name='worldPrefixEnable']:checked");
    const worldPrefix = (worldPrefixEnabled && worldPrefixEnabled.value === "on") ? document.getElementById("worldPrefix").value.trim() : "";

    if (!name || !desc) {
        showToast("请填写世界名称和世界观描述", "error");
        return;
    }
    // ★ 上传了小说源文件后，作品名称改为可选填写
    if (type === "ip" && !ipName && !isSourceFileUploaded()) {
        showToast("基于已有 IP 时请填写作品名称，或上传小说源文件后留空", "error");
        return;
    }

    const btn = document.getElementById("generateWorldBtn");
    btn.disabled = true;
    btn.textContent = "生成中...";

    try {
        const CHUNK_SIZE = 15000;   // ★ Plan A：单块 1.5 万字
        const COUNT_HINT = 25;      // ★ Plan A：每块抽 20-30 条
        const src = S.sourceFileContent || "";
        let generated, loreKb;
        if (src.length > CHUNK_SIZE) {
            // ===== Plan A：全书分块多遍抽取，合并去重成覆盖全书的大知识库 =====
            const chunks = chunkText(src, CHUNK_SIZE);
            showToast(`本书较大，知识库将分 ${chunks.length} 段生成，可能需要较长时间（数十次 API 调用），请耐心等待。`, "warn");
            // ① 基础世界配置（结构/开场）由首段生成
            generated = sanitizeWorldConfig(await callWorldGenerationLLM(name, type, desc, hero, ipName, chunks[0], styleRef, customStyle, plotFreedom, worldPrefix, CHUNK_SIZE, COUNT_HINT));
            // ② 逐段抽取 lore 并合并（覆盖全书，同名条目汇总）
      // ★ 提速：并发抽取（不再串行一个个等）。并发数由设置读取（默认 100 路）；
      //    DeepSeek 限速是「并发额度」模型（非 TPM）：deepseek-v4-flash 账号级并发额度 2500，
      //    100 路仍远低于上限，不会因并发触发 429。runPool 自带 429 退避兜底，极端超额也不丢块。
      const CONCURRENCY = getChunkConcurrency();
            const chunkResults = await runPool(chunks, CONCURRENCY,
                (content, idx) => callLoreChunkLLM(name, ipName, content, idx + 1, chunks.length, COUNT_HINT, styleRef, customStyle),
                {
                    retries: 4,
                    isRetryable: (e) => /429|timeout|network|fetch|abort|ECONN|ETIMEDOUT/i.test(String((e && e.message) || "")),
                    onRetry: (idx, n) => showToast(`第 ${idx}/${chunks.length} 段被限流，自动重试(${n})...`, "warn"),
                    onProgress: (done, total) => { btn.textContent = `生成中 (已完成 ${done}/${total})...`; },
                    onError: (idx, err) => { showToast(`第 ${idx}/${chunks.length} 段知识库生成失败，已跳过：${err.message}`, "error"); console.warn(err); }
                }
            );
            // 统一合并各段结果（同名条目汇总加长，顺序无关；失败段为 __error 占位、跳过）
            let allSnippets = [];
            for (const r of chunkResults) {
                if (r && !r.__error) allSnippets = mergeLoreSnippets(allSnippets, (r.snippets) || []);
            }
            // 重排唯一 id，避免各段 id 冲突
            allSnippets.forEach((s, i) => { s.id = "m" + (i + 1); });
            loreKb = { ip: name, snippets: allSnippets };
            try { await ensureLoreEmbeddings(loreKb); }
            catch (e) { console.warn("知识库向量预计算失败，将降级为关键词检索:", e.message); }
        } else {
            // 小书：沿用原有单次生成
            generated = sanitizeWorldConfig(await callWorldGenerationLLM(name, type, desc, hero, ipName, src, styleRef, customStyle, plotFreedom, worldPrefix));
            loreKb = generated.lore_kb;
            if (loreKb) {
                try { await ensureLoreEmbeddings(loreKb); }
                catch (e) { console.warn("世界生成后向量预计算失败，将降级为关键词检索:", e.message); }
            }
        }
        const world = {
            id: "w" + Date.now(),
            name,
            type,
            desc,
            hero,
            ip_name: ipName,
            createdAt: new Date().toISOString().split("T")[0],
            tags: analyzeWorldTags(name, desc, hero, type, ipName),
            schema: generated.schema || defaultWorldSchema(name + " " + desc),
            initial_state: generated.initial_state,
            lore_kb: loreKb,
            opening_narrative: generated.opening_narrative || "",
            initial_choices: generated.initial_choices || [],
            system_prompt: generated.system_prompt,
            behavior_records: [],
            source_content: capSource(S.sourceFileContent),
            style_ref: styleRef,
            custom_style: customStyle,
            plot_freedom: plotFreedom,
            custom_prefix: customPrefix
        };
        S.worlds.unshift(world);
        saveWorlds();
        // 调试日志：记录世界创建
        S.debugLog.worldCreations.push({
            time: new Date().toISOString(),
            worldName: name,
            worldType: type,
            ipName: ipName || null,
            plotFreedom: plotFreedom,
            loreSnippets: world.lore_kb ? world.lore_kb.snippets.length : 0,
            openingTextLen: (world.opening_narrative || "").length
        });
        renderWorldList();

        document.getElementById("worldName").value = "";
        document.getElementById("worldDesc").value = "";
        document.getElementById("heroDesc").value = "";
        document.getElementById("ipName").value = "";
        document.getElementById("customStyle").value = "";
        document.getElementById("customPrefix").value = "";
        // 重置特殊要求开关
        document.querySelectorAll("#customPrefixGroup .radio-option").forEach((o, i) => {
            o.classList.toggle("selected", i === 0);
        });
        document.querySelectorAll("#customPrefixGroup input[type=radio]").forEach((r, i) => {
            r.checked = i === 0;
        });
        document.getElementById("customPrefixField").classList.remove("show");
        clearSourceFile();
        closeModal("createWorldModal");
        showToast("世界生成成功！可先审阅知识库再开玩。", "success");
        // ★ B3：生成后自动弹出知识库初览，让玩家审阅/修正 AI 生成的 lore
        S.currentWorld = world;
        openLoreReview();
    } catch (e) {
        let errorMsg = e.message;
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("failed to fetch")) {
            errorMsg = "网络请求失败（大概率是 CORS 跨域限制）。请在 API 配置中填写 CORS 代理 URL，或使用浏览器 CORS 插件。";
        }
        showToast("生成失败：" + errorMsg, "error");
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.textContent = "确认生成";
    }
}

export function showWorldList() {
    abortCurrentRequest();
    renderWorldList();
    showScreen("worldListScreen");
}

export function showSaveList() {
    renderSaveList();
    showScreen("saveListScreen");
}

// ★ 存档详情二级界面：打开前先确保存档列表在底层（方便「返回」回到列表）
export function showSaveDetail(saveId) {
    renderSaveList();
    renderSaveDetail(saveId);
}

// ★ 存档详情「返回」：关闭弹窗并刷新底层存档列表
export function returnFromSaveDetail() {
    closeModal("saveDetailModal");
    renderSaveList();
    showScreen("saveListScreen");
}

// ★ B2：打开「导演提示 / 持续约束」弹窗，载入当前世界已保存的约束
export function showAuthorNoteModal() {
    if (!S.currentWorld) { showToast("请先进入一个世界", "warn"); return; }
    const ta = document.getElementById("authorNoteInput");
    if (ta) ta.value = (typeof S.currentWorld.author_note === "string") ? S.currentWorld.author_note : "";
    showModal("authorNoteModal");
}

// ★ B2：保存玩家手动约束到当前世界（持续生效，随世界存档）
export function saveAuthorNote() {
    if (!S.currentWorld) { closeModal("authorNoteModal"); return; }
    const ta = document.getElementById("authorNoteInput");
    const val = ta ? ta.value.trim().slice(0, 2000) : "";
    S.currentWorld.author_note = val;
    saveWorlds();
    closeModal("authorNoteModal");
    showToast(val ? "持续约束已保存，之后每轮生效" : "已清空持续约束", "success");
}


export function confirmRestart(worldId) {
    // ★ 修复：原生 confirm() 在预览/webview 沙箱常被静默拦截，导致点击无反应；改用项目统一弹窗
    if (!worldId && S.currentWorld) worldId = S.currentWorld.id;
    S._restartWorldId = worldId;
    closeModal("worldDetailModal");
    showModal("restartConfirmModal");
}

// ★ 修复：自定义确认弹窗里点「确认重启」后的实际执行
export function doRestartConfirmed() {
    const worldId = S._restartWorldId;
    const w = S.worlds.find(x => x.id === worldId);
    if (w) S.currentWorld = w;
    closeModal("restartConfirmModal");
    S._restartWorldId = null;
    // 新周目：重置剧情进度 + 清空行为记忆（不继承旧存档）；知识库沿用世界默认（lore_kb 挂在 world 上，startGame 不改动它）
    startGame({ resetBehavior: true });
}

// ★ E12：玩家主动推进时间——休息到次日清晨（向前推进，合法，不触发时间倒流钳制）
export function restToNextDay() {
    if (!S.gameState) return;
    const tc = getTimeConfig();
    const firstPeriod = tc.periods[0];
    if (!firstPeriod) return;
    const nextDay = S.gameState.current_date.day + 1;
    const from = deepClone(S.gameState.current_date);
    const to = { day: nextDay, period: firstPeriod };
    applyStateChanges({ current_date: to, completed_events: [createRestEvent(from, to, S.gameState.current_location)] });
    S.conversationHistory.push({
        player: "（休息到次日清晨）",
        narrative: "你合上眼，再睁开时，天已破晓，新的一天开始了。",
        retrieved: [],
        period: firstPeriod,
        day: nextDay,
        key_facts: []
    });
    renderLog();
    saveState();
    createOrUpdateSave();
    showToast("已休息到次日清晨", "success");
}


export function applyStateChanges(changes) {
    if (!changes) return;
    // ★ P1.2.6: 事务保护——先在副本上应用，任何中途异常都回滚 gameState，绝不保留半套状态
    const backup = deepClone(S.gameState);
    try {
    const s = S.gameState;
    validateStateShape(changes);   // #7 完善：异常状态类型告警

    // A4：先在副本上按结构化规则过滤，调用方响应对象保持不变。
    const guard = filterStateChangesByWorldview(changes, getBannedConceptRules(), getActiveConditionTags());
    changes = guard.changes;
    if (guard.violations.length) {
        const labels = [...new Set(guard.violations.map(v => v.matched))].slice(0, 4);
        showToast("⚠️ 已忽略与世界观不符的状态变更：" + labels.join("、"), "warn", 4000);
    }

    // ★ A6 解锁标签运算（在 banned 扫描之后、应用之前）：
    // changes.tags / changes.present_npcs 支持 {add:[...], remove:[...]} 增量操作。
    // 标签变化会改变「仍被禁用的概念」集合，故失效 system prompt 缓存以便按新解锁状态重建禁律。
    if (changes.tags || changes.present_npcs) {
        if (!Array.isArray(s.tags)) s.tags = [];
        if (!Array.isArray(s.present_npcs)) s.present_npcs = [];
        // 兼容两种格式：{add:[...],remove:[...]} 或纯数组（视为 add）
        const normTagOp = (op) => Array.isArray(op) ? { add: op } : (op && typeof op === "object" ? op : null);
        const applyTagOp = (target, op) => {
            const o = normTagOp(op);
            if (!o) return;
            if (Array.isArray(o.add)) for (const t of o.add) if (!target.includes(t)) target.push(t);
            if (Array.isArray(o.remove)) {
                for (const t of o.remove) { const i = target.indexOf(t); if (i >= 0) target.splice(i, 1); }
            }
        };
        applyTagOp(s.tags, changes.tags);
        applyTagOp(s.present_npcs, changes.present_npcs);
        invalidateSystemPromptCache();
        saveState();
    }

    if (changes.current_location) s.current_location = changes.current_location;
    // ★ 时间线进度指针：单向只增（取 max）；推进时失效 system prompt 缓存，使下轮注入的 story_progress 值同步更新
    if (typeof changes.story_progress === "number" && isFinite(changes.story_progress)) {
        const nextSp = Math.max(1, Math.floor(changes.story_progress));
        const curSp = (typeof s.story_progress === "number") ? s.story_progress : 1;
        if (nextSp > curSp) { s.story_progress = nextSp; invalidateSystemPromptCache(); }
    }
    // 注意：current_date 不在本处直接写回——时间钳制段（下方）须基于「旧时间」推导目标，
    // 若先写回则 prevSeq 失真、回退钳制失效（P1#8 真实缺陷修复）。
    if (changes.time_mode) s.time_mode = changes.time_mode;

    if (changes.attributes) {
        for (const [k, v] of Object.entries(changes.attributes)) {
            if (typeof v === "string" && v.trim() !== "") {
                s.attributes[k] = v;
            } else if (typeof v === "number") {
                // 数字只作数值提示，绝不覆盖已有文字描述（修复类型污染 #7）
                const prev = s.attributes[k];
                if (typeof prev !== "string") s.attributes[k] = `数值约 ${v}`;
                // 若已是文字描述则保留，忽略该数字，避免把"你们一见如故…"覆盖成裸数字
            }
        }
    }
    if (changes.relationships) {
        for (const [k, v] of Object.entries(changes.relationships)) {
            if (typeof v === "string" && v.trim() !== "") {
                s.relationships[k] = v;
            } else if (typeof v === "number") {
                // 数字只作数值提示，绝不覆盖已有文字描述（修复类型污染 #7）
                const prev = s.relationships[k];
                if (typeof prev !== "string") s.relationships[k] = `好感度约 ${v}`;
                // 若已是文字描述则保留，忽略该数字，避免把好感度描述覆盖成裸数字
            }
        }
    }
    if (changes.skills) {
        for (const [k, v] of Object.entries(changes.skills)) {
            if (typeof v === "string" && v.trim() !== "") {
                s.skills[k] = v;
            } else if (typeof v === "number") {
                // 数字只作数值提示，绝不覆盖已有文字描述（修复类型污染 #7）
                const prev = s.skills[k];
                if (typeof prev !== "string") s.skills[k] = `数值约 ${v}`;
                // 若已是文字描述则保留，忽略该数字
            }
        }
    }
    if (changes.progression) s.progression = { ...s.progression, ...changes.progression };

    if (changes.inventory) {
        for (const op of changes.inventory) {
            const itemTags = (op.tags && Array.isArray(op.tags)) ? op.tags : null;
            if (op.op === "add") {
                const found = s.inventory.find(i => i.item_id === op.item_id);
                if (found) {
                    found.count += op.count;
                    if (itemTags) found.tags = itemTags; // ★ A6：持有期间激活物品标签（如 has_firearm）
                } else {
                    s.inventory.push({ item_id: op.item_id, name: op.name, count: op.count, world: op.world || null, tags: itemTags });
                }
            } else if (op.op === "remove") {
                const found = s.inventory.find(i => i.item_id === op.item_id);
                if (found) {
                    found.count -= op.count;
                    if (found.count <= 0) s.inventory = s.inventory.filter(i => i.item_id !== op.item_id);
                }
            } else if (op.op === "clear_world") {
                s.inventory = s.inventory.filter(i => i.world !== op.world);
            }
        }
    }

    if (changes.goal_updates) {
        for (const u of changes.goal_updates) {
            const g = s.goals.find(x => x.goal_id === u.goal_id);
            if (g) {
                if (u.status) g.status = u.status;
                if (typeof u.visible === "boolean") g.visible = u.visible;   // 隐藏目标转可见
                if (u.name) g.name = u.name;
                if (u.deadline) g.deadline = u.deadline;
            } else if (u.goal_id && u.name) {
                // 新增目标（目标链 / 隐藏任务揭示）—原先 find 不到会静默丢弃，现补建（#6）
                s.goals.push({
                    goal_id: u.goal_id,
                    name: u.name,
                    type: u.type || "其他",
                    deadline: u.deadline || null,
                    visible: u.visible !== false,
                    status: u.status || "active"
                });
            }
        }
    }

    if (changes.status_effects) {
        s.status_effects = changes.status_effects;
    }

    if (changes.is_alive === false) {
        s.is_alive = false;
        s.death_reason = changes.death_reason || "未知原因";
    }

    // E1–E10：所有时间形态统一转换为绝对分钟，显示字段从绝对分钟反推。
    const tc = getTimeConfig();
    const timeChange = changes.current_date
        ? { ...changes.current_date }
        : changes.period
            ? { period: changes.period }
            : null;
    if (timeChange) {
        const result = advanceWorldTime(s.current_date, timeChange, tc.periods || DEFAULT_PERIOD_ORDER);
        s.current_date = result.currentDate;
        if (result.rejected) console.warn("AI 试图回退时间，已忽略", timeChange);
    } else {
        s.current_date = hydrateWorldTime(s.current_date, tc.periods || DEFAULT_PERIOD_ORDER);
    }

    // E8/D1：世界级 deadline 到点转成一次性结构化事件，并写入高重要记忆。
    if (!Array.isArray(s.triggered_deadlines)) s.triggered_deadlines = [];
    const dueDeadlines = collectDueDeadlines(
        s.current_date,
        tc.timeConfig?.deadlines || [],
        tc.periods || DEFAULT_PERIOD_ORDER,
        new Set(s.triggered_deadlines)
    );
    const simulationChanges = deepClone(changes);
    if (dueDeadlines.length) {
        simulationChanges.active_events = [
            ...(Array.isArray(simulationChanges.active_events) ? simulationChanges.active_events : []),
            ...dueDeadlines.map(deadline => ({
                id: "deadline_" + deadline.id,
                title: deadline.title,
                stage: "到期",
                impact: "世界时限已到，请在叙事中体现后果"
            }))
        ];
        for (const deadline of dueDeadlines) {
            s.triggered_deadlines.push(deadline.id);
            addBehaviorRecords([{ text: `世界时限「${deadline.title}」已到，后果需要在剧情中体现。`, importance: 5, type: "event" }]);
        }
    }
    Object.assign(s, applySimulationChanges(s, simulationChanges, s.current_date));
    checkGoalDeadlines();

    saveState();
    updateGameDayInfo();
    } catch (e) {
        S.gameState = backup; // 回滚到变更前
        throw e;
    }
}

export function checkGoalDeadlines() {
    if (!S.gameState || !S.gameState.goals) return;
    const st = S.gameState;
    const tc = getTimeConfig();
    const periodOrder = (tc && tc.periods) || DEFAULT_PERIOD_ORDER;
    const currentTime = hydrateWorldTime(st.current_date, periodOrder);
    for (const g of st.goals) {
        if (g.status !== "active" || !g.deadline) continue;
        const deadlineTime = hydrateWorldTime({ day: g.deadline.day, period: g.deadline.period }, periodOrder);
        if (currentTime.absolute_minutes > deadlineTime.absolute_minutes) {
            g.status = "failed";   // 严格大于：恰好抵达 deadline 时段仍可完成
            g.failed_at = { day: st.current_date.day, period: st.current_date.period };
            // #6 完善：把失败后果记入关键事实，下一轮 AI 会在叙事中体现（而非仅改状态）
            const dlText = "第" + g.deadline.day + "天" + (g.deadline.period || "");
            addBehaviorRecords(["目标「" + (g.name || g.goal_id) + "」已失败（未在" + dlText + "前达成），其后果需在剧情中体现。"]);
        }
    }
}

export function buildSmartFallbackChoices() {
    const loc = S.gameState.current_location || "这里";
    const kb = getWorldLoreKB();
    // P1#9：优先用知识库「人物」片段的真实姓名作为 NPC 名；
    // 关系表里的 guide_npc / rival_npc 等占位 key 不作为展示名，避免兜底选项显示"与 guide_npc 交谈"。
    const kbNpcNames = (kb && kb.snippets)
        ? kb.snippets.filter(s => s.category === "人物").map(s => s.title)
        : [];
    const relNames = S.gameState.relationships
        ? Object.keys(S.gameState.relationships).filter(k => !k.endsWith("_npc"))
        : [];
    const npcPool = kbNpcNames.length ? kbNpcNames : relNames;
    const locations = (kb && kb.snippets) ? kb.snippets.filter(s => s.category === "地点").map(s => s.title) : [];
    const events = (kb && kb.snippets) ? kb.snippets.filter(s => s.category === "事件").map(s => s.title) : [];

    const choices = [];

    // 优先：与当前在场的 NPC 互动
    if (npcPool.length > 0) {
        const npc = npcPool[Math.floor(Math.random() * npcPool.length)];
        choices.push({ text: "与" + npc + "交谈", action: "talk_to_" + npc });
    }

    // 次优先：移动到附近地点
    const nearby = locations.filter(l => l !== loc);
    if (nearby.length > 0) {
        const place = nearby[Math.floor(Math.random() * nearby.length)];
        choices.push({ text: "前往" + place, action: "go_to_" + place });
    }

    // 再次：探索当前场景或触发事件
    choices.push({ text: "仔细打量" + loc + "的每个角落", action: "explore" });

    // 兜底：让事件继续发展
    choices.push({ text: "让事件继续发展", action: "continue_story" });

    // 第四：推进或休息
    if (events.length > 0) {
        const evt = events[Math.floor(Math.random() * events.length)];
        choices.push({ text: "打听关于「" + evt + "」的线索", action: "investigate" });
    } else {
        choices.push({ text: "在原地稍作停留，整理思绪", action: "rest" });
    }

    // 确保至少 3 个
    if (choices.length < 3) {
        choices.push({ text: "环顾四周", action: "look" });
    }

    // 限制最多 4 个
    return choices.slice(0, 4);
}

export async function submitInput() {
    skipTypewriter();
    if (S.isGenerating) { showToast("上一回合仍在生成，请稍候", "warn"); return; }
    const inputEl = document.getElementById("playerInput");
    const input = inputEl.value.trim();
    if (!input) return;
    inputEl.value = "";
    renderChoices([]); // 发送时立即隐藏选项
    await processTurn(input);
}

export function chooseOption(index) {
    const choice = S.currentChoices[index];
    if (!choice) return;
    document.getElementById("playerInput").value = choice.text;
    // 只填入，不自动发送，方便玩家修改
}

export async function processTurn(input) {
    if (!S.gameState) return;
    if (S.gameState.is_alive === false) {
        checkDeathBanner();
        showToast("角色已死亡，无法继续操作", "error", 3000);
        return;
    }

    if (!acquireTurn(S)) { showToast("上一回合仍在生成，请稍候", "warn"); return; }
    const myEpoch = S.currentSession.epoch;
    const myWorldId = S.currentWorld && S.currentWorld.id;
    try {
    showLoading("正在思考...");
    // ★ 前端防注入检测
    const injectionCheck = detectPromptInjection(input);
    if (injectionCheck) {
        hideLoading();
        const model = document.getElementById("modelName")?.value || "unknown";
        const turnNum = S.debugLog.turns.length + 1;
        S.debugLog.turns.push({
            turn: turnNum,
            time: new Date().toISOString(),
            worldId: S.currentWorld ? S.currentWorld.id : null,
            worldName: S.currentWorld ? S.currentWorld.name : null,
            model: model,
            temperature: getTemperature(),
            status: "blocked",
            rejectionReason: injectionCheck.label,
            inputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0,
            outputTokens: 0, totalTokens: 0, hitRate: "0",
            playerInput: input.slice(0, 200)
        });
        const blockEntry = {
            player: input,
            narrative: "（系统拦截）" + injectionCheck.reason,
            retrieved: [],
            period: S.gameState.current_date.period,
            day: S.gameState.current_date.day,
            key_facts: [],
            isWarning: true
        };
        S.conversationHistory.push(blockEntry);
        saveState();
        renderLog();
        renderChoices([]);
        showToast(injectionCheck.reason, "warn");
        return;
    }
        const retrieved = await retrieve(input);
        const resp = await callLLM(input, retrieved);
        // ★ P0: 会话失效校验 —— 期间若发生导航/切换/重开，丢弃此响应
        if (resp._sessionEpoch !== myEpoch || resp._sessionWorldId !== (S.currentWorld && S.currentWorld.id)) {
            hideLoading();
            console.warn("丢弃过期/串世界的响应：会话标识不匹配");
            return;
        }
        hideLoading();

        // 检测是否为非故事内容（拒绝/限制/错误响应）
        const isWarning = isNonStoryResponse(resp.narrative);

        if (isWarning) {
            // ⚠️ 非故事内容：不应用状态变更、不写入知识库、不影响记忆
            const entry = {
                player: input,
                narrative: resp.narrative || "（无内容）",
                retrieved: retrieved.map(s => s.title),
                period: S.gameState.current_date.period,
                day: S.gameState.current_date.day,
                key_facts: [],
                isWarning: true
            };
            S.conversationHistory.push(entry);
            // 明确跳过 applyStateChanges 和 addBehaviorRecords
        } else {
            // ✅ 正常故事内容
            applyStateChanges(resp.state_changes);

            // ★ A2 生成后世界观合规守卫（柔和提醒，不阻断回合）
            const localViolations = findWorldviewViolations(resp.narrative, getBannedConceptRules(), getActiveConditionTags());
            if (localViolations.length) {
                const hit = localViolations[0].matched;
                if (hit) {
                    showToast("⚠️ 叙事似乎偏离了世界观（出现「" + hit + "」），若非有意为之可重述或忽略。", "warn", 4000);
                }
            }

            // ★ A7 AI 灵活世界观裁判（语义判断是否超出世界观，非阻断，仅提示）
            // 异步进行，不阻塞回合渲染；裁判只看世界设定+叙事，不被玩家输入带偏
            const judgeEnabled = shouldRunAIEnhancements({
                enabled: S.aiEnhanced,
                freedom: S.currentWorld && S.currentWorld.plot_freedom,
                hasLore: !!(S.activeLoreKB && S.activeLoreKB.snippets && S.activeLoreKB.snippets.length)
            });
            const judgeContext = {
                worldId: S.currentWorld && S.currentWorld.id,
                epoch: S.currentSession.epoch,
                turnId: S.conversationHistory.length + 1
            };
            if (judgeEnabled) judgeWorldviewConsistency(resp.narrative, resp.state_changes, { playerInput: input }).then(result => {
                const currentContext = {
                    worldId: S.currentWorld && S.currentWorld.id,
                    epoch: S.currentSession.epoch,
                    turnId: S.conversationHistory.length
                };
                if (!isEnhancementContextCurrent(judgeContext, currentContext)) return;
                if (result && result.consistent === false && result.violations && result.violations.length) {
                    const v = result.violations.slice(0, 2).join("、");
                    const msg = result.severity === "hard"
                        ? "⚠️ AI 裁判：叙事似乎引入了世界观之外的内容（如：" + v + "）。若非有意为之，可重述或忽略。"
                        : "💡 AI 提示：以下内容可能与世界观不太契合（" + v + "），供参考。";
                    showToast(msg, "warn", 5000);
                }
            }).catch(() => { /* 裁判异常不影响主流程 */ });

            const entry = {
                player: input,
                narrative: resp.narrative || "（无叙事）",
                retrieved: retrieved.map(s => s.title),
                period: S.gameState.current_date.period,
                day: S.gameState.current_date.day,
                key_facts: resp.key_facts || []
            };
            S.conversationHistory.push(entry);

            // 推入多轮对话历史（仅正常轮次，警告/错误轮次不入历史，避免污染上下文）
            pushChatTurn(resp._turnUserContent, resp);

            // 添加关键事实到 RAG
            const facts = resp.key_facts || summarizeFactsFromChanges(input, resp.narrative, resp.state_changes);
            addBehaviorRecords(facts);

            // 如果刚死亡，立即显示横幅 + 禁用输入
            if (S.gameState.is_alive === false) {
                checkDeathBanner();
                updateInputState();
            }
        }

        // ★ P1.2.7: 选项先写回记录并持久化，再生成存档列表项，避免存档里选项为空
        let finalChoices = [];
        if (!isWarning) {
            // 计算最终选项（AI 返回空时兜底），必须存储 finalChoices 而非原始空值
            finalChoices = resp.choices;
            if (!finalChoices || finalChoices.length === 0) {
                finalChoices = buildSmartFallbackChoices();
            }
            // ★ 将最终选项存入记录并持久化（含兜底）
            if (S.conversationHistory.length > 0) {
                S.conversationHistory[S.conversationHistory.length - 1].choices = finalChoices;
            }
            saveState();
        }

        createOrUpdateSave();

        // ★ B5：每 20 轮对话后台触发知识库修订（非阻塞，不阻断游戏）
        if (!isWarning) {
            const msgCount = S.conversationHistory.filter(e => !e.isWarning).length;
            if (S.aiEnhanced && msgCount >= S.lastLoreReviewMsgCount + 20 && S.activeLoreKB) {
                triggerLoreRevision(msgCount);
            }
        }

        renderLog();

        if (!isWarning) {
            // 打字完成后显示选项
            await startTypewriter(S.conversationHistory.length - 1);
            renderChoices(finalChoices);
            if (S.gameState.is_alive === false) {
                setTimeout(showGameOver, 800);
            }
        } else {
            // 警告内容不提供选项，也不做打字效果
            renderChoices([]);
        }
    } catch (e) {
        hideLoading();
        // 导航/切世界会递增 epoch 并中止请求；旧请求异常必须静默丢弃，禁止写入新会话。
        if (!isSessionContextCurrent(
            { epoch: myEpoch, worldId: myWorldId },
            { epoch: S.currentSession.epoch, worldId: S.currentWorld && S.currentWorld.id }
        )) return;
        // ★ 日志分离：即使 parse/API 失败也记录到 debugLog.turns
        const model = document.getElementById("modelName")?.value || "unknown";
        const temp = getTemperature();
        const turnNum = S.debugLog.turns.length + 1;
        S.debugLog.turns.push({
            turn: turnNum,
            time: new Date().toISOString(),
            worldId: S.currentWorld ? S.currentWorld.id : null,
            worldName: S.currentWorld ? S.currentWorld.name : null,
            model: model,
            temperature: temp,
            status: "error",
            errorType: e.message.includes("JSON 解析失败") ? "parse_failure" :
                       e.message.includes("Failed to fetch") || e.message.includes("NetworkError") ? "network" :
                       e.message.includes("超时") ? "timeout" : "unknown",
            errorMessage: e.message,
            inputTokens: 0,
            cacheHitTokens: 0,
            cacheMissTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            hitRate: "0",
            playerInput: input.slice(0, 200)
        });

        // 网络/API 错误也作为警告展示，不影响游戏状态
        const errorEntry = {
            player: input,
            narrative: "请求失败：" + e.message,
            retrieved: [],
            period: S.gameState.current_date.period,
            day: S.gameState.current_date.day,
            key_facts: [],
            isWarning: true
        };
        S.conversationHistory.push(errorEntry);
        saveState();
        renderLog();
        renderChoices([]);
        // 识别常见错误类型并给出针对性提示
        let errorMsg = e.message;
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("failed to fetch")) {
            errorMsg = "网络请求失败（大概率是 CORS 跨域限制）。请在 API 配置中填写 CORS 代理 URL，或使用浏览器 CORS 插件。详见配置弹窗中的提示说明。";
        }
        showToast("出错了：" + errorMsg, "error");
        console.error(e);
    } finally {
        releaseTurn(S);
    }
}


export function backToHomeAfterGameOver() {
    document.getElementById("gameOverOverlay").classList.remove("show");
    goHome();
}

export function reviewDeathScene() {
    document.getElementById("gameOverOverlay").classList.remove("show");
    checkDeathBanner();
    updateInputState();
    renderLog(true);
}

// ★ C1/C3: 记忆操作（供记忆面板使用）
export function togglePinMemory(id) {
    const r = S.activeBehaviorRecords.find(b => b.id === id);
    if (r) { r.pinned = !r.pinned; createOrUpdateSave(); renderStatusPanel(S.currentStatusTab); }
}

function updateAIEnhancedButton() {
    const button = document.getElementById("aiEnhancedToggle");
    if (button) button.textContent = S.aiEnhanced
        ? "🧠 AI 增强检查：已开启"
        : "🧠 AI 增强检查：已关闭";
}

export function showGameSettings() {
    updateAIEnhancedButton();
    showModal("gameSettingsModal");
}

export function toggleAIEnhanced() {
    S.aiEnhanced = !S.aiEnhanced;
    updateAIEnhancedButton();
    createOrUpdateSave();
    showToast(S.aiEnhanced ? "AI 增强检查已开启（会产生额外 API 调用）" : "AI 增强检查已关闭", "success", 3500);
}

export function deleteMemory(id) {
    S.activeBehaviorRecords = S.activeBehaviorRecords.filter(b => b.id !== id);
    createOrUpdateSave();
    renderStatusPanel(S.currentStatusTab);
    showToast("记忆已删除", "success");
}

export function exportMemoryPack() {
    const pack = createMemoryPack(S.activeBehaviorRecords, { worldName: S.currentWorld && S.currentWorld.name });
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `以太叙事-记忆包-${(S.currentWorld?.name || "世界").replace(/[\\/:*?"<>|]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${pack.memories.length} 条记忆`, "success");
}

export function triggerMemoryPackImport() {
    const input = document.getElementById("memoryPackFile");
    if (input) { input.value = ""; input.click(); }
}

export async function importMemoryPack(file) {
    if (!file) return;
    try {
        const pack = JSON.parse(await file.text());
        const result = mergeMemoryPack(S.activeBehaviorRecords, pack);
        S.activeBehaviorRecords = result.memories;
        createOrUpdateSave();
        renderStatusPanel("memory");
        showToast(`记忆包已合并：新增 ${result.added} 条，合并 ${result.merged} 条`, "success", 4000);
    } catch (error) {
        showToast("记忆包导入失败：" + error.message, "error", 4000);
    }
}

// （时间设置已迁移至知识库初览面板：见 lore-ui.js 的 renderTimeConfigSection；游戏中不再提供独立二级弹窗）

// ===== A：世界（含知识库 lore_kb）导入 / 导出 =====
// 导出整个世界（含知识库向量，或剥离向量），生成可分享的 .json 包。
export function exportWorld(worldId, lite = false) {
    const world = S.worlds.find(w => w.id === worldId);
    if (!world) { showToast("未找到该世界", "error"); return; }
    const pack = createWorldPack(world, { includeEmbeddings: !lite });
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `以太叙事-世界-${(world.name || "world").replace(/[\\/:*?"<>|]/g, "_")}${lite ? "-精简" : ""}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`已导出世界「${world.name}」${lite ? "（精简·不含向量，导入时需重算）" : "（完整·含向量）"}`, "success", 4000);
}

// 点击「导入世界」→ 触发隐藏的文件选择框
export function triggerWorldPackImport() {
    const input = document.getElementById("worldPackFile");
    if (input) { input.value = ""; input.click(); }
}

// 文件选择后：解析 → 合并 → 持久化 → 刷新列表
export async function importWorld(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const result = await importWorldPack(text, { onConflict: "rename" });
        if (result.action === "skipped") {
            showToast("已跳过：世界 ID 冲突且选择跳过", "info");
            return;
        }
        renderWorldList();
        const conflictNote = result.conflictId ? `（ID 冲突已自动改名：${result.imported.id}）` : "";
        const embedNote = result.needsEmbedding ? "（当前环境无法计算向量，已降级为关键词检索）" : "";
        showToast(`世界「${result.imported.name}」已导入${conflictNote}${embedNote}`, "success", 4000);
    } catch (error) {
        showToast("世界导入失败：" + error.message, "error", 4000);
    }
}

// 点击「导出世界」→ 弹出 精简版 / 完整版 选择
let pendingExportWorldId = null;
export function showExportWorldChoice(worldId) {
    pendingExportWorldId = worldId;
    showModal("exportWorldChoiceModal");
}

export function exportWorldChoice(lite) {
    const id = pendingExportWorldId;
    pendingExportWorldId = null;
    closeModal("exportWorldChoiceModal");
    if (!id) { showToast("未找到目标世界", "error"); return; }
    exportWorld(id, lite);
}
