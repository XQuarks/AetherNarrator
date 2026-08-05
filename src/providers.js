// ============================================================
// AetherNarrator · providers.js
// 多模型抽象层（P0-1）：把"模型专属"的请求整形 / 缓存解析 / 缓存策略
// 从游戏业务逻辑（callLLM 等）抽离到这里。换模型只改本文件一处。
// 本文件是叶子模块，不依赖其他 src 模块，避免循环依赖。
// ============================================================

// ★ 思考型/推理型模型识别（reasoner 类除外：DeepSeek 已用 thinking: disabled 让 reasoner 走工具路径）。
// 命中的模型名不接受"强制 tool_choice"（API 报 "Thinking mode does not support this tool_choice"），
// 因此在 buildChatBody 里退回纯文本输出，靠调用方 content 兜底解析。
// 词边界用分隔符（开头/结尾或 . _ -），避免误伤 gpt-4o、qwen2.5 这类普通模型名。
export function isThinkingModel(model = "") {
    return /(?:^|[._-])(?:r1|think|thinking|o1|o3)(?:[._-]|$)/i.test(model);
}

// ★ tool_choice 冲突判定：API 400 且报"思考模式不支持强制工具选择" → 调用方可退纯文本重试。
// 纯字符串判定，不触 DOM，可在 Node 单测。
export function isToolChoiceConflictError(e) {
    const msg = (e && e.message) || "";
    return /HTTP 400/.test(msg) && /tool_choice|thinking mode/i.test(msg);
}

// 共享请求体构造：
// - 默认 response_format: { type: "json_object" }（向后兼容旧调用）
// - 传入 opts.tool 时改为 function calling：发 tools + 强制 tool_choice，不再用 json_object
//   （Phase 5 工具调用约束：让模型直接返回已解析的结构化参数）
// - 思考型模型（或 opts.plainJson 显式要求）→ 纯文本：不发 tools/tool_choice，
//   也不发 response_format（reasoner 不支持 json_object），靠 content 兜底解析。
function buildChatBody(model, messages, opts = {}, extra = {}) {
    const base = {
        model,
        messages,
        temperature: opts.temperature != null ? opts.temperature : 1,
        max_tokens: opts.maxTokens || 8192,
        ...extra
    };
    const plainJson = opts.plainJson === true || (opts.tool && isThinkingModel(model));
    if (opts.tool && !plainJson) {
        return {
            ...base,
            tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.parameters } }],
            tool_choice: { type: "function", function: { name: opts.tool.name } }
        };
    }
    if (plainJson) return base;
    return { ...base, response_format: { type: "json_object" } };
}

// 各模型预设。新增模型只需在此追加一项。
// cacheStrategy:
//   - "prefix"   前缀缓存（system 稳定不变即可命中，如 DeepSeek）
//   - "explicit" 显式 cache_control 断点（如 OpenAI 系 / 通义 / 智谱，若支持）
//   - "none"     不缓存（本地模型）
export const PROVIDERS = {
    deepseek: {
        key: "deepseek",
        label: "DeepSeek",
        cacheStrategy: "prefix",
        defaultBaseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
        detect: (baseUrl) => /deepseek/.test(baseUrl),
        // 普通模型不带 thinking；但 DeepSeek 官方 API 的思考模式不支持强制 tool_choice
        // （HTTP 400 "Thinking mode does not support this tool_choice"）且正文 content 可能为空，
        // 故工具调用（tool）或纯文本降级（plainJson）或 reasoner 类一律禁用思考，一次成功不靠重试。
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts, (opts.tool || opts.plainJson || /reasoner/.test(model)) ? { thinking: { type: "disabled" } } : {}),
        // DeepSeek 专属缓存字段
        parseUsage: (usage = {}) => {
            const hit = usage.prompt_cache_hit_tokens || 0;
            const miss = usage.prompt_cache_miss_tokens || 0;
            return { hit, miss, total: hit + miss };
        }
    },
    qwen: {
        key: "qwen",
        label: "通义千问",
        cacheStrategy: "explicit",
        defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        defaultModel: "qwen-max",
        detect: (baseUrl) => /dashscope|aliyun|qwen/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    zhipu: {
        key: "zhipu",
        label: "智谱 GLM",
        cacheStrategy: "explicit",
        defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        defaultModel: "glm-4-plus",
        detect: (baseUrl) => /bigmodel|zhipu|chatglm/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    ollama: {
        key: "ollama",
        label: "本地 Ollama",
        cacheStrategy: "none",
        defaultBaseUrl: "http://localhost:11434/v1",
        defaultModel: "qwen2.5:7b",
        detect: (baseUrl) => /11434|ollama/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    openai: {
        key: "openai",
        label: "OpenAI 兼容",
        cacheStrategy: "explicit",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o-mini",
        detect: (baseUrl) => /openai\.com|azure/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts),
        parseUsage: (usage = {}) => {
            // OpenAI 系用 prompt_tokens_details.cached_tokens 表示缓存命中
            const hit = usage.prompt_tokens_details?.cached_tokens || 0;
            const total = usage.prompt_tokens || 0;
            return { hit, miss: Math.max(0, total - hit), total };
        }
    },
    custom: {
        key: "custom",
        label: "自定义",
        cacheStrategy: "prefix", // 默认按前缀缓存，最贴近 DeepSeek 体验
        defaultBaseUrl: "",
        defaultModel: "",
        detect: () => false,
        buildBody: (model, messages, opts = {}) => buildChatBody(model, messages, opts),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    }
};

// 按 baseUrl 自动识别当前模型预设 key
export function detectProvider(baseUrl = "") {
    for (const key of ["deepseek", "qwen", "zhipu", "ollama", "openai"]) {
        if (PROVIDERS[key].detect(baseUrl)) return key;
    }
    return "custom";
}

// 读取当前页面配置，返回对应预设对象（供业务代码查缓存策略/整形请求）
export function getProvider() {
    const baseUrl = (document.getElementById("baseUrl")?.value || "").trim();
    return PROVIDERS[detectProvider(baseUrl)];
}

// 统一读取页面上的 API 输入（收口散落的 document.getElementById），
// 返回 { baseUrl, corsProxy, apiKey, model, provider }
export function readApiInputs() {
    const baseUrl = (document.getElementById("baseUrl")?.value || "").trim();
    const corsProxy = (document.getElementById("corsProxy")?.value || "").trim();
    const apiKey = (document.getElementById("apiKey")?.value || "").trim();
    const model = (document.getElementById("modelName")?.value || "").trim();
    return { baseUrl, corsProxy, apiKey, model, provider: PROVIDERS[detectProvider(baseUrl)] };
}

// 大书分块抽取并发数（默认 100，与 game.js 原硬编码一致）。
// API 输入框常驻 DOM，直接读取即可；非法/缺失值时兜回 100。
export function getChunkConcurrency() {
    const el = document.getElementById("chunkConcurrency");
    const v = parseInt(el?.value, 10);
    return Number.isFinite(v) && v >= 1 ? v : 100;
}

// 向量化并发数（默认 100）。生成知识库后为各条目计算语义向量（本地中文模型、单线程 Worker），
// 此值决定主线程同时预投喂给 Worker 的任务数。跑在浏览器环境；非浏览器（如 Node 测试）兜回 100。
export function getEmbedConcurrency() {
    if (typeof document === "undefined") return 100;
    const el = document.getElementById("embedConcurrency");
    const v = parseInt(el?.value, 10);
    return Number.isFinite(v) && v >= 1 ? v : 100;
}
