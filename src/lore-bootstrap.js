// ============================================================
// AetherNarrator · lore-bootstrap.js
// 知识库补抽兜底（docs/64）：当生成世界 lore_kb.snippets 不足时，基于 desc+ipName
// 单独调一次 LLM 抽取 lore，merge 进原有列表。补抽失败不影响世界生成（catch 后继续）。
// ============================================================
import { S } from "./store.js";
import { logError, buildApiUrl } from "./utils.js";
import { readApiInputs, getProvider } from "./providers.js";

const BACKFILL_MIN = 6;   // 触发补抽的阈值（生成后 lore 不足此数则补）
const BACKFILL_TARGET_MIN = 6;  // 补抽目标最少条数
const BACKFILL_TARGET_MAX = 12; // 补抽目标最多条数

/**
 * 构建补抽 prompt（明确要求分类覆盖与字段齐全）
 */
function buildBackfillPrompt(world) {
    const ipLine = world.ip_name ? `- 参考作品：${world.ip_name}\n` : "";
    return `你是世界观知识库抽取师。基于以下世界信息，输出 ${BACKFILL_TARGET_MIN}~${BACKFILL_TARGET_MAX} 条 lore 条目 JSON。

【硬约束】
- 每条必须含：id（英文短码，唯一）/ title（≤30字）/ category / content（100~300字描述）/ activation_keys（≥2 个检索关键词）。
- category 必须从下列白名单中选，且必须同时覆盖【地点 / 人物 / 事件 / 物品】四类；剩余可在【势力 / 冲突 / 规则】中选 1~2 类。四类缺一视作补抽失败。
- 分类配额建议：地点 2~3、人物 2~3、事件 1~2、物品 1~2。
- 即便描述信息较少，也必须从世界观设定与参考作品推断出合理条目，禁止以"信息不足"为由偷空。

只输出合法 JSON（不要解释、不要 markdown 标记），格式：
{"snippets":[{"id":"loc01","title":"...","category":"地点","content":"...","activation_keys":["...","..."]},{...}]}

- 世界名：${world.name || "未命名"}
${ipLine}- 世界观描述：${world.desc || "(无)"}
`;
}

/**
 * 单条 sanitize（与 utils.js sanitizeWorldConfig 内 snippet 处理对齐）
 */
function sanitizeSnippet(s) {
    if (!s || typeof s !== "object") return null;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    const title = typeof s.title === "string" ? s.title.trim() : "";
    const content = typeof s.content === "string" ? s.content.trim() : "";
    if (!title || !content) return null;
    return {
        id: id || ("bf" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        title: title.slice(0, 200),
        category: (typeof s.category === "string" ? s.category.trim() : "补充").slice(0, 50) || "补充",
        content: content.slice(0, 1000),
        keywords: Array.isArray(s.keywords) ? s.keywords.slice(0, 20).map(k => typeof k === "string" ? k.slice(0, 50) : "") : [],
        activation_keys: Array.isArray(s.activation_keys)
            ? s.activation_keys.slice(0, 20).map(k => typeof k === "string" ? k.slice(0, 50) : "").filter(Boolean)
            : [],
        trigger_mode: "keyword",
        scan_depth: 1,
        priority: 0,
        unlock_stage: 1,
        insert_at: "before_user",
        insert_depth: 1,
        timeline: [],
        links: []
    };
}

/**
 * 从 AI 响应文本中解析 snippets（兼容纯 JSON / markdown code fence / 内嵌 JSON）
 */
function parseLoreFromText(text) {
    if (!text || typeof text !== "string") return [];
    // 1) 直接 parse
    try { const j = JSON.parse(text); if (Array.isArray(j.snippets)) return j.snippets; } catch (_) {}
    // 2) markdown ```json ... ``` 围栏
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        try { const j = JSON.parse(fence[1]); if (Array.isArray(j.snippets)) return j.snippets; } catch (_) {}
    }
    // 3) 截取 { "snippets": [ ... ] } 子串
    const sub = text.match(/\{\s*"snippets"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (sub) {
        try { const j = JSON.parse(sub[0]); if (Array.isArray(j.snippets)) return j.snippets; } catch (_) {}
    }
    return [];
}

/**
 * 当 world.lore_kb.snippets 不足 minCount 时，基于 desc+ipName 调一次 LLM 补抽，
 * merge 进 world.lore_kb（按 id 去重）。失败时返回 { backfilled: false, error }，不抛。
 * @returns {{ backfilled: boolean, added?: number, total?: number, error?: string }}
 */
export async function backfillLoreIfShort(world, minCount = BACKFILL_MIN) {
    const result = { backfilled: false };
    try {
        const existing = (world.lore_kb && Array.isArray(world.lore_kb.snippets)) ? world.lore_kb.snippets : [];
        if (existing.length >= minCount) return result;
        const cfg = readApiInputs();
        if (!cfg || !cfg.apiKey || !cfg.baseUrl || !cfg.model) {
            result.error = "API 未配置";
            return result;
        }
        const provider = getProvider();
        const messages = [{ role: "user", content: buildBackfillPrompt(world) }];
        // plainJson:true 让 deepseek 关掉 thinking，且不强制 tools（避开 tool_choice 路径）
        const body = provider.buildBody(cfg.model, messages, {
            temperature: 0.7,
            maxTokens: 4096,
            plainJson: true
        });
        const controller = new AbortController();
        S.currentAbortController = controller;
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
            const url = buildApiUrl(cfg.baseUrl, cfg.corsProxy);
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + cfg.apiKey
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) { result.error = `HTTP ${res.status}`; return result; }
            const data = await res.json();
            const text = data?.choices?.[0]?.message?.content || "";
            const raw = parseLoreFromText(text);
            const sanitized = raw.map(sanitizeSnippet).filter(Boolean);
            if (sanitized.length === 0) {
                result.error = "补抽响应解析为空";
                return result;
            }
            // 合并去重（按 id）
            const seen = new Set(existing.map(s => s.id));
            const merged = existing.slice();
            let added = 0;
            for (const s of sanitized) {
                if (seen.has(s.id)) continue;
                seen.add(s.id);
                merged.push(s);
                added++;
            }
            world.lore_kb = { ip: world.lore_kb?.ip || world.name || "", snippets: merged };
            result.backfilled = added > 0;
            result.added = added;
            result.total = merged.length;
            return result;
        } catch (e) {
            clearTimeout(timeoutId);
            if (e && e.name === "AbortError") { result.error = "补抽超时（60秒）"; return result; }
            result.error = e && e.message || String(e);
            return result;
        }
    } catch (e) {
        logError("loreBackfill", e);
        result.error = e && e.message || String(e);
        return result;
    }
}