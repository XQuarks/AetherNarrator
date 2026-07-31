// ============================================================
// test/53 · NPC 私聊 / 世界日报 门禁引擎（docs/53）
// 覆盖：模块注册与默认开、flags 采集、硬预筛、规则/AI 判定、
//      场景状态哈希缓存、动态渠道校验与固化。
// AI 判定用 opts.judge 注入 mock（不触网络）；rules 模式不调 AI。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_REGISTRY, isModuleEnabled, defaultModules } from "../src/modules.js";
import { S } from "../src/store.js";
import { TOOLS } from "../src/llm.js";
import {
    evaluateGate, collectCommFlags, hardPrefilter, rulesDecision,
    PRIVATE_STAMINA_COST, DAILY_STAMINA_COST
} from "../src/comm-gate.js";
import {
    worldCapabilities, suggestChannels, validateChannel,
    resolveChannels, commitChannel, CHANNEL_KINDS
} from "../src/comm-channels.js";

// —— 测试世界：现代魔法都市（tech + magic 都允许）——
const magicWorld = {
    id: "w_magic",
    name: "现代魔法都市",
    type: "fan",
    desc: "现代都市，存在魔法与科技并存的通讯手段",
    modules: { npc_chat: { enabled: true }, world_daily: { enabled: true } },
    characters: [{ name: "赫敏", kind: "npc" }],
    contact_channels: [{ id: "owl", name: "魔法猫头鹰", kind: "magic", requires: {}, source: "player" }]
};

function freshGameState(over = {}) {
    return {
        current_location: "对角巷",
        current_date: { period: "夜晚" },
        inventory: [{ item_id: "walkie", name: "对讲机", tags: ["contact"] }],
        variables: { stamina: 80 },
        bonds: {
            赫敏: { affinity: 60, shared_contacts: ["owl"], status: "alive" }
        },
        present_npcs: ["赫敏"],
        ...over
    };
}

// 每个用例前复位全局 side-event 锁，避免跨用例污染
function resetSideLock() { S.enteringSideEvent = null; }

// ============================================================
// 1) 模块注册 & 默认开启（两层门禁第一层）
// ============================================================
test("MODULE_REGISTRY：npc_chat 与 world_daily 已注册且默认开启", () => {
    const a = MODULE_REGISTRY.find(m => m.id === "npc_chat");
    const b = MODULE_REGISTRY.find(m => m.id === "world_daily");
    assert.ok(a, "应注册 npc_chat 模块");
    assert.ok(b, "应注册 world_daily 模块");
    assert.strictEqual(a.defaultEnabled, true, "npc_chat 默认开启");
    assert.strictEqual(b.defaultEnabled, true, "world_daily 默认开启");
    assert.strictEqual(a.statusTab, "relations");
    assert.strictEqual(b.statusTab, "timeline");
});

test("defaultModules：新世界默认含 npc_chat / world_daily 且开启", () => {
    const m = defaultModules({});
    assert.strictEqual(m.npc_chat.enabled, true);
    assert.strictEqual(m.world_daily.enabled, true);
});

test("isModuleEnabled：模块关时门禁生效", () => {
    const off = { modules: { npc_chat: { enabled: false }, world_daily: { enabled: true } } };
    assert.strictEqual(isModuleEnabled(off, "npc_chat"), false);
    assert.strictEqual(isModuleEnabled(off, "world_daily"), true);
});

// ============================================================
// 2) collectCommFlags：8 类世界状态抽取
// ============================================================
test("collectCommFlags：正确抽取时间/地点/背包渠道/好感/体力/约束/锁/渠道数", () => {
    resetSideLock();
    const gs = freshGameState();
    const flags = collectCommFlags(magicWorld, gs, { npcId: "赫敏", channels: [{ id: "owl" }] });
    assert.strictEqual(flags.time_of_day, "夜晚");
    assert.strictEqual(flags.location, "对角巷");
    assert.deepStrictEqual(flags.inventory_channels, ["对讲机"]);
    assert.strictEqual(flags.affinity, 60);
    assert.strictEqual(flags.stamina, 80);
    assert.deepStrictEqual(flags.world_constraints, []);
    assert.strictEqual(flags.story_lock, false);
    assert.strictEqual(flags.channels_available, 1);
});

test("collectCommFlags：无体力系统 stamina 为 null（答 #3 的前提）", () => {
    resetSideLock();
    const gs = freshGameState({ variables: {} }); // 没有 stamina
    const flags = collectCommFlags(magicWorld, gs, { channels: [{ id: "owl" }] });
    assert.strictEqual(flags.stamina, null);
});

// ============================================================
// 3) hardPrefilter：只挡"明显不可能"
// ============================================================
test("hardPrefilter：模块关闭 → module_off", () => {
    const off = { modules: { npc_chat: { enabled: false } }, characters: [{ name: "赫敏" }] };
    const r = hardPrefilter(off, {}, { type: "npc_chat", npcId: "赫敏", _channels: [{ id: "owl" }] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.blocked, "module_off");
});

test("hardPrefilter：NPC 不存在 → npc_missing", () => {
    const r = hardPrefilter(magicWorld, {}, { type: "npc_chat", npcId: "谁", _channels: [{ id: "owl" }] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.blocked, "npc_missing");
});

test("hardPrefilter：NPC 死亡 → npc_dead", () => {
    const gs = freshGameState({ bonds: { 赫敏: { status: "dead" } } });
    const r = hardPrefilter(magicWorld, gs, { type: "npc_chat", npcId: "赫敏", _channels: [{ id: "owl" }] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.blocked, "npc_dead");
});

test("hardPrefilter：无任何渠道 → no_channel", () => {
    const r = hardPrefilter(magicWorld, {}, { type: "world_daily", _channels: [] });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.blocked, "no_channel");
});

test("hardPrefilter：剧情锁 → story_lock", () => {
    const r = hardPrefilter(magicWorld, {}, { type: "world_daily", _channels: [{ id: "raven" }], _story_lock: true });
    assert.strictEqual(r.pass, false);
    assert.strictEqual(r.blocked, "story_lock");
});

test("hardPrefilter：一切正常 → pass", () => {
    const gs = freshGameState();
    const r = hardPrefilter(magicWorld, gs, { type: "npc_chat", npcId: "赫敏", _channels: [{ id: "owl" }] });
    assert.strictEqual(r.pass, true);
});

// ============================================================
// 4) rulesDecision：确定性兜底逻辑
// ============================================================
test("rulesDecision：无渠道拒绝", () => {
    const r = rulesDecision({ affinity: 60 }, { type: "world_daily" }, []);
    assert.strictEqual(r.allowed, false);
});

test("rulesDecision：剧情锁拒绝", () => {
    const r = rulesDecision({ affinity: 60 }, { type: "world_daily", _story_lock: true }, [{ name: "信鸦" }]);
    assert.strictEqual(r.allowed, false);
});

test("rulesDecision：好感过低且无共享联系方式 → 拒绝", () => {
    const r = rulesDecision({ affinity: 5 }, { type: "npc_chat", npcId: "赫敏", _sharedContacts: [] }, [{ name: "信鸦" }]);
    assert.strictEqual(r.allowed, false);
    assert.ok(r.reason.includes("还不熟"));
});

test("rulesDecision：有共享联系方式则不受低好感限制 → 允许", () => {
    const r = rulesDecision({ affinity: 5 }, { type: "npc_chat", npcId: "赫敏", _sharedContacts: ["owl"] }, [{ name: "魔法猫头鹰" }]);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.channel, "魔法猫头鹰");
});

test("rulesDecision：正常 → 允许并返回首个渠道", () => {
    const r = rulesDecision({ affinity: 60 }, { type: "world_daily" }, [{ name: "信鸦" }, { name: "信使" }]);
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.channel, "信鸦");
});

// ============================================================
// 5) evaluateGate：编排 + rules 模式 + AI 模式 + 缓存
// ============================================================
test("evaluateGate：模块关闭直接 blocked（不进 AI/规则）", async () => {
    resetSideLock();
    const off = { id: "x", modules: { npc_chat: { enabled: false } }, characters: [{ name: "赫敏" }] };
    const r = await evaluateGate(off, freshGameState(), { type: "npc_chat", npcId: "赫敏" }, {});
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.blocked, "module_off");
});

test("evaluateGate：rules 模式走确定性判定（不调 AI）", async () => {
    resetSideLock();
    const w = { ...magicWorld, comm_gate_mode: "rules" };
    const gs = freshGameState();
    const r = await evaluateGate(w, gs, { type: "npc_chat", npcId: "赫敏" }, { npcId: "赫敏" });
    assert.strictEqual(r.allowed, true);
    assert.ok(r.channel, "应给出渠道名");
});

test("evaluateGate：AI 模式用注入 judge（mock，不触网络）", async () => {
    resetSideLock();
    const w = { ...magicWorld, comm_gate_mode: "ai" };
    let calls = 0;
    const judge = async (ctx) => { calls++; return { allowed: true, channel: ctx.channels[0].name, reason: "" }; };
    const gs = freshGameState();
    const r = await evaluateGate(w, gs, { type: "world_daily" }, { location: "对角巷" }, { judge });
    assert.strictEqual(calls, 1, "AI 模式应调用一次 judge");
    assert.strictEqual(r.allowed, true);
    assert.ok(gs.comm_cache && gs.comm_cache.result, "应写入场景哈希缓存");
});

test("evaluateGate：场景状态哈希缓存——状态未变不重判", async () => {
    resetSideLock();
    const w = { ...magicWorld, comm_gate_mode: "ai" };
    let calls = 0;
    const judge = async (ctx) => { calls++; return { allowed: calls === 1, channel: "信鸦", reason: calls === 1 ? "" : "本不应被调用" }; };
    const gs = freshGameState();
    const r1 = await evaluateGate(w, gs, { type: "world_daily" }, { location: "对角巷" }, { judge });
    const r2 = await evaluateGate(w, gs, { type: "world_daily" }, { location: "对角巷" }, { judge });
    assert.strictEqual(calls, 1, "状态未变应命中缓存，不再调用 judge");
    assert.strictEqual(r2.allowed, r1.allowed, "缓存返回应与首次一致");
});

test("evaluateGate：全局剧情锁（S.enteringSideEvent）挡获报", async () => {
    S.enteringSideEvent = { id: "side1", title: "紧要任务" };
    try {
        const w = { ...magicWorld, comm_gate_mode: "ai" };
        const r = await evaluateGate(w, freshGameState(), { type: "world_daily" }, {});
        assert.strictEqual(r.allowed, false);
        assert.strictEqual(r.blocked, "story_lock");
    } finally {
        resetSideLock();
    }
});

// ============================================================
// 6) 动态渠道系统（comm-channels）
// ============================================================
test("worldCapabilities：现代魔法世界推导 tech+magic", () => {
    const caps = worldCapabilities(magicWorld);
    assert.ok(caps.includes("tech_allowed"));
    assert.ok(caps.includes("magic_allowed"));
});

test("worldCapabilities：中世纪古风世界推导 physical", () => {
    const caps = worldCapabilities({ desc: "中世纪古风武侠世界" });
    assert.ok(caps.includes("physical_allowed"));
});

test("worldCapabilities：描述为空则三能力全开（交给 AI/场景）", () => {
    const caps = worldCapabilities({});
    assert.deepStrictEqual(caps.sort(), ["magic_allowed", "physical_allowed", "tech_allowed"]);
});

test("suggestChannels：酒馆场景额外提供酒保传话", () => {
    const ch = suggestChannels(magicWorld, { location: "猪头酒馆" });
    assert.ok(ch.some(c => c.id === "tavern_whisper"), "应含酒保传话");
});

test("validateChannel：requires.world_flags 不满足则失效", () => {
    const caps = ["magic_allowed"];
    const ch = { id: "phone", name: "手机", requires: { world_flags: ["tech_allowed"] } };
    assert.strictEqual(validateChannel(ch, caps, {}), false);
    assert.strictEqual(validateChannel(ch, ["tech_allowed", "magic_allowed"], {}), true);
});

test("validateChannel：requires.item_id 需背包持有", () => {
    const ch = { id: "walkie", name: "对讲机", requires: { item_id: "walkie" } };
    assert.strictEqual(validateChannel(ch, [], { inventory: [] }), false);
    assert.strictEqual(validateChannel(ch, [], { inventory: [{ item_id: "walkie" }] }), true);
});

test("resolveChannels：玩家自选 + 系统提供 合并去重（玩家优先）", () => {
    const w = { ...magicWorld }; // 含玩家 owl
    const ch = resolveChannels(w, freshGameState(), { location: "对角巷" });
    const ids = ch.map(c => c.id);
    assert.ok(ids.includes("owl"), "应保留玩家自选 owl");
    assert.ok(ids.includes("phone"), "应含系统 tech 渠道");
    assert.ok(ids.includes("raven"), "应含系统 physical 渠道");
    // 去重：owl 不应出现两次
    assert.strictEqual(ids.filter(i => i === "owl").length, 1);
});

test("commitChannel：固化系统渠道进玩家自选 + 背包加'contact'物品", () => {
    const w = { contact_channels: [] };
    const gs = { inventory: [] };
    const sysCh = { id: "patronus", name: "守护神传信", kind: "magic" };
    const r1 = commitChannel(w, gs, sysCh);
    assert.strictEqual(r1.added, true);
    assert.strictEqual(r1.itemAdded, true);
    assert.ok(w.contact_channels.some(c => c.id === "patronus"), "应写入 world.contact_channels");
    assert.ok(gs.inventory.some(i => i.item_id === "contact_patronus" && i.tags.includes("contact")), "背包应含 contact 标签物品");
    // 幂等：再固化一次不重复
    const r2 = commitChannel(w, gs, sysCh);
    assert.strictEqual(r2.added, false);
    assert.strictEqual(r2.itemAdded, false);
    assert.strictEqual(w.contact_channels.filter(c => c.id === "patronus").length, 1);
});

// ============================================================
// 7) AI 工具 schema 与体力常量
// ============================================================
test("TOOLS：judge_contact 与 generate_daily 已登记且字段完整", () => {
    assert.ok(TOOLS.judge_contact, "应登记 judge_contact");
    const jp = TOOLS.judge_contact.parameters.properties;
    for (const k of ["allowed", "channel", "reason"]) assert.ok(jp[k], "judge_contact 应含 " + k);
    assert.ok(TOOLS.generate_daily, "应登记 generate_daily");
    const dp = TOOLS.generate_daily.parameters.properties;
    for (const k of ["headlines", "rumor"]) assert.ok(dp[k], "generate_daily 应含 " + k);
});

test("体力常量：私聊 5 / 日报 3（仅当世界有体力系统才扣）", () => {
    assert.strictEqual(PRIVATE_STAMINA_COST, 5);
    assert.strictEqual(DAILY_STAMINA_COST, 3);
});
