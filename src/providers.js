// ============================================================
// AetherNarrator · providers.js
// 多模型抽象层（P0-1）：把"模型专属"的请求整形 / 缓存解析 / 缓存策略
// 从游戏业务逻辑（callLLM 等）抽离到这里。换模型只改本文件一处。
// 本文件是叶子模块，不依赖其他 src 模块，避免循环依赖。
// ============================================================

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
        // 普通模型不带 thinking；仅 reasoner 类需要禁用思考
        buildBody: (model, messages, opts = {}) => ({
            model,
            messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            ...(/reasoner/.test(model) ? { thinking: { type: "disabled" } } : {}),
            response_format: { type: "json_object" }
        }),
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
        buildBody: (model, messages, opts = {}) => ({
            model, messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            response_format: { type: "json_object" }
        }),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    zhipu: {
        key: "zhipu",
        label: "智谱 GLM",
        cacheStrategy: "explicit",
        defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
        defaultModel: "glm-4-plus",
        detect: (baseUrl) => /bigmodel|zhipu|chatglm/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => ({
            model, messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            response_format: { type: "json_object" }
        }),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    ollama: {
        key: "ollama",
        label: "本地 Ollama",
        cacheStrategy: "none",
        defaultBaseUrl: "http://localhost:11434/v1",
        defaultModel: "qwen2.5:7b",
        detect: (baseUrl) => /11434|ollama/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => ({
            model, messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            response_format: { type: "json_object" }
        }),
        parseUsage: () => ({ hit: 0, miss: 0, total: 0 })
    },
    openai: {
        key: "openai",
        label: "OpenAI 兼容",
        cacheStrategy: "explicit",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o-mini",
        detect: (baseUrl) => /openai\.com|azure/.test(baseUrl),
        buildBody: (model, messages, opts = {}) => ({
            model, messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            response_format: { type: "json_object" }
        }),
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
        buildBody: (model, messages, opts = {}) => ({
            model, messages,
            temperature: opts.temperature != null ? opts.temperature : 1,
            max_tokens: opts.maxTokens || 8192,
            response_format: { type: "json_object" }
        }),
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
