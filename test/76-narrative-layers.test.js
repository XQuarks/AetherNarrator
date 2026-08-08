// ★ docs/76 Phase B：平行叙事层引擎单测
import assert from "node:assert";
import test from "node:test";
import {
    CORE_FIELDS, captureCore, applyCore, ensureNarrativeLayers,
    getActiveLayer, saveActiveLayer, switchNarrativeLayer,
    forkNarrativeLayer, injectCrossLayerInfluence, layerCount
} from "../src/narrative-layers.js";

function baseState() {
    return {
        name: "玩家", age: 16, background: "x", personality: ["谨慎"],
        attributes: { courage: "初" }, progression: { path: "未入门" },
        relationships: {}, skills: {}, skill_growth: {},
        inventory: [], completed_events: [], current_location: "A",
        story_progress: 1, current_date: { day: 1, period: "morning" },
        triggered_event_ids: { main: [] }, retrigger_state: { main: {} }, branches: {},
        goals: [], status_effects: [], tags: [], present_npcs: [], situation_tags: [],
        revealed_locations: [], is_alive: true, death_reason: null,
        unlockedEndings: [], random_event_state: { lastTitle: null, firedTitles: [] }
    };
}

test("captureCore：只捕获白名单字段（不含叙事层簿记）", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    const core = captureCore(gs);
    assert.equal(core.narrative_layers, undefined);
    assert.equal(core.active_narrative_layer, undefined);
    assert.equal(core.story_progress, 1);
    assert.ok(CORE_FIELDS.includes("story_progress"));
});

test("ensureNarrativeLayers：懒初始化主线（基准=当前状态）", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    assert.ok(gs.narrative_layers.main);
    assert.equal(gs.active_narrative_layer, "main");
    assert.equal(gs.narrative_layers.main.core.story_progress, 1);
    assert.equal(typeof gs.player_influence, "number");
});

test("ensureNarrativeLayers：已存在时不重建（仅校准 active）", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    gs.active_narrative_layer = "ghost"; // 指向不存在
    ensureNarrativeLayers(gs);
    assert.equal(gs.active_narrative_layer, "main");
    assert.equal(Object.keys(gs.narrative_layers).length, 1);
});

test("forkNarrativeLayer：派生新层并激活，父线保留", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    gs.story_progress = 5;
    const lid = forkNarrativeLayer(gs, "衍生线 1");
    assert.equal(lid, "layer_1");
    assert.equal(gs.active_narrative_layer, lid);
    assert.equal(gs.story_progress, 5); // 新层克隆自父线（当时 5）
    assert.equal(gs.narrative_layers.main.core.story_progress, 5); // 父线基准保留
    assert.equal(gs.narrative_layers[lid].derived_from, "main");
});

test("switchNarrativeLayer：切换恢复副本，进度不丢", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    gs.story_progress = 5; gs.current_location = "B";
    const lid = forkNarrativeLayer(gs, "衍生线 1");
    gs.story_progress = 9; // 在新层推进
    const ok = switchNarrativeLayer(gs, "main");
    assert.equal(ok, true);
    assert.equal(gs.story_progress, 5);       // 主线恢复到分岔前
    assert.equal(gs.current_location, "B");    // 主线 core 含分岔前现场
    // 切回新层应见 9（切走前已存盘）
    switchNarrativeLayer(gs, lid);
    assert.equal(gs.story_progress, 9);
});

test("switchNarrativeLayer：无效 id 返回 false，不改状态", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    const ok = switchNarrativeLayer(gs, "nope");
    assert.equal(ok, false);
    assert.equal(gs.active_narrative_layer, "main");
});

test("saveActiveLayer：每回合末持久化当前层进度", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    gs.story_progress = 7;
    saveActiveLayer(gs);
    assert.equal(gs.narrative_layers.main.core.story_progress, 7);
});

test("injectCrossLayerInfluence：记录分岔成因摘要", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    const lid = forkNarrativeLayer(gs, "X");
    const layer = gs.narrative_layers[lid];
    injectCrossLayerInfluence(layer, { bonds: { 小红: { delta: 10 } }, completed_events: ["e1"] });
    assert.deepEqual(layer.fork_cause.bonds, ["小红"]);
    assert.deepEqual(layer.fork_cause.completed_events, ["e1"]);
});

test("layerCount：统计层数", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    assert.equal(layerCount(gs), 1);
    forkNarrativeLayer(gs);
    assert.equal(layerCount(gs), 2);
    forkNarrativeLayer(gs);
    assert.equal(layerCount(gs), 3);
});

test("getActiveLayer：返回当前激活层", () => {
    const gs = baseState();
    ensureNarrativeLayers(gs);
    assert.equal(getActiveLayer(gs).id, "main");
    forkNarrativeLayer(gs, "X");
    assert.equal(getActiveLayer(gs).id, "layer_1");
});
