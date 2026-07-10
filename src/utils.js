// ============================================================
// AetherNarrator · utils.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_LABELS, MAX_SOURCE_CHARS } from "./store.js";
import { applyStateChanges } from "./game.js";

export function deepClone(obj) {
    return typeof structuredClone !== "undefined" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

export function migrateGameState(gs) {
    if (!gs || typeof gs !== "object") return;
    if (gs.active_event === undefined) gs.active_event = null;
    if (!Array.isArray(gs.completed_events)) gs.completed_events = [];
    if (Array.isArray(gs.goals)) {
        gs.goals.forEach(g => {
            if (!g) return;
            if (!g.status) g.status = "active";
            if (g.visible === undefined) g.visible = true;
            if (g.deadline === undefined) g.deadline = null;
        });
    }
}

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
        game_over_conditions: ["is_alive === false"]
    };
}

export function getWorldSchema(world) {
    return (world && world.schema) || defaultWorldSchema(world && world.name);
}

export function capSource(text) { return (text || "").slice(0, MAX_SOURCE_CHARS); }

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
            snippets: snippets.map(s => ({
                id: typeof s.id === "string" ? s.id.slice(0, 50) : "",
                category: typeof s.category === "string" ? s.category.slice(0, 50) : "",
                title: typeof s.title === "string" ? s.title.slice(0, 200) : "",
                content: typeof s.content === "string" ? s.content.slice(0, 1000) : "",
                keywords: Array.isArray(s.keywords) ? s.keywords.slice(0, 20).map(k => typeof k === "string" ? k.slice(0, 50) : "") : []
            }))
        };
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
        current_date: { day: 1, period: "morning" },
        goals: [],
        status_effects: [],
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

export function createElementFromHTML(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstChild;
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
        const fixed = tryRepairJSON(text);
        try { return JSON.parse(fixed); } catch (e2) {
            throw new Error("AI 返回的 JSON 解析失败：" + e2.message + "\n原始内容：" + content.slice(0, 500));
        }
    }
}

export function tryRepairJSON(text) {
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
    // ★ P1.2.5: 彻底无法修复时抛错，交由上层按"错误回合"处理（不 applyStateChanges / 不存盘 / 不推进时间），
    // 不再返回伪造成功的占位回合把玩家这一轮悄悄吞掉。
    throw new Error("AI 返回的 JSON 无法修复（内容截断或结构损坏）");
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
