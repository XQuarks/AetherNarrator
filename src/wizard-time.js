// src/wizard-time.js
// docs/59：创建向导内嵌完整时间系统编辑器（独立命名空间，绝不污染 S.currentWorld）
// 设计要点（来自代码调研）：详情页时间编辑器强耦合 S.currentWorld + 全局 data-action 委托，
// 不能直接复用。本模块用 wz_ 前缀 id + data-wtime 独立命名空间（参照 wizard-containers.js 隔离先例），
// 状态写入本地缓冲 WT，仅复用 store.normalizeTimeConfig 这类无副作用的纯逻辑。

import { normalizeTimeConfig } from "./store.js";
import { showToast } from "./render.js";

function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===================== 本地缓冲（向导专用，绝不写 S.currentWorld） =====================
let WT = freshWT();
function freshWT() {
    return {
        locked: false,                                  // 玩家是否锁定时间（预设≠auto 或编辑器动过 → 覆盖 AI）
        mode: "single",                                 // single / multiverse
        era_label: "",
        calendar_mode: "day",                           // day / gregorian / lunar / custom_calendar
        weather: "",
        calendar_start: { month: null, date: null },    // 仅 dated 历法生效
        clock_mode: "period",                           // period / none
        show: true,
        default_timetravel_strategy: "keep",            // keep / reset / branch
        custom_calendar: null,                          // { label, months:[{name,days}] }
        timelines: null,                                // { id:{ name, calendar_mode, calendar_start, era_label, weather, sync_rules, timetravel_strategy, custom_calendar } }
        deadlines: []                                   // [{ title, day?, month?, date?, retrigger_policy }]
    };
}

const DATED_MODES = ["gregorian", "lunar", "custom_calendar"];
const CAL_OPTS = [
    ["day", "按第 N 天推进"],
    ["gregorian", "公历（月/日/星期）"],
    ["lunar", "阴历（月/日）"],
    ["custom_calendar", "自定义历法"]
];
const CLK_OPTS = [["period", "时段标签"], ["none", "不显示时刻"]];
const STRAT_OPTS = [
    ["keep", "保留记录 (S1)", "逆跳时保留已触发记录"],
    ["reset", "重置回放 (S3)", "逆跳时清空触发记录，回起点可重玩"],
    ["branch", "分支隔离 (S4)", "逆跳时自动新建分支，原未来保留"]
];

function timeModuleOn() {
    try {
        const cb = document.querySelector("#moduleToggles .module-cb[data-module='time']");
        return !!(cb && cb.checked);
    } catch (e) {
        return true; // 无 DOM（单测环境）默认视为开启；是否覆盖由 WT.locked 决定
    }
}

function calOptsSel(cur) {
    return CAL_OPTS.map(([v, t]) => `<option value="${v}"${cur === v ? " selected" : ""}>${t}</option>`).join("");
}
function clkOptsSel(cur) {
    return CLK_OPTS.map(([v, t]) => `<option value="${v}"${cur === v ? " selected" : ""}>${t}</option>`).join("");
}
function stratOptsSel(cur) {
    return STRAT_OPTS.map(([v, t, d]) =>
        `<label class="radio-option${cur === v ? " selected" : ""}"><input type="radio" name="wz_strategy" value="${v}" data-wtime="wzStrategy" ${cur === v ? "checked" : ""}><span class="radio-title">${t}</span><small>${d || ""}</small></label>`
    ).join("");
}

// ===================== 渲染 =====================
export function renderWizardTimeEditor() {
    const host = document.getElementById("wzTimeEditor");
    if (!host) return;
    if (!timeModuleOn()) { host.innerHTML = ""; return; }
    host.innerHTML = editorHTML();
}

function editorHTML() {
    const showStart = DATED_MODES.includes(WT.calendar_mode);
    const startRow = showStart ? `
        <div class="form-group"><label>起始日期（月 / 日，可留空）</label>
            <div class="time-cfg-start-row">
                <input type="number" min="1" max="12" value="${WT.calendar_start.month != null ? WT.calendar_start.month : ""}" placeholder="月" data-wtime="wzStartMonth">
                <span class="tc-sep">/</span>
                <input type="number" min="1" max="31" value="${WT.calendar_start.date != null ? WT.calendar_start.date : ""}" placeholder="日" data-wtime="wzStartDay">
            </div>
            <span class="time-cfg-start-hint">年归「纪元」字段，此处只填月日，可空</span>
        </div>` : "";
    return `
    <div class="wz-time-editor">
        <div class="form-group"><label>世界时间结构</label>
            <div class="radio-row">
                <label class="radio-option${WT.mode === "single" ? " selected" : ""}"><input type="radio" name="wz_struct" value="single" data-wtime="wzStruct" ${WT.mode === "single" ? "checked" : ""}><span>单一时间线</span></label>
                <label class="radio-option${WT.mode === "multiverse" ? " selected" : ""}"><input type="radio" name="wz_struct" value="multiverse" data-wtime="wzStruct" ${WT.mode === "multiverse" ? "checked" : ""}><span>多时间线（双界穿梭）</span></label>
            </div>
        </div>
        <div class="time-cfg-grid">
            <div class="form-group"><label>纪元 / 年份</label><input id="wz_era" maxlength="40" value="${escapeHtml(WT.era_label)}" placeholder="例如：大清乾隆年间" data-wtime="wzEra"></div>
            <div class="form-group"><label>历法</label><select data-wtime="wzCalendar">${calOptsSel(WT.calendar_mode)}</select></div>
            <div class="form-group"><label>当前天气</label><input id="wz_weather" maxlength="20" value="${escapeHtml(WT.weather)}" placeholder="例如：细雨" data-wtime="wzWeather"></div>
            ${startRow}
        </div>
        <div class="time-cfg-grid">
            <div class="form-group"><label>时钟粒度</label><select data-wtime="wzClock">${clkOptsSel(WT.clock_mode)}</select></div>
            <div class="form-group"><label class="checkbox-inline"><input type="checkbox" data-wtime="wzShow" ${WT.show ? "checked" : ""}> 在界面显示世界时间</label></div>
        </div>
        <div class="form-group time-cfg-strategy"><label>默认时间穿越策略（逆跳默认行为）</label>
            <div class="radio-row">${stratOptsSel(WT.default_timetravel_strategy)}</div>
        </div>
        ${WT.calendar_mode === "custom_calendar" ? ccBlockHTML() : ""}
        ${WT.mode === "multiverse" ? mvBlockHTML() : ""}
        ${dlBlockHTML()}
    </div>`;
}

// ---- 自定义历法 ----
function ccBlockHTML() {
    if (!WT.custom_calendar) WT.custom_calendar = { label: "", months: [] };
    return `
    <div class="wz-cc">
        <label class="wz-cc-label">🗓 自定义历法</label>
        <input id="wz_cc_label" maxlength="20" value="${escapeHtml(WT.custom_calendar.label)}" placeholder="历法名（如：星历）" data-wtime="wzCcLabel">
        <div id="wzCcEditor">${ccMonthsHTML(WT.custom_calendar)}</div>
        <div class="wz-toolbar">
            <button type="button" class="btn-secondary-sm" data-wtime="wzAddMonth">＋ 月份</button>
            <button type="button" class="btn-secondary-sm" data-wtime="wzCcPreset">快速填充 12 月×30 天</button>
        </div>
    </div>`;
}
function ccMonthsHTML(cc) {
    const months = (cc && cc.months) || [];
    if (!months.length) return '<span class="wz-empty">暂无月份，点「＋ 月份」添加</span>';
    return months.map((m, i) => `
        <div class="wz-month-row">
            <input value="${escapeHtml(m.name)}" placeholder="月名" data-wtime="wzMonthName" data-wz-idx="${i}">
            <input type="number" min="1" max="400" value="${m.days}" data-wtime="wzMonthDays" data-wz-idx="${i}"> 天
            <button type="button" class="btn-secondary-sm" data-wtime="wzDelMonth" data-wz-idx="${i}">删</button>
        </div>`).join("");
}

// ---- 多时间线 ----
function mvBlockHTML() {
    if (!WT.timelines) WT.timelines = {};
    return `
    <div class="wz-mv">
        <label class="wz-mv-label">🌐 多时间线</label>
        <div id="wzMvEditor">${mvLinesHTML()}</div>
        <button type="button" class="btn-secondary-sm" data-wtime="wzAddLine">＋ 时间线</button>
    </div>`;
}
function mvLinesHTML() {
    const ts = WT.timelines || {};
    const ids = Object.keys(ts);
    if (!ids.length) return '<span class="wz-empty">暂无时间线，点「＋ 时间线」添加（至少 1 条）</span>';
    return ids.map(id => {
        const line = ts[id];
        const lineStart = DATED_MODES.includes(line.calendar_mode);
        const sync = Array.isArray(line.sync_rules) ? line.sync_rules : [];
        const syncHTML = sync.map((r, sidx) => `
            <div class="wz-sync-row">
                相对 <select data-wtime="wzSyncRef" data-wz-line="${id}" data-wz-sidx="${sidx}">${syncRefOpts(id, r.ref)}</select>
                × <input type="number" step="0.1" min="0.01" value="${r.ratio}" data-wtime="wzSyncRatio" data-wz-line="${id}" data-wz-sidx="${sidx}">
                <button type="button" class="btn-secondary-sm" data-wtime="wzDelSync" data-wz-line="${id}" data-wz-sidx="${sidx}">删</button>
            </div>`).join("");
        return `
        <div class="wz-line" data-wz-line="${id}">
            <div class="wz-line-head">
                <input value="${escapeHtml(line.name)}" placeholder="线名" data-wtime="wzLineName" data-wz-line="${id}">
                <button type="button" class="btn-secondary-sm" data-wtime="wzDelLine" data-wz-line="${id}">删线</button>
            </div>
            <div class="time-cfg-grid">
                <div class="form-group"><label>历法</label><select data-wtime="wzLineCalendar" data-wz-line="${id}">${calOptsSel(line.calendar_mode)}</select></div>
                ${lineStart ? `<div class="form-group"><label>起始</label><input type="number" min="1" max="12" value="${line.calendar_start && line.calendar_start.month != null ? line.calendar_start.month : ""}" data-wtime="wzLineMonth" data-wz-line="${id}">月 <input type="number" min="1" max="31" value="${line.calendar_start && line.calendar_start.date != null ? line.calendar_start.date : ""}" data-wtime="wzLineDay" data-wz-line="${id}">日</div>` : ""}
                <div class="form-group"><label>纪元</label><input value="${escapeHtml(line.era_label)}" placeholder="如：公元2003年" data-wtime="wzLineEra" data-wz-line="${id}"></div>
                <div class="form-group"><label>天气</label><input value="${escapeHtml(line.weather)}" placeholder="如：细雨" data-wtime="wzLineWeather" data-wz-line="${id}"></div>
                <div class="form-group"><label>穿越策略</label><select data-wtime="wzLineStrategy" data-wz-line="${id}">${stratOptsSel(line.timetravel_strategy)}</select></div>
            </div>
            ${line.calendar_mode === "custom_calendar" && WT.custom_calendar ? `<div class="wz-hint">使用顶层自定义历法：${escapeHtml(WT.custom_calendar.label || "未命名")}</div>` : ""}
            <div class="wz-sync"><label>流速比（相对其它线）</label>${syncHTML || '<span class="wz-empty">无</span>'}<button type="button" class="btn-secondary-sm" data-wtime="wzAddSync" data-wz-line="${id}">＋ 流速比</button></div>
        </div>`;
    }).join("");
}
function syncRefOpts(selfId, cur) {
    const ids = Object.keys(WT.timelines || {}).filter(x => x !== selfId);
    if (!ids.length) return '<option value="">（无线可选）</option>';
    return ids.map(id => `<option value="${id}"${cur === id ? " selected" : ""}>${escapeHtml((WT.timelines[id].name) || id)}</option>`).join("");
}

// ---- 截止事件 ----
function dlBlockHTML() {
    return `
    <div class="wz-dl">
        <label class="wz-dl-label">⏳ 截止事件（带重触发策略）</label>
        <div id="wzDlList">${dlRowsHTML()}</div>
        <button type="button" class="btn-secondary-sm" data-wtime="wzAddDl">＋ 截止事件</button>
    </div>`;
}
function dlRowsHTML() {
    if (!WT.deadlines.length) return '<span class="wz-empty">暂无截止事件</span>';
    return WT.deadlines.map((d, i) => {
        const rp = d.retrigger_policy && d.retrigger_policy.mode === "repeatable" ? "repeatable" : "once";
        return `
        <div class="wz-dl-row">
            <input value="${escapeHtml(d.title)}" placeholder="事件名" data-wtime="wzDlTitle" data-wz-idx="${i}">
            <input type="number" min="0" value="${d.day != null ? d.day : ""}" placeholder="第N天" data-wtime="wzDlDay" data-wz-idx="${i}">
            <select data-wtime="wzDlRetrigger" data-wz-idx="${i}">
                <option value="once"${rp === "once" ? " selected" : ""}>触发一次</option>
                <option value="repeatable"${rp === "repeatable" ? " selected" : ""}>可重复</option>
            </select>
            <button type="button" class="btn-secondary-sm" data-wtime="wzDelDl" data-wz-idx="${i}">删</button>
        </div>`;
    }).join("");
}

// ===================== 收集（权威源） =====================
export function getWizardTimeConfig() {
    if (!timeModuleOn() || !WT.locked) return null; // 不覆盖 → 交给 AI
    return normalizeTimeConfig(WT);
}

// 序列化为 AI 硬约束文本（注入 worldPrefix）
export function buildTimeConfigPrompt(tc) {
    const cfg = tc || getWizardTimeConfig();
    if (!cfg) return "";
    const L = [];
    L.push("【时间系统·玩家已锁定，请原样沿用，不要重新设计】");
    L.push(`- 时间结构：${cfg.mode === "multiverse" ? "多时间线（" + Object.keys(cfg.timelines || {}).length + " 条）" : "单一时间线"}`);
    if (cfg.era_label) L.push(`- 纪元：${cfg.era_label}`);
    L.push(`- 历法：${cfg.calendar_mode === "custom_calendar" ? "自定义历法" : (CAL_OPTS.find(c => c[0] === cfg.calendar_mode)?.[1] || cfg.calendar_mode)}`);
    if (cfg.calendar_start && (cfg.calendar_start.month != null || cfg.calendar_start.date != null))
        L.push(`- 起始日期：${cfg.calendar_start.month != null ? cfg.calendar_start.month + "月" : ""}${cfg.calendar_start.date != null ? cfg.calendar_start.date + "日" : ""}`);
    L.push(`- 时钟粒度：${cfg.clock_mode === "none" ? "不显示时刻" : "时段标签"}`);
    L.push(`- 界面显示：${cfg.show ? "开启" : "关闭"}`);
    L.push(`- 默认穿越策略：${STRAT_OPTS.find(s => s[0] === cfg.default_timetravel_strategy)?.[1] || cfg.default_timetravel_strategy}`);
    if (cfg.weather) L.push(`- 开局天气：${cfg.weather}`);
    if (cfg.calendar_mode === "custom_calendar" && cfg.custom_calendar) {
        const ms = cfg.custom_calendar.months.map(m => `${m.name}${m.days}天`).join("、");
        L.push(`- 自定义历法「${cfg.custom_calendar.label || "未命名"}」：${ms}`);
    }
    if (cfg.mode === "multiverse" && cfg.timelines) {
        for (const [id, line] of Object.entries(cfg.timelines)) {
            const sync = (line.sync_rules || []).map(r => `${r.ref}×${r.ratio}`).join(",");
            L.push(`- 线「${line.name || id}」：${line.calendar_mode}${line.era_label ? " / " + line.era_label : ""}${sync ? " / 流速比 " + sync : ""}`);
        }
    }
    if (cfg.deadlines && cfg.deadlines.length) {
        L.push("- 截止事件：" + cfg.deadlines.map(d =>
            `${d.title}（${d.day != null ? "第" + d.day + "天" : ""}${d.retrigger_policy && d.retrigger_policy.mode === "repeatable" ? "，可重复" : "，一次"}）`
        ).join("；"));
    }
    return L.join("\n");
}

// ===================== init / reset =====================
export function initWizardTime() {
    ensureDelegated();
    const sel = document.getElementById("timePreset");
    if (sel && !sel._wzBound) {
        sel._wzBound = true;
        sel.addEventListener("change", onPresetChange);
    }
    renderWizardTimeEditor();
}
export function resetWizardTime() {
    WT = freshWT();
    renderWizardTimeEditor();
}

function onPresetChange() {
    const sel = document.getElementById("timePreset");
    if (!sel) return;
    const v = sel.value;
    if (v === "auto") {
        WT.locked = false;
    } else {
        WT.calendar_mode = (v === "custom") ? "custom_calendar" : v;
        WT.locked = true;
    }
    renderWizardTimeEditor();
}

// ===================== 事件委托（data-wtime，限定 #createWorldModal 作用域） =====================
let _delegated = false;
function ensureDelegated() {
    if (_delegated) return;
    _delegated = true;
    document.addEventListener("click", (e) => dispatch(e, "click"));
    document.addEventListener("input", (e) => dispatch(e, "input"));
    document.addEventListener("change", (e) => dispatch(e, "change"));
}

function elAction(e) {
    const el = e.target.closest("[data-wtime]");
    if (!el) return null;
    if (!el.closest("#createWorldModal")) return null;
    return el;
}

function dispatch(e, type) {
    const el = elAction(e);
    if (!el) return;
    const a = el.dataset.wtime;
    const idx = el.dataset.wzIdx != null ? parseInt(el.dataset.wzIdx) : null;
    const lineId = el.dataset.wzLine || null;
    const sidx = el.dataset.wzSidx != null ? parseInt(el.dataset.wzSidx) : null;
    WT.locked = true; // 任何交互都视为玩家已配置 → 覆盖 AI

    switch (a) {
        // 结构性（重渲染）
        case "wzStruct": WT.mode = el.value; renderWizardTimeEditor(); break;
        case "wzCalendar": WT.calendar_mode = el.value; renderWizardTimeEditor(); break;
        case "wzClock": WT.clock_mode = el.value; break;
        case "wzShow": WT.show = el.checked; break;
        case "wzStrategy": WT.default_timetravel_strategy = el.value; break;
        case "wzAddMonth":
            if (!WT.custom_calendar) WT.custom_calendar = { label: "", months: [] };
            WT.custom_calendar.months.push({ name: "新月份", days: 30 });
            rerenderCc(); break;
        case "wzCcPreset":
            if (!WT.custom_calendar) WT.custom_calendar = { label: "" };
            WT.custom_calendar.months = Array.from({ length: 12 }, (_, i) => ({ name: "第" + (i + 1) + "月", days: 30 }));
            rerenderCc(); break;
        case "wzDelMonth":
            if (WT.custom_calendar) WT.custom_calendar.months.splice(idx, 1);
            rerenderCc(); break;
        case "wzAddLine": {
            if (!WT.timelines) WT.timelines = {};
            const id = "line_" + (Object.keys(WT.timelines).length + 1);
            WT.timelines[id] = { name: "新时间线", calendar_mode: "day", calendar_start: { month: null, date: null }, era_label: "", weather: "", sync_rules: [], timetravel_strategy: "keep" };
            rerenderMv(); break;
        }
        case "wzDelLine":
            if (WT.timelines && WT.timelines[lineId]) { delete WT.timelines[lineId]; rerenderMv(); }
            break;
        case "wzLineCalendar":
            if (WT.timelines && WT.timelines[lineId]) {
                WT.timelines[lineId].calendar_mode = el.value;
                if (el.value === "custom_calendar" && !WT.timelines[lineId].custom_calendar)
                    WT.timelines[lineId].custom_calendar = WT.custom_calendar ? JSON.parse(JSON.stringify(WT.custom_calendar)) : { label: "", months: [] };
                rerenderMv();
            }
            break;
        case "wzLineStrategy":
            if (WT.timelines && WT.timelines[lineId]) WT.timelines[lineId].timetravel_strategy = el.value;
            break;
        case "wzAddSync":
            if (WT.timelines && WT.timelines[lineId]) {
                const others = Object.keys(WT.timelines).filter(x => x !== lineId);
                if (!others.length) { showToast("至少需 2 条线才能设流速比", "error"); break; }
                if (!Array.isArray(WT.timelines[lineId].sync_rules)) WT.timelines[lineId].sync_rules = [];
                WT.timelines[lineId].sync_rules.push({ ref: others[0], ratio: 1 });
                rerenderMv();
            }
            break;
        case "wzDelSync":
            if (WT.timelines && WT.timelines[lineId] && Array.isArray(WT.timelines[lineId].sync_rules))
                WT.timelines[lineId].sync_rules.splice(sidx, 1);
            rerenderMv(); break;
        case "wzAddDl":
            WT.deadlines.push({ title: "", day: 0, retrigger_policy: "once" });
            rerenderDl(); break;
        case "wzDelDl":
            WT.deadlines.splice(idx, 1); rerenderDl(); break;
        case "wzDlRetrigger":
            if (WT.deadlines[idx]) WT.deadlines[idx].retrigger_policy = (el.value === "repeatable") ? { mode: "repeatable" } : "once";
            break;
        // 文本输入（直接写 WT，不重渲染）
        case "wzEra": WT.era_label = el.value; break;
        case "wzWeather": WT.weather = el.value; break;
        case "wzStartMonth": WT.calendar_start.month = el.value === "" ? null : Math.min(12, Math.max(1, parseInt(el.value) || 1)); break;
        case "wzStartDay": WT.calendar_start.date = el.value === "" ? null : Math.max(1, parseInt(el.value) || 1); break;
        case "wzCcLabel": if (WT.custom_calendar) WT.custom_calendar.label = el.value; break;
        case "wzMonthName": if (WT.custom_calendar) WT.custom_calendar.months[idx].name = el.value; break;
        case "wzMonthDays": if (WT.custom_calendar) WT.custom_calendar.months[idx].days = Math.min(400, Math.max(1, parseInt(el.value) || 1)); break;
        case "wzLineName": if (WT.timelines && WT.timelines[lineId]) WT.timelines[lineId].name = el.value; break;
        case "wzLineEra": if (WT.timelines && WT.timelines[lineId]) WT.timelines[lineId].era_label = el.value; break;
        case "wzLineWeather": if (WT.timelines && WT.timelines[lineId]) WT.timelines[lineId].weather = el.value; break;
        case "wzLineMonth": if (WT.timelines && WT.timelines[lineId]) { if (!WT.timelines[lineId].calendar_start) WT.timelines[lineId].calendar_start = {}; WT.timelines[lineId].calendar_start.month = el.value === "" ? null : Math.min(12, Math.max(1, parseInt(el.value) || 1)); } break;
        case "wzLineDay": if (WT.timelines && WT.timelines[lineId]) { if (!WT.timelines[lineId].calendar_start) WT.timelines[lineId].calendar_start = {}; WT.timelines[lineId].calendar_start.date = el.value === "" ? null : Math.max(1, parseInt(el.value) || 1); } break;
        case "wzSyncRatio": if (WT.timelines && WT.timelines[lineId] && WT.timelines[lineId].sync_rules[sidx]) WT.timelines[lineId].sync_rules[sidx].ratio = Math.max(0.01, parseFloat(el.value) || 1); break;
        case "wzDlTitle": if (WT.deadlines[idx]) WT.deadlines[idx].title = el.value; break;
        case "wzDlDay": if (WT.deadlines[idx]) WT.deadlines[idx].day = el.value === "" ? 0 : Math.max(0, parseInt(el.value) || 0); break;
        default: break;
    }
}

function rerenderCc() {
    const el = document.getElementById("wzCcEditor");
    if (el) el.innerHTML = ccMonthsHTML(WT.custom_calendar);
}
function rerenderMv() {
    const el = document.getElementById("wzMvEditor");
    if (el) el.innerHTML = mvLinesHTML();
}
function rerenderDl() {
    const el = document.getElementById("wzDlList");
    if (el) el.innerHTML = dlRowsHTML();
}
