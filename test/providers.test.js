// 多模型抽象层回归测试（docs/34 2.6 / docs/20）。
// 锁定「按 Base URL 自动识别提供方 + 各提供方请求整形」这一核心路由逻辑，
// 确保换模型/换 Key 的底层能力不被后续重构破坏。
// 仅测纯函数（detectProvider / PROVIDERS / buildBody），不触及 DOM / IndexedDB，稳定可重复。

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, detectProvider } from "../src/providers.js";

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
