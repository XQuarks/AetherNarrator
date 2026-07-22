// S5-5：Critic 时间一致性维度
// 覆盖：① buildCriticTimeContext 纯函数（gregorian / multiverse 取 active 线 / 无配置空串）
//       ② callWorldCriticLLM 注入「权威时间锚点」+「已知时间冲突线索」+ 第7条审查重点 + 占位符鼓励
// 说明：callWorldCriticLLM 的 LLM 调用依赖浏览器 fetch；此处用非 mock 模式 + 全局 fetch 桩捕获 prompt，
//       避免真实烧 API（见 docs/20 §13 S5-5）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCriticTimeContext } from "../src/utils.js";
import { callWorldCriticLLM } from "../src/llm.js";

// 非 mock 模式 + 提供 readApiInputs 所需 DOM 元素；mock fetch 捕获 prompt
function installDom() {
    globalThis.document = {
        getElementById: (id) => {
            if (id === "mockMode") return { checked: false }; // 非 mock，才会构造 prompt
            if (id === "baseUrl") return { value: "https://api.test/v1" };
            if (id === "apiKey") return { value: "test-key" };
            if (id === "modelName") return { value: "test-model" };
            if (id === "corsProxy") return { value: "" };
            return { value: "", checked: false };
        }
    };
}

function makeWorld(over) {
    return {
        id: "w1",
        name: "测试世界",
        desc: "一个用于审稿测试的世界。",
        lore_kb: { snippets: [{ id: "s1", category: "事件", title: "某事件", content: "1620 年爆发了一场战役。", activation_keys: ["战役"] }] },
        schema: { time_config: { calendar_mode: "gregorian", calendar_start: { year: 1620, month: 1, date: 1 }, season: "冬季", era_label: "大航海时代" } },
        rules: [],
        ...over
    };
}

test("S5-5 buildCriticTimeContext：gregorian 含年份/季节/纪元/历法标签", () => {
    const ctx = buildCriticTimeContext(makeWorld());
    assert.ok(ctx.includes("1620"), "应含起始年份 1620");
    assert.ok(ctx.includes("冬"), "应含季节 冬");
    assert.ok(ctx.includes("大航海时代"), "应含纪元标签 大航海时代");
    assert.ok(ctx.includes("公历"), "应含历法标签 公历");
});

test("S5-5 buildCriticTimeContext：multiverse 取 active 线锚点而非其他线", () => {
    const w = makeWorld({
        schema: {
            time_config: {
                mode: "multiverse",
                active_timeline: "moon",
                timelines: {
                    earth: { name: "地球", calendar_mode: "gregorian", calendar_start: { year: 2003 }, era_label: "现代" },
                    moon: { name: "月球", calendar_mode: "lunar", calendar_start: { year: 3024 }, era_label: "月历" }
                }
            }
        }
    });
    const ctx = buildCriticTimeContext(w);
    assert.ok(ctx.includes("3024"), "应取 active 线 moon 的 3024");
    assert.ok(ctx.includes("农历"), "active 线为 lunar → 农历");
    assert.ok(!ctx.includes("2003"), "不应含非 active 线的 2003");
});

test("S5-5 buildCriticTimeContext：无 time_config 返回空串（prompt 不增时间章节）", () => {
    assert.strictEqual(buildCriticTimeContext(makeWorld({ schema: {} })), "");
});

// —— 集成：callWorldCriticLLM 注入时间章节 ——
test("S5-5 callWorldCriticLLM：prompt 含权威时间锚点 + 第7条 + 占位符鼓励", async () => {
    installDom();
    let captured = "";
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        captured = body.messages[0].content;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ snippets: [] }) } }] }) };
    };
    await callWorldCriticLLM(makeWorld().lore_kb, makeWorld()); // diff 空 → return null，但 prompt 已捕获
    assert.ok(captured.includes("权威时间锚点"), "应注入「权威时间锚点」章节");
    assert.ok(captured.includes("时间一致性"), "审查重点应含第7条「时间一致性」");
    assert.ok(captured.includes("{calendar_date}"), "修订规则应鼓励占位符 {calendar_date}");
});

test("S5-5 callWorldCriticLLM：detectTimeConflict 命中时注入「已知时间冲突线索」", async () => {
    installDom();
    let captured = "";
    globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        captured = body.messages[0].content;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ snippets: [] }) } }] }) };
    };
    // 开场白写死 1999，但 calendar_start 1620 → detectTimeConflict 命中
    const w = makeWorld({
        opening_narrative: "1999 年的冬天，故事开始。",
        schema: { time_config: { calendar_mode: "gregorian", calendar_start: { year: 1620, month: 1, date: 1 }, season: "冬季", era_label: "大航海时代" } }
    });
    await callWorldCriticLLM(w.lore_kb, w);
    assert.ok(captured.includes("已知时间冲突线索"), "detectTimeConflict 命中应注入「已知时间冲突线索」章节");
});
