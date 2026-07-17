// ============================================================
// AetherNarrator · lore-ui.js（由 game.js 拆分：知识库编辑 UI）
// 说明：聚合「知识库初览/编辑/修订 + 关联图谱」相关函数。
// 仅依赖 rag / render / store / utils / worldview / lore-revision / llm / prompt / save，
// 不反向依赖 game.js，避免循环引用。
// ============================================================
import { S, LINK_RELATION_LABELS, DEFAULT_TIME_CONFIG, normalizeTimeConfig } from "./store.js";
import { deepClone, escapeHtml, getWorldSchema, defaultWorldSchema } from "./utils.js";
import { showModal, closeModal, showToast } from "./render.js";
import { getWorldLoreKB, ensureLoreEmbeddings } from "./rag.js";
import { createOrUpdateSave, prepareSessionFromSave } from "./save.js";
import { migrateSaveRecord } from "./migrations.js";
import { saveWorlds } from "./storage.js";
import { isEnhancementContextCurrent } from "./worldview.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { callLoreRevisionLLM } from "./llm.js";
import { invalidateSystemPromptCache } from "./prompt.js";
import { renderLoreMarkdown } from "./markdown.js"; // ★ 步骤 B：Obsidian 风 markdown 渲染封装

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
    for (const [k, n] of Object.entries(keyCount)) {
        if (n > 1) warns.push(`触发词「${k}」在 ${n} 条里重复，可能导致过度触发`);
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
    return `<div class="time-cfg-card">
        <div class="time-cfg-head">🌐 世界时间体系 <span class="time-cfg-ai">⚙️ AI 已按世界观自动设定，可在此微调</span></div>
        <div class="time-cfg-grid">
            <div class="form-group"><label>纪元 / 年份</label><input id="tc_era" maxlength="40" value="${escapeHtml(cfg.era_label || "")}" placeholder="例如：大清乾隆年间"></div>
            <div class="form-group"><label>历法</label><select id="tc_calendar">${calOpts}</select></div>
            <div class="form-group"><label>时钟</label><select id="tc_clock">${clkOpts}</select></div>
            <div class="form-group"><label>季节</label><input id="tc_season" maxlength="10" value="${escapeHtml(cfg.season || "")}" placeholder="例如：仲春"></div>
            <div class="form-group"><label>当前天气</label><input id="tc_weather" maxlength="20" value="${escapeHtml(cfg.weather || "")}" placeholder="例如：细雨"></div>
            <div class="form-group time-cfg-show"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="tc_show" style="width:auto;" ${cfg.show !== false ? "checked" : ""}><span>在界面显示世界时间</span></label></div>
        </div>
        <p class="time-cfg-hint">此设定仅在创建本世界时可调整；进入游戏后将锁定，不可实时修改。</p>
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

// 切视图前把时间表单值写回 schema，避免 InnerHTML 重渲染丢失编辑
function syncTimeConfigFromDOM() {
    if (!S._loreEditingWorldDefault) return;
    const era = document.getElementById("tc_era");
    if (!era) return;
    const tc = (S.currentWorld && S.currentWorld.schema && S.currentWorld.schema.time_config) || {};
    tc.era_label = era.value.trim().slice(0, 40);
    tc.calendar_mode = document.getElementById("tc_calendar")?.value || "day";
    tc.clock_mode = document.getElementById("tc_clock")?.value || "period";
    tc.season = document.getElementById("tc_season")?.value.trim().slice(0, 10);
    tc.weather = document.getElementById("tc_weather")?.value.trim().slice(0, 20);
    tc.show = !!document.getElementById("tc_show")?.checked;
    if (!S.currentWorld.schema) S.currentWorld.schema = {};
    S.currentWorld.schema.time_config = tc;
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
        ? `<div class="lore-warn"><strong>⚠ 质量提示（${warns.length}）</strong><ul>${warns.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
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
            <aside class="lore-tree">${tree}</aside>
            <section class="lore-note">${noteHtml}</section>
            <aside class="lore-backlinks">${backHtml}</aside>
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
            <canvas id="loreGraphCanvas"></canvas>
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
    const save = stored ? migrateSaveRecord(stored, S.worlds.find(w => w.id === stored.worldId)) : null;
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
            showToast("知识库已可修订——AI 建议调整 " + count + " 条条目。进入知识库编辑面板查看。", "success", 5000);
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
    S._loreRevisionBuffer = null;
    createOrUpdateSave();
    closeModal("loreReviewModal");
    invalidateSystemPromptCache();
    showToast("知识库已更新！", "success");
}

// ★ B5：拒绝修订——丢弃缓冲
export function rejectLoreRevision() {
    S._loreRevisionBuffer = null;
    createOrUpdateSave();
    showToast("已丢弃本次 AI 修订建议", "success");
}

// ★ B8：防剧透遮罩开关
export function toggleLoreSpoiler() {
    S.loreSpoilerHidden = !S.loreSpoilerHidden;
    renderLoreReviewBody();
}

// ★ C：世界观图谱总览（力导向布局 canvas，布局/绘制分离 + 缩放平移 + 类别着色 + 点击开笔记）
// 颜色：节点按类别着色，边按关系着色（与 store.js 的 LINK_RELATION_LABELS 对齐）
const LORE_CATEGORY_COLORS = {
    "规则": "#e0584f", "世界观": "#5b86e0", "地点": "#3fb98f", "人物": "#b96fd6",
    "事件": "#e0a93f", "物品": "#3fb6e0", "势力": "#e06fa0", "冲突": "#e07a4f", "补充": "#9aa0a6"
};
const FALLBACK_CAT_COLOR = "#9aa0a6";
const REL_COLORS = { causal: "#ff6464", related: "#6496ff", explains: "#64c864", contains: "#c8b464" };

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
    bindGraphUI(); // canvas 每次重建，需重新绑定事件
    buildGraph(snippets);
}

function buildGraph(snippets) {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || 680, H = rect.height || 460;
    canvas.width = W * dpr; canvas.height = H * dpr;

    const snippetById = {};
    const nodes = snippets.map((s, i) => {
        snippetById[s.id] = s;
        const angle = (i / snippets.length) * Math.PI * 2;
        const r = Math.min(W, H) * 0.32;
        return {
            id: s.id,
            label: s.title || s.id,
            category: s.category || "补充",
            color: LORE_CATEGORY_COLORS[s.category] || FALLBACK_CAT_COLOR,
            x: Math.cos(angle) * r + (Math.random() - 0.5) * 20,
            y: Math.sin(angle) * r + (Math.random() - 0.5) * 20,
            vx: 0, vy: 0, degree: 0
        };
    });
    const idIndex = {};
    nodes.forEach((n, i) => idIndex[n.id] = i);

    const edges = [];
    for (const s of snippets) {
        if (!s.links || !s.links.length) continue;
        for (const l of s.links) {
            if (l.target in idIndex) {
                const ai = idIndex[s.id], bi = idIndex[l.target];
                edges.push({ ai, bi, relation: l.relation || "related" });
                nodes[ai].degree++; nodes[bi].degree++;
            }
        }
    }
    // 邻接表（悬停高亮用）
    const adj = nodes.map(() => new Set());
    edges.forEach(e => { adj[e.ai].add(e.bi); adj[e.bi].add(e.ai); });

    G = {
        canvas, ctx: canvas.getContext("2d"), dpr, W, H,
        cx: W / 2, cy: H / 2,
        nodes, edges, adj, snippetById, idIndex,
        view: { scale: 1, offsetX: 0, offsetY: 0 },
        hover: null, dragNode: null, panning: false,
        grabWX: 0, grabWY: 0, downX: 0, downY: 0, moved: false,
        running: true, rafId: null, tick: 0, MAX_TICK: 360
    };
    buildLegend(nodes);
    document.getElementById("graphStats").textContent = `${nodes.length} 节点 · ${edges.length} 关联`;
    document.getElementById("graphInfo").textContent = "";
    startSim();
}

function buildLegend(nodes) {
    const cats = {};
    nodes.forEach(n => { cats[n.category] = n.color; });
    const catHtml = Object.entries(cats).map(([c, col]) =>
        `<span class="legend-item"><i class="legend-dot" style="background:${col}"></i>${escapeHtml(c)}</span>`).join("");
    const relHtml = Object.entries(REL_COLORS).map(([r, col]) =>
        `<span class="legend-item"><i class="legend-line" style="background:${col}"></i>${LINK_RELATION_LABELS[r] || r}</span>`).join("");
    document.getElementById("graphLegend").innerHTML = `<div class="legend-group">${catHtml}</div><div class="legend-group">${relHtml}</div>`;
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
        ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y);
        ctx.strokeStyle = REL_COLORS[e.relation] || "#888";
        ctx.globalAlpha = hoverId == null ? 0.55 : (active ? 0.95 : 0.12);
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();
    }
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
        if (G.dragNode && !G.moved && dist < 5) focusLoreSnippet(G.dragNode.id); // 单击节点 → 打开笔记
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

    // 预览卡交互（document 委托，兼容图谱 tab 反复重建）
    if (!bindGraphUI._previewBound) {
        bindGraphUI._previewBound = true;
        document.addEventListener("click", e => {
            const closeBtn = e.target.closest("[data-graph-close]");
            if (closeBtn) { const pc = document.getElementById("graphPreview"); if (pc) pc.hidden = true; return; }
            const openBtn = e.target.closest("[data-graph-open]");
            if (openBtn) { openNodeInKB(openBtn.dataset.graphOpen); }
        });
    }
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
