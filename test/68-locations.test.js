// ★ 68 · 地点连接图（借鉴 WorldLines locations）
// 覆盖：sanitize 白名单规整 / 生成 prompt 说明段 / 紧凑状态注入 connections_from_current /
//      事件地点匹配并入 / 无图世界行为不变（兼容）
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
const { buildWorldGenerationPrompt, buildCompactGameState, inferTriggerFromContent } = await import("../src/prompt.js");

function resetRuntime() {
    storage.clear();
    S.currentWorld = { id: "w1", name: "测试世界" };
    S.activeBehaviorRecords = [];
    S.activeLoreKB = null;
    S.gameState = { story_progress: 1, current_date: { day: 1, period: "morning" }, current_location: "咖啡馆" };
    S.chatHistory = [];
    S.chatSummary = [];
}

const LOCS = [
    { id: "cafe", name: "咖啡馆", summary: "老式咖啡馆", connections: ["集市", "码头后巷", "咖啡馆"], npcs_default: ["镜子"], hidden: false },
    { id: "market", name: "集市", summary: "热闹的集市", connections: ["咖啡馆"], hidden: false },
    { id: "basement", name: "码头后巷", summary: "阴暗后巷", connections: [], hidden: true }
];

// ===== sanitize =====
test("sanitize：locations 通过白名单并规整字段", () => {
    const w = sanitizeWorldConfig({ name: "雾港", locations: LOCS, desc: "忽略" });
    assert.ok(Array.isArray(w.locations), "locations 应被保留");
    assert.equal(w.locations.length, 3);
    assert.equal(w.locations[0].name, "咖啡馆");
    assert.ok(w.locations[0].connections.includes("集市"), "保留合法连接");
    assert.ok(!w.locations[0].connections.includes("咖啡馆"), "连接剔除自引用");
    assert.equal(w.locations[0].npcs_default[0], "镜子");
    assert.equal(w.locations[2].hidden, true);
    assert.equal(w.desc, undefined, "非白名单字段仍被丢弃");
});

test("sanitize：locations 非法/空值清理", () => {
    const w1 = sanitizeWorldConfig({ locations: "not-array" });
    assert.equal(w1.locations, undefined, "非数组丢弃");
    const w2 = sanitizeWorldConfig({ locations: [{ id: "a", name: "" }] });
    assert.equal(w2.locations, undefined, "name 全空删除字段");
    const w3 = sanitizeWorldConfig({ locations: [{ name: "X", connections: ["X", "", "Y"] }, { name: "Y" }] });
    assert.deepEqual(w3.locations[0].connections, ["Y"], "空串与自引用被过滤、去重");
});

// ===== 生成 prompt =====
test("buildWorldGenerationPrompt：含 locations 可选输出说明", () => {
    const prompt = buildWorldGenerationPrompt("雾港", "一座大雾海港城", "你", null, null, null, null, 3, null, "第二人称", 8000, null);
    assert.ok(prompt.includes("locations"), "生成 prompt 应提示产出 locations");
    assert.ok(prompt.includes("地点连接图"), "应说明是地点连接图");
});

// ===== 紧凑状态注入 =====
test("buildCompactGameState：有 locations 时输出 connections_from_current", () => {
    resetRuntime();
    S.currentWorld.modules = { map: { enabled: true } }; // ★ 70：map 模块需开启（默认关）
    S.currentWorld.locations = LOCS;
    S.gameState.current_location = "咖啡馆";
    const state = JSON.parse(buildCompactGameState());
    assert.deepEqual(state.connections_from_current, ["集市", "码头后巷"], "输出当前地点相邻可去");
    // 不在图中的地点 → 无连接字段
    S.gameState.current_location = "未知之地";
    const state2 = JSON.parse(buildCompactGameState());
    assert.equal(state2.connections_from_current, undefined, "地点不在图中则省略");
});

test("buildCompactGameState：无 locations 时行为不变（不含该键）", () => {
    resetRuntime();
    S.currentWorld.modules = { map: { enabled: true } };
    const state = JSON.parse(buildCompactGameState());
    assert.equal(state.connections_from_current, undefined, "旧世界无图不输出连接字段");
    assert.equal(state.current_location, "咖啡馆", "原有字段照常");
});

// ===== 事件地点匹配并入 =====
test("inferTriggerFromContent：地点图名称并入地点名单", () => {
    resetRuntime();
    S.currentWorld.modules = { map: { enabled: true } }; // ★ 70：map 模块需开启
    S.currentWorld.locations = LOCS;
    S.activeLoreKB = { ip: "测试", snippets: [] };
    const cond = inferTriggerFromContent("她在码头后巷发现了线索");
    assert.equal(cond.location, "码头后巷", "地点图名称应参与事件地点匹配");
    const cond2 = inferTriggerFromContent("没有任何地点触发词");
    assert.equal(cond2, null, "无地点触发词返回 null");
});

test("inferTriggerFromContent：lore 地点条目与地点图并存不冲突", () => {
    resetRuntime();
    S.currentWorld.modules = { map: { enabled: true } }; // ★ 70：map 模块需开启
    S.currentWorld.locations = [{ id: "l1", name: "咖啡馆", connections: [] }];
    S.activeLoreKB = { ip: "测试", snippets: [{ id: "s1", category: "地点", title: "旧书店" }] };
    const cond = inferTriggerFromContent("她走进旧书店");
    assert.equal(cond.location, "旧书店", "lore 地点条目仍优先匹配");
    const cond2 = inferTriggerFromContent("咖啡馆打烊了");
    assert.equal(cond2.location, "咖啡馆", "地点图名称也能匹配");
});
