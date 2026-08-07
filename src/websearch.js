// ============================================================
// AetherNarrator · websearch.js
// DeepSeek 联网搜索（预检索接地 / Pre-pass Grounding）
// ------------------------------------------------------------
// 设计：在主回合生成【之前】，单独调用 DeepSeek 的 Responses API
// （/responses 端点）的 web_search 工具，把"现实查证事实"作为一层
// 额外背景知识注入 prompt。它与现有 /chat/completions 的「强制单工具
// 结构化 JSON 输出」链路完全隔离——主回合逻辑一行不动，搜索失败也只是
// 静默跳过、不影响主线。
//
// 为什么走 /responses 而不是 /chat/completions？
//   官方实测：chat/completions 端点会 400 拒绝 web_search 工具；
//   联网搜索只在 Responses API 可用，且由模型自主决定是否搜索。
//
// 能力门禁：仅 DeepSeek v4 模型生效；其他服务商（通义/智谱/Ollama 等）
// 自动跳过，不报错。
// ============================================================
import { isModuleEnabled } from "./modules.js";
import { readApiInputs } from "./providers.js";

// 自动搜索冷却（以"调用次数"近似回合数）：现实世界类世界至多每 N 次调用
// 自动搜一次，避免每个回合都烧 token。玩家显式触发（见下）不受冷却限制。
const AUTO_COOLDOWN_CALLS = 3;
let callSeq = 0;
let lastAutoSeq = -999;

// 玩家输入里出现这些词 → 触发联网搜索（任意已开启模块的世界均可）
const KEYWORD_RE = /查一下|查一查|搜一下|搜索|搜搜|新闻|最近|今天|现在|实时|最新|资料|背景|百科|百度|google|what\b|when\b|who\b|where\b|why\b|how\b/i;

// 单次搜索正文上限，避免超大抓取撑爆 prompt / 烧 token
const MAX_TEXT_CHARS = 1500;

// 判断世界是否自动注入联网参考——C2 收窄 + C2-史实扩展：
//   1) 史实参考模式：世界显式开启 historical_accuracy 即命中（无论 type，适配三国等基于真实历史的原创/同人世界）；
//   2) 当代现实模式：仅原创且当前/起始年份 >= 2000 才命中；
//   虚构/同人/改编 IP（如龙族）不自动注入现实事件，避免现实新闻污染保密/虚构世界观。
// 玩家显式"查一下 XXX"仍可触发（见 maybeWebSearch 的关键词分支，对所有世界生效）。
export function isRealWorldEligible(world) {
    if (!world) return false;
    // ★ C2-史实：世界显式开启史实参考即命中，绕过 type 限制
    if (world.historical_accuracy && world.historical_accuracy.enabled === true) return true;
    const t = world.type;
    // 仅原创世界；ip/fan/shared/public_domain 等虚构/改编 IP 一律不自动注入现实事件
    if (t && t !== "original") return false;
    // 当代背景：当前 / 起始年份 >= 2000 视为当代
    const dateStr = world.current_date || world.calendar_start || "";
    const yr = parseInt(String(dateStr).slice(0, 4), 10);
    if (Number.isFinite(yr) && yr >= 2000) return true;
    return false;
}

// 联网注入的措辞模式：史实世界用「历史参考」措辞（玩家可改写历史，史实仅作参考），
// 其余用「现实事件」措辞（以本世界设定为准）。导出供测试与编排复用。
export function worldSearchMode(world) {
    if (world && world.historical_accuracy && world.historical_accuracy.enabled === true) return "historical";
    return "contemporary";
}

// 构造自动搜索查询：依模式不同生成不同查询（史实类拉历史背景/事件，当代类拉同期现实大事）
function buildAutoQuery(world, mode) {
    const name = (world.ip_name || world.name || "本世界").trim();
    if (mode === "historical") {
        // 史实类：围绕作品/世界名 + 当前时期拉取历史背景与重要事件
        const dateStr = world.current_date || world.calendar_start || "";
        const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
        if (m) {
            const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
            const era = Number.isFinite(y) && y < 0 ? "公元元年之前" : "公元" + y + "年" + (Number.isFinite(mo) ? (mo + "月") : "");
            return name + " " + era + " 历史 史实 背景 重要事件 战役 人物 社会 文化";
        }
        return name + " 历史 史实 背景 重要事件 人物";
    }
    // 当代：围绕当前日期拉同期现实世界发生的大事
    const dateStr = world.current_date || world.calendar_start || "";
    const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
    if (m) {
        const y = m[1], mo = parseInt(m[2], 10);
        return y + "年" + mo + "月 全球 重大新闻 事件 社会 科技 文化 发生了什么";
    }
    return "近期 全球 重大新闻 事件 社会 科技 文化";
}

// 真正的联网调用：打 /responses 端点，带 web_search 工具，非流式。
// 返回 { text, citations } 或 null（失败）。
export async function webSearchOnce(query, { baseUrl, corsProxy, apiKey, model }) {
    const base = (baseUrl || "").replace(/\/$/, "");
    if (!base) return null;
    const url = corsProxy
        ? corsProxy.replace(/\/$/, "") + "/" + base + "/responses"
        : base + "/responses";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify({
                model,
                input: query,
                tools: [{ type: "web_search" }],
                stream: false
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            const txt = await res.text().catch(() => "");
            console.warn("[webSearch] HTTP", res.status, txt.slice(0, 200));
            return null;
        }
        const data = await res.json();
        return extractSearchResult(data);
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn("[webSearch] 调用失败（已降级，不影响主线）：", e && e.message);
        return null;
    }
}

// 从 Responses API 返回里抽取正文文本（兼容多种形态，对黑盒结果做容忍解析）
function extractSearchResult(data) {
    if (!data) return null;
    // 形态 1：顶层 output_text（部分实现直接给拼接文本）
    if (typeof data.output_text === "string" && data.output_text.trim()) {
        return { text: data.output_text.trim(), citations: collectCitations(data) };
    }
    // 形态 2：output 数组，遍历 message / output_text 项
    const parts = [];
    const citations = [];
    if (Array.isArray(data.output)) {
        for (const item of data.output) {
            const content = item && item.content;
            if (Array.isArray(content)) {
                for (const c of content) {
                    if (c && c.type === "output_text" && c.text) {
                        parts.push(c.text);
                        if (Array.isArray(c.annotations)) {
                            for (const a of c.annotations) {
                                if (a && a.url) citations.push({ title: a.title || a.url, url: a.url });
                            }
                        }
                    }
                }
            } else if (item && typeof item.text === "string" && item.text) {
                parts.push(item.text);
            }
        }
    }
    const text = parts.join("\n\n").trim();
    if (!text) return null;
    return { text, citations };
}

function collectCitations(data) {
    const out = [];
    if (Array.isArray(data.output)) {
        for (const item of data.output) {
            if (item && Array.isArray(item.content)) {
                for (const c of item.content) {
                    if (c && Array.isArray(c.annotations)) {
                        for (const a of c.annotations) {
                            if (a && a.url) out.push({ title: a.title || a.url, url: a.url });
                        }
                    }
                }
            }
        }
    }
    return out;
}

// 编排：本回合要不要搜、搜什么、以哪种措辞注入。返回 { text, mode }（text 空 = 不搜）。
// mode ∈ "historical" | "contemporary"，由 worldSearchMode 依世界配置决定。
export async function maybeWebSearch(input, world) {
    callSeq++;
    const mode = worldSearchMode(world);
    if (!world || !isModuleEnabled(world, "web_search")) return { text: "", mode };

    const { baseUrl, corsProxy, apiKey, model, provider } = readApiInputs();
    if (provider.key !== "deepseek") {
        // 仅 DeepSeek 支持 /responses 联网搜索；其他模型静默跳过
        return { text: "", mode };
    }
    if (!apiKey || !model) return { text: "", mode };

    let query = null;
    const keywordHit = KEYWORD_RE.test(input || "");
    if (keywordHit) {
        // 玩家显式要查：去掉引导词后把原话当查询
        query = (input || "").replace(/^(查一下|查一查|搜一下|搜索|搜搜)\s*/i, "").trim() || input;
    } else if (isRealWorldEligible(world)) {
        // 现实/当代/IP 世界：带冷却地自动搜，给 AI 一点现实接地
        if (callSeq - lastAutoSeq >= AUTO_COOLDOWN_CALLS) {
            query = buildAutoQuery(world, mode);
            lastAutoSeq = callSeq;
        }
    }
    if (!query) return { text: "", mode };

    console.info("[webSearch] 触发联网搜索（" + mode + "）：", query);
    const r = await webSearchOnce(query, { baseUrl, corsProxy, apiKey, model });
    if (!r || !r.text) return { text: "", mode };
    const text = r.text.length > MAX_TEXT_CHARS
        ? r.text.slice(0, MAX_TEXT_CHARS) + "…（已截断）"
        : r.text;
    return { text, mode };
}
