// ============================================================
// AetherNarrator · render.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S, calendarLabel, MEMORY_TYPE_LABELS, MEMORY_BUCKETS, getEnabledVariables } from "./store.js";

import { createElementFromHTML, escapeHtml, escapeRegExp, getAttributeLabel, getWorldSchema, computeWorldCompletion, logError } from "./utils.js";
import { getPeriodLabel, getTimeConfig, formatWorldTime, formatTimeShort, formatTimeLabel, formatDeadlineLabel, stepOf, updateFontSizeButtons, getAllTimelineViews, formatDateOnly, tempLabelText } from "./theme.js";
import { isModuleEnabled, MODULE_REGISTRY } from "./modules.js"; // ★ C1：状态 Tab 按模块开关显隐 + 模块开关 UI
// 注：页面按钮的 chooseOption / startGame / loadSave 等动作均通过 data-action 属性由 app.js 事件接线分发，
// 本模块不直接引用这些函数，不反向依赖 game.js / save.js，避免循环引用（docs/34 #1）。
import { abortCurrentRequest } from "./turn-lifecycle.js";
import { formatStateChanges } from "./prompt.js";
// ★ W2-Style：创建向导编辑器逻辑（模块导航 / 风格模板库 / 模块开关 / 世界书入口）
import { gotoWizardStep, resetCreateWizard, initCreateWizardDOM, syncPovHighlight } from "./wizard-editor.js";
import { buildWorldSummary, normalizeSimulationState } from "./simulation.js";
import { evaluateEndingStatus, ENDING_KINDS } from "./worldview.js"; // ★ docs/54：结局状态评估
import { saveWorlds } from "./storage.js";
// ★ docs/69：章节化回溯——状态面板回溯区块 + 回溯确认弹窗
import { loadTurnLog, chapterOf } from "./timeline-log.js";

// ★ docs/58：世界来源「类型」概念已移除——旧世界 type 字段仅作只读兼容，不再参与任何渲染/逻辑。
//   来源信息统一由「参考的世界」（world.ip_name）在列表/详情页以文字展示，不再有角标。

// ★ docs/54：结局分类标签与配色（与 worldview.ENDING_KINDS 对应）
const ENDING_KIND_LABELS = { normal: "普通", good: "好/通关", bad: "坏", true: "真结局", secret: "隐藏" };
function endingKindLabel(kind) { return ENDING_KIND_LABELS[kind] || "结局"; }
function endingWhenText(when) {
    if (!when || !when.type || when.type === "always") return "始终";
    switch (when.type) {
        case "concept": return `文本出现「${when.term || "?"}」`;
        case "state": return `状态 ${when.field || "?"} ${when.op || "=="} ${when.value ?? "?"}`;
        case "tag": return `标签「${when.tag || "?"}」活跃`;
        default: return "条件触发";
    }
}

// ★ docs/58：世界类型编辑弹窗（worldTypeEditModal）及其处理函数已移除——类型概念不再存在。

export function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    // 同步更新全局底部导航高亮 + 显隐
    const screenToNavAction = {
        homeScreen: "goHome",
        worldListScreen: "showWorldList",
        saveListScreen: "showSaveList",
        settingsScreen: "showSettingsScreen",
    };
    const targetAction = screenToNavAction[id];
    const nav = document.getElementById("globalBottomNav");
    if (nav) {
        nav.classList.toggle("hidden", !targetAction);  // 游戏屏等不显示底部导航
        nav.querySelectorAll("button").forEach(b => {
            b.classList.toggle("on", b.dataset.action === targetAction);
        });
    }
}

export function setBackgroundInert(on) {
    document.querySelectorAll(".screen").forEach(s => {
        if (on) s.setAttribute("inert", ""); else s.removeAttribute("inert");
    });
}

// ★ 弹窗叠层：弹窗默认 z-index 都是 1000，谁在 HTML 里靠后谁就压在上面。
// 于是「世界详情」里点「选择存档」，后开的存档弹窗反而被世界详情盖住。
// 这里在打开时按当前已开弹窗的最高层级 +10 抬一层，关闭时复位，谁后开谁在上。
const MODAL_BASE_Z = 1000;
function raiseModalLayer(el) {
    if (!el || !el.style) return;
    let maxZ = MODAL_BASE_Z;
    let opened = [];
    try { opened = Array.from(document.querySelectorAll(".modal-overlay.show") || []); } catch (e) { opened = []; }
    const others = opened.filter(o => o !== el); // 对已打开的同一个弹窗再调 showModal 时，不该把它自己越抬越高
    for (const o of others) {
        let z = parseInt((o.style && o.style.zIndex) || "", 10);
        if (isNaN(z) && typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
            try { z = parseInt(window.getComputedStyle(o).zIndex, 10); } catch (e) { z = NaN; }
        }
        if (isNaN(z)) z = MODAL_BASE_Z;
        if (z > maxZ) maxZ = z;
    }
    if (others.length) el.style.zIndex = String(maxZ + 10);
}

export function showModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    S.lastFocusedBeforeModal = document.activeElement;
    raiseModalLayer(el);
    el.classList.add("show");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    setBackgroundInert(true);
    // 焦点移入模态内第一个可聚焦元素
    const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusable || el).focus();
}

export function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("show");
    el.removeAttribute("role");
    el.removeAttribute("aria-modal");
    if (el.style) el.style.zIndex = ""; // 复位叠层，避免下次打开时层级越堆越高
    // 还有别的弹窗开着就别解除背景 inert（如从世界详情里开的存档弹窗关掉后，世界详情仍是模态）
    let stillOpen = 0;
    try { stillOpen = (document.querySelectorAll(".modal-overlay.show") || []).length; } catch (e) { stillOpen = 0; }
    if (!stillOpen) setBackgroundInert(false);
    if (S.lastFocusedBeforeModal && typeof S.lastFocusedBeforeModal.focus === "function") {
        S.lastFocusedBeforeModal.focus();
    }
    S.lastFocusedBeforeModal = null;
}

export function closeAllModals() {
    document.querySelectorAll(".modal-overlay.show").forEach(el => closeModal(el.id));
}

export function showApiModal() {
    showModal("apiModal");
}

export function showSettingsModal() {
    // 已改为独立页面 showSettingsScreen，此函数保留兼容旧调用（如从主界面菜单进入）
    showSettingsScreen();
}
function updateSettingsValues() {
    updateFontSizeButtons();
    const lrc = document.getElementById("loreRequireConfirm");
    if (lrc) lrc.checked = S.loreRequireConfirm;
    // ★ docs/63：高亮开关状态同步
    const hlSync = [["hlNames", S.highlightNames], ["hlItems", S.highlightItems], ["hlDialogue", S.highlightDialogue], ["hlAiMarks", S.highlightAiMarks]];
    hlSync.forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.checked = !!val; });
}
export function showSettingsScreen() {
    showScreen("settingsScreen");
    updateSettingsValues();
}

// ★ docs/62：创建向导改为 6 步分步向导（步骤导航见 wizard-editor.js）
export function showCreateWorldModal() {
    initCreateWizardDOM();   // 渲染步骤条 + 风格模板库 + 模块开关
    resetCreateWorldForm();
    gotoWizardStep(0); // 默认回到第 1 步「世界设定」
    showModal("createWorldModal");
}

// 打开创建弹窗时完整重置表单（含各选项回到默认）
function resetCreateWorldForm() {
    const clearIds = ["worldName", "ipName", "worldDesc", "keyDivergences", "customPrefix", "worldPrefix"];
    clearIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    // ★ 叙事视角重置回默认「单人主角」（radio 勾选 + 高亮类一并复位）
    document.querySelectorAll("input[name='povMode']").forEach((r) => { r.checked = (r.value === "solo"); });
    syncPovHighlight();
    // ★ 「已上传源文件」提示按实际上传状态显隐
    refreshIpNameRequirement();
    // 两个特殊要求默认：不添加
    ["customPrefixGroup", "worldPrefixGroup"].forEach(gid => {
        document.querySelectorAll("#" + gid + " .radio-option").forEach((o, i) => o.classList.toggle("selected", i === 0));
        document.querySelectorAll("#" + gid + " input[type=radio]").forEach((r, i) => r.checked = i === 0);
    });
    const cpf = document.getElementById("customPrefixField"); if (cpf) cpf.classList.remove("show");
    const wpf = document.getElementById("worldPrefixField"); if (wpf) wpf.classList.remove("show");
    // ★ 彩蛋回填：用户此前触发主题切换彩蛋后，打开创建向导时把预填文字写回并自动展开「特殊要求」
    if (S.easterEggPrefix) {
        ["worldPrefix", "customPrefix"].forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.value.trim()) el.value = S.easterEggPrefix;
        });
        const wg = document.getElementById("worldPrefixGroup");
        const cg = document.getElementById("customPrefixGroup");
        const wOn = wg && wg.querySelector('input[type=radio][value="on"]');
        const cOn = cg && cg.querySelector('input[type=radio][value="on"]');
        if (wOn) toggleWorldPrefix(true, wOn.closest(".radio-option"));
        if (cOn) toggleCustomPrefix(true, cOn.closest(".radio-option"));
        delete S.easterEggPrefix; // 只生效一次
    }
    // 剧情自由度默认：3
    const pf = document.getElementById("plotFreedom"); if (pf) pf.value = "3";
    updatePlotFreedomLabel("3");
    // 每世界温度默认：0.7，标签同步
    const wtEl = document.getElementById("worldTemp"); if (wtEl) wtEl.value = "0.7";
    updateWorldTempLabel();
    // ★ W2-Style：重置编辑器（模板选择 / 叙事文风 / 结构化标签 / 模块开关 / 时间偏好）
    resetCreateWizard();
    // 收起全部高级折叠（基本信息·关键偏离 / 叙事风格·结构化标签 / 生成设置·高级选项）
    document.querySelectorAll("#createWorldModal details.advanced-details").forEach(d => { d.open = false; });
}

// ★ docs/58：onWorldTypeChange（原类型下拉联动）已移除——类型下拉不再存在，ipName 始终可选。

// 判断玩家是否已上传小说源文件（用于决定作品名称是否必填）
export function isSourceFileUploaded() {
    return !!(S.sourceFileContent && S.sourceFileContent.length > 0);
}

// ★ docs/58：参考的世界（作品名）始终可选——无需类型联动。
// 本函数现在只负责一件事：「已上传源文件，也可不填作品名」提示按实际上传状态显隐
// （上传/移除源文件、打开创建弹窗时调用）。
export function refreshIpNameRequirement() {
    const optHint = document.getElementById("ipNameOptHint");
    if (optHint) optHint.style.display = isSourceFileUploaded() ? "" : "none";
}

// ★ W2-Style：叙事风格改用模板库（见 wizard-editor.js 的 selectStyleTemplate），
// 旧的三选一 styleRef / customStyle 已废弃，故移除 selectStyleRef / getSelectedStyleRef / syncWorldTempToStyle。

export function updatePlotFreedomLabel(value) {
    const labels = {
        1: "严格遵循原著 — 剧情走向基本不偏离",
        2: "以原著为主 — 偶尔有限发散",
        3: "适中发散 — 在原著世界观内适度创新",
        4: "自由发挥 — 世界观为框架，剧情大胆创新",
        5: "完全自由 — 仅用世界框架，剧情独立发展"
    };
    document.getElementById("plotFreedomLabel").textContent = labels[value] || "";
}

// ★ 每世界温度：创建卡滑块实时标签
export function updateWorldTempLabel() {
    const slider = document.getElementById("worldTemp");
    if (!slider) return;
    const v = parseFloat(slider.value);
    const lbl = document.getElementById("worldTempLabel");
    if (lbl) lbl.textContent = v.toFixed(1) + " — " + tempLabelText(v);
}

// ★ A1 结构化偏好标签：题材/主题(可多选)/口味/视角/文风 + 自定义标签(≤10字)
export function selectTagPref(el) {
    const row = el.closest(".tag-row");
    if (!row) return;
    const multi = row.dataset.multi === "1";
    if (multi) {
        el.classList.toggle("selected");
    } else {
        row.querySelectorAll(".tag-chip").forEach(c => c.classList.remove("selected"));
        el.classList.add("selected");
    }
}

export function onCustomTagInput(el) {
    const cnt = document.getElementById("customTagCount");
    if (cnt) cnt.textContent = (el.value.length) + "/10";
}

// 收集创建卡所选叙事偏好，返回写入 world.style_profile 的对象
export function collectStylePrefs() {
    const single = (key) => {
        const c = document.querySelector('.tag-row[data-pref="' + key + '"] .tag-chip.selected');
        return c ? c.dataset.val : null;
    };
    const multi = (key) => Array.from(document.querySelectorAll('.tag-row[data-pref="' + key + '"] .tag-chip.selected')).map(c => c.dataset.val);
    const ct = document.getElementById("customTag");
    return {
        genre: single("genre"),
        tropes: multi("tropes"),
        taste: single("taste"),
        pov: single("pov"),
        style: single("style"),
        custom_tag: ct ? ct.value.trim().slice(0, 10) : ""
    };
}

// 打开创建向导时重置叙事偏好标签
export function resetStylePrefs() {
    document.querySelectorAll(".tag-row .tag-chip.selected").forEach(c => c.classList.remove("selected"));
    const ct = document.getElementById("customTag");
    if (ct) ct.value = "";
    const cnt = document.getElementById("customTagCount");
    if (cnt) cnt.textContent = "0/10";
}

export function toggleCustomPrefix(enabled, el) {
    document.querySelectorAll("#customPrefixGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#customPrefixGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const field = document.getElementById("customPrefixField");
    if (enabled) {
        field.classList.add("show");
    } else {
        field.classList.remove("show");
    }
}

export function toggleWorldPrefix(enabled, el) {
    document.querySelectorAll("#worldPrefixGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#worldPrefixGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const field = document.getElementById("worldPrefixField");
    if (enabled) {
        field.classList.add("show");
    } else {
        field.classList.remove("show");
    }
}

export function renderWorldList() {
    const container = document.getElementById("worldListContent");
    // 顶栏副标题：世界数 + 进行中存档数（照 demo「3 个世界 · 2 个存档进行中」）
    const subEl = document.getElementById("worldListSub");
    if (subEl) {
        const activeWorldIds = new Set();
        for (const s of S.saves) {
            if (!s.state || s.state.is_alive !== false) activeWorldIds.add(s.worldId);
        }
        subEl.textContent = `${S.worlds.length} 个世界 · ${activeWorldIds.size} 个存档进行中`;
    }
    if (!S.worlds.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="text">还没有世界<br>点击上方按钮创建一个吧</div>
            </div>`;
        return;
    }
    // 按创建时间降序排列（最新的在最上面）
    const sorted = [...S.worlds].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const now = Date.now();
    const newThreshold = 24 * 60 * 60 * 1000;

    // 只给最新创建且 24 小时内的世界加「新」徽章
    let newestTime = 0;
    if (sorted.length > 0) newestTime = new Date(sorted[0].createdAt).getTime();
    const newestId = (now - newestTime) < newThreshold ? sorted[0].id : null;

    // 为每个世界查找是否有存档（决定卡片底部按钮用"继续"还是"开始"）
    const saveMap = new Map();
    for (const s of S.saves) {
        if (!saveMap.has(s.worldId) || new Date(s.lastPlayed) > new Date(saveMap.get(s.worldId).lastPlayed)) {
            saveMap.set(s.worldId, s);
        }
    }

    container.innerHTML = sorted.map((w, i) => {
        const isNew = w.id === newestId;
        const delay = i * 0.07;
        const hasSave = saveMap.has(w.id);
        const firstChar = (w.name || "?")[0];
        // ★ docs/64：知识库空时在卡片显示醒目徽标，提醒创作者补抽
        const loreCount = (w.lore_kb && Array.isArray(w.lore_kb.snippets)) ? w.lore_kb.snippets.length : 0;
        const loreWarn = loreCount === 0 ? '<span class="wc-badge wc-badge-warn" title="AI 生成时未产出知识库条目，RAG 将无锚点">⚠ 知识库为空</span>' : "";
        return `
        <article class="world-card${isNew ? " new-world" : ""}" data-action="showWorldDetail" data-id="${w.id}" tabindex="0" style="animation: fadeSlideIn 0.4s ease-out ${delay}s both;">
            <div class="wc-cover">
                <span class="wc-glyph">${escapeHtml(firstChar)}</span>
                ${w.ip_name ? `<span class="wc-badge wc-badge-ref">参考：${escapeHtml(w.ip_name)}</span>` : ""}
                ${loreWarn}
            </div>
            <div class="wc-body">
                <div class="wc-title">${escapeHtml(w.name)}${isNew ? '<span class="new-badge">新</span>' : ""}</div>
                <div class="wc-desc">${escapeHtml(w.desc || "")}</div>
                <div class="wc-tags">
                    ${(w.tags || []).slice(0, 3).map(t => `<span class="wc-chip">${escapeHtml(t)}</span>`).join("")}
                    ${hasSave ? '<span class="wc-chip wc-chip-status">进行中</span>' : ""}
                </div>
            </div>
            <div class="wc-foot">
                <button class="btn primary" data-action="showWorldDetail" data-id="${w.id}">▶ ${hasSave ? "继续游玩" : "进入世界"}</button>
                <div class="wc-foot-spacer"></div>
                <button class="btn ghost-danger" data-action="deleteWorld" data-id="${w.id}">删除</button>
            </div>
        </article>
    `}).join("");
}

export function renderSaveList() {
    const container = document.getElementById("saveListContent");
    const subEl = document.getElementById("saveListSub");
    if (subEl) {
        const total = S.saves.length;
        const active = S.saves.filter(s => s.state && s.state.is_alive !== false).length;
        subEl.textContent = total === 0 ? "继续你的旅程" : `${total} 个存档 · ${active} 个进行中`;
    }
    if (!S.saves.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="text">还没有存档<br>进入世界开始游玩后自动生成</div>
            </div>`;
        return;
    }
    container.innerHTML = S.saves.map(s => {
        const isDead = s.state && s.state.is_alive === false;
        const worldMissing = !S.worlds.find(w => w.id === s.worldId);   // ★ 孤儿存档：所属世界已被删除
        const titleBadges =
            (isDead ? ' <span class="dead-badge">&#x2620; 已死亡</span>' : "") +
            (worldMissing ? ' <span class="deleted-badge">&#9888; 世界已删除</span>' : "");  // ★ 新增徽章
        // ★ 孤儿存档：按钮改「查看」，点开是说明弹窗而非进游戏
        const playBtn = worldMissing
            ? `<button class="save-play-btn" data-action="showSaveDetail" data-id="${s.id}">查看</button>`
            : `<button class="save-play-btn" data-action="showSaveDetail" data-id="${s.id}">继续游玩</button>`;
        return `
        <div class="list-item save-item${isDead ? " dead-save" : ""}${worldMissing ? " missing-world" : ""}">
            <div class="save-info">
                <div class="item-title">${escapeHtml(s.name || s.worldName)}${titleBadges}</div>
                ${(s.name && s.worldName && s.name !== s.worldName) ? `<div class="item-sub">${escapeHtml(s.worldName)}</div>` : ""}
                <div class="item-meta">${escapeHtml(s.progress)}<br>最后游玩：${escapeHtml(s.updatedAt)}</div>
            </div>
            <div class="save-actions">
                ${playBtn}
                <button class="save-del-btn" data-action="deleteSave" data-id="${s.id}">删除</button>
            </div>
        </div>
    `}).join("");
}

// ★ 多存档槽位：游戏内「保存」菜单
export function openSaveMenu() {
    if (!S.currentSession.saveId) { showToast("请先进入一个世界并开始游玩", "warn"); return; }
    const cur = S.saves.find(s => s.id === S.currentSession.saveId);
    const curName = cur ? (cur.name || cur.worldName) : "未命名存档";
    const curEl = document.getElementById("saveMenuCurrentSlot");
    if (curEl) curEl.textContent = "当前存档：" + curName;
    const nameInput = document.getElementById("saveAsNewName");
    if (nameInput) nameInput.value = "";
    showModal("saveMenuModal");
}

// ★ 多存档槽位：世界详情「选择存档」弹窗（列出该世界全部存档 + 开新存档）
export function openWorldSaveChooser(worldId) {
    const world = S.worlds.find(w => w.id === worldId);
    if (!world) return;
    const worldSaves = S.saves.filter(s => s.worldId === worldId)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const titleEl = document.getElementById("worldSaveChooserTitle");
    if (titleEl) titleEl.textContent = "选择存档 · " + world.name;
    const body = document.getElementById("worldSaveChooserBody");
    if (!body) return;
    if (!worldSaves.length) {
        body.innerHTML = '<p class="muted">该世界还没有存档。<br>进入世界后自动生成。</p>';
        showModal("worldSaveChooserModal");
        return;
    }
    body.innerHTML = worldSaves.map(s => {
        const isDead = s.state && s.state.is_alive === false;
        const title = escapeHtml(s.name || s.worldName);
        return `
        <div class="list-item save-item${isDead ? " dead-save" : ""}">
            <div class="save-info">
                <div class="item-title">${title}</div>
                <div class="item-meta">${escapeHtml(s.progress)}<br>最后游玩：${escapeHtml(s.updatedAt)}</div>
            </div>
            <div class="save-actions">
                <button class="save-play-btn" data-action="loadSave" data-id="${s.id}">继续</button>
                <button class="save-del-btn" data-action="deleteSave" data-id="${s.id}">删除</button>
            </div>
        </div>`;
    }).join("") + `
        <button class="btn primary block" data-action="startNewSave" data-id="${worldId}" style="margin-top:12px">＋ 开新存档</button>`;
    showModal("worldSaveChooserModal");
}

let _detailTabBound = {};
function bindDetailTabs(bodyId) {
    const body = document.getElementById(bodyId);
    if (!body || typeof body.addEventListener !== "function" || _detailTabBound[bodyId]) return;
    _detailTabBound[bodyId] = true;
    body.addEventListener("click", (e) => {
        const tab = e.target.closest(".detail-tab");
        if (!tab) return;
        const name = tab.dataset.detailTab;
        body.querySelectorAll(".detail-tab").forEach(t => t.classList.toggle("active", t === tab));
        body.querySelectorAll(".detail-tab-content").forEach(c => c.classList.toggle("active", c.dataset.detailTabContent === name));
    });
}

// ★ docs/68：世界详情「🗺 地图」视图（纯展示；地点图编辑入口在知识库编辑器）
function renderMapView(w) {
    const locs = (w && Array.isArray(w.locations)) ? w.locations : [];
    if (!locs.length) {
        return `<div class="lore-empty-warn">该世界暂无地点图。可在「知识库 → 🗺 地点图」中添加地点与连接——游戏内 AI 会获得「当前地点相邻可去」的空间提示（不限制移动）。</div>`;
    }
    const cards = locs.map(l => `
        <div class="map-loc-card">
            <div class="map-loc-head">
                <span class="map-loc-name">${escapeHtml(l.name)}</span>
                ${l.hidden ? '<span class="map-loc-hidden">🔒 隐藏</span>' : ''}
                ${(l.npcs_default || []).length ? `<span class="map-loc-npcs">👤 ${(l.npcs_default || []).slice(0, 5).map(n => escapeHtml(n)).join('、')}</span>` : ''}
            </div>
            ${l.summary ? `<div class="map-loc-summary">${escapeHtml(l.summary)}</div>` : ''}
            ${(l.connections || []).length ? `<div class="map-loc-conns">🔗 可达：${(l.connections || []).slice(0, 8).map(n => escapeHtml(n)).join('、')}</div>` : ''}
        </div>`).join("");
    return `<div class="stat-grid"><div class="stat-card"><div class="stat-num">${locs.length}</div><div class="stat-label">地点</div></div></div>
            <div class="map-loc-list">${cards}</div>
            <button class="btn secondary" data-action="editWorldLore" data-id="${w.id}">编辑地点图（知识库 → 🗺 地点图）</button>`;
}

export function showWorldDetail(worldId) {
    abortCurrentRequest(S);
    S.currentWorld = S.worlds.find(w => w.id === worldId);
    if (!S.currentWorld) return;
    document.getElementById("detailWorldTitle").textContent = S.currentWorld.name;
    const schema = getWorldSchema(S.currentWorld);
    const w = S.currentWorld;
    const id = w.id;

    // 知识库统计（默认知识库）
    const snippets = (w.lore_kb && w.lore_kb.snippets) || (S.activeLoreKB && S.activeLoreKB.snippets) || [];
    const catColors = ["#C9A87C", "#7BAA92", "#6B9BD1", "#C56B5E", "#B98FC9", "#C9A455", "#5AA8B0", "#A89070"];
    const catCount = {};
    snippets.forEach(s => { const c = s.category || "未分类"; catCount[c] = (catCount[c] || 0) + 1; });
    const cats = Object.keys(catCount);
    const catBar = cats.length ? cats.map((c, i) => `<span class="cat-seg" style="flex:${catCount[c]};background:${catColors[i % catColors.length]}"></span>`).join("") : `<span class="cat-seg" style="flex:1;background:var(--card-border)"></span>`;
    const catLegend = cats.map((c, i) => `<span class="cat-legend-item"><span class="cat-dot" style="background:${catColors[i % catColors.length]}"></span>${escapeHtml(c)} ${catCount[c]}</span>`).join("");
    const loreCount = snippets.length;

    // 规则
    const rules = Array.isArray(w.rules) ? w.rules : [];
    const ruleNames = rules.slice(0, 5).map((r, i) => `<div class="form-group" style="margin-bottom:8px"><label>${escapeHtml(r.name || ("规则 " + (i + 1)))}</label><p style="margin:0;font-size:13px;color:var(--text-secondary)">${r.enabled === false ? "已停用" : "启用中"}</p></div>`).join("");

    // ★ B1：角色卡列表
    const chars = Array.isArray(w.characters) ? w.characters : [];
    const charCards = chars.length ? chars.map(c => `
        <div class="char-chip">
            <span class="char-role ${c.role === "protagonist" ? "char-role-p" : "char-role-n"}">${c.role === "protagonist" ? "主角" : "NPC"}</span>
            <b>${escapeHtml(c.name || (c.role === "protagonist" ? "（玩家所扮演）" : "未命名"))}</b>
            ${c.identity ? `<span class="muted"> · ${escapeHtml(c.identity)}</span>` : ""}
            ${c.role !== "protagonist" && typeof c.affinity === "number" ? `<span class="muted"> · 好感 ${c.affinity}</span>` : ""}
        </div>`).join("") : `<p class="muted">该世界还没有角色卡。</p>`;

    // ★ B2：玩家变量列表
    const varDefs = getEnabledVariables(w);
    const varCards = varDefs.length ? varDefs.map(v => {
        const typeLabel = v.type === "number" ? "数值" : v.type === "toggle" ? "开关" : "文本";
        const def = (v.type === "number" && typeof v.default === "number") ? `，默认 ${v.default}` : "";
        const range = (v.type === "number" && (typeof v.min === "number" || typeof v.max === "number"))
            ? `（${v.min != null ? v.min : "−∞"}–${v.max != null ? v.max : "∞"}${v.unit ? v.unit : ""}）` : "";
        return `<div class="char-chip">
            <span class="char-role char-role-n">${typeLabel}</span>
            <b>${escapeHtml(v.name || v.id)}</b>
            <span class="muted">${escapeHtml(v.id)}${def}${range}</span>
        </div>`;
    }).join("") : `<p class="muted">该世界还没有玩家变量（默认无数字压力，可选添加）。</p>`;

    // ★ B3：初始物品列表
    const initInv = (w.initial_state && Array.isArray(w.initial_state.inventory)) ? w.initial_state.inventory : [];
    const itemCards = initInv.length ? initInv.map(it => `
        <div class="char-chip">
            <span class="char-role ${it.is_key === true ? "char-role-key" : "char-role-n"}">${it.is_key === true ? "关键" : (it.category || "物品")}</span>
            <b>${escapeHtml(it.name || it.item_id)}</b>
            <span class="muted">${escapeHtml(it.item_id || "")}${typeof it.count === "number" ? " ×" + it.count : ""}</span>
        </div>`).join("") : `<p class="muted">该世界开局没有初始物品（默认空背包，物品由剧情动态授予）。</p>`;

    // 时间体系
    const tc = schema.time_config || {};
    const modeLabel = { gregorian: "公历", lunar: "农历", custom: "自定义历法", none: "无（步数制）" }[tc.mode] || tc.mode || "—";
    const startDate = tc.calendar_start ? (tc.calendar_start.month || "?") + "月" + (tc.calendar_start.date || "?") + "日" : "—";

    // ★ A3：创作完成度清单（纯派生，不阻塞游玩，不新增数据模型）
    const completion = computeWorldCompletion(w);
    const completionItems = completion.items.map(it => `
        <span class="completion-item ${it.done ? "done" : "todo"}">${it.done ? "✓" : "○"} ${escapeHtml(it.label)}</span>`).join("");
    const completionCard = `
        <div class="completion-card">
            <div class="completion-head">
                <span class="completion-title">创作完成度</span>
                <span class="completion-score">${completion.done} / ${completion.total} · ${escapeHtml(completion.grade)}</span>
            </div>
            <div class="completion-bar"><span class="completion-fill" style="width:${completion.pct}%"></span></div>
            <div class="completion-items">${completionItems}</div>
            <p class="completion-note">不完整的项不影响开始游玩，补全可让世界更扎实。</p>
        </div>`;

    document.getElementById("detailWorldBody").innerHTML = `
        <div class="detail-tabs">
            <button class="detail-tab active" data-detail-tab="overview">概览</button>
            <button class="detail-tab" data-detail-tab="lore">知识库</button>
            <button class="detail-tab" data-detail-tab="rules">规则</button>
            <button class="detail-tab" data-detail-tab="time">时间体系</button>
            <button class="detail-tab" data-detail-tab="characters">角色</button>
            <button class="detail-tab" data-detail-tab="variables">变量</button>
            <button class="detail-tab" data-detail-tab="items">物品</button>
            <button class="detail-tab" data-detail-tab="modules">模块开关</button>
            <button class="detail-tab" data-detail-tab="secrecy">保密设定</button>
            <button class="detail-tab" data-detail-tab="history">史实参考</button>
            ${isModuleEnabled(w, "map") ? `<button class="detail-tab" data-detail-tab="map">🗺 地图</button>` : ""}
        </div>
        <div class="detail-tab-content active" data-detail-tab-content="overview">
            ${completionCard}
            ${(w.gm_truth && Array.isArray(w.gm_truth.entries) && w.gm_truth.entries.length) ? `<div class="form-group"><label>🔒 GM 真相</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${w.gm_truth.entries.length} 条幕后谜底（游戏内不会主动透露，剧情推进到对应阶段才揭示）</p></div>` : ""}
            ${w.ip_name ? `<div class="form-group"><label>参考作品</label><p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(w.ip_name)}</p></div>` : ""}
            <div class="form-group"><label>世界观描述</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.desc)}</p></div>
            ${w.hero ? `<div class="form-group"><label>主角设定</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.hero)}</p></div>` : ""}
            <div class="form-group"><label>进度系统</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${escapeHtml(schema.progression_path_label)} / ${escapeHtml(schema.progression_label)}</p></div>
            <div class="form-group"><label>创建时间</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${w.createdAt}</p></div>
            ${w.opening_narrative ? `<div class="form-group"><label>开场白预览</label><p style="margin:0;font-size:14px;line-height:1.8;color:var(--text-secondary);white-space:pre-line;">${escapeHtml(w.opening_narrative.slice(0, 200))}${w.opening_narrative.length > 200 ? "..." : ""}</p></div>` : ""}
            ${w.style_preset && w.style_preset.short_tag ? `<div class="form-group"><label>叙事风格</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${escapeHtml(w.style_preset.short_tag)}（推荐温度 ${w.style_preset.recommended_temperature}）</p></div>` : (w.style_ref ? `<div class="form-group"><label>文风参考</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${w.style_ref === "original" ? "参考原版文风" : w.style_ref === "custom" ? "自定义文风：" + escapeHtml(w.custom_style || "未填写") : "不参考文风"}</p></div>` : "")}
            ${w.plot_freedom ? `<div class="form-group"><label>剧情自由度</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${["", "严格遵循原著", "以原著为主", "适中发散", "自由发挥", "完全自由"][w.plot_freedom] || "适中发散"}</p></div>` : ""}
            ${w.custom_prefix ? `<div class="form-group"><label>特殊要求</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.custom_prefix)}</p></div>` : ""}
            ${w.source_content ? `<div class="form-group"><label>源文件</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">已上传（${Math.ceil(w.source_content.length / 1024)} KB）</p></div>` : ""}
        </div>
        <div class="detail-tab-content" data-detail-tab-content="lore">
            <div class="stat-grid"><div class="stat-card"><div class="stat-num">${loreCount}</div><div class="stat-label">知识库条目</div></div></div>
            ${cats.length
                ? `<div class="cat-bar">${catBar}</div><div class="cat-legend">${catLegend}</div>`
                : `<div class="lore-empty-warn">⚠ AI 生成时未产出知识库条目。游戏内 RAG 检索将无锚点，叙事容易偏离设定。</div>`}
            ${loreCount === 0 ? '<button class="btn primary" data-action="editWorldLore" data-id="' + id + '">📚 立即补充知识库</button>' : ""}
            ${loreCount > 0 ? `<button class="btn secondary" data-action="editWorldLore" data-id="${id}">编辑知识库</button>` : ""}
        </div>
        <div class="detail-tab-content" data-detail-tab-content="rules">
            ${rules.length ? ruleNames + `<button class="btn secondary" data-action="openRuleEditor" data-id="${id}">编辑规则</button>` : `<p class="muted">该世界还没有规则。</p><button class="btn secondary" data-action="openRuleEditor" data-id="${id}">编辑规则</button>`}
        </div>
        <div class="detail-tab-content" data-detail-tab-content="time">
            <div class="form-group"><label>纪元</label><p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(tc.era_label || "—")}</p></div>
            <div class="form-group"><label>历法</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${modeLabel}</p></div>
            <div class="form-group"><label>起始日期</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${startDate}</p></div>
            <p class="muted">时间体系的编辑入口在「知识库 → 时间体系」页签中。</p>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="characters">
            <div class="char-list">${charCards}</div>
            <button class="btn secondary" data-action="openCharacterEditor" data-id="${id}">编辑角色</button>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="variables">
            <div class="char-list">${varCards}</div>
            <button class="btn secondary" data-action="openVariableEditor" data-id="${id}">编辑变量</button>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="items">
            <div class="char-list">${itemCards}</div>
            <button class="btn secondary" data-action="openItemEditor" data-id="${id}">编辑物品</button>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="modules">
            ${renderModuleSwitches(w)}
            <div class="status-section">
                <div class="status-section-title">通讯设置（docs/53）</div>
                <div class="form-group"><label>判定模式</label>
                    <label class="radio-inline"><input type="radio" name="commGateMode" value="ai" ${(w.comm_gate_mode || 'ai') === 'ai' ? 'checked' : ''}> AI 自动判断</label>
                    <label class="radio-inline"><input type="radio" name="commGateMode" value="rules" ${w.comm_gate_mode === 'rules' ? 'checked' : ''}> 纯规则（不调 AI）</label>
                </div>
                <div class="form-group"><label>玩家自选联系方式</label>
                    <div id="contactChannelList">
                        ${(Array.isArray(w.contact_channels) ? w.contact_channels : []).map(c => `
                            <div class="contact-channel-row">
                                <input class="contact-channel-name" value="${escapeHtml(c.name || '')}">
                                <select class="contact-channel-kind">
                                    ${["magic", "tech", "social", "physical"].map(k => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${k}</option>`).join("")}
                                </select>
                                <button data-action="removeContactChannel">✕</button>
                            </div>`).join("")}
                    </div>
                    <button class="btn-secondary-sm" data-action="addContactChannel">+ 添加联系方式</button>
                </div>
            </div>
            <button class="btn primary" data-action="saveWorldModules" data-id="${id}">保存模块设置</button>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="secrecy">
            <div class="status-section">
                <div class="status-section-title">保密设定 / 伪装法则（A1）</div>
                <div class="memory-hint">开启后，引擎会约束「普通 NPC / 路人不知道机密」，防止像龙族这样本该隐藏的世界观被写成人尽皆知，破坏沉浸感。适合有「隐藏世界 / 秘密组织」设定的世界。</div>
                <div class="form-group">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="secrecyEnabled" ${((w.secrecy && w.secrecy.enabled) ? "checked" : "")} style="width:auto;">
                        <span>启用信息边界 / 伪装法则</span>
                    </label>
                </div>
                <div class="form-group">
                    <label>机密范畴说明（写给 AI 看，越具体越好）</label>
                    <textarea id="secrecyNote" rows="4" placeholder="例如：龙族、混血种、卡塞尔学院、屠龙家族的存在对普通人保密；普通人只当异常是事故或都市传说。">${escapeHtml((w.secrecy && w.secrecy.note) || "")}</textarea>
                </div>
            </div>
            <button class="btn primary" data-action="saveWorldSecrecy" data-id="${id}">保存保密设定</button>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="history">
            <div class="status-section">
                <div class="status-section-title">史实参考 / 联网核对历史（C2-史实）</div>
                <div class="memory-hint">开启后，引擎会在写剧情前实时联网核对相关时期的真实历史，作为「史实参考」注入。玩家可自由偏离历史、改写走向，史实只作背景参考，不会被用来强迫剧情回归历史。适合三国、明清、二战等基于真实历史的剧本。</div>
                <div class="form-group">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                        <input type="checkbox" id="historyEnabled" ${((w.historical_accuracy && w.historical_accuracy.enabled) ? "checked" : "")} style="width:auto;">
                        <span>启用史实参考（联网核对历史）</span>
                    </label>
                </div>
                <div class="form-group">
                    <label>史实范畴说明（可选，写给 AI 看）</label>
                    <textarea id="historyNote" rows="4" placeholder="例如：以《三国志》正史为参考，玩家可改写历史；赤壁之战前后为关键窗口期。">${escapeHtml((w.historical_accuracy && w.historical_accuracy.note) || "")}</textarea>
                </div>
            </div>
            <button class="btn primary" data-action="saveWorldHistory" data-id="${id}">保存史实参考设置</button>
        </div>
        ${isModuleEnabled(w, "map") ? `
        <div class="detail-tab-content" data-detail-tab-content="map">
            ${renderMapView(w)}
        </div>` : ""}
    `;

    const worldSaves = S.saves.filter(s => s.worldId === w.id);
    const hasSave = worldSaves.length > 0;
    const footer = document.getElementById("detailModalFooter");
    if (hasSave) {
        const primaryBtn = worldSaves.length >= 2
            ? `<button class="btn primary" data-action="openWorldSaveChooser" data-id="${id}">选择存档（${worldSaves.length}）</button>`
            : `<button class="btn primary" data-action="continueLatestSave" data-id="${id}">继续游戏</button>`;
        footer.innerHTML = `
            <div class="dropdown dropdown-up">
                <button class="btn secondary" data-action="toggleDropdown">更多 ▾</button>
                <div class="dropdown-menu">
                    <button class="dropdown-item" data-action="startNewSave" data-id="${id}">开新存档</button>
                    <button class="dropdown-item" data-action="showExportWorldChoice" data-id="${id}">导出世界</button>
                    <button class="dropdown-item" data-action="confirmRestart" data-id="${id}">重新开始</button>
                </div>
            </div>
            ${primaryBtn}`;
    } else {
        footer.innerHTML = `
            <div class="dropdown dropdown-up">
                <button class="btn secondary" data-action="toggleDropdown">更多 ▾</button>
                <div class="dropdown-menu">
                    <button class="dropdown-item" data-action="showExportWorldChoice" data-id="${id}">导出世界</button>
                </div>
            </div>
            <button class="btn primary" data-action="startGame" data-opts='{"resetBehavior":true}'>开始游玩</button>`;
    }

    bindDetailTabs("detailWorldBody");
    showModal("worldDetailModal");
}

// ★ 存档详情二级界面（镜像世界详情，底部按钮改为 返回/存档知识库/导出世界/继续游戏）
export function renderSaveDetail(saveId) {
    const stored = S.saves.find(s => s.id === saveId);
    const save = stored || null;
    if (!save) { showToast("未找到该存档", "error"); return; }
    const world = S.worlds.find(w => w.id === save.worldId);
    document.getElementById("detailSaveTitle").textContent = `存档详情 · ${save.worldName}`;
    const isDead = save.state && save.state.is_alive === false;
    const body = document.getElementById("detailSaveBody");
    const footer = document.getElementById("detailSaveModalFooter");

    // ★ 存档所属世界已被删除：友好提示，禁止进入游戏（避免 currentWorld 为 null 导致崩溃）
    if (!world) {
        body.innerHTML = `
            <div class="form-group">
                <label>所属世界</label>
                <p style="margin:0;font-size:15px;color:var(--danger);">${escapeHtml(save.worldName)} <span class="deleted-badge">&#9888; 已删除</span></p>
            </div>
            <div class="form-group">
                <label>状态</label>
                <p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">
                    该存档对应的世界已被删除或不存在，<b>无法继续游玩</b>。<br>
                    存档数据（进度、知识库副本等）仍保留在本地。你可以删除此存档释放空间，
                    或重新创建一个同名世界后继续游玩。
                </p>
            </div>`;
        footer.innerHTML = `
            <button class="btn secondary" data-action="returnFromSaveDetail">返回</button>
            <button class="btn danger" data-action="deleteSave" data-id="${save.id}">删除该存档</button>`;
        showModal("saveDetailModal");
        return;
    }

    S.currentWorld = world; // ★ 世界存在时才赋值（修复误把上一个世界带入的隐患）

    // 进度数据派生
    const saveSnips = (save.lore_kb && save.lore_kb.snippets) || [];
    const worldSnips = (world.lore_kb && world.lore_kb.snippets) || [];
    const addedCount = saveSnips.filter(s => !worldSnips.some(x => x.id === s.id)).length;
    const behaviorCount = (save.behavior_records && save.behavior_records.length) || 0;
    const eventCount = (save.state && save.state.triggered_event_ids && save.state.triggered_event_ids.length) || 0;
    const curStep = (save.state && save.state.current_date && save.state.current_date.step) || 0;

    body.innerHTML = `
        <div class="detail-tabs">
            <button class="detail-tab active" data-detail-tab="overview">概览</button>
            <button class="detail-tab" data-detail-tab="progress">进度数据</button>
            <button class="detail-tab" data-detail-tab="lore">存档知识库</button>
        </div>
        <div class="detail-tab-content active" data-detail-tab-content="overview">
            <div class="form-group"><label>所属世界</label><p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(save.worldName)}</p></div>
            ${world && world.ip_name ? `<div class="form-group"><label>参考作品</label><p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(world.ip_name)}</p></div>` : ""}
            <div class="form-group"><label>进度</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(save.progress || "—")}</p></div>
            <div class="form-group"><label>最后游玩</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${escapeHtml(save.updatedAt || "—")}</p></div>
            <div class="form-group"><label>状态</label><p style="margin:0;font-size:14px;color:${isDead ? "var(--danger)" : "var(--text-secondary)"};">${isDead ? "☠ 已死亡（可查看，继续将进入死亡结局）" : "进行中"}</p></div>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="progress">
            <div class="stat-grid">
                <div class="stat-card"><div class="stat-num">${curStep}</div><div class="stat-label">当前步数</div></div>
                <div class="stat-card"><div class="stat-num">${eventCount}</div><div class="stat-label">已完成事件</div></div>
                <div class="stat-card"><div class="stat-num">${behaviorCount}</div><div class="stat-label">行为记忆</div></div>
            </div>
        </div>
        <div class="detail-tab-content" data-detail-tab-content="lore">
            <div class="stat-grid"><div class="stat-card"><div class="stat-num">${saveSnips.length}</div><div class="stat-label">存档知识库条目</div></div></div>
            <p class="muted">比默认知识库多 ${addedCount} 条独立条目。</p>
            <button class="btn secondary" data-action="editSaveLore" data-id="${save.id}">编辑存档知识库</button>
        </div>`;
    footer.innerHTML = `
        <button class="btn secondary" data-action="returnFromSaveDetail">返回</button>
        <div class="dropdown dropdown-up">
            <button class="btn secondary" data-action="toggleDropdown">更多 ▾</button>
            <div class="dropdown-menu">
                <button class="dropdown-item" data-action="showExportWorldChoice" data-id="${save.worldId}">导出世界</button>
            </div>
        </div>
        <button class="btn primary" data-action="loadSave" data-id="${save.id}">继续游戏</button>`;
    bindDetailTabs("detailSaveBody");
    showModal("saveDetailModal");
}

export function showStatusPanel() {
    S.currentStatusTab = "profile";
    renderStatusTabs();
    renderStatusPanel(S.currentStatusTab);
    document.getElementById("statusPanelOverlay").classList.add("show");
}

export function hideStatusPanel() {
    document.getElementById("statusPanelOverlay").classList.remove("show");
}

export function closeStatusPanel() {
    hideStatusPanel();
}

export function renderStatusTabs() {
    const schema = getWorldSchema(S.currentWorld);
    const world = S.currentWorld;
    const tabs = [
        { key: "profile", label: "属性" },
        { key: "background", label: "背景" },
        { key: "state", label: "状态" }
    ];
    // ★ C1：关系页签——羁绊好感度模块开启时显示；若世界已有文字关系层也保留（兼容老档）
    const hasRelations = !!(S.gameState && S.gameState.relationships && Object.keys(S.gameState.relationships).length);
    if (isModuleEnabled(world, "affinity") || hasRelations) {
        tabs.push({ key: "relations", label: "关系" });
    }
    // ★ C1：背包物品页签按 inventory 模块开关
    if (isModuleEnabled(world, "inventory")) {
        tabs.push({ key: "items", label: "物品" });
    }
    // ★ C1：技能页签按 skills 模块开关（替代原 schema.has_skills 散装判断）
    if (isModuleEnabled(world, "skills")) {
        tabs.push({ key: "skills", label: schema.skill_label || "技能" });
    }
    // ★ B2：仅当世界定义了玩家变量且 variables 模块开启时才显示「变量」页签
    if (isModuleEnabled(world, "variables") && getEnabledVariables(world).length) {
        tabs.push({ key: "variables", label: "变量" });
    }
    // ★ C1：目标页签按 goals 模块开关
    if (isModuleEnabled(world, "goals")) {
        tabs.push({ key: "goals", label: "目标" });
    }
    // ★ C1：记忆页签 = memory 核心模块（永远显示）
    tabs.push({ key: "memory", label: "记忆" });
    // ★ C1：时间线页签按 time 模块开关
    if (isModuleEnabled(world, "time")) {
        tabs.push({ key: "timeline", label: "时间线" });
    }
    // ★ 57：偏离原著报告页签（本局对知识库工作副本做过的改动一览）
    tabs.push({ key: "divergence", label: "偏离" });

    document.getElementById("statusTabs").innerHTML = tabs.map(t => `
        <button class="status-tab ${S.currentStatusTab === t.key ? "active" : ""}" data-action="switchStatusTab" data-key="${t.key}">${t.label}</button>
    `).join("");
}

export function switchStatusTab(tab) {
    S.currentStatusTab = tab;
    renderStatusTabs();
    renderStatusPanel(tab);
}

// ★ C1：按注册表自动渲染"模块开关"勾选框（核心模块不可关，置灰）。
// 新增模块只需在 src/modules.js 的 MODULE_REGISTRY 加一条描述，此处自动出现对应勾选框。
export function renderModuleSwitches(world) {
    const items = MODULE_REGISTRY.map(m => {
        const on = isModuleEnabled(world, m.id);
        const disabled = m.core ? "disabled" : "";
        const note = m.core ? "（核心模块，不可关闭）" : "";
        return `<label class="mod-switch"><input type="checkbox" class="mod-toggle" data-mod="${m.id}" ${on ? "checked" : ""} ${disabled}> <b>${escapeHtml(m.name)}</b> <span class="muted">${escapeHtml(m.desc)}${note}</span></label>`;
    }).join("");
    return `<p class="muted">开启 / 关闭本世界启用的系统。关闭后对应界面与机制将停用，AI 也不会自行引入相关机制。</p><div class="mod-switches">${items}</div>`;
}

export function renderTextAttribute(label, value) {
    const text = renderTextValue(value);
    return `
        <div class="row" style="align-items:flex-start;"><span class="label">${label}</span></div>
        <div class="text-block" style="margin-bottom:10px;">${text}</div>
    `;
}

export function renderTextValue(value) {
    if (typeof value === "string") return escapeHtml(value);
    if (typeof value === "number") return `数值 ${value}（旧版兼容）`;
    if (value && typeof value === "object") {
        if (value.description) return escapeHtml(value.description);
        return escapeHtml(JSON.stringify(value));
    }
    return "暂无描述";
}

export function renderStatusPanel(tab) {
    const container = document.getElementById("statusContent");
    if (!S.gameState) {
        container.innerHTML = '<div class="empty-hint">暂无角色数据</div>';
        return;
    }
    const s = S.gameState;
    const schema = getWorldSchema(S.currentWorld);

    switch (tab) {
        case "profile":
            // ★ 兜底：AI 生成的 initial_state 可能缺 progression/attributes（生成质量 bug），缺字段时显示"—"而非抛错
            const prog = s.progression || {};
            const attrs = s.attributes || {};
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">基本信息</div>
                    <div class="status-card">
                        <div class="row"><span class="label">姓名</span><span class="value">${escapeHtml(s.name)}</span></div>
                        <div class="row"><span class="label">年龄</span><span class="value">${s.age}</span></div>
                        <div class="row"><span class="label">当前地点</span><span class="value">${escapeHtml(s.current_location)}</span></div>
                        <div class="row"><span class="label">时间</span><span class="value">${escapeHtml(formatWorldTime(s))}</span></div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">属性</div>
                    <div class="status-card">
                        ${Object.entries(attrs).map(([k, v]) => renderTextAttribute(getAttributeLabel(k), v)).join("") || '<div class="muted">暂无属性数据</div>'}
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">${escapeHtml(schema.progression_label || "进度")}</div>
                    <div class="status-card">
                        <div class="row"><span class="label">${escapeHtml(schema.progression_path_label || "路线")}</span><span class="value">${escapeHtml(prog.path || "—")}</span></div>
                        <div class="row"><span class="label">${escapeHtml(schema.progression_label || "等级")}</span><span class="value">${escapeHtml(prog.rank || "—")}</span></div>
                        <div class="row"><span class="label">进度</span><span class="value">${prog.progress != null ? prog.progress : "—"}</span></div>
                        <div class="stat-bar"><div style="width:${Math.min(prog.progress || 0, 100)}%"></div></div>
                    </div>
                </div>
            `;
            break;

        case "background":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">出身背景</div>
                    <div class="status-card text-block">${escapeHtml(s.background)}</div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">性格</div>
                    <div class="status-card">
                        <div class="status-tag-list">
                            ${(s.personality || []).map(p => `<span class="status-tag">${escapeHtml(p)}</span>`).join("") || '<span class="empty-hint" style="padding:0">未设置</span>'}
                        </div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">已完成事件</div>
                    <div class="status-card">
                        <div class="status-tag-list">
                            ${s.completed_events.length ? s.completed_events.map(e => `<span class="status-tag">${escapeHtml(e.title || e)}</span>`).join("") : '<span class="empty-hint" style="padding:0">暂无</span>'}
                        </div>
                    </div>
                </div>
            `;
            break;

        case "state":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">当前状态</div>
                    <div class="status-card">
                        <div class="row"><span class="label">地点</span><span class="value">${escapeHtml(s.current_location)}</span></div>
                        <div class="row"><span class="label">时间</span><span class="value">${escapeHtml(formatWorldTime(s))}</span></div>
                        <div class="row"><span class="label">${escapeHtml(schema.progression_label || "等级")}</span><span class="value">${escapeHtml(s.progression.rank)}</span></div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">临时状态</div>
                    <div class="status-card">
                        ${(s.status_effects && s.status_effects.length) ? s.status_effects.map(e => `<div class="row"><span class="label">${escapeHtml(e.name)}</span><span class="value">${escapeHtml(e.desc)}</span></div>`).join("") : '<div class="empty-hint">无临时状态</div>'}
                    </div>
                </div>
            `;
            break;

        case "relations": {
            // ★ B4：羁绊 / 好感度页签（数值条 + 标签 + 关键金色高亮置顶；文字关系层并行显示）
            const bonds = (s.bonds && typeof s.bonds === "object") ? s.bonds : {};
            const rels = (s.relationships && typeof s.relationships === "object") ? s.relationships : {};
            const names = new Set([...Object.keys(bonds), ...Object.keys(rels)]);
            const list = [...names].map(name => ({ name, bond: bonds[name] || null, rel: rels[name] || "" }));
            list.sort((a, b) => {
                const ka = (a.bond && (a.bond.affinity >= 80 || a.bond.affinity <= -80)) ? 1 : 0;
                const kb = (b.bond && (b.bond.affinity >= 80 || b.bond.affinity <= -80)) ? 1 : 0;
                return kb - ka;
            });
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">羁绊 / 好感度</div>
                    ${list.length ? list.map(({ name, bond, rel }) => {
                        const aff = bond ? bond.affinity : 0;
                        const isKey = bond && (aff >= 80 || aff <= -80);
                        const pct = Math.max(0, Math.min(100, (aff + 100) / 2));
                        const side = aff >= 0 ? "pos" : "neg";
                        const tags = bond && Array.isArray(bond.tags) ? bond.tags : [];
                        const desc = (bond && bond.desc) || rel || "";
                        return `
                        <div class="status-card ${isKey ? "bond-key" : ""}">
                            <div class="row"><span class="label">${isKey ? "★ " : ""}${escapeHtml(name)}</span><span class="value">${aff > 0 ? "+" : ""}${aff}</span></div>
                            <div class="bond-bar"><div class="bond-fill ${side}" style="width:${pct}%"></div></div>
                            ${tags.length ? `<div class="bond-tags">${tags.map(t => `<span class="bond-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
                            ${desc ? `<div class="text-block">${escapeHtml(desc)}</div>` : ""}
                            ${isModuleEnabled(S.currentWorld, "npc_chat") ? `<button class="bond-chat-btn" data-action="privateChat" data-npc="${escapeHtml(name)}">私聊</button>` : ""}
                        </div>`;
                    }).join("") : '<div class="empty-hint">暂无人物关系</div>'}
                </div>
            `;
            break;
        }

        case "items": {
            // ★ B3：关键物品置顶 + 金色高亮；每件显示分类标签
            const items = s.inventory.slice().sort((a, b) => (b.is_key === true) - (a.is_key === true));
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">背包物品</div>
                    ${items.length ? items.map(i => `
                        <div class="status-card ${i.is_key === true ? "item-key" : ""}">
                            <div class="row">
                                <span class="label">${i.is_key === true ? "★ " : ""}${escapeHtml(i.name)}</span>
                                <span class="value">x${i.count}</span>
                            </div>
                            ${i.category ? `<div class="item-cat">${escapeHtml(i.category)}</div>` : ""}
                        </div>
                    `).join("") : '<div class="empty-hint">背包空空如也</div>'}
                </div>
            `;
            break;
        }

        case "variables": {
            const varDefs = getEnabledVariables(S.currentWorld);
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">玩家变量</div>
                    ${varDefs.length ? varDefs.map(def => {
                        const val = (s.variables && def.id in s.variables) ? s.variables[def.id] : def.default;
                        if (def.type === "number") {
                            const min = (typeof def.min === "number") ? def.min : 0;
                            const max = (typeof def.max === "number") ? def.max : 100;
                            const pct = (max > min) ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
                            const unit = def.unit ? ` ${def.unit}` : "";
                            return `<div class="status-card">
                                <div class="row"><span class="label">${escapeHtml(def.name)}</span><span class="value">${val}${unit}</span></div>
                                <div class="stat-bar"><div style="width:${pct}%"></div></div>
                            </div>`;
                        }
                        if (def.type === "toggle") {
                            return `<div class="status-card"><div class="row"><span class="label">${escapeHtml(def.name)}</span><span class="value">${val ? "开" : "关"}</span></div></div>`;
                        }
                        return `<div class="status-card">
                            <div class="row"><span class="label">${escapeHtml(def.name)}</span></div>
                            <div class="text-block">${escapeHtml(val == null ? "" : String(val))}</div>
                        </div>`;
                    }).join("") : '<div class="empty-hint">本世界未定义玩家变量</div>'}
                </div>
            `;
            break;
        }

        case "skills":
            const skillEntries = Object.entries(s.skills || {});
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">已掌握${escapeHtml(schema.skill_label || "技能")}</div>
                    ${skillEntries.length ? skillEntries.map(([name, value]) => `
                        <div class="status-card">
                            <div class="row"><span class="label">${escapeHtml(name)}</span></div>
                            <div class="text-block">${renderTextValue(value)}</div>
                        </div>
                    `).join("") : '<div class="empty-hint">尚未掌握' + (schema.skill_label || "技能") + '</div>'}
                </div>
            `;
            break;

        case "goals": {
            // ★ P2.2.12: 仅渲染 visible !== false 的目标（AI 可在 state_changes 中设 visible:false 隐藏未解锁目标）
            const visibleGoals = s.goals.filter(g => g.visible !== false);
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">当前目标</div>
                    ${visibleGoals.length ? visibleGoals.map(g => {
                        let cls = "";
                        if (g.status === "completed") cls = "completed";
                        else if (g.status === "failed") cls = "failed";
                        const deadline = g.deadline ? `截止：${escapeHtml(formatDeadlineLabel(g.deadline, getTimeConfig().timeConfig))}` : "无期限";
                        return `<div class="goal-item ${cls}"><strong>${escapeHtml(g.name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(g.type)} · ${deadline}</span></div>`;
                    }).join("") : '<div class="empty-hint">暂无目标</div>'}
                </div>
            `;
            break;
        }

        case "memory": {
            const records = Array.isArray(S.activeBehaviorRecords) ? S.activeBehaviorRecords : [];
            // ★ 66：bucket 兜底（旧记录无 bucket 时按 type/importance 推断，与 rag.inferBucket 同规则）
            const bucketOf = (r) => (typeof r.bucket === "string" && MEMORY_BUCKETS.includes(r.bucket)) ? r.bucket
                : (r.type === "event" || (typeof r.importance === "number" && r.importance >= 4)) ? "important_event"
                : "learned_fact";
            const byBucket = { emotional: [], important_event: [], learned_fact: [] };
            for (const r of records) byBucket[bucketOf(r)].push(r);
            const sortCards = (arr) => arr.sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return (b.importance || 3) - (a.importance || 3);
            });
            const card = (r) => `
                        <div class="memory-card ${r.pinned ? 'pinned' : ''}">
                            <div class="memory-header">
                                <span class="memory-type type-${escapeHtml(r.type || 'other')}">${escapeHtml(MEMORY_TYPE_LABELS[r.type] || (r.type || '其他'))}</span>
                                <span class="memory-stars">${'★'.repeat(r.importance || 3)}${'☆'.repeat(5 - (r.importance || 3))}</span>
                                <span class="memory-time">${escapeHtml(r.time || '')}</span>
                            </div>
                            <div class="memory-body">${escapeHtml(r.text || '')}</div>
                            ${r.location ? `<div class="memory-meta">📍 ${escapeHtml(r.location)}</div>` : ''}
                            ${(r.npcs || []).length ? `<div class="memory-meta">👤 ${(r.npcs || []).slice(0, 5).map(n => escapeHtml(n)).join(', ')}${(r.npcs || []).length > 5 ? '…' : ''}</div>` : ''}
                            ${r.bucket === 'emotional' && r.target ? `<div class="memory-meta">❤️ ${escapeHtml(r.target)}${typeof r.intensity === 'number' ? ' · 强度 ' + Math.round(r.intensity * 100) + '%' : ''}</div>` : ''}
                            <div class="memory-actions">
                                <button class="mem-act" data-action="togglePinMemory" data-id="${escapeHtml(r.id || '')}">${r.pinned ? '📌 取消置顶' : '📌 置顶'}</button>
                                <button class="mem-act danger" data-action="deleteMemory" data-id="${escapeHtml(r.id || '')}">🗑 删除</button>
                            </div>
                        </div>`;
            const groups = [
                { key: "emotional", label: "情感记忆" },
                { key: "important_event", label: "重要事件" },
                { key: "learned_fact", label: "学到的知识" }
            ];
            const groupedHtml = records.length ? groups.map(g => {
                const items = sortCards(byBucket[g.key] || []);
                if (!items.length) return "";
                return `<div class="memory-group">
                            <div class="memory-group-title">${g.label} · ${items.length}</div>
                            ${items.map(card).join("")}
                        </div>`;
            }).join("") : '<div class="empty-hint">暂无行为记忆。开始游玩后，AI 会把重要事件记录在这里。</div>';
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">行为记忆 · ${records.length}/100</div>
                    <div class="memory-hint">AI 记录的角色经历。★越多越重要（会被优先注入叙事上下文）。</div>
                    <div class="memory-actions" style="margin:8px 0 12px;">
                        <button class="mem-act" data-action="exportMemoryPack">导出记忆包</button>
                        <button class="mem-act" data-action="triggerMemoryPackImport">导入记忆包</button>
                    </div>
                    ${groupedHtml}
                </div>`;
            break;
        }

        case "timeline": {
            const tc = getTimeConfig();
            const cfg = tc.timeConfig;
            const gs = normalizeSimulationState(S.gameState);

            // E8 世界时限
            const dlHtml = (cfg && cfg.deadlines && cfg.deadlines.length) ? `
                <div class="status-section">
                    <div class="status-section-title">世界时限</div>
                    <div class="status-card">
                        ${cfg.deadlines.map(d => `<div class="row"><span class="label">${escapeHtml(d.title)}</span><span class="value">${escapeHtml(formatDeadlineLabel(d, cfg))}</span></div>`).join("")}
                    </div>
                </div>` : "";

            // D1a NPC 动态
            const npc = (gs && gs.npc_activity && Object.keys(gs.npc_activity).length) ? Object.entries(gs.npc_activity) : [];
            const npcHtml = npc.length ? `
                <div class="status-section">
                    <div class="status-section-title">🏘️ NPC 动态</div>
                    <div class="status-card">
                        ${npc.filter(([, activity]) => activity.visible !== false).slice(0, 10).map(([name, activity]) => `
                            <div class="npc-row"><span class="npc-name">${escapeHtml(name)}</span><span class="npc-act">${escapeHtml(activity.action || '')}${activity.location ? ` · ${escapeHtml(activity.location)}` : ''}${activity.goal ? `（目标：${escapeHtml(activity.goal)}）` : ''}</span></div>
                        `).join("")}
                        ${npc.length > 10 ? `<div class="empty-hint" style="padding:4px 0">…还有 ${npc.length - 10} 位 NPC</div>` : ''}
                    </div>
                </div>` : "";

            // D1b 事件进度
            const completed = (gs && gs.completed_events) || [];
            const activeEvents = (gs && gs.active_events) || [];
            let eventsHtml = "";
            if (activeEvents.length || completed.length) {
                eventsHtml += `<div class="status-section"><div class="status-section-title">⚡ 事件</div><div class="status-card">`;
                if (activeEvents.length) {
                    eventsHtml += activeEvents.slice(0, 5).map(event => `<div class="row"><span class="label">🔵 ${escapeHtml(event.stage || '进行中')}</span><span class="value">${escapeHtml(event.title)}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</span></div>`).join("");
                }
                if (completed.length) {
                    eventsHtml += `<div class="row"><span class="label">✅ 已完成 (${completed.length})</span><span class="value">${completed.slice(-5).map(e => escapeHtml(e.title || e)).join(", ")}${completed.length > 5 ? "…" : ""}</span></div>`;
                }
                eventsHtml += `</div></div>`;
            }

            // D1c 世界状态摘要
            const summaryText = buildWorldSummary(gs);

            // 经历时间线
            const entries = (S.conversationHistory || [])
                .map((e, i) => ({ ...e, _i: i }))
                .filter(e => e.narrative && !e.isWarning)
                .sort((a, b) => (stepOf(a.tcd || a) - stepOf(b.tcd || b)) || (tc.periods.indexOf(a.period) - tc.periods.indexOf(b.period)));
            const tlHtml = entries.length ? entries.map(e => `
                <div class="timeline-item">
                    <div class="timeline-time">${escapeHtml(e.tcd ? formatTimeLabel(e.tcd, cfg) : formatTimeShort(e.day, e.period, e.clock))}</div>
                    <div class="timeline-text">${escapeHtml((e.narrative || "").slice(0, 80))}${(e.narrative || "").length > 80 ? "…" : ""}</div>
                </div>`).join("") : '<div class="empty-hint">暂无经历记录</div>';

            container.innerHTML = dlHtml + npcHtml + eventsHtml + `
                <div class="status-section">
                    <div class="status-section-title">🌍 世界状态</div>
                    <div class="status-card world-summary">${escapeHtml(summaryText)}</div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">📜 我的经历</div>
                    <div class="status-card timeline-list">${tlHtml}</div>
                </div>
                ${isModuleEnabled(S.currentWorld, "schedule") ? `
                <div class="status-section">
                    <div class="status-section-title">⏪ 章节回溯</div>
                    <div class="status-card" id="rewindBlock"><div class="empty-hint">加载中…</div></div>
                </div>` : ""}`;
            if (isModuleEnabled(S.currentWorld, "schedule")) loadRewindBlock(); // ★ docs/69：异步填充回溯区块
            break;
        }

        case "divergence":
            // ★ 57：偏离原著报告——本局对知识库工作副本做过的改动一览
            container.innerHTML = renderLoreDeltaHTML();
            break;
    }
}

// ★ docs/69：章节回溯区块（异步加载回合日志，按章节分组 + 分支标记）
async function loadRewindBlock() {
    const el = document.getElementById("rewindBlock");
    if (!el) return;
    const saveId = S.currentSession && S.currentSession.saveId;
    if (!saveId) { el.innerHTML = '<div class="empty-hint">未绑定存档槽位，无法回溯。</div>'; return; }
    const log = await loadTurnLog(saveId);
    if (!log || !Array.isArray(log.turns) || !log.turns.length) {
        el.innerHTML = '<div class="empty-hint">暂无回溯记录。每完成一回合会自动记录一个回溯点，之后可从任意历史回合重新选择。</div>';
        return;
    }
    const turns = log.turns;
    const branches = Array.isArray(log.branches) ? log.branches : [];
    const branchName = (id) => id === "main" ? "主线" : ("分支 " + ((branches.findIndex(b => b.id === id)) + 1));
    const chapters = [];
    for (const t of turns) {
        const ch = chapterOf(t.turn);
        let c = chapters.find(x => x.ch === ch);
        if (!c) { c = { ch, items: [] }; chapters.push(c); }
        c.items.push(t);
    }
    const branchInfoHtml = branches.length
        ? `<div class="rewind-branches">${branches.map(b => `<span class="rewind-branch-chip">⤴ ${escapeHtml(branchName(b.id))}（从第 ${b.base_turn} 回合分叉）</span>`).join("")}</div>`
        : "";
    const chapHtml = chapters.slice().reverse().map(c => `
        <div class="rewind-chapter">
            <div class="rewind-chapter-title">第 ${c.ch} 章</div>
            ${c.items.slice().reverse().map(t => `
                <button class="rewind-turn" data-action="openRewindTurn" data-turn="${t.turn}">
                    <span class="rewind-turn-label">${escapeHtml(t.label || ("第 " + t.turn + " 回合"))}</span>
                    <span class="rewind-turn-player">${escapeHtml((t.entry && t.entry.player) || "")}</span>
                    ${t.branch && t.branch !== "main" ? `<span class="rewind-turn-branch">${escapeHtml(branchName(t.branch))}</span>` : ""}
                </button>`).join("")}
        </div>`).join("");
    el.innerHTML = `<div class="rewind-block">
        <div class="muted" style="margin-bottom:6px;">已记录 ${turns.length} 个回溯点${branches.length ? " · " + branches.length + " 个分支" : ""}。点击任一回合可回到过去重新选择。</div>
        ${branchInfoHtml}
        ${chapHtml}
    </div>`;
}

// ★ docs/69：打开回溯确认弹窗（填充目标回合信息）
export async function openRewindTurn(turn) {
    const saveId = S.currentSession && S.currentSession.saveId;
    if (!saveId) { showToast("未绑定存档槽位，无法回溯", "warn"); return; }
    const log = await loadTurnLog(saveId);
    if (!log || !Array.isArray(log.turns)) { showToast("暂无回溯记录", "warn"); return; }
    const snap = log.turns.find(t => t.turn === parseInt(turn, 10));
    if (!snap) { showToast("目标回合不存在", "warn"); return; }
    const total = log.turns.length;
    const overwrite = total - snap.turn;
    const label = snap.label || ("第 " + snap.turn + " 回合");
    const player = (snap.entry && snap.entry.player) || "";
    const narrative = (snap.entry && snap.entry.narrative) || "";
    const choices = (snap.entry && snap.entry.choices) || [];
    const body = document.getElementById("rewindBody");
    if (body) {
        body.innerHTML = `
            <div class="rewind-target">
                <div class="rewind-target-label">${escapeHtml(label)}</div>
                ${player ? `<div class="rewind-target-player">你：${escapeHtml(player)}</div>` : ""}
                ${narrative ? `<div class="rewind-target-narrative">${escapeHtml(narrative)}</div>` : ""}
                ${choices.length ? `<div class="rewind-target-choices">当时选项：${choices.map(c => escapeHtml(c)).join(" / ")}</div>` : ""}
            </div>
            <div class="rewind-warn">⚠ 回到此回合后，其后的 ${overwrite} 个回合将被覆盖（本分支历史仍保留在日志中）。想保留当前进度，请先「另存为新存档」。</div>
            <label class="rewind-option"><input type="checkbox" id="rewindClearMemory"> 回溯时清空角色记忆到当时（默认保留——角色会记得"未来"发生过的事）</label>`;
    }
    const info = document.getElementById("rewindModalInfo");
    if (info) info.textContent = "回到 第 " + snap.turn + " 回合";
    S._rewindTargetTurn = snap.turn; // 供 app.js 的 confirmRewind / rewindAndFork 读取
    showModal("rewindModal");
}

// ★ 57：偏离原著报告——把 S.worldRuntime.deltaLog 渲染为可读列表（状态面板「偏离」页签）
export function renderLoreDeltaHTML() {
    const rt = S.worldRuntime;
    if (!rt || !Array.isArray(rt.deltaLog) || !rt.deltaLog.length) {
        return '<div class="empty-hint">本局尚未发生偏离原著的剧情变更。</div>';
    }
    const rows = rt.deltaLog.slice().reverse().map(d => {
        const what = (d.entity ? d.entity + (d.lore_id ? "/" + d.lore_id : "") : (d.lore_id || "?"));
        const to = (typeof d.to === "string") ? d.to : JSON.stringify(d.to || "");
        const from = (typeof d.from === "string" && d.from) ? d.from : null;
        const opLabel = d.op === "add" ? "新增本局事实" : "改写设定";
        return `
            <div class="divergence-row">
                <div class="divergence-head"><span class="divergence-turn">回合 ${d.turn || "?"}</span><span class="divergence-op">${opLabel}</span></div>
                <div class="divergence-what">${escapeHtml(what)}</div>
                ${from ? `<div class="divergence-from">原：${escapeHtml(from.slice(0, 120))}</div>` : ""}
                <div class="divergence-to">→ ${escapeHtml(to.slice(0, 160))}</div>
                ${d.note ? `<div class="divergence-note">备注：${escapeHtml(d.note)}</div>` : ""}
            </div>`;
    }).join("");
    return `<div class="status-section"><div class="status-section-title">📊 本局偏离原著报告</div><div class="divergence-list">${rows}</div>
        <div class="muted" style="margin-top:8px;">这些是 AI 据本局剧情对知识库工作副本做出的改动；原著设定未被修改，重开新档即复原。</div></div>`;
}

export function updateGameDayInfo() {
    if (!S.gameState) return;
    const dayEl = document.getElementById("gameDayInfo");
    if (!dayEl) return;
    const views = getAllTimelineViews(S.gameState);
    if (views && views.length > 1) {
        const active = views.find(v => v.active);
        const others = views.filter(v => !v.active).map(v => `${v.name}:${v.dateLabel}`).join(" ｜ ");
        dayEl.textContent = `🌐 ${active ? active.name : ""} · ${formatDateOnly(S.gameState.current_date, getTimeConfig().timeConfig)}`
            + (others ? ` ｜ 另界 ${others}` : "");
        renderTimelineSwitch(views);
    } else {
        dayEl.textContent = formatWorldTime(S.gameState);
        const sw = document.getElementById("timelineSwitch");
        if (sw) sw.innerHTML = "";
    }
}

// Phase 2 多世界：顶栏时间线切换控件（点击切换到另一时间线，进度互不丢失）
function renderTimelineSwitch(views) {
    const sw = document.getElementById("timelineSwitch");
    if (!sw) return;
    if (!views || views.length < 2) { sw.innerHTML = ""; return; }
    sw.innerHTML = views.map(v =>
        `<button class="tl-chip${v.active ? " active" : ""}" data-action="switchTimeline" data-id="${escapeHtml(v.id)}" ${v.active ? "disabled" : ""}>${escapeHtml(v.name)}</button>`
    ).join("");
}

export function highlightItems(text) {
    // ★ 修复：inventory 可能缺失（AI 生成世界 initial_state 无该字段），读 length 前必须判数组
    if (!S.gameState || !Array.isArray(S.gameState.inventory) || !S.gameState.inventory.length) return text;
    const names = S.gameState.inventory.map(i => i.name).filter(n => n);
    if (!names.length) return text;
    // ★ docs/63：改走 highlightTerms（防嵌套的多词交替实现），对外行为不变（纯文本入参、内部转义）
    return highlightTerms(escapeHtml(text), names, "item-highlight");
}

// ============================================================
// ★ docs/63：剧情文本高亮（人名 / 对白 / AI 标记）
// 安全约定：highlightTerms / dialogueOnEscaped / aiMarksOnEscaped 的入参
// 必须是「已转义」的 HTML（escapeHtml 之后），只产出白名单 span/strong，
// 不引入原始 HTML，无注入面。
// ============================================================

// 取当前世界的角色名表（B1 人物卡；过滤空名与单字名——单字名易误伤正文普通字）
function charNames() {
    const chars = (S.currentWorld && Array.isArray(S.currentWorld.characters)) ? S.currentWorld.characters : [];
    return chars
        .map(c => (c && typeof c.name === "string" ? c.name.trim() : ""))
        .filter(n => n.length >= 2);
}

// 多词高亮核心：在已转义 HTML 上做白名单 span 替换。
// - 多词交替正则 + 单次 replace：同一词表内长词优先、天然不嵌套（替代旧循环 replace 的嵌套 bug）；
// - 按标签切分并跟踪 span 深度：已包裹在 span 内的文本不再被后续词表套层 → 跨词表也不嵌套。
export function highlightTerms(escapedHtml, terms, cls) {
    if (!escapedHtml || !Array.isArray(terms) || !terms.length) return escapedHtml;
    const uniq = [...new Set(terms.map(String).filter(Boolean))];
    if (!uniq.length) return escapedHtml;
    uniq.sort((a, b) => b.length - a.length); // 长词优先，避免短词先匹配吃掉长词
    const re = new RegExp("(" + uniq.map(t => escapeRegExp(escapeHtml(t))).join("|") + ")", "g");
    let depth = 0;
    return escapedHtml.split(/(<[^>]+>)/g).map(seg => {
        if (seg.startsWith("<")) {
            if (/^<\/?span\b/i.test(seg)) depth += (/^<\/span/i.test(seg) ? -1 : 1);
            return seg;
        }
        if (depth > 0) return seg; // 已在上一词表生成的 span 内，跳过防嵌套
        return seg.replace(re, m => `<span class="${cls}">${m}</span>`);
    }).join("");
}

// A：人物名字高亮（纯文本入参，内部转义；供测试/复用）
export function highlightNames(text) {
    const names = charNames();
    if (!names.length) return text;
    return highlightTerms(escapeHtml(text), names, "name-highlight");
}

// C：对白（引号内容）高亮。在已转义 HTML 上匹配引号对。
// 注意：
// - escapeHtml 会把 ASCII 双引号转成 &quot;，故引号需用「交替」而不是字符类
//   （字符类里的 &quot; 会被拆成 &/q/u/o/t/; 等单字符，误伤 &lt; 等实体）；
// - 只在非标签文本段匹配（标签属性里的 &quot; 不是对白引号），避免破坏已生成的高亮 span。
const DIALOGUE_RE = /(“|&quot;|«|「|『)([^”»」』]{0,160}?)(”|&quot;|»|」|』)/g;
function dialogueOnEscaped(escapedHtml) {
    if (!escapedHtml) return escapedHtml;
    return escapedHtml.split(/(<[^>]+>)/g).map(seg => {
        if (seg.startsWith("<")) return seg;
        return seg.replace(DIALOGUE_RE, '<span class="dialogue-highlight">$1$2$3</span>');
    }).join("");
}
export function highlightDialogue(text) {
    return dialogueOnEscaped(escapeHtml(text));
}

// B：AI 标记解析（**加粗** → strong.ai-emphasis；==高亮== → span.ai-mark）。
// 开关关闭时不解析，标记符号按普通字符原样显示（无害）。
const AI_BOLD_RE = /\*\*([^*\n]{1,120}?)\*\*/g;
const AI_MARK_RE = /==([^=\n]{1,120}?)==/g;
function aiMarksOnEscaped(escapedHtml) {
    if (!escapedHtml) return escapedHtml;
    return escapedHtml
        .replace(AI_BOLD_RE, '<strong class="ai-emphasis">$1</strong>')
        .replace(AI_MARK_RE, '<span class="ai-mark">$1</span>');
}
export function highlightAiMarks(text) {
    return aiMarksOnEscaped(escapeHtml(text));
}

/**
 * 在「已转义、已含物品高亮」的 HTML 上，把命中的违禁概念标黄（IP#6）。
 * 注意入参 html 已是转义后的文本，故这里只转义 term 再正则匹配，避免二次转义破坏既有 <span>。
 */
export function highlightBanned(html, hits) {
    if (!html || !Array.isArray(hits) || !hits.length) return html;
    const terms = [...new Set(hits.filter(Boolean).map(String))];
    if (!terms.length) return html;
    let out = html;
    for (const term of terms) {
        const escapedTerm = escapeHtml(term);
        const regex = new RegExp(escapeRegExp(escapedTerm), "g");
        out = out.replace(regex, `<span class="banned-hit">${escapedTerm}</span>`);
    }
    return out;
}

/**
 * 把剧情文本渲染为带段落结构的 HTML。
 * - 按空行（\n\n）拆分为独立段落 <p>，段间距由 CSS 的 `p + p` 规则控制；
 * - 段落内的单个换行保留为 <br>，避免被浏览器折叠；
 * - ★ docs/63 高亮管道（顺序固定）：先无条件 escapeHtml（安全基座）→ 物品
 *   （highlightTerms, item-highlight）→ 人名（name-highlight）→ 对白引号
 *   （dialogue-highlight）→ AI 标记（双星号加粗 / 双等号高亮，ai-emphasis /
 *   ai-mark）→ 违禁词标黄（banned-hit，IP#6 最后叠加）。各层开关在设置面板
 *   「高亮」分区，默认全开；
 * - 高亮不会破坏已插入的 <br>，也不会互相嵌套（highlightTerms 防嵌套）。
 */
export function renderNarrative(text, isWarning, bannedHits) {
    if (isWarning) return escapeHtml(text || "");
    const blocks = (text || "")
        .split(/\n{2,}/)
        .map(b => b.trim())
        .filter(b => b.length);
    if (!blocks.length) return escapeHtml(text || "");
    return blocks
        .map(b => {
            // ★ docs/63：先无条件转义（安全基座），再按开关叠加各层高亮；违禁词标黄保持最后。
            // 打字机打完后调用本函数 → 高亮与逐字动画天然兼容（打字中显示纯文本）。
            let html = escapeHtml(b);
            if (S.highlightItems !== false) {
                const itemNames = (S.gameState && Array.isArray(S.gameState.inventory)) ? S.gameState.inventory.map(i => i.name).filter(n => n) : [];
                html = highlightTerms(html, itemNames, "item-highlight");
            }
            if (S.highlightNames !== false) html = highlightTerms(html, charNames(), "name-highlight");
            if (S.highlightDialogue !== false) html = dialogueOnEscaped(html);
            if (S.highlightAiMarks !== false) html = aiMarksOnEscaped(html);
            if (Array.isArray(bannedHits) && bannedHits.length) html = highlightBanned(html, bannedHits);
            return `<p>${html.replace(/\n/g, "<br>")}</p>`;
        })
        .join("");
}

/**
 * ★ IP#6：渲染「疑似偏离世界观」提示条（纯 HTML，无 DOM 依赖，便于单测）。
 * 含三个动作按钮：移除这句 / AI 重写本回合 / 忽略。data-idx 为条目在 conversationHistory 的下标。
 */
export function renderScanWarnBar(entry, index) {
    const hits = Array.isArray(entry.bannedHits) ? entry.bannedHits : [];
    const term = hits.length ? hits[0] : "";
    const more = hits.length > 1 ? `（共 ${hits.length} 处）` : "";
    const termAttr = escapeHtml(term);
    return `
        <div class="scan-warn-bar">
            <span class="scan-warn-text">⚠️ 疑似偏离世界观（出现「<b>${termAttr}</b>」${more}）</span>
            <span class="scan-warn-actions">
                <button class="scan-warn-btn" data-action="removeBannedSentence" data-idx="${index}" data-term="${termAttr}">移除这句</button>
                <button class="scan-warn-btn" data-action="regenerateTurn" data-idx="${index}">AI 重写本回合</button>
                <button class="scan-warn-btn ghost" data-action="ignoreBannedTerm" data-idx="${index}" data-term="${termAttr}">忽略</button>
            </span>
        </div>`;
}

// 单条日志的 HTML（renderLog 追加 与 replaceEntryDOM 原地替换 共用同一份模板，避免两处渲染逻辑漂移）
export function buildLogEntryHTML(entry, i) {
    const warningClass = entry.isWarning ? " warning" : "";
    const metaLabel = entry.isWarning
        ? "系统提示"
        : (entry.player ? "你" : "开场");
    return `
        <div class="log-entry${warningClass}">
            <div class="meta">
                <span>${metaLabel} · ${escapeHtml(entry.tcd ? formatTimeLabel(entry.tcd, getTimeConfig().timeConfig) : formatTimeShort(entry.day, entry.period, entry.clock))}</span>
            </div>
            ${entry.player ? `<div class="player-text">${escapeHtml(entry.player)}</div>` : ""}
            <div class="narrative">${renderNarrative(entry.narrative, entry.isWarning, entry.bannedHits)}</div>
            ${entry.atmosphere ? `<div class="log-whisper"><span>◈ ${escapeHtml(entry.atmosphere)}</span></div>` : ""}
            ${renderTurnChanges(entry)}
            ${entry.scanWarn && !entry.isWarning ? renderScanWarnBar(entry, i) : ""}
        </div>
        `;
}

export function renderLog(reset) {
    const log = document.getElementById("gameLog");
    if (reset) { S.renderedEntryCount = 0; log.innerHTML = '<div class="choices-row in-log" id="choicesArea"></div>'; }
    updateEventButtonVisibility(); // ★ 事件系统：每轮重绘时同步「🎴 支线」按钮显隐

    // 只追加新增的条目
    for (let i = S.renderedEntryCount; i < S.conversationHistory.length; i++) {
        log.insertBefore(createElementFromHTML(buildLogEntryHTML(S.conversationHistory[i], i)), document.getElementById("choicesArea"));
    }
    S.renderedEntryCount = S.conversationHistory.length;
    log.scrollTop = log.scrollHeight;
}

// ★ B2：渲染「本回合变化」块（叙事+氛围之后）。无变化时返回空字符串。
export function renderTurnChanges(entry) {
    const lines = formatStateChanges(entry, S.currentWorld);
    if (!lines.length) return "";
    return `<div class="turn-changes"><div class="turn-changes-title">本回合变化</div>` +
        lines.map(l => `<div class="turn-change-item">${escapeHtml(l)}</div>`).join("") +
        `</div>`;
}

// ★ P0：阅读速度 → 打字机延迟表（instant=null 表示跳过逐字动画直接定稿）
const TYPING_SPEED_TABLE = {
    slow:     { base: 28, sentence: 160, comma: 80, newline: 100, quote: 55 },
    standard: { base: 12, sentence: 70,  comma: 35, newline: 45,  quote: 25 }, // = 原硬编码值
    fast:     { base: 6,  sentence: 32,  comma: 16, newline: 22,  quote: 12 },
    instant:  null
};
// 纯函数，可单测：返回当前档位的延迟表；未知档回落 standard；instant 显式返回 null。
export function getTypingDelays(level) {
    if (Object.prototype.hasOwnProperty.call(TYPING_SPEED_TABLE, level)) return TYPING_SPEED_TABLE[level];
    return TYPING_SPEED_TABLE.standard;
}
// 纯函数，可单测：流式节流毫秒；仅 slow 节流 120ms，其余（含瞬显）立即（= 原行为）。
export function getStreamThrottleMs(level) {
    return level === "slow" ? 120 : 0;
}

// ★ 实时流式：把模型正在生成的叙事（部分文本）直接写进指定日志条目的 .narrative，
// 让玩家在模型边生成边看到文字（首字延迟从「整段生成完」降到约 1~2 秒）。
// 流式节流状态（模块级）：slow 档下累积文本、按 getStreamThrottleMs 节奏 repaint
let _liveLastPaint = 0;
let _livePending = null;
let _liveTimer = null;

function _paintLive(index, text) {
    const log = document.getElementById("gameLog");
    if (!log) return;
    const entries = log.querySelectorAll(".log-entry");
    const entry = entries[index];
    if (!entry) return;
    const el = entry.querySelector(".narrative");
    if (!el) return;
    el.textContent = text || "";
    log.scrollTop = log.scrollHeight;
}

export function updateLiveNarrative(index, text) {
    const throttle = getStreamThrottleMs(S.readingSpeed);
    if (throttle <= 0) { _paintLive(index, text); return; }  // 标准/快/瞬显：即时（= 原行为）
    _livePending = { index, text };
    const now = Date.now();
    if (now - _liveLastPaint >= throttle) {
        _liveLastPaint = now;
        _paintLive(index, text);
        _livePending = null;
    } else if (!_liveTimer) {
        // 兜底：在距上次绘制满 throttle 时补一次最终文本的 repaint，避免末段文本残留不显示
        _liveTimer = setTimeout(() => {
            _liveTimer = null;
            _liveLastPaint = Date.now();
            if (_livePending) { _paintLive(_livePending.index, _livePending.text); _livePending = null; }
        }, throttle - (now - _liveLastPaint));
    }
}

// ★ 实时流式：只移除某条日志的 DOM（不动 conversationHistory 数组），供重渲染复用
function removeEntryDOMOnly(index) {
    const log = document.getElementById("gameLog");
    if (log) {
        const entries = log.querySelectorAll(".log-entry");
        const el = entries[index];
        if (el) el.remove();
    }
    if (S.renderedEntryCount > index) S.renderedEntryCount = index;
}

// ★ 实时流式：移除某条已渲染的日志条目（DOM + 数组 + 渲染计数同步），供丢弃过期响应等场景用
export function removeLogEntry(index) {
    const log = document.getElementById("gameLog");
    if (log) {
        const entries = log.querySelectorAll(".log-entry");
        const el = entries[index];
        if (el) el.remove();
    }
    // ★ 修复重复渲染：渲染计数按「少了一条」递减，而不是回退到 index。
    //   否则 index 之后已经渲染过的条目（如等待回复期间插入的「今日动态」）
    //   会在下一次 renderLog 时被再追加一遍，界面上出现两条。
    if (S.renderedEntryCount > index) S.renderedEntryCount -= 1;
    if (S.conversationHistory.length > index) S.conversationHistory.splice(index, 1);
}

// ★ 实时流式：用最新数据重渲染指定条目（提交为格式化叙事 + 氛围提示）。
// 原地替换该条目的 DOM 节点，不动数组、不动渲染计数——
// 早期实现是「删旧 DOM + renderLog 从该下标重新追加」，一旦这条之后还有别的条目
// （等待回复期间点「今日动态」插进来的播报），那些条目就会被重复追加一次（弹两次）。
// 注意：这里只能改 DOM、不能动数组——若误用 removeLogEntry 会把刚定稿的回合从
// conversationHistory 里删掉，导致剧情数据丢失（processTurn 集成测试抓到的 bug）。
export function replaceEntryDOM(index) {
    const log = document.getElementById("gameLog");
    const data = S.conversationHistory[index];
    if (log && data && index < S.renderedEntryCount) {
        const old = log.querySelectorAll(".log-entry")[index];
        if (old) {
            const fresh = createElementFromHTML(buildLogEntryHTML(data, index));
            if (typeof old.replaceWith === "function") old.replaceWith(fresh);
            else if (old.parentNode) old.parentNode.replaceChild(fresh, old);
            log.scrollTop = log.scrollHeight;
            return;
        }
    }
    // 兜底：该条尚未渲染 / DOM 缺失 → 回落到原「删旧 DOM + 追加」路径
    removeEntryDOMOnly(index);
    renderLog();
}

export function startTypewriter(index) {
    stopTypewriter();
    const log = document.getElementById("gameLog");
    const entries = log.querySelectorAll(".log-entry");
    const entry = entries[index];
    if (!entry) return Promise.resolve();
    const narrativeEl = entry.querySelector(".narrative");
    const data = S.conversationHistory[index];
    const fullText = data.narrative || "";
    if (!fullText) return Promise.resolve();

    // ★ P0：阅读速度=瞬显 时直接定稿，不做逐字动画
    const typingDelays = getTypingDelays(S.readingSpeed);
    if (!typingDelays) {
        narrativeEl.innerHTML = renderNarrative(fullText, data.isWarning);
        entry.querySelector(".log-whisper")?.classList.remove("hidden");
        return Promise.resolve();
    }

    // 清空容器，进入打字状态（不再因系统"减少动态效果"而跳过逐字动画）
    narrativeEl.innerHTML = "";
    narrativeEl.classList.add("typing");
    log.classList.add("typing-active");
    entry.querySelector(".log-whisper")?.classList.add("hidden"); // 氛围提示等打字结束再出现
    S.typingIndex = index;

    return new Promise(resolve => {
        S.typingResolver = resolve;
        const chars = Array.from(fullText);  // Array.from 正确处理 emoji / 代理对
        let i = 0;

        function typeNext() {
            if (i >= chars.length) {
                finishTyping();
                return;
            }
            const ch = chars[i];
            // 打字过程中用纯文本（避免高亮在物品名被截断时闪烁）
            narrativeEl.textContent = chars.slice(0, i + 1).join("");
            i++;
            log.scrollTop = log.scrollHeight;

            // ★ P0：标点处停顿，延迟取自阅读速度档位（中途改实时生效）
            let delay = typingDelays.base;
            if ("。！？…".includes(ch)) delay = typingDelays.sentence;
            else if ("，、；：".includes(ch)) delay = typingDelays.comma;
            else if (ch === "\n") delay = typingDelays.newline;
            else if (ch === "「" || ch === "」" || ch === '"' ) delay = typingDelays.quote;
            S.typingTimer = setTimeout(typeNext, delay);
        }
        typeNext();
    });
}

export function finishTyping() {
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
    if (S.typingIndex >= 0 && S.conversationHistory[S.typingIndex]) {
        const log = document.getElementById("gameLog");
        const entries = log.querySelectorAll(".log-entry");
        const entry = entries[S.typingIndex];
        if (entry) {
            const narrativeEl = entry.querySelector(".narrative");
            const data = S.conversationHistory[S.typingIndex];
            const fullText = data.narrative || "";
            // 完成后替换为带物品高亮 + 段落结构的 HTML
            narrativeEl.innerHTML = renderNarrative(fullText, data.isWarning);
            narrativeEl.classList.remove("typing");
            entry.querySelector(".log-whisper")?.classList.remove("hidden"); // 显示氛围提示
        }
        log.classList.remove("typing-active");
    }
    S.typingIndex = -1;
    if (S.typingResolver) {
        const r = S.typingResolver;
        S.typingResolver = null;
        r();
    }
}

export function skipTypewriter() {
    if (S.typingIndex >= 0) finishTyping();
}

export function stopTypewriter() {
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
    if (S.typingIndex >= 0) {
        const log = document.getElementById("gameLog");
        const entries = log.querySelectorAll(".log-entry");
        const entry = entries[S.typingIndex];
        if (entry) {
            entry.querySelector(".narrative")?.classList.remove("typing");
            entry.querySelector(".log-whisper")?.classList.remove("hidden"); // 中断时也确保氛围提示不丢失
        }
        log.classList.remove("typing-active");
    }
    S.typingIndex = -1;
    S.typingResolver = null;
}

export function renderChoices(choices) {
    S.currentChoices = choices || [];
    const area = document.getElementById("choicesArea");
    if (!choices || choices.length === 0) {
        area.innerHTML = "";
        return;
    }
    const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
    area.innerHTML = choices.map((c, i) => {
        const num = i < CIRCLED.length ? CIRCLED[i] : (i + 1) + ".";
        return `<button class="choice-chip" data-action="chooseOption" data-index="${i}"><span class="choice-index">${num}</span>${escapeHtml(c.text)}</button>`;
    }).join("");
}

// ★ 事件系统：渲染支线事件卡面板（事件面板 modal 的列表容器 eventPanelList）
export function renderEventPanel(events) {
    const list = document.getElementById("eventPanelList");
    if (!list) return;
    const evs = Array.isArray(events) ? events : [];
    if (!evs.length) {
        list.innerHTML = '<div class="empty-hint">当前没有可进入的支线事件。继续推进剧情，AI 会适时给出新的支线候选。</div>';
        return;
    }
    const cur = (S.gameState && S.gameState.variables && typeof S.gameState.variables.stamina === "number") ? S.gameState.variables.stamina : null;
    list.innerHTML = evs.map((ev, i) => {
        const cost = Number(ev.cost_stamina) || 0;
        const lack = (cur !== null && cost > cur);
        const badge = "体力 " + cost + (ev.cost_time ? " · 时间 " + escapeHtml(ev.cost_time) : "");
        return `<div class="event-card${lack ? " disabled" : ""}">
            <div class="event-card-head">
                <span class="event-card-title">${escapeHtml(ev.title || "未命名事件")}</span>
                <span class="event-card-badge">${escapeHtml(badge)}</span>
            </div>
            <div class="event-card-desc">${escapeHtml(ev.desc || "")}</div>
            <button class="btn-secondary-sm event-enter" data-action="enterSideEvent" data-idx="${i}" ${lack ? "disabled" : ""}>${lack ? "体力不足" : "进入"}</button>
        </div>`;
    }).join("");
}

// ★ 事件系统：根据 events 模块开关控制「🎴 支线」按钮显隐（renderLog 每轮调用）
export function updateEventButtonVisibility() {
    const btn = document.getElementById("eventPanelBtn");
    if (btn) btn.style.display = (S.currentWorld && isModuleEnabled(S.currentWorld, "events")) ? "" : "none";
}

export function checkDeathBanner() {
    if (!S.gameState || S.gameState.is_alive !== false) {
        document.getElementById("deathBanner").classList.add("hidden");
        return;
    }
    const reason = S.gameState.death_reason || "你的旅程到此为止。";
    document.getElementById("deathBannerText").textContent = "角色已死亡 — " + reason;
    document.getElementById("deathBanner").classList.remove("hidden");
}

export function updateInputState() {
    const inputEl = document.getElementById("playerInput");
    const sendBtn = document.querySelector(".send-btn");
    const isDead = S.gameState && S.gameState.is_alive === false;
    if (inputEl) {
        inputEl.disabled = isDead;
        inputEl.placeholder = isDead ? "角色已死亡，仅供回顾..." : "输入你想做的事...";
    }
    if (sendBtn) sendBtn.disabled = isDead;
}

export function restoreLastChoices() {
    if (!S.conversationHistory.length) {
        // 新游戏，用世界初始选项
        if (S.currentWorld && S.currentWorld.initial_choices && S.currentWorld.initial_choices.length) {
            S.currentChoices = S.currentWorld.initial_choices;
            renderChoices(S.currentChoices);
        }
        return;
    }
    // 倒序找最后一条有 choices 的记录
    for (let i = S.conversationHistory.length - 1; i >= 0; i--) {
        const entry = S.conversationHistory[i];
        if (entry.choices && entry.choices.length) {
            S.currentChoices = entry.choices;
            renderChoices(S.currentChoices);
            return;
        }
    }
    // 没找到，检查初始选项
    if (S.currentWorld && S.currentWorld.initial_choices && S.currentWorld.initial_choices.length) {
        S.currentChoices = S.currentWorld.initial_choices;
        renderChoices(S.currentChoices);
    }
}

export function showGameOver(info) {
    // info 可为字符串（旧调用/死亡说明）或 { title, kind, reason }
    let title = "结局", kind = "normal", reason = "你的旅程到此为止。";
    if (typeof info === "string") {
        reason = info || reason;
    } else if (info && typeof info === "object") {
        title = info.title || "结局";
        kind = ENDING_KINDS.includes(info.kind) ? info.kind : "normal";
        reason = info.reason || reason;
    }
    const titleEl = document.getElementById("gameOverTitle");
    if (titleEl) titleEl.textContent = title;
    const kindEl = document.getElementById("gameOverKind");
    if (kindEl) {
        kindEl.textContent = endingKindLabel(kind);
        kindEl.className = "ending-kind-badge kind-" + kind;
    }
    const reasonEl = document.getElementById("gameOverReason");
    if (reasonEl) reasonEl.textContent = reason;
    renderEndingCodex();
    document.getElementById("gameOverOverlay").classList.add("show");
}

// ★ docs/54：结局图鉴渲染（游戏结束弹窗内）
function renderEndingCodex() {
    const box = document.getElementById("endingCodex");
    if (!box) return;
    const list = (S.gameState && Array.isArray(S.gameState.unlockedEndings)) ? S.gameState.unlockedEndings : [];
    if (!list.length) { box.innerHTML = ""; box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    box.innerHTML = `<div class="codex-title">已解锁结局图鉴（${list.length}）</div>` + list.map(e => {
        const k = e.kind || "normal";
        return `<div class="codex-item kind-${k}">
            <span class="ending-kind-badge kind-${k}">${escapeHtml(endingKindLabel(k))}</span>
            <span class="codex-item-title">${escapeHtml(e.title || "结局")}</span>
        </div>`;
    }).join("");
}

// ★ docs/54：游玩时「结局追踪器」渲染
export function renderEndingTracker() {
    const body = document.getElementById("endingTrackerBody");
    if (!body) return;
    const world = S.currentWorld, gs = S.gameState;
    if (!world || !gs) { body.innerHTML = ""; return; }
    const list = evaluateEndingStatus(world, gs, null);
    if (!list.length) {
        body.innerHTML = `<p class="muted">该世界没有配置「结局」规则。</p>`;
        return;
    }
    body.innerHTML = list.map(e => {
        const statusLabel = e.met ? "已满足" : (e.progress != null ? "进行中" : "未满足");
        const statusCls = e.met ? "met" : (e.progress != null ? "progress" : "unmet");
        const progPct = e.progress != null ? Math.round(e.progress * 100) : 0;
        const progBar = e.progress != null
            ? `<div class="tracker-progress"><div class="tracker-progress-bar" style="width:${progPct}%"></div></div>`
            : "";
        return `<div class="tracker-card kind-${e.kind}">
            <div class="tracker-card-head">
                <span class="ending-kind-badge kind-${e.kind}">${escapeHtml(endingKindLabel(e.kind))}</span>
                <span class="tracker-title">${escapeHtml(e.title)}</span>
            </div>
            <div class="tracker-cond">${escapeHtml(endingWhenText(e.when))}</div>
            <span class="tracker-status ${statusCls}">${statusLabel}</span>
            ${progBar}
        </div>`;
    }).join("");
}

export function showEndingTracker() {
    renderEndingTracker();
    showModal("endingTrackerModal");
}

export function showToast(msg, type = "", duration = 2000) {
    const el = document.getElementById("toast");
    if (S.toastTimer) clearTimeout(S.toastTimer);
    el.textContent = msg;
    el.className = "toast show " + type;
    S.toastTimer = setTimeout(() => {
        el.classList.remove("show");
        S.toastTimer = null;
    }, duration);
}

// ★ #10 Phase 1：Tier2 提示档——关键路径失败时既留痕（logError）又弹 toast。
// 区别于 Tier1 静默降级（logError 不弹窗），用于"用户操作/关键持久化失败"等用户应当知晓的场景。
export function notifyError(scope, err, msg) {
    logError(scope, err);
    const detail = (err && err.message) ? err.message : String(err);
    showToast(msg || ("操作失败：" + detail), "error");
}

export function showLoading(msg) {
    const el = document.getElementById("loadingIndicator");
    if (!el) return;
    S.loadingStartTime = Date.now();
    el.querySelector(".loading-text").textContent = msg;
    el.querySelector(".loading-time").textContent = "0.0s";
    el.classList.add("show");
    S.loadingInterval = setInterval(() => {
        const elapsed = ((Date.now() - S.loadingStartTime) / 1000).toFixed(1);
        el.querySelector(".loading-time").textContent = elapsed + "s";
    }, 200);
}

export function updateLoadingProgress(charCount) {
    const el = document.getElementById("loadingIndicator");
    if (!el || !el.classList.contains("show")) return;
    const elapsed = ((Date.now() - S.loadingStartTime) / 1000).toFixed(1);
    const kChars = charCount > 1000 ? (charCount / 1000).toFixed(1) + "K" : charCount;
    el.querySelector(".loading-text").textContent = "已接收 " + kChars + " 字符...";
    el.querySelector(".loading-time").textContent = elapsed + "s";
}

export function hideLoading() {
    const el = document.getElementById("loadingIndicator");
    if (!el) return;
    el.classList.remove("show");
    if (S.loadingInterval) { clearInterval(S.loadingInterval); S.loadingInterval = null; }
}

export function updateCacheIndicator() {
    const el = document.getElementById("cacheIndicator");
    if (!el || !S.lastCacheStats.totalTokens) {
        if (el) el.classList.add("hidden");
        return;
    }
    el.classList.remove("hidden");
    const rate = parseFloat(S.lastCacheStats.hitRate);
    let cls = "bad";
    if (rate >= 70) cls = "good";
    else if (rate >= 35) cls = "warn";
    el.className = "cache-indicator " + cls;
    el.textContent = "命中 " + S.lastCacheStats.hitRate + " (" + S.lastCacheStats.hitTokens + "/" + S.lastCacheStats.totalTokens + "t)";
    el.title = "缓存命中: " + S.lastCacheStats.hitTokens + " tokens | 未命中: " + S.lastCacheStats.missTokens + " tokens";
}
