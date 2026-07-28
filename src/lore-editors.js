// ============================================================
// AetherNarrator · lore-editors.js（由 lore-ui.js 拆分：世界配置编辑器）
// 说明：聚合「规则 DSL / 人物卡 / 玩家变量 / 初始物品」四个独立编辑器弹窗，
// 均为『草稿缓冲 → 保存写回 world.xxx』同一模式，互不依赖，也不依赖 lore-ui。
// ============================================================
import { S, defaultCharacter, ensureWorldCharacters } from "./store.js";
import { deepClone, escapeHtml } from "./utils.js";
import { showModal, closeModal, showToast } from "./render.js";
import { saveWorlds } from "./storage.js";
import { generateCharacters } from "./llm.js";
import { invalidateSystemPromptCache, invalidateCharactersCache } from "./prompt.js";

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
    body.innerHTML = `<div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addRule">＋ 添加规则</button></div>` + html;
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

// ============================================================
// ★ B1：人物卡编辑（角色卡）
// ============================================================

// 从 DOM 把当前编辑内容读回 S._charEdit（add/delete/save 前调用，避免丢失未保存的改动）
function syncCharacterForm() {
    if (!Array.isArray(S._charEdit)) return;
    S._charEdit.forEach((c, i) => {
        const v = id => { const el = document.getElementById(id); return el ? el.value : ""; };
        const roleEl = document.getElementById("ch_role_" + i);
        c.role = (roleEl && roleEl.value) || c.role || "npc";
        c.name = v("ch_name_" + i);
        c.identity = v("ch_identity_" + i);
        c.gender_age = v("ch_gender_age_" + i);
        c.appearance = v("ch_appearance_" + i);
        c.personality = v("ch_personality_" + i);
        c.motivation = v("ch_motivation_" + i);
        c.relationship = v("ch_relationship_" + i);
        const affEl = document.getElementById("ch_affinity_" + i);
        c.affinity = affEl ? Number(affEl.value) : (typeof c.affinity === "number" ? c.affinity : 0);
        const tagEl = document.getElementById("ch_rel_tags_" + i);
        c.rel_tags = tagEl ? String(tagEl.value).split(/[,，]/).map(t => t.trim()).filter(Boolean) : (Array.isArray(c.rel_tags) ? c.rel_tags : []);
        c.attitude = v("ch_attitude_" + i);
        c.current_state = v("ch_current_state_" + i);
        c.voice = v("ch_voice_" + i);
        c.untouchable = v("ch_untouchable_" + i);
        c.notes = v("ch_notes_" + i);
    });
}

export function openCharacterEditor(worldId) {
    const w = S.worlds.find(x => x.id === worldId) || S.currentWorld;
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    ensureWorldCharacters(w);
    S._charEdit = deepClone(w.characters);
    S._charActiveIndex = S._charEdit.length ? 0 : -1;
    renderCharacterEditorBody();
    showModal("characterEditorModal");
}

function renderCharacterEditorBody() {
    const body = document.getElementById("characterEditorBody");
    if (!body) return;
    const list = S._charEdit || [];
    if (!list.length) {
        body.innerHTML = `<p class="muted">还没有角色卡。点下方「＋ 添加角色」，或点「🤖 AI 生成」让 AI 依据世界观草拟几张。</p>
            <div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addCharacter">＋ 添加角色</button></div>`;
        return;
    }
    let html = `<div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addCharacter">＋ 添加角色</button></div>`;
    list.forEach((c, i) => {
        const isP = c.role === "protagonist";
        html += `<div class="char-card">
            <div class="char-card-head">
                <select id="ch_role_${i}" class="char-role-select">
                    <option value="protagonist" ${isP ? "selected" : ""}>主角</option>
                    <option value="npc" ${!isP ? "selected" : ""}>NPC</option>
                </select>
                <input id="ch_name_${i}" class="char-name" placeholder="姓名（主角可留空）" value="${escapeHtml(c.name || "")}">
                <button class="btn-secondary-sm danger" data-action="deleteCharacter" data-idx="${i}">删除</button>
            </div>
            <div class="char-grid">
                <div class="form-group"><label>身份</label><input id="ch_identity_${i}" value="${escapeHtml(c.identity || "")}"></div>
                <div class="form-group"><label>性别/年龄</label><input id="ch_gender_age_${i}" value="${escapeHtml(c.gender_age || "")}"></div>
            </div>
            <div class="form-group"><label>外貌</label><textarea id="ch_appearance_${i}" rows="2">${escapeHtml(c.appearance || "")}</textarea></div>
            <div class="form-group"><label>性格</label><textarea id="ch_personality_${i}" rows="2">${escapeHtml(c.personality || "")}</textarea></div>
            <div class="form-group"><label>核心目标 / 动机</label><textarea id="ch_motivation_${i}" rows="2">${escapeHtml(c.motivation || "")}</textarea></div>
            <div class="char-npc-only">
                <div class="muted" style="font-size:12px;margin:4px 0;">NPC 专属</div>
                <div class="char-grid">
                    <div class="form-group"><label>与主角关系</label><input id="ch_relationship_${i}" value="${escapeHtml(c.relationship || "")}"></div>
                    <div class="form-group"><label>对主角态度</label><input id="ch_attitude_${i}" value="${escapeHtml(c.attitude || "")}"></div>
                </div>
                <div class="char-grid">
                    <div class="form-group"><label>初始好感度（-100~100）</label><input id="ch_affinity_${i}" type="number" min="-100" max="100" value="${typeof c.affinity === "number" ? c.affinity : 0}"></div>
                    <div class="form-group"><label>关系标签（逗号分隔）</label><input id="ch_rel_tags_${i}" value="${escapeHtml(Array.isArray(c.rel_tags) ? c.rel_tags.join("、") : "")}"></div>
                </div>
                <div class="form-group"><label>当前状态 / 所在</label><input id="ch_current_state_${i}" value="${escapeHtml(c.current_state || "")}"></div>
                <div class="form-group"><label>声音标签 / 说话方式</label><input id="ch_voice_${i}" value="${escapeHtml(c.voice || "")}"></div>
            </div>
            <div class="form-group"><label>不可触碰设定（红线，AI 不得违背）</label><textarea id="ch_untouchable_${i}" rows="2">${escapeHtml(c.untouchable || "")}</textarea></div>
            <div class="form-group"><label>自由备注（给 AI 的额外发挥空间）</label><textarea id="ch_notes_${i}" rows="2">${escapeHtml(c.notes || "")}</textarea></div>
        </div>`;
    });
    body.innerHTML = html;
}

export function addCharacter() {
    syncCharacterForm();
    if (!Array.isArray(S._charEdit)) S._charEdit = [];
    S._charEdit.push(defaultCharacter("npc"));
    S._charActiveIndex = S._charEdit.length - 1;
    renderCharacterEditorBody();
}

export function deleteCharacter(idx) {
    syncCharacterForm();
    const i = parseInt(idx);
    if (Array.isArray(S._charEdit) && i >= 0 && i < S._charEdit.length) {
        S._charEdit.splice(i, 1);
        if (S._charActiveIndex >= S._charEdit.length) S._charActiveIndex = S._charEdit.length - 1;
        renderCharacterEditorBody();
    }
}

export function saveCharacterReview() {
    syncCharacterForm();
    if (!S.currentWorld) { closeModal("characterEditorModal"); return; }
    const list = (S._charEdit || []).filter(c =>
        c.role === "protagonist" || (c.name && c.name.trim()) || (c.identity && c.identity.trim()) || (c.notes && c.notes.trim())
    );
    const cleaned = list.map(c => {
        const o = { ...c };
        ["name", "identity", "gender_age", "appearance", "personality", "motivation", "relationship", "attitude", "current_state", "voice", "untouchable", "notes"]
            .forEach(k => { if (typeof o[k] === "string") o[k] = o[k].trim().slice(0, 1000); });
        // ★ B4：好感度数字夹取 [-100,100]；关系标签确保为数组
        if (typeof o.affinity !== "number" || !isFinite(o.affinity)) o.affinity = 0;
        else o.affinity = Math.max(-100, Math.min(100, o.affinity));
        if (!Array.isArray(o.rel_tags)) o.rel_tags = [];
        if (!o.id) o.id = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        return o;
    });
    ensureWorldCharacters(S.currentWorld);
    S.currentWorld.characters = cleaned;
    saveWorlds();
    invalidateCharactersCache();   // ★ 角色卡变更 → 仅重建角色卡缓存断点（L1 core / 知识库硬约束段缓存保留）
    S._charEdit = null;
    S._charActiveIndex = -1;
    closeModal("characterEditorModal");
    showToast(`角色卡已保存（${cleaned.length} 张）`, "success");
}

export async function generateCharactersAI() {
    syncCharacterForm();
    const w = S.currentWorld;
    if (!w) { showToast("未找到当前世界", "error"); return; }
    showToast("AI 正在依据世界观草拟角色卡…", "info", 3000);
    try {
        const generated = await generateCharacters(w);
        if (!generated || !generated.length) {
            showToast("AI 未返回可用角色卡（可能未配置 API 或处于模拟模式）", "warn");
            return;
        }
        if (!Array.isArray(S._charEdit)) S._charEdit = [];
        const existing = new Set(S._charEdit.map(c => (c.name || "").trim()));
        let added = 0;
        for (const g of generated) {
            if (g && g.name && !existing.has(g.name.trim())) {
                const card = Object.assign(defaultCharacter(g.role === "protagonist" ? "protagonist" : "npc"), g);
                if (!card.id) card.id = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
                S._charEdit.push(card);
                existing.add(g.name.trim());
                added++;
            }
        }
        renderCharacterEditorBody();
        showToast(`AI 已生成 ${added} 张新角色卡（可继续编辑后保存）`, "success");
    } catch (e) {
        showToast("AI 生成失败：" + (e && e.message || "未知错误"), "error");
    }
}

// ============================================================
// ★ B2：玩家变量编辑器（世界详情「变量」页签 → variableEditorModal）
// 字段：id / name / type(number|text|toggle) / default / min / max / unit / desc / enabled
// ============================================================

export function openVariableEditor(worldId) {
    const w = S.worlds.find(x => x.id === worldId) || S.currentWorld;
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    if (!Array.isArray(w.variable_schema)) w.variable_schema = [];
    S._varEdit = deepClone(w.variable_schema);
    renderVariableEditorBody();
    showModal("variableEditorModal");
}

function syncVariableForm() {
    if (!Array.isArray(S._varEdit)) S._varEdit = [];
    S._varEdit = S._varEdit.map((v, i) => {
        const type = (document.getElementById("var_type_" + i) || {}).value || v.type || "number";
        const defRaw = (document.getElementById("var_default_" + i) || {}).value;
        let def;
        if (type === "number") def = defRaw === "" ? (typeof v.default === "number" ? v.default : 0) : parseFloat(defRaw);
        else if (type === "toggle") def = (document.getElementById("var_default_toggle_" + i) || {}).checked;
        else def = defRaw;
        const minRaw = (document.getElementById("var_min_" + i) || {}).value;
        const maxRaw = (document.getElementById("var_max_" + i) || {}).value;
        return {
            id: (document.getElementById("var_id_" + i) || {}).value || v.id || "",
            name: (document.getElementById("var_name_" + i) || {}).value || v.name || "",
            type,
            default: def,
            min: minRaw === "" ? undefined : parseFloat(minRaw),
            max: maxRaw === "" ? undefined : parseFloat(maxRaw),
            unit: (document.getElementById("var_unit_" + i) || {}).value || "",
            desc: (document.getElementById("var_desc_" + i) || {}).value || "",
            enabled: !((document.getElementById("var_enabled_" + i) || {}).checked === false)
        };
    });
}

function renderVariableEditorBody() {
    const body = document.getElementById("variableEditorBody");
    if (!body) return;
    const list = S._varEdit || [];
    if (!list.length) {
        body.innerHTML = `<p class="muted">该世界还没有玩家变量（默认无数字压力）。点下方「＋ 添加变量」创建一个，例如「理智」「金钱」「体力」。</p>
            <div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addVariable">＋ 添加变量</button></div>`;
        return;
    }
    let html = `<div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addVariable">＋ 添加变量</button></div>`;
    list.forEach((v, i) => {
        const isNum = v.type === "number";
        const isTog = v.type === "toggle";
        html += `<div class="char-card">
            <div class="char-card-head">
                <input id="var_id_${i}" class="char-role-select" style="width:120px" placeholder="变量键(id)" value="${escapeHtml(v.id || "")}">
                <input id="var_name_${i}" class="char-name" placeholder="展示名（如 理智）" value="${escapeHtml(v.name || "")}">
                <select id="var_type_${i}" class="char-role-select">
                    <option value="number" ${isNum ? "selected" : ""}>数值</option>
                    <option value="text" ${v.type === "text" ? "selected" : ""}>文本</option>
                    <option value="toggle" ${isTog ? "selected" : ""}>开关</option>
                </select>
                <label class="char-role-select" style="display:flex;align-items:center;gap:4px;font-size:12px"><input id="var_enabled_${i}" type="checkbox" ${v.enabled !== false ? "checked" : ""}>启用</label>
                <button class="btn-secondary-sm danger" data-action="deleteVariable" data-idx="${i}">删除</button>
            </div>
            <div class="char-grid">
                ${isNum ? `
                    <div class="form-group"><label>默认值</label><input id="var_default_${i}" type="number" value="${typeof v.default === "number" ? v.default : 0}"></div>
                    <div class="form-group"><label>最小值</label><input id="var_min_${i}" type="number" placeholder="可选" value="${typeof v.min === "number" ? v.min : ""}"></div>
                    <div class="form-group"><label>最大值</label><input id="var_max_${i}" type="number" placeholder="可选" value="${typeof v.max === "number" ? v.max : ""}"></div>
                    <div class="form-group"><label>单位</label><input id="var_unit_${i}" placeholder="如 % / 点" value="${escapeHtml(v.unit || "")}"></div>
                ` : isTog ? `
                    <div class="form-group"><label>默认状态</label><label style="display:flex;align-items:center;gap:6px"><input id="var_default_toggle_${i}" type="checkbox" ${v.default === true ? "checked" : ""}>默认开启</label></div>
                ` : `
                    <div class="form-group"><label>默认值</label><input id="var_default_${i}" value="${escapeHtml(typeof v.default === "string" ? v.default : "")}"></div>
                `}
            </div>
            <div class="form-group"><label>说明（注入 AI，可选）</label><input id="var_desc_${i}" placeholder="如：理性与精神稳定度，归零将陷入疯狂" value="${escapeHtml(v.desc || "")}"></div>
        </div>`;
    });
    body.innerHTML = html;
}

export function addVariable() {
    syncVariableForm();
    if (!Array.isArray(S._varEdit)) S._varEdit = [];
    S._varEdit.push({ id: "", name: "", type: "number", default: 0, min: 0, max: 100, unit: "%", desc: "", enabled: true });
    renderVariableEditorBody();
}

export function deleteVariable(idx) {
    syncVariableForm();
    const i = parseInt(idx);
    if (Array.isArray(S._varEdit) && i >= 0 && i < S._varEdit.length) {
        S._varEdit.splice(i, 1);
        renderVariableEditorBody();
    }
}

export function saveVariableReview() {
    syncVariableForm();
    if (!S.currentWorld) { closeModal("variableEditorModal"); return; }
    const list = (S._varEdit || []).filter(v => v.id && v.id.trim() && v.name && v.name.trim());
    // 校验 id 唯一
    const seen = new Set();
    for (const v of list) {
        if (seen.has(v.id)) { showToast(`变量键「${v.id}」重复，请修改为唯一`, "error"); return; }
        seen.add(v.id);
    }
    const cleaned = list.map(v => {
        const o = { ...v };
        o.id = o.id.trim();
        o.name = o.name.trim();
        o.desc = (o.desc || "").trim();
        if (o.type === "number") {
            o.default = Number.isFinite(o.default) ? o.default : 0;
            if (typeof o.min !== "number") delete o.min;
            if (typeof o.max !== "number") delete o.max;
        } else if (o.type === "toggle") {
            o.default = o.default === true;
            delete o.min; delete o.max; delete o.unit;
        } else {
            o.default = String(o.default == null ? "" : o.default);
            delete o.min; delete o.max; delete o.unit;
        }
        if (!o.unit) delete o.unit;
        return o;
    });
    if (!Array.isArray(S.currentWorld.variable_schema)) S.currentWorld.variable_schema = [];
    S.currentWorld.variable_schema = cleaned;
    saveWorlds();
    invalidateSystemPromptCache(); // ★ 变量定义变更 → 重建 system 前缀缓存（定义是静态段）
    S._varEdit = null;
    closeModal("variableEditorModal");
    showToast(`玩家变量已保存（${cleaned.length} 个）`, "success");
}

// ★ B3：初始物品编辑器（世界详情「物品」页签 → itemEditorModal）
// 字段：item_id / name / count / category(枚举) / is_key / tags(解锁标签)
// 保存改 world.initial_state.inventory（世界定义），不影响当前运行中的 S.gameState。
// ============================================================

const ITEM_CATEGORIES = ["武器", "装备", "消耗品", "线索", "书籍", "货币", "其他"];

export function openItemEditor(worldId) {
    const w = S.worlds.find(x => x.id === worldId) || S.currentWorld;
    if (!w) { showToast("未找到该世界", "error"); return; }
    S.currentWorld = w;
    if (!w.initial_state || !Array.isArray(w.initial_state.inventory)) {
        if (!w.initial_state) w.initial_state = {};
        w.initial_state.inventory = [];
    }
    S._itemEdit = deepClone(w.initial_state.inventory);
    renderItemEditorBody();
    showModal("itemEditorModal");
}

function syncItemForm() {
    if (!Array.isArray(S._itemEdit)) S._itemEdit = [];
    S._itemEdit = S._itemEdit.map((v, i) => {
        const countRaw = (document.getElementById("item_count_" + i) || {}).value;
        const tagsRaw = (document.getElementById("item_tags_" + i) || {}).value || "";
        return {
            item_id: (document.getElementById("item_id_" + i) || {}).value || v.item_id || "",
            name: (document.getElementById("item_name_" + i) || {}).value || v.name || "",
            count: countRaw === "" ? 1 : Math.max(0, parseInt(countRaw) || 0),
            category: (document.getElementById("item_cat_" + i) || {}).value || v.category || "其他",
            is_key: !!((document.getElementById("item_key_" + i) || {}).checked),
            tags: tagsRaw.split(/[,，]/).map(t => t.trim()).filter(Boolean)
        };
    });
}

function renderItemEditorBody() {
    const body = document.getElementById("itemEditorBody");
    if (!body) return;
    const list = S._itemEdit || [];
    if (!list.length) {
        body.innerHTML = `<p class="muted">该世界开局还没有初始物品（默认空背包，物品主要由剧情动态授予）。点下方「＋ 添加物品」配置开局携带物，例如「符文钥匙（关键）」「干粮（消耗品）」。</p>
            <div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addItem">＋ 添加物品</button></div>`;
        return;
    }
    let html = `<div class="rule-toolbar"><button class="btn-secondary-sm" data-action="addItem">＋ 添加物品</button></div>`;
    list.forEach((v, i) => {
        const catOpts = ITEM_CATEGORIES.map(c => `<option value="${c}" ${v.category === c ? "selected" : ""}>${c}</option>`).join("");
        html += `<div class="char-card">
            <div class="char-card-head">
                <input id="item_id_${i}" class="char-role-select" style="width:120px" placeholder="物品键(id)" value="${escapeHtml(v.item_id || "")}">
                <input id="item_name_${i}" class="char-name" placeholder="展示名（如 符文钥匙）" value="${escapeHtml(v.name || "")}">
                <input id="item_count_${i}" class="char-role-select" style="width:64px" type="number" min="0" placeholder="数量" value="${typeof v.count === "number" ? v.count : 1}">
                <select id="item_cat_${i}" class="char-role-select">${catOpts}</select>
                <label class="char-role-select" style="display:flex;align-items:center;gap:4px;font-size:12px"><input id="item_key_${i}" type="checkbox" ${v.is_key === true ? "checked" : ""}>关键</label>
                <button class="btn-secondary-sm danger" data-action="deleteItem" data-idx="${i}">删除</button>
            </div>
            <div class="form-group"><label>解锁标签（逗号分隔，可选，如 has_firearm 持有期解锁禁项）</label><input id="item_tags_${i}" placeholder="如 has_firearm" value="${escapeHtml(Array.isArray(v.tags) ? v.tags.join(",") : "")}"></div>
        </div>`;
    });
    body.innerHTML = html;
}

export function addItem() {
    syncItemForm();
    if (!Array.isArray(S._itemEdit)) S._itemEdit = [];
    S._itemEdit.push({ item_id: "", name: "", count: 1, category: "其他", is_key: false, tags: [] });
    renderItemEditorBody();
}

export function deleteItem(idx) {
    syncItemForm();
    const i = parseInt(idx);
    if (Array.isArray(S._itemEdit) && i >= 0 && i < S._itemEdit.length) {
        S._itemEdit.splice(i, 1);
        renderItemEditorBody();
    }
}

export function saveItemReview() {
    syncItemForm();
    if (!S.currentWorld) { closeModal("itemEditorModal"); return; }
    const list = (S._itemEdit || []).filter(v => v.item_id && v.item_id.trim() && v.name && v.name.trim());
    const seen = new Set();
    for (const v of list) {
        if (seen.has(v.item_id)) { showToast(`物品键「${v.item_id}」重复，请修改为唯一`, "error"); return; }
        seen.add(v.item_id);
    }
    const cleaned = list.map(v => ({
        item_id: v.item_id.trim(),
        name: v.name.trim(),
        count: (typeof v.count === "number" && v.count > 0) ? v.count : 1,
        category: ITEM_CATEGORIES.includes(v.category) ? v.category : "其他",
        is_key: v.is_key === true,
        tags: Array.isArray(v.tags) ? v.tags : []
    }));
    if (!S.currentWorld.initial_state || typeof S.currentWorld.initial_state !== "object") S.currentWorld.initial_state = {};
    S.currentWorld.initial_state.inventory = cleaned;
    saveWorlds();
    S._itemEdit = null;
    closeModal("itemEditorModal");
    showToast(`初始物品已保存（${cleaned.length} 个）`, "success");
}

