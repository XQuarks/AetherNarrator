// ============================================================
// AetherNarrator · lore-ui.js（由 game.js 拆分：知识库编辑 UI）
// 说明：聚合「知识库初览/编辑/修订 + 关联图谱」相关函数。
// 仅依赖 rag / render / store / utils / worldview / lore-revision / llm / prompt / save，
// 不反向依赖 game.js，避免循环引用。
// ============================================================
import { S, LINK_RELATION_LABELS, DEFAULT_TIME_CONFIG, normalizeTimeConfig } from "./store.js";
import { deepClone, escapeHtml, getWorldSchema, defaultWorldSchema, mergeLoreSnippets, detectTimeConflict, formatConflictMessage } from "./utils.js";
import { showModal, closeModal, showToast, getSelectedStyleRef } from "./render.js";
import { getWorldLoreKB, ensureLoreEmbeddings } from "./rag.js";
import { createOrUpdateSave, prepareSessionFromSave } from "./save.js";
import { saveWorlds } from "./storage.js";
import { isEnhancementContextCurrent } from "./worldview.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { markPromotedRecords } from "./promotion.js"; // ★ B6：晋升后标记原记忆 promoted
import { callLoreRevisionLLM, extractLoreFromSource, callRegenerateOpeningLLM } from "./llm.js";
import { invalidateSystemPromptCache } from "./prompt.js";
import { invalidateLoreAnn } from "./ann-index.js";
import { renderLoreMarkdown } from "./markdown.js"; // ★ 步骤 B：Obsidian 风 markdown 渲染封装
import { REL_COLORS, ENTITY_COLOR, buildGraphModel } from "./kg-graph.js"; // ★ Phase 4：知识图谱模型（纯函数）

// ★ B3：知识库初览与编辑面板 ------------------------------------------------

// 重渲染前先把 DOM 里的输入读回草稿，避免丢失未保存编辑
function syncLoreEditFromDOM() {
    if (!Array.isArray(S._loreEdit)) return;
    S._loreEdit.forEach((s, i) => {
        const g = (p) => document.getElementById(p + i);
        const title = g("le_title_"), cat = g("le_cat_"), content = g("le_content_");
        const keys = g("le_keys_"), mode = g("le_mode_"), pri = g("le_pri_"), depth = g("le_depth_"), links = g("le_links_"), pos = g("le_pos_");
        if (title) s.title = title.value;
        if (cat) s.category = cat.value;
        if (content) s.content = content.value;
        if (keys) s.activation_keys = keys.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
        if (mode) s.trigger_mode = mode.value;
        if (pos) s.insert_at = pos.value; // ★ P0-2：注入位置
        if (pri) s.priority = parseInt(pri.value) || 0;
        if (depth) s.scan_depth = Math.max(1, Math.min(10, parseInt(depth.value) || 1));
        if (links) s.links = links.value.split(/[,，、\n]+/).map(part => {
            const [target, relation = "related"] = part.split(":").map(x => x.trim());
            return target ? { target, relation } : null;
        }).filter(Boolean);
    });
}

// 质量校验：空标题 / 内容过短 / 触发词跨条重复
function checkLoreQuality(list) {
    const warns = [];
    const keyCount = {};
    const ids = new Set(list.map(s => s.id).filter(Boolean));
    const seenIds = new Set();
    list.forEach((s, i) => {
        const label = `#${i + 1} ${s.title || "(无标题)"}`;
        if (!s.title || !s.title.trim()) warns.push(`${label}：缺少标题`);
        if (!s.content || s.content.trim().length < 30) warns.push(`${label}：内容过短（<30 字），信息量可能不足`);
        if (!s.id || seenIds.has(s.id)) warns.push(`${label}：ID 缺失或重复`);
        if (s.id) seenIds.add(s.id);
        if (s.trigger_mode === "regex") {
            for (const key of s.activation_keys || []) {
                try { new RegExp(key); } catch (_) { warns.push(`${label}：正则触发词「${key}」无效`); }
            }
        }
        for (const link of s.links || []) if (!ids.has(link.target)) warns.push(`${label}：关联目标「${link.target}」不存在`);
        (s.activation_keys || []).forEach(k => {
            const kk = String(k).toLowerCase();
            if (kk) keyCount[kk] = (keyCount[kk] || 0) + 1;
        });
    });
    // 合并重复触发词：汇总为一条高频词提示（保留前若干高频词），避免海量重复刷屏
    const dupKeys = Object.entries(keyCount).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    if (dupKeys.length) {
        const SHOW = 12;
        const top = dupKeys.slice(0, SHOW).map(([k, n]) => `${k}(${n})`);
        let line = `触发词重复：以下词在多条例目出现，可能过度触发（共 ${dupKeys.length} 个，显示前 ${top.length}）：${top.join("、")}`;
        if (dupKeys.length > SHOW) line += " …";
        warns.push(line);
    }
    return warns;
}

// ★ 步骤二：把"时间体系"作为知识库条目，在创建初览里正式呈现（AI 已按世界观判定，仅在创建世界时可调）
const CALENDAR_LABELS = { day: "按第 N 天推进", gregorian: "公历（月/日/星期）", lunar: "阴历（月/日）", custom_calendar: "自定义历法", none: "不显示日期" };
const CLOCK_LABELS = { period: "时段标签", none: "不显示时刻" }; // 已移除「具体时钟」：界面一律不显示具体小时，最多到时段粒度

function summarizeTimeConfig(cfg) {
    const c = normalizeTimeConfig(cfg);
    const parts = [];
    if (c.era_label) parts.push(`纪元：${c.era_label}`);
    parts.push(`历法：${CALENDAR_LABELS[c.calendar_mode] || c.calendar_mode}`);
    parts.push(`时钟：${CLOCK_LABELS[c.clock_mode] || c.clock_mode}`);
    if (c.season) parts.push(`季节：${c.season}`);
    if (c.weather) parts.push(`天气：${c.weather}`);
    parts.push(`界面显示：${c.show ? "开启" : "关闭"}`);
    return parts.join(" · ");
}

function renderTimeConfigSection(mode) {
    const cfg = normalizeTimeConfig((getWorldSchema(S.currentWorld) || {}).time_config);
    if (mode !== "world") {
        return `<div class="time-cfg-card">
            <div class="time-cfg-head">🌐 世界时间体系 <span class="time-cfg-lock">🔒 进入游戏后已锁定</span></div>
            <div class="time-cfg-summary">${escapeHtml(summarizeTimeConfig(cfg))}</div>
            <p class="time-cfg-hint">时间体系由 AI 在创建世界时自动判定，仅创建当次可调，游戏中不可实时修改。</p>
        </div>`;
    }
    const calOpts = Object.entries(CALENDAR_LABELS)
        .map(([v, t]) => `<option value="${v}"${cfg.calendar_mode === v ? " selected" : ""}>${t}</option>`).join("");
    const clkOpts = Object.entries(CLOCK_LABELS)
        .map(([v, t]) => `<option value="${v}"${cfg.clock_mode === v ? " selected" : ""}>${t}</option>`).join("");
    // S5-1：起始日期输入框（gregorian/lunar/custom_calendar 显示；day/none 隐藏）
    const TC_DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
    const showStart = TC_DATED_MODES.includes(cfg.calendar_mode);
    const cs = cfg.calendar_start || {};
    const startRow = showStart ? `
            <div class="form-group"><label>起始日期（年 / 月 / 日）</label>
                <div class="time-cfg-start-row">
                    <input id="tc_start_year" class="tc-num" type="number" min="1" max="9999" value="${cs.year != null ? cs.year : ""}" placeholder="年" data-action="timeConfigChanged" data-event="input">
                    <span class="tc-sep">/</span>
                    <input id="tc_start_month" class="tc-num" type="number" min="1" max="12" value="${cs.month != null ? cs.month : ""}" placeholder="月" data-action="timeConfigChanged" data-event="input">
                    <span class="tc-sep">/</span>
                    <input id="tc_start_date" class="tc-num" type="number" min="1" max="31" value="${cs.date != null ? cs.date : ""}" placeholder="日" data-action="timeConfigChanged" data-event="input">
                </div>
                <span class="time-cfg-start-hint">仅 dated 历法生效；留空则开局回退默认起点</span>
            </div>` : "";
    // S5-1：multiverse 各时间线起始日期走代码配置（见 docs/21），本基础档不提供 UI
    const multiverseHint = cfg.mode === "multiverse" ? `
            <div class="form-group time-cfg-multiverse"><span class="time-cfg-start-hint">🌐 本世界为双界穿梭（multiverse）。各时间线独立起始日期请在代码中配置（见 <code>docs/21</code> 进阶待办），本基础档暂不提供 UI。</span></div>` : "";
    return `<div class="time-cfg-card">
        <div class="time-cfg-head">🌐 世界时间体系 <span class="time-cfg-ai">⚙️ AI 已按世界观自动设定，可在此微调</span></div>
        <div class="time-cfg-grid">
            <div class="form-group"><label>纪元 / 年份</label><input id="tc_era" maxlength="40" value="${escapeHtml(cfg.era_label || "")}" placeholder="例如：大清乾隆年间" data-action="timeConfigChanged" data-event="input"></div>
            <div class="form-group"><label>历法</label><select id="tc_calendar" data-action="timeConfigChanged" data-event="change">${calOpts}</select></div>
            <div class="form-group"><label>时钟</label><select id="tc_clock">${clkOpts}</select></div>
            <div class="form-group"><label>季节</label><input id="tc_season" maxlength="10" value="${escapeHtml(cfg.season || "")}" placeholder="例如：仲春" data-action="timeConfigChanged" data-event="input"></div>
            <div class="form-group"><label>当前天气</label><input id="tc_weather" maxlength="20" value="${escapeHtml(cfg.weather || "")}" placeholder="例如：细雨"></div>
            <div class="form-group time-cfg-show"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="tc_show" style="width:auto;" ${cfg.show !== false ? "checked" : ""}><span>在界面显示世界时间</span></label></div>
            ${startRow}
            ${multiverseHint}
        </div>
        <p class="time-cfg-hint">此设定仅在创建本世界时可调整；进入游戏后将锁定，不可实时修改。</p>
        <div id="timeConflictBadge" class="time-conflict-badge" style="display:none;"></div>
        ${renderOpeningFixActions()}
    </div>`;
}

// ★ 步骤 B：三栏链状（Obsidian 风）知识库 UI
const CATEGORY_COLOR_SEED = ["#C9A87C", "#6496ff", "#64c864", "#ff6464", "#c8b464", "#b48cff", "#4fc9c9", "#ff9f64"];
function categoryColor(cat) {
    const s = String(cat || "补充");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return CATEGORY_COLOR_SEED[h % CATEGORY_COLOR_SEED.length];
}
function resolveTitleById(list, id) {
    const s = (list || []).find(x => x.id === id);
    return s ? (s.title || s.id) : null;
}

// 左：文件树（按类别分组）
function buildLoreTree(list, activeIdx) {
    if (!list.length) return `<div class="lore-tree-empty">暂无条目</div>`;
    const groups = {}; const order = [];
    list.forEach((s, i) => {
        const cat = s.category || "补充";
        if (!groups[cat]) { groups[cat] = []; order.push(cat); }
        groups[cat].push({ s, i });
    });
    return order.map(cat => `
        <div class="lore-tree-group">
            <div class="lore-tree-group-head"><span class="lore-tree-dot" style="background:${categoryColor(cat)}"></span>${escapeHtml(cat)} <span class="lore-tree-count">${groups[cat].length}</span></div>
            <div class="lore-tree-items">
                ${groups[cat].map(({ s, i }) => `
                    <div class="lore-tree-item${i === activeIdx ? " active" : ""}" data-idx="${i}">
                        <span class="lore-tree-title">${escapeHtml(s.title || "(无标题)")}</span>
                    </div>`).join("")}
            </div>
        </div>`).join("");
}

// 中：笔记面板（标题 / 正文 Markdown 预览↔编辑 / 属性侧栏）
function renderNotePanel(note, idx, spoilerClass) {
    const preview = S._loreNotePreview !== false;
    const mode = note.trigger_mode || (note.activation_keys && note.activation_keys.length ? "keyword" : "always");
    const pos = ["system", "author_note", "before_user", "after_user"].includes(note.insert_at) ? note.insert_at : "before_user";
    const modeOpts = ["keyword", "always", "regex"].map(v => `<option value="${v}"${mode === v ? " selected" : ""}>${v === "keyword" ? "关键词" : v === "always" ? "常驻" : "正则"}</option>`).join("");
    const posOpts = ["before_user", "after_user", "author_note", "system"].map(v => `<option value="${v}"${pos === v ? " selected" : ""}>${v === "before_user" ? "用户输入前" : v === "after_user" ? "用户输入后" : v === "author_note" ? "作者注" : "系统"}</option>`).join("");
    const catOpts = ["规则", "世界观", "地点", "人物", "事件", "物品", "势力", "冲突", "补充"].map(c => `<option value="${c}">${c}</option>`).join("");

    const contentArea = preview
        ? (S.loreSpoilerHidden
            ? `<div class="lore-md lore-spoiler">🔒 内容已隐藏（点击左上角「🔓 已显示全部」可查看）</div>`
            : `<div class="lore-md">${renderLoreMarkdown(note.content)}</div>`)
        : `<textarea id="le_content_${idx}" class="lore-note-textarea${spoilerClass}" placeholder="正文（支持 Markdown 与 [[双链]]，如 [[荣国府]]）">${escapeHtml(note.content || "")}</textarea>`;

    return `
        <div class="lore-note-head">
            <input id="le_title_${idx}" class="lore-note-title" value="${escapeHtml(note.title || "")}" placeholder="笔记标题">
            <input id="le_cat_${idx}" class="lore-note-cat" list="loreCatList" value="${escapeHtml(note.category || "")}" placeholder="类别">
            <datalist id="loreCatList">${catOpts}</datalist>
        </div>
        <div class="lore-note-toolbar">
            <button class="lore-tab${preview ? " active" : ""}" data-lore-tab="1">👁 预览</button>
            <button class="lore-tab${!preview ? " active" : ""}" data-lore-tab="0">✎ 编辑</button>
            <span class="lore-note-meta">#${idx + 1} · ID: ${escapeHtml(note.id || "—")}</span>
            <button class="btn-del" data-action="deleteLoreEntry" data-idx="${idx}">删除</button>
        </div>
        <div class="lore-note-body">${contentArea}</div>
        <div class="lore-props">
            <div class="lore-props-head">属性</div>
            <div class="lore-prop"><label>触发词</label><input id="le_keys_${idx}" class="lore-inp" value="${escapeHtml((note.activation_keys || []).join("，"))}" placeholder="逗号分隔，如：分院帽，帽子"></div>
            <div class="lore-prop"><label>触发模式</label><select id="le_mode_${idx}" class="lore-inp lore-sel">${modeOpts}</select></div>
            <div class="lore-prop"><label>注入位置</label><select id="le_pos_${idx}" class="lore-inp lore-sel">${posOpts}</select></div>
            <div class="lore-prop"><label>优先级</label><input id="le_pri_${idx}" class="lore-inp lore-pri" type="number" value="${Number(note.priority) || 0}"></div>
            <div class="lore-prop"><label>扫描深度</label><input id="le_depth_${idx}" class="lore-inp lore-pri" type="number" min="1" max="10" value="${Number(note.scan_depth) || 1}"></div>
            <div class="lore-prop lore-prop-wide"><label>关联（目标ID:关系，逗号分隔）</label><input id="le_links_${idx}" class="lore-inp" value="${escapeHtml((note.links || []).map(l => `${l.target}:${l.relation || 'related'}`).join('，'))}" placeholder="如：p001:causal，p002:related"></div>
        </div>`;
}

// 右：出链 + 反向链接（均按 links.id 解析到标题显示，可点击跳转）
function renderBacklinksPanel(note, list, idx) {
    const outs = (note.links || []).map(l => {
        const t = resolveTitleById(list, l.target);
        const ti = list.findIndex(s => s.id === l.target);
        const cls = ti >= 0 ? "lore-link-row" : "lore-link-row lore-link-missing";
        return `<div class="${cls}"${ti >= 0 ? ` data-open-idx="${ti}"` : ""}><span class="lore-link-rel">${LINK_RELATION_LABELS[l.relation] || l.relation || "相关"}</span><span class="lore-link-arrow">→</span><span class="lore-link-target">${escapeHtml(t || l.target)}</span></div>`;
    });
    const backs = list.map((s, i) => ({ s, i })).filter(({ s }) => (s.links || []).some(l => l.target === note.id));
    const backHtml = backs.map(({ s, i }) => `<div class="lore-link-row" data-open-idx="${i}"><span class="lore-link-target">${escapeHtml(s.title || s.id)}</span><span class="lore-link-arrow">→</span><span class="lore-link-rel">本条目</span></div>`);
    return `
        <div class="lore-back-head">出链 <span class="lore-back-count">${(note.links || []).length}</span></div>
        <div class="lore-back-list">${outs.length ? outs.join("") : `<div class="lore-back-empty">无出链</div>`}</div>
        <div class="lore-back-head">反向链接 <span class="lore-back-count">${backs.length}</span></div>
        <div class="lore-back-list">${backHtml.length ? backHtml.join("") : `<div class="lore-back-empty">暂无其他条目链向此处</div>`}</div>`;
}

// S5-1：从 DOM 读取"起始日期"三输入并写回 tc.calendar_start（仅 dated 历法生效；其余模式清空）。
// tc.calendar_mode 必须先已设置。输入不完整则置 null（开局由 ensureCurrentDate 兜底）。
function readCalendarStartFromDOM(tc) {
    const TC_DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
    if (!TC_DATED_MODES.includes(tc.calendar_mode)) { tc.calendar_start = null; return; }
    const yEl = document.getElementById("tc_start_year");
    const moEl = document.getElementById("tc_start_month");
    const dEl = document.getElementById("tc_start_date");
    if (!yEl || !moEl || !dEl) { tc.calendar_start = null; return; }
    const y = parseInt(yEl.value, 10);
    const mo = parseInt(moEl.value, 10);
    const d = parseInt(dEl.value, 10);
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d) && mo >= 1 && d >= 1) {
        tc.calendar_start = { year: y, month: Math.min(12, Math.max(1, mo)), date: Math.max(1, d) };
    } else {
        tc.calendar_start = null;
    }
}

// 切视图前把时间表单值写回 schema，避免 InnerHTML 重渲染丢失编辑
export function syncTimeConfigFromDOM() {
    if (!S._loreEditingWorldDefault) return;
    const era = document.getElementById("tc_era");
    if (!era) return;
    const tc = (S.currentWorld && S.currentWorld.schema && S.currentWorld.schema.time_config) || {};
    tc.era_label = era.value.trim().slice(0, 40);
    tc.calendar_mode = document.getElementById("tc_calendar")?.value || "day";
    readCalendarStartFromDOM(tc);
    tc.clock_mode = document.getElementById("tc_clock")?.value || "period";
    tc.season = document.getElementById("tc_season")?.value.trim().slice(0, 10);
    tc.weather = document.getElementById("tc_weather")?.value.trim().slice(0, 20);
    tc.show = !!document.getElementById("tc_show")?.checked;
    if (!S.currentWorld.schema) S.currentWorld.schema = {};
    S.currentWorld.schema.time_config = tc;
}

// S5-4：编辑卡时间冲突徽章实时刷新（只读 schema，不重渲染卡片，避免输入框丢焦点）
// 由 app.js 的 data-action="timeConfigChanged" 在改起始日期/历法/纪元/季节时调用。
export function updateTimeConflictBadge() {
    const el = document.getElementById("timeConflictBadge");
    if (!el) return;
    const actions = document.getElementById("openingFixActions");
    if (!S._loreEditingWorldDefault) {
        el.style.display = "none"; el.innerHTML = "";
        if (actions) actions.classList.remove("conflict");
        return;
    }
    const res = detectTimeConflict(S.currentWorld);
    if (!res.conflict) {
        el.style.display = "none"; el.innerHTML = "";
        if (actions) actions.classList.remove("conflict");
        return;
    }
    el.style.display = "";
    el.innerHTML = `⚠ 时间可能冲突：${escapeHtml(formatConflictMessage(res))}`;
    if (actions) actions.classList.add("conflict"); // S5-4'：冲突时高亮修复按钮组
}

// S5-4'：开场白时间修复按钮组（仅 world 模式卡片；当前世界已有开场白才可点）
function renderOpeningFixActions() {
    const hasOpening = !!(S.currentWorld && S.currentWorld.opening_narrative && S.currentWorld.opening_narrative.trim());
    const disabled = hasOpening ? "" : "disabled";
    const tip = hasOpening ? "" : "（当前世界尚未生成开场白）";
    return `<div id="openingFixActions" class="opening-fix-actions">
        <div class="opening-fix-title">开场白时间修复 <span class="opening-fix-tip">${escapeHtml(tip)}</span></div>
        <div class="opening-fix-btns">
            <button class="btn-secondary-sm" data-action="regenerateOpening" ${disabled}>🔄 重新生成开场白</button>
            <button class="btn-secondary-sm" data-action="convertOpeningToPlaceholders" ${disabled}>🏷 改成占位符版</button>
        </div>
        <div class="opening-fix-note">消耗一次 LLM API 调用；生成后预览 diff，确认才写回。</div>
    </div>`;
}

// S5-4' + S5-7：开场白时间冲突一键修复（regenerate | toPlaceholders）
export async function regenerateOpening(mode) {
    if (!S.currentWorld) { showToast("未找到当前世界", "warn"); return; }
    const oldOpening = S.currentWorld.opening_narrative;
    if (!oldOpening || !oldOpening.trim()) { showToast("当前世界没有可修复的开场白（可能尚未生成）", "warn"); return; }
    const newTimeConfig = (getWorldSchema(S.currentWorld) || {}).time_config;
    showToast("AI 正在生成修复后的开场白…", "info", 3000);
    try {
        const res = await callRegenerateOpeningLLM(S.currentWorld, newTimeConfig, oldOpening, mode);
        S._openingFixBuffer = { oldOpening, newOpening: res.newOpening, mode };
        renderOpeningFixModal();
        showModal("openingFixModal");
    } catch (e) {
        console.warn("S5-4' 开场白生成失败：", e && e.message);
        showToast("生成失败：" + (e && e.message || "未知错误"), "error");
    }
}

// 渲染开场白修复预览模态（旧 vs 新 diff）
export function renderOpeningFixModal() {
    const el = document.getElementById("openingFixBody");
    if (!el || !S._openingFixBuffer) return;
    const b = S._openingFixBuffer;
    const modeLabel = b.mode === "toPlaceholders" ? "改成占位符版" : "重新生成开场白";
    el.innerHTML = `
        <p class="muted">修复方式：<b>${escapeHtml(modeLabel)}</b>（消耗一次 LLM API 调用）</p>
        <div class="opening-diff">
            <div class="opening-diff-col"><div class="opening-diff-h">原开场白</div><pre class="opening-diff-old">${escapeHtml(b.oldOpening)}</pre></div>
            <div class="opening-diff-col"><div class="opening-diff-h">新开场白</div><pre class="opening-diff-new">${escapeHtml(b.newOpening)}</pre></div>
        </div>`;
}

// 确认写回：把新开场白写入世界，绝不静默覆盖
export function applyOpeningFix() {
    if (!S._openingFixBuffer || !S.currentWorld) { closeModal("openingFixModal"); return; }
    S.currentWorld.opening_narrative = S._openingFixBuffer.newOpening;
    S._openingFixBuffer = null;
    createOrUpdateSave();
    closeModal("openingFixModal");
    updateTimeConflictBadge();
    invalidateSystemPromptCache();
    showToast("开场白已更新！", "success");
}

// 丢弃修复建议
export function rejectOpeningFix() {
    S._openingFixBuffer = null;
    closeModal("openingFixModal");
    showToast("已丢弃本次开场白修复建议", "success");
}

// ★ 知识库视图（三栏）
function renderKBPane(list) {
    const revisionHint = S._loreRevisionBuffer
        ? `<div class="lore-warn" style="background:rgba(201,168,124,0.1);border-color:var(--primary)">
            <strong>AI 修订建议已就绪</strong>（更新 ${S._loreRevisionBuffer.updates?.length || 0} 条，新增 ${S._loreRevisionBuffer.additions?.length || 0} 条）
            <div style="margin-top:6px;display:flex;gap:8px;">
                <button class="btn primary" data-action="confirmLoreRevision" style="font-size:12px;padding:3px 12px;">✓ 应用修订</button>
                <button class="btn secondary" data-action="rejectLoreRevision" style="font-size:12px;padding:3px 12px;">✗ 丢弃</button>
            </div>
           </div>`
        : "";
    const warns = checkLoreQuality(list);
    const warnHtml = warns.length
        ? `<details class="lore-warn"><summary>⚠ 质量提示（${warns.length}）— 点击展开/收起</summary><ul>${warns.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></details>`
        : `<div class="lore-ok">✓ 未发现明显质量问题</div>`;
    const spoilerBtn = `<div class="spoiler-toggle" data-action="toggleLoreSpoiler">${S.loreSpoilerHidden ? "🔒 内容已隐藏（点击查看）" : "🔓 已显示全部"}</div>`;
    const spoilerClass = S.loreSpoilerHidden ? " lore-spoiler" : "";

    const tree = buildLoreTree(list, S._loreActiveIndex);
    const note = (S._loreActiveIndex >= 0 && list[S._loreActiveIndex]) ? list[S._loreActiveIndex] : null;
    const noteHtml = note ? renderNotePanel(note, S._loreActiveIndex, spoilerClass) : `<div class="lore-empty">请选择左侧笔记，或点上方「＋ 添加条目」新建。</div>`;
    const backHtml = note ? renderBacklinksPanel(note, list, S._loreActiveIndex) : "";

    return `
      <div class="lore-obsidian">
        <div class="lore-obs-toolbar">
            <input id="loreSearch" class="lore-search" value="${escapeHtml(S._loreSearchTerm || "")}" placeholder="🔍 搜索标题 / 内容…">
            <button class="btn-secondary-sm" data-action="addLoreEntry">＋ 添加条目</button>
        </div>
        ${spoilerBtn}
        ${revisionHint}
        ${warnHtml}
        <div class="lore-obs-cols">
            <details class="lore-col-aside lore-tree-wrap" open>
                <summary>📂 文件树（${list.length} 条）</summary>
                <aside class="lore-tree">${tree}</aside>
            </details>
            <section class="lore-note">${noteHtml}</section>
            <details class="lore-col-aside lore-backlinks-wrap"${note ? " open" : ""}>
                <summary>🔗 关联（出链 ${(note && note.links ? note.links.length : 0)} · 入链 ${list.filter(s => (s.links || []).some(l => note && l.target === note.id)).length}）</summary>
                <aside class="lore-backlinks">${backHtml}</aside>
            </details>
        </div>
      </div>`;
}

// ★ 图谱视图
function renderGraphPane() {
    return `
      <div class="lore-graph-pane">
        <div class="lore-graph-tools">
            <button class="btn-icon" data-graph="zoom-in" title="放大">＋</button>
            <button class="btn-icon" data-graph="zoom-out" title="缩小">－</button>
            <button class="btn-icon" data-graph="reset" title="复位视图">⟲</button>
            <span id="graphStats" class="graph-stats"></span>
        </div>
        <div class="lore-graph-canvas-wrap">
            <div id="loreGraph"></div>
            <div id="graphLegend" class="graph-legend"></div>
            <div id="graphInfo" class="graph-info"></div>
            <div id="graphPreview" class="graph-preview" hidden></div>
            <div class="graph-hint">滚轮缩放 · 拖空白平移 · 拖节点移动 · 单击节点查看</div>
        </div>
      </div>`;
}

function renderLoreReviewBody() {
    const body = document.getElementById("loreReviewBody");
    if (!body) return;
    syncTimeConfigFromDOM(); // 切视图前先把时间表单值写回 schema，避免重渲染丢失
    const list = S._loreEdit || [];
    if (S._loreActiveIndex == null || S._loreActiveIndex < 0 || S._loreActiveIndex >= list.length) {
        S._loreActiveIndex = list.length ? 0 : -1;
    }
    if (!S._loreView) S._loreView = "kb";

    const tabs = [
        ["kb", "📚 知识库"],
        ["graph", "🔗 图谱"],
        ["time", "🕰 时间体系"]
    ].map(([v, t]) => `<button class="lore-view-tab${S._loreView === v ? " active" : ""}" data-lore-view="${v}">${t}</button>`).join("");

    const timeForm = renderTimeConfigSection(S._loreEditingWorldDefault ? "world" : "save");
    let paneHtml, hiddenTime = "";
    if (S._loreView === "kb") {
        paneHtml = renderKBPane(list);
    } else if (S._loreView === "graph") {
        paneHtml = renderGraphPane();
    } else {
        paneHtml = `<div class="lore-time-pane">${timeForm}</div>`;
    }
    // 时间表单在任何视图都保留一份（隐藏）供保存时读取，避免切走视图丢失编辑
    if (S._loreView !== "time") {
        hiddenTime = `<div id="timeFormBackup" style="display:none">${timeForm}</div>`;
    }

    // 图谱视图时加宽弹窗
    const modal = document.getElementById("loreReviewModal");
    if (modal) modal.classList.toggle("modal-graph-wide", S._loreView === "graph");

    body.innerHTML = `
      <div class="lore-review-shell">
        <div class="lore-view-tabs">${tabs}</div>
        <div class="lore-view-pane lore-view-${S._loreView}">${paneHtml}</div>
      </div>
      ${hiddenTime}`;

    if (S._loreView === "kb") {
        wireNotePanel();
        filterLoreTree(S._loreSearchTerm || "");
    } else if (S._loreView === "graph") {
        setTimeout(mountGraphNow, 50);
    }
    updateTimeConflictBadge(); // S5-4：编辑卡首次渲染即展示既有冲突徽章
}

let _loreBodyDelegated = false;
function bindLoreBodyDelegation() {
    const body = document.getElementById("loreReviewBody");
    if (!body || _loreBodyDelegated) return;
    _loreBodyDelegated = true;
    body.addEventListener("click", (e) => {
        const vt = e.target.closest(".lore-view-tab");
        if (vt && vt.dataset.loreView) {
            S._loreView = vt.dataset.loreView;
            renderLoreReviewBody();
            return;
        }
        const treeItem = e.target.closest(".lore-tree-item");
        if (treeItem && treeItem.dataset.idx != null) {
            S._loreActiveIndex = parseInt(treeItem.dataset.idx, 10);
            renderLoreReviewBody();
            return;
        }
        const wl = e.target.closest(".wikilink");
        if (wl) { e.preventDefault(); openWikilink(wl.dataset.wikilink); return; }
        const openRow = e.target.closest("[data-open-idx]");
        if (openRow && openRow.dataset.openIdx !== "") {
            S._loreActiveIndex = parseInt(openRow.dataset.openIdx, 10);
            renderLoreReviewBody();
            return;
        }
        const tab = e.target.closest(".lore-tab");
        if (tab) {
            S._loreNotePreview = tab.dataset.loreTab === "1";
            renderLoreReviewBody();
            return;
        }
    });
}

// 当前笔记表单实时写回 S._loreEdit[activeIdx]，避免整页重渲染丢焦点/数据
function wireNotePanel() {
    const i = S._loreActiveIndex;
    const list = S._loreEdit || [];
    if (i == null || i < 0 || !list[i]) return;
    const s = list[i];
    const on = (id, ev, fn) => { const el = document.getElementById(id + i); if (el) el.addEventListener(ev, fn); };
    on("le_title_", "input", (e) => {
        s.title = e.target.value;
        const row = document.querySelector('.lore-tree-item[data-idx="' + i + '"] .lore-tree-title');
        if (row) row.textContent = s.title || "(无标题)";
    });
    on("le_cat_", "input", (e) => { s.category = e.target.value; });
    on("le_content_", "input", (e) => { s.content = e.target.value; });
    on("le_keys_", "input", (e) => { s.activation_keys = e.target.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean); });
    on("le_mode_", "change", (e) => { s.trigger_mode = e.target.value; });
    on("le_pos_", "change", (e) => { s.insert_at = e.target.value; });
    on("le_pri_", "input", (e) => { s.priority = parseInt(e.target.value) || 0; });
    on("le_depth_", "input", (e) => { s.scan_depth = Math.max(1, Math.min(10, parseInt(e.target.value) || 1)); });
    on("le_links_", "input", (e) => {
        s.links = e.target.value.split(/[,，、\n]+/).map(part => {
            const [target, relation = "related"] = part.split(":").map(x => x.trim());
            return target ? { target, relation } : null;
        }).filter(Boolean);
        const back = document.querySelector(".lore-backlinks"); // 出链变化即时反映到右栏
        if (back) back.outerHTML = renderBacklinksPanel(s, list, i);
    });
    const search = document.getElementById("loreSearch");
    if (search) search.addEventListener("input", (e) => { S._loreSearchTerm = e.target.value; filterLoreTree(S._loreSearchTerm); });
}

function filterLoreTree(term) {
    const t = (term || "").trim().toLowerCase();
    document.querySelectorAll(".lore-tree-item").forEach(row => {
        const title = (row.querySelector(".lore-tree-title")?.textContent || "").toLowerCase();
        row.style.display = (!t || title.includes(t)) ? "" : "none";
    });
}

// 正文 [[双链]] 点击：按标题或 id 解析到条目并打开
function openWikilink(token) {
    const t = decodeURIComponent(token || "").trim();
    if (!t) return;
    const list = S._loreEdit || [];
    let idx = list.findIndex(s => (s.title || "").trim() === t);
    if (idx < 0) idx = list.findIndex(s => (s.id || "") === t);
    if (idx >= 0) { S._loreActiveIndex = idx; S._loreNotePreview = true; renderLoreReviewBody(); }
    else showToast(`未找到笔记：「${t}」`, "warn");
}

export function openLoreReview(mode = "save", focusId = null) {
    if (!S.currentWorld) { showToast("请先选择一个世界", "warn"); return; }
    S._loreEditingWorldDefault = mode === "world";
    S._loreView = "kb"; // 每次打开默认进入知识库视图
    const title = document.getElementById("loreReviewModalTitle");
    if (title) title.textContent = mode === "world" ? "默认知识库" : "当前存档知识库（Obsidian 风）";
    // ★ 步骤二：时间体系已作为卡片直接渲染在初览面板顶部（renderTimeConfigSection）；world 模式可编辑，save 模式只读锁定
    if (!S.activeLoreKB) S.activeLoreKB = { ip: "", snippets: [] };
    if (!Array.isArray(S.activeLoreKB.snippets)) S.activeLoreKB.snippets = [];
    S._loreEdit = deepClone(S.activeLoreKB.snippets); // 深拷贝到缓冲，取消不影响原数据
    if (focusId) {
        const fi = S._loreEdit.findIndex(s => s.id === focusId);
        S._loreActiveIndex = fi >= 0 ? fi : (S._loreEdit.length ? 0 : -1);
    } else {
        S._loreActiveIndex = S._loreEdit.length ? 0 : -1;
    }
    S._loreNotePreview = true;
    S._loreSearchTerm = "";
    bindLoreBodyDelegation();
    renderLoreReviewBody();
    // ★ Phase 3：无源文档时禁用「从源文档补抽」按钮
    const exBtn = document.getElementById("extractSourceBtn");
    if (exBtn) exBtn.disabled = !(S.currentWorld && S.currentWorld.source_content);
    showModal("loreReviewModal");
}

// 从世界详情进入编辑（指定世界 id）
export function editWorldLore(worldId) {
    const w = S.worlds.find(x => x.id === worldId);
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    S.activeLoreKB = deepClone(w.lore_kb || { ip: w.name || "", snippets: [] });
    closeModal("worldDetailModal");
    openLoreReview("world");
}

// 从存档详情进入：载入该存档会话（不跳转游戏），打开知识库编辑器（save 模式）
// 保存走既有 saveLoreReview → createOrUpdateSave，自动写回该存档独立副本
export function editSaveLore(saveId) {
    const stored = S.saves.find(s => s.id === saveId);
    const save = stored || null;
    if (!save) { showToast("未找到该存档", "error"); return; }
    prepareSessionFromSave(save); // 灌入运行时（含 S.activeLoreKB = 存档知识库副本）
    closeModal("saveDetailModal");
    openLoreReview("save");
}

export function addLoreEntry() {
    syncLoreEditFromDOM();
    if (!Array.isArray(S._loreEdit)) S._loreEdit = [];
    S._loreEdit.push({
        id: "u" + Date.now().toString(36),
        category: "补充", title: "", content: "",
        keywords: [], activation_keys: [], trigger_mode: "keyword", scan_depth: 1, priority: 0,
        insert_at: "before_user", insert_depth: 1 // ★ P0-2：默认注入位置
    });
    S._loreActiveIndex = S._loreEdit.length - 1;
    S._loreNotePreview = false; // 新条目直接进入编辑态
    renderLoreReviewBody();
}

export function deleteLoreEntry(idx) {
    syncLoreEditFromDOM();
    const i = parseInt(idx);
    if (Array.isArray(S._loreEdit) && i >= 0 && i < S._loreEdit.length) {
        S._loreEdit.splice(i, 1);
        if (S._loreActiveIndex >= S._loreEdit.length) S._loreActiveIndex = S._loreEdit.length - 1;
        if (S._loreActiveIndex < 0) S._loreActiveIndex = -1;
        renderLoreReviewBody();
    }
}

export async function saveLoreReview() {
    syncLoreEditFromDOM();
    if (!S.currentWorld) { closeModal("loreReviewModal"); return; }
    const list = (S._loreEdit || []).filter(s => (s.title && s.title.trim()) || (s.content && s.content.trim()));
    const blockingIssues = checkLoreQuality(list).filter(issue => /ID 缺失或重复|正则触发词.+无效|关联目标.+不存在/.test(issue));
    if (blockingIssues.length) {
        showToast("知识库存在阻断错误，请先修复红色质量提示", "error", 4000);
        renderLoreReviewBody();
        return;
    }
    // ★ 步骤二：创建世界（world 模式）时，把"时间体系"卡片里的输入写回 schema.time_config
    if (S._loreEditingWorldDefault) {
        const tc = (S.currentWorld.schema && S.currentWorld.schema.time_config) || {};
        tc.era_label = (document.getElementById("tc_era")?.value || "").trim().slice(0, 40);
        tc.calendar_mode = document.getElementById("tc_calendar")?.value || "day";
        readCalendarStartFromDOM(tc);
        tc.clock_mode = document.getElementById("tc_clock")?.value || "period";
        tc.season = (document.getElementById("tc_season")?.value || "").trim().slice(0, 10);
        tc.weather = (document.getElementById("tc_weather")?.value || "").trim().slice(0, 20);
        tc.show = !!document.getElementById("tc_show")?.checked;
        if (!S.currentWorld.schema) S.currentWorld.schema = defaultWorldSchema(S.currentWorld.name);
        S.currentWorld.schema.time_config = tc;
    }
    list.forEach(s => {
        s.title = (s.title || "").trim().slice(0, 200);
        s.category = (s.category || "补充").trim().slice(0, 50);
        s.content = (s.content || "").trim().slice(0, 1000);
        s.activation_keys = (s.activation_keys || []).slice(0, 20);
        if (!s.trigger_mode) s.trigger_mode = s.activation_keys.length ? "keyword" : "always";
        s.scan_depth = (typeof s.scan_depth === "number" && s.scan_depth > 0) ? s.scan_depth : 1;
        s.insert_at = ["system", "author_note", "before_user", "after_user"].includes(s.insert_at) ? s.insert_at : "before_user"; // ★ P0-2
        s.priority = Number(s.priority) || 0;
        if (!Array.isArray(s.keywords) || !s.keywords.length) s.keywords = s.activation_keys.slice();
        delete s.embedding; // 内容可能已改，清空向量以便按需重算
    });
    const candidateKB = { ...deepClone(S.activeLoreKB || {}), snippets: list };
    const context = { worldId: S.currentWorld.id, epoch: S.currentSession.epoch, turnId: S.conversationHistory.length };
    try { await ensureLoreEmbeddings(candidateKB); }
    catch (e) { console.warn("知识库编辑后向量重算失败，降级关键词：", e.message); }
    const current = { worldId: S.currentWorld?.id, epoch: S.currentSession.epoch, turnId: S.conversationHistory.length };
    if (!isEnhancementContextCurrent(context, current)) { showToast("会话已切换，本次知识库保存已取消", "warn"); return; }
    S.activeLoreKB = candidateKB;
    if (S._loreEditingWorldDefault) {
        S.currentWorld.lore_kb = deepClone(candidateKB);
        saveWorlds();
    } else {
        createOrUpdateSave();
    }
    S._loreEdit = null;
    S._loreEditingWorldDefault = false;
    invalidateLoreAnn(S.currentWorld.id); // ★ Phase 1：知识库已变更，失效 ANN 索引，下次检索懒重建
    closeModal("loreReviewModal");
    showToast(`知识库已保存（${list.length} 条）`, "success");
}

// ★ B5：后台触发知识库修订（非阻塞）
export async function triggerLoreRevision(msgCount) {
    S.lastLoreReviewMsgCount = msgCount;
    // 防止短时间内重复触发
    if (S._loreRevisionBuffer) return;
    const context = {
        worldId: S.currentWorld && S.currentWorld.id,
        epoch: S.currentSession.epoch,
        turnId: S.conversationHistory.length
    };
    callLoreRevisionLLM().then(diff => {
        const currentContext = {
            worldId: S.currentWorld && S.currentWorld.id,
            epoch: S.currentSession.epoch,
            turnId: S.conversationHistory.length
        };
        if (!isEnhancementContextCurrent(context, currentContext)) return;
        const count = diff ? (diff.updates?.length || 0) + (diff.additions?.length || 0) : 0;
        if (diff && count) {
            S._loreRevisionBuffer = diff;
            createOrUpdateSave();
            if (shouldAutoApplyLoreRevision()) {
                // 模式一（默认·关闭）：自动同意，不打断游戏，仅给小提示「知识库已更新」
                confirmLoreRevision();
            } else {
                // 模式二（开启）：弹轻量确认弹窗，由玩家点「应用/忽略」
                renderLoreRevisionModal();
                showModal("loreRevisionModal");
            }
        }
    }).catch(() => {});
}

// ★ B5：确认修订——将缓冲写入 activeLoreKB
export async function confirmLoreRevision() {
    if (!S._loreRevisionBuffer) return;
    const context = { worldId: S.currentWorld?.id, epoch: S.currentSession.epoch, turnId: S.conversationHistory.length };
    const candidateKB = deepClone(S.activeLoreKB);
    candidateKB.snippets = applyLoreRevisionDiff(candidateKB.snippets, S._loreRevisionBuffer);
    try { await ensureLoreEmbeddings(candidateKB); } catch (e) {}
    const current = { worldId: S.currentWorld?.id, epoch: S.currentSession.epoch, turnId: S.conversationHistory.length };
    if (!isEnhancementContextCurrent(context, current)) { showToast("会话已切换，本次修订已取消", "warn"); return; }
    S.activeLoreKB = candidateKB;
    S.activeBehaviorRecords = markPromotedRecords(S.activeBehaviorRecords, S._loreRevisionBuffer);
    S._loreRevisionBuffer = null;
    createOrUpdateSave();
    closeModal("loreReviewModal");
    closeModal("loreRevisionModal"); // ★ 知识晋升确认开关：若从确认弹窗进入，一并关闭
    invalidateSystemPromptCache();
    showToast("知识库已更新！", "success");
}

// ★ B5：拒绝修订——丢弃缓冲
export function rejectLoreRevision() {
    S._loreRevisionBuffer = null;
    createOrUpdateSave();
    closeModal("loreRevisionModal"); // ★ 知识晋升确认开关：关闭确认弹窗
    showToast("已丢弃本次 AI 修订建议", "success");
}

// ★ 知识晋升确认开关：是否自动应用修订（默认关=自动同意；开=弹窗待确认）
export function shouldAutoApplyLoreRevision() {
    return !S.loreRequireConfirm;
}

// ★ 知识晋升确认开关：根据 diff 缓冲生成摘要 HTML（纯函数，供弹窗与测试复用）
export function buildLoreRevisionSummaryHTML(buf) {
    const updates = buf && Array.isArray(buf.updates) ? buf.updates : [];
    const additions = buf && Array.isArray(buf.additions) ? buf.additions : [];
    if (!buf || (updates.length === 0 && additions.length === 0)) return '<div class="muted">暂无待确认的修订。</div>';
    const promotions = additions.filter(a => a && typeof a.id === "string" && a.id.startsWith("promote_")).length;
    const items = [
        `更新 <b>${updates.length}</b> 条已有知识`,
        `新增 <b>${additions.length}</b> 条知识`
    ];
    if (promotions) items.push(`其中 <b>${promotions}</b> 条为记忆晋升`);
    return `<ul class="lore-rev-summary">${items.map(t => `<li>${t}</li>`).join("")}</ul>`;
}

// ★ 知识晋升确认开关：渲染轻量确认弹窗摘要并打开弹窗
export function renderLoreRevisionModal() {
    const el = document.getElementById("loreRevisionSummary");
    if (el) el.innerHTML = buildLoreRevisionSummaryHTML(S._loreRevisionBuffer);
}

// ★ 知识晋升确认开关：切换并持久化到 localStorage（全局偏好，跨存档记忆）
export function toggleLoreRequireConfirm(el) {
    S.loreRequireConfirm = !!(el && (el.checked !== undefined ? el.checked : !S.loreRequireConfirm));
    try { localStorage.setItem("aigame_lore_confirm", S.loreRequireConfirm ? "true" : "false"); } catch (e) {}
    showToast(S.loreRequireConfirm ? "已开启：知识库修订将弹窗让你确认" : "已关闭：知识库修订自动同意并提示", "success", 3000);
}

// ★ Phase 3 · 已有世界「从源文档补抽」知识库（复用 llm.js 的 extractLoreFromSource）
export async function extractAndMergeSourceLore(worldId) {
    const world = (S.worlds || []).find(w => w.id === worldId)
        || (S.currentWorld && S.currentWorld.id === worldId ? S.currentWorld : null);
    if (!world) { showToast("未找到对应世界", "error"); return; }
    const src = (world.source_content || S.sourceFileContent || "").trim();
    if (!src) { showToast("该世界没有上传的源文档，无法补抽（可在创建世界时上传 TXT/DOCX/EPUB）", "warn"); return; }
    const btn = document.getElementById("extractSourceBtn");
    if (btn) { btn.disabled = true; btn.textContent = "补抽中..."; }
    try {
        const extracted = await extractLoreFromSource(src, world.name, world.ip_name, getSelectedStyleRef(), world.custom_style, {
            onProgress: (done, total) => { if (btn) btn.textContent = `补抽中 (${done}/${total})...`; },
            onRetry: (idx, total, kind, n) => showToast(`第 ${idx}/${total} 段${kind === "生成结果损坏" ? "生成结果损坏" : "被限流"}，自动重试(${n})...`, "warn"),
            onChunkError: (idx, err) => showToast(`第 ${idx} 段补抽失败，已跳过：${err.message}`, "error")
        });
        const currentKB = (world.lore_kb && Array.isArray(world.lore_kb.snippets)) ? world.lore_kb : { ip: world.name, snippets: [] };
        const merged = mergeLoreSnippets(currentKB.snippets, extracted.snippets);
        const newKB = { ip: world.name, snippets: merged };
        try { await ensureLoreEmbeddings(newKB); }
        catch (e) { console.warn("补抽后向量重算失败，降级为关键词检索：", e && e.message); }
        world.lore_kb = newKB;
        if (S.currentWorld && S.currentWorld.id === world.id) S.activeLoreKB = newKB;
        invalidateLoreAnn(world.id);
        saveWorlds();
        showToast(`📥 已从源文档补抽 ${extracted.snippets.length} 条，合并后共 ${merged.length} 条`, "success");
        if (document.getElementById("loreReviewModal") && document.getElementById("loreReviewModal").classList.contains("open")) renderLoreReviewBody();
    } catch (e) {
        showToast("补抽失败：" + (e && e.message), "error");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "📥 从源文档补抽"; }
    }
}

// ★ B8：防剧透遮罩开关
export function toggleLoreSpoiler() {
    S.loreSpoilerHidden = !S.loreSpoilerHidden;
    renderLoreReviewBody();
}

// ★ C：世界观图谱总览（力导向布局 canvas，布局/绘制分离 + 缩放平移 + 类别着色 + 点击开笔记）
// 颜色：节点按类别着色，边按关系着色（与 store.js 的 LINK_RELATION_LABELS 对齐）
// 注：LORE_CATEGORY_COLORS / FALLBACK_CAT_COLOR / REL_COLORS / ENTITY_COLOR / KG_REL_PALETTE
// 已迁至 src/kg-graph.js（纯函数模块），本文件从那里 import。

let G = null;            // 当前图谱状态（节点/边/视图变换/交互）
let graphUIBound = false;

// ★ 图谱迁入知识库弹窗：在图谱视图下把当前知识库绘制到 pane 内 canvas
function mountGraphNow() {
    if (S._loreView !== "graph") return; // 已切走则放弃
    const kb = (S.activeLoreKB && Array.isArray(S.activeLoreKB.snippets) && S.activeLoreKB.snippets.length)
        ? S.activeLoreKB
        : getWorldLoreKB();
    const snippets = (kb && kb.snippets) || [];
    const stats = document.getElementById("graphStats");
    if (!snippets.length) {
        if (stats) stats.textContent = "知识库为空，无可绘制条目";
        return;
    }
    bindGraphPreviewDelegate(); // 预览卡按钮委托（force-graph 路径不调 bindGraphUI，需单独绑定）
    const el = document.getElementById("loreGraph");
    if (!el) return;
    // 清理旧实例，避免反复打开图谱时堆叠多个 canvas
    if (S._fg && typeof S._fg._destructor === "function") { try { S._fg._destructor(); } catch (_) {} }
    el.innerHTML = "";

    const FG = window.ForceGraph && (window.ForceGraph.default || window.ForceGraph);
    if (typeof FG !== "function") {
        // 兜底：库未加载时退回手写 canvas 力导向
        if (!document.getElementById("loreGraphCanvas")) {
            const c = document.createElement("canvas");
            c.id = "loreGraphCanvas";
            el.appendChild(c);
        }
        bindGraphUI();
        buildGraph(snippets);
        return;
    }

    const model = buildGraphModel(snippets);
    const nodes = model.nodes;
    const links = [...model.linkEdges, ...model.relEdges];
    buildLegend(nodes, model);
    document.getElementById("graphStats").textContent = `${nodes.length} 节点（含 ${model.entityCount} 实体）· ${model.linkEdges.length} 关联 · ${model.relEdges.length} 关系`;
    const infoEl = document.getElementById("graphInfo");
    if (infoEl) infoEl.textContent = "";

    const wrap = el.parentElement;
    const W = wrap.clientWidth || 680, H = wrap.clientHeight || 460;
    const Graph = FG()(el)
        .graphData({ nodes, links })
        .nodeId("id")
        .nodeLabel(d => `【${d.category}】${escapeHtml(d.label)}`)
        .nodeColor("color")
        .nodeVal(d => 1 + Math.min(8, d.degree))
        .nodeRelSize(4)
        // 默认在节点旁绘制常驻标题（不再仅悬停才显示）
        .nodeCanvasObject((node, ctx, globalScale) => {
            const val = 1 + Math.min(8, node.degree || 0);
            const r = Math.sqrt(val) * 4; // 与 nodeRelSize(4) 一致
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            if (node.kind === "entity") {
                ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5 / globalScale;
                ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.stroke(); ctx.setLineDash([]);
            }
            const raw = (node.label || node.id || "");
            const text = raw.length > 12 ? raw.slice(0, 11) + "…" : raw;
            const fontSize = 12 / globalScale; // 屏显字号恒定，不随缩放变小
            ctx.font = fontSize + "px Sans-Serif";
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            const tw = ctx.measureText(text).width;
            const ty = node.y + r + 1 / globalScale;
            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.fillRect(node.x - tw / 2 - 2 / globalScale, ty - 1 / globalScale, tw + 4 / globalScale, fontSize + 2 / globalScale);
            ctx.fillStyle = "#222";
            ctx.fillText(text, node.x, ty);
        })
        .nodePointerAreaPaint((node, color, ctx) => {
            const val = 1 + Math.min(8, node.degree || 0);
            const r = Math.sqrt(val) * 4 + 4; // 命中区略大于视觉圆
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fill();
        })
        .linkColor(d => d.kind === "relation" ? (model.relationColorMap[d.relation] || "#bbb") : (REL_COLORS[d.relation] || "#888"))
        .linkWidth(0.6)
        .linkLineDash(d => d.kind === "relation" ? [4, 2] : [])
        .cooldownTicks(200)
        .onNodeClick(node => { if (node.kind === "entity") focusLoreEntity(node.label); else focusLoreSnippet(node.id); })
        .onNodeHover(node => { if (infoEl) infoEl.textContent = node ? `【${node.category}】${node.label}` : ""; })
        .width(W).height(H);
    Graph.onEngineStop(() => { try { Graph.zoomToFit(400, 40); } catch (_) {} });

    document.querySelectorAll("[data-graph]").forEach(btn => {
        btn.onclick = () => {
            const k = btn.dataset.graph;
            if (k === "zoom-in") Graph.zoom(Graph.zoom() * 1.25);
            else if (k === "zoom-out") Graph.zoom(Graph.zoom() / 1.25);
            else if (k === "reset") { try { Graph.zoomToFit(400, 40); } catch (_) {} }
        };
    });
    S._fg = Graph;
}

function buildGraph(snippets) {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || 680, H = rect.height || 460;
    canvas.width = W * dpr; canvas.height = H * dpr;

    const model = buildGraphModel(snippets);
    const nodes = model.nodes;
    const idIndex = {};
    nodes.forEach((n, i) => idIndex[n.id] = i);
    // 初始环形布局（实体节点也参与，保持与原布局一致的手写兜底体验）
    const baseR = Math.min(W, H) * 0.32;
    nodes.forEach((n, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        n.x = Math.cos(angle) * baseR + (Math.random() - 0.5) * 20;
        n.y = Math.sin(angle) * baseR + (Math.random() - 0.5) * 20;
        n.vx = 0; n.vy = 0;
    });
    const edges = [...model.linkEdges, ...model.relEdges].map(e => ({
        ai: idIndex[e.source], bi: idIndex[e.target], kind: e.kind, relation: e.relation
    }));
    // 邻接表（悬停高亮用）
    const adj = nodes.map(() => new Set());
    edges.forEach(e => { adj[e.ai].add(e.bi); adj[e.bi].add(e.ai); });

    G = {
        canvas, ctx: canvas.getContext("2d"), dpr, W, H,
        cx: W / 2, cy: H / 2,
        nodes, edges, adj, idIndex, relationColorMap: model.relationColorMap,
        view: { scale: 1, offsetX: 0, offsetY: 0 },
        hover: null, dragNode: null, panning: false,
        grabWX: 0, grabWY: 0, downX: 0, downY: 0, moved: false,
        running: true, rafId: null, tick: 0, MAX_TICK: 360
    };
    buildLegend(nodes, model);
    document.getElementById("graphStats").textContent = `${nodes.length} 节点（含 ${model.entityCount} 实体）· ${model.linkEdges.length} 关联 · ${model.relEdges.length} 关系`;
    document.getElementById("graphInfo").textContent = "";
    startSim();
}

function buildLegend(nodes, model) {
    const cats = {};
    nodes.forEach(n => { cats[n.category] = n.color; });
    const catHtml = Object.entries(cats).map(([c, col]) =>
        `<span class="legend-item"><i class="legend-dot" style="background:${col}"></i>${escapeHtml(c)}</span>`).join("");
    const linkRelHtml = Object.entries(REL_COLORS).map(([r, col]) =>
        `<span class="legend-item"><i class="legend-line" style="background:${col}"></i>${LINK_RELATION_LABELS[r] || r}</span>`).join("");
    const relMap = (model && model.relationColorMap) || {};
    const kgRelHtml = Object.entries(relMap).map(([r, col]) =>
        `<span class="legend-item"><i class="legend-line" style="background:repeating-linear-gradient(90deg, ${col} 0 4px, transparent 4px 8px)"></i>${escapeHtml(r)}</span>`).join("");
    const groups = [`<div class="legend-group">${catHtml}</div>`];
    if (linkRelHtml) groups.push(`<div class="legend-group"><span class="legend-title">链接</span>${linkRelHtml}</div>`);
    if (kgRelHtml) groups.push(`<div class="legend-group"><span class="legend-title">抽取关系</span>${kgRelHtml}</div>`);
    const el = document.getElementById("graphLegend");
    if (el) el.innerHTML = groups.join("");
}

// 力导向：每帧只 tick 一次，跑完即停（不再同步 200 帧、不再拖拽重跑）
function startSim() {
    const step = () => {
        if (!G || !document.getElementById("loreReviewModal")?.classList.contains("open") || S._loreView !== "graph") { if (G) G.running = false; return; }
        simulateStep();
        drawGraph();
        G.tick++;
        if (G.tick < G.MAX_TICK) { G.rafId = requestAnimationFrame(step); }
        else { G.running = false; }
    };
    G.rafId = requestAnimationFrame(step);
}

function simulateStep() {
    const { nodes, edges } = G;
    const REPULSE = 2600, SPRING_LEN = 95, SPRING_K = 0.015, CENTER = 0.003, DAMP = 0.86;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            let dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
            let d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
            let f = REPULSE / d2;
            let fx = dx / d * f, fy = dy / d * f;
            nodes[i].vx -= fx; nodes[i].vy -= fy; nodes[j].vx += fx; nodes[j].vy += fy;
        }
    }
    for (const e of edges) {
        const u = nodes[e.ai], v = nodes[e.bi];
        let dx = v.x - u.x, dy = v.y - u.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        let f = (d - SPRING_LEN) * SPRING_K;
        let fx = dx / d * f, fy = dy / d * f;
        u.vx += fx; u.vy += fy; v.vx -= fx; v.vy -= fy;
    }
    for (const n of nodes) {
        n.vx += (0 - n.x) * CENTER; n.vy += (0 - n.y) * CENTER;
        n.vx *= DAMP; n.vy *= DAMP; n.x += n.vx; n.y += n.vy;
    }
}

function screenToWorld(mx, my) {
    return { x: (mx - G.cx - G.view.offsetX) / G.view.scale, y: (my - G.cy - G.view.offsetY) / G.view.scale };
}
function nodeScreen(n) {
    return { x: G.cx + G.view.offsetX + n.x * G.view.scale, y: G.cy + G.view.offsetY + n.y * G.view.scale };
}
function nodeAt(mx, my) {
    for (let i = G.nodes.length - 1; i >= 0; i--) {
        const s = nodeScreen(G.nodes[i]);
        if (Math.hypot(s.x - mx, s.y - my) < 16) return G.nodes[i];
    }
    return null;
}

function drawGraph() {
    if (!G) return;
    const { ctx, dpr, W, H, view } = G;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(G.cx + view.offsetX, G.cy + view.offsetY);
    ctx.scale(view.scale, view.scale);

    const hoverId = G.hover ? G.hover.id : null;
    const neighbors = hoverId != null ? G.adj[G.idIndex[hoverId]] : null;

    // 边
    for (const e of G.edges) {
        const u = G.nodes[e.ai], v = G.nodes[e.bi];
        const active = hoverId != null && (u.id === hoverId || v.id === hoverId);
        const isRel = e.kind === "relation";
        ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y);
        ctx.strokeStyle = isRel ? ((G.relationColorMap && G.relationColorMap[e.relation]) || "#bbb") : (REL_COLORS[e.relation] || "#888");
        ctx.globalAlpha = hoverId == null ? (isRel ? 0.5 : 0.55) : (active ? 0.95 : 0.12);
        ctx.lineWidth = active ? 2 : 1;
        ctx.setLineDash(isRel ? [4, 2] : []);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 节点
    for (const n of G.nodes) {
        const isHover = n.id === hoverId;
        const isNeighbor = neighbors && neighbors.has(G.idIndex[n.id]);
        const r = 7 + Math.min(6, n.degree * 0.8);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.globalAlpha = hoverId == null ? 1 : (isHover || isNeighbor ? 1 : 0.35);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isHover) { ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke(); }
        if (n.kind === "entity") { ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.stroke(); ctx.setLineDash([]); }
        // 标签：放大或悬停/邻居时显示
        if (view.scale > 0.55 || isHover || isNeighbor) {
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#222";
            ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
            const label = n.label.length > 10 ? n.label.slice(0, 9) + "…" : n.label;
            ctx.fillText(label, n.x, n.y + r + 2);
        }
    }
    ctx.restore();
}

function bindGraphPreviewDelegate() {
    if (bindGraphPreviewDelegate._bound) return;
    bindGraphPreviewDelegate._bound = true;
    document.addEventListener("click", e => {
        const closeBtn = e.target.closest("[data-graph-close]");
        if (closeBtn) { const pc = document.getElementById("graphPreview"); if (pc) pc.hidden = true; return; }
        const openBtn = e.target.closest("[data-graph-open]");
        if (openBtn) { openNodeInKB(openBtn.dataset.graphOpen); }
    });
}

function bindGraphUI() {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;

    canvas.addEventListener("mousedown", e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        G.downX = mx; G.downY = my; G.moved = false;
        const n = nodeAt(mx, my);
        if (n) {
            G.dragNode = n;
            const w = screenToWorld(mx, my);
            G.grabWX = n.x - w.x; G.grabWY = n.y - w.y;
        } else { G.panning = true; const pc = document.getElementById("graphPreview"); if (pc) pc.hidden = true; }
    });

    canvas.addEventListener("mousemove", e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (G.dragNode) {
            const w = screenToWorld(mx, my);
            G.dragNode.x = w.x + G.grabWX; G.dragNode.y = w.y + G.grabWY;
            G.moved = true; drawGraph();
        } else if (G.panning) {
            G.view.offsetX += mx - G.downX; G.view.offsetY += my - G.downY;
            G.downX = mx; G.downY = my; G.moved = true; drawGraph();
        } else {
            const n = nodeAt(mx, my);
            if (n !== G.hover) {
                G.hover = n;
                document.getElementById("graphInfo").textContent = n ? `【${n.category}】${n.label}` : "";
                drawGraph();
                canvas.style.cursor = n ? "pointer" : "grab";
            }
        }
    });

    const endDrag = e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const dist = Math.hypot(mx - G.downX, my - G.downY);
        if (G.dragNode && !G.moved && dist < 5) { if (G.dragNode.kind === "entity") focusLoreEntity(G.dragNode.label); else focusLoreSnippet(G.dragNode.id); } // 单击节点：实体看只读卡，片段开笔记
        G.dragNode = null; G.panning = false; canvas.style.cursor = "grab";
    };
    canvas.addEventListener("mouseup", endDrag);
    canvas.addEventListener("mouseleave", () => { if (G) { G.dragNode = null; G.panning = false; } });

    canvas.addEventListener("wheel", e => {
        if (!G) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newScale = Math.max(0.2, Math.min(4, G.view.scale * factor));
        const wx = (mx - G.cx - G.view.offsetX) / G.view.scale;
        const wy = (my - G.cy - G.view.offsetY) / G.view.scale;
        G.view.scale = newScale;
        G.view.offsetX = mx - G.cx - wx * newScale;
        G.view.offsetY = my - G.cy - wy * newScale;
        drawGraph();
    }, { passive: false });

    // 工具按钮：放大/缩小/复位
    document.querySelectorAll("[data-graph]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!G) return;
            const k = btn.dataset.graph;
            if (k === "zoom-in") zoomBy(1.2);
            else if (k === "zoom-out") zoomBy(1 / 1.2);
            else if (k === "reset") { G.view.scale = 1; G.view.offsetX = 0; G.view.offsetY = 0; drawGraph(); }
        });
    });

    // 预览卡交互（document 委托，抽成独立函数，兼容图谱 tab 反复重建）
    bindGraphPreviewDelegate();
}

function zoomBy(factor) {
    const newScale = Math.max(0.2, Math.min(4, G.view.scale * factor));
    const wx = (G.cx - G.cx - G.view.offsetX) / G.view.scale;
    const wy = (G.cy - G.cy - G.view.offsetY) / G.view.scale;
    G.view.scale = newScale;
    G.view.offsetX = G.cx - G.cx - wx * newScale;
    G.view.offsetY = G.cy - G.cy - wy * newScale;
    drawGraph();
}

// 单击节点 → 在图谱内显示轻量预览卡（不切走图谱，视口/缩放完全保留）
function focusLoreSnippet(id) {
    const list = S._loreEdit || [];
    let snippet = list.find(s => s.id === id);
    // 若当前缓冲不含该条目，则载入世界默认知识库
    if (!snippet) {
        const w = S.currentWorld;
        if (!w) { showToast("请先选择世界", "warn"); return; }
        S.activeLoreKB = deepClone(w.lore_kb || { ip: w.name || "", snippets: [] });
        S._loreEditingWorldDefault = true;
        S._loreEdit = deepClone(S.activeLoreKB.snippets);
        snippet = S._loreEdit.find(s => s.id === id);
    }
    if (!snippet) { showToast("该条目不在当前知识库", "warn"); return; }

    const outs = (snippet.links || []).length;
    const backs = (S._loreEdit || []).filter(s => (s.links || []).some(l => l.target === snippet.id)).length;
    const raw = (snippet.content || "").replace(/[#*\[\]\(\)\n>]/g, " ").replace(/\s+/g, " ").trim();
    const summary = raw.slice(0, 200);

    const card = document.getElementById("graphPreview");
    if (!card) return;
    card.innerHTML = `
        <div class="graph-preview-head">
            <span class="graph-preview-cat" style="--c:${categoryColor(snippet.category)}">${escapeHtml(snippet.category || "补充")}</span>
            <span class="graph-preview-title">${escapeHtml(snippet.title || snippet.id)}</span>
            <button class="graph-preview-close" data-graph-close title="收起">×</button>
        </div>
        <div class="graph-preview-summary">${escapeHtml(summary)}${raw.length > 200 ? "…" : ""}</div>
        <div class="graph-preview-foot">
            <span>出链 ${outs} · 入链 ${backs}</span>
            <button class="btn secondary graph-preview-edit" data-graph-open="${escapeHtml(snippet.id)}">✎ 打开完整编辑</button>
        </div>`;
    card.hidden = false;
    const info = document.getElementById("graphInfo");
    if (info) info.style.display = "none";
}

// 预览卡「✎ 打开完整编辑」→ 切到知识库视图并聚焦该条目（此时才离开图谱）
function openNodeInKB(id) {
    const w = S.currentWorld;
    if (!w) { showToast("请先选择世界", "warn"); return; }
    if (!S._loreEdit || !S._loreEdit.some(s => s.id === id)) {
        S.activeLoreKB = deepClone(w.lore_kb || { ip: w.name || "", snippets: [] });
        S._loreEditingWorldDefault = true;
        S._loreEdit = deepClone(S.activeLoreKB.snippets);
    }
    const idx = S._loreEdit.findIndex(s => s.id === id);
    if (idx < 0) { showToast("该条目不在当前知识库", "warn"); return; }
    S._loreActiveIndex = idx;
    S._loreNotePreview = true;
    S._loreView = "kb";
    const reviewOpen = document.getElementById("loreReviewModal") && document.getElementById("loreReviewModal").classList.contains("open");
    if (reviewOpen) renderLoreReviewBody();
    else openLoreReview(S._loreEditingWorldDefault ? "world" : "save", id);
}

// ★ Phase 4：点击实体节点 → 只读预览卡（实体未收录为独立片段，列出其抽取关系）
function focusLoreEntity(name) {
    const kb = (S.activeLoreKB && Array.isArray(S.activeLoreKB.snippets) && S.activeLoreKB.snippets.length)
        ? S.activeLoreKB : getWorldLoreKB();
    const snippets = (kb && kb.snippets) || [];
    const raw = String(name || "").trim();
    const rels = [];
    for (const s of snippets) {
        if (!Array.isArray(s.relations)) continue;
        for (const r of s.relations) {
            const from = (r.from || "").trim(), to = (r.to || "").trim();
            if (from === raw || to === raw) {
                rels.push({ from, to, relation: r.relation || "related", via: s.title || s.id });
            }
        }
    }
    const card = document.getElementById("graphPreview");
    if (!card) return;
    const relHtml = rels.length
        ? rels.map(r => `<div class="kg-rel-row"><span class="kg-rel-name">${escapeHtml(r.from)}</span><span class="kg-rel-arrow">—[${escapeHtml(r.relation)}]→</span><span class="kg-rel-name">${escapeHtml(r.to)}</span><span class="kg-rel-via">（出自：${escapeHtml(r.via)}）</span></div>`).join("")
        : `<div class="kg-rel-empty">暂未检索到该实体的抽取关系</div>`;
    card.innerHTML = `
        <div class="graph-preview-head">
            <span class="graph-preview-cat" style="--c:${ENTITY_COLOR}">实体</span>
            <span class="graph-preview-title">${escapeHtml(raw)}</span>
            <button class="graph-preview-close" data-graph-close title="收起">×</button>
        </div>
        <div class="graph-preview-summary kg-entity-note">该实体尚未收录为独立知识条目，以下是从知识库中抽取到的它与其它实体的关系：</div>
        <div class="kg-rel-list">${relHtml}</div>`;
    card.hidden = false;
    const info = document.getElementById("graphInfo");
    if (info) info.style.display = "none";
}

// ===== Phase 2：世界规则 DSL 编辑器 =====
// 与知识库编辑器同模式：S._ruleEdit 草稿缓冲，取消不影响原数据；保存才写回 world.rules。
// 规则结构见 docs/Phase2改造方案.md：{ id, name, enabled, when:{type,...}, then:{type,...} }

function defaultRule() {
    return {
        id: "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        name: "",
        enabled: true,
        when: { type: "always" },
        then: { type: "ban", concept: "", aliases: [], severity: "soft", unlessTags: [] }
    };
}

function syncRuleEditFromDOM() {
    if (!Array.isArray(S._ruleEdit)) return;
    S._ruleEdit.forEach((r, i) => {
        const g = (p) => document.getElementById(p + i);
        const name = g("ru_name_");
        if (name) r.name = name.value;
        const en = g("ru_enabled_");
        if (en) r.enabled = en.checked;
        const wt = g("ru_when_");
        if (wt) {
            const type = wt.value;
            r.when = { type };
            if (type === "concept") {
                const t = g("ru_when_term_"); if (t) r.when.term = t.value.trim();
                const tg = g("ru_when_tags_"); if (tg) r.when.unlessTags = tg.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
            } else if (type === "state") {
                const f = g("ru_when_field_"); if (f) r.when.field = f.value.trim();
                const op = g("ru_when_op_"); if (op) r.when.op = op.value;
                const v = g("ru_when_val_"); if (v) r.when.value = v.value.trim();
            } else if (type === "tag") {
                const tg = g("ru_when_tagtag_"); if (tg) r.when.tag = tg.value.trim();
            }
        }
        const tt = g("ru_then_");
        if (tt) {
            const type = tt.value;
            if (type === "ban") {
                const c = g("ru_ban_concept_"), a = g("ru_ban_aliases_"), s = g("ru_ban_sev_"), tg = g("ru_ban_tags_");
                r.then = {
                    type: "ban",
                    concept: c ? c.value.trim() : "",
                    aliases: a ? a.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean) : [],
                    severity: s ? s.value : "soft",
                    unlessTags: tg ? tg.value.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean) : []
                };
            } else if (type === "tag") {
                const op = g("ru_tag_op_"), tg = g("ru_tag_tag_");
                r.then = { type: "tag", op: op ? op.value : "add", tag: tg ? tg.value.trim() : "" };
            } else if (type === "ending") {
                const rs = g("ru_end_reason_");
                r.then = { type: "ending", reason: rs ? rs.value.trim() : "" };
            }
        }
    });
}

function ruleSummary(r) {
    if (!r) return "";
    const w = r.when || {};
    const whenTxt = (() => {
        switch (w.type) {
            case "concept": return `文本出现「${w.term || "?"}」`;
            case "state": return `状态 ${w.field || "?"} ${w.op || "=="} ${w.value ?? "?"}`;
            case "tag": return `标签「${w.tag || "?"}」活跃`;
            default: return "始终";
        }
    })();
    const t = r.then || {};
    const thenTxt = (() => {
        switch (t.type) {
            case "ban": return `禁止概念「${t.concept || "?"}」`;
            case "tag": return `${t.op === "remove" ? "移除" : "添加"}标签「${t.tag || "?"}」`;
            case "ending": return `触发结局（${t.reason || "世界结束"}）`;
            default: return "?";
        }
    })();
    return `${whenTxt} → ${thenTxt}`;
}

function renderRuleEditorBody() {
    const body = document.getElementById("ruleEditorBody");
    if (!body) return;
    const w = S.currentWorld;
    const hasLegacy = !S._ruleImportedLegacy && Array.isArray(w.bannedConcepts) && w.bannedConcepts.length > 0
        && !(Array.isArray(w.rules) && w.rules.length);
    let html = "";
    if (hasLegacy) {
        html += `<div class="rule-import-banner">该世界还有旧版「禁用词表」${w.bannedConcepts.length} 条，可一键转为可编辑规则：
            <button class="btn-secondary-sm" data-action="importBannedAsRules">转为规则</button></div>`;
    }
    const list = S._ruleEdit || [];
    if (!list.length) {
        html += `<p class="muted">还没有规则。点下方「＋ 添加规则」来配置世界逻辑，例如「金币 &lt; 0 → 触发结局」「禁止出现『核弹』」。</p>`;
    }
    const whenLabels = { always: "始终", concept: "文本出现词", state: "状态数值", tag: "标签活跃" };
    const thenLabels = { ban: "禁止概念", tag: "设置标签", ending: "触发结局" };
    list.forEach((r, i) => {
        const when = r.when || {};
        const then = r.then || {};
        const whenType = when.type || "always";
        const thenType = then.type || "ban";
        html += `<div class="rule-card">
            <div class="rule-card-head">
                <input id="ru_name_${i}" class="rule-name" placeholder="规则名称（如：破产结局）" value="${escapeHtml(r.name || "")}">
                <label class="rule-enabled"><input type="checkbox" id="ru_enabled_${i}" ${r.enabled !== false ? "checked" : ""}> 启用</label>
                <button class="btn-secondary-sm danger" data-action="deleteRule" data-idx="${i}">删除</button>
            </div>
            <div class="rule-summary">${escapeHtml(ruleSummary(r))}</div>
            <div class="rule-row">
                <span class="rule-label">如果</span>
                <select id="ru_when_${i}" data-action="ruleTypeChange" data-kind="when" data-idx="${i}">
                    ${["always", "concept", "state", "tag"].map(t => `<option value="${t}" ${whenType === t ? "selected" : ""}>${whenLabels[t]}</option>`).join("")}
                </select>
                <span class="rule-sub" style="display:${whenType === "concept" ? "inline" : "none"}">
                    词<input id="ru_when_term_${i}" value="${escapeHtml(when.term || "")}" size="10">解锁标签<input id="ru_when_tags_${i}" value="${escapeHtml((when.unlessTags || []).join(" "))}" size="12" placeholder="空格分隔">
                </span>
                <span class="rule-sub" style="display:${whenType === "state" ? "inline" : "none"}">
                    字段<input id="ru_when_field_${i}" value="${escapeHtml(when.field || "")}" size="8" placeholder="如 gold">
                    <select id="ru_when_op_${i}">${["<", "<=", "==", ">=", ">", "!="].map(o => `<option value="${o}" ${when.op === o ? "selected" : ""}>${o}</option>`).join("")}</select>
                    值<input id="ru_when_val_${i}" value="${escapeHtml(String(when.value ?? ""))}" size="6">
                </span>
                <span class="rule-sub" style="display:${whenType === "tag" ? "inline" : "none"}">
                    标签<input id="ru_when_tagtag_${i}" value="${escapeHtml(when.tag || "")}" size="12">
                </span>
            </div>
            <div class="rule-row">
                <span class="rule-label">就</span>
                <select id="ru_then_${i}" data-action="ruleTypeChange" data-kind="then" data-idx="${i}">
                    ${["ban", "tag", "ending"].map(t => `<option value="${t}" ${thenType === t ? "selected" : ""}>${thenLabels[t]}</option>`).join("")}
                </select>
                <span class="rule-sub" style="display:${thenType === "ban" ? "inline" : "none"}">
                    概念<input id="ru_ban_concept_${i}" value="${escapeHtml(then.concept || "")}" size="10">别名<input id="ru_ban_aliases_${i}" value="${escapeHtml((then.aliases || []).join(" "))}" size="12" placeholder="空格分隔">
                    强度<select id="ru_ban_sev_${i}"><option value="soft" ${then.severity !== "hard" ? "selected" : ""}>软(提示)</option><option value="hard" ${then.severity === "hard" ? "selected" : ""}>硬(拦截)</option></select>
                    解锁标签<input id="ru_ban_tags_${i}" value="${escapeHtml((then.unlessTags || []).join(" "))}" size="12" placeholder="空格分隔">
                </span>
                <span class="rule-sub" style="display:${thenType === "tag" ? "inline" : "none"}">
                    <select id="ru_tag_op_${i}"><option value="add" ${(then.op || "add") !== "remove" ? "selected" : ""}>添加</option><option value="remove" ${then.op === "remove" ? "selected" : ""}>移除</option></select>
                    标签<input id="ru_tag_tag_${i}" value="${escapeHtml(then.tag || "")}" size="12">
                </span>
                <span class="rule-sub" style="display:${thenType === "ending" ? "inline" : "none"}">
                    结局说明<input id="ru_end_reason_${i}" value="${escapeHtml(then.reason || "")}" size="20" placeholder="如：你破产了，故事结束">
                </span>
            </div>
        </div>`;
    });
    body.innerHTML = html;
}

export function openRuleEditor(worldId) {
    const w = S.worlds.find(x => x.id === worldId) || S.currentWorld;
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    if (!Array.isArray(w.rules)) w.rules = [];
    S._ruleImportedLegacy = false;
    S._ruleEdit = deepClone(w.rules);
    S._ruleActiveIndex = S._ruleEdit.length ? 0 : -1;
    renderRuleEditorBody();
    showModal("ruleEditorModal");
}

export function addRule() {
    syncRuleEditFromDOM();
    if (!Array.isArray(S._ruleEdit)) S._ruleEdit = [];
    S._ruleEdit.push(defaultRule());
    S._ruleActiveIndex = S._ruleEdit.length - 1;
    renderRuleEditorBody();
}

export function deleteRule(idx) {
    syncRuleEditFromDOM();
    const i = parseInt(idx);
    if (Array.isArray(S._ruleEdit) && i >= 0 && i < S._ruleEdit.length) {
        S._ruleEdit.splice(i, 1);
        if (S._ruleActiveIndex >= S._ruleEdit.length) S._ruleActiveIndex = S._ruleEdit.length - 1;
        if (S._ruleActiveIndex < 0) S._ruleActiveIndex = -1;
        renderRuleEditorBody();
    }
}

export function ruleTypeChange(el) {
    syncRuleEditFromDOM();
    const i = parseInt(el.dataset.idx);
    const kind = el.dataset.kind;
    const r = S._ruleEdit && S._ruleEdit[i];
    if (!r) return;
    if (kind === "when") {
        const t = el.value;
        r.when = { type: t };
        if (t === "concept") r.when.term = "";
        else if (t === "state") { r.when.field = ""; r.when.op = "=="; r.when.value = ""; }
        else if (t === "tag") r.when.tag = "";
    } else if (kind === "then") {
        const t = el.value;
        if (t === "ban") r.then = { type: "ban", concept: "", aliases: [], severity: "soft", unlessTags: [] };
        else if (t === "tag") r.then = { type: "tag", op: "add", tag: "" };
        else if (t === "ending") r.then = { type: "ending", reason: "" };
    }
    renderRuleEditorBody();
}

export function importBannedAsRules() {
    const w = S.currentWorld;
    if (!w) return;
    syncRuleEditFromDOM();
    const banned = Array.isArray(w.bannedConcepts) ? w.bannedConcepts : [];
    const rules = banned.map((e, i) => {
        const concept = typeof e === "string" ? e : (e && e.concept) || "";
        const aliases = (typeof e === "object" && Array.isArray(e.aliases)) ? e.aliases : [];
        const severity = (typeof e === "object" && e.severity === "hard") ? "hard" : "soft";
        const unlessTags = (typeof e === "object" && Array.isArray(e.unlockTags)) ? e.unlockTags : [];
        return {
            id: "r_imp_" + i + "_" + Date.now().toString(36),
            name: "禁用：" + concept,
            enabled: true,
            when: { type: "always" },
            then: { type: "ban", concept, aliases, severity, unlessTags }
        };
    });
    S._ruleEdit = rules;
    S._ruleImportedLegacy = true; // 仅用于隐藏横幅；保存时统一把禁用词表移交 rules
    S._ruleActiveIndex = rules.length ? 0 : -1;
    renderRuleEditorBody();
    showToast(`已把 ${rules.length} 条禁用词转为可编辑规则`, "success");
}

export function saveRuleReview() {
    syncRuleEditFromDOM();
    const w = S.currentWorld;
    if (!w) { closeModal("ruleEditorModal"); return; }
    const list = (S._ruleEdit || []).filter(r => {
        if (r.then && r.then.type === "ban" && !r.then.concept) return false;
        if (r.then && r.then.type === "tag" && !r.then.tag) return false;
        if (r.then && r.then.type === "ending" && !r.then.reason) return false;
        if (r.when && r.when.type === "state" && !r.when.field) return false;
        if (r.when && r.when.type === "concept" && !r.when.term) return false;
        if (r.when && r.when.type === "tag" && !r.when.tag) return false;
        return true;
    });
    list.forEach(r => {
        r.name = (r.name || "").trim().slice(0, 100);
        r.enabled = r.enabled !== false;
        if (r.then && r.then.type === "ban") {
            r.then.concept = (r.then.concept || "").trim().slice(0, 50);
            r.then.aliases = (r.then.aliases || []).map(x => x.trim()).filter(Boolean).slice(0, 20);
            r.then.severity = r.then.severity === "hard" ? "hard" : "soft";
            r.then.unlessTags = (r.then.unlessTags || []).map(x => x.trim()).filter(Boolean).slice(0, 20);
        }
    });
    if (!Array.isArray(w.rules)) w.rules = [];
    w.rules = list;
    w.bannedConcepts = []; // ★ 单一数据源改为 rules：DSL 已完整接管禁用逻辑（默认词表由 store 兜底，不会丢）
    saveWorlds();
    S._ruleEdit = null;
    S._ruleActiveIndex = -1;
    S._ruleImportedLegacy = false;
    closeModal("ruleEditorModal");
    showToast(`世界规则已保存（${list.length} 条）`, "success");
}
