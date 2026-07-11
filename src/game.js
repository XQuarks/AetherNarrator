// ============================================================
// AetherNarrator · game.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_ORDER, DEFAULT_TIME_CONFIG, LINK_RELATION_LABELS, STORAGE_KEYS, getBannedConcepts } from "./store.js";
import { analyzeWorldTags, capSource, deepClone, defaultInitialState, defaultWorldSchema, escapeHtml, getWorldSchema, isNonStoryResponse, sanitizeWorldConfig, validateStateShape } from "./utils.js";
import { getPeriodLabel, getTemperature, getTimeConfig, formatWorldTime } from "./theme.js";
import { saveSaves, saveState, saveWorlds } from "./storage.js";
import { clearSourceFile } from "./files.js";
import { addBehaviorRecords, ensureLoreEmbeddings, getWorldLoreKB, retrieve, summarizeFactsFromChanges } from "./rag.js";
import { detectPromptInjection, invalidateSystemPromptCache, pushChatTurn, rebuildChatFromHistory, rebuildSummaryFromHistory } from "./prompt.js";
import { callLLM, callWorldGenerationLLM, callLoreRevisionLLM, judgeWorldviewConsistency } from "./llm.js";
import { checkDeathBanner, closeModal, getSelectedStyleRef, hideLoading, renderChoices, renderLog, renderSaveList, renderStatusPanel, renderWorldList, restoreLastChoices, showGameOver, showLoading, showModal, showScreen, showToast, skipTypewriter, startTypewriter, stopTypewriter, updateGameDayInfo, updateInputState } from "./render.js";

export function abortCurrentRequest() {
    if (S.currentAbortController) {
        try { S.currentAbortController.abort(); } catch (e) {}
        S.currentAbortController = null;
    }
    S.currentSession.epoch++; // 任何尚未返回的响应将因 epoch 不匹配而被丢弃
}

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
    if (type === "ip" && !ipName) {
        showToast("基于已有 IP 时请填写作品名称", "error");
        return;
    }

    const btn = document.getElementById("generateWorldBtn");
    btn.disabled = true;
    btn.textContent = "生成中...";

    try {
        const generated = sanitizeWorldConfig(await callWorldGenerationLLM(name, type, desc, hero, ipName, S.sourceFileContent, styleRef, customStyle, plotFreedom, worldPrefix));
        // 为 AI 生成世界的 lore_kb 补算向量（transformers 不可用时静默跳过，降级为关键词检索）
        if (generated && generated.lore_kb) {
            try { await ensureLoreEmbeddings(generated.lore_kb); }
            catch (e) { console.warn("世界生成后向量预计算失败，将降级为关键词检索:", e.message); }
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
            lore_kb: generated.lore_kb,
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

// ★ B3：知识库初览与编辑面板 ------------------------------------------------

// 重渲染前先把 DOM 里的输入读回草稿，避免丢失未保存编辑
function syncLoreEditFromDOM() {
    if (!Array.isArray(S._loreEdit)) return;
    S._loreEdit.forEach((s, i) => {
        const g = (p) => document.getElementById(p + i);
        const title = g("le_title_"), cat = g("le_cat_"), content = g("le_content_");
        const keys = g("le_keys_"), mode = g("le_mode_"), pri = g("le_pri_");
        if (title) s.title = title.value;
        if (cat) s.category = cat.value;
        if (content) s.content = content.value;
        if (keys) s.activation_keys = keys.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
        if (mode) s.trigger_mode = mode.value;
        if (pri) s.priority = parseInt(pri.value) || 0;
    });
}

// 质量校验：空标题 / 内容过短 / 触发词跨条重复
function checkLoreQuality(list) {
    const warns = [];
    const keyCount = {};
    list.forEach((s, i) => {
        const label = `#${i + 1} ${s.title || "(无标题)"}`;
        if (!s.title || !s.title.trim()) warns.push(`${label}：缺少标题`);
        if (!s.content || s.content.trim().length < 30) warns.push(`${label}：内容过短（<30 字），信息量可能不足`);
        (s.activation_keys || []).forEach(k => {
            const kk = String(k).toLowerCase();
            if (kk) keyCount[kk] = (keyCount[kk] || 0) + 1;
        });
    });
    for (const [k, n] of Object.entries(keyCount)) {
        if (n > 1) warns.push(`触发词「${k}」在 ${n} 条里重复，可能导致过度触发`);
    }
    return warns;
}

function renderLoreReviewBody() {
    const body = document.getElementById("loreReviewBody");
    if (!body) return;
    const list = S._loreEdit || [];

    // B5：若有 AI 修订缓冲，顶部展示修订提示
    const revisionHint = S._loreRevisionBuffer
        ? `<div class="lore-warn" style="background:rgba(201,168,124,0.1);border-color:var(--primary)">
            <strong>AI 修订建议已就绪</strong>（${S._loreRevisionBuffer.length} 条）
            <div style="margin-top:6px;display:flex;gap:8px;">
                <button class="btn primary" data-action="confirmLoreRevision" style="font-size:12px;padding:3px 12px;">✓ 应用修订</button>
                <button class="btn secondary" data-action="rejectLoreRevision" style="font-size:12px;padding:3px 12px;">✗ 丢弃</button>
            </div>
           </div>`
        : "";
    const warns = checkLoreQuality(list);
    const warnHtml = warns.length
        ? `<div class="lore-warn"><strong>⚠ 质量提示（${warns.length}）</strong><ul>${warns.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
        : `<div class="lore-ok">✓ 未发现明显质量问题</div>`;

    // ★ B8：防剧透遮罩开关
    const spoilerBtn = `<div class="spoiler-toggle" data-action="toggleLoreSpoiler">${S.loreSpoilerHidden ? "🔒 内容已隐藏（点击查看）" : "🔓 已显示全部"}</div>`;
    const spoilerClass = S.loreSpoilerHidden ? " lore-spoiler" : "";

    const rows = list.map((s, i) => {
        const mode = s.trigger_mode || (s.activation_keys && s.activation_keys.length ? "keyword" : "always");
        return `
        <div class="lore-row">
            <div class="lore-row-head">
                <input id="le_title_${i}" class="lore-inp" value="${escapeHtml(s.title || "")}" placeholder="标题">
                <input id="le_cat_${i}" class="lore-inp lore-cat" value="${escapeHtml(s.category || "")}" placeholder="类别">
                <button class="btn-del" data-action="deleteLoreEntry" data-idx="${i}" title="删除此条">删除</button>
            </div>
            <textarea id="le_content_${i}" class="lore-inp lore-content${spoilerClass}" placeholder="内容（建议 ≥30 字）">${escapeHtml(s.content || "")}</textarea>
            <div class="lore-row-meta${spoilerClass.split(" ")[0]}">
                <label>触发词<input id="le_keys_${i}" class="lore-inp" value="${escapeHtml((s.activation_keys || []).join("，"))}" placeholder="逗号分隔，如：分院帽，帽子"></label>
                <label>模式
                    <select id="le_mode_${i}" class="lore-inp lore-sel">
                        <option value="keyword"${mode === "keyword" ? " selected" : ""}>关键词</option>
                        <option value="always"${mode === "always" ? " selected" : ""}>常驻</option>
                        <option value="regex"${mode === "regex" ? " selected" : ""}>正则</option>
                    </select>
                </label>
                <label>优先级<input id="le_pri_${i}" class="lore-inp lore-pri" type="number" value="${Number(s.priority) || 0}"></label>
            </div>
            ${(s.links && s.links.length) ? `<div class="lore-links">${s.links.map(l => `<span class="lore-link-tag">→ ${escapeHtml(l.target)}（${escapeHtml(LINK_RELATION_LABELS[l.relation] || l.relation)}）</span>`).join(" ")}</div>` : ""}
        </div>`;
    }).join("");
    body.innerHTML = spoilerBtn + revisionHint + warnHtml + `<div style="margin-bottom:10px"><button class="btn secondary" data-action="showLoreGraph" style="font-size:12px;padding:4px 12px;">🔗 查看关联图</button></div>` + (rows || `<p style="color:var(--text-secondary);">暂无条目，点下方"添加条目"新建。</p>`);
}

export function openLoreReview() {
    if (!S.currentWorld) { showToast("请先选择一个世界", "warn"); return; }
    if (!S.activeLoreKB) S.activeLoreKB = { ip: "", snippets: [] };
    if (!Array.isArray(S.activeLoreKB.snippets)) S.activeLoreKB.snippets = [];
    S._loreEdit = deepClone(S.activeLoreKB.snippets); // 深拷贝到缓冲，取消不影响原数据
    renderLoreReviewBody();
    showModal("loreReviewModal");
}

// 从世界详情进入编辑（指定世界 id）
export function editWorldLore(worldId) {
    const w = S.worlds.find(x => x.id === worldId);
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    closeModal("worldDetailModal");
    openLoreReview();
}

export function addLoreEntry() {
    syncLoreEditFromDOM();
    if (!Array.isArray(S._loreEdit)) S._loreEdit = [];
    S._loreEdit.push({
        id: "u" + Date.now().toString(36),
        category: "补充", title: "", content: "",
        keywords: [], activation_keys: [], trigger_mode: "keyword", scan_depth: 1, priority: 0
    });
    renderLoreReviewBody();
}

export function deleteLoreEntry(idx) {
    syncLoreEditFromDOM();
    const i = parseInt(idx);
    if (Array.isArray(S._loreEdit) && i >= 0 && i < S._loreEdit.length) {
        S._loreEdit.splice(i, 1);
        renderLoreReviewBody();
    }
}

export async function saveLoreReview() {
    syncLoreEditFromDOM();
    if (!S.currentWorld) { closeModal("loreReviewModal"); return; }
    const list = (S._loreEdit || []).filter(s => (s.title && s.title.trim()) || (s.content && s.content.trim()));
    list.forEach(s => {
        s.title = (s.title || "").trim().slice(0, 200);
        s.category = (s.category || "补充").trim().slice(0, 50);
        s.content = (s.content || "").trim().slice(0, 1000);
        s.activation_keys = (s.activation_keys || []).slice(0, 20);
        if (!s.trigger_mode) s.trigger_mode = s.activation_keys.length ? "keyword" : "always";
        s.scan_depth = (typeof s.scan_depth === "number" && s.scan_depth > 0) ? s.scan_depth : 1;
        s.priority = Number(s.priority) || 0;
        if (!Array.isArray(s.keywords) || !s.keywords.length) s.keywords = s.activation_keys.slice();
        delete s.embedding; // 内容可能已改，清空向量以便按需重算
    });
    S.activeLoreKB.snippets = list;
    try { await ensureLoreEmbeddings(S.activeLoreKB); }
    catch (e) { console.warn("知识库编辑后向量重算失败，降级关键词：", e.message); }
    saveWorlds();
    S._loreEdit = null;
    closeModal("loreReviewModal");
    showToast(`知识库已保存（${list.length} 条）`, "success");
}

export async function startGame(opts = {}) {
    abortCurrentRequest(); // ★ P0: 失效在途请求，避免旧响应串入新周目
    closeModal("worldDetailModal");
    if (!S.currentWorld) return;
    stopTypewriter();
    S.currentSession.worldId = S.currentWorld.id;

    // ★ P0: 新周目清空行为记忆，避免跨周目污染（继续游戏走 loadSave，不清空）
    if (opts.resetBehavior !== false) {
        S.currentWorld.behavior_records = [];
        saveWorlds();
    }

    // 加载该世界的初始状态
    if (S.currentWorld.initial_state) {
        S.gameState = deepClone(S.currentWorld.initial_state);
    } else {
        S.gameState = deepClone(defaultInitialState());
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
    applyStateChanges({ current_date: { day: nextDay, period: firstPeriod } });
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

export function loadSave(saveId) {
    abortCurrentRequest(); // ★ P0: 失效在途请求
    const save = S.saves.find(s => s.id === saveId);
    if (!save) return;
    stopTypewriter();
    S.currentWorld = S.worlds.find(w => w.id === save.worldId);
    S.currentSession.worldId = save.worldId;
    invalidateSystemPromptCache();
    if (save.state) S.gameState = deepClone(save.state);
    // ★ B7：恢复存档独立知识库（若存档无副本则从 world 出厂默认深拷贝，兼容老存档）
    S.activeLoreKB = (save.lore_kb) ? deepClone(save.lore_kb) : (S.currentWorld && S.currentWorld.lore_kb ? deepClone(S.currentWorld.lore_kb) : null);
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
        localStorage.removeItem(STORAGE_KEYS.state);
        localStorage.removeItem(STORAGE_KEYS.history);
        localStorage.removeItem(STORAGE_KEYS.chatHistory);
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
        existing.lore_kb = S.activeLoreKB;  // B7：存档独立知识库副本
    } else {
        S.saves.unshift({
            id: "s" + Date.now(), worldId: S.currentWorld.id, worldName: S.currentWorld.name,
            progress, updatedAt: now,
            state: JSON.parse(stateStr), history: JSON.parse(cleanHistoryStr), chatHistory: cleanChat,
            chatSummary: [...S.chatSummary],
            lore_kb: S.activeLoreKB  // B7：从 world 出厂默认深拷贝的独立副本
        });
    }
    saveSaves();
    // 使用已序列化的字符串保存 localStorage，避免 saveState 再次序列化
    saveState({ state: stateStr, history: historyStr, chatHistory: JSON.stringify(S.chatHistory) });
}

export function applyStateChanges(changes) {
    if (!changes) return;
    // ★ P1.2.6: 事务保护——先在副本上应用，任何中途异常都回滚 gameState，绝不保留半套状态
    const backup = deepClone(S.gameState);
    try {
    const s = S.gameState;
    validateStateShape(changes);   // #7 完善：异常状态类型告警

    // ★ A4 state_changes 世界观校验（自由度 ≤3）：扫描文本叶子与键名，命中则就地删除并警告（不阻断回合）
    const bannedA4 = getBannedConcepts();
    if (bannedA4.length) {
        const removed = [];
        const stripBanned = (obj) => {
            if (!obj || typeof obj !== "object") return;
            for (const key of Object.keys(obj)) {
                const v = obj[key];
                if (bannedA4.some(c => key.includes(c))) { removed.push(key); delete obj[key]; continue; }
                if (typeof v === "string") {
                    if (bannedA4.some(c => v.includes(c))) { removed.push(key); delete obj[key]; }
                } else if (v && typeof v === "object") {
                    stripBanned(v);
                }
            }
        };
        stripBanned(changes);
        if (removed.length) {
            showToast("⚠️ 已忽略与世界观不符的状态变更：" + removed.join("、"), "warn", 4000);
        }
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

    if (changes.completed_events) {
        for (const e of changes.completed_events) {
            if (!s.completed_events.includes(e)) s.completed_events.push(e);
        }
    }

    // 消费 AI 返回的 triggered_event（此前从未被引擎读取）：记录当前激活事件，供事件引擎推进（#5）
    if (changes.triggered_event) {
        s.active_event = changes.triggered_event;
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

    // 每轮检查目标 deadline，过期未达成则标记 failed（失败不等于结束，开辟新故事线）（#6）
    checkGoalDeadlines();

    if (changes.status_effects) {
        s.status_effects = changes.status_effects;
    }

    if (changes.npc_activity) {
        s.npc_activity = { ...(s.npc_activity || {}), ...changes.npc_activity };
    }

    if (changes.is_alive === false) {
        s.is_alive = false;
        s.death_reason = changes.death_reason || "未知原因";
    }

    // ★ 时间推进：仅当 AI 在 state_changes 中明确指定了 period 或 current_date 时才推进
    // 不再自动推进——日常闲聊、观察环境等行动不应消耗时段
    // AI 根据行动复杂度自行判断是否推进：不推进则不填 period，推进则填入目标时段
    // P1#8：用「绝对时间序号」钳制，严禁时间倒流（文档明确禁止回退）。
    // 注意 period 与 current_date 可能同时出现，必须统一推导目标时间后再做一次性钳制，避免重复计数。
    const tc = getTimeConfig();
    if (tc.mode === "periods") {
        const periodOrder = tc.periods;
        const seq = d => {
            const p = periodOrder.indexOf(d.period);
            return d.day * 100 + (p < 0 ? 99 : p);
        };
        const prevSeq = seq(s.current_date);
        let tgtDay = s.current_date.day;
        let tgtPeriod = s.current_date.period;

        if (changes.current_date && (changes.current_date.day != null || changes.current_date.period != null)) {
            // 显式给出 current_date：直接采信（可能只给 day 或只给 period），仅做回退钳制
            if (changes.current_date.day != null) tgtDay = changes.current_date.day;
            if (changes.current_date.period != null) tgtPeriod = changes.current_date.period;
        } else if (changes.period) {
            // 仅给 period：按"向前推进"语义推导——同/早时段→次日该时段，晚时段→当日该时段
            const newIdx = periodOrder.indexOf(changes.period);
            const prevIdx = periodOrder.indexOf(s.current_date.period);
            if (newIdx >= 0 && prevIdx >= 0) {
                // ★ P1.2.8: 仅当目标时段"晚于"当前时段才跨天推进；同/早时段保持当天（短操作不推进时间）
                tgtDay = (newIdx > prevIdx) ? s.current_date.day + 1 : s.current_date.day;
                tgtPeriod = changes.period;
            }
        }

        const newSeq = seq({ day: tgtDay, period: tgtPeriod });
        if (newSeq >= prevSeq) {
            const newClock = (changes.current_date && changes.current_date.clock) || s.current_date.clock;
            // E10：累加行动耗时的分钟数（clock_mode=clock 时 AI 返回的 clock_minutes）
            const prevMins = s.current_date.clock_minutes || 0;
            const addMins = (changes.current_date && typeof changes.current_date.clock_minutes === "number") ? changes.current_date.clock_minutes : 0;
            const totalMins = prevMins + addMins;
            const totalH = Math.floor(totalMins / 60);
            const totalM = totalMins % 60;
            s.current_date = { day: tgtDay, period: tgtPeriod, clock_minutes: totalMins, clock: newClock || `${String(totalH).padStart(2, "0")}:${String(totalM).padStart(2, "0")}`, ...(newClock ? {} : {}) };
        } else {
            // 非法回退：拒绝，保持原时间，仅记日志（避免"时间倒流 + 跨天"的荒谬状态）
            console.warn("AI 试图回退时间，已忽略", { day: tgtDay, period: tgtPeriod });
        }
    } else if (changes.current_date) {
        // 自由时间模式（无 period 顺序）：无钳制，直接合并 current_date（含 relative_label/clock）
        s.current_date = { ...s.current_date, ...changes.current_date };
    }

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
    const seq = d => {
        const p = periodOrder.indexOf(d.period);
        return d.day * 100 + (p < 0 ? 0 : p);
    };
    for (const g of st.goals) {
        if (g.status !== "active" || !g.deadline) continue;
        const dlSeq = seq({ day: g.deadline.day, period: g.deadline.period });
        const curSeq = seq(st.current_date);
        if (curSeq > dlSeq) {
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

    S.isGenerating = true;
    const myEpoch = S.currentSession.epoch;
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
            const banned = getBannedConcepts();
            if (banned.length && resp.narrative) {
                const hit = banned.find(c => resp.narrative.includes(c));
                if (hit) {
                    showToast("⚠️ 叙事似乎偏离了世界观（出现「" + hit + "」），若非有意为之可重述或忽略。", "warn", 4000);
                }
            }

            // ★ A7 AI 灵活世界观裁判（语义判断是否超出世界观，非阻断，仅提示）
            // 异步进行，不阻塞回合渲染；裁判只看世界设定+叙事，不被玩家输入带偏
            judgeWorldviewConsistency(resp.narrative, resp.state_changes, { playerInput: input }).then(result => {
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
            if (msgCount >= S.lastLoreReviewMsgCount + 20 && S.activeLoreKB) {
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
        S.isGenerating = false; // ★ P0: 无论成功/失败/丢弃均释放串行锁
    }
}

// ★ B5：后台触发知识库修订（非阻塞）
async function triggerLoreRevision(msgCount) {
    S.lastLoreReviewMsgCount = msgCount;
    // 防止短时间内重复触发
    if (S._loreRevisionBuffer) return;
    callLoreRevisionLLM().then(snippets => {
        if (snippets && snippets.length) {
            S._loreRevisionBuffer = snippets;
            showToast("知识库已可修订——AI 建议更新 " + snippets.length + " 条条目。进入知识库编辑面板查看。", "success", 5000);
        }
    }).catch(() => {});
}

// ★ B5：确认修订——将缓冲写入 activeLoreKB
export async function confirmLoreRevision() {
    if (!S._loreRevisionBuffer || !S._loreRevisionBuffer.length) return;
    S.activeLoreKB.snippets = S._loreRevisionBuffer;
    S._loreRevisionBuffer = null;
    try { await ensureLoreEmbeddings(S.activeLoreKB); } catch (e) {}
    saveWorlds();
    closeModal("loreReviewModal");
    invalidateSystemPromptCache();
    showToast("知识库已更新！", "success");
}

// ★ B5：拒绝修订——丢弃缓冲
export function rejectLoreRevision() {
    S._loreRevisionBuffer = null;
    showToast("已丢弃本次 AI 修订建议", "success");
}

// ★ B8：防剧透遮罩开关
export function toggleLoreSpoiler() {
    S.loreSpoilerHidden = !S.loreSpoilerHidden;
    renderLoreReviewBody();
}

// ★ B9②：知识库关联图谱可视化（力导向布局 canvas）
export function showLoreGraph() {
    const kb = getWorldLoreKB();
    const snippets = (kb && kb.snippets) || [];
    const linked = snippets.filter(s => s.links && s.links.length);
    if (!linked.length) { showToast("暂无关联链接", "warn"); return; }
    showModal("loreGraphModal");
    setTimeout(() => renderLoreGraph(snippets), 100);
}

function renderLoreGraph(snippets) {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = 680, H = 420;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodeSet = new Set();
    const rawEdges = [];
    for (const s of snippets) {
        if (!s.links || !s.links.length) continue;
        nodeSet.add(s.id);
        for (const l of s.links) { nodeSet.add(l.target); rawEdges.push({ from: s.id, to: l.target, relation: l.relation }); }
    }
    const id2idx = {};
    const nodes = [...nodeSet].map((id, i) => {
        id2idx[id] = i;
        const snip = snippets.find(s => s.id === id) || {};
        return { id, label: ((snip.category || "") + ":" + (snip.title || id)).slice(0, 12), x: W / 2 + (Math.random() - 0.5) * 200, y: H / 2 + (Math.random() - 0.5) * 150, vx: 0, vy: 0 };
    });

    if (nodes.length < 2) { showToast("需要≥2个关联节点", "warn"); closeModal("loreGraphModal"); return; }
    const REL = { causal: "#ff6464", related: "#6496ff", explains: "#64c864", contains: "#c8b464" };
    const simEdges = rawEdges.map(e => ({ ai: id2idx[e.from], bi: id2idx[e.to], r: e.relation })).filter(e => e.ai !== undefined && e.bi !== undefined);

    // 200 帧力导向
    for (let f = 0; f < 200; f++) {
        const a = Math.max(0.01, 0.5 * (1 - f / 200));
        for (const n of nodes) { n.vx += (W / 2 - n.x) * 0.0008; n.vy += (H / 2 - n.y) * 0.0008; }
        for (const e of simEdges) {
            const u = nodes[e.ai], v = nodes[e.bi];
            const dx = v.x - u.x, dy = v.y - u.y, d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const f = (d - 80) * 0.02; u.vx += dx / d * f; u.vy += dy / d * f; v.vx -= dx / d * f; v.vy -= dy / d * f;
        }
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y, d = Math.sqrt(dx * dx + dy * dy);
            if (d < 60 && d > 0) { const f = (60 - d) * 0.05; nodes[i].vx -= dx / d * f; nodes[i].vy -= dy / d * f; nodes[j].vx += dx / d * f; nodes[j].vy += dy / d * f; }
        }
        for (const n of nodes) { n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy; n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(16, Math.min(H - 16, n.y)); }
    }
    ctx.clearRect(0, 0, W, H);
    for (const e of simEdges) {
        const u = nodes[e.ai], v = nodes[e.bi];
        ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y);
        ctx.strokeStyle = REL[e.r] || "#888"; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const n of nodes) {
        ctx.beginPath(); ctx.arc(n.x, n.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = "#222"; ctx.fill(); ctx.strokeStyle = "#c9a87c"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = "#ddd"; ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(n.label, n.x, n.y);
    }
    let drag = null;
    canvas.onmousedown = e => {
        const r = canvas.getBoundingClientRect();
        const mx = (e.clientX - r.left) * (W / r.width), my = (e.clientY - r.top) * (H / r.height);
        drag = nodes.find(n => Math.hypot(n.x - mx, n.y - my) < 22);
    };
    canvas.onmousemove = e => {
        if (!drag) return;
        const r = canvas.getBoundingClientRect();
        drag.x = (e.clientX - r.left) * (W / r.width); drag.y = (e.clientY - r.top) * (H / r.height);
        renderLoreGraph(snippets);
    };
    canvas.onmouseup = () => { drag = null; };
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
    if (!S.currentWorld || !S.currentWorld.behavior_records) return;
    const r = S.currentWorld.behavior_records.find(b => b.id === id);
    if (r) { r.pinned = !r.pinned; saveWorlds(); renderStatusPanel(S.currentStatusTab); }
}

export function deleteMemory(id) {
    if (!S.currentWorld || !S.currentWorld.behavior_records) return;
    S.currentWorld.behavior_records = S.currentWorld.behavior_records.filter(b => b.id !== id);
    saveWorlds();
    renderStatusPanel(S.currentStatusTab);
    showToast("记忆已删除", "success");
}

// ★ E13：时间显示设置面板
export function showTimeConfigModal() {
    showModal("timeConfigModal");
    const schema = getWorldSchema(S.currentWorld);
    const cfg = (schema && schema.time_config) || DEFAULT_TIME_CONFIG; // fallback
    document.getElementById("timeConfigEra").value = cfg.era_label || "";
    document.getElementById("timeConfigCalendar").value = cfg.calendar_mode || "day";
    document.getElementById("timeConfigClock").value = cfg.clock_mode || "period";
    document.getElementById("timeConfigSeason").value = cfg.season || "";
}

export async function saveTimeConfig() {
    const schema = getWorldSchema(S.currentWorld);
    if (!schema) return;
    if (!schema.time_config) schema.time_config = {};
    schema.time_config.era_label = document.getElementById("timeConfigEra").value.trim().slice(0, 40);
    schema.time_config.calendar_mode = document.getElementById("timeConfigCalendar").value;
    schema.time_config.clock_mode = document.getElementById("timeConfigClock").value;
    schema.time_config.season = document.getElementById("timeConfigSeason").value.trim().slice(0, 10);
    saveWorlds();
    closeModal("timeConfigModal");
    updateGameDayInfo();
    if (S.currentStatusTab === "timeline") renderStatusPanel("timeline");
    showToast("时间设置已更新", "success");
}
