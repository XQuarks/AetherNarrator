// ============================================================
// AetherNarrator · utils.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_LABELS, LINK_RELATIONS, MAX_SOURCE_CHARS, normalizeTimeConfig } from "./store.js";
import { formatCalendarDate, deriveAnchorYear } from "./calendar.js";

export function deepClone(obj) {
    return typeof structuredClone !== "undefined" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

// ★ #10 统一错误处理（最小侵入版）：默认静默降级（console.warn），
// 关键路径错误同时写入诊断缓冲 S.debugLog.chunkErrors（供玩家导出诊断），
// 绝不擅自弹 toast（避免把"有意静默降级"变成烦人弹窗）。
export function logError(scope, err) {
    const summary = (err && err.message) ? err.message : String(err);
    // ★ 记录堆栈（前 6 行）：导出调试日志时可精确定位出错代码位置（原来只记一行消息）
    const stack = (err && err.stack && typeof err.stack === "string")
        ? err.stack.split("\n").slice(0, 6).join("\n")
        : "";
    console.warn(`[${scope}]`, err);
    try {
        if (S && S.debugLog) {
            S.debugLog.chunkErrors = S.debugLog.chunkErrors || [];
            if (S.debugLog.chunkErrors.length < 300) {
                S.debugLog.chunkErrors.push({ t: new Date().toISOString(), scope, msg: summary, stack });
            }
        }
    } catch (_) { /* 写缓冲失败不应再抛错 */ }
}

// migrateGameState 已移除（Phase 0：不兼容旧存档/世界；gameState 形状由 initial_state.json / saveState 保证）

export function buildApiUrl(baseUrl, corsProxy) {
    const apiPath = baseUrl.replace(/\/$/, "") + "/chat/completions";
    if (corsProxy) {
        return corsProxy.replace(/\/$/, "") + "/" + apiPath;
    }
    return apiPath;
}

export function defaultWorldSchema(styleHint) {
    const isXianxia = /仙|侠|修|道|武|玄|魔/.test(styleHint);
    const isMagicSchool = /霍格沃茨|哈利|魔法|学院|年级|巫师/.test(styleHint);
    if (isMagicSchool) {
        return {
            progression_label: "年级",
            progression_path_label: "学院",
            has_skills: true,
            skill_label: "课程/法术",
            attribute_labels: {
                courage: "勇气", perception: "观察", patience: "耐心", luck: "运气", will: "意志"
            },
            time_periods: DEFAULT_PERIOD_LABELS,
            time_config: normalizeTimeConfig(null),
            game_over_conditions: ["is_alive === false"],
            variable_schema: []
        };
    }
    return {
        progression_label: isXianxia ? "境界" : "等级",
        progression_path_label: isXianxia ? "修行路线" : "职业/分支",
        has_skills: true,
        skill_label: isXianxia ? "功法/技艺" : "技能",
        attribute_labels: {
            courage: "胆识", perception: "洞察", patience: "耐心", luck: "气运", will: "心志"
        },
        time_periods: DEFAULT_PERIOD_LABELS,
        time_config: normalizeTimeConfig(null),
        game_over_conditions: ["is_alive === false"],
        variable_schema: []   // ★ B2：玩家变量定义（默认空=开箱无数字压力，创作者按需添加）
    };
}

export function getWorldSchema(world) {
    return (world && world.schema) || defaultWorldSchema(world && world.name);
}

// ★ A2：IP 轻量识别（关键词启发式）。
// 明确边界：只识别"提到了哪个已知 IP"（模式匹配），不比对/不存储版权原文，不做"原文 vs 改稿"判定。
export const IP_SIGNATURES = [
    { name: "哈利波特", aliases: ["哈利波特", "harry potter", "hp", "霍格沃茨", "hogwarts", "魁地奇", "quidditch", "伏地魔", "voldemort", "魔法部", "麻瓜", "muggle", "邓布利多", "dumbledore", "格兰芬多", "gryffindor", "斯莱特林", "slitherin", "分院帽"] },
    { name: "克苏鲁", aliases: ["克苏鲁", "cthulhu", "洛夫克拉夫特", "lovecraft", "深潜者", "旧日支配者", "修格斯", "shoggoth", "阿撒托斯", "azathoth", "犹格", "yog-sothoth", "奈亚拉托提普", "nyarlathotep"] },
    { name: "三体", aliases: ["三体", "three body", "刘慈欣", "面壁者", "黑暗森林", "罗辑", "章北海"] },
    { name: "红楼梦", aliases: ["红楼梦", "石头记", "贾宝玉", "林黛玉", "曹雪芹", "大观园"] },
    { name: "剑来", aliases: ["剑来", "骊珠洞天", "陈平安", "宁姚"] }
];

// 从任意文本里识别"提到了哪些已知 IP"，返回统一 IP 名数组（去重）。无匹配返回 []。
export function detectIp(text) {
    if (!text || typeof text !== "string") return [];
    const lower = text.toLowerCase();
    const hits = new Set();
    for (const sig of IP_SIGNATURES) {
        for (const alias of sig.aliases) {
            if (lower.includes(alias.toLowerCase())) { hits.add(sig.name); break; }
        }
    }
    return [...hits];
}

// 把用户自由填写的 IP 名映射到已知 IP（用于冲突判定），无匹配返回 null。
export function matchKnownIp(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    for (const sig of IP_SIGNATURES) {
        for (const alias of sig.aliases) {
            if (lower.includes(alias.toLowerCase())) return sig.name;
        }
        if (lower.includes(sig.name.toLowerCase())) return sig.name;
    }
    return null;
}

export function capSource(text) { return (text || "").slice(0, MAX_SOURCE_CHARS); }

// ★ Plan A：把长文本按约 size 字符硬切块（不依赖段落边界），用于全书分块抽取知识库
export function chunkText(text, size) {
    const safe = Math.max(500, size | 0);
    const t = String(text || "");
    if (t.length <= safe) return [t];
    const result = [];
    for (let i = 0; i < t.length; i += safe) result.push(t.slice(i, i + safe));
    return result;
}

export function sanitizeWorldConfig(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    // 允许的顶层键（其余一律丢弃）
    const ALLOWED = ["schema", "initial_state", "lore_kb", "system_prompt", "opening_narrative", "initial_choices", "tags", "modules", "lore_stage_count", "lore_stage_labels", "gm_truth", "locations", "secrecy", "historical_accuracy"];
    for (const k of ALLOWED) {
        if (k in raw && raw[k] !== undefined) out[k] = raw[k];
    }
    // 字符串字段：强制字符串 + 长度上限
    const STR_MAX = 20000;
    out.system_prompt = typeof out.system_prompt === "string" ? out.system_prompt.slice(0, STR_MAX) : "";
    out.opening_narrative = typeof out.opening_narrative === "string" ? out.opening_narrative.slice(0, STR_MAX) : "";
    // initial_choices：数组，每项含 text 字符串，限制数量
    if (!Array.isArray(out.initial_choices)) out.initial_choices = [];
    else out.initial_choices = out.initial_choices.slice(0, 8)
        .map(c => ({ text: (c && typeof c.text === "string") ? c.text.slice(0, 500) : "" }))
        .filter(c => c.text);
    // tags：作品标签数组（AI 自由生成，不受固定词表限制）。短字符串、去重、限量
    if (!Array.isArray(out.tags)) out.tags = [];
    else out.tags = dedupeStrings(
        out.tags
            .map(t => (typeof t === "string" ? t.trim() : ""))
            .filter(t => t && t.length <= 20)
    ).slice(0, 8);
    // ★ docs/56：剧情阶段刻度（可选）。lore_stage_count 为阶段总数 K（门禁上限，仅作 story_progress 钳制与作者端展示）；
    //   lore_stage_labels 为作者端阶段名（红岸/危机/…）。缺省则门禁仍按 unlock_stage 绝对值生效。
    if (typeof raw.lore_stage_count === "number" && raw.lore_stage_count >= 1) {
        out.lore_stage_count = Math.min(Math.floor(raw.lore_stage_count), 50);
    }
    if (Array.isArray(raw.lore_stage_labels)) {
        out.lore_stage_labels = dedupeStrings(
            raw.lore_stage_labels.map(t => (typeof t === "string" ? t.trim() : "")).filter(t => t && t.length <= 20)
        ).slice(0, 50);
    }
    // ★ docs/67：GM 专属真相层（幕后谜底，叙事 AI 不可见；由引擎按 unlock_stage 受控揭示）。
    //   独立顶层字段，绝不并入 lore_kb（不进检索池、不进任何叙事 prompt 构建路径）。
    if (out.gm_truth !== undefined && (!out.gm_truth || typeof out.gm_truth !== "object")) {
        delete out.gm_truth;
    }
    if (out.gm_truth && typeof out.gm_truth === "object") {
        const entries = Array.isArray(out.gm_truth.entries) ? out.gm_truth.entries.slice(0, 20) : [];
        const cleaned = entries
            .map(e => ({
                id: (typeof e.id === "string" && e.id.trim()) ? e.id.trim().slice(0, 50) : "gt" + Date.now().toString(36),
                title: typeof e.title === "string" ? e.title.slice(0, 200) : "",
                content: typeof e.content === "string" ? e.content.slice(0, 2000) : "",
                unlock_stage: (typeof e.unlock_stage === "number" && e.unlock_stage >= 1) ? Math.min(Math.floor(e.unlock_stage), 50) : 1
            }))
            .filter(e => e.title || e.content);
        out.gm_truth = cleaned.length ? { entries: cleaned } : undefined;
        if (!out.gm_truth) delete out.gm_truth;
    }
    // ★ A1：信息边界 / 伪装法则（保密世界观）。world.secrecy = { enabled: bool, note: string }。
    //   启用后引擎在 system prompt 注入「伪装法则」，约束普通 NPC 不知情、机密不外泄。
    if (raw.secrecy && typeof raw.secrecy === "object") {
        out.secrecy = {
            enabled: raw.secrecy.enabled === true,
            note: typeof raw.secrecy.note === "string" ? raw.secrecy.note.slice(0, 1000) : ""
        };
    }
    // ★ C2-史实：史实参考 / 联网核对历史。world.historical_accuracy = { enabled: bool, note: string }。
    //   开启后引擎写剧情前实时联网核对相关时期真实历史，作为「史实参考」注入；玩家可改写历史，史实仅作参考。
    if (raw.historical_accuracy && typeof raw.historical_accuracy === "object") {
        out.historical_accuracy = {
            enabled: raw.historical_accuracy.enabled === true,
            note: typeof raw.historical_accuracy.note === "string" ? raw.historical_accuracy.note.slice(0, 1000) : ""
        };
    }
    // ★ docs/68：地点连接图（可选旁路数据，借鉴 WorldLines locations）。
    //   仅作参考/展示/事件地点匹配增强；不替换 current_location/revealed_locations/知识库地点条目。
    if (out.locations !== undefined && !Array.isArray(out.locations)) delete out.locations;
    if (Array.isArray(out.locations)) {
        const cleaned = out.locations.slice(0, 30)
            .map(l => ({
                id: (typeof l.id === "string" && l.id.trim()) ? l.id.trim().slice(0, 50) : "loc" + Date.now().toString(36),
                name: typeof l.name === "string" ? l.name.trim().slice(0, 100) : "",
                summary: typeof l.summary === "string" ? l.summary.slice(0, 500) : "",
                connections: Array.isArray(l.connections)
                    ? dedupeStrings(l.connections.map(c => typeof c === "string" ? c.trim() : "").filter(Boolean)).slice(0, 12)
                    : [],
                hidden: l.hidden === true,
                npcs_default: Array.isArray(l.npcs_default)
                    ? dedupeStrings(l.npcs_default.map(n => typeof n === "string" ? n.trim() : "").filter(Boolean)).slice(0, 8)
                    : []
            }))
            .filter(l => l.name)
            .map(l => ({ ...l, connections: l.connections.filter(c => c !== l.name) })); // 连接不含自身
        out.locations = cleaned.length ? cleaned : undefined;
        if (!out.locations) delete out.locations;
    }
    // lore_kb：{ ip, snippets[] }
    if (out.lore_kb && typeof out.lore_kb === "object") {
        const snippets = Array.isArray(out.lore_kb.snippets) ? out.lore_kb.snippets.slice(0, 50) : [];
        out.lore_kb = {
            ip: typeof out.lore_kb.ip === "string" ? out.lore_kb.ip.slice(0, 200) : "",
            // ★ B4：token 预算（可选，AI/玩家不填则运行时用默认值）
            budget_tokens: (typeof out.lore_kb.budget_tokens === "number" && out.lore_kb.budget_tokens > 0) ? Math.min(Math.floor(out.lore_kb.budget_tokens), 4000) : undefined,
            recursive_enabled: out.lore_kb.recursive_enabled === false ? false : undefined,
            snippets: snippets.map(s => ({
                id: typeof s.id === "string" ? s.id.slice(0, 50) : "",
                category: typeof s.category === "string" ? s.category.slice(0, 50) : "",
                title: typeof s.title === "string" ? s.title.slice(0, 200) : "",
                content: typeof s.content === "string" ? s.content.slice(0, 1000) : "",
                keywords: Array.isArray(s.keywords) ? s.keywords.slice(0, 20).map(k => typeof k === "string" ? k.slice(0, 50) : "") : [],
                trigger: (s.trigger && typeof s.trigger === "object") ? s.trigger : undefined,
                activation_keys: Array.isArray(s.activation_keys) ? s.activation_keys.slice(0, 20).map(k => typeof k === "string" ? k.slice(0, 50) : "") : [],
                trigger_mode: typeof s.trigger_mode === "string" ? s.trigger_mode.slice(0, 20) : "",
                scan_depth: (typeof s.scan_depth === "number" && s.scan_depth > 0) ? Math.min(Math.floor(s.scan_depth), 10) : 1,
                // ★ P0-2：多插入位。insert_at 决定该片段被检索命中后注入到哪个槽位
                //   system｜author_note｜before_user｜after_user；未设置默认 before_user（等于旧版行为）
                insert_at: (typeof s.insert_at === "string" && ["system", "author_note", "before_user", "after_user"].includes(s.insert_at)) ? s.insert_at : "before_user",
                // ★ P0-2：insert_depth（保留字段，供后续按对话深度插入用；仅 before_user 语义相关）
                insert_depth: (typeof s.insert_depth === "number" && s.insert_depth >= 0) ? Math.min(Math.floor(s.insert_depth), 20) : 1,
                // ★ B4：priority（重要度，预算裁剪时优先保留）+ recursive（是否允许被连带触发）
                priority: (typeof s.priority === "number") ? Math.max(-10, Math.min(Math.floor(s.priority), 10)) : 0,
                recursive: s.recursive === false ? false : undefined,
                // ★ docs/56：解锁阶段（防剧透门禁）。缺字段/非法 → 默认 1（全程可用，不锁），向后兼容老 lore。
                unlock_stage: (typeof s.unlock_stage === "number" && s.unlock_stage >= 1) ? Math.min(Math.floor(s.unlock_stage), 50) : 1,
                // ★ 时间线单向：timeline 归一（与 normSnippet 一致，供小书单次生成路径保留 timeline）
                timeline: Array.isArray(s.timeline) ? s.timeline.slice(0, 12).map((t, i) => ({
                    order: (typeof t.order === "number" && t.order > 0) ? Math.floor(t.order) : (i + 1),
                    phase: typeof t.phase === "string" ? t.phase.slice(0, 60) : "",
                    location: typeof t.location === "string" ? t.location.slice(0, 60) : "",
                    summary: typeof t.summary === "string" ? t.summary.slice(0, 300) : ""
                })).filter((t) => t.phase || t.location || t.summary) : [],
                // ★ B9：关联链接（Operit 式图谱第一步：metadata-only）
                links: Array.isArray(s.links) ? s.links.slice(0, 8).map(l => ({
                    target: typeof l.target === "string" ? l.target.slice(0, 50) : "",
                    relation: (typeof l.relation === "string" && LINK_RELATIONS.includes(l.relation)) ? l.relation : "related"
                })).filter(l => l.target && l.target !== s.id) : [],
                // ★ P0-3：向量与模型标记（放行，避免 sanitize 清掉已算向量 / 供维度校验强制重算）
                embedding: Array.isArray(s.embedding) ? s.embedding : undefined,
                embedDim: (typeof s.embedDim === "number") ? s.embedDim : undefined,
                embedModel: (typeof s.embedModel === "string") ? s.embedModel.slice(0, 100) : undefined
            }))
        };
    }
    // ★ B9：校验 links 目标 ID 存在性（二次过滤——删除指向不存在 snippet 的链接）
    if (out.lore_kb && out.lore_kb.snippets) {
        const validIds = new Set(out.lore_kb.snippets.map(s => s.id));
        for (const s of out.lore_kb.snippets) {
            if (Array.isArray(s.links)) {
                s.links = s.links.filter(l => validIds.has(l.target));
            }
        }
    }
    // schema.time_config 归一化（无则回退默认，杜绝非法字段）
    if (out.schema && typeof out.schema === "object") {
        out.schema.time_config = normalizeTimeConfig(out.schema.time_config);
    }
    // 递归剔除原型链危险键（防御性）
    const stripDangerousKeys = (obj) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) { obj.forEach(stripDangerousKeys); return; }
        for (const key of Object.keys(obj)) {
            if (key === "__proto__" || key === "constructor" || key === "prototype") delete obj[key];
            else stripDangerousKeys(obj[key]);
        }
    };
    stripDangerousKeys(out);
    return out;
}

export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export function defaultInitialState() {
    return {
        name: "玩家",
        age: 16,
        background: "一个误入了陌生世界的普通人。",
        personality: ["谨慎", "好奇"],
        attributes: {
            courage: "初来乍到，遇事不免有些畏缩，但还不到仓皇逃窜的地步。",
            perception: "对周遭动静还算留心，偶尔会注意到旁人忽略的细节。",
            patience: "能坐得住一时半刻，但若长久无望，也会焦躁起来。",
            luck: "不好不坏，像被世界随手一扔的普通石子。",
            will: "心志尚浅，却还没被现实完全磨平。"
        },
        progression: { path: "未入门", rank: "凡人", progress: 0 },
        relationships: {},
        skills: {},
        skill_growth: {},    // ★ docs/74：技能成长进度（运行时对象映射，与 s.skills 字符串描述解耦）
        pendingGrowthEvents: [], // ★ docs/74：待渲染的成长事件队列（升星 banner 消费后清空）
        pendingRelationshipEvents: [], // ★ docs/75：待渲染的关系升级事件队列（关系门控 banner 消费后清空）
        // ★ docs/76：平行叙事层 + 玩家影响度（parallel_narrative 模块开启时由 ensureNarrativeLayers 填充主线基准）
        narrative_layers: {},            // 叙事层字典：id → { id, label, core(状态副本), lore_scope, active, derived_from, fork_influence, fork_cause }
        active_narrative_layer: "main",  // 当前激活层 id（镜像 active_timeline）
        player_influence: 0,             // 玩家影响度累计（确定性，由 state_changes 增量加权算得）
        influence_baseline: null,        // 当前层初始状态 deepClone（computeInfluence 比对用，懒填充）
        consumed_influence_tiers: [],    // 已消费的影响度档位（防重复 fork）
        pendingInfluenceEvents: [],      // 待渲染的影响度/分岔事件队列（banner 消费后清空）
        inventory: [],
        completed_events: [],
        current_location: "初始地点",
        story_progress: 1,   // ★ 时间线进度指针（单向，仅增）：知识库 timeline 片段只在 order ≤ 此值时才注入，避免剧透未来
        current_date: { day: 1, period: "morning" },
        triggered_event_ids: { main: [] },   // Phase 3：按时间线/分支隔离的触发记录
        retrigger_state: { main: {} },        // Phase 3：repeatable 的 {count,lastStep}
        branches: {},                         // Phase 3：S4 分支隔离的时间线副本
        goals: [],
        status_effects: [],
        tags: [],            // ★ A6 解锁标签：时代/物品/人物等条件标签，决定禁用概念是否解锁
        present_npcs: [],    // ★ A6 在场角色：自动激活 char:<姓名> 标签，用于人物型解锁条件
        situation_tags: [],  // ★ docs/71：当前情境标签（如 combat / alone_night / secret_revealed），供情境人格 situation: 切面匹配
        revealed_locations: [], // ★ L3 认知追踪：角色已发现/已知的可达地点（不含当前所在地），供保底与 AI 生成"前往Y"选项
        is_alive: true,
        death_reason: null,
        unlockedEndings: [],  // ★ docs/54：结局图鉴，记录本档已触发的结局（按 ruleId 去重）
        random_event_state: { lastTitle: null, firedTitles: [] }  // ★ docs/73：随机事件抽取状态（排重 + 已触发标题记录）
    };
}

export function getAttributeLabel(key) {
    const schema = getWorldSchema(S.currentWorld);
    return (schema.attribute_labels && schema.attribute_labels[key]) || key;
}

export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ★ IP#6：从一段文本里移除「包含 term 的那个句子」（按中英文句末标点 / 换行切分）。
// 纯函数，可在 Node 下单测；game.js 的「移除这句」按钮复用它。
export function removeSentenceWithTerm(text, term) {
    if (!text || !term) return text || "";
    const parts = String(text).split(/(?<=[。！？!?；;\n])/);
    const kept = parts.filter(p => !p.includes(term));
    const joined = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
    return joined || String(text); // 若整段都被移除则保留原样，避免清空叙事
}

// ============================================================
// S5-3 · 开场白占位符解析（纯函数，可在 Node 下单测）
// 把 {era_label}/{calendar_date}/{calendar_year}/{calendar_month} 展开为当前时间。
// - era_label 为配置级字段，任意历法模式都解析（缺则替换为空串）
// - calendar_* 仅当 current_date 为 dated 形态（含 year）时解析；否则保留原始占位符（非破坏性，便于作者察觉）
// text: 含占位符的开场白；timeConfig: 归一化后的 time_config；currentDate: 当前 current_date（开场通常用开局起点）
// ============================================================
const OPENING_TOKENS_RE = /\{(era_label|calendar_date|calendar_year|calendar_month)\}/g;

export function resolveOpeningTokens(text, timeConfig, currentDate) {
    if (!text || typeof text !== "string") return text || "";
    const cfg = timeConfig || {};
    const cd = currentDate || {};
    const mode = cfg.calendar_mode;
    const isDated = (mode === "gregorian" || mode === "lunar" || mode === "custom_calendar") && typeof cd.year === "number";
    return text.replace(OPENING_TOKENS_RE, (m, key) => {
        switch (key) {
            case "era_label":
                return cfg.era_label || "";
            case "calendar_year":
                return isDated ? String(cd.year) : m;
            case "calendar_month":
                return isDated ? String(cd.month) : m;
            case "calendar_date":
                if (isDated) {
                    const fmt = formatCalendarDate({ year: cd.year, month: cd.month, date: cd.date }, mode, cfg.custom_calendar);
                    return fmt || m;
                }
                return m;
            default:
                return "";
        }
    });
}

export function createElementFromHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstChild;
}

// ============================================================
// S5-4 · 时间冲突 Lint（纯函数，可在 Node 下单测）
// 检测 opening_narrative / system_prompt 中写死的时间与纪元（era_label）不一致。
// 设计要点（见 docs/22 · 方案 X）：
// - 先剥 {..} 占位符（S5-3 用占位符的开场白不会误报）
// - 年份锚点来自 era_label（年份归纪元），按 decade 容错（同 decade 不冲突，黎总拍板放宽）
// - 不再扫描 era_label 本身（它现在是锚点来源，避免「1920年代」被当硬年份误报）
// - era_label 无可解析年份（如「中世纪」）时跳过年份比对，仅做现代措辞检查
// - system_prompt 可能是数组（demo 世界），统一 join 成字符串再扫
// ============================================================
const TIME_CONFLICT_YEAR_RE = /\b(1[6-9]\d{2}|20\d{2})\b/g;
const TIME_CONFLICT_ABSOLUTE_RE = /如今|当代|现在|今年/;
const TIME_CONFLICT_PLACEHOLDER_RE = /\{[^}]*\}/g;

export function detectTimeConflict(world) {
    const schema = getWorldSchema(world) || {};
    const cfg = normalizeTimeConfig(schema.time_config);
    // 方案 22：年份锚点来自 era_label（年份归纪元）
    const eraLabel = cfg.era_label || "";
    const anchorYear = deriveAnchorYear(eraLabel); // 可能为 null（模糊纪元）
    const anchorDecade = (anchorYear != null) ? Math.floor(anchorYear / 10) : null;

    // 先剥占位符再扫描；system_prompt 可能为数组，统一成字符串。
    // 注意：不再把 era_label 纳入扫描（它已是锚点来源）。
    const strip = (t) => {
        const s = Array.isArray(t) ? t.join(" ") : String(t == null ? "" : t);
        return s.replace(TIME_CONFLICT_PLACEHOLDER_RE, " ");
    };
    const fullText = [strip(schema.opening_narrative), strip(schema.system_prompt)].join("\n");

    // 年份冲突（同 decade 容错：≠ 锚点 decade 即冲突）
    const years = [];
    let m;
    TIME_CONFLICT_YEAR_RE.lastIndex = 0;
    while ((m = TIME_CONFLICT_YEAR_RE.exec(fullText)) !== null) {
        const y = parseInt(m[1], 10);
        const yd = Math.floor(y / 10);
        if (anchorDecade != null && yd !== anchorDecade && !years.includes(y)) years.push(y);
    }

    // 现代措辞（历史世界：锚点年 < 2000）
    const absolutePhrase = TIME_CONFLICT_ABSOLUTE_RE.test(fullText) && anchorYear != null && anchorYear < 2000;

    const snippets = [];
    if (years.length) snippets.push(`年份 ${years.join("、")} 与纪元「${eraLabel}」不在同一 decade`);
    if (absolutePhrase) snippets.push("出现现代措辞（如今/当代/现在/今年）但纪元为历史年代");

    return {
        conflict: years.length > 0 || absolutePhrase,
        yearConflict: years.length ? { years } : null,
        absolutePhrase,
        snippets
    };
}

export function formatConflictMessage(res) {
    if (!res || !res.conflict) return "";
    return (res.snippets || []).join("；");
}

// ============================================================
// S5-5 · 审稿时间锚点构造（纯函数，可在 Node 下单测；无 DOM 依赖）
// 从世界抽取「权威时间锚点」文本，喂给 callWorldCriticLLM 作为时间一致性审稿基准。
// 设计要点（见 docs/20 §13 S5-5）：
// - multiverse：优先取 active_timeline 的平铺时间字段（calendar_mode/calendar_start/era_label），回退顶层
// - 无实质时间信息（无年份/纪元）时返回空串，prompt 不增时间章节
// ============================================================
function calendarModeLabel(mode) {
    return ({
        gregorian: "公历", lunar: "农历", custom_calendar: "自定义历法",
        day: "日计数模式", none: "不显示日期", multiverse: "多世界", single: "默认"
    })[mode] || mode || "未知";
}

export function buildCriticTimeContext(world) {
    const schema = getWorldSchema(world) || {};
    const cfg = normalizeTimeConfig(schema.time_config);
    let tc = cfg;
    // 多世界穿梭：取 active 线的平铺时间字段重组为 time_config 再归一化
    if (cfg.mode === "multiverse" && cfg.timelines) {
        const activeKey = cfg.active_timeline || Object.keys(cfg.timelines)[0];
        const line = activeKey ? cfg.timelines[activeKey] : null;
        if (line) {
            tc = normalizeTimeConfig({
                calendar_mode: line.calendar_mode,
                calendar_start: line.calendar_start,
                era_label: line.era_label,
                custom_calendar: line.custom_calendar
            });
        } else {
            tc = normalizeTimeConfig(null);
        }
    }
    const parts = ["历法：" + calendarModeLabel(tc.calendar_mode)];
    if (tc.era_label) parts.push("纪元：" + tc.era_label);
    const dateStr = formatStartAnchor(tc.calendar_start);
    if (dateStr) parts.push("起始日期：" + dateStr);
    else if (!tc.era_label) parts.push("无绝对年份（day/none 模式）");
    // 无任何实质时间信息（无纪元/起始日期）则不增章节
    const hasAnchor = !!(tc.era_label || (tc.calendar_start && (Number.isFinite(tc.calendar_start.year) || Number.isFinite(tc.calendar_start.month) || Number.isFinite(tc.calendar_start.date))));
    if (!hasAnchor) return "";
    return parts.join(" / ");
}

// 方案 22：把 calendar_start（可能只含部分字段）格式化为「年 月 日」片段（仅拼存在的字段）
function formatStartAnchor(cs) {
    if (!cs || typeof cs !== "object") return "";
    const segs = [];
    if (Number.isFinite(cs.year)) segs.push(cs.year + " 年");
    if (Number.isFinite(cs.month)) segs.push(cs.month + " 月");
    if (Number.isFinite(cs.date)) segs.push(cs.date + " 日");
    return segs.join("");
}

export function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

export function isFuzzyFact(t) {
    return /有了新的变化/.test(t) || /有了新的变动/.test(t);
}

export function normFact(t) {
    return String(t)
        .normalize("NFKC")
        .replace(/与/g, "和")
        // 注意：NFKC 会把全角 ！？ 转成半角 ! ?，故此处需同时覆盖半角标点
        .replace(/[\s,，。！？、；：""''「」《》（）【】\n\r\t!?…—~～]/g, "")
        .toLowerCase();
}

export function analyzeWorldTags(name, desc, hero, ipName) {
    const clues = [name || "", desc || "", hero || "", ipName || ""].join(" ");
    const tags = [];

    // 题材分类（仅题材标签；世界来源类型概念已移除——来源信息统一由渲染层「参考作品」展示）
    const genreRules = [
        { pattern: /修仙|修真|仙|道|玄|渡劫|飞升|筑基|金丹|元婴/, tag: "修仙" },
        { pattern: /武侠|江湖|武林|门派|剑|侠|轻功|内功/, tag: "武侠" },
        { pattern: /魔法|巫师|魔杖|咒|法术|魔力|霍格沃茨/, tag: "魔法" },
        { pattern: /科幻|未来|太空|星际|AI|人工智能|机甲|赛博|机器人/, tag: "科幻" },
        { pattern: /末日|丧尸|废土|生存|核|灾变/, tag: "末日" },
        { pattern: /悬疑|推理|侦探|谜|案件|犯罪|调查/, tag: "悬疑" },
        { pattern: /恐怖|惊悚|怪谈|诡异|诅咒|灵异|鬼|妖怪/, tag: "恐怖" },
        { pattern: /都市|现代|城市|职场|公司|老板|白领|上班/, tag: "都市" },
        { pattern: /校园|学校|学院|学生|老师|教室|社团|学霸|学渣/, tag: "校园" },
        { pattern: /古代|古代|宫廷|皇宫|皇帝|妃|太子|将军/, tag: "古代" },
        { pattern: /奇幻|异世界|穿越|龙|精灵|矮人|冒险|勇者/, tag: "奇幻" },
        { pattern: /宫斗|后宫|妃|嫔|嫡|庶|宅斗|世家/, tag: "宫斗" },
        { pattern: /红楼|贾|黛|宝|钗|凤|大观园/, tag: "古典名著" },
        { pattern: /恋爱|甜|宠|男友|女友|暗恋|初恋|告白|约会/, tag: "恋爱" },
        { pattern: /日常|生活|轻松|温馨|治愈|慢|休闲/, tag: "日常" },
        { pattern: /战斗|战争|战场|军队|兵|战略|征服|对决/, tag: "战斗" },
        { pattern: /开店|经营|农场|咖啡|烘焙|餐厅|旅馆|田|种/, tag: "经营" },
        { pattern: /成长|修炼|升级|变强|突破|觉醒/, tag: "成长" },
    ];

    for (const { pattern, tag } of genreRules) {
        if (pattern.test(clues) && !tags.includes(tag)) {
            tags.push(tag);
        }
    }

    // 去重并限制数量（最多 4 个题材标签）
    return tags.slice(0, 4);
}

// ★ 作品标签选择：优先采用 AI 自由生成的标签（不受 18 关键词限制），
// 兜底回退到关键词正则匹配（兼容旧模型 / 离线场景）。
export function pickWorldTags(generated, meta) {
    if (generated && Array.isArray(generated.tags) && generated.tags.length) {
        return generated.tags;
    }
    return analyzeWorldTags(meta.name, meta.desc, meta.hero, meta.ipName);
}

export function dedupeStrings(arr) {
    const seen = new Set();
    const out = [];
    for (const x of (arr || [])) {
        const k = String(x).trim();
        if (k && !seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
}

export function parseResponse(content) {
    let text = content;
    if (text.includes("```json")) {
        text = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
    } else if (text.startsWith("```") && text.endsWith("```")) {
        text = text.slice(3, -3).trim();
    }
    // 提取第一个 JSON 对象（贪婪匹配到最后一个 }）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];
    try {
        return JSON.parse(text);
    } catch (e) {
        // JSON 截断/不完整 → 尝试自动补全缺失的括号
        const fixed = tryRepairJSON(text, content);
        try { return JSON.parse(fixed); } catch (e2) {
            throw new Error("AI 返回的 JSON 解析失败：" + e2.message + "\n原始内容：" + content.slice(0, 500));
        }
    }
}

// ★ docs/65：narrative 字段防御——AI 或流式累积偶发把结构化 JSON 塞进 narrative 字段。
//   两种畸形形态都要兜住：
//   A 型：整段 narrative 是 `{...}` 对象字串（如 '{"text":"...","action":"...","state_changes":{...}}'）。
//   B 型：narrative 以真实剧情开头、尾部把后续结构键（choices/state_changes/…）当字串一起编码进来
//        （如 '真实剧情…","choices":[{…}],"state_changes":{…}'）——模型把整段参数二次编码进 narrative。
//   此函数检测这两种情况并还原出真正的剧情文字；否则原样返回。
export function extractNarrativeText(raw) {
    if (raw == null) return "";
    if (typeof raw !== "string") return String(raw);
    const trimmed = raw.trim();
    // ★ 防御 A 型：整段是 {…} 对象
    if (trimmed.startsWith("{") && /["']narrative["']\s*:/.test(trimmed)) {
        let obj = null;
        try { obj = JSON.parse(trimmed); } catch (_) { obj = extractFirstBalancedJsonObject(trimmed); }
        if (obj && typeof obj === "object" && typeof obj.narrative === "string" && obj.narrative.trim()) return obj.narrative;
    }
    // ★ 防御 B 型：剧情尾部 glued 上 `","<已知结构键>"` 标记（二次编码）。
    //   检测首个紧邻已知结构键的 `","` 标记，截断到标记之前，并把前缀里被转义的正文还原出来。
    const KNOWN_KEYS = ["choices", "state_changes", "side_events", "key_facts", "atmosphere", "next_period", "comment", "is_forced_plot", "lore_delta"];
    const marker = new RegExp('["\']\\s*,\\s*["\']?(' + KNOWN_KEYS.join("|") + ')["\']?\\s*:');
    const m = trimmed.match(marker);
    if (m && m.index > 0) {
        let prefix = trimmed.slice(0, m.index).replace(/[",\s]+$/, "");
        // 还原 JSON 转义（二次编码时前缀里是 \" \\ \n 等字面量）
        const unescaped = prefix
            .replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
            .replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        if (unescaped.trim()) return unescaped.trim();
    }
    return raw;
}

// 在一段文本中找到第一个完整的 { ... } JSON 对象（按花括号平衡匹配，处理嵌套）。
//   用于 extractNarrativeText / llm.js 修复 DeepSeek 重复流式 arguments。
export function extractFirstBalancedJsonObject(text) {
    if (typeof text !== "string") return null;
    const start = text.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false, quote = "";
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (ch === "\\") { esc = true; continue; }
            if (ch === quote) { inStr = false; quote = ""; }
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
        if (ch === "{") { depth++; continue; }
        if (ch === "}") { depth--; if (depth === 0) return safeJsonParse(text.slice(start, i + 1)); }
    }
    return null;
}

function safeJsonParse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
}

// ★ 氛围提示（atmosphere）净化：仅接受非空字符串，压缩空白并限长。
//   用于 LLM 每轮可选输出的环境变化/危机预警短句（docs/ui-redesign）。
//   非法值（null/数字/空串/空白）一律归一为 null，保证旧存档与异常响应安全。
export function sanitizeAtmosphere(v) {
    if (typeof v !== "string") return null;
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) return null;
    return t.slice(0, 60);
}

// ★ docs/70：LLM 文本净化器（显示层兜底，防"代码/格式泄漏到界面"）。
// 任何进入叙事 DOM 的 LLM 文本都应先过本函数，剥离其可能误吐的 Markdown 代码围栏、
// 行内反引号、模板残留、状态栏占位标记、以及疑似 JSON 的结构行——
// 这样即便 prompt 没拦住，玩家也绝不会在界面上看到 ``` / {…} / 【状态栏】 等代码样式。
// 纯函数、无 DOM 依赖，可在 Node 下单测。
export function sanitizeLLMText(raw) {
    if (!raw || typeof raw !== "string") return "";
    let t = raw;
    // 1) 代码围栏标记（``` 或 ```json 等）——只去标记，内容保留为普通文本
    t = t.replace(/```[a-zA-Z0-9_-]*\s*/g, "");
    // 2) 行内反引号代码 → 保留内容去掉反引号
    t = t.replace(/`([^`\n]+)`/g, "$1");
    // 3) 模板/插值残留
    t = t.replace(/\{\{[^}]*\}\}/g, "").replace(/<%[^%]*%>/g, "");
    // 4) 状态栏占位标记（防 LLM 把模板占位吐进正文）
    t = t.replace(/【状态栏】/g, "").replace(/【状态栏/g, "");
    // 5) 疑似 JSON 结构行（整行丢弃）：以 [ 或 { 开头且含 "key": 形式
    t = t.split("\n").filter(line => {
        const s = line.trim();
        if (!s) return true;
        if (/^[\[{]/.test(s) && /["']?[\w一-龥]+["']?\s*:/.test(s)) return false;
        if (/^state_changes|^state_delta|state_changes\s*[:=]/.test(s)) return false;
        return true;
    }).join("\n");
    return t;
}

// ★ Plan A：跨分块合并同名 lore 条目——同一条目在多处出现时汇总内容、并集触发词/链接，
// 而非产生多个同名词条；也不覆盖最新，而是把所有出现处的信息累积成更全的一条。
export function mergeLoreSnippets(existing, incoming) {
    const normTitle = (t) => (t || "").trim().toLowerCase();
    const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const dedupeLinks = (arr) => {
        const seen = new Set();
        const res = [];
        for (const l of (arr || [])) {
            const k = (l && l.target ? l.target : "") + "|" + (l && l.relation ? l.relation : "related");
            if (!seen.has(k)) { seen.add(k); res.push(l); }
        }
        return res;
    };
    const dedupeRelations = (arr) => {
        const seen = new Set();
        const res = [];
        for (const r of (arr || [])) {
            if (!r || !r.from || !r.to) continue;
            const k = String(r.from) + "|" + String(r.relation || "related") + "|" + String(r.to);
            if (!seen.has(k)) { seen.add(k); res.push(r); }
        }
        return res;
    };
    const normSnippet = (s) => ({
        id: typeof s.id === "string" ? s.id : "",
        category: (typeof s.category === "string" && s.category) ? s.category.slice(0, 50) : "其他",
        title: (typeof s.title === "string" && s.title) ? s.title.slice(0, 200) : "未命名",
        content: typeof s.content === "string" ? s.content : "",
        keywords: Array.isArray(s.keywords) ? s.keywords.map((k) => String(k).slice(0, 50)).filter(Boolean) : [],
        activation_keys: Array.isArray(s.activation_keys) ? s.activation_keys.map((k) => String(k).slice(0, 50)).filter(Boolean) : [],
        trigger_mode: (typeof s.trigger_mode === "string" && s.trigger_mode) ? s.trigger_mode.slice(0, 20) : "keyword",
        scan_depth: (typeof s.scan_depth === "number" && s.scan_depth > 0) ? Math.min(Math.floor(s.scan_depth), 10) : 1,
        priority: (typeof s.priority === "number") ? Math.max(-10, Math.min(Math.floor(s.priority), 10)) : 0,
        // ★ docs/56：解锁阶段（防剧透门禁）。缺字段/非法 → 默认 1（不锁），向后兼容。
        unlock_stage: (typeof s.unlock_stage === "number" && s.unlock_stage >= 1) ? Math.min(Math.floor(s.unlock_stage), 50) : 1,
        links: Array.isArray(s.links) ? s.links.slice(0, 8).map((l) => ({
            target: typeof l.target === "string" ? l.target.slice(0, 50) : "",
            relation: (typeof l.relation === "string") ? l.relation : "related"
        })).filter((l) => l.target) : [],
        relations: Array.isArray(s.relations) ? s.relations.slice(0, 8).map((r) => ({
            from: typeof r.from === "string" ? r.from.slice(0, 50) : "",
            relation: (typeof r.relation === "string" && r.relation) ? r.relation.slice(0, 20) : "related",
            to: typeof r.to === "string" ? r.to.slice(0, 50) : ""
        })).filter((r) => r.from && r.to) : [],
        timeline: (Array.isArray(s.timeline) ? s.timeline.slice(0, 12).map((t, i) => ({
            order: (typeof t.order === "number" && t.order > 0) ? Math.floor(t.order) : (i + 1), // 时间线顺序号（单向排序/门禁用；缺失按数组序兜底）
            phase: typeof t.phase === "string" ? t.phase.slice(0, 60) : "",
            location: typeof t.location === "string" ? t.location.slice(0, 60) : "",
            summary: typeof t.summary === "string" ? t.summary.slice(0, 300) : ""
        })).filter((t) => t.phase || t.location || t.summary) : []).sort((a, b) => a.order - b.order)
    });
    const out = (existing || []).map(normSnippet);
    const map = new Map();
    out.forEach((s, i) => { const k = normTitle(s.title); if (k) map.set(k, i); });
    for (const raw of (incoming || [])) {
        const s = normSnippet(raw);
        const key = normTitle(s.title);
        if (key && map.has(key)) {
            const cur = out[map.get(key)];
            const add = s.content.trim();
            // 仅当新增内容未被现有内容覆盖时追加（避免重复堆积）
            if (add && !cur.content.includes(add.slice(0, Math.min(60, add.length)))) {
                cur.content = (cur.content + "\n" + add).slice(0, 2000);
            }
            cur.keywords = dedupe([...cur.keywords, ...s.keywords]).slice(0, 20);
            cur.activation_keys = dedupe([...cur.activation_keys, ...s.activation_keys]).slice(0, 20);
            cur.links = dedupeLinks([...cur.links, ...s.links]).slice(0, 8);
            cur.relations = dedupeRelations([...cur.relations, ...s.relations]).slice(0, 8);
            // 合并 timeline：按 order（顺序号）去重合并，同序 summary 拼接、缺失 location/phase 补全，最后按 order 升序排列
            if (Array.isArray(s.timeline) && s.timeline.length) {
                for (const t of s.timeline) {
                    const ex = cur.timeline.find((x) => x.order === t.order);
                    if (ex) {
                        if (t.summary && !ex.summary.includes(t.summary.slice(0, 40))) {
                            ex.summary = (ex.summary + " " + t.summary).slice(0, 300);
                        }
                        if (t.location && !ex.location) ex.location = t.location;
                        if (t.phase && !ex.phase) ex.phase = t.phase;
                    } else {
                        cur.timeline.push(t);
                    }
                }
                cur.timeline.sort((a, b) => a.order - b.order);
            }
            if (s.priority > cur.priority) cur.priority = s.priority;
        } else {
            if (key) map.set(key, out.length);
            out.push(s);
        }
    }
    return out;
}

export function tryRepairJSON(text, raw) {
    let braceDepth = 0, bracketDepth = 0, inString = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === "\\" && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
        else if (ch === "[") bracketDepth++;
        else if (ch === "]") bracketDepth--;
    }
    let repaired = text.trimEnd();
    if (repaired.endsWith(",")) repaired = repaired.slice(0, -1);
    if (inString) repaired += '"';
    // ★ P1.2.5: 同时闭合 ] 与 }（数组内截断也会缺括号）
    while (bracketDepth > 0) { repaired += "]"; bracketDepth--; }
    while (braceDepth > 0) { repaired += "}"; braceDepth--; }
    try { JSON.parse(repaired); return repaired; } catch (e) { /* 继续降级 */ }

    // 兜底 2：从末尾向前找最后一个完整 }，截断后续破损尾（如 choices/state_changes 半截）再解析
    const lastBrace = repaired.lastIndexOf("}");
    if (lastBrace > 0) {
        const truncated = repaired.slice(0, lastBrace + 1);
        try { JSON.parse(truncated); return truncated; } catch (e) { /* 继续 */ }
    }

    // 兜底 3：强掏 narrative。用 JSON.stringify 自动正确转义，避免手工 replace(/"/g) 双重转义导致非法 JSON
    const start = text.indexOf('"narrative"');
    if (start >= 0) {
        const colon = text.indexOf(":", start);
        if (colon > 0) {
            const q = text.indexOf('"', colon);
            if (q > colon) {
                // 定位 narrative 值字符串的闭合引号（考虑转义）；找不到说明被截断，取到文本末
                let end = -1, esc = false;
                for (let i = q + 1; i < text.length; i++) {
                    const c = text[i];
                    if (esc) { esc = false; continue; }
                    if (c === "\\") { esc = true; continue; }
                    if (c === '"') { end = i; break; }
                }
                const raw0 = end > 0 ? text.slice(q + 1, end) : text.slice(q + 1);
                // 若 narrative 被截断，raw0 可能含尾部破损 JSON，切到首个疑似后续键之前，保留干净叙事
                const cut = end < 0 ? raw0.search(/"\s*(choices|state_changes|options|key_facts)\s*"/) : -1;
                const raw = cut > 0 ? raw0.slice(0, cut) : raw0;
                const fallback = JSON.stringify({ narrative: raw, choices: [], state_changes: {} });
                try { JSON.parse(fallback); return fallback; } catch (e) { /* 末路 */ }
            }
        }
    }
    // 兜底 4（抢救模式）：截掉最后一个不完整元素，保留前面所有完整条目（分块/游玩均受益）
    const salvaged = salvageLastCompleteElement(text);
    if (salvaged) return salvaged;

    // ★ P1.2.5: 彻底无法修复时抛错，交由上层按"错误回合"处理（不 applyStateChanges / 不存盘 / 不推进时间），
    // 不再返回伪造成功的占位回合把玩家这一轮悄悄吞掉。
    throw new Error("AI 返回的 JSON 无法修复（内容截断或结构损坏）\n原始内容：" + String(raw != null ? raw : text).slice(0, 800));
}

// ★ 抢救：截掉最后一个不完整数组/对象元素（如写到一半的 snippet），保留前面所有完整条目。
// 用于 JSON 被截断且补括号无效时（如对象中部留下悬挂 key），尽量挽回已生成内容，而非整段丢弃。
function salvageLastCompleteElement(text) {
    // 找最后一个“},”边界（不在字符串内，其后紧跟逗号即表示这是一个完整元素结束）
    let cut = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "}" && /^\s*,/.test(text.slice(i + 1))) cut = i;
    }
    if (cut < 0) return null;
    const sliced = text.slice(0, cut + 1); // 保留到该 }
    // 重新统计深度并补全未闭合的括号/方括号
    let brace = 0, bracket = 0, s = false, e = false;
    for (let i = 0; i < sliced.length; i++) {
        const ch = sliced[i];
        if (e) { e = false; continue; }
        if (ch === "\\") { e = true; continue; }
        if (ch === '"') { s = !s; continue; }
        if (s) continue;
        if (ch === "{") brace++; else if (ch === "}") brace--;
        else if (ch === "[") bracket++; else if (ch === "]") bracket--;
    }
    let fixed = sliced;
    while (bracket > 0) { fixed += "]"; bracket--; }
    while (brace > 0) { fixed += "}"; brace--; }
    try {
        const obj = JSON.parse(fixed);
        // 游玩型：补齐缺失字段，避免下游 applyStateChanges 因缺 state_changes 崩溃
        if (obj.narrative !== undefined) {
            obj.choices = Array.isArray(obj.choices) ? obj.choices : [];
            obj.state_changes = (obj.state_changes && typeof obj.state_changes === "object") ? obj.state_changes : {};
            obj.narrative = typeof obj.narrative === "string" ? obj.narrative : "";
            if (!Array.isArray(obj.key_facts)) obj.key_facts = [];
            return JSON.stringify(obj);
        }
        // 分块型：保留抢救出的片段（lore_kb / snippets）
        if (obj.lore_kb || obj.snippets) return fixed;
        return null;
    } catch (_) { return null; }
}

export function isNonStoryResponse(text) {
    if (!text || typeof text !== "string") return true;
    if (text.trim().length === 0) return true;
    const lower = text.toLowerCase();
    const trimmedLower = text.trim().toLowerCase();

    // ★ P2.2.11: 系统身份声明 — 仅当整段「以」AI 身份声明开头才判为非故事，
    //            避免误杀 NPC 正常台词里的"抱歉，我不能…""我无法满足…"等拒绝语。
    const identityPrefixes = [
        "作为ai", "作为人工智能", "作为 ai", "作为a.i",
        "我是人工智能", "我是ai", "我是 ai",
        "as an ai", "as a language model", "as an ai language model",
        "i'm an ai", "i am an ai",
        "我只是一段程序", "我无法模拟"
    ];
    for (const p of identityPrefixes) {
        if (trimmedLower.startsWith(p)) return true;
    }

    // 硬拒绝/限制元信号 — 几乎只出现在 AI 系统拒绝中，不会出现在正常叙事上下文，命中即判非故事
    const hardPatterns = [
        "违反内容政策", "违反安全政策", "content policy",
        "i'm sorry, i cannot", "i'm sorry, i can't",
        "我无法满足您的请求", "超出我的能力范围", "inappropriate content",
        "无法生成此类", "该请求违反了", "请求被安全策略"
    ];
    for (const p of hardPatterns) {
        if (lower.includes(p.toLowerCase())) return true;
    }

    // 弱信号：需要多个命中才判定。去掉了"无法""不能"等常见叙事词汇
    const weakPatterns = [
        "unable to", "cannot",
        "请提供", "请换一个", "请尝试", "please provide",
        "不恰当", "不适当", "违反", "违规",
        "涉及敏感", "敏感内容"
    ];

    let weakHits = 0;
    for (const p of weakPatterns) {
        if (lower.includes(p.toLowerCase())) weakHits++;
    }

    // 短文本 + 弱信号 → 判定为非故事
    if (text.length < 80 && weakHits >= 1) return true;
    // 长文本但命中多个弱信号
    if (weakHits >= 3) return true;

    // 内容过短且不包含中文（可能是纯英文错误/技术限制消息）
    if (text.length < 30 && !/[\u4e00-\u9fff]/.test(text)) return true;

    // 纯 JSON 错误格式
    if (text.trim().startsWith("{") && text.trim().endsWith("}") && text.length < 100) return true;

    return false;
}

export function validateStateShape(changes) {
    if (!changes || typeof changes !== "object") return;
    const groups = ["attributes", "relationships", "skills"];
    for (const g of groups) {
        const obj = changes[g];
        if (!obj || typeof obj !== "object") continue;
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === "string" || typeof v === "number") continue;
            console.warn("[schema] " + g + "." + k + " 期望字符串/数字，收到 " + typeof v + "：", v);
        }
    }
}

// ★ 并发池：同时最多 concurrency 个异步任务在飞，全部完成返回结果数组（按原索引对齐）。
// 支持 429 等可重试错误的指数退避重试。用于「分块抽取知识库」提速（替代串行 for+await）。
export async function runPool(items, concurrency, worker, opts = {}) {
    const { retries = 0, isRetryable = () => false, onRetry, onProgress, onError } = opts;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const results = new Array(items.length);
    let cursor = 0, done = 0;
    async function callWithRetry(item, i) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await worker(item, i);
            } catch (e) {
                if (attempt >= retries || !isRetryable(e)) throw e;
                const delay = Math.min(1000 * 2 ** attempt, 8000);
                if (onRetry) onRetry(i + 1, attempt + 1, e);
                await sleep(delay);
            }
        }
    }
    async function runner() {
        while (cursor < items.length) {
            const i = cursor++;
            try {
                results[i] = await callWithRetry(items[i], i);
            } catch (e) {
                results[i] = { __error: e };
                if (onError) onError(i + 1, e);
            } finally {
                done++;
                if (onProgress) onProgress(done, items.length);
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
    return results;
}

// ============================================================
// A3 · 创作完成度清单（纯函数，可在 Node 下单测；无 DOM 依赖）
// 全部指标从 world 现有字段实时派生，不新增数据模型、不阻塞游玩。
// 维度（见 docs/36）：1 标题 / 2 世界观 / 3 开场场景 / 4 ≥1角色 /
//   5 游玩系统(规则) / 6 重要事件(lore_kb 带 trigger) / 7 主角设定
// ============================================================
export function computeWorldCompletion(world) {
    const w = world || {};
    const has = (v) => typeof v === "string" && v.trim().length > 0;
    const snippets = (w.lore_kb && Array.isArray(w.lore_kb.snippets)) ? w.lore_kb.snippets : [];
    const characters = Array.isArray(w.characters) ? w.characters : [];
    const rules = Array.isArray(w.rules) ? w.rules : [];
    const eventSnippets = snippets.filter(s => s && s.trigger && typeof s.trigger === "object");

    // ★ docs/58：主角设定改为可选维度——群像剧（pov=ensemble）世界本就无需单一主角，
    //   hero 不计入「完成度」分母，避免它阻塞「圆满」评级。
    const items = [
        { key: "title", label: "标题", done: has(w.name), hint: "世界名称" },
        { key: "worldview", label: "世界观", done: has(w.desc), hint: "去编辑世界观描述" },
        { key: "opening", label: "开场场景", done: has(w.opening_narrative), hint: "去补开场白" },
        { key: "characters", label: "≥1 角色", done: characters.length >= 1, hint: "去添加角色卡" },
        { key: "rules", label: "游玩系统", done: rules.length >= 1, hint: "去添加规则" },
        { key: "events", label: "重要事件", done: eventSnippets.length >= 1, hint: "去知识库给片段挂触发" },
        { key: "hero", label: "主角设定", done: has(w.hero), hint: "去补主角动机/身份", optional: true }
    ];

    // 计入评级的仅「必填维度」（不含 optional）
    const required = items.filter(i => !i.optional);
    const done = required.filter(i => i.done).length;
    const total = required.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    let grade;
    if (done >= total) grade = "圆满";
    else if (done >= 4) grade = "基本可用";
    else grade = "待充实";

    return { items, done, total, pct, grade };
}
