// 多模型抽象层回归测试（docs/34 2.6 / docs/20）。
// 锁定「按 Base URL 自动识别提供方 + 各提供方请求整形」这一核心路由逻辑，
// 确保换模型/换 Key 的底层能力不被后续重构破坏。
// 仅测纯函数（detectProvider / PROVIDERS / buildBody），不触及 DOM / IndexedDB，稳定可重复。

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, detectProvider, isThinkingModel, isToolChoiceConflictError } from "../src/providers.js";

test("PROVIDERS 含 6 个预设且均有合理默认", () => {
    const keys = Object.keys(PROVIDERS);
    assert.deepEqual(keys.sort(), ["custom", "deepseek", "ollama", "openai", "qwen", "zhipu"]);
    for (const k of keys) {
        const p = PROVIDERS[k];
        assert.equal(p.key, k, `${k} 的 key 自洽`);
        assert.ok(p.defaultBaseUrl || k === "custom", `${k} 提供默认 Base URL`);
        assert.ok(typeof p.defaultModel === "string", `${k} 提供默认模型`);
        assert.equal(typeof p.buildBody, "function", `${k} 提供 buildBody`);
        assert.ok(["prefix", "explicit", "none"].includes(p.cacheStrategy), `${k} 缓存策略合法`);
    }
});

test("detectProvider 按 Base URL 识别已知提供方", () => {
    assert.equal(detectProvider("https://api.deepseek.com"), "deepseek");
    assert.equal(detectProvider("https://dashscope.aliyuncs.com/compatible-mode/v1"), "qwen");
    assert.equal(detectProvider("https://open.bigmodel.cn/api/paas/v4"), "zhipu");
    assert.equal(detectProvider("http://localhost:11434/v1"), "ollama");
    assert.equal(detectProvider("https://api.openai.com/v1"), "openai");
    assert.equal(detectProvider("https://api.openai.com/v1/"), "openai");
});

test("detectProvider 未知 URL 回退 custom", () => {
    assert.equal(detectProvider("https://my-proxy.example.com/v1"), "custom");
    assert.equal(detectProvider(""), "custom");
    assert.equal(detectProvider("https://weird-provider.xyz"), "custom");
});

test("所有 OpenAI 兼容提供方 buildBody 均带 json_object 响应格式", () => {
    const msgs = [{ role: "user", content: "hi" }];
    for (const k of ["deepseek", "qwen", "zhipu", "ollama", "openai", "custom"]) {
        const body = PROVIDERS[k].buildBody("model-x", msgs, {});
        assert.equal(body.response_format.type, "json_object", `${k} 强制 JSON 响应`);
        assert.equal(body.model, "model-x");
        assert.deepEqual(body.messages, msgs);
        assert.ok(Number.isFinite(body.max_tokens), `${k} 带 max_tokens`);
    }
});

test("DeepSeek reasoner 类模型自动禁用思考", () => {
    const normal = PROVIDERS.deepseek.buildBody("deepseek-v4-flash", [], {});
    assert.ok(!("thinking" in normal), "普通模型不带 thinking");
    const reasoner = PROVIDERS.deepseek.buildBody("deepseek-reasoner", [], {});
    assert.deepEqual(reasoner.thinking, { type: "disabled" }, "reasoner 禁用思考");
});

test("OpenAI 系 parseUsage 从 prompt_tokens_details 读缓存命中", () => {
    const r = PROVIDERS.openai.parseUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 } });
    assert.equal(r.hit, 40);
    assert.equal(r.total, 100);
    assert.equal(r.miss, 60);
});

test("默认 Base URL 与文档/UI 下拉一致", () => {
    assert.equal(PROVIDERS.deepseek.defaultBaseUrl, "https://api.deepseek.com");
    assert.equal(PROVIDERS.deepseek.defaultModel, "deepseek-v4-flash");
});

test("isThinkingModel 识别思考型模型名（reasoner 除外）", () => {
    assert.equal(isThinkingModel("deepseek-r1"), true, "r1 类思考模型");
    assert.equal(isThinkingModel("deepseek-v4-flash"), false, "默认 v4-flash 非思考型");
    assert.equal(isThinkingModel("deepseek-reasoner"), false, "reasoner 走 DeepSeek 禁用思考路径，不在此列");
    assert.equal(isThinkingModel("gpt-o1-mini"), true, "o1 类");
    assert.equal(isThinkingModel("gpt-o3"), true, "o3 类");
    assert.equal(isThinkingModel("gpt-4o"), false, "4o 非思考型，避免 -o 误伤");
    assert.equal(isThinkingModel("qwen2.5:7b"), false, "普通模型不受影响");
    assert.equal(isThinkingModel(""), false);
});

test("思考型模型 + tool → 纯文本输出（无 tools/tool_choice/response_format）", () => {
    const tool = { name: "generate_world", description: "d", parameters: { type: "object" } };
    const body = PROVIDERS.qwen.buildBody("deepseek-r1", [{ role: "user", content: "hi" }], { tool });
    assert.ok(!("tools" in body), "思考型模型不发 tools");
    assert.ok(!("tool_choice" in body), "思考型模型不强制 tool_choice");
    assert.ok(!("response_format" in body), "纯文本不发 response_format（reasoner 不支持 json_object）");
    assert.equal(body.model, "deepseek-r1");
});

test("普通模型 + tool → 发 tools 并强制 tool_choice", () => {
    const tool = { name: "generate_world", description: "d", parameters: { type: "object" } };
    const body = PROVIDERS.qwen.buildBody("qwen-max", [{ role: "user", content: "hi" }], { tool });
    assert.equal(body.tools[0].function.name, "generate_world");
    assert.deepEqual(body.tool_choice, { type: "function", function: { name: "generate_world" } });
    assert.ok(!("response_format" in body), "工具模式不再叠 json_object");
});

test("plainJson 显式强制 → 纯文本输出（供 tool_choice 冲突兜底重试）", () => {
    const body = PROVIDERS.deepseek.buildBody("deepseek-v4-flash", [], { plainJson: true });
    assert.ok(!("tools" in body) && !("tool_choice" in body) && !("response_format" in body));
});

test("isToolChoiceConflictError 判定 API 400 思考模式冲突", () => {
    const apiErr = new Error(`HTTP 400: {"error":{"message":"Thinking mode does not support this tool_choice","type":"invalid_request_error"}}`);
    assert.equal(isToolChoiceConflictError(apiErr), true, "thinking + tool_choice 冲突");
    assert.equal(isToolChoiceConflictError(new Error("HTTP 500: server error")), false, "非 400 不重试");
    assert.equal(isToolChoiceConflictError(new Error("HTTP 400: rate limit exceeded")), false, "400 但非工具冲突不重试");
    assert.equal(isToolChoiceConflictError(null), false, "空错误不崩");
});
