// ============================================================
// AetherNarrator · render.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S, calendarLabel, MEMORY_TYPE_LABELS, getEnabledVariables } from "./store.js";

import { createElementFromHTML, escapeHtml, escapeRegExp, getAttributeLabel, getWorldSchema, computeWorldCompletion, logError } from "./utils.js";
import { getPeriodLabel, getTimeConfig, formatWorldTime, formatTimeShort, formatTimeLabel, formatDeadlineLabel, stepOf, updateFontSizeButtons, getAllTimelineViews, formatDateOnly, tempLabelText } from "./theme.js";
// 注：页面按钮的 chooseOption / startGame / loadSave 等动作均通过 data-action 属性由 app.js 事件接线分发，
// 本模块不直接引用这些函数，不反向依赖 game.js / save.js，避免循环引用（docs/34 #1）。
import { abortCurrentRequest } from "./turn-lifecycle.js";
import { styleToTemperature, formatStateChanges } from "./prompt.js";
import { buildWorldSummary, normalizeSimulationState } from "./simulation.js";

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

export function showModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    S.lastFocusedBeforeModal = document.activeElement;
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
    setBackgroundInert(false);
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
}
export function showSettingsScreen() {
    showScreen("settingsScreen");
    updateSettingsValues();
}

let cwStep = 1;
const CW_TOTAL = 4;

export function showCreateWorldModal() {
    resetCreateWorldForm();
    cwStep = 1;
    renderCwStep();
    showModal("createWorldModal");
}

// 打开创建弹窗时完整重置表单（含步骤回到第 1 步、各选项回到默认）
function resetCreateWorldForm() {
    const clearIds = ["worldName", "ipName", "worldDesc", "heroDesc", "customStyle", "customPrefix", "worldPrefix"];
    clearIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const wt = document.getElementById("worldType");
    if (wt) wt.value = "ip";
    onWorldTypeChange("ip"); // 默认 IP 类型，会自动给世界观描述预填「原作世界观」
    // 文风参考默认：参考原版
    document.querySelectorAll("#styleRefGroup .radio-option").forEach((o, i) => o.classList.toggle("selected", i === 0));
    document.querySelectorAll("#styleRefGroup input[type=radio]").forEach((r, i) => r.checked = i === 0);
    const csf = document.getElementById("customStyleField"); if (csf) csf.classList.remove("show");
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
    // 每世界温度默认：0.7（与「参考原版」风格一致），标签同步
    const wtEl = document.getElementById("worldTemp"); if (wtEl) wtEl.value = "0.7";
    updateWorldTempLabel();
    // ★ A1：叙事偏好标签重置
    resetStylePrefs();
    // 收起高级折叠
    const adv = document.querySelector("#createWorldModal details.advanced-details");
    if (adv) adv.open = false;
}

// 向导「下一步」：先校验当前步必填项，通过才前进
export function cwNext() {
    if (cwStep === 1) {
        if (!document.getElementById("worldName").value.trim()) { showToast("请先填写世界名称", "error"); return; }
    } else if (cwStep === 2) {
        const typeVal = document.getElementById("worldType").value;
        const ipNameVal = document.getElementById("ipName").value.trim();
        // ★ 上传了小说源文件后，作品名称改为可选填写
        if (typeVal === "ip" && !ipNameVal && !isSourceFileUploaded()) {
            showToast("基于已有 IP 时请填写作品名称，或上传小说源文件后留空", "error"); return;
        }
    } else if (cwStep === 3) {
        if (!document.getElementById("worldDesc").value.trim()) { showToast("请填写世界观描述", "error"); return; }
    }
    if (cwStep < CW_TOTAL) { cwStep++; renderCwStep(); }
}

// 向导「上一步」
export function cwPrev() {
    if (cwStep > 1) { cwStep--; renderCwStep(); }
}

// 切换步骤显示 + 更新步骤指示 + 底部按钮 + 焦点
function renderCwStep() {
    document.querySelectorAll("#createWorldModal .cw-step").forEach(s => {
        s.classList.toggle("active", Number(s.dataset.step) === cwStep);
    });
    document.querySelectorAll("#createWorldModal .cw-step-dot").forEach(d => {
        const n = Number(d.dataset.step);
        d.classList.toggle("active", n === cwStep);
        d.classList.toggle("done", n < cwStep);
    });
    const prev = document.getElementById("cwPrevBtn");
    const next = document.getElementById("cwNextBtn");
    const gen = document.getElementById("generateWorldBtn");
    if (prev) prev.style.visibility = cwStep > 1 ? "visible" : "hidden";
    if (next) next.style.display = cwStep === CW_TOTAL ? "none" : "";
    if (gen) gen.style.display = cwStep === CW_TOTAL ? "" : "none";
    const cur = document.querySelector('#createWorldModal .cw-step[data-step="' + cwStep + '"]');
    const f = cur && cur.querySelector("input, select, textarea");
    if (f) setTimeout(() => f.focus(), 50);
}

export function onWorldTypeChange(value) {
    const ipNameField = document.getElementById("ipNameField");
    const ipUploadField = document.getElementById("ipUploadField");
    const worldDescHint = document.getElementById("worldDescHint");
    const worldDescTextarea = document.getElementById("worldDesc");
    if (value === "ip") {
        ipNameField.classList.add("show");
        ipUploadField.classList.add("show");
        worldDescHint.innerHTML = "你可以直接使用原作的世界观描述，也可以在此基础上进行修改和扩展——例如调整力量体系、加入新势力、改变时间线等。描述越详细，AI 生成的剧情越贴合你的构想。";
        worldDescTextarea.placeholder = "可以直接填写原作的世界观概述，也可以在此基础上修改...\n例如：在原著的世界观基础上，增加了一个隐秘的地下组织...";
        // 若描述为空，自动填入"原作世界观"
        if (!worldDescTextarea.value.trim()) {
            worldDescTextarea.value = "原作世界观";
        }
    } else {
        ipNameField.classList.remove("show");
        ipUploadField.classList.remove("show");
        // 切到原创时清掉可能已上传的 IP 源文件，避免被错误带入生成
        S.sourceFileContent = "";
        const area = document.getElementById("fileUploadArea");
        const text = document.getElementById("fileUploadText");
        const input = document.getElementById("sourceFile");
        if (area) area.classList.remove("has-file");
        if (text) text.innerHTML = "点击上传 TXT / DOCX / EPUB 文件";
        if (input) input.value = "";
        worldDescHint.innerHTML = "描述越详细，AI 生成的内容越贴近你的预期。";
        worldDescTextarea.placeholder = "描述这个世界的规则、力量体系、主要势力、地点、人物关系等...";
    }
    // 切换类型后，刷新「作品名称 必填/选填」状态
    refreshIpNameRequirement();
}

// 判断玩家是否已上传小说源文件（用于决定作品名称是否必填）
export function isSourceFileUploaded() {
    return !!(S.sourceFileContent && S.sourceFileContent.length > 0);
}

// 上传源文件后，把「作品名称」从必填切到选填（反之亦然）。由 onWorldTypeChange / 上传完成 / 移除文件 调用。
export function refreshIpNameRequirement() {
    const field = document.getElementById("ipNameField");
    if (!field) return;
    const optional = document.getElementById("worldType").value === "ip" && isSourceFileUploaded();
    const tag = document.getElementById("ipNameReqTag");
    if (tag) {
        tag.textContent = optional ? "选填" : "必填";
        tag.className = optional ? "opt-tag" : "req-tag";
    }
    const optHint = document.getElementById("ipNameOptHint");
    if (optHint) optHint.style.display = optional ? "" : "none";
}

export function selectStyleRef(value, el) {
    document.querySelectorAll("#styleRefGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#styleRefGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const customField = document.getElementById("customStyleField");
    if (value === "custom") {
        customField.classList.add("show");
    } else {
        customField.classList.remove("show");
    }
    syncWorldTempToStyle(); // ★ 每世界温度：切换文风时同步推荐温度
}

export function getSelectedStyleRef() {
    const checked = document.querySelector("input[name='styleRef']:checked");
    return checked ? checked.value : "original";
}

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

// ★ 每世界温度：根据所选文风预填推荐温度（original/none → 0.7，custom → 解析文风文本）
export function syncWorldTempToStyle() {
    const ref = getSelectedStyleRef();
    let t = 0.7;
    if (ref === "custom") {
        const cs = document.getElementById("customStyle");
        t = styleToTemperature(cs ? cs.value : "");
    }
    const slider = document.getElementById("worldTemp");
    if (slider) slider.value = t.toFixed(1);
    updateWorldTempLabel();
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
        return `
        <article class="world-card${isNew ? " new-world" : ""}" data-action="showWorldDetail" data-id="${w.id}" tabindex="0" style="animation: fadeSlideIn 0.4s ease-out ${delay}s both;">
            <div class="wc-cover">
                <span class="wc-glyph">${escapeHtml(firstChar)}</span>
                <span class="wc-badge${w.type === "ip" ? "" : " wc-badge-original"}">${w.type === "ip" ? "已有 IP" : "原创"}</span>
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
                <div class="item-title">${escapeHtml(s.worldName)}${titleBadges}</div>
                <div class="item-meta">${escapeHtml(s.progress)}<br>最后游玩：${escapeHtml(s.updatedAt)}</div>
            </div>
            <div class="save-actions">
                ${playBtn}
                <button class="save-del-btn" data-action="deleteSave" data-id="${s.id}">删除</button>
            </div>
        </div>
    `}).join("");
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
        </div>
        <div class="detail-tab-content active" data-detail-tab-content="overview">
            ${completionCard}
            <div class="form-group"><label>世界类型</label><p style="margin:0;font-size:15px;">${w.type === "ip" ? "基于已有 IP / 小说" : "原创世界观"}</p></div>
            ${w.ip_name ? `<div class="form-group"><label>作品名称</label><p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(w.ip_name)}</p></div>` : ""}
            <div class="form-group"><label>世界观描述</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.desc)}</p></div>
            ${w.hero ? `<div class="form-group"><label>主角设定</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.hero)}</p></div>` : ""}
            <div class="form-group"><label>进度系统</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${escapeHtml(schema.progression_path_label)} / ${escapeHtml(schema.progression_label)}</p></div>
            <div class="form-group"><label>创建时间</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${w.createdAt}</p></div>
            ${w.opening_narrative ? `<div class="form-group"><label>开场白预览</label><p style="margin:0;font-size:14px;line-height:1.8;color:var(--text-secondary);white-space:pre-line;">${escapeHtml(w.opening_narrative.slice(0, 200))}${w.opening_narrative.length > 200 ? "..." : ""}</p></div>` : ""}
            ${w.style_ref ? `<div class="form-group"><label>文风参考</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${w.style_ref === "original" ? "参考原版文风" : w.style_ref === "custom" ? "自定义文风：" + escapeHtml(w.custom_style || "未填写") : "不参考文风"}</p></div>` : ""}
            ${w.plot_freedom ? `<div class="form-group"><label>剧情自由度</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">${["", "严格遵循原著", "以原著为主", "适中发散", "自由发挥", "完全自由"][w.plot_freedom] || "适中发散"}</p></div>` : ""}
            ${w.custom_prefix ? `<div class="form-group"><label>特殊要求</label><p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(w.custom_prefix)}</p></div>` : ""}
            ${w.source_content ? `<div class="form-group"><label>源文件</label><p style="margin:0;font-size:14px;color:var(--text-secondary);">已上传（${Math.ceil(w.source_content.length / 1024)} KB）</p></div>` : ""}
        </div>
        <div class="detail-tab-content" data-detail-tab-content="lore">
            <div class="stat-grid"><div class="stat-card"><div class="stat-num">${loreCount}</div><div class="stat-label">知识库条目</div></div></div>
            ${cats.length ? `<div class="cat-bar">${catBar}</div><div class="cat-legend">${catLegend}</div>` : `<p class="muted">暂无分类数据</p>`}
            <button class="btn secondary" data-action="editWorldLore" data-id="${id}">编辑知识库</button>
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
    `;

    const hasSave = S.saves.some(s => s.worldId === w.id);
    const footer = document.getElementById("detailModalFooter");
    if (hasSave) {
        footer.innerHTML = `
            <div class="dropdown dropdown-up">
                <button class="btn secondary" data-action="toggleDropdown">更多 ▾</button>
                <div class="dropdown-menu">
                    <button class="dropdown-item" data-action="showExportWorldChoice" data-id="${id}">导出世界</button>
                    <button class="dropdown-item" data-action="confirmRestart" data-id="${id}">重新开始</button>
                </div>
            </div>
            <button class="btn primary" data-action="continueLatestSave" data-id="${id}">继续游戏</button>`;
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
            ${world ? `<div class="form-group"><label>世界类型</label><p style="margin:0;font-size:15px;">${world.type === "ip" ? "基于已有 IP / 小说" : "原创世界观"}</p></div>` : ""}
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
    const tabs = [
        { key: "profile", label: "属性" },
        { key: "background", label: "背景" },
        { key: "state", label: "状态" },
        { key: "relations", label: "关系" },
        { key: "items", label: "物品" }
    ];
    if (schema.has_skills) {
        tabs.push({ key: "skills", label: schema.skill_label || "技能" });
    }
    // ★ B2：仅当世界定义了玩家变量时才显示「变量」页签（默认空世界不出现数字压力）
    if (getEnabledVariables(S.currentWorld).length) {
        tabs.push({ key: "variables", label: "变量" });
    }
    tabs.push({ key: "goals", label: "目标" });
    tabs.push({ key: "memory", label: "记忆" });
    tabs.push({ key: "timeline", label: "时间线" });

    document.getElementById("statusTabs").innerHTML = tabs.map(t => `
        <button class="status-tab ${S.currentStatusTab === t.key ? "active" : ""}" data-action="switchStatusTab" data-key="${t.key}">${t.label}</button>
    `).join("");
}

export function switchStatusTab(tab) {
    S.currentStatusTab = tab;
    renderStatusTabs();
    renderStatusPanel(tab);
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
                        ${Object.entries(s.attributes).map(([k, v]) => renderTextAttribute(getAttributeLabel(k), v)).join("")}
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">${escapeHtml(schema.progression_label || "进度")}</div>
                    <div class="status-card">
                        <div class="row"><span class="label">${escapeHtml(schema.progression_path_label || "路线")}</span><span class="value">${escapeHtml(s.progression.path)}</span></div>
                        <div class="row"><span class="label">${escapeHtml(schema.progression_label || "等级")}</span><span class="value">${escapeHtml(s.progression.rank)}</span></div>
                        <div class="row"><span class="label">进度</span><span class="value">${s.progression.progress}</span></div>
                        <div class="stat-bar"><div style="width:${Math.min(s.progression.progress, 100)}%"></div></div>
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
            const sorted = [...records].sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return (b.importance || 3) - (a.importance || 3);
            });
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">行为记忆 · ${records.length}/100</div>
                    <div class="memory-hint">AI 记录的角色经历。★越多越重要（会被优先注入叙事上下文）。</div>
                    <div class="memory-actions" style="margin:8px 0 12px;">
                        <button class="mem-act" data-action="exportMemoryPack">导出记忆包</button>
                        <button class="mem-act" data-action="triggerMemoryPackImport">导入记忆包</button>
                    </div>
                    ${sorted.length ? sorted.map(r => `
                        <div class="memory-card ${r.pinned ? 'pinned' : ''}">
                            <div class="memory-header">
                                <span class="memory-type type-${escapeHtml(r.type || 'other')}">${escapeHtml(MEMORY_TYPE_LABELS[r.type] || (r.type || '其他'))}</span>
                                <span class="memory-stars">${'★'.repeat(r.importance || 3)}${'☆'.repeat(5 - (r.importance || 3))}</span>
                                <span class="memory-time">${escapeHtml(r.time || '')}</span>
                            </div>
                            <div class="memory-body">${escapeHtml(r.text || '')}</div>
                            ${r.location ? `<div class="memory-meta">📍 ${escapeHtml(r.location)}</div>` : ''}
                            ${(r.npcs || []).length ? `<div class="memory-meta">👤 ${(r.npcs || []).slice(0, 5).map(n => escapeHtml(n)).join(', ')}${(r.npcs || []).length > 5 ? '…' : ''}</div>` : ''}
                            <div class="memory-actions">
                                <button class="mem-act" data-action="togglePinMemory" data-id="${escapeHtml(r.id || '')}">${r.pinned ? '📌 取消置顶' : '📌 置顶'}</button>
                                <button class="mem-act danger" data-action="deleteMemory" data-id="${escapeHtml(r.id || '')}">🗑 删除</button>
                            </div>
                        </div>
                    `).join("") : '<div class="empty-hint">暂无行为记忆。开始游玩后，AI 会把重要事件记录在这里。</div>'}
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
                </div>`;
            break;
        }
    }
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
    if (!S.gameState || !S.gameState.inventory.length) return text;
    const names = S.gameState.inventory.map(i => i.name).filter(n => n);
    if (!names.length) return text;
    // 按名称长度降序，避免短名先替换导致长名无法匹配
    names.sort((a, b) => b.length - a.length);
    let html = escapeHtml(text);
    for (const name of names) {
        const regex = new RegExp(escapeRegExp(escapeHtml(name)), "g"); // 先 HTML 转义以匹配已转义文本，再转义正则元字符
        html = html.replace(regex, `<span class="item-highlight">${escapeHtml(name)}</span>`);
    }
    return html;
}

/**
 * 把剧情文本渲染为带段落结构的 HTML。
 * - 按空行（\n\n）拆分为独立段落 <p>，段间距由 CSS 的 `p + p` 规则控制；
 * - 段落内的单个换行保留为 <br>，避免被浏览器折叠；
 * - 物品高亮（highlightItems）在转义后生效，且高亮不会破坏已插入的 <br>。
 * 注意：highlightItems 内部会先 escapeHtml，\n 不会被转义，故可在其后安全替换。
 */
export function renderNarrative(text, isWarning) {
    if (isWarning) return escapeHtml(text || "");
    const blocks = (text || "")
        .split(/\n{2,}/)
        .map(b => b.trim())
        .filter(b => b.length);
    if (!blocks.length) return escapeHtml(text || "");
    return blocks
        .map(b => `<p>${highlightItems(b).replace(/\n/g, "<br>")}</p>`)
        .join("");
}

export function renderLog(reset) {
    const log = document.getElementById("gameLog");
    if (reset) { S.renderedEntryCount = 0; log.innerHTML = '<div class="choices-row in-log" id="choicesArea"></div>'; }

    // 只追加新增的条目
    for (let i = S.renderedEntryCount; i < S.conversationHistory.length; i++) {
        const entry = S.conversationHistory[i];
        const warningClass = entry.isWarning ? " warning" : "";
        const metaLabel = entry.isWarning
            ? "系统提示"
            : (entry.player ? "你" : "开场");
        const html = `
        <div class="log-entry${warningClass}">
            <div class="meta">
                <span>${metaLabel} · ${escapeHtml(entry.tcd ? formatTimeLabel(entry.tcd, getTimeConfig().timeConfig) : formatTimeShort(entry.day, entry.period, entry.clock))}</span>
            </div>
            ${entry.player ? `<div class="player-text">${escapeHtml(entry.player)}</div>` : ""}
            <div class="narrative">${renderNarrative(entry.narrative, entry.isWarning)}</div>
            ${entry.atmosphere ? `<div class="log-whisper"><span>◈ ${escapeHtml(entry.atmosphere)}</span></div>` : ""}
            ${renderTurnChanges(entry)}
        </div>
        `;
        log.insertBefore(createElementFromHTML(html), document.getElementById("choicesArea"));
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

// ★ 实时流式：把模型正在生成的叙事（部分文本）直接写进指定日志条目的 .narrative，
// 让玩家在模型边生成边看到文字（首字延迟从「整段生成完」降到约 1~2 秒）。
export function updateLiveNarrative(index, text) {
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
    removeEntryDOMOnly(index);
    if (S.conversationHistory.length > index) S.conversationHistory.splice(index, 1);
}

// ★ 实时流式：用最新数据重渲染指定条目（提交为格式化叙事 + 氛围提示）。
// 先移除旧 DOM，再让 renderLog 从该下标重新追加（该下标之后通常无其它条目）。
// 注意：这里只能删 DOM、不能动数组——若误用 removeLogEntry 会把刚定稿的回合从
// conversationHistory 里删掉，导致剧情数据丢失（processTurn 集成测试抓到的 bug）。
export function replaceEntryDOM(index) {
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

            // 标点处停顿，更接近阅读节奏（P0 提速：整体更紧凑，避免整段打完再叠加十几秒）
            let delay = 12;
            if ("。！？…".includes(ch)) delay = 70;
            else if ("，、；：".includes(ch)) delay = 35;
            else if (ch === "\n") delay = 45;
            else if (ch === "「" || ch === "」" || ch === '"' ) delay = 25;
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

export function showGameOver() {
    const reason = S.gameState && S.gameState.death_reason ? S.gameState.death_reason : "你的旅程到此为止。";
    document.getElementById("gameOverReason").textContent = reason;
    document.getElementById("gameOverOverlay").classList.add("show");
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
