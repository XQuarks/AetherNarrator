// ============================================================
// 创建向导编辑器逻辑（src/wizard-editor.js）
// ------------------------------------------------------------
// ★ docs/62：编辑器式长页 → 6 步分步向导（顶部步骤条 + 上一步/下一步/跳过 + 末步摘要）：
//   0 世界设定(必填) → 1 叙事风格 → 2 叙事视角 → 3 玩法时间 → 4 角色资源 → 5 确认生成
//   - 叙事风格步接入 12 个风格模板库卡片，选中即自动填写叙事文风 + 推荐温度 + 结构化标签
//   - 玩家可在此基础上自由改写风格与温度（运行时不可改，详见 docs/52 §4.7）
//   - 知识库在世界生成时自动抽取；生成后可在「世界详情 → 编辑知识库」修改（lore-ui.editWorldLore）
//
// 本文件只管"编辑态"逻辑；字段读取沿用 render.js 既有函数（collectStylePrefs 等）。
// ============================================================
import { STYLE_PRESETS, getStylePreset, emptyCustomPreset } from "./style-presets.js";
import { MODULE_REGISTRY } from "./modules.js";
import { collectStylePrefs, updateWorldTempLabel, resetStylePrefs, showToast, isSourceFileUploaded } from "./render.js";
import { initWizardContainers, resetWizardContainers, refreshWizardContainers, renderValidationPanel, getWizardContainers } from "./wizard-containers.js"; // ★ docs/60：创建向导容器前置平台；★ docs/61：模块/pov 联动
// ★ docs/59：创建向导完整时间系统编辑器（独立命名空间，避免污染详情页 S.currentWorld）
import { initWizardTime, resetWizardTime, getWizardTimeConfig, buildTimeConfigPrompt, renderWizardTimeEditor } from "./wizard-time.js";
export { initWizardTime, resetWizardTime, getWizardTimeConfig, buildTimeConfigPrompt, renderWizardTimeEditor };

// 当前选中的模板 ID（null = 自定义风格）
let selectedTemplateId = null;

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 步骤向导导航（★ docs/62：编辑器式长页 → 6 步分步向导） ----------
// 步骤结构（与 index.html 中 .wz-pane[data-step] 一一对应）：
//   0 世界设定（必填步）/ 1 叙事风格 / 2 叙事视角 / 3 玩法时间 / 4 角色资源 / 5 确认生成
// 规则：
//   - 步骤条只读状态由 wizardStep（当前步）与 wizardMaxReached（最远到达步）派生；
//   - 仅 i <= wizardMaxReached 的步骤可点击回跳/查看，保证填写顺序正确（不可越过未到的步骤）；
//   - 第 1 步（世界设定）点「下一步」时做必填校验（与 game.js generateWorld 同规则）；
//   - 2~5 步均可跳过（有默认值）；进入末步时实时生成配置摘要。
export const WIZARD_STEPS = [
    { key: "basic",   name: "世界设定", skippable: false },
    { key: "style",   name: "叙事风格", skippable: true },
    { key: "pov",     name: "叙事视角", skippable: true },
    { key: "modules", name: "玩法时间", skippable: true },
    { key: "preset",  name: "角色资源", skippable: true },
    { key: "confirm", name: "确认生成", skippable: false },
];
let wizardStep = 0;
let wizardMaxReached = 0;

export function currentWizardStep() { return wizardStep; }

// 渲染顶部步骤条（已完成步骤打勾、可点击回跳；校验徽标由 wizard-containers.updateNavBadges 注入）
export function renderWizardStepsBar() {
    const bar = document.getElementById("wzStepsBar");
    if (!bar) return;
    bar.innerHTML = "";
    WIZARD_STEPS.forEach((s, i) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "wz-step-node" + (i === wizardStep ? " active" : "") + (i < wizardStep ? " done" : "");
        node.dataset.step = String(i);
        if (i <= wizardMaxReached && i !== wizardStep) {
            node.classList.add("clickable");
            node.dataset.action = "wizardGotoStep";
        }
        node.innerHTML =
            `<span class="wz-dot">${i < wizardStep ? "✓" : i + 1}</span>` +
            `<span class="wz-step-name">${s.name}</span>`;
        bar.appendChild(node);
        if (i < WIZARD_STEPS.length - 1) {
            const line = document.createElement("span");
            line.className = "wz-line" + (i < wizardStep ? " done" : "");
            bar.appendChild(line);
        }
    });
}

// 跳到指定步骤（受 wizardMaxReached 限制，禁止跳到未到达的步骤）
export function gotoWizardStep(i) {
    const last = WIZARD_STEPS.length - 1;
    const step = Math.max(0, Math.min(last, parseInt(i, 10) || 0));
    if (step > wizardMaxReached) return;
    wizardStep = step;
    document.querySelectorAll("#createWorldModal .wz-pane").forEach(p => {
        p.classList.toggle("active", parseInt(p.dataset.step, 10) === step);
    });
    renderWizardStepsBar();
    updateWizardFooter();
    if (step === last) renderWizardSummary();
    // 校验面板按步骤降噪（仅末步或有 error 时显示完整面板，见 wizard-containers.renderValidationPanel）
    renderValidationPanel();
}

// 第 1 步必填校验：与 game.js generateWorld 同规则（名称必填；描述或源文件至少一项）
function validateStep0() {
    const nameEl = document.getElementById("worldName");
    if (!nameEl || !nameEl.value.trim()) {
        showToast("请填写世界名称", "error");
        return false;
    }
    const descEl = document.getElementById("worldDesc");
    if ((!descEl || !descEl.value.trim()) && !isSourceFileUploaded()) {
        showToast("请填写世界观描述，或上传小说源文件（二者至少一项）", "error");
        return false;
    }
    return true;
}

export function wizardNextStep() {
    if (wizardStep === 0 && !validateStep0()) return;
    wizardMaxReached = Math.max(wizardMaxReached, wizardStep + 1);
    gotoWizardStep(wizardStep + 1);
}

export function wizardPrevStep() {
    gotoWizardStep(wizardStep - 1);
}

export function wizardSkipStep() {
    const s = WIZARD_STEPS[wizardStep];
    if (!s || !s.skippable) return;
    wizardMaxReached = Math.max(wizardMaxReached, wizardStep + 1);
    gotoWizardStep(wizardStep + 1);
}

// 底部导航按钮显隐：第 1 步显示「取消」；末步显示「确认生成」；可跳过步骤显示「跳过」
function updateWizardFooter() {
    const last = WIZARD_STEPS.length - 1;
    const toggle = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? "" : "none"; };
    toggle("wzCancelBtn", wizardStep === 0);
    toggle("wzPrevBtn", wizardStep > 0);
    toggle("wzSkipBtn", wizardStep !== last && WIZARD_STEPS[wizardStep].skippable);
    toggle("wzNextBtn", wizardStep !== last);
    toggle("generateWorldBtn", wizardStep === last);
}

// 末步配置摘要（实时读取表单当前值；每张卡可点「修改」回跳对应步骤）
function renderWizardSummary() {
    const box = document.getElementById("wzSummary");
    if (!box) return;
    const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || "").trim() : ""; };
    const name = val("worldName");
    const ip = val("ipName");
    const srcText = ip ? `参考作品：${ip}` : (isSourceFileUploaded() ? "基于上传的源文件（原创世界）" : "完全原创");
    const styleTag = (document.getElementById("styleCurrentTag") || {}).textContent || "未选择";
    const temp = val("worldTemp") || "0.7";
    const pov = ((document.querySelector("input[name='povMode']:checked") || {}).value === "ensemble") ? "群像剧" : "单人主角";
    const freedomText = ((document.getElementById("plotFreedomLabel") || {}).textContent || "").split("—")[0].trim();
    let modOn = 0, modTotal = 0;
    document.querySelectorAll("#moduleToggles .module-cb").forEach(cb => { modTotal++; if (cb.checked) modOn++; });
    const timeCb = document.querySelector("#moduleToggles .module-cb[data-module='time']");
    const timeSel = document.getElementById("timePreset");
    const timeOff = timeCb && !timeCb.checked;
    const timeText = timeOff ? "未开启时间系统模块" : (timeSel && timeSel.options[timeSel.selectedIndex] ? timeSel.options[timeSel.selectedIndex].textContent : "自动");
    let presetText = "未预置，由 AI 自动补齐";
    try {
        const wc = getWizardContainers();
        const filled = wc && wc.locked ? wc.locked.size : 0;
        if (filled > 0) presetText = `已预置 ${filled} 类（将作为世界权威设定）`;
    } catch (e) { /* 摘要读取失败不阻塞流程 */ }
    const wpOn = ((document.querySelector("input[name='worldPrefixEnable']:checked") || {}).value === "on");
    const cpOn = ((document.querySelector("input[name='customPrefixEnable']:checked") || {}).value === "on");
    const prefixText = (wpOn || cpOn) ? [wpOn ? "世界观生成" : "", cpOn ? "对话" : ""].filter(Boolean).join(" + ") : "无";
    const item = (k, v, step, empty) =>
        `<div class="wz-sum-item"><div class="wz-sum-k">${esc(k)}<button type="button" class="wz-sum-edit" data-action="wizardGotoStep" data-step="${step}">修改</button></div>` +
        `<div class="wz-sum-v${empty ? " empty" : ""}">${esc(v)}</div></div>`;
    box.innerHTML =
        item("世界名称", name || "（未填写）", 0, !name) +
        item("世界来源", srcText, 0, false) +
        item("叙事风格", `${styleTag} · 温度 ${temp}`, 1, false) +
        item("视角 / 自由度", `${pov} · ${freedomText || "默认"}`, 2, false) +
        item("玩法模块", `已开启 ${modOn}/${modTotal} 项`, 3, false) +
        item("时间系统", timeText, 3, timeOff) +
        item("角色与资源预设", presetText, 4, presetText.indexOf("未预置") === 0) +
        item("特殊要求", prefixText, 5, prefixText === "无");
}

// ---------- 风格模板库 ----------
export function initStyleTemplateGrid() {
    const grid = document.getElementById("styleTemplateGrid");
    if (!grid) return;
    grid.innerHTML = "";
    STYLE_PRESETS.forEach(p => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "style-card";
        card.dataset.preset = p.preset_id;
        card.dataset.action = "selectStyleTemplate";
        card.innerHTML =
            `<div class="style-card-name">${esc(p.name)}</div>` +
            `<div class="style-card-tag">${esc(p.short_tag)}</div>` +
            `<div class="style-card-temp">推荐温度 ${p.recommended_temperature}</div>`;
        grid.appendChild(card);
    });
    // 自定义卡片（清空模板、自由书写）
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "style-card style-card-custom";
    custom.dataset.preset = "";
    custom.dataset.action = "selectStyleTemplate";
    custom.innerHTML =
        `<div class="style-card-name">✍ 自定义风格</div>` +
        `<div class="style-card-tag">自由书写</div>` +
        `<div class="style-card-temp">自定温度</div>`;
    grid.appendChild(custom);
    // 默认收起（只露前两行），由「展开全部模板」按钮放全
    grid.classList.add("collapsed");
    const tBtn = document.getElementById("styleGridToggle");
    if (tBtn) tBtn.textContent = "展开全部模板 ▾";
}

// 风格模板库：收起/展开切换（默认收起，减少首屏高度）
export function toggleStyleGridExpand() {
    const grid = document.getElementById("styleTemplateGrid");
    const btn = document.getElementById("styleGridToggle");
    if (!grid) return;
    const collapsed = grid.classList.toggle("collapsed");
    if (btn) btn.textContent = collapsed ? "展开全部模板 ▾" : "收起模板库 ▴";
}

// 选中某模板：自动填写 叙事文风 + 推荐温度 + 结构化标签；玩家之后可自由改写。
export function selectStyleTemplate(presetId) {
    selectedTemplateId = (presetId || "") ? presetId : null;
    document.querySelectorAll("#styleTemplateGrid .style-card").forEach(c => {
        c.classList.toggle("selected", c.dataset.preset === (selectedTemplateId || ""));
    });
    const ta = document.getElementById("narrativeStyle");
    const temp = document.getElementById("worldTemp");
    const topTag = document.getElementById("styleCurrentTag");

    if (!selectedTemplateId) {
        // 自定义：保留玩家已写文本，仅把来源标记为自定义
        if (topTag) topTag.textContent = "自定义风格";
        return;
    }
    const p = getStylePreset(selectedTemplateId) || emptyCustomPreset();
    // 套用模板即覆盖叙事文风与温度
    if (ta) ta.value = p.narrative_style || "";
    if (temp) { temp.value = String(p.recommended_temperature); updateWorldTempLabel(); }
    // 预填结构化标签（题材/主题/口味/视角/文风）
    applyTemplateTags(p);
    if (topTag) topTag.textContent = p.short_tag || "自定义";
}

// 把模板的结构化标签预填进既有的 tag 行
function applyTemplateTags(p) {
    setSingleTag("genre", p.genre);
    setMultiTag("tropes", p.tropes);
    setSingleTag("taste", p.taste);
    setSingleTag("pov", p.pov);
    setSingleTag("style", p.style);
    // custom_tag 不顺带清空（属于玩家专属标签）
}

function setSingleTag(pref, val) {
    const row = document.querySelector('.tag-row[data-pref="' + pref + '"]');
    if (!row) return;
    row.querySelectorAll(".tag-chip").forEach(c => c.classList.remove("selected"));
    if (!val) return;
    const chip = row.querySelector('.tag-chip[data-val="' + (typeof val === "string" ? val : "") + '"]');
    if (chip) chip.classList.add("selected");
}

function setMultiTag(pref, vals) {
    const row = document.querySelector('.tag-row[data-pref="' + pref + '"]');
    if (!row) return;
    const set = Array.isArray(vals) ? vals : [];
    row.querySelectorAll(".tag-chip").forEach(c => {
        c.classList.toggle("selected", set.includes(c.dataset.val));
    });
}

// 组装当前创建表单的 style_preset 对象（game.js 调用，serializeStylePreset 后再写入 world）
export function getStylePresetFromWizard() {
    const ta = document.getElementById("narrativeStyle");
    const temp = document.getElementById("worldTemp");
    const narrative = ta ? ta.value.trim() : "";
    const tags = collectStylePrefs(); // { genre, tropes, taste, pov, style, custom_tag }
    const recommended = temp ? parseFloat(temp.value) : NaN;
    const recTemp = Number.isFinite(recommended) ? recommended : 0.6;

    if (selectedTemplateId) {
        const p = getStylePreset(selectedTemplateId) || emptyCustomPreset();
        return {
            preset_id: p.preset_id,
            name: p.name,
            short_tag: p.short_tag,
            source: "template",
            narrative_style: narrative,
            genre: tags.genre,
            tropes: tags.tropes,
            taste: tags.taste,
            pov: tags.pov,
            style: tags.style,
            custom_tag: tags.custom_tag,
            recommended_temperature: recTemp,
            system_addendum: p.system_addendum || ""
        };
    }
    return {
        preset_id: "custom",
        name: "自定义风格",
        short_tag: "自定义",
        source: "custom",
        narrative_style: narrative,
        genre: tags.genre,
        tropes: tags.tropes,
        taste: tags.taste,
        pov: tags.pov,
        style: tags.style,
        custom_tag: tags.custom_tag,
        recommended_temperature: recTemp,
        system_addendum: ""
    };
}

// ---------- 玩法模块开关 ----------
export function initModuleToggles() {
    const box = document.getElementById("moduleToggles");
    if (!box) return;
    box.innerHTML = "";
    MODULE_REGISTRY.forEach(m => {
        // ip_scan 由世界是否填作品名自动决定，不在创建向导暴露（避免与 registry 默认逻辑冲突）
        if (m.id === "ip_scan") return;
        const row = document.createElement("label");
        row.className = "module-toggle";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "module-cb";
        cb.dataset.module = m.id;
        const onByDefault = (typeof m.defaultEnabled === "function") ? true : (m.defaultEnabled !== false);
        cb.checked = m.core ? true : onByDefault;
        if (m.core) cb.disabled = true; // 核心模块不可关
        const name = document.createElement("span");
        name.className = "module-name";
        name.textContent = m.name;
        if (m.core) {
            const badge = document.createElement("span");
            badge.className = "module-core-badge";
            badge.textContent = "核心";
            name.appendChild(badge);
        }
        const desc = document.createElement("span");
        desc.className = "module-desc";
        desc.textContent = m.desc;
        row.appendChild(cb);
        row.appendChild(name);
        row.appendChild(desc);
        box.appendChild(row);
    });
    // ★ docs/61：模块开关变化 → 刷新容器显隐（门禁）+ 时间系统门禁 + 校验面板
    box.addEventListener("change", (e) => {
        if (!e.target.classList.contains("module-cb")) return;
        refreshWizardContainers();
        refreshTimeGate();
        renderValidationPanel();
    });
    // ★ docs/61：pov（单人主角/群像剧）变化 → 同步选中高亮 + 刷新角色卡好感度字段显隐 + 校验
    document.querySelectorAll("#povGroup input[name='povMode']").forEach(r => {
        r.addEventListener("change", () => {
            syncPovHighlight();
            refreshWizardContainers();
            renderValidationPanel();
        });
    });
    refreshTimeGate();
}

// ★ docs/61：时间系统编辑区门禁 —— time 模块未开则隐藏编辑、显示占位提示
function refreshTimeGate() {
    const cb = document.querySelector("#moduleToggles .module-cb[data-module='time']");
    const on = !cb || cb.checked;
    const field = document.getElementById("timePresetField");
    const gate = document.getElementById("timePresetGate");
    if (field) field.style.display = on ? "" : "none";
    if (gate) gate.style.display = on ? "none" : "";
    renderWizardTimeEditor(); // ★ docs/59：模块开关变化同步重渲染向导时间编辑器（内部按 time 模块开关决定渲染/清空）
}

// 返回创建向导里勾选的模块开关对象 { moduleId: { enabled } }
export function getWizardModuleSettings() {
    const settings = {};
    document.querySelectorAll("#moduleToggles .module-cb").forEach(cb => {
        settings[cb.dataset.module] = { enabled: cb.checked };
    });
    return settings;
}

// ---------- 时间系统偏好 ----------
const TIME_PRESET_DESC = {
    auto: "",
    none: "时间系统：本世界不展示具体时间 / 日期。",
    day: "时间系统：按「第 N 天」推进（calendar_mode=day）。",
    gregorian: "时间系统：按公历月日 + 星期推进（calendar_mode=gregorian）。",
    lunar: "时间系统：按农历月日推进（calendar_mode=lunar）。",
    custom: "时间系统：使用自定义历法（年份纪元 + 自定义月日，calendar_mode=custom_calendar）。"
};

export function getWizardTimePreset() {
    // ★ docs/61：time 模块未开 → 不注入时间偏好（时间系统关闭）
    const cb = document.querySelector("#moduleToggles .module-cb[data-module='time']");
    if (cb && !cb.checked) return { key: "none", hint: "" };
    const sel = document.getElementById("timePreset");
    const v = sel ? sel.value : "auto";
    return { key: v, hint: TIME_PRESET_DESC[v] || "" };
}

// ---------- 世界书（知识库） ----------
// 创建向导内不再提供知识库入口：知识库在世界生成时自动抽取写入，
// 生成后可在「世界详情 → 编辑知识库」（lore-ui.editWorldLore）查看与修改。

// ---------- 叙事视角（pov）选中高亮同步 ----------
// HTML 里 .radio-option 的选中态靠 .selected 类呈现；原生 radio 的 :checked 变化不会自动同步该类，
// 必须在 pov 变化 / 表单重置时显式调用（修复：点「群像剧」高亮不移动、生成后高亮全灭的问题）。
export function syncPovHighlight() {
    document.querySelectorAll("#povGroup .radio-option").forEach(o => {
        const input = o.querySelector("input[name='povMode']");
        o.classList.toggle("selected", !!(input && input.checked));
    });
}

// ---------- 重置 / 初始化 ----------
export function resetCreateWizard() {
    selectedTemplateId = null;
    // ★ docs/62：步骤状态归位（回到第 1 步，清空"最远到达"记录）
    wizardStep = 0;
    wizardMaxReached = 0;
    renderWizardStepsBar();
    updateWizardFooter();
    document.querySelectorAll("#createWorldModal .wz-pane").forEach(p => {
        p.classList.toggle("active", p.dataset.step === "0");
    });
    const grid = document.getElementById("styleTemplateGrid");
    if (grid) grid.querySelectorAll(".style-card").forEach(c => c.classList.remove("selected"));
    const ta = document.getElementById("narrativeStyle");
    if (ta) ta.value = "";
    const topTag = document.getElementById("styleCurrentTag");
    if (topTag) topTag.textContent = "未选择";
    const tp = document.getElementById("timePreset");
    if (tp) tp.value = "auto";
    resetStylePrefs();
    initModuleToggles();
    resetWizardContainers(); // ★ docs/60：清空向导容器缓冲
    resetWizardTime(); // ★ docs/59：清空向导时间缓冲
    renderValidationPanel(); // ★ docs/61：重置后刷新校验面板
}

// 打开创建向导时一次性初始化（步骤条 + 模板库 + 模块开关 + 默认模块）
export function initCreateWizardDOM() {
    renderWizardStepsBar(); // ★ docs/62：渲染顶部步骤条
    updateWizardFooter();
    initStyleTemplateGrid();
    initModuleToggles();
    initWizardContainers(); // ★ docs/60：初始化创建向导容器平台
    initWizardTime(); // ★ docs/59：初始化创建向导时间编辑器（data-wtime 委托 + 渲染）
    renderValidationPanel(); // ★ docs/61：初始校验（此时各容器默认无内容，通常显示"通过"）
}

// 叙事文风文本框实时字数提示
export function updateNarrativeStyleCount() {
    const ta = document.getElementById("narrativeStyle");
    const cnt = document.getElementById("narrativeStyleCount");
    if (ta && cnt) cnt.textContent = ta.value.length + " 字";
}
