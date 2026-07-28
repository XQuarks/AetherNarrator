// ============================================================
// AetherNarrator · lore-ui.js（由 game.js 拆分：知识库编辑 UI）
// 说明：知识库初览/编辑/修订核心面板（三栏树状 + 时间体系表单 + 开场白修复）。
// 图谱视图已拆至 lore-graph-ui.js，规则/人物/变量/物品编辑器已拆至 lore-editors.js。
// 不反向依赖 game.js，避免循环引用。
// ============================================================
import { S, LINK_RELATION_LABELS, normalizeTimeConfig } from "./store.js";
import { validateStartDate, CUSTOM_CALENDAR_PRESETS, clampCustomCalendarMonths, summarizeCustomCalendar, reorderMonths, insertLeapMonth } from "./calendar.js";
import { deepClone, escapeHtml, getWorldSchema, defaultWorldSchema, mergeLoreSnippets, detectTimeConflict, formatConflictMessage } from "./utils.js";
import { showModal, closeModal, showToast, getSelectedStyleRef } from "./render.js";
import { ensureLoreEmbeddings } from "./rag.js";
import { createOrUpdateSave, prepareSessionFromSave } from "./save.js";
import { saveWorlds } from "./storage.js";
import { isEnhancementContextCurrent } from "./worldview.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { markPromotedRecords } from "./promotion.js"; // ★ B6：晋升后标记原记忆 promoted
import { callLoreRevisionLLM, extractLoreFromSource, callRegenerateOpeningLLM, callOptimizeOpeningLLM } from "./llm.js";
import { invalidateSystemPromptCache, invalidateLoreHardCache } from "./prompt.js";
import { tempLabelText } from "./theme.js";
import { invalidateLoreAnn } from "./ann-index.js";
import { renderLoreMarkdown } from "./markdown.js"; // ★ 步骤 B：Obsidian 风 markdown 渲染封装
import { categoryColor } from "./kg-graph.js"; // 类别配色（纯函数，拆分时移入 kg-graph.js）
import { renderGraphPane, mountGraphNow, setOpenNodeInKB } from "./lore-graph-ui.js"; // 图谱视图（单向依赖）
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
    // ★ 每世界温度：读当前世界 temperature_preset（缺失回落 0.5）
    const curTemp = (S.currentWorld && typeof S.currentWorld.temperature_preset === "number") ? S.currentWorld.temperature_preset : 0.5;
    // S5-1：起始日期输入框（gregorian/lunar/custom_calendar 显示；day/none 隐藏）
    const TC_DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
    const showStart = TC_DATED_MODES.includes(cfg.calendar_mode);
    const cs = cfg.calendar_start || {};
    const startRow = showStart ? `
            <div class="form-group"><label>起始日期（月 / 日，可留空）</label>
                <div class="time-cfg-start-row">
                    <input id="tc_start_month" class="tc-num" type="number" min="1" max="12" value="${cs.month != null ? cs.month : ""}" placeholder="月" data-action="timeConfigChanged" data-event="input">
                    <span class="tc-sep">/</span>
                    <input id="tc_start_date" class="tc-num" type="number" min="1" max="31" value="${cs.date != null ? cs.date : ""}" placeholder="日" data-action="timeConfigChanged" data-event="input">
                </div>
                <span class="time-cfg-start-hint">仅 dated 历法生效；年归「纪元」字段，此处只填月日，各字段可空（缺失部分不显示、按纪元推算年份）</span>
                <div id="startDateWarn" class="time-cfg-warn" style="display:none;"></div>
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
            <div class="form-group"><label>当前天气</label><input id="tc_weather" maxlength="20" value="${escapeHtml(cfg.weather || "")}" placeholder="例如：细雨"></div>
            <div class="form-group time-cfg-show"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="tc_show" style="width:auto;" ${cfg.show !== false ? "checked" : ""}><span>在界面显示世界时间</span></label></div>
            <div class="form-group"><label>AI 创造性（温度）</label>
                <div class="range-slider-wrapper">
                    <input type="range" id="tc_temp" min="0" max="1" step="0.1" value="${curTemp.toFixed(1)}" data-action="worldTempChanged" data-event="input">
                    <div class="range-current" id="tc_temp_label">${tempLabelText(curTemp)}</div>
                    <div class="range-labels"><span>严谨一致</span><span>自由发散</span></div>
                </div>
                <div class="hint">控制剧情生成的随机度。越低越稳定连贯，越高越自由发散。</div>
            </div>
            ${startRow}
            ${multiverseHint}
        </div>
        ${cfg.calendar_mode === "custom_calendar"
            ? `<div class="time-cfg-cc" id="ccEditorWrap">
            <label class="time-cfg-cc-label">🗓 自定义历法编辑器</label>
            <div id="ccEditor">${renderCustomCalendarEditorInner()}</div>
        </div>`
            : `<div class="time-cfg-cc" id="ccEditorWrap" style="display:none;"></div>`}
        <p class="time-cfg-hint">此设定仅在创建本世界时可调整；进入游戏后将锁定，不可实时修改。</p>
        <div id="timeConflictBadge" class="time-conflict-badge" style="display:none;"></div>
        ${renderOpeningFixActions()}
    </div>`;
}

// ★ 每世界温度：世界编辑卡滑块实时标签
export function updateTcTempLabel() {
    const slider = document.getElementById("tc_temp");
    if (!slider) return;
    const v = parseFloat(slider.value);
    const lbl = document.getElementById("tc_temp_label");
    if (lbl) lbl.textContent = tempLabelText(v);
}

// ★ 步骤 B：三栏链状（Obsidian 风）知识库 UI
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
function renderNotePanel(note, idx) {
    const preview = S._loreNotePreview !== false;
    const mode = note.trigger_mode || (note.activation_keys && note.activation_keys.length ? "keyword" : "always");
    const pos = ["system", "author_note", "before_user", "after_user"].includes(note.insert_at) ? note.insert_at : "before_user";
    const modeOpts = ["keyword", "always", "regex"].map(v => `<option value="${v}"${mode === v ? " selected" : ""}>${v === "keyword" ? "关键词" : v === "always" ? "常驻" : "正则"}</option>`).join("");
    const posOpts = ["before_user", "after_user", "author_note", "system"].map(v => `<option value="${v}"${pos === v ? " selected" : ""}>${v === "before_user" ? "用户输入前" : v === "after_user" ? "用户输入后" : v === "author_note" ? "作者注" : "系统"}</option>`).join("");
    const catOpts = ["规则", "世界观", "地点", "人物", "事件", "物品", "势力", "冲突", "补充"].map(c => `<option value="${c}">${c}</option>`).join("");

    const contentArea = preview
        ? `<div class="lore-md">${renderLoreMarkdown(note.content)}</div>`
        : `<textarea id="le_content_${idx}" class="lore-note-textarea" placeholder="正文（支持 Markdown 与 [[双链]]，如 [[荣国府]]）">${escapeHtml(note.content || "")}</textarea>`;

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

// 方案 22：从 DOM 读取"起始日期"的月/日（年已移除，归纪元字段），写回 tc.calendar_start（部分字段可空）。
// 仅 dated 历法生效；其余模式清空。读到的字段经 validateStartDate 校验+自动纠正（如平年 2月29→28）。
function readCalendarStartFromDOM(tc) {
    const TC_DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
    if (!TC_DATED_MODES.includes(tc.calendar_mode)) { tc.calendar_start = null; return; }
    const moEl = document.getElementById("tc_start_month");
    const dEl = document.getElementById("tc_start_date");
    if (!moEl || !dEl) { tc.calendar_start = null; return; }
    const mo = parseInt(moEl.value, 10);
    const d = parseInt(dEl.value, 10);
    const cs = {};
    if (Number.isFinite(mo) && mo >= 1) cs.month = Math.min(12, Math.max(1, mo));
    if (Number.isFinite(d) && d >= 1) cs.date = Math.max(1, d);
    if (Object.keys(cs).length === 0) { tc.calendar_start = null; return; }
    const fixed = validateStartDate(cs, tc.calendar_mode, tc.era_label);
    tc.calendar_start = fixed.corrected || cs;
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
    delete tc.season;
    tc.weather = document.getElementById("tc_weather")?.value.trim().slice(0, 20);
    tc.show = !!document.getElementById("tc_show")?.checked;
    if (!S.currentWorld.schema) S.currentWorld.schema = {};
    S.currentWorld.schema.time_config = tc;
}

// 徽章/提示条显隐小工具（docs/34 #8 消重）：传 html 则填内容并显示，不传则清空隐藏
function setBadge(el, html) {
    if (!el) return;
    if (html) { el.style.display = ""; el.innerHTML = html; }
    else { el.style.display = "none"; el.innerHTML = ""; }
}

// S5-4：编辑卡时间冲突徽章实时刷新（只读 schema，不重渲染卡片，避免输入框丢焦点）
// 由 app.js 的 data-action="timeConfigChanged" 在改起始日期/历法/纪元时调用。
export function updateTimeConflictBadge() {
    updateStartDateWarn(); // 方案 22：起始日期实时校验提示随同刷新
    const el = document.getElementById("timeConflictBadge");
    if (!el) return;
    const actions = document.getElementById("openingFixActions");
    const res = S._loreEditingWorldDefault ? detectTimeConflict(S.currentWorld) : null;
    if (!res || !res.conflict) {
        setBadge(el);
        if (actions) actions.classList.remove("conflict");
        return;
    }
    setBadge(el, `⚠ 时间可能冲突：${escapeHtml(formatConflictMessage(res))}`);
    if (actions) actions.classList.add("conflict"); // S5-4'：冲突时高亮修复按钮组
}

// 方案 22：起始日期实时合法性校验提示（不覆盖输入，仅提示；自动纠正发生在保存时 readCalendarStartFromDOM）
export function updateStartDateWarn() {
    const el = document.getElementById("startDateWarn");
    if (!el) return;
    if (!S._loreEditingWorldDefault) { setBadge(el); return; }
    const tcfg = (S.currentWorld && S.currentWorld.schema && S.currentWorld.schema.time_config) || {};
    const TC_DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
    if (!TC_DATED_MODES.includes(tcfg.calendar_mode)) { setBadge(el); return; }
    const moEl = document.getElementById("tc_start_month");
    const dEl = document.getElementById("tc_start_date");
    const eraEl = document.getElementById("tc_era");
    if (!moEl || !dEl) { setBadge(el); return; }
    const mo = parseInt(moEl.value, 10);
    const d = parseInt(dEl.value, 10);
    const cs = {};
    if (Number.isFinite(mo) && mo >= 1) cs.month = Math.min(12, Math.max(1, mo));
    if (Number.isFinite(d) && d >= 1) cs.date = Math.max(1, d);
    const era = eraEl ? eraEl.value.trim() : "";
    const r = validateStartDate(cs, tcfg.calendar_mode, era);
    setBadge(el, r.warnings && r.warnings.length ? "⚠ " + escapeHtml(r.warnings.join("；")) : "");
}

// ================= UI-1 自定义历法可视化编辑器（docs/35 方案 C）=================
// 与引擎彻底解耦：仅读写 S.currentWorld.schema.time_config.custom_calendar，不改 calendar.js 推进逻辑。
// 编辑器块随 renderTimeConfigSection 一并渲染；结构性操作（增/删/排序/闰月/模板）局部重渲染 #ccEditor，
// 文本输入（月名/天数/历法名）仅写回数据并刷新统计条，不重渲染输入框以免丢焦点。

function getEditingTimeConfig() {
    if (!S.currentWorld || !S._loreEditingWorldDefault) return null;
    if (!S.currentWorld.schema) S.currentWorld.schema = {};
    if (!S.currentWorld.schema.time_config) S.currentWorld.schema.time_config = {};
    return S.currentWorld.schema.time_config;
}

function ccEnsure() {
    const tc = getEditingTimeConfig();
    if (!tc) return null;
    if (!tc.custom_calendar || !Array.isArray(tc.custom_calendar.months)) {
        tc.custom_calendar = { label: "", months: [] };
    }
    return tc.custom_calendar;
}

function ccStatsHtml(cc) {
    const sum = summarizeCustomCalendar(cc);
    return `共 <b>${sum.monthCount}</b> 个月 · 全年 <b>${sum.yearDays}</b> 天 · 示例：<code>${escapeHtml(sum.sample)}</code>`;
}

function renderCustomCalendarEditorInner() {
    const cc = ccEnsure();
    if (!cc) return "";
    const months = cc.months;
    const presetBtns = Object.keys(CUSTOM_CALENDAR_PRESETS)
        .map(k => `<button class="btn-secondary-sm" data-action="ccPreset" data-preset="${k}">${k === "lunar" ? "📅 农历模板" : "🚀 科幻10周期"}</button>`)
        .join("");
    const rows = months.map((m, i) => `
        <div class="cc-month-row" data-idx="${i}">
            <span class="cc-drag" draggable="true" title="拖拽排序">⠿</span>
            <span class="cc-idx">${i + 1}</span>
            <input class="cc-name" type="text" maxlength="10" value="${escapeHtml(m.name)}" data-action="ccRenMonthName" data-idx="${i}" data-event="input" placeholder="月名">
            <span class="cc-unit">月</span>
            <input class="cc-days" type="number" min="1" max="400" value="${m.days}" data-action="ccRenMonthDays" data-idx="${i}" data-event="input">
            <span class="cc-unit">天</span>
            <button class="cc-move" data-action="ccMoveMonth" data-from="${i}" data-to="${Math.max(0, i - 1)}" ${i === 0 ? "disabled" : ""} title="上移">↑</button>
            <button class="cc-move" data-action="ccMoveMonth" data-from="${i}" data-to="${Math.min(months.length - 1, i + 1)}" ${i === months.length - 1 ? "disabled" : ""} title="下移">↓</button>
            <button class="cc-leap" data-action="ccLeapMonth" data-after="${i}" title="在此月后插入闰月">＋闰</button>
            <button class="cc-del" data-action="ccDelMonth" data-idx="${i}" title="删除该月">✕</button>
        </div>`).join("");
    return `
        <div class="cc-editor">
            <div class="cc-field"><label>历法名（展示用，如：星历）</label><input id="cc_label" type="text" maxlength="20" value="${escapeHtml(cc.label || "")}" data-action="ccRenLabel" data-event="input"></div>
            <div class="cc-stats" id="ccStats">${ccStatsHtml(cc)}</div>
            <div class="cc-rows">${rows || '<div class="cc-empty">尚未添加月份，点击下方「＋ 添加月份」或选择模板。</div>'}</div>
            <div class="cc-actions">
                <button class="btn-secondary-sm btn-accent-sm" data-action="ccAddMonth">＋ 添加月份</button>
                ${presetBtns}
                <button class="btn-secondary-sm" data-action="ccClearMonths">清空</button>
            </div>
            <div class="cc-hint">拖拽 ⠿ 可调整月份顺序；「＋闰」在选中月之后插入闰月；月份天数 1–400，最多 24 个月。改动实时写入世界定义，保存即生效。</div>
        </div>`;
}

// 局部重渲染编辑器内部（结构性操作后调用）；同时按当前历法模式刷新外层显隐
export function refreshCustomCalendarEditor() {
    const wrap = document.getElementById("ccEditorWrap");
    if (!wrap) return;
    const tc = getEditingTimeConfig();
    const isCustom = !!(tc && tc.calendar_mode === "custom_calendar");
    wrap.style.display = isCustom ? "" : "none";
    const inner = document.getElementById("ccEditor");
    if (inner) inner.innerHTML = renderCustomCalendarEditorInner();
}

function updateCcStats() {
    const el = document.getElementById("ccStats");
    if (!el) return;
    const cc = ccEnsure();
    if (cc) el.innerHTML = ccStatsHtml(cc);
}

// ---- 数据操作（均直接改 live 对象）----
function ccClampMonths(arr) { return clampCustomCalendarMonths(arr); }

export function ccAddMonth() {
    const cc = ccEnsure(); if (!cc) return;
    if (cc.months.length >= 24) { showToast("自定义历法最多 24 个月", "warn"); return; }
    cc.months = ccClampMonths([...cc.months, { name: `月${cc.months.length + 1}`, days: 30 }]);
    refreshCustomCalendarEditor();
}
export function ccDelMonth(idx) {
    const cc = ccEnsure(); if (!cc) return;
    if (idx < 0 || idx >= cc.months.length) return;
    cc.months = cc.months.slice(0, idx).concat(cc.months.slice(idx + 1));
    refreshCustomCalendarEditor();
}
export function ccMoveMonth(from, to) {
    const cc = ccEnsure(); if (!cc) return;
    cc.months = reorderMonths(cc.months, from, to);
    refreshCustomCalendarEditor();
}
export function ccRenMonthName(idx, value) {
    const cc = ccEnsure(); if (!cc || !cc.months[idx]) return;
    cc.months[idx].name = (value || "").toString().trim().slice(0, 10) || `月${idx + 1}`;
    updateCcStats();
}
export function ccRenMonthDays(idx, value) {
    const cc = ccEnsure(); if (!cc || !cc.months[idx]) return;
    const n = parseInt(value, 10);
    cc.months[idx].days = Math.min(400, Math.max(1, Number.isFinite(n) ? (n | 0) : 30));
    updateCcStats();
}
export function ccRenLabel(value) {
    const cc = ccEnsure(); if (!cc) return;
    cc.label = (value || "").toString().slice(0, 20);
    updateCcStats();
}
export function ccLeapMonth(after) {
    const cc = ccEnsure(); if (!cc) return;
    if (cc.months.length >= 24) { showToast("自定义历法最多 24 个月", "warn"); return; }
    cc.months = insertLeapMonth(cc.months, after, "闰月", 30);
    refreshCustomCalendarEditor();
}
export function ccPreset(key) {
    const cc = ccEnsure(); if (!cc) return;
    const src = CUSTOM_CALENDAR_PRESETS[key];
    if (!src) return;
    cc.months = ccClampMonths(deepClone(src));
    if (key === "lunar") cc.label = cc.label || "农历";
    if (key === "scifi") cc.label = cc.label || "星历";
    refreshCustomCalendarEditor();
}
export function ccClearMonths() {
    const cc = ccEnsure(); if (!cc) return;
    cc.months = [];
    refreshCustomCalendarEditor();
}

// 拖拽排序（事件委托，模块加载时绑定一次；编辑器重渲染后仍有效）
let ccDragFrom = null;
if (typeof document !== "undefined") {
    document.addEventListener("dragstart", (e) => {
        const row = e.target.closest && e.target.closest(".cc-month-row");
        if (!row) return;
        ccDragFrom = parseInt(row.dataset.idx, 10);
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(ccDragFrom)); } catch (_) {} }
        row.classList.add("cc-dragging");
    });
    document.addEventListener("dragover", (e) => {
        const row = e.target.closest && e.target.closest(".cc-month-row");
        if (!row || ccDragFrom == null) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        row.classList.add("cc-drop");
    });
    document.addEventListener("dragleave", (e) => {
        const row = e.target.closest && e.target.closest(".cc-month-row");
        if (row) row.classList.remove("cc-drop");
    });
    document.addEventListener("drop", (e) => {
        const row = e.target.closest && e.target.closest(".cc-month-row");
        if (!row || ccDragFrom == null) return;
        e.preventDefault();
        const to = parseInt(row.dataset.idx, 10);
        if (Number.isFinite(to) && to !== ccDragFrom) ccMoveMonth(ccDragFrom, to);
        ccDragFrom = null;
    });
    document.addEventListener("dragend", (e) => {
        const row = e.target.closest && e.target.closest(".cc-month-row");
        if (row) row.classList.remove("cc-dragging", "cc-drop");
        ccDragFrom = null;
    });
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
            <button class="btn-secondary-sm btn-accent-sm" data-action="optimizeOpening" ${disabled}>✨ 剧情向优化</button>
        </div>
        <div class="opening-fix-note">消耗一次 LLM API 调用；生成后预览 diff，确认才写回。「剧情向优化」会重写得更抓人、更有张力，但不改设定与时间锚点。</div>
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

// ★ 新功能：开场白剧情向优化（复用 openingFix 弹窗预览/确认写回流程）
export async function optimizeOpening() {
    if (!S.currentWorld) { showToast("未找到当前世界", "warn"); return; }
    const oldOpening = S.currentWorld.opening_narrative;
    if (!oldOpening || !oldOpening.trim()) { showToast("当前世界没有可优化的开场白（可能尚未生成）", "warn"); return; }
    showToast("AI 正在优化开场白剧情…", "info", 3000);
    try {
        const res = await callOptimizeOpeningLLM(S.currentWorld, oldOpening);
        S._openingFixBuffer = { oldOpening, newOpening: res.newOpening, mode: "optimize" };
        renderOpeningFixModal();
        showModal("openingFixModal");
    } catch (e) {
        console.warn("开场白剧情优化生成失败：", e && e.message);
        showToast("生成失败：" + (e && e.message || "未知错误"), "error");
    }
}

// 渲染开场白修复预览模态（旧 vs 新 diff）
export function renderOpeningFixModal() {
    const el = document.getElementById("openingFixBody");
    if (!el || !S._openingFixBuffer) return;
    const b = S._openingFixBuffer;
    const modeLabel = b.mode === "toPlaceholders" ? "改成占位符版" : b.mode === "optimize" ? "剧情向优化" : "重新生成开场白";
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
    const tree = buildLoreTree(list, S._loreActiveIndex);
    const note = (S._loreActiveIndex >= 0 && list[S._loreActiveIndex]) ? list[S._loreActiveIndex] : null;
    const noteHtml = note ? renderNotePanel(note, S._loreActiveIndex) : `<div class="lore-empty">请选择左侧笔记，或点上方「＋ 添加条目」新建。</div>`;
    const backHtml = note ? renderBacklinksPanel(note, list, S._loreActiveIndex) : "";

    if (!S._loreSeg) S._loreSeg = "note";
    const segBtn = (seg, label) => `<button type="button" class="lore-seg-btn${S._loreSeg === seg ? " active" : ""}" data-seg="${seg}" role="tab" aria-selected="${S._loreSeg === seg ? "true" : "false"}">${label}</button>`;

    return `
      <div class="lore-obsidian">
        <div class="lore-obs-toolbar">
            <input id="loreSearch" class="lore-search" value="${escapeHtml(S._loreSearchTerm || "")}" placeholder="🔍 搜索标题 / 内容…">
            <button class="btn-secondary-sm" data-action="addLoreEntry">＋ 添加条目</button>
            <div class="dropdown">
                <button class="btn-secondary-sm" data-action="toggleDropdown" aria-haspopup="true" aria-expanded="false">⋯ 更多</button>
                <div class="dropdown-menu">
                    <button class="dropdown-item" id="extractSourceBtn" data-action="extractAndMergeSourceLore">📥 从源文档补抽</button>
                    <button class="dropdown-item" data-action="triggerWorldCritic">🤖 审稿检查</button>
                </div>
            </div>
        </div>
        ${revisionHint}
        ${warnHtml}
        <div class="lore-seg" role="tablist" aria-label="知识库栏目切换">
            ${segBtn("tree", "📂 文件")}
            ${segBtn("note", "📝 笔记")}
            ${segBtn("backlinks", "🔗 关联")}
        </div>
        <div class="lore-obs-cols">
            <div class="lore-col-aside lore-tree-wrap${S._loreSeg === "tree" ? " seg-show" : ""}" data-seg="tree">
                <div class="lore-col-head">📂 文件树（${list.length} 条）</div>
                <div class="lore-tree">${tree}</div>
            </div>
            <section class="lore-note${S._loreSeg === "note" ? " seg-show" : ""}" data-seg="note">${noteHtml}</section>
            <div class="lore-col-aside lore-backlinks-wrap${S._loreSeg === "backlinks" ? " seg-show" : ""}" data-seg="backlinks">
                <div class="lore-col-head">🔗 关联（出链 ${(note && note.links ? note.links.length : 0)} · 入链 ${list.filter(s => (s.links || []).some(l => note && l.target === note.id)).length}）</div>
                <div class="lore-backlinks">${backHtml}</div>
            </div>
        </div>
      </div>`;
}

// ★ 知识库三栏手机端分段切换（文件 / 笔记 / 关联），通过 .seg-show 类控制可见段
function switchLoreSeg(seg) {
    if (!seg) return;
    S._loreSeg = seg;
    const cols = document.querySelector(".lore-obs-cols");
    if (!cols) return;
    // 切换按钮高亮
    cols.parentElement.querySelectorAll(".lore-seg-btn").forEach(b => {
        const on = b.dataset.seg === seg;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // 切换栏目可见性（仅手机端生效，桌面端 CSS 强制全显示）
    cols.querySelectorAll("[data-seg]").forEach(el => {
        const on = el.dataset.seg === seg;
        el.classList.toggle("seg-show", on);
    });
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
        const seg = e.target.closest(".lore-seg-btn");
        if (seg && seg.dataset.seg) {
            switchLoreSeg(seg.dataset.seg);
            return;
        }
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
    // ★ 记忆式分段：仅在首次（从未切过）时给默认「笔记」段，之后保留用户上次停留的段位
    if (!S._loreSeg) S._loreSeg = "note";
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
        delete tc.season;
        tc.weather = (document.getElementById("tc_weather")?.value || "").trim().slice(0, 20);
        tc.show = !!document.getElementById("tc_show")?.checked;
        // ★ 每世界温度：写回 tc_temp
        const tEl = document.getElementById("tc_temp");
        if (tEl) { const tv = parseFloat(tEl.value); if (Number.isFinite(tv)) S.currentWorld.temperature_preset = tv; }
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
    invalidateLoreHardCache(); // ★ Phase 5 L2：知识库改动仅失效「知识库硬约束」缓存段（角色卡段保留命中）
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
    invalidateLoreHardCache(); // ★ Phase 5 L2：知识库修订仅失效「知识库硬约束」缓存段（角色卡段保留命中）
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
        invalidateLoreHardCache(); // ★ Phase 5 L2：知识库改动仅失效「知识库硬约束」缓存段（角色卡段保留命中）
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

// ★ 拆分接线：把「切到知识库视图并聚焦条目」注入图谱模块（见 lore-graph-ui.js 头注释）
setOpenNodeInKB(openNodeInKB);

