// ============================================================
// AetherNarrator · utils.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_LABELS, LINK_RELATIONS, MAX_SOURCE_CHARS, normalizeTimeConfig } from "./store.js";
import { applyStateChanges } from "./game.js";
import { formatCalendarDate } from "./calendar.js";

export function deepClone(obj) {
    return typeof structuredClone !== "undefined" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
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
            game_over_conditions: ["is_alive === false"]
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
        game_over_conditions: ["is_alive === false"]
    };
}

export function getWorldSchema(world) {
    return (world && world.schema) || defaultWorldSchema(world && world.name);
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
    const ALLOWED = ["schema", "initial_state", "lore_kb", "system_prompt", "opening_narrative", "initial_choices"];
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
        revealed_locations: [], // ★ L3 认知追踪：角色已发现/已知的可达地点（不含当前所在地），供保底与 AI 生成"前往Y"选项
        is_alive: true,
        death_reason: null
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

// ============================================================
// S5-3 · 开场白占位符解析（纯函数，可在 Node 下单测）
// 把 {era_label}/{season}/{calendar_date}/{calendar_year}/{calendar_month} 展开为当前时间。
// - era_label / season 为配置级字段，任意历法模式都解析（缺则替换为空串）
// - calendar_* 仅当 current_date 为 dated 形态（含 year）时解析；否则保留原始占位符（非破坏性，便于作者察觉）
// text: 含占位符的开场白；timeConfig: 归一化后的 time_config；currentDate: 当前 current_date（开场通常用开局起点）
// ============================================================
const OPENING_TOKENS_RE = /\{(era_label|season|calendar_date|calendar_year|calendar_month)\}/g;

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
            case "season":
                return cfg.season || "";
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
                return m;
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
// 检测 opening_narrative / system_prompt / era_label 中写死的时间与 calendar_start 不一致。
// 设计要点（见 docs/20 §13）：
// - 先剥 {..} 占位符（S5-3 用占位符的开场白不会误报）
// - 年份严格判定（≠ calendar_start.year 即冲突，黎总拍板）
// - 无 calendar_start（day/none）时跳过年份比对，仅做季节/现代措辞检查
// - system_prompt 可能是数组（demo 世界），统一 join 成字符串再扫
// ============================================================
const TIME_CONFLICT_YEAR_RE = /\b(1[6-9]\d{2}|20\d{2})\b/g;
const TIME_CONFLICT_SEASON_WORDS = ["孟春", "仲春", "季春", "春季", "春", "孟夏", "仲夏", "季夏", "夏季", "夏", "孟秋", "仲秋", "季秋", "秋季", "秋", "孟冬", "仲冬", "季冬", "冬季", "冬"];
const TIME_CONFLICT_ABSOLUTE_RE = /如今|当代|现在|今年/;
const TIME_CONFLICT_PLACEHOLDER_RE = /\{[^}]*\}/g;

function seasonBaseOf(s) {
    if (!s) return null;
    for (const key of ["春", "夏", "秋", "冬"]) if (String(s).startsWith(key)) return key;
    return null;
}

export function detectTimeConflict(world) {
    const schema = getWorldSchema(world) || {};
    const cfg = normalizeTimeConfig(schema.time_config);
    const startYear = cfg.calendar_start ? cfg.calendar_start.year : null;
    const season = (cfg.season || "").trim();

    // 先剥占位符再扫描；system_prompt 可能为数组，统一成字符串
    const strip = (t) => {
        const s = Array.isArray(t) ? t.join(" ") : String(t == null ? "" : t);
        return s.replace(TIME_CONFLICT_PLACEHOLDER_RE, " ");
    };
    const fullText = [strip(schema.opening_narrative), strip(schema.system_prompt), strip(cfg.era_label)].join("\n");

    // 年份冲突（严格判定：≠ 起始年即冲突）
    const years = [];
    let m;
    TIME_CONFLICT_YEAR_RE.lastIndex = 0;
    while ((m = TIME_CONFLICT_YEAR_RE.exec(fullText)) !== null) {
        const y = parseInt(m[1], 10);
        if (startYear != null && y !== startYear && !years.includes(y)) years.push(y);
    }

    // 季节冲突（仅当配置了季节；按春/夏/秋/冬分族，避免「春」误伤「春季」）
    let seasonConflict = null;
    const base = seasonBaseOf(season);
    if (base) {
        for (const w of TIME_CONFLICT_SEASON_WORDS) {
            if (fullText.includes(w)) {
                const wb = seasonBaseOf(w);
                if (wb && wb !== base) { seasonConflict = w; break; }
            }
        }
    }

    // 现代措辞（历史世界：起始年 < 2000）
    const absolutePhrase = TIME_CONFLICT_ABSOLUTE_RE.test(fullText) && startYear != null && startYear < 2000;

    const snippets = [];
    if (years.length) snippets.push(`年份 ${years.join("、")} 与起始年 ${startYear} 不一致`);
    if (seasonConflict) snippets.push(`季节「${seasonConflict}」与配置「${season}」不一致`);
    if (absolutePhrase) snippets.push("出现现代措辞（如今/当代/现在/今年）但起始年为历史年代");

    return {
        conflict: years.length > 0 || seasonConflict !== null || absolutePhrase,
        yearConflict: years.length ? { years } : null,
        seasonConflict: seasonConflict ? { words: [seasonConflict] } : null,
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
// - multiverse：优先取 active_timeline 的平铺时间字段（calendar_mode/calendar_start/era_label/season），回退顶层
// - 无实质时间信息（无年份/纪元/季节）时返回空串，prompt 不增时间章节
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
                season: line.season,
                custom_calendar: line.custom_calendar
            });
        } else {
            tc = normalizeTimeConfig(null);
        }
    }
    const parts = ["历法：" + calendarModeLabel(tc.calendar_mode)];
    if (tc.era_label) parts.push("纪元标签：" + tc.era_label);
    if (tc.calendar_start && typeof tc.calendar_start.year === "number") {
        const s = tc.calendar_start;
        const dateStr = tc.calendar_mode === "custom_calendar"
            ? `${s.year} 年（自定义历法）`
            : `${s.year} 年${s.month ? " " + s.month + " 月" : ""}${s.date ? " " + s.date + " 日" : ""}`;
        parts.push("起始日期：" + dateStr);
    } else {
        parts.push("无绝对年份（day/none 模式）");
    }
    if (tc.season) parts.push("季节：" + tc.season);
    // 无任何实质时间信息（无年份/纪元/季节）则不增章节
    const hasAnchor = !!((tc.calendar_start && typeof tc.calendar_start.year === "number") || tc.era_label || tc.season);
    if (!hasAnchor) return "";
    return parts.join(" / ");
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

export function analyzeWorldTags(name, desc, hero, type, ipName) {
    const clues = [name || "", desc || "", hero || "", ipName || ""].join(" ");
    const tags = [];

    // 来源（固定排在第一个）
    tags.push(type === "ip" ? "已有IP" : "原创");

    // 题材分类
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

    // 去重并限制数量（来源 + 最多 4 个题材标签）
    return tags.slice(0, 5);
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
