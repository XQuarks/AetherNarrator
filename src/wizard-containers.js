// ============================================================
// docs/60 · 创建向导「叙事结构化容器」前置平台（src/wizard-containers.js）
// ------------------------------------------------------------
// 自包含的向导容器系统：玩家在「创建世界」阶段即可预置
//   B1 人物卡+B4 羁绊好感度 / B2 玩家变量 / B3 背包 / 技能 / 目标 / 支线事件
// 每个容器一张卡片，顶部统一三模式工具栏：
//   [＋ 添加]  [🤖 AI 从零生成]  [✨ AI 完善]  [🗑 清空]
// 设计要点：
//   - 手动编辑的"真源"是 DOM（输入即存），避免双份缓冲不同步。
//   - AI 生成复用 src/llm.js 的生成器（传最小 world 上下文，不依赖 S.currentWorld），无 API/失败安全返回空，绝不阻断建世界。
//   - getWizardContainers() 返回 { data, locked, enableModules } 供 game.js 合并进新世界（玩家配置=权威，未配=AI 兜底）。
// ============================================================
import { deepClone, escapeHtml as escUtil } from "./utils.js";
import { showToast } from "./render.js";
import { getModuleById } from "./modules.js"; // ★ docs/61：模块门禁（编辑器显隐依赖模块开关）
import {
    generateCharacters,
    generateVariables,
    generateInventory,
    generateSkills,
    generateGoals,
    generateSideEvents
} from "./llm.js";

// ---------- 内部缓冲（手动编辑统一写回这里，AI 操作也经此合并） ----------
let WC = freshBuffer();
// 条目展开状态（key -> bool[]）：默认折叠成一行摘要，点击标题行展开编辑
let WC_EXPANDED = {};

function freshBuffer() {
    return {
        characters: [],
        variables: [],
        inventory: [],
        skills: [],
        goals: [],
        sideEvents: []
    };
}

// 取某容器的展开状态数组（与 WC[key] 等长，缺省 false=折叠）
function expandedArr(key) {
    const list = WC[key] || [];
    const arr = WC_EXPANDED[key] || [];
    while (arr.length < list.length) arr.push(false);
    arr.length = list.length;
    WC_EXPANDED[key] = arr;
    return arr;
}

function esc(s) {
    return escUtil ? escUtil(s) : String(s == null ? "" : s)
        .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
// 容器配置（schema 驱动渲染，减少 7 个容器的重复代码）
// ============================================================
const SELECT = (k, id, val, opts) =>
    `<select id="${id}" data-wc-field="${k}" class="wc-inp">` +
    opts.map(o => `<option value="${esc(o.v)}"${o.v === val ? " selected" : ""}>${esc(o.t)}</option>`).join("") +
    `</select>`;

const TEXT = (k, id, v, ph, cls = "") =>
    `<input id="${id}" data-wc-field="${k}" class="wc-inp ${cls}" value="${esc(v)}" placeholder="${esc(ph || "")}">`;

const AREA = (k, id, v, ph) =>
    `<textarea id="${id}" data-wc-field="${k}" class="wc-inp wc-area" placeholder="${esc(ph || "")}">${esc(v)}</textarea>`;

const NUM = (k, id, v, ph) =>
    `<input id="${id}" type="number" data-wc-field="${k}" class="wc-inp wc-num" value="${typeof v === "number" ? v : (v == null ? "" : v)}" placeholder="${esc(ph || "")}">`;

const TAGS = (k, id, arr, ph) =>
    `<input id="${id}" data-wc-field="${k}" class="wc-inp" value="${esc(Array.isArray(arr) ? arr.join("、") : "")}" placeholder="${esc(ph || "")}">`;

const CHECK = (k, id, v) =>
    `<input id="${id}" type="checkbox" data-wc-field="${k}" ${v ? "checked" : ""}>`;

// 各容器字段 schema
// ★ docs/61：moduleGate = 编辑器显隐门禁（对应玩法模块 id；null=核心/默认恒开）
const CONTAINER_CONFIGS = [
    {
        key: "characters",
        title: "人物卡 / 羁绊好感度",
        hint: "设定主角与 NPC；NPC 可填初始好感度(-100~100)与关系标签（B1+B4）。",
        moduleToEnable: null,            // 角色卡为核心模块，恒开
        moduleGate: null,                // 核心恒开；好感度子字段另受 affinity 模块门禁
        affinityModuleOnFill: true,      // 若填了好感/关系标签 → 开启羁绊模块
        matchKey: "name",
        generator: (w, ex) => generateCharacters(w, ex),
        defaultItem: () => ({ role: "npc", name: "", identity: "", gender_age: "", appearance: "", personality: "", motivation: "", relationship: "", attitude: "", affinity: 0, rel_tags: [], current_state: "", voice: "", untouchable: "", notes: "" }),
        fields: (i) => ([
            { k: "role", label: "身份", html: (v) => SELECT("role", `wc_char_${i}_role`, v || "npc", [{ v: "npc", t: "NPC" }, { v: "protagonist", t: "主角" }]) },
            { k: "name", label: "姓名", html: (v) => TEXT("name", `wc_char_${i}_name`, v, "主角可留空") },
            { k: "identity", label: "身份/职业", html: (v) => TEXT("identity", `wc_char_${i}_identity`, v, "如：霍格沃茨学生") },
            { k: "personality", label: "性格", html: (v) => AREA("personality", `wc_char_${i}_personality`, v, "一句话性格") },
            { k: "motivation", label: "核心目标/动机", html: (v) => AREA("motivation", `wc_char_${i}_motivation`, v, "TA 想要什么") },
            { k: "relationship", label: "与主角关系", html: (v) => TEXT("relationship", `wc_char_${i}_relationship`, v, "如：宿敌") },
            { k: "affinity", label: "初始好感(-100~100)", html: (v) => NUM("affinity", `wc_char_${i}_affinity`, v, "0") },
            { k: "rel_tags", label: "关系标签(顿号分隔)", html: (v) => TAGS("rel_tags", `wc_char_${i}_rel_tags`, v, "如：亦敌亦友") },
            { k: "notes", label: "给 AI 的备注/红线", html: (v) => AREA("notes", `wc_char_${i}_notes`, v, "不可违背的设定") }
        ])
    },
    {
        key: "variables",
        title: "玩家变量",
        hint: "数值/文本/开关型变量（如理智、金钱、声望）。填了即开启「玩家变量」模块。",
        moduleToEnable: "variables",
        moduleGate: "variables",
        matchKey: "id",
        generator: (w, ex) => generateVariables(w, ex),
        defaultItem: () => ({ id: "", name: "", type: "number", default: 0, min: 0, max: 100, unit: "", desc: "" }),
        fields: (i) => ([
            { k: "id", label: "变量键(id)", html: (v) => TEXT("id", `wc_var_${i}_id`, v, "英文/无空格，如 sanity") },
            { k: "name", label: "展示名", html: (v) => TEXT("name", `wc_var_${i}_name`, v, "如 理智") },
            { k: "type", label: "类型", html: (v) => SELECT("type", `wc_var_${i}_type`, v || "number", [{ v: "number", t: "数值" }, { v: "text", t: "文本" }, { v: "toggle", t: "开关" }]) },
            { k: "default", label: "默认值", html: (v) => TEXT("default", `wc_var_${i}_default`, v, "0") },
            { k: "min", label: "最小", html: (v) => NUM("min", `wc_var_${i}_min`, v, "可选") },
            { k: "max", label: "最大", html: (v) => NUM("max", `wc_var_${i}_max`, v, "可选") },
            { k: "unit", label: "单位", html: (v) => TEXT("unit", `wc_var_${i}_unit`, v, "如 %") },
            { k: "desc", label: "说明(注入AI)", html: (v) => TEXT("desc", `wc_var_${i}_desc`, v, "可选") }
        ])
    },
    {
        key: "inventory",
        title: "初始背包物品",
        hint: "开局携带物（默认空背包也可，物品多由剧情授予）。",
        moduleToEnable: null,            // 背包默认开启
        moduleGate: "inventory",
        matchKey: "item_id",
        generator: (w, ex) => generateInventory(w, ex),
        defaultItem: () => ({ item_id: "", name: "", count: 1, category: "其他", is_key: false, tags: [] }),
        fields: (i) => ([
            { k: "item_id", label: "物品键(id)", html: (v) => TEXT("item_id", `wc_item_${i}_item_id`, v, "英文/无空格") },
            { k: "name", label: "展示名", html: (v) => TEXT("name", `wc_item_${i}_name`, v, "如 符文钥匙") },
            { k: "count", label: "数量", html: (v) => NUM("count", `wc_item_${i}_count`, v, "1") },
            { k: "category", label: "类别", html: (v) => SELECT("category", `wc_item_${i}_category`, v || "其他", ["武器", "装备", "消耗品", "线索", "书籍", "货币", "其他"].map(c => ({ v: c, t: c }))) },
            { k: "is_key", label: "关键物品", html: (v) => CHECK("is_key", `wc_item_${i}_is_key`, v) },
            { k: "tags", label: "解锁标签(顿号分隔)", html: (v) => TAGS("tags", `wc_item_${i}_tags`, v, "如 has_firearm") }
        ])
    },
    {
        key: "skills",
        title: "技能 / 功法",
        hint: "习得的技能与成长描述。填了即开启「技能系统」模块。",
        moduleToEnable: "skills",
        moduleGate: "skills",
        matchKey: "name",
        generator: (w, ex) => generateSkills(w, ex),
        defaultItem: () => ({ name: "", desc: "" }),
        fields: (i) => ([
            { k: "name", label: "技能名", html: (v) => TEXT("name", `wc_skill_${i}_name`, v, "如 御剑术") },
            { k: "desc", label: "描述/效果", html: (v) => AREA("desc", `wc_skill_${i}_desc`, v, "一句话描述") }
        ])
    },
    {
        key: "goals",
        title: "目标",
        hint: "玩家可追踪的目标（主线/支线/隐藏）。填了即启用目标系统。",
        moduleToEnable: null,            // 目标默认开启
        moduleGate: "goals",
        matchKey: "name",
        generator: (w, ex) => generateGoals(w, ex),
        defaultItem: () => ({ name: "", type: "主线", deadline: "" }),
        fields: (i) => ([
            { k: "name", label: "目标名", html: (v) => TEXT("name", `wc_goal_${i}_name`, v, "如 找到归乡之路") },
            { k: "type", label: "类型", html: (v) => SELECT("type", `wc_goal_${i}_type`, v || "主线", [{ v: "主线", t: "主线" }, { v: "支线", t: "支线" }, { v: "隐藏", t: "隐藏" }, { v: "日常", t: "日常" }, { v: "其他", t: "其他" }]) },
            { k: "deadline", label: "期限(自由文本)", html: (v) => TEXT("deadline", `wc_goal_${i}_deadline`, v, "如 第30天 / 新年") }
        ])
    },
    {
        key: "sideEvents",
        title: "预置支线事件",
        hint: "开局即存在的可选支线池（AI 每轮也会临时生成支线）。填了即启用「支线事件」模块。",
        moduleToEnable: "events",
        moduleGate: "events",
        matchKey: "title",
        generator: (w, ex) => generateSideEvents(w, ex),
        defaultItem: () => ({ title: "", desc: "", cost_stamina: 20, cost_time: "", tag: "" }),
        fields: (i) => ([
            { k: "title", label: "支线标题", html: (v) => TEXT("title", `wc_se_${i}_title`, v, "如 酒馆密谈") },
            { k: "desc", label: "一句话描述", html: (v) => AREA("desc", `wc_se_${i}_desc`, v, "剧情概要") },
            { k: "cost_stamina", label: "体力消耗", html: (v) => NUM("cost_stamina", `wc_se_${i}_cost_stamina`, v, "20") },
            { k: "cost_time", label: "时间消耗", html: (v) => TEXT("cost_time", `wc_se_${i}_cost_time`, v, "如 半天") },
            { k: "tag", label: "类型标签", html: (v) => TEXT("tag", `wc_se_${i}_tag`, v, "如 社交") }
        ])
    }
];

const CFG_BY_KEY = Object.fromEntries(CONTAINER_CONFIGS.map(c => [c.key, c]));

// ============================================================
// ★ docs/61：读取向导当前状态（模块开关 / 叙事视角）
// ============================================================
function readWizardModuleState() {
    const st = {};
    document.querySelectorAll("#moduleToggles .module-cb").forEach(cb => {
        st[cb.dataset.module] = cb.checked;
    });
    return st;
}
function readWizardPov() {
    const el = document.querySelector("input[name='povMode']:checked");
    return el && el.value === "ensemble" ? "ensemble" : "solo";
}
function moduleDisplayName(id) {
    const m = getModuleById(id);
    return m ? m.name : id;
}

// ============================================================
// 渲染
// ============================================================
function itemHasContent(cfg, item) {
    const f = cfg.fields(0);
    return f.some(spec => {
        if (spec.k === "role") return false; // role 有默认值(npc)，不能算作"已填内容"
        const v = item[spec.k];
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === "number") return v !== 0 && spec.k !== "count" && spec.k !== "cost_stamina";
        return v != null && String(v).trim() !== "";
    });
}

// ★ docs/61：群像剧/好感度门禁 —— 决定角色卡某字段是否渲染
function characterFieldVisible(k, isEnsemble, affinityOn) {
    if (k === "relationship") return !isEnsemble;                          // 与主角关系：群像剧无主角 → 隐藏
    if (k === "affinity" || k === "rel_tags") return !isEnsemble && affinityOn; // 好感/关系标签：群像剧或好感模块未开 → 隐藏
    return true;
}

function renderContainerCard(cfg) {
    const mount = document.getElementById("wc_container_" + cfg.key);
    if (!mount) return;
    const modules = readWizardModuleState();
    const pov = readWizardPov();
    const isEnsemble = pov === "ensemble";
    const affinityOn = modules["affinity"] !== false;

    // ★ docs/61：模块门禁 —— 对应模块未开 → 隐藏编辑器，显示占位提示
    if (cfg.moduleGate && modules[cfg.moduleGate] === false) {
        mount.innerHTML = `
            <div class="wc-gated">
                <div class="wc-cc-title">${esc(cfg.title)}</div>
                <div class="wc-gated-hint">🔒 未开启「${esc(moduleDisplayName(cfg.moduleGate))}」玩法模块，暂不可编辑。</div>
                <div class="wc-gated-sub">到「玩法模块」步骤勾选后，即可在此预设${esc(cfg.title)}。</div>
            </div>`;
        return;
    }

    const list = WC[cfg.key] || [];
    const exp = expandedArr(cfg.key);
    let itemsHtml = "";
    if (!list.length) {
        itemsHtml = `<p class="wc-empty muted">还没有内容。点「＋ 添加」手填，或点「🤖 AI 生成」让 AI 依据世界观草拟。</p>`;
    } else {
        list.forEach((item, i) => {
            const specs = cfg.fields(i).filter(s => characterFieldVisible(s.k, isEnsemble, affinityOn));
            const title = item.name || item.item_id || item.title || ("第 " + (i + 1) + " 项");
            const open = !!exp[i];
            const fieldsHtml = specs.map(spec => {
                const v = item[spec.k];
                const id = `wc_${cfg.key}_${i}_${spec.k}`;
                return `<div class="wc-field"><label>${esc(spec.label)}</label>${spec.html(v)}</div>`;
            }).join("");
            // 条目默认折叠成一行摘要（标题 + 删除），点标题行展开编辑
            itemsHtml += `<div class="wc-item" data-wc-item="${cfg.key}" data-idx="${i}">
                <div class="wc-item-head" data-wc="toggle" data-wc-key="${cfg.key}" data-wc-idx="${i}" role="button" tabindex="0">
                <span class="wc-item-caret">${open ? "▾" : "▸"}</span><span class="wc-item-title">${esc(title)}</span>
                <button type="button" class="wc-mini danger" data-wc="del" data-wc-key="${cfg.key}" data-wc-idx="${i}">删除</button></div>
                <div class="wc-item-fields"${open ? "" : ' style="display:none;"'}>${fieldsHtml}</div>
            </div>`;
        });
    }
    // ★ docs/61：群像剧 → 在角色卡顶部提示关系/好感走备注
    const charNote = (cfg.key === "characters" && isEnsemble)
        ? `<p class="wc-char-note">群像剧无单一主角：角色间关系与好感请在「给 AI 的备注」中描述。</p>`
        : "";
    const affNote = (cfg.key === "characters" && !isEnsemble && !affinityOn)
        ? `<p class="wc-char-note">开启「羁绊好感度」玩法模块后可设置初始好感度与关系标签。</p>`
        : "";
    mount.innerHTML = `
        <div class="wc-cc-head">
            <div><div class="wc-cc-title">${esc(cfg.title)}</div><div class="wc-cc-hint">${esc(cfg.hint)}</div></div>
            <div class="wc-cc-tools">
                <button type="button" class="wc-mini" data-wc="add" data-wc-key="${cfg.key}">＋ 添加</button>
                <select class="wc-ai-select" data-wc-ai="${cfg.key}" title="让 AI 依据世界观描述草拟或完善本卡片内容">
                    <option value="">🤖 AI 生成…</option>
                    <option value="generate">从零生成（AI 为主）</option>
                    <option value="complete">完善已有（补空白）</option>
                </select>
                <button type="button" class="wc-mini danger" data-wc="clear" data-wc-key="${cfg.key}">🗑 清空</button>
            </div>
        </div>
        ${charNote}${affNote}
        <div class="wc-cc-list" data-wc-list="${cfg.key}">${itemsHtml}</div>`;
}

function renderAllContainers() {
    CONTAINER_CONFIGS.forEach(renderContainerCard);
}

// ★ docs/61：外部刷新入口（模块开关 / pov 变化时由 wizard-editor 调用）
export function refreshWizardContainers() {
    renderAllContainers();
    renderValidationPanel();
}

// ============================================================
// 同步：输入即写回 WC 缓冲
// ============================================================
function syncItemFromDOM(cfg, idx) {
    const item = WC[cfg.key][idx];
    if (!item) return;
    const row = document.querySelector(`[data-wc-item="${cfg.key}"][data-idx="${idx}"]`);
    if (!row) return;
    cfg.fields(idx).forEach(spec => {
        const el = row.querySelector(`[data-wc-field="${spec.k}"]`);
        if (!el) return;
        if (spec.k === "rel_tags" || spec.k === "tags") {
            item[spec.k] = String(el.value || "").split(/[、,，]/).map(t => t.trim()).filter(Boolean);
        } else if (el.type === "checkbox") {
            item[spec.k] = !!el.checked;
        } else if (el.type === "number") {
            const raw = el.value;
            item[spec.k] = raw === "" ? (spec.k === "count" || spec.k === "cost_stamina" ? 1 : 0) : Number(raw);
        } else {
            item[spec.k] = el.value;
        }
    });
}

function syncContainerFromDOM(cfg) {
    (WC[cfg.key] || []).forEach((_, i) => syncItemFromDOM(cfg, i));
}

// ============================================================
// 操作：添加 / 删除 / 清空
// ============================================================
function addItem(cfg) {
    syncContainerFromDOM(cfg);
    WC[cfg.key].push(cfg.defaultItem());
    expandedArr(cfg.key)[WC[cfg.key].length - 1] = true; // 新条目默认展开，便于直接填写
    renderContainerCard(cfg);
}
function deleteItem(cfg, idx) {
    syncContainerFromDOM(cfg);
    WC[cfg.key].splice(idx, 1);
    const arr = WC_EXPANDED[cfg.key];
    if (arr) arr.splice(idx, 1);
    renderContainerCard(cfg);
}
function clearContainer(cfg) {
    WC[cfg.key] = [];
    WC_EXPANDED[cfg.key] = [];
    renderContainerCard(cfg);
}
function toggleItem(cfg, idx) {
    syncContainerFromDOM(cfg);
    const arr = expandedArr(cfg.key);
    arr[idx] = !arr[idx];
    renderContainerCard(cfg);
}

// ============================================================
// AI 生成 / 完善
// ============================================================
function getWizardContextWorld() {
    const gv = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    return {
        name: gv("worldName"),
        desc: gv("worldDesc"),
        ip_name: gv("ipName"),
        hero: "",
        style_preset: null,
        // ★ docs/61：让 AI 生成器感知叙事视角与模块门禁（群像剧不生成好感度）
        pov: readWizardPov(),
        modules: readWizardModuleState()
    };
}

// ★ docs/61：AI 生成/完善后，按门禁剥离不该存在的字段：
//   - 群像剧（ensemble）→ 剥离 relationship/affinity/rel_tags（无单一主角）
//   - solo 但 affinity 模块未开 → 剥离 affinity/rel_tags（好感度字段已隐藏）
function stripGatedCharFields(items) {
    const pov = readWizardPov();
    const affinityOn = readWizardModuleState()["affinity"] !== false;
    const stripAffinity = pov === "ensemble" || !affinityOn;
    return (items || []).map(c => {
        const o = { ...c };
        if (pov === "ensemble") delete o.relationship;
        if (stripAffinity) { delete o.affinity; delete o.rel_tags; }
        return o;
    });
}

// 合并生成结果：generate = AI 为主、保留玩家未匹配的；complete = 玩家为主、补空白
export function mergeGenerated(cfg, existing, generated, mode) {
    const mk = cfg.matchKey;
    const keyOf = (o) => (o && o[mk] != null ? String(o[mk]).trim().toLowerCase() : "");
    const genMap = new Map();
    (generated || []).forEach(g => { const k = keyOf(g); if (k) genMap.set(k, g); });
    const exMap = new Map();
    (existing || []).forEach(e => { const k = keyOf(e); if (k) exMap.set(k, e); });

    if (mode === "generate") {
        const result = (generated || []).map(g => deepClone(g));
        // 保留玩家手动添加、但 AI 未生成的条目（避免误删玩家劳动）
        (existing || []).forEach(e => { if (!genMap.has(keyOf(e))) result.push(deepClone(e)); });
        return result.slice(0, 30);
    }
    // complete：以玩家现有条目为基底，补空白字段；AI 多出的新条目追加
    const result = (existing || []).map(e => {
        const cloned = deepClone(e);
        const g = genMap.get(keyOf(e));
        if (g) {
            Object.keys(g).forEach(k => {
                const v = g[k];
                const cur = cloned[k];
                const empty = Array.isArray(cur) ? cur.length === 0 : (cur == null || cur === "" || cur === 0);
                if (empty) cloned[k] = deepClone(v);
            });
        }
        return cloned;
    });
    (generated || []).forEach(g => { if (!exMap.has(keyOf(g))) result.push(deepClone(g)); });
    return result.slice(0, 30);
}

async function runContainerAI(cfg, mode) {
    syncContainerFromDOM(cfg);
    const ctx = getWizardContextWorld();
    if (!ctx.desc && !ctx.name) {
        showToast("请先在「基本信息」填写世界观描述，AI 才能据此生成。", "warn");
        return;
    }
    showToast((mode === "generate" ? "AI 正在草拟「" + cfg.title + "」…" : "AI 正在完善「" + cfg.title + "」…"), "info", 3000);
    try {
        const existing = mode === "complete" ? deepClone(WC[cfg.key]) : null;
        const generated = await cfg.generator(ctx, existing);
        if (!generated || !generated.length) {
            showToast("AI 未返回可用内容（可能未配置 API 或处于模拟模式）。", "warn");
            return;
        }
        WC[cfg.key] = mergeGenerated(cfg, existing, generated, mode);
        // ★ docs/61：门禁剥离（群像剧无好感度；affinity 模块未开则剥离好感字段）
        if (cfg.key === "characters") {
            WC[cfg.key] = stripGatedCharFields(WC[cfg.key]);
        }
        WC_EXPANDED[cfg.key] = []; // AI 合并后条目回到折叠摘要态
        renderContainerCard(cfg);
        renderValidationPanel();
        showToast(`已${mode === "generate" ? "生成" : "完善"} ${WC[cfg.key].length} 条「${cfg.title}」（可继续编辑）`, "success");
    } catch (e) {
        console.error("[wizard-containers] AI 生成失败", e);
        showToast("AI 生成失败：" + (e && e.message || "未知错误"), "error");
    }
}

// ============================================================
// 事件委托（挂在 document，init 时仅挂一次）
// ============================================================
let _delegated = false;
function ensureDelegated() {
    if (_delegated) return;
    _delegated = true;
    document.addEventListener("click", (e) => {
        const t = e.target.closest("[data-wc]");
        if (!t) return;
        const action = t.dataset.wc;
        const key = t.dataset.wcKey;
        const cfg = key ? CFG_BY_KEY[key] : null;
        if (!cfg) return;
        if (action === "add") addItem(cfg);
        else if (action === "del") deleteItem(cfg, parseInt(t.dataset.wcIdx));
        else if (action === "clear") clearContainer(cfg);
        else if (action === "toggle") toggleItem(cfg, parseInt(t.dataset.wcIdx));
    });
    // 输入即写回
    document.addEventListener("input", (e) => {
        const row = e.target.closest("[data-wc-item]");
        if (!row) return;
        const cfg = CFG_BY_KEY[row.dataset.wcItem];
        if (!cfg) return;
        syncItemFromDOM(cfg, parseInt(row.dataset.idx));
        renderValidationPanel(); // ★ docs/61：实时刷新校验
    });
    document.addEventListener("change", (e) => {
        // 「🤖 AI 生成…」下拉：选中即执行对应模式，随后复位占位项
        const aiSel = e.target.closest("select[data-wc-ai]");
        if (aiSel) {
            const cfg = CFG_BY_KEY[aiSel.dataset.wcAi];
            const mode = aiSel.value;
            aiSel.value = "";
            if (cfg && mode) runContainerAI(cfg, mode);
            return;
        }
        const row = e.target.closest("[data-wc-item]");
        if (!row) return;
        const cfg = CFG_BY_KEY[row.dataset.wcItem];
        if (!cfg) return;
        syncItemFromDOM(cfg, parseInt(row.dataset.idx));
        renderValidationPanel(); // ★ docs/61：实时刷新校验
    });
    // ★ docs/61：校验面板「去开启模块」按钮 → 勾选对应模块开关并联动刷新
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-wv='enable']");
        if (!btn) return;
        const mod = btn.dataset.wvModule;
        const cb = document.querySelector(`#moduleToggles .module-cb[data-module="${mod}"]`);
        if (cb) {
            cb.checked = true;
            cb.dispatchEvent(new Event("change")); // 触发 wizard-editor 的模块联动刷新
        }
    });
}

// ============================================================
// 对外接口
// ============================================================
export function initWizardContainers() {
    WC = freshBuffer();
    WC_EXPANDED = {};
    ensureDelegated();
    renderAllContainers();
}

export function resetWizardContainers() {
    WC = freshBuffer();
    WC_EXPANDED = {};
    renderAllContainers();
}

// 纯函数：把内部缓冲整理成 { data, locked, enableModules }（无 DOM 依赖，便于单测）。
// 输入 buffers：{ characters, variables, inventory, skills, goals, sideEvents }
// ★ docs/61：opts = { modules: {id:bool} 模块开关, pov: "solo"|"ensemble" }
//   - modules 缺省 = 全开（向后兼容）；某容器 moduleGate 对应模块未开 → 该容器数据不产出（模块是总闸）
//   - pov === "ensemble" → 角色卡剥离 relationship/affinity/rel_tags（群像剧无单一主角，好感度不适用）
export function shapeWizardContainers(buffers, opts = {}) {
    const modules = opts.modules || null;   // null = 视为全开
    const pov = opts.pov || "solo";
    const isEnsemble = pov === "ensemble";
    const moduleOn = (cfg) => {
        if (!cfg.moduleGate) return true;            // 核心/默认恒开
        if (!modules) return true;                   // 未提供模块状态 → 兼容旧行为
        return modules[cfg.moduleGate] !== false;
    };

    const data = {
        characters: (buffers.characters || []).filter(c => itemHasContent(CFG_BY_KEY.characters, c)),
        variables: (buffers.variables || []).filter(v => v.id && v.id.trim() && v.name && v.name.trim()),
        inventory: (buffers.inventory || []).filter(v => v.item_id && v.item_id.trim() && v.name && v.name.trim()),
        skills: (buffers.skills || []).filter(s => s.name && s.name.trim()),
        goals: (buffers.goals || []).filter(g => g.name && g.name.trim()),
        sideEvents: (buffers.sideEvents || []).filter(s => s.title && s.title.trim())
    };

    // ★ docs/61：模块门禁 —— 模块未开的容器不产出数据（模块 = 总闸）
    for (const cfg of CONTAINER_CONFIGS) {
        if (!moduleOn(cfg)) data[cfg.key] = [];
    }

    // ★ docs/61：群像剧 → 角色卡剥离主角锚定字段（与主角关系 / 好感 / 关系标签）
    if (isEnsemble) {
        data.characters = data.characters.map(c => {
            const o = { ...c };
            delete o.relationship;
            delete o.affinity;
            delete o.rel_tags;
            return o;
        });
    }

    // 技能：运行时是对象映射 {名: 描述}
    const skillsMap = {};
    data.skills.forEach(s => { skillsMap[s.name.trim()] = (s.desc || "").trim(); });

    const locked = new Set();
    const enableModules = new Set();
    if (data.characters.length) locked.add("characters");
    if (data.variables.length) { locked.add("variables"); enableModules.add("variables"); }
    if (data.inventory.length) locked.add("inventory");
    if (data.skills.length) { locked.add("skills"); enableModules.add("skills"); }
    if (data.goals.length) locked.add("goals");
    if (data.sideEvents.length) { locked.add("sideEvents"); enableModules.add("events"); }
    // B4：任一角色填了好感/关系标签 → 开羁绊模块（仅 solo；群像剧已剥离）
    if (data.characters.some(c => (typeof c.affinity === "number" && c.affinity !== 0) || (Array.isArray(c.rel_tags) && c.rel_tags.length))) {
        enableModules.add("affinity");
    }

    return {
        data: {
            characters: data.characters,
            variable_schema: data.variables,
            inventory: data.inventory,
            skills: skillsMap,
            goals: data.goals.map(g => ({
                goal_id: "g_" + (g.name || "").trim().replace(/\s+/g, "_"),
                name: g.name.trim(),
                type: g.type || "其他",
                deadline: g.deadline ? { text: g.deadline.trim() } : null,
                visible: true,
                status: "active"
            })),
            sideEvents: data.sideEvents
        },
        locked,
        enableModules: Array.from(enableModules)
    };
}

// ============================================================
// ★ docs/61：关联校验（纯函数，便于单测）
// 返回 { errors, warnings, infos }，每项 { level, msg, enableModule? }
//   error   —— 明确矛盾，生成应拦截（好感度但模块未开 / 群像剧设主角 / 填了容器但模块未开）
//   warning —— 建议修复但不拦截（角色名重复）
//   info    —— 提示（solo 无主角卡，AI 会自动设计）
// ============================================================
export function computeWizardValidation({ buffers = {}, modules = null, pov = "solo" } = {}) {
    const errors = [];
    const warnings = [];
    const infos = [];
    const isEnsemble = pov === "ensemble";
    const moduleOn = (id) => !modules || modules[id] !== false;
    const chars = (buffers.characters || []).filter(c => itemHasContent(CFG_BY_KEY.characters, c));
    const filled = (key, hasFn) => (buffers[key] || []).some(it => hasFn ? hasFn(it) : itemHasContent(CFG_BY_KEY[key], it));
    const anyAffinity = chars.some(c => (typeof c.affinity === "number" && c.affinity !== 0) || (Array.isArray(c.rel_tags) && c.rel_tags.length));

    // ① 好感度但羁绊模块未开 → error
    if (anyAffinity && !moduleOn("affinity")) {
        errors.push({ level: "error", msg: "已为角色设置初始好感度/关系标签，但「羁绊好感度」模块未开启，好感度不会生效", enableModule: "affinity" });
    }
    // ② 群像剧却设了主角卡 → error
    if (isEnsemble && chars.some(c => c.role === "protagonist")) {
        errors.push({ level: "error", msg: "当前为群像剧（无单一主角），不应设置「主角」角色卡，请改为 NPC 或删除" });
    }
    // ③ 群像剧却填了好感度 → error（UI 已隐藏，多为 AI 生成带入）
    if (isEnsemble && anyAffinity) {
        errors.push({ level: "error", msg: "群像剧无单一主角：角色间关系与好感请在「给 AI 的备注」中描述，不要单独设置好感度" });
    }
    // ④ 填了容器但对应模块未开 → error
    const gateRules = [
        { key: "variables", mod: "variables", label: "玩家变量" },
        { key: "inventory", mod: "inventory", label: "初始背包" },
        { key: "skills", mod: "skills", label: "技能" },
        { key: "goals", mod: "goals", label: "目标" },
        { key: "sideEvents", mod: "events", label: "支线事件" }
    ];
    for (const r of gateRules) {
        if (filled(r.key) && !moduleOn(r.mod)) {
            errors.push({ level: "error", msg: `已填写${r.label}，但「${moduleDisplayName(r.mod)}」模块未开启，该内容不会生效`, enableModule: r.mod });
        }
    }
    // ⑤ 角色名重复 → warning
    const nameCount = {};
    chars.forEach(c => { const n = (c.name || "").trim(); if (n) nameCount[n] = (nameCount[n] || 0) + 1; });
    Object.entries(nameCount).forEach(([n, cnt]) => {
        if (cnt > 1) warnings.push({ level: "warning", msg: `角色名「${n}」重复出现 ${cnt} 次，可能导致 AI 混淆` });
    });
    // ⑥ solo 无主角卡 → info（AI 会自动设计，不拦截）
    if (!isEnsemble && !chars.some(c => c.role === "protagonist")) {
        infos.push({ level: "info", msg: "未设置主角卡：AI 会按世界观自动设计主角身份/背景/能力；如需固定可在角色卡中预设主角" });
    }
    return { errors, warnings, infos };
}

// DOM 包装：同步缓冲 → 读模块开关与 pov → 校验
export function validateWizardContainers() {
    CONTAINER_CONFIGS.forEach(syncContainerFromDOM);
    return computeWizardValidation({
        buffers: WC,
        modules: readWizardModuleState(),
        pov: readWizardPov()
    });
}

// 当前激活的向导步骤（★ docs/62：0=世界设定 … 4=角色资源 5=确认生成，对应 .wz-pane[data-step]）
function currentCwStep() {
    const p = document.querySelector("#createWorldModal .wz-pane.active");
    return p ? parseInt(p.dataset.step, 10) : 0;
}

// 步骤条徽标：把校验问题数量标到对应步骤节点旁（error 红点 / warning 黄点）。
// 现有校验规则都围绕「角色资源」步（第 5 步，data-step=4）的容器内容 → 徽标挂该步骤节点。
function updateNavBadges(v) {
    document.querySelectorAll("#wzStepsBar .cw-badge").forEach(x => x.remove());
    const errCount = v.errors.length, warnCount = v.warnings.length;
    if (!errCount && !warnCount) return;
    const target = document.querySelector('#wzStepsBar .wz-step-node[data-step="4"]');
    if (!target) return;
    const badge = document.createElement("span");
    badge.className = "cw-badge " + (errCount ? "cw-badge-err" : "cw-badge-warn");
    badge.textContent = String(errCount || warnCount);
    target.appendChild(badge);
}

// 渲染校验面板（#wizardValidationPanel，docs/62 起内嵌于末步「确认生成」）
// 降噪策略：完整面板只在「有 error」或「当前在末步」时显示；
// 其它步骤只通过步骤条徽标提示，避免与本步无关的校验信息常驻刷屏。
export function renderValidationPanel() {
    const panel = document.getElementById("wizardValidationPanel");
    const v = validateWizardContainers();
    updateNavBadges(v);
    if (!panel) return;
    const all = [...v.errors, ...v.warnings, ...v.infos];
    const showFull = v.errors.length > 0 || currentCwStep() === 5;
    if (!showFull) {
        panel.style.display = "none";
        return;
    }
    panel.style.display = "";
    if (!all.length) {
        panel.innerHTML = `<div class="wv-panel wv-ok">✓ 配置校验通过，可正常生成</div>`;
        return;
    }
    const icon = { error: "⛔", warning: "⚠️", info: "ℹ️" };
    const items = all.map(x => {
        const btn = x.enableModule
            ? `<button type="button" class="wc-mini wv-enable-btn" data-wv="enable" data-wv-module="${esc(x.enableModule)}">去开启「${esc(moduleDisplayName(x.enableModule))}」</button>`
            : "";
        return `<div class="wv-item wv-${x.level}"><span class="wv-icon">${icon[x.level] || ""}</span><span class="wv-msg">${esc(x.msg)}</span>${btn}</div>`;
    }).join("");
    panel.innerHTML = `<div class="wv-panel">
        <div class="wv-head">配置校验（${all.length} 项${v.errors.length ? "，含 " + v.errors.length + " 项需修正" : ""}）</div>
        <div class="wv-list">${items}</div>
    </div>`;
}

// 收集向导里玩家配置的容器数据，供 game.js 合并进新世界。
// 返回：
//   data: { characters, variables, inventory, skills(map), goals, sideEvents }
//   locked: Set<containerKey> 玩家显式填过（有内容）的容器
//   enableModules: 需要强制开启的模块 id 列表（填了对应的容器）
// ★ docs/61：读取当前模块开关与 pov，模块未开的容器数据不产出
export function getWizardContainers() {
    // 先同步 DOM → 缓冲，确保拿到最新手动输入
    CONTAINER_CONFIGS.forEach(syncContainerFromDOM);
    return shapeWizardContainers(WC, {
        modules: readWizardModuleState(),
        pov: readWizardPov()
    });
}
