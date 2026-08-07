// ★ 70 · map / schedule 模块开关接入（docs/68 地点连接图、docs/69 章节回溯的创作侧开关）
// 覆盖：注册表非占位 / 默认关闭与开启 / sanitize 旧世界补默认 / buildCompactGameState 按开关注入
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
const { MODULE_REGISTRY, getModuleById, isModuleEnabled, sanitizeModules, defaultModules } = await import("../src/modules.js");
const { buildCompactGameState } = await import("../src/prompt.js");

function resetRuntime() {
    storage.clear();
    S.currentWorld = { id: "w1", name: "测试世界", locations: [{ id: "cafe", name: "咖啡馆", connections: ["集市"] }] };
    S.activeBehaviorRecords = [];
    S.gameState = { story_progress: 1, current_date: { day: 1, period: "morning" }, current_location: "咖啡馆" };
    S.chatHistory = [];
    S.chatSummary = [];
}

const LOCS = [{ id: "cafe", name: "咖啡馆", summary: "老式咖啡馆", connections: ["集市"], hidden: false }];

test("注册表：map / schedule 已激活（非占位），默认关闭", () => {
    const map = getModuleById("map");
    const schedule = getModuleById("schedule");
    assert.ok(map, "map 模块应在注册表");
    assert.ok(schedule, "schedule 模块应在注册表");
    assert.ok(!(map.desc || "").includes("未实现"), "map 不再是占位");
    assert.ok(!(schedule.desc || "").includes("未实现"), "schedule 不再是占位");
    assert.equal(map.defaultEnabled, false, "map 默认关");
    assert.equal(schedule.defaultEnabled, false, "schedule 默认关");
    assert.ok(getModuleById("quest").desc.includes("未实现"), "quest 仍为占位");
});

test("isModuleEnabled：缺省走默认（关）；显式开启后开", () => {
    resetRuntime();
    assert.equal(isModuleEnabled(S.currentWorld, "map"), false, "旧世界缺省 map 默认关");
    assert.equal(isModuleEnabled(S.currentWorld, "schedule"), false, "旧世界缺省 schedule 默认关");
    S.currentWorld.modules = { map: { enabled: true } };
    assert.equal(isModuleEnabled(S.currentWorld, "map"), true, "显式开启后开");
    assert.equal(isModuleEnabled(S.currentWorld, "schedule"), false, "schedule 仍未开");
});

test("sanitizeModules：旧世界补默认（map/schedule 关），读档不破坏其他开关", () => {
    resetRuntime();
    S.currentWorld.modules = { events: { enabled: true } };
    const out = sanitizeModules(S.currentWorld);
    assert.equal(out.map.enabled, false, "旧世界 map 补默认关");
    assert.equal(out.schedule.enabled, false, "旧世界 schedule 补默认关");
    assert.equal(out.events.enabled, true, "已有开关保留");
    assert.equal(out.lore.enabled, true, "核心模块默认开");
});

test("buildCompactGameState：map 关闭时不输出 connections_from_current", () => {
    resetRuntime();
    const state = JSON.parse(buildCompactGameState());
    assert.equal(state.connections_from_current, undefined, "map 关闭时无空间提示");
    assert.equal(state.current_location, "咖啡馆", "原有字段照常");
});

test("buildCompactGameState：map 开启且有 locations 图时输出相邻连接", () => {
    resetRuntime();
    S.currentWorld.modules = { map: { enabled: true } };
    S.currentWorld.locations = LOCS;
    const state = JSON.parse(buildCompactGameState());
    assert.deepEqual(state.connections_from_current, ["集市"], "map 开启时输出相邻连接");
});

test("defaultModules：新世界默认对象含 map/schedule 且为关", () => {
    const dm = defaultModules({ id: "w2" });
    assert.equal(dm.map.enabled, false);
    assert.equal(dm.schedule.enabled, false);
    assert.equal(dm.lore.enabled, true);
});

test("模块开关与回溯数据解耦：schedule 关闭不删已有日志（运行时判断在 game.js，此处验证注册表语义）", () => {
    // schedule 仅控制"是否记录/是否显示入口"；已有日志数据不受开关影响（重开即可回溯）。
    // 此处只验证注册表语义稳定，日志读写已在 test/69 覆盖。
    const schedule = getModuleById("schedule");
    assert.equal(schedule.defaultEnabled, false);
    assert.ok(MODULE_REGISTRY.includes(schedule));
});
