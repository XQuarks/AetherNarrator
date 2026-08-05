// ============================================================
// AetherNarrator · game.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_ORDER, LINK_RELATION_LABELS, STORAGE_KEYS, getActiveConditionTags, getBannedConceptRules, getBannedConcepts, ensureWorldCanon, resolveCanonContext, applyConsistencyPack, computeVariableUpdates, computeBondUpdates, applyLoreDelta } from "./store.js";
import { pickWorldTags, capSource, deepClone, defaultInitialState, defaultWorldSchema, escapeHtml, getWorldSchema, isNonStoryResponse, sanitizeAtmosphere, sanitizeWorldConfig, validateStateShape, logError, removeSentenceWithTerm } from "./utils.js";
import { getPeriodLabel, getTemperature, getTimeConfig, formatWorldTime, formatTimeLabel, formatDeadlineLabel, stepOf } from "./theme.js";
import { ensureCurrentDate, compareCalendar, advanceCalendarTime, validateStartDate, applySyncRules, calendarDayIndex } from "./calendar.js";
import { saveSaves, saveState, saveWorlds, clearCurrentRunState, importWorldPack } from "./storage.js";
import { clearSourceFile } from "./files.js";
import { addBehaviorRecords, ensureLoreEmbeddings, retrieve, summarizeFactsFromChanges } from "./rag.js";
import { detectPromptInjection, invalidateSystemPromptCache, pushChatTurn, rebuildChatFromHistory, rebuildSummaryFromHistory, styleToTemperature } from "./prompt.js";
import { callLLM, callWorldGenerationLLM, extractLoreFromSource, callLoreRevisionLLM, judgeWorldviewConsistency, extractPartialNarrative, generateConsistencyPack, predictBranches, aiGenerateDaily } from "./llm.js";
import { checkDeathBanner, closeModal, hideLoading, renderChoices, renderLog, renderSaveDetail, renderSaveList, renderStatusPanel, renderWorldList, restoreLastChoices, showGameOver, renderEndingTracker, showLoading, showModal, showScreen, showToast, skipTypewriter, startTypewriter, stopTypewriter, updateGameDayInfo, updateInputState, isSourceFileUploaded, updateLiveNarrative, replaceEntryDOM, removeLogEntry, collectStylePrefs } from "./render.js";
// ★ W2-Style：读取创建向导的 style_preset / 模块开关 / 时间偏好
import { getStylePresetFromWizard, getWizardModuleSettings, getWizardTimePreset, getWizardTimeConfig, buildTimeConfigPrompt, syncPovHighlight } from "./wizard-editor.js";
// ★ docs/60：读取创建向导里玩家预设的叙事结构化容器
import { getWizardContainers, validateWizardContainers, renderValidationPanel } from "./wizard-containers.js"; // ★ docs/60：创建向导容器；★ docs/61：关联校验
import { serializeStylePreset } from "./style-presets.js";
import { filterStateChangesByWorldview, findWorldviewViolations, isEnhancementContextCurrent, shouldRunAIEnhancements, evaluateRules, recordWorldviewNag, appendUniqueEnding } from "./worldview.js";
import { createMemoryPack, mergeMemoryPack } from "./memory-transfer.js";
import { createWorldPack } from "./world-transfer.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { runWorldCritic } from "./critic.js"; // ★ Phase 3：审稿人
import { advanceWorldTime, collectDueDeadlines, hydrateWorldTime } from "./time-engine.js";
import { sanitizeModules, isModuleEnabled } from "./modules.js"; // ★ C1：保存模块设置时归一 + 逻辑门禁
import { evaluateGate, collectCommFlags, PRIVATE_STAMINA_COST, DAILY_STAMINA_COST } from "./comm-gate.js"; // ★ docs/53：门禁引擎
import { commitChannel } from "./comm-channels.js"; // ★ docs/53：动态渠道固化
import { activeTimelineKey, getTimelineTriggered, recordTrigger, resetTriggers, createBranch, resolveTimeTravelStrategy } from "./triggers.js";

// UI-4：判定时间是否倒流（逆跳）。dated 模式用原生日期比较；day/none/period 用绝对分钟比较。
function isBackwardJump(oldDate, newDate, tcWrap) {
    const cfg = (tcWrap && tcWrap.timeConfig) || {};
    let mode = cfg.calendar_mode || "day";
    // 多时间线模式下，用「当前活动线」的真实历法模式判定（顶层 mode 恒为 multiverse，不能直接比）
    if (mode === "multiverse" && cfg.timelines && cfg.active_timeline && cfg.timelines[cfg.active_timeline]) {
        mode = cfg.timelines[cfg.active_timeline].calendar_mode || "day";
    }
    if (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") {
        return compareCalendar(newDate, oldDate, mode, cfg.custom_calendar) < 0;
    }
    const periods = (tcWrap && tcWrap.periods && tcWrap.periods.length) ? tcWrap.periods : undefined;
    const oldAbs = hydrateWorldTime(oldDate || {}, periods).absolute_minutes;
    const newAbs = hydrateWorldTime(newDate || {}, periods).absolute_minutes;
    return newAbs < oldAbs;
}
import { applySimulationChanges, createRestEvent, normalizeSimulationState } from "./simulation.js";
import { abortCurrentRequest, acquireTurn, isSessionContextCurrent, releaseTurn } from "./turn-lifecycle.js";

// 跨模块引用（函数体在 save.js / lore-ui.js）：只导入 game.js 自身用到的几个；
// 历史重导出适配层已移除，app.js / render.js 改为直接从源模块导入（docs/34 #4）。
import { startGame, createOrUpdateSave } from "./save.js";
import { openLoreReview, triggerLoreRevision } from "./lore-ui.js";

export function goHome() {
    abortCurrentRequest(S);
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

// 方案 22：AI 生成世界后，校验起始日期合法性；若有纠正/警告，提示用户
function warnIfTimeCorrected(rawGen) {
    const tc = rawGen && rawGen.schema && rawGen.schema.time_config;
    if (!tc || !tc.calendar_start) return;
    const r = validateStartDate(tc.calendar_start, tc.calendar_mode, tc.era_label);
    if (r.warnings && r.warnings.length) {
        showToast("⚠ 起始日期已自动校正：" + r.warnings.join("；"), "warn", 4000);
    }
}

// ★ docs/60：把玩家在创建向导预设的容器摘要成 AI 约束提示，让 AI 在建世界时尊重并补全空白（不改写玩家已填内容）
export function buildContainerConstraintPrompt(wc) {
    const d = wc.data;
    const parts = [];
    if (d.characters && d.characters.length) {
        parts.push("【玩家预设角色】" + d.characters.map(c => (c.role === "protagonist" ? "主角" : "NPC") + "：" + (c.name || "未命名") + (c.identity ? "（" + c.identity + "）" : "")).join("；"));
    }
    if (d.variable_schema && d.variable_schema.length) {
        parts.push("【玩家预设变量】" + d.variable_schema.map(v => v.name + "(" + v.id + ")").join("、"));
    }
    if (d.inventory && d.inventory.length) {
        parts.push("【玩家预设开局物品】" + d.inventory.map(v => v.name).join("、"));
    }
    if (d.skills && Object.keys(d.skills).length) {
        parts.push("【玩家预设技能】" + Object.keys(d.skills).join("、"));
    }
    if (d.goals && d.goals.length) {
        parts.push("【玩家预设目标】" + d.goals.map(g => g.name).join("、"));
    }
    if (d.sideEvents && d.sideEvents.length) {
        parts.push("【玩家预设支线】" + d.sideEvents.map(s => s.title).join("、"));
    }
    if (!parts.length) return "";
    return "【玩家已在创建向导中预设以下内容，请严格尊重其设定并保持一致性，仅在空白或缺失处补全，不要改写玩家已填内容：】\n" + parts.join("\n");
}

// ★ docs/60：玩家预设容器 = 权威（不被 AI 覆盖）；未配容器走 AI 兜底（initial_state 已由 generated 提供）
export function applyWizardContainers(world, wc) {
    if (!world) return;
    const d = wc.data;
    if (!world.initial_state || typeof world.initial_state !== "object") world.initial_state = {};
    if (wc.locked.has("characters")) world.characters = d.characters;
    if (wc.locked.has("variables")) world.variable_schema = d.variable_schema;
    if (wc.locked.has("inventory")) world.initial_state.inventory = d.inventory;
    if (wc.locked.has("skills")) world.initial_state.skills = d.skills;        // 运行时为对象映射
    if (wc.locked.has("goals")) world.initial_state.goals = d.goals;
    world.initial_state.preset_side_events = d.sideEvents || [];              // 预置支线池（运行时按需注入）
    if (!world.modules || typeof world.modules !== "object") world.modules = {};
    wc.enableModules.forEach(m => { world.modules[m] = { enabled: true }; }); // 填了容器 → 开对应模块
}

export async function generateWorld() {
    const name = document.getElementById("worldName").value.trim();
    const desc = document.getElementById("worldDesc").value.trim();
    // ★ docs/58：主角设定不再由玩家手填；改为「叙事视角」显式选项（单人主角 / 群像剧）。
    const povEl = document.querySelector("input[name='povMode']:checked");
    const pov = (povEl && povEl.value === "ensemble") ? "ensemble" : "solo";
    // ★ docs/58：hero 不再由玩家手填，改为由 AI 按世界观自动设计（solo 模式）；群像剧留空。
    // 先置空，生成后若为 solo 且拿到 initial_state 则回填 world.hero（供展示/注入/完成度清单）。
    let hero = "";
    // ★ docs/58：去掉世界类型下拉；「参考的世界」（作品名）随时可填，不再受类型限制。
    const ipName = document.getElementById("ipName") ? document.getElementById("ipName").value.trim() : "";
    // ★ W2-Style：从创建向导读取叙事风格预设（模板或自定义），序列化后写入 world.style_preset
    const stylePresetObj = getStylePresetFromWizard();
    const stylePreset = serializeStylePreset(stylePresetObj);
    const styleRef = "original"; // 兼容 llm 兜底分支；实际文风由下方 stylePreset 注入
    const customStyle = "";
    const plotFreedom = parseInt(document.getElementById("plotFreedom").value);
    const prefixEnabled = document.querySelector("input[name='customPrefixEnable']:checked");
    const customPrefix = (prefixEnabled && prefixEnabled.value === "on") ? document.getElementById("customPrefix").value.trim() : "";
    const worldPrefixEnabled = document.querySelector("input[name='worldPrefixEnable']:checked");
    // ★ W2-Style：时间系统偏好作为生成提示并入 worldPrefix（沿用既有「世界观生成前缀」通道）
    const timePref = getWizardTimePreset();
    const timeHint = timePref.hint || "";
    const timeConstraint = buildTimeConfigPrompt(); // ★ docs/59：玩家锁定的时间体系 → 结构化硬约束注入 prompt
    const worldPrefixRaw = (worldPrefixEnabled && worldPrefixEnabled.value === "on") ? document.getElementById("worldPrefix").value.trim() : "";
    let worldPrefix = (worldPrefixRaw + (timeHint ? "\n" + timeHint : "") + (timeConstraint ? "\n" + timeConstraint : "")).trim();
    const keyDivergences = document.getElementById("keyDivergences") ? document.getElementById("keyDivergences").value.trim() : "";
    // ★ docs/60：收集玩家在创建向导里预设的容器；作为 AI 硬约束注入，AI 据此完善/补全空白
    const wizardContainers = getWizardContainers();
    const containerConstraint = buildContainerConstraintPrompt(wizardContainers);
    if (containerConstraint) worldPrefix = (worldPrefix + "\n" + containerConstraint).trim();

    // ★ docs/58：校验规则——世界名称必填；世界观「描述」或「上传源文件」至少填一项。
    if (!name) {
        showToast("请填写世界名称", "error");
        return;
    }
    if (!desc && !isSourceFileUploaded()) {
        showToast("请填写世界观描述，或上传小说源文件（二者至少一项）", "error");
        return;
    }
    // ★ docs/61：容器间关联校验 —— 存在 error 级问题则拦截生成（如填了好感但羁绊模块未开、群像剧设主角卡）
    const wv = validateWizardContainers();
    if (wv.errors.length) {
        renderValidationPanel();
        showToast("⚠ " + wv.errors[0].msg, "error", 5000);
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
            const rawGen1 = await callWorldGenerationLLM(name, desc, hero, ipName, firstChunk, styleRef, customStyle, plotFreedom, worldPrefix, pov, CHUNK_SIZE, COUNT_HINT, stylePreset);
            warnIfTimeCorrected(rawGen1);
            generated = sanitizeWorldConfig(rawGen1);
            // ② 逐段抽取 lore 并合并（覆盖全书，同名条目汇总；含 relations 三元组）
            const extracted = await extractLoreFromSource(src, name, ipName, styleRef, customStyle, {
                onRetry: (idx, total, kind, n) => showToast(`第 ${idx}/${total} 段${kind === "生成结果损坏" ? "生成结果损坏" : "被限流"}，自动重试(${n})...`, "warn"),
                onProgress: (done, total) => { btn.textContent = `生成中 (已完成 ${done}/${total})...`; },
                onChunkError: (idx, err) => {
                    showToast(`第 ${idx}/${chunkCount} 段知识库生成失败，已跳过：${err.message}`, "error");
                    logError("extractLore", err);
                    if (S.debugLog && S.debugLog.chunkErrors) {
                        S.debugLog.chunkErrors.push({ time: new Date().toISOString(), chunkIndex: idx, total: chunkCount, errorMessage: err && err.message });
                    }
                }
            }, stylePreset);
            loreKb = { ip: name, snippets: extracted.snippets };
            try { await ensureLoreEmbeddings(loreKb, (done, total) => { btn.textContent = `生成中 (向量化 ${done}/${total})...`; }); }
            catch (e) { logError("loreEmbedPrecompute", e); }
        } else {
            // 小书：沿用原有单次生成
            const rawGen2 = await callWorldGenerationLLM(name, desc, hero, ipName, src, styleRef, customStyle, plotFreedom, worldPrefix, pov, undefined, null, stylePreset);
            warnIfTimeCorrected(rawGen2);
            generated = sanitizeWorldConfig(rawGen2);
            loreKb = generated.lore_kb;
            if (loreKb) {
                try { await ensureLoreEmbeddings(loreKb, (done, total) => { btn.textContent = `生成中 (向量化 ${done}/${total})...`; }); }
                catch (e) { logError("loreEmbedPrecomputeSmall", e); }
            }
        }
        const world = {
            id: "w" + Date.now(),
            name,
            desc,
            // ★ docs/58：type 概念已移除（旧世界 type 字段保留兼容，不再参与逻辑）
            pov, // ★ docs/58：solo（单人主角，AI 自动设计）/ ensemble（群像剧，无唯一主角）
            hero, // 初始空；solo 模式生成后由 AI 设计结果回填（下方）
            ip_name: ipName,
            createdAt: new Date().toISOString().split("T")[0],
            tags: pickWorldTags(generated, { name, desc, hero, ipName }),
            schema: generated.schema || defaultWorldSchema(name + " " + desc),
            initial_state: generated.initial_state,
            lore_kb: loreKb,
            opening_narrative: generated.opening_narrative || "",
            initial_choices: generated.initial_choices || [],
            system_prompt: generated.system_prompt,
            behavior_records: [],
            source_content: capSource(S.sourceFileContent),
            // ★ W2-Style：叙事风格预设（模板自动填文风+温度；运行时不改，设置页无入口）
            style_preset: stylePreset,
            plot_freedom: plotFreedom,
            custom_prefix: customPrefix,
            // ★ W2-Style：玩法模块开关（来自创建向导勾选；ip_scan 由世界是否填作品名在加载时自动判定）
            modules: getWizardModuleSettings(),
            rules: [], // ★ Phase 2：规则 DSL（创作者界面配置，见 docs/Phase2改造方案.md）
            characters: [], // ★ B1：人物卡（主角 + NPC），编辑器可编辑，注入提示词
            temperature_preset: (() => {
                const tEl = document.getElementById("worldTemp");
                const v = tEl ? parseFloat(tEl.value) : NaN;
                return Number.isFinite(v) ? v : 0.7;
            })()
        };
        // ★ docs/60：玩家预设容器写入世界（玩家=权威，未配=AI 兜底）；并联动开启对应模块
        applyWizardContainers(world, wizardContainers);
        // ★ docs/59：玩家在向导锁定的时间体系 → 覆盖 AI 生成的 time_config（仅覆盖该子对象，不动其它 schema）
        const wizardTimeConfig = getWizardTimeConfig();
        if (wizardTimeConfig) world.schema.time_config = wizardTimeConfig;
        // ★ docs/58：solo 模式由 AI 设计主角，回填 world.hero（供展示/注入/完成度清单）。
        // 群像剧（ensemble）world.hero 保持空——无固定单一主角。
        if (pov === "solo" && generated && generated.initial_state) {
            const is0 = generated.initial_state;
            const name0 = is0.name ? is0.name + "：" : "";
            const bg0 = is0.background ? is0.background : "";
            world.hero = (name0 + bg0).trim() || "";
            hero = world.hero;
        }
        // ★ A2：用统一协调器收口 IP 身份（ip_name / 描述 / 上传文本 三路信号 → world.canon）。
        // 冲突仅在 #4 的 UI 提示；这里先记录，绝不阻断建世界。
        // ★ docs/58：resolveCanonContext 已移除 type 依赖（只看 ipName）。
        ensureWorldCanon(world);
        world.canon.key_divergences = keyDivergences; // ★ A2 #4：用户声明的关键偏离，优先级高于生成的一致性包
        const canonResolved = resolveCanonContext({
            ipName,
            desc,
            sourceFileContent: S.sourceFileContent
        });
        world.canon.mode = canonResolved.mode;
        world.canon.ip_name = canonResolved.ip_name;
        world.canon.source = canonResolved.source;
        world.canon.detected = canonResolved.detected;
        world.ip_name = canonResolved.ip_name || ipName; // 规范化显示用名（如别名→标准 IP 名）
        if (canonResolved.conflicts.length) {
            console.info("[A2 canon] 检测到 IP 信号冲突：", canonResolved.conflicts);
        }
        // ★ A2：建世界时由 AI 从源文本生成一致性包，禁项自动写入 world.bannedConcepts（经现有管线注入 system prompt）。
        // 失败/无 API 均安全跳过，绝不阻断建世界；await 以保证落库时包已就位。
        const canonSource = [name, desc, hero, world.system_prompt, world.source_content].filter(Boolean).join("\n\n");
        try {
            const pack = await generateConsistencyPack(canonSource, canonResolved.ip_name || ipName);
            applyConsistencyPack(world, pack);
        } catch (e) {
            logError("consistencyPack", e);
        }
        S.worlds.unshift(world);
        saveWorlds();
        // ★ Phase 3：生成后自动审稿（fire-and-forget，不阻塞"世界已创建"提示）
        runWorldCritic(world).catch(e => logError("worldCritic", e));
        // 调试日志：记录世界创建
        S.debugLog.worldCreations.push({
            time: new Date().toISOString(),
            worldName: name,
            pov,
            ipName: ipName || null,
            plotFreedom: plotFreedom,
            loreSnippets: world.lore_kb ? world.lore_kb.snippets.length : 0,
            openingTextLen: (world.opening_narrative || "").length
        });
        renderWorldList();

        document.getElementById("worldName").value = "";
        document.getElementById("worldDesc").value = "";
        if (document.getElementById("heroDesc")) document.getElementById("heroDesc").value = "";
        if (document.getElementById("ipName")) document.getElementById("ipName").value = "";
        if (document.getElementById("narrativeStyle")) document.getElementById("narrativeStyle").value = "";
        // ★ docs/58：叙事视角重置回默认「单人主角」（radio + 高亮类同步复位）
        document.querySelectorAll("input[name='povMode']").forEach((r) => { r.checked = (r.value === "solo"); });
        syncPovHighlight();
        const kdEl = document.getElementById("keyDivergences");
        if (kdEl) kdEl.value = "";
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
        logError("createWorld", e);
    } finally {
        btn.disabled = false;
        btn.textContent = "确认生成";
    }
}

export function showWorldList() {
    abortCurrentRequest(S);
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

// ★ C1：保存"模块开关"设置（从世界详情的模块页签勾选框读回 world.modules）
export function saveWorldModules(worldId) {
    const w = S.worlds.find(x => x.id === worldId);
    if (!w) { showToast("未找到该世界", "error"); return; }
    const mods = (w.modules && typeof w.modules === "object") ? { ...w.modules } : {};
    const toggles = document.querySelectorAll("#detailWorldBody .mod-toggle");
    toggles.forEach(el => {
        const id = el && el.dataset ? el.dataset.mod : null;
        if (!id) return;
        // 核心模块恒开，忽略创作者取消勾选
        mods[id] = { enabled: el.checked === true };
    });
    w.modules = mods;
    // ★ docs/53：通讯设置（判定模式 + 玩家自选联系方式）
    const gateEl = document.querySelector('#detailWorldBody input[name="commGateMode"]:checked');
    if (gateEl) w.comm_gate_mode = gateEl.value;
    const chRows = document.querySelectorAll("#detailWorldBody .contact-channel-row");
    const chs = [];
    chRows.forEach(row => {
        const nameEl = row.querySelector(".contact-channel-name");
        const kindEl = row.querySelector(".contact-channel-kind");
        const name = nameEl ? nameEl.value.trim() : "";
        const kind = kindEl ? kindEl.value : "social";
        if (name) chs.push({ id: "usr_" + name, name, kind, requires: {}, source: "player" });
    });
    w.contact_channels = chs;
    sanitizeModules(w); // 归一（核心模块强制 true）
    saveWorlds();
    invalidateSystemPromptCache(); // 模块变化影响系统提示，失效缓存以便重建
    showToast("模块设置已保存", "success");
}

// ============================================================
// ★ docs/53：NPC 私聊 / 世界日报
// ============================================================

// 消耗体力（仅当世界存在体力系统；回答第 3 问：无体力则不消耗任何东西）
function deductCommStamina(cost) {
    const s = S.gameState;
    if (!s || !s.variables || typeof s.variables.stamina !== "number") return;
    const upd = computeVariableUpdates({ stamina: Math.max(0, s.variables.stamina - cost) }, S.currentWorld, s.variables);
    applyStateChanges(upd);
    createOrUpdateSave();
}

// 把联络/获报结果作为一条叙事日志注入正文流（拒绝=剧情，日报=播报）
function injectCommEntry(narrative, kind, channel) {
    const s = S.gameState;
    if (!s) return;
    const entry = {
        player: kind === "refusal" ? "（尝试联络 / 获报）" : (kind === "daily" ? "（查看世界动态）" : ""),
        narrative: narrative || "",
        retrieved: [],
        period: s.current_date ? s.current_date.period : "",
        day: s.current_date ? stepOf(s.current_date) : 0,
        tcd: s.current_date ? deepClone(s.current_date) : null,
        key_facts: [],
        _pending: false,
        isComm: true,
        commKind: kind,
        commChannel: channel || ""
    };
    S.conversationHistory.push(entry);
    renderLog();
    createOrUpdateSave();
    renderChoices(S.currentChoices || []);
}

function injectDailyEntry(daily, channel) {
    const lines = ["【" + (channel || "世界日报") + "】"];
    (daily.headlines || []).forEach(h => lines.push("· 《" + (h.title || "头条") + "》" + (h.detail ? "——" + h.detail : "")));
    if (daily.rumor) lines.push("传闻：" + daily.rumor);
    injectCommEntry(lines.join("\n"), "daily", channel);
}

// 进入与某 NPC 的私聊（先过门禁）
export async function startPrivateChat(npcId) {
    if (!S.currentWorld || !S.gameState) { showToast("请先进入一个世界", "warn"); return; }
    if (!npcId) return;
    const scene = { npcId, location: S.gameState.current_location, story_lock: false };
    const res = await evaluateGate(S.currentWorld, S.gameState, { type: "npc_chat", npcId }, scene);
    if (!res.allowed) {
        if (res.blocked === "module_off") { showToast("本世界未开启 NPC 私聊", "warn"); return; }
        injectCommEntry(res.reason || "此刻无法与他私下交谈。", "refusal");
        return;
    }
    deductCommStamina(PRIVATE_STAMINA_COST);
    S.privateChat = { npcId, channel: res.channel || "某种方式" };
    updatePrivateChatUI();
    showToast("已进入与「" + npcId + "」的私聊", "success");
}

export function endPrivateChat() {
    S.privateChat = null;
    updatePrivateChatUI();
}

function updatePrivateChatUI() {
    const banner = document.getElementById("privateChatBanner");
    const input = document.getElementById("playerInput");
    if (!banner) return;
    if (S.privateChat) {
        banner.style.display = "flex";
        banner.innerHTML = `🔒 正在与 <b>${escapeHtml(S.privateChat.npcId)}</b> 私聊（${escapeHtml(S.privateChat.channel)}）· `
            + `<span data-action="endPrivateChat" style="cursor:pointer;color:var(--primary);text-decoration:underline">结束</span>`;
        if (input) input.placeholder = "对 " + S.privateChat.npcId + " 说...";
    } else {
        banner.style.display = "none";
        if (input) input.placeholder = "输入你想做的事...";
    }
}

// 主动点"今日动态"（先过门禁）
export async function requestDaily() {
    if (!S.currentWorld || !S.gameState) { showToast("请先进入一个世界", "warn"); return; }
    const scene = { location: S.gameState.current_location };
    const res = await evaluateGate(S.currentWorld, S.gameState, { type: "world_daily" }, scene);
    if (!res.allowed) {
        if (res.blocked === "module_off") { showToast("本世界未开启世界日报", "warn"); return; }
        injectCommEntry(res.reason || "此刻无法获取世界动态。", "refusal");
        return;
    }
    deductCommStamina(DAILY_STAMINA_COST);
    const flags = collectCommFlags(S.currentWorld, S.gameState, scene);
    const daily = await aiGenerateDaily({ world: S.currentWorld, gameState: S.gameState, flags, channel: res.channel });
    injectDailyEntry(daily, res.channel);
}

// 把系统提供的渠道"固化"为自选联系方式（回答第 5 问：允许）
export function commitChannelAction(name, kind) {
    if (!S.currentWorld || !S.gameState || !name) return;
    const ch = { id: "sys_" + name, name, kind: kind || "social" };
    const r = commitChannel(S.currentWorld, S.gameState, ch);
    saveWorlds();
    createOrUpdateSave();
    showToast(r.added ? "已存入联系方式：" + name : "联系方式已存在", "success");
}

// —— 通讯设置编辑器（世界详情·模块开关页）——
export function addContactChannelRow() {
    const list = document.getElementById("contactChannelList");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "contact-channel-row";
    row.innerHTML = `<input class="contact-channel-name" placeholder="渠道名（如：手机）">`
        + `<select class="contact-channel-kind">`
        + `<option value="magic">魔法</option><option value="tech">科技</option>`
        + `<option value="social">社交</option><option value="physical">实物</option></select>`
        + `<button data-action="removeContactChannel">✕</button>`;
    list.appendChild(row);
}

export function removeContactChannelRow(btn) {
    const row = btn && btn.closest ? btn.closest(".contact-channel-row") : null;
    if (row && row.parentNode) row.parentNode.removeChild(row);
}

// ★ C4：打开「我的笔记」弹窗，载入当前存档已保存的玩家备忘
export function showPlayerNoteModal() {
    if (!S.currentWorld) { showToast("请先进入一个世界", "warn"); return; }
    const ta = document.getElementById("playerNoteInput");
    if (ta) ta.value = (typeof S.playerNotes === "string") ? S.playerNotes : "";
    showModal("playerNoteModal");
}

// ★ C4：保存玩家备忘（存档级，写入当前存档并持久化，不进 world）
export function savePlayerNote() {
    const ta = document.getElementById("playerNoteInput");
    const val = ta ? ta.value.trim().slice(0, 2000) : "";
    S.playerNotes = val;
    createOrUpdateSave(); // 写回 save.player_notes
    closeModal("playerNoteModal");
    showToast(val ? "笔记已保存，之后每轮生效" : "已清空笔记", "success");
}

// ★ C4：打开「走向前瞻」弹窗（默认提示态）
export function showPreviewModal() {
    if (!S.currentWorld) { showToast("请先进入一个世界", "warn"); return; }
    const box = document.getElementById("previewResult");
    if (box) box.innerHTML = '<p class="muted">点击下方「推断走向」获取 AI 的方向性预测（只给方向、不剧透结局）。</p>';
    showModal("branchPreviewModal");
}

// ★ C4：触发一次走向前瞻（理解 A·后果预览）；纯展示、不污染叙事
export async function handlePredictBranches() {
    const box = document.getElementById("previewResult");
    if (box) box.innerHTML = '<p class="muted">推断中…</p>';
    try {
        const branches = await predictBranches();
        if (box) {
            if (!branches.length) {
                box.innerHTML = '<p class="muted">暂时无法推断走向，请稍后再试。</p>';
            } else {
                box.innerHTML = branches.map(b => `
                    <div class="branch-card">
                        <div class="branch-title">${escapeHtml(b.branch)}</div>
                        ${b.likely ? `<div class="branch-likely">${escapeHtml(b.likely)}</div>` : ""}
                        ${b.risk ? `<div class="branch-risk">⚠ ${escapeHtml(b.risk)}</div>` : ""}
                    </div>`).join("");
            }
        }
    } catch (e) {
        logError("predictBranches", e);
        if (box) box.innerHTML = '<p class="muted">推断失败，请检查 API 配置后重试。</p>';
    }
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
    // ★ 多存档槽位：重新开始 = 覆盖该世界"最近存档"槽位（无则开新槽位）；keepSlot 让 startGame 复用此 saveId 而非生成新槽位
    const latest = S.saves.filter(s => s.worldId === worldId)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    S.currentSession.saveId = latest ? latest.id : null;
    // 新周目：重置剧情进度 + 清空行为记忆（不继承旧存档）；知识库沿用世界默认（lore_kb 挂在 world 上，startGame 不改动它）
    startGame({ resetBehavior: true, keepSlot: true });
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


// ★ 事件系统：常量与辅助
const EVENT_STAMINA_REGEN_PER_DAY = 30; // 每自然日体力回复量（上限由变量 schema max 夹取）
// 计算从 prev 到 cur 跨过了多少「自然日」（day 模式看 step 差；dated 看 calendarDayIndex 差；none 返回 0，不回复）
function daysAdvancedSince(prev, cur, tc) {
    if (!prev || !cur) return 0;
    const mode = (tc && tc.timeConfig && tc.timeConfig.calendar_mode) || "day";
    const custom = tc && tc.timeConfig && tc.timeConfig.custom_calendar;
    if (mode === "none") return 0;
    if (mode === "day") return (cur.step || 0) - (prev.step || 0);
    return calendarDayIndex(cur, mode, custom) - calendarDayIndex(prev, mode, custom);
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
        // ★ docs/56：若世界定义了剧情阶段总数 K（lore_stage_count），把 story_progress 上限钳制到 K，
        //   保证「当前阶段指针」与门禁刻度对齐（AI 偶发给超出 K 的值不会让门禁失效）。
        const k = (S.currentWorld && typeof S.currentWorld.lore_stage_count === "number" && S.currentWorld.lore_stage_count >= 1)
            ? S.currentWorld.lore_stage_count : null;
        const bounded = (k != null) ? Math.min(nextSp, k) : nextSp;
        const curSp = (typeof s.story_progress === "number") ? s.story_progress : 1;
        if (bounded > curSp) { s.story_progress = bounded; invalidateSystemPromptCache(); }
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

    // ★ B4：羁绊 / 好感度更新（叠加在文字关系层之上，不动 relationships 文字）
    // AI 在 state_changes.bonds 返回 { [npcName]: { delta, tags, desc } }，纯函数累加。
    // ★ C1：affinity 模块关闭时不应用好感度变化（核心模块恒开，此门禁对默认世界无影响）
    if (changes.bonds && S.currentWorld && isModuleEnabled(S.currentWorld, "affinity")) {
        const pre = (s.bonds && typeof s.bonds === "object") ? { ...s.bonds } : {};
        const upd = computeBondUpdates(changes.bonds, s.bonds);
        s.bonds = upd.next;
        // 若 AI 提供了 desc，同步回写文字关系层（保持两层一致）
        for (const [name, b] of Object.entries(upd.next)) {
            const descUpd = changes.bonds[name];
            if (descUpd && typeof descUpd.desc === "string" && descUpd.desc.trim()) {
                s.relationships[name] = descUpd.desc.trim();
            }
        }
        // 关键羁绊手记：好感跨入极值（≥80 信赖 / ≤-80 宿敌）时强调
        const keyed = [];
        for (const [name, b] of Object.entries(upd.next)) {
            const before = (pre[name] && typeof pre[name].affinity === "number") ? pre[name].affinity : 0;
            const after = b.affinity;
            const wasKey = before >= 80 || before <= -80;
            const isKey = after >= 80 || after <= -80;
            if (isKey && !wasKey) {
                keyed.push({ name, label: after >= 80 ? "挚友 / 信赖" : "宿敌 / 决裂" });
            }
        }
        if (keyed.length && typeof addBehaviorRecords === "function") {
            addBehaviorRecords(keyed.map(k => ({
                text: `与 ${k.name} 的关系发生质变：${k.label}`,
                importance: 5,
                type: "relationship"
            })));
        }
    }
    // ★ C1：skills 模块关闭时不应用技能变化
    if (changes.skills && isModuleEnabled(S.currentWorld, "skills")) {
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

    // ★ B2：玩家变量更新（复用现有 state_changes 通道）
    // AI 在 state_changes.variables 返回变化后的值；computeVariableUpdates 按 schema
    // 校验类型、夹取 [min,max]、忽略未知/未启用变量，返回 { next, applied }。
    // ★ C1：variables 模块关闭时不应用玩家变量变化
    if (changes.variables && S.currentWorld && isModuleEnabled(S.currentWorld, "variables")) {
        const upd = computeVariableUpdates(changes.variables, S.currentWorld, s.variables);
        s.variables = upd.next;
        // 变量变化影响「本回合变化」展示与状态面板；若变量定义变化需重建缓存则已在编辑器保存处处理，
        // 此处仅运行时值变化（动态段），无需失效 system 缓存。
    }

    if (changes.progression) s.progression = { ...s.progression, ...changes.progression };

    // ★ C1：inventory 模块关闭时不应用背包变化
    if (changes.inventory && isModuleEnabled(S.currentWorld, "inventory")) {
        const newlyKeyItems = [];
        for (const op of changes.inventory) {
            const itemTags = (op.tags && Array.isArray(op.tags)) ? op.tags : null;
            if (op.op === "add") {
                const found = s.inventory.find(i => i.item_id === op.item_id);
                if (found) {
                    found.count += op.count;
                    if (itemTags) found.tags = itemTags; // ★ A6：持有期间激活物品标签（如 has_firearm）
                    // 合并时保留原 category/is_key（不覆盖；新物品的 category/is_key 在下方 push 分支写入）
                } else {
                    s.inventory.push({ item_id: op.item_id, name: op.name, count: op.count, world: op.world || null, category: op.category || "", is_key: op.is_key === true, tags: itemTags });
                }
                if (op.is_key === true) newlyKeyItems.push(op.name || op.item_id);
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
            // ★ B3：关键物品获得 → 手记强调（importance 取上限 5、type=item）
        if (newlyKeyItems.length && typeof addBehaviorRecords === "function") {
            addBehaviorRecords(newlyKeyItems.map(n => ({
                text: `获得关键物品：${n}（可能影响后续剧情走向）`,
                importance: 5,
                type: "item"
            })));
        }
    }

    // ★ C1：goals 模块关闭时不应用目标变化
    if (changes.goal_updates && isModuleEnabled(S.currentWorld, "goals")) {
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
    const prevActiveDate = s.current_date ? deepClone(s.current_date) : null; // UI-3/UI-4：推进前快照，算跨线同步增量与逆跳判定
    // ★ C1：time 模块关闭时不推进时间（核心模块恒开；创作者关闭后时间静止）
    if (timeChange && isModuleEnabled(S.currentWorld, "time")) {
        const result = advanceWorldTime(s.current_date, timeChange, timeCtx);
        s.current_date = result.currentDate;
        if (result.rejected) logError("timeRollbackIgnored", new Error("AI 试图回退时间，已忽略 " + JSON.stringify(timeChange)));
    } else {
        // 无时间变更：保持原状，仅规范化形状（补齐 step 等）
        s.current_date = ensureCurrentDate(s.current_date, tc.timeConfig);
    }

    // ★ 事件系统：体力跨天回复（仅 events 模块开启且世界有 stamina 变量；none 时间模式 daysAdvancedSince 返回 0 不回复）
    if (S.currentWorld && isModuleEnabled(S.currentWorld, "events")
        && s.variables && typeof s.variables.stamina === "number") {
        const adv = daysAdvancedSince(prevActiveDate, s.current_date, tc);
        if (adv > 0) {
            const upd = computeVariableUpdates({ stamina: s.variables.stamina + EVENT_STAMINA_REGEN_PER_DAY * adv }, S.currentWorld, s.variables);
            if (upd.applied.length) {
                s.variables = upd.next;
                const delta = upd.applied[0].to - upd.applied[0].from;
                if (delta > 0 && typeof addBehaviorRecords === "function") {
                    addBehaviorRecords([{ text: `体力随${adv > 1 ? adv + "天" : "时间"}流逝恢复 ${delta} 点`, importance: 1, type: "status" }]);
                }
            }
        }
    }

    // Phase 2/3：把当前 active 时间线/分支的 current_date 写回（防止切换回去丢失进度）
    if (s.active_timeline) {
        if (s.timelines && s.timelines[s.active_timeline]) {
            s.timelines[s.active_timeline].current_date = deepClone(s.current_date);
        } else if (s.branches && s.branches[s.active_timeline]) {
            s.branches[s.active_timeline].current_date = deepClone(s.current_date);
        }
    }

    // UI-3：跨线流速同步（sync_rules）。本线推进后，按各规则推进引用线（异界1天=现实N天等）。
    if (s.active_timeline && s.timelines && s.timelines[s.active_timeline] && timeChange && prevActiveDate) {
        const srcLine = s.timelines[s.active_timeline];
        if (Array.isArray(srcLine.sync_rules) && srcLine.sync_rules.length) {
            const mode = srcLine.calendar_mode || "day";
            let delta = 0;
            if (mode === "day" || mode === "none") {
                delta = (s.current_date.step || 0) - (prevActiveDate.step || 0);
            } else {
                delta = calendarDayIndex(s.current_date, mode, srcLine.custom_calendar)
                    - calendarDayIndex(prevActiveDate, mode, srcLine.custom_calendar);
            }
            if (delta) applySyncRules(s.timelines, s.active_timeline, delta);
        }
    }

    // Phase 2 多世界：切换时间线（事件/选项可带 switch_timeline）
    if (changes.switch_timeline && tc.timeConfig.mode === "multiverse" && s.timelines && s.timelines[changes.switch_timeline]) {
        s.active_timeline = changes.switch_timeline;
        s.current_date = deepClone(s.timelines[changes.switch_timeline].current_date);
        invalidateSystemPromptCache();
    }

    // UI-4：默认时间穿越策略（仅逆跳时套用）。指令层已显式指定 reset/branch 则尊重；否则回退线级/世界级默认。
    if (timeChange && !timeChange.reset_triggers && !timeChange.branch && prevActiveDate) {
        const strat = resolveTimeTravelStrategy(timeChange, tc.timeConfig, s.active_timeline);
        if ((strat === "reset" || strat === "branch") && isBackwardJump(prevActiveDate, s.current_date, tc)) {
            if (strat === "reset") timeChange.reset_triggers = "all";
            else { timeChange.branch = true; if (!timeChange.branch_label) timeChange.branch_label = "时间分支"; }
        }
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

// ★ IP#6：纯函数计算本回合命中的违禁概念（已剔除用户「忽略」列表），供扫描与单测复用。
// rules 来自 getBannedConceptRules()；narrative/choicesText 拼接后交给世界观扫描器。
export function computeIpScanHits(narrative, choicesText, rules, ignored) {
    const violations = findWorldviewViolations(
        (narrative || "") + "\n" + (choicesText || ""),
        rules || [], new Set(getActiveConditionTags())
    );
    const ig = new Set((ignored || []).map(s => String(s).toLowerCase()));
    return violations
        .map(v => v.matched)
        .filter(Boolean)
        .filter(t => !ig.has(String(t).toLowerCase()));
}

// ★ IP#6：「移除这句」——删掉包含命中词的那个句子，标黄/提示条消失。
export function removeBannedSentence(idx, term) {
    const entry = S.conversationHistory[idx];
    if (!entry) return;
    entry.narrative = removeSentenceWithTerm(entry.narrative, term);
    entry.bannedHits = [];
    entry.scanWarn = false;
    renderLog(true);
    saveState();
}

// ★ IP#6：「忽略」——把命中词加入静默名单，本回合及之后不再提示；标黄/提示条消失。
export function ignoreBannedTerm(idx, term) {
    if (!S.gameState.ignoredBanned) S.gameState.ignoredBanned = [];
    if (term && !S.gameState.ignoredBanned.includes(term)) S.gameState.ignoredBanned.push(term);
    const entry = S.conversationHistory[idx];
    if (entry) { entry.bannedHits = []; entry.scanWarn = false; }
    renderLog(true);
    saveState();
}

// ★ IP#6：「AI 重写本回合」——把该回合替换为同输入重新生成的一轮（仅支持最新回合，避免破坏中间历史）。
// 重跑会再多 push 一轮多轮上下文，截断回重跑前长度，避免 chatHistory 膨胀。
export async function regenerateTurn(idx) {
    const entry = S.conversationHistory[idx];
    if (!entry || !entry.player) { showToast("无法重写该回合", "warn"); return; }
    if (idx !== S.conversationHistory.length - 1) {
        showToast("仅支持重写最新一回合", "warn");
        return;
    }
    if (S.isGenerating) { showToast("上一回合仍在生成，请稍候", "warn"); return; }
    const input = entry.player;
    const chatBefore = S.chatHistory.length;
    const summaryBefore = S.chatSummary.length;
    removeLogEntry(idx);
    await processTurn(input);
    if (S.chatHistory.length > chatBefore) S.chatHistory.length = chatBefore;
    if (S.chatSummary.length > summaryBefore) S.chatSummary.length = summaryBefore;
    saveState();
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

// ===== processTurn 阶段函数（docs/34 #2：拦截记录 → 重试调用 → 状态应用 → 定稿渲染） =====
// 说明：跨模块共享状态一律走 S；回合局部量（pendingEntry / liveIndex / resp 等）用参数显式传递，
// 各阶段不再各自 try/catch——异常统一抛回 processTurn 的 catch 处理。

// 新建「待生成」日志条目（流式渲染占位；定稿或失败时由调用方回填）
function buildPendingEntry(input) {
    const e = {
        player: input,
        narrative: "",
        retrieved: [],
        period: S.gameState.current_date.period,
        day: stepOf(S.gameState.current_date),
        tcd: deepClone(S.gameState.current_date),
        key_facts: [],
        _pending: true
    };
    // ★ docs/53：私聊模式下的回合标记为私聊语境，供渲染层区分
    if (S.privateChat) {
        e.isPrivate = true;
        e.privateNpc = S.privateChat.npcId;
    }
    return e;
}

// 注入拦截：写 debugLog、把待生成条目改写为拦截提示并定稿（不入多轮历史）
function handleInjectionBlocked(input, injectionCheck, pendingEntry, liveIndex) {
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
    pendingEntry.narrative = "（系统拦截）" + injectionCheck.reason;
    pendingEntry.isWarning = true;
    pendingEntry._pending = false;
    replaceEntryDOM(liveIndex);
    saveState();
    renderChoices([]);
    showToast(injectionCheck.reason, "warn");
}

// 调用 LLM：偶发坏响应（空白/JSON 损坏等）自动重试最多 2 次；返回 { resp, didStream }
// （对应日志里 "JSON 无法修复" 偶发空白）
async function callTurnLLMWithRetry(input, retrieved, liveIndex) {
    const TURN_RETRIES = 2;
    let didStream = false;
    for (let attempt = 0; attempt <= TURN_RETRIES; attempt++) {
        try {
            const resp = await callLLM(input, retrieved, {
                // ★ 实时流式：每收到一块累积文本就增量抽取 narrative 写到日志区
                onPartial: (raw) => {
                    didStream = true;
                    hideLoading(); // 一旦开始出字，隐藏「正在思考」横幅，改用实时叙事
                    updateLiveNarrative(liveIndex, (extractPartialNarrative(raw) || "") + "▌");
                }
            });
            return { resp, didStream };
        } catch (e) {
            const retryable = /无法修复|JSON 解析失败|截断|结构损坏|空白|空响应|empty/i.test(String((e && e.message) || ""));
            if (!retryable || attempt === TURN_RETRIES) throw e;
            showToast(`AI 响应异常，正在重试 (${attempt + 1}/${TURN_RETRIES})...`, "warn");
        }
    }
}

// 正常故事回合：应用状态变更 → 规则 DSL → 世界观守卫/AI 裁判 → 回填条目 → 入多轮历史与行为记忆
function applyNormalTurn(input, resp, retrieved, pendingEntry) {
    // ✅ 正常故事内容
    // ★ B2：先按变化前变量快照算出「本回合变化」摘要（与 applyStateChanges 内同一纯函数，保证一致）
    let pendingVarChanges = [];
    if (resp.state_changes && resp.state_changes.variables && S.currentWorld) {
        const preVars = S.gameState.variables ? { ...S.gameState.variables } : {};
        pendingVarChanges = computeVariableUpdates(resp.state_changes.variables, S.currentWorld, preVars).applied;
    }
    applyStateChanges(resp.state_changes);

    // ★ 57：双轨知识库——把 AI 本回合返回的 lore_delta 应用到工作副本 activeLoreKB（原著 currentWorld.lore_kb 不动）。
    if (resp.lore_delta && Array.isArray(resp.lore_delta) && resp.lore_delta.length) {
        try {
            const loreRes = applyLoreDelta(resp.lore_delta);
            if (loreRes.applied.length && S.activeLoreKB && typeof ensureLoreEmbeddings === "function") {
                // 局部重算被改/新增片段向量（applyLoreDelta 已将对应片段 embedding 置空，此处仅重算这些项）
                ensureLoreEmbeddings(S.activeLoreKB).catch(() => {});
            }
        } catch (e) { logError("loreDelta", e); }
    }

    // ★ 事件系统：支线事件固定体力消耗（进入该支线回合套用；不足已在进入前拦截，此处仅扣减）
    if (S.enteringSideEvent && S.gameState.variables && typeof S.gameState.variables.stamina === "number") {
        const cost = Number(S.enteringSideEvent.cost_stamina) || 0;
        if (cost > 0) {
            // computeVariableUpdates 收绝对值，先算 target 再夹取到 [min,max]
            const upd = computeVariableUpdates({ stamina: S.gameState.variables.stamina - cost }, S.currentWorld, S.gameState.variables);
            if (upd.applied.length) S.gameState.variables = upd.next;
        }
        S.enteringSideEvent = null; // 一次性消费
    }

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
            const e0 = evaluated.endings[0];
            recordUnlockedEnding(e0);
            showGameOver(e0);
        }
    }
    // ★ docs/54：每回合刷新「结局追踪器」面板数据（无 ending 规则的世界内部显示空提示）
    renderEndingTracker();

    // ★ A2 / IP#6 生成后世界观约束扫描（受 ip_scan 模块门禁；warn 模式：标黄 + 提示条，不阻断回合）
    // 选项场景一致性修复（docs/18）：把玩家选项文本也并入扫描范围。
    // 自由度≥4 时 getBannedConceptRules() 返回空 → 天然免扫（与项目「高自由度放宽」一致）。
    if (isModuleEnabled(S.currentWorld, "ip_scan")) {
        const choiceText = (resp.choices || []).map(c => (c && c.text) ? c.text : "").join("\n");
        const hits = computeIpScanHits(resp.narrative, choiceText, getBannedConceptRules(), S.gameState.ignoredBanned);
        if (hits.length) {
            pendingEntry.bannedHits = hits;
            pendingEntry.scanWarn = true;
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
    }).catch(e => logError("worldviewJudge", e));

    pendingEntry.narrative = resp.narrative || "（无叙事）";
    pendingEntry.retrieved = retrieved.map(s => s.title);
    pendingEntry.period = S.gameState.current_date.period;
    pendingEntry.day = stepOf(S.gameState.current_date);
    pendingEntry.tcd = deepClone(S.gameState.current_date);
    pendingEntry.key_facts = resp.key_facts || [];
    // ★ 氛围提示（环境变化/危机预警，纯氛围文字，无硬数值；多数回合为 null）
    pendingEntry.atmosphere = sanitizeAtmosphere(resp.atmosphere);
    pendingEntry._pending = false;
    // ★ B2：保存本回合结构化变化（变量增减摘要 + 原始 state_changes），供「本回合变化」面板渲染
    pendingEntry.varChanges = pendingVarChanges;
    pendingEntry.state_changes = resp.state_changes || {};

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

// ★ docs/54：把触发的结局记入本档图鉴（按 ruleId 去重），并持久化
function recordUnlockedEnding(e) {
    if (!S.gameState) return;
    if (!Array.isArray(S.gameState.unlockedEndings)) S.gameState.unlockedEndings = [];
    S.gameState.unlockedEndings = appendUniqueEnding(S.gameState.unlockedEndings, e);
    createOrUpdateSave(); // 持久化图鉴，随当前存档保存
}

// 定稿渲染：替换待生成条目 DOM；流式已实时出字则直接出选项，非流式回落打字机动画
async function renderTurnOutcome(liveIndex, isWarning, finalChoices, didStream) {
    replaceEntryDOM(liveIndex);
    if (isWarning) { renderChoices([]); return; } // 警告内容不提供选项，也不做打字效果
    if (!didStream) await startTypewriter(liveIndex);
    renderChoices(finalChoices);
    if (S.gameState.is_alive === false) {
        const deathInfo = { title: "死亡结局", kind: "bad", reason: (S.gameState.death_reason || "你倒下了，故事在此终结。") };
        recordUnlockedEnding(deathInfo);
        setTimeout(() => showGameOver(deathInfo), 800);
    }
}

// 错误回合：把失败详情写入 debugLog.turns（含错误类型分类），供「导出调试日志」排查
function recordTurnErrorLog(input, e) {
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
    // ★ 实时流式：先建一条「待生成」日志条目并渲染，让叙事边生成边显示
    // （首字延迟从「整段生成完」降到约 1~2 秒；生成完立即定稿+出选项，不再跑完整打字机）。
    // 注意：liveIndex / pendingEntry 必须声明在 try 之外——catch 块要用它们回填失败信息，
    // 若声明在 try 内，出错时 catch 反而会抛 ReferenceError 掩盖真实错误（集成测试抓到的 bug）。
    const liveIndex = S.conversationHistory.length;
    const pendingEntry = buildPendingEntry(input);
    try {
        S.conversationHistory.push(pendingEntry);
        renderLog();
        showLoading("正在思考...");

        // ★ 前端防注入检测（拦截后本回合终止，finally 仍会释放回合锁）
        const injectionCheck = detectPromptInjection(input);
        if (injectionCheck) { handleInjectionBlocked(input, injectionCheck, pendingEntry, liveIndex); return; }

        const retrieved = await retrieve(input);
        const { resp, didStream } = await callTurnLLMWithRetry(input, retrieved, liveIndex);

        // ★ P0: 会话失效校验 —— 期间若发生导航/切换/重开，丢弃此响应
        if (resp._sessionEpoch !== myEpoch || resp._sessionWorldId !== (S.currentWorld && S.currentWorld.id)) {
            hideLoading();
            logError("staleResponseDiscarded", new Error("丢弃过期/串世界的响应：会话标识不匹配"));
            removeLogEntry(liveIndex); // 撤掉这条尚未定稿的待生成条目，避免残留空条
            return;
        }
        hideLoading();
        updateLiveNarrative(liveIndex, ""); // 清掉流式光标占位

        // 检测是否为非故事内容（拒绝/限制/错误响应）
        const isWarning = isNonStoryResponse(resp.narrative);
        if (isWarning) {
            // ⚠️ 非故事内容：不应用状态变更、不写入知识库、不影响记忆
            pendingEntry.narrative = resp.narrative || "（无内容）";
            pendingEntry.retrieved = retrieved.map(s => s.title);
            pendingEntry.key_facts = [];
            pendingEntry.isWarning = true;
            pendingEntry._pending = false;
        } else {
            applyNormalTurn(input, resp, retrieved, pendingEntry);
        }

        // ★ P1.2.7: 选项先写回记录并持久化，再生成存档列表项，避免存档里选项为空
        let finalChoices = [];
        if (!isWarning) {
            // 计算最终选项（AI 返回空时兜底），必须存储 finalChoices 而非原始空值
            finalChoices = resp.choices;
            if (!finalChoices || finalChoices.length === 0) finalChoices = buildSmartFallbackChoices();
            pendingEntry.choices = finalChoices;
            // ★ 事件系统：提取本回合 AI 返回的支线事件候选（供「🎴 支线」面板展示）
            S.pendingSideEvents = (resp.side_events && Array.isArray(resp.side_events)) ? resp.side_events : [];
            pendingEntry.sideEvents = S.pendingSideEvents;
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

        // ★ 实时流式：生成完立即把本条定稿为格式化叙事 + 氛围提示，并立刻出选项
        await renderTurnOutcome(liveIndex, isWarning, finalChoices, didStream);
    } catch (e) {
        hideLoading();
        // 导航/切世界会递增 epoch 并中止请求；旧请求异常必须静默丢弃，禁止写入新会话。
        if (!isSessionContextCurrent(
            { epoch: myEpoch, worldId: myWorldId },
            { epoch: S.currentSession.epoch, worldId: S.currentWorld && S.currentWorld.id }
        )) { removeLogEntry(liveIndex); return; }
        recordTurnErrorLog(input, e);

        // 网络/API 错误也作为警告展示，不影响游戏状态（填充已存在的待生成条目，不重复追加）
        pendingEntry.narrative = "请求失败：" + e.message;
        pendingEntry.isWarning = true;
        pendingEntry._pending = false;
        replaceEntryDOM(liveIndex);
        saveState();
        renderChoices([]);
        // 识别常见错误类型并给出针对性提示
        let errorMsg = e.message;
        if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("failed to fetch")) {
            errorMsg = "网络请求失败（大概率是 CORS 跨域限制）。请在 API 配置中填写 CORS 代理 URL，或使用浏览器 CORS 插件。详见配置弹窗中的提示说明。";
        }
        showToast("出错了：" + errorMsg, "error");
        logError("processTurn", e);
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
