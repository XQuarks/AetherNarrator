// ★ 67 · GM 专属真相层（借鉴 WorldLines gm-truth 禁读设计）
// 覆盖：sanitize 白名单规整 / buildGmTruthReveals 受控揭示 / 硬隔离断言（未到期真相不进叙事 prompt）/ 生成 prompt 说明段
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
};
globalThis.window = globalThis;

const { S } = await import("../src/store.js");
const { sanitizeWorldConfig } = await import("../src/utils.js");
const { buildGmTruthReveals, buildTurnUserMessage, buildWorldGenerationPrompt } = await import("../src/prompt.js");

function resetRuntime() {
    storage.clear();
    S.currentWorld = { id: "w1", name: "测试世界", gm_truth: { entries: [] } };
    S.activeBehaviorRecords = [];
    S.gameState = { story_progress: 1, current_date: { day: 1, period: "morning" }, current_location: "庭院" };
    S.chatHistory = [];
    S.chatSummary = [];
    S.activeLoreKB = null;
    S.aiEnhanced = false;
}

const GM = {
    entries: [
        { id: "gt1", title: "勾玉的真相", content: "神社家子女出生获赠透明勾玉；被 Yith 寄宿时变黑。", unlock_stage: 3 },
        { id: "gt2", title: "循环铁律", content: "翼每个 Day1 失血死；悠人醒来即攻击最近的人。", unlock_stage: 4 }
    ]
};

// ===== sanitize 白名单与规整 =====
test("sanitize：gm_truth 通过白名单并规整字段", () => {
    const w = sanitizeWorldConfig({ name: "x", gm_truth: GM, desc: "忽略" });
    assert.ok(w.gm_truth && Array.isArray(w.gm_truth.entries), "gm_truth 应被保留");
    assert.equal(w.gm_truth.entries.length, 2);
    assert.equal(w.gm_truth.entries[0].title, "勾玉的真相");
    assert.equal(w.gm_truth.entries[0].unlock_stage, 3);
    assert.equal(w.desc, undefined, "非白名单字段仍被丢弃");
});

test("sanitize：gm_truth 非法/空值清理", () => {
    const w1 = sanitizeWorldConfig({ gm_truth: "not-an-object" });
    assert.equal(w1.gm_truth, undefined, "非对象丢弃");
    const w2 = sanitizeWorldConfig({ gm_truth: { entries: [{ title: "", content: "" }] } });
    assert.equal(w2.gm_truth, undefined, "全空条目删除字段");
    const w3 = sanitizeWorldConfig({ gm_truth: { entries: [{ id: "a", title: "t", content: "c", unlock_stage: 999 }] } });
    assert.equal(w3.gm_truth.entries[0].unlock_stage, 50, "unlock_stage 钳制上限");
    assert.equal(w3.gm_truth.entries[0].content, "c");
});

// ===== buildGmTruthReveals 受控揭示 =====
test("buildGmTruthReveals：无 gm_truth 或未到期返回空串", () => {
    resetRuntime();
    assert.equal(buildGmTruthReveals(S.gameState, S.currentWorld), "");
    S.currentWorld.gm_truth = GM;
    S.gameState.story_progress = 2;
    assert.equal(buildGmTruthReveals(S.gameState, S.currentWorld), "", "进度未到 3 时不应揭示");
});

test("buildGmTruthReveals：到期条目按进度揭示，未到期仍隐藏", () => {
    resetRuntime();
    S.currentWorld.gm_truth = GM;
    S.gameState.story_progress = 3;
    const block = buildGmTruthReveals(S.gameState, S.currentWorld);
    assert.ok(block.includes("勾玉的真相"), "进度 3 时应揭示 gt1");
    assert.ok(block.includes("神社家子女出生获赠透明勾玉"), "应含 gt1 内容");
    assert.ok(!block.includes("循环铁律"), "进度 3 时 gt2（stage 4）不得出现");
    S.gameState.story_progress = 5;
    const block2 = buildGmTruthReveals(S.gameState, S.currentWorld);
    assert.ok(block2.includes("循环铁律"), "进度 5 时应揭示 gt2");
});

test("buildGmTruthReveals：缺省参数走 S.currentWorld / S.gameState", () => {
    resetRuntime();
    S.currentWorld.gm_truth = GM;
    S.gameState.story_progress = 5;
    const block = buildGmTruthReveals();
    assert.ok(block.includes("勾玉的真相") && block.includes("循环铁律"));
});

// ===== 硬隔离断言：未到期真相绝不出现在叙事 prompt =====
test("硬隔离：buildTurnUserMessage 不含任何未到期真相文本", () => {
    resetRuntime();
    S.currentWorld.gm_truth = GM;
    S.gameState.story_progress = 2; // gt1/gt2 均未到期
    const msg = buildTurnUserMessage("玩家在岛上探索", []);
    assert.ok(!msg.includes("勾玉"), "未到期真相标题不得进入 user 消息");
    assert.ok(!msg.includes("Yith"), "未到期真相内容不得进入 user 消息");
    assert.ok(!msg.includes("循环铁律"), "未到期真相标题不得进入 user 消息");
});

test("硬隔离：system 段不含 GM 真相（由代码结构保证——gm_truth 只在 buildGmTruthReveals 出口）", () => {
    resetRuntime();
    S.currentWorld.gm_truth = GM;
    S.gameState.story_progress = 5; // 即使全部到期，system 静态段也不含真相（真相只走受控揭示消息）
    // buildSystemPrompt 依赖 DOM（getProvider），Node 环境无法直接单测；
    // 此处验证"gm_truth 为独立字段、未混入 lore_kb"这一结构保证（llm.js 组装中真相仅出现在 gmReveal 独立消息）。
    const userMsg = buildTurnUserMessage("玩家在岛上探索", []);
    assert.ok(!userMsg.includes("勾玉的真相"), "user 消息不含真相");
    const w = sanitizeWorldConfig({ lore_kb: { ip: "雾港", snippets: [] }, gm_truth: GM });
    assert.ok(!JSON.stringify(w.lore_kb).includes("勾玉的真相"), "知识库对象不含真相内容");
});

// ===== 生成 prompt 支持 =====
test("buildWorldGenerationPrompt：含 gm_truth 可选输出说明", () => {
    const prompt = buildWorldGenerationPrompt("雾港", "一座大雾海港城", "你", null, null, null, null, 3, null, "第二人称", 8000, null);
    assert.ok(prompt.includes("gm_truth"), "生成 prompt 应提示产出 gm_truth");
    assert.ok(prompt.includes("幕后真相"), "应说明是幕后真相");
});

// ===== 检索/知识库隔离 =====
test("隔离：gm_truth 不进 lore_kb（sanitize 后仍为独立字段）", () => {
    const w = sanitizeWorldConfig({ lore_kb: { ip: "雾港", snippets: [] }, gm_truth: GM });
    assert.ok(w.gm_truth && w.gm_truth.entries.length, "gm_truth 独立保留");
    assert.equal(w.lore_kb.snippets.length, 0, "gm_truth 未混入知识库条目");
});
