// ============================================================
// AetherNarrator · game.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_ORDER, LINK_RELATION_LABELS, STORAGE_KEYS, getActiveConditionTags, getBannedConceptRules, getBannedConcepts } from "./store.js";
import { pickWorldTags, capSource, deepClone, defaultInitialState, defaultWorldSchema, escapeHtml, getWorldSchema, isNonStoryResponse, sanitizeAtmosphere, sanitizeWorldConfig, validateStateShape } from "./utils.js";
import { getPeriodLabel, getTemperature, getTimeConfig, formatWorldTime, formatTimeLabel, formatDeadlineLabel, stepOf } from "./theme.js";
import { ensureCurrentDate, compareCalendar, advanceCalendarTime } from "./calendar.js";
import { saveSaves, saveState, saveWorlds, clearCurrentRunState, importWorldPack } from "./storage.js";
import { clearSourceFile } from "./files.js";
import { addBehaviorRecords, ensureLoreEmbeddings, retrieve, summarizeFactsFromChanges } from "./rag.js";
import { detectPromptInjection, invalidateSystemPromptCache, pushChatTurn, rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";
import { callLLM, callWorldGenerationLLM, extractLoreFromSource, callLoreRevisionLLM, judgeWorldviewConsistency } from "./llm.js";
import { checkDeathBanner, closeModal, getSelectedStyleRef, hideLoading, renderChoices, renderLog, renderSaveDetail, renderSaveList, renderStatusPanel, renderWorldList, restoreLastChoices, showGameOver, showLoading, showModal, showScreen, showToast, skipTypewriter, startTypewriter, stopTypewriter, updateGameDayInfo, updateInputState, isSourceFileUploaded } from "./render.js";
import { filterStateChangesByWorldview, findWorldviewViolations, isEnhancementContextCurrent, shouldRunAIEnhancements, evaluateRules, recordWorldviewNag } from "./worldview.js";
import { createMemoryPack, mergeMemoryPack } from "./memory-transfer.js";
import { createWorldPack } from "./world-transfer.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { runWorldCritic, triggerWorldCritic, confirmCriticRevision, rejectCriticRevision } from "./critic.js"; // ★ Phase 3：审稿人
import { advanceWorldTime, collectDueDeadlines } from "./time-engine.js";
import { activeTimelineKey, getTimelineTriggered, recordTrigger, resetTriggers, createBranch } from "./triggers.js";
import { applySimulationChanges, createRestEvent, normalizeSimulationState } from "./simulation.js";
import { acquireTurn, isSessionContextCurrent, releaseTurn } from "./turn-lifecycle.js";

// 以下函数体已拆分至 save.js / lore-ui.js；此处重新导出以保持 app.js / render.js 的导入不变
import { abortCurrentRequest, startGame, continueLatestSave, loadSave, deleteSave, deleteWorld, createOrUpdateSave } from "./save.js";
import { openLoreReview, editWorldLore, editSaveLore, addLoreEntry, deleteLoreEntry, saveLoreReview, triggerLoreRevision, confirmLoreRevision, rejectLoreRevision, toggleLoreSpoiler, toggleLoreRequireConfirm, openRuleEditor, addRule, deleteRule, ruleTypeChange, importBannedAsRules, saveRuleReview, extractAndMergeSourceLore } from "./lore-ui.js";
export { abortCurrentRequest, startGame, continueLatestSave, loadSave, deleteSave, deleteWorld, createOrUpdateSave };
export { openLoreReview, editWorldLore, editSaveLore, addLoreEntry, deleteLoreEntry, saveLoreReview, triggerLoreRevision, confirmLoreRevision, rejectLoreRevision, toggleLoreSpoiler, toggleLoreRequireConfirm, openRuleEditor, addRule, deleteRule, ruleTypeChange, importBannedAsRules, saveRuleReview, triggerWorldCritic, confirmCriticRevision, rejectCriticRevision, extractAndMergeSourceLore };

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
            const timeStr = entry.tcd ? formatTimeLabel(entry.tcd, getTimeConfig().timeConfig) : ("第 " + (entry.day || 1) + " 天");
            text += "【玩家 · " + timeStr + "】\n";
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
            // 分块/并发/合并/重排id/改写links 的逻辑已抽到 llm.js 的 extractLoreFromSource（含 relations 三元组）。
            const chunkCount = Math.max(1, Math.ceil(src.length / CHUNK_SIZE));
            showToast(`本书较大，知识库将分 ${chunkCount} 段生成，可能需要较长时间（数十次 API 调用），请耐心等待。`, "warn");
            // ① 基础世界配置（结构/开场）由首段生成
            const firstChunk = src.slice(0, CHUNK_SIZE);
            generated = sanitizeWorldConfig(await callWorldGenerationLLM(name, type, desc, hero, ipName, firstChunk, styleRef, customStyle, plotFreedom, worldPrefix, CHUNK_SIZE, COUNT_HINT));
            // ② 逐段抽取 lore 并合并（覆盖全书，同名条目汇总；含 relations 三元组）
            const extracted = await extractLoreFromSource(src, name, ipName, styleRef, customStyle, {
                onRetry: (idx, total, kind, n) => showToast(`第 ${idx}/${total} 段${kind === "生成结果损坏" ? "生成结果损坏" : "被限流"}，自动重试(${n})...`, "warn"),
                onProgress: (done, total) => { btn.textContent = `生成中 (已完成 ${done}/${total})...`; },
                onChunkError: (idx, err) => {
                    showToast(`第 ${idx}/${chunkCount} 段知识库生成失败，已跳过：${err.message}`, "error");
                    console.warn(err);
                    if (S.debugLog && S.debugLog.chunkErrors) {
                        S.debugLog.chunkErrors.push({ time: new Date().toISOString(), chunkIndex: idx, total: chunkCount, errorMessage: err && err.message });
                    }
                }
            });
            loreKb = { ip: name, snippets: extracted.snippets };
            try { await ensureLoreEmbeddings(loreKb, (done, total) => { btn.textContent = `生成中 (向量化 ${done}/${total})...`; }); }
            catch (e) { console.warn("知识库向量预计算失败，将降级为关键词检索:", e.message); }
        } else {
            // 小书：沿用原有单次生成
            generated = sanitizeWorldConfig(await callWorldGenerationLLM(name, type, desc, hero, ipName, src, styleRef, customStyle, plotFreedom, worldPrefix));
            loreKb = generated.lore_kb;
            if (loreKb) {
                try { await ensureLoreEmbeddings(loreKb, (done, total) => { btn.textContent = `生成中 (向量化 ${done}/${total})...`; }); }
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
            tags: pickWorldTags(generated, { name, desc, hero, type, ipName }),
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
            custom_prefix: customPrefix,
            rules: [] // ★ Phase 2：规则 DSL（创作者界面配置，见 docs/Phase2改造方案.md）
        };
        S.worlds.unshift(world);
        saveWorlds();
        // ★ Phase 3：生成后自动审稿（fire-and-forget，不阻塞"世界已创建"提示）
        runWorldCritic(world).catch(e => console.warn("自动审稿失败：", e && e.message));
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
    const cur = S.gameState.current_date;
    const from = deepClone(cur);
    // 下一天：dated 模式 +1 天；period/day 模式 day+1；none 模式仅 step+1。
    // advanceCalendarTime 统一按模式推进，并同步 bump step（避免 period/day 模式 step/day 错位）。
    const mode = tc.timeConfig.calendar_mode;
    const to = advanceCalendarTime(cur, { days: 1 }, mode, tc.periods, tc.timeConfig.custom_calendar);
    to.period = firstPeriod;
    applyStateChanges({ current_date: to, completed_events: [createRestEvent(from, to, S.gameState.current_location)] });
    S.conversationHistory.push({
        player: "（休息到次日清晨）",
        narrative: "你合上眼，再睁开时，天已破晓，新的一天开始了。",
        retrieved: [],
        period: firstPeriod,
        day: stepOf(to),
        tcd: deepClone(to),
        key_facts: []
    });
    renderLog();
    // ★ 性能：删除冗余 saveState——下方 createOrUpdateSave() 内部已统一持久化（当前存档 + 存档槽），避免手动操作双写。
    createOrUpdateSave();
    showToast("已休息到次日清晨", "success");
}

// Phase 2/3 多世界/分支：手动切换时间线或分支（顶栏切换控件调用；S4 切回主线/其它分支）
export function switchTimeline(id) {
    if (!S.gameState || !S.currentWorld) return;
    const tc = getTimeConfig();
    // 优先匹配分支（S4：单世界也能分支，不受 multiverse 限制）
    if (S.gameState.branches && S.gameState.branches[id]) {
        S.gameState.active_timeline = id;
        S.gameState.current_date = deepClone(S.gameState.branches[id].current_date);
        invalidateSystemPromptCache();
        updateGameDayInfo();
        if (typeof renderStatusPanel === "function") renderStatusPanel(S.currentStatusTab);
        // ★ 性能：删除冗余 saveState——下方 createOrUpdateSave() 内部已统一持久化，避免手动操作双写。
        createOrUpdateSave();
        showToast("已切换到分支：" + (S.gameState.branches[id].label || id), "success");
        return;
    }
    // 多世界时间线（Phase 2）
    if (tc.timeConfig.mode !== "multiverse" || !tc.timelines || !tc.timelines[id]) {
        showToast("当前世界不支持时间线切换", "warn");
        return;
    }
    if (!S.gameState.timelines || !S.gameState.timelines[id]) {
        showToast("时间线不存在：" + id, "error");
        return;
    }
    // 当前 active 线的进度已在每次 applyStateChanges 时镜像同步，直接切换即可（互不丢进度）
    S.gameState.active_timeline = id;
    S.gameState.current_date = deepClone(S.gameState.timelines[id].current_date);
    invalidateSystemPromptCache();
    updateGameDayInfo();
    if (typeof renderStatusPanel === "function") renderStatusPanel(S.currentStatusTab);
    // ★ 性能：删除冗余 saveState——下方 createOrUpdateSave() 内部已统一持久化，避免手动操作双写。
    createOrUpdateSave();
    showToast("已切换到时间线：" + (tc.timelines[id].name || id), "success");
}


export function applyStateChanges(changes) {
    if (!changes) return;
    // ★ P1.2.6: 事务保护——先在副本上应用，任何中途异常都回滚 gameState，绝不保留半套状态
    // ★ P1 性能：backup 延迟到「校验 + 世界观过滤之后、首次原地变更之前」才克隆整份状态；
    //   若前两步因 AI 畸形响应抛错，状态本未被改动，无需快照（跳过一次 deepClone）。
    //   正常回合仍会克隆一次（568 行 Object.assign 必改状态），行为与改动前一致。
    let backup = null;
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
    if (!backup) backup = deepClone(S.gameState); // ★ P1 性能：首次变更前才克隆整份状态快照（此后异常可回滚）
    if (changes.tags || changes.present_npcs || changes.revealed_locations) {
        if (!Array.isArray(s.tags)) s.tags = [];
        if (!Array.isArray(s.present_npcs)) s.present_npcs = [];
        if (!Array.isArray(s.revealed_locations)) s.revealed_locations = [];
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
        applyTagOp(s.revealed_locations, changes.revealed_locations);
        invalidateSystemPromptCache();
        // ★ P0 性能：不再在此存盘——持久化统一由调用方（processTurn / 手动时间穿越）在回合末经 createOrUpdateSave() 完成，避免每回合重复写盘。
    }

    if (changes.current_location) {
        const oldLoc = s.current_location;
        s.current_location = changes.current_location;
        // ★ L3 认知追踪：离开某地点后，角色自然"知道那个地方存在且可达"，
        // 故把旧所在地自动加入 revealed_locations（排除当前所在地、占位空值、重复）。
        if (typeof oldLoc === "string" && oldLoc && oldLoc !== changes.current_location
            && Array.isArray(s.revealed_locations) && !s.revealed_locations.includes(oldLoc)) {
            s.revealed_locations.push(oldLoc);
        }
    }
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

    // E1–E10：所有时间形态统一处理（方案 B：模式分派，无隐藏序数）
    const tc = getTimeConfig();
    const timeCtx = { ...tc.timeConfig, periods: tc.periods };
    const timeChange = changes.current_date
        ? { ...changes.current_date }
        : changes.period
            ? { period: changes.period }
            : null;
    if (timeChange) {
        const result = advanceWorldTime(s.current_date, timeChange, timeCtx);
        s.current_date = result.currentDate;
        if (result.rejected) console.warn("AI 试图回退时间，已忽略", timeChange);
    } else {
        // 无时间变更：保持原状，仅规范化形状（补齐 step 等）
        s.current_date = ensureCurrentDate(s.current_date, tc.timeConfig);
    }

    // Phase 2/3：把当前 active 时间线/分支的 current_date 写回（防止切换回去丢失进度）
    if (s.active_timeline) {
        if (s.timelines && s.timelines[s.active_timeline]) {
            s.timelines[s.active_timeline].current_date = deepClone(s.current_date);
        } else if (s.branches && s.branches[s.active_timeline]) {
            s.branches[s.active_timeline].current_date = deepClone(s.current_date);
        }
    }

    // Phase 2 多世界：切换时间线（事件/选项可带 switch_timeline）
    if (changes.switch_timeline && tc.timeConfig.mode === "multiverse" && s.timelines && s.timelines[changes.switch_timeline]) {
        s.active_timeline = changes.switch_timeline;
        s.current_date = deepClone(s.timelines[changes.switch_timeline].current_date);
        invalidateSystemPromptCache();
    }

    // Phase 3 · S3-2：时间穿越 reset_triggers（S3 重置回放）—— 回滚当前线触发记录
    if (timeChange && timeChange.reset_triggers) {
        resetTriggers(s, timeChange.reset_triggers, activeTimelineKey(s));
    }
    // Phase 3 · S3-2：时间穿越 branch（S4 分支隔离）—— 新建分支时间线，原未来保留
    if (timeChange && timeChange.branch) {
        createBranch(s, timeChange.branch_label, s.current_date, tc);
    }

    // E8/D1：世界级 deadline 到点转成一次性结构化事件，并写入高重要记忆。
    // Phase 3：触发记录按当前 active 时间线/分支隔离（S1 不重触发 / S2 可重复）。
    const tKey = activeTimelineKey(s);
    const rec = getTimelineTriggered(s, tKey);
    const dueDeadlines = collectDueDeadlines(
        s.current_date,
        tc.timeConfig?.deadlines || [],
        timeCtx,
        rec.ids,
        rec.state,
        stepOf(s.current_date)
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
            recordTrigger(s, deadline.id, stepOf(s.current_date), tKey);
            addBehaviorRecords([{ text: `世界时限「${deadline.title}」已到，后果需要在剧情中体现。`, importance: 5, type: "event" }]);
        }
    }
    Object.assign(s, applySimulationChanges(s, simulationChanges, s.current_date));
    checkGoalDeadlines();

    // ★ P0 性能：不再在此存盘——持久化统一由 processTurn 末尾的 createOrUpdateSave() 完成，避免每回合重复写盘。
    updateGameDayInfo();
    } catch (e) {
        if (backup) S.gameState = backup; // 回滚到变更前（无备份说明尚未任何变更，无需回滚）
        throw e;
    }
}

export function checkGoalDeadlines() {
    if (!S.gameState || !S.gameState.goals) return;
    const st = S.gameState;
    const tc = getTimeConfig();
    const mode = tc.timeConfig.calendar_mode;
    const custom = tc.timeConfig.custom_calendar;
    const cur = st.current_date;
    for (const g of st.goals) {
        if (g.status !== "active" || !g.deadline) continue;
        const dl = g.deadline;
        let overdue;
        if (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") {
            const start = tc.timeConfig.calendar_start || { year: 1, month: 1, date: 1 };
            const curDate = { year: cur.year, month: cur.month, date: cur.date };
            const target = {
                year: dl.year != null ? dl.year : start.year,
                month: dl.month != null ? dl.month : 1,
                date: dl.date != null ? dl.date : 1
            };
            overdue = compareCalendar(curDate, target, mode, custom) > 0; // 严格大于：恰好抵达 deadline 时段仍可完成
        } else {
            const curStep = stepOf(cur);
            const dlStep = dl.day != null ? dl.day : 0;
            overdue = curStep > dlStep;
        }
        if (overdue) {
            g.status = "failed";
            g.failed_at = { ...cur };   // 原生快照，显示层用 formatTimeLabel 渲染
            const dlText = formatDeadlineLabel(dl, tc.timeConfig);
            addBehaviorRecords(["目标「" + (g.name || g.goal_id) + "」已失败（未在" + dlText + "前达成），其后果需在剧情中体现。"]);
        }
    }
}

export function buildSmartFallbackChoices() {
    // ★ 选项场景一致性修复（docs/18）+ L3 认知追踪：
    // 保底选项优先基于「真实场景状态」生成"与在场角色交谈 / 前往已知地点"，
    // 但只在这些状态确实存在时才出现；其余用「场景安全」通用动作补足，
    // 绝不引用 lore_kb 全量设定（避免孤立场景出现"与警犬交流""前往 Level 2"）。

    const picked = [];

    // —— L3 增强分支：基于游戏状态，且默认空 → 不触发，避免盲聊/盲走 ——
    // 1) 当前在场角色 → "与X交谈"（过滤 _npc 占位键）
    const present = (S.gameState.present_npcs || [])
        .filter(n => n && typeof n === "string" && !String(n).endsWith("_npc"));
    if (present.length) {
        const npc = present[Math.floor(Math.random() * present.length)];
        picked.push({ text: "与" + npc + "交谈", action: "talk_to_" + npc });
    }
    // 2) 已知可达地点 → "前往Y"（★ 必须排除当前所在地，绝不出现"前往自己脚下"）
    const cur = S.gameState.current_location;
    const revealed = (S.gameState.revealed_locations || [])
        .filter(l => l && typeof l === "string" && l !== cur);
    if (revealed.length) {
        const loc = revealed[Math.floor(Math.random() * revealed.length)];
        picked.push({ text: "前往" + loc, action: "go_to_" + loc });
    }

    // —— 场景安全通用池：不引用任何专有名词，任何场景都不会出戏 ——
    const safePool = [
        { text: "环顾四周，仔细观察当前环境",   action: "look_around" },
        { text: "检查手边能触及的物品",         action: "examine_items" },
        { text: "回想刚才发生的一切",           action: "recall" },
        { text: "试着出声呼喊，看是否有人回应", action: "call_out" },
        { text: "在原地稍作停留，整理思绪",     action: "rest" },
        { text: "让事件继续发展",               action: "continue_story" }
    ];

    // 内联 Fisher–Yates 洗牌，按洗牌顺序把安全池补足到 3–4 个（增强分支优先保留）
    const arr = safePool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    for (const c of arr) {
        if (picked.length >= 4) break;
        if (!picked.some(p => p.text === c.text)) picked.push(c);
    }
    // 兜底：极端情况下不足 3 个
    if (picked.length < 3) picked.push({ text: "环顾四周", action: "look" });

    return picked;
}

export async function submitInput() {
    skipTypewriter();
    if (S.isGenerating) { showToast("上一回合仍在生成，请稍候", "warn"); return; }
    const inputEl = document.getElementById("playerInput");
    const input = inputEl.value.trim();
    if (!input) return;
    inputEl.value = "";
    inputEl.style.height = ""; // 重置多行输入框的自动增高
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
            day: stepOf(S.gameState.current_date),
            tcd: deepClone(S.gameState.current_date),
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
        // ★ 容错：游玩回合遇 AI 空白/JSON 损坏等偶发坏响应，自动重试最多 2 次再报错（对应日志里 "JSON 无法修复" 偶发空白）
        let resp;
        {
            const TURN_RETRIES = 2;
            for (let attempt = 0; attempt <= TURN_RETRIES; attempt++) {
                try {
                    resp = await callLLM(input, retrieved);
                    break;
                } catch (e) {
                    const retryable = /无法修复|JSON 解析失败|截断|结构损坏|空白|空响应|empty/i.test(String((e && e.message) || ""));
                    if (!retryable || attempt === TURN_RETRIES) throw e;
                    showToast(`AI 响应异常，正在重试 (${attempt + 1}/${TURN_RETRIES})...`, "warn");
                }
            }
        }
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
                day: stepOf(S.gameState.current_date),
                tcd: deepClone(S.gameState.current_date),
                key_facts: [],
                isWarning: true
            };
            S.conversationHistory.push(entry);
            // 明确跳过 applyStateChanges 和 addBehaviorRecords
        } else {
            // ✅ 正常故事内容
            applyStateChanges(resp.state_changes);

            // ★ Phase 2：规则 DSL 解释执行（用户配置的世界规则）
            //   - tag 类动作：写回 gameState.tags（在 A2 守卫之前，使本回合新标签可影响禁律判定）
            //   - ending 类动作：触发结局弹窗（复用现有 showGameOver）
            {
                const evaluated = evaluateRules(S.currentWorld, S.gameState, resp.narrative);
                if (Array.isArray(evaluated.tagOps) && evaluated.tagOps.length) {
                    if (!Array.isArray(S.gameState.tags)) S.gameState.tags = [];
                    for (const op of evaluated.tagOps) {
                        if (op.op === "add") {
                            if (!S.gameState.tags.includes(op.tag)) S.gameState.tags.push(op.tag);
                        } else if (op.op === "remove") {
                            const i = S.gameState.tags.indexOf(op.tag);
                            if (i >= 0) S.gameState.tags.splice(i, 1);
                        }
                    }
                }
                if (Array.isArray(evaluated.endings) && evaluated.endings.length) {
                    showGameOver(evaluated.endings[0].reason);
                }
            }

            // ★ A2 生成后世界观合规守卫（柔和提醒，不阻断回合）
            // 选项场景一致性修复（docs/18）：把玩家选项文本也并入扫描范围，
            // 避免选项里出现世界观禁用概念（原实现只扫 narrative）。
            const choiceText = (resp.choices || []).map(c => (c && c.text) ? c.text : "").join("\n");
            const localViolations = findWorldviewViolations(
                resp.narrative + "\n" + choiceText,
                getBannedConceptRules(), getActiveConditionTags()
            );
            if (localViolations.length) {
                const hit = localViolations[0].matched;
                if (hit) {
                    // ★ 「3 次后静默」：同一概念累计提示满阈值则不再弹（仍照常检测，不影响剧情）
                    const nag = recordWorldviewNag("a2:" + hit, S.gameState.worldviewNagCounts);
                    if (nag.show) {
                        S.gameState.worldviewNagCounts = nag.counts;
                        showToast("⚠️ 叙事似乎偏离了世界观（出现「" + hit + "」），若非有意为之可重述或忽略。", "warn", 4000);
                    }
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
            if (judgeEnabled) judgeWorldviewConsistency(resp.narrative, resp.state_changes, { playerInput: input, choices: resp.choices }).then(result => {
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
                    // ★ 「3 次后静默」：同一违和描述累计提示满阈值则不再弹（仍照常检测）
                    const nag = recordWorldviewNag("a7:" + (result.violations[0] || ""), S.gameState.worldviewNagCounts);
                    if (nag.show) {
                        S.gameState.worldviewNagCounts = nag.counts;
                        showToast(msg, "warn", 5000);
                    }
                }
            }).catch(() => { /* 裁判异常不影响主流程 */ });

            const entry = {
                player: input,
                narrative: resp.narrative || "（无叙事）",
                retrieved: retrieved.map(s => s.title),
                period: S.gameState.current_date.period,
                day: stepOf(S.gameState.current_date),
                tcd: deepClone(S.gameState.current_date),
                key_facts: resp.key_facts || [],
                // ★ 氛围提示（环境变化/危机预警，纯氛围文字，无硬数值；多数回合为 null）
                atmosphere: sanitizeAtmosphere(resp.atmosphere)
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
            // ★ P0 性能：此处不再单独 saveState——下方 createOrUpdateSave() 内部已统一持久化（含本回合最终选项），避免重复写盘。
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
            errorType: e.message.includes("无法修复") ? "json_unrepairable" :
                       e.message.includes("JSON 解析失败") ? "parse_failure" :
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
            day: stepOf(S.gameState.current_date),
            tcd: deepClone(S.gameState.current_date),
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
