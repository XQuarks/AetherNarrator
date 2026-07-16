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
import { createOrUpdateSave } from "./save.js";
import { saveWorlds } from "./storage.js";
import { isEnhancementContextCurrent } from "./worldview.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { callLoreRevisionLLM } from "./llm.js";
import { invalidateSystemPromptCache } from "./prompt.js";

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
const CLOCK_LABELS = { period: "时段标签", clock: "具体时钟", none: "不显示时刻" };

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

function renderLoreReviewBody() {
    const body = document.getElementById("loreReviewBody");
    if (!body) return;
    const list = S._loreEdit || [];
    const timeSection = renderTimeConfigSection(S._loreEditingWorldDefault ? "world" : "save");

    // B5：若有 AI 修订缓冲，顶部展示修订提示
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

    // ★ B8：防剧透遮罩开关
    const spoilerBtn = `<div class="spoiler-toggle" data-action="toggleLoreSpoiler">${S.loreSpoilerHidden ? "🔒 内容已隐藏（点击查看）" : "🔓 已显示全部"}</div>`;
    const spoilerClass = S.loreSpoilerHidden ? " lore-spoiler" : "";

    const rows = list.map((s, i) => {
        const mode = s.trigger_mode || (s.activation_keys && s.activation_keys.length ? "keyword" : "always");
        const pos = ["system", "author_note", "before_user", "after_user"].includes(s.insert_at) ? s.insert_at : "before_user"; // ★ P0-2
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
                <label>位置
                    <select id="le_pos_${i}" class="lore-inp lore-sel" title="命中后注入到哪个位置">
                        <option value="before_user"${pos === "before_user" ? " selected" : ""}>用户输入前</option>
                        <option value="after_user"${pos === "after_user" ? " selected" : ""}>用户输入后</option>
                        <option value="author_note"${pos === "author_note" ? " selected" : ""}>作者注</option>
                        <option value="system"${pos === "system" ? " selected" : ""}>系统</option>
                    </select>
                </label>
                <label>优先级<input id="le_pri_${i}" class="lore-inp lore-pri" type="number" value="${Number(s.priority) || 0}"></label>
                <label>扫描深度<input id="le_depth_${i}" class="lore-inp lore-pri" type="number" min="1" max="10" value="${Number(s.scan_depth) || 1}"></label>
                <label>关联<input id="le_links_${i}" class="lore-inp" value="${escapeHtml((s.links || []).map(l => `${l.target}:${l.relation || 'related'}`).join('，'))}" placeholder="目标ID:关系"></label>
            </div>
            ${(s.links && s.links.length) ? `<div class="lore-links">${s.links.map(l => `<span class="lore-link-tag">→ ${escapeHtml(l.target)}（${escapeHtml(LINK_RELATION_LABELS[l.relation] || l.relation)}）</span>`).join(" ")}</div>` : ""}
        </div>`;
    }).join("");
    body.innerHTML = timeSection + spoilerBtn + revisionHint + warnHtml + `<div style="margin-bottom:10px"><button class="btn secondary" data-action="showLoreGraph" style="font-size:12px;padding:4px 12px;">🔗 查看关联图</button></div>` + (rows || `<p style="color:var(--text-secondary);">暂无条目，点下方"添加条目"新建。</p>`);
}

export function openLoreReview(mode = "save") {
    if (!S.currentWorld) { showToast("请先选择一个世界", "warn"); return; }
    S._loreEditingWorldDefault = mode === "world";
    const title = document.getElementById("loreReviewModalTitle");
    if (title) title.textContent = mode === "world" ? "编辑新周目默认知识库" : "当前存档知识库";
    // ★ 步骤二：时间体系已作为卡片直接渲染在初览面板顶部（renderTimeConfigSection）；world 模式可编辑，save 模式只读锁定
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
    S.activeLoreKB = deepClone(w.lore_kb || { ip: w.name || "", snippets: [] });
    closeModal("worldDetailModal");
    openLoreReview("world");
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
