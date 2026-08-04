// ============================================================
// W2-Style · 创建向导编辑器逻辑（src/wizard-editor.js）
// ------------------------------------------------------------
// 把"创建世界"从 4 步弹窗升级为编辑器式长页：
//   - 左侧 6 模块导航（基本信息 / 叙事风格 / 世界观 / 玩法模块 / 时间系统 / 生成设置）
//   - 叙事风格模块接入 12 个风格模板库卡片，选中即自动填写叙事文风 + 推荐温度 + 结构化标签
//   - 玩家可在此基础上自由改写风格与温度（运行时不可改，详见 docs/52 §4.7）
//   - 世界观模块提供"前往编辑知识库"入口（复用 lore-ui 的 editWorldLore）
//
// 本文件只管"编辑态"逻辑；字段读取沿用 render.js 既有函数（collectStylePrefs 等）。
// ============================================================
import { STYLE_PRESETS, getStylePreset, emptyCustomPreset } from "./style-presets.js";
import { MODULE_REGISTRY } from "./modules.js";
import { showToast, collectStylePrefs, updateWorldTempLabel, resetStylePrefs } from "./render.js";
import { editWorldLore } from "./lore-ui.js";
import { S } from "./store.js";

// 当前选中的模板 ID（null = 自定义风格）
let selectedTemplateId = null;

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- 模块导航 ----------
export function selectCwModule(module) {
    document.querySelectorAll("#createWorldModal .cw-nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.module === module);
    });
    document.querySelectorAll("#createWorldModal .cw-module").forEach(s => {
        s.classList.toggle("active", s.dataset.module === module);
    });
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
    const sel = document.getElementById("timePreset");
    const v = sel ? sel.value : "auto";
    return { key: v, hint: TIME_PRESET_DESC[v] || "" };
}

// ---------- 世界书（知识库）入口 ----------
export function openWorldBookFromWizard() {
    if (S.editingWorldId) {
        editWorldLore(S.editingWorldId);
        return;
    }
    showToast("世界生成时将自动抽取并写入知识库；生成后可在「世界详情 → 编辑知识库」查看与修改。", "info");
}

// ---------- 重置 / 初始化 ----------
export function resetCreateWizard() {
    selectedTemplateId = null;
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
}

// 打开创建向导时一次性初始化（模板库 + 模块开关 + 默认模块）
export function initCreateWizardDOM() {
    initStyleTemplateGrid();
    initModuleToggles();
}

// 叙事文风文本框实时字数提示
export function updateNarrativeStyleCount() {
    const ta = document.getElementById("narrativeStyle");
    const cnt = document.getElementById("narrativeStyleCount");
    if (ta && cnt) cnt.textContent = ta.value.length + " 字";
}
