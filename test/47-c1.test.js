// ============================================================
// C1 · 模块化世界开关（Registry 模式）单元测试
// 覆盖：注册表默认、旧世界迁移、isModuleEnabled 门禁（核心恒开 / 自定义关闭）、
// buildModulePromptContext（启用指令 + 未启用约束）、renderStatusTabs 按模块显隐。
// 纯函数 + 最小 document stub，不依赖真实 API / 浏览器。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

import { S } from "../src/store.js";
import {
    MODULE_REGISTRY, defaultModules, sanitizeModules, isModuleEnabled,
    enabledModuleList, disabledModuleNames, buildModulePromptContext
} from "../src/modules.js";
import { renderStatusTabs } from "../src/render.js";

// ---- 最小 document stub（仅 renderStatusTabs 用 statusTabs）----
function installDomStub() {
    const els = {};
    global.document = {
        getElementById: (id) => {
            if (!els[id]) els[id] = { innerHTML: "" };
            return els[id];
        }
    };
    return els;
}

function resetState() {
    S.currentWorld = null;
    S.gameState = null;
    S.currentStatusTab = "profile";
}

function baseWorld(overModules) {
    const w = { id: "w_c1", name: "C1 样例世界", desc: "用于 C1 单测", type: "original", schema: {} };
    w.modules = defaultModules();
    if (overModules) {
        for (const [k, v] of Object.entries(overModules)) w.modules[k] = { enabled: v };
    }
    return w;
}

// ---------- 注册表默认 ----------
test("MODULE_REGISTRY 含 12 个模块且含核心三件套", () => {
    assert.strictEqual(MODULE_REGISTRY.length, 12);
    const ids = MODULE_REGISTRY.map(m => m.id);
    for (const must of ["lore", "characters", "memory", "time", "skills", "inventory", "goals",
        "variables", "affinity", "quest", "map", "schedule"]) {
        assert.ok(ids.includes(must), `缺少模块 ${must}`);
    }
});

test("defaultModules：核心恒开；time/inventory/goals 默认开；variables/affinity/skills/quest/map/schedule 默认关", () => {
    const d = defaultModules();
    assert.strictEqual(d.lore.enabled, true);
    assert.strictEqual(d.time.enabled, true);
    assert.strictEqual(d.skills.enabled, false);
    assert.strictEqual(d.inventory.enabled, true);
    assert.strictEqual(d.goals.enabled, true);
    assert.strictEqual(d.variables.enabled, false);
    assert.strictEqual(d.affinity.enabled, false);
    assert.strictEqual(d.quest.enabled, false);
    assert.strictEqual(d.map.enabled, false);
    assert.strictEqual(d.schedule.enabled, false);
});

// ---------- 旧世界迁移 ----------
test("sanitizeModules：旧世界（无 modules）补全全部默认模块", () => {
    const w = { id: "old", name: "老世界", schema: {} };
    const out = sanitizeModules(w);
    assert.strictEqual(Object.keys(out).length, 12);
    assert.strictEqual(out.time.enabled, true);
    assert.strictEqual(out.variables.enabled, false);
    assert.strictEqual(w.modules, out, "应写回 world.modules");
});

test("sanitizeModules：保留创作者已设置的开关", () => {
    const w = { id: "w", name: "w", modules: { variables: { enabled: true }, affinity: { enabled: true } } };
    sanitizeModules(w);
    assert.strictEqual(w.modules.variables.enabled, true);
    assert.strictEqual(w.modules.affinity.enabled, true);
    assert.strictEqual(w.modules.time.enabled, true); // 未设置 → 默认
});

// ---------- 门禁 ----------
test("isModuleEnabled：核心模块即使 world.modules 设为 false 仍恒开", () => {
    const w = baseWorld({ lore: false, characters: false, memory: false });
    assert.strictEqual(isModuleEnabled(w, "lore"), true);
    assert.strictEqual(isModuleEnabled(w, "characters"), true);
    assert.strictEqual(isModuleEnabled(w, "memory"), true);
});

test("isModuleEnabled：非核心模块尊重 world.modules 设置", () => {
    const wOn = baseWorld({ variables: true });
    assert.strictEqual(isModuleEnabled(wOn, "variables"), true);
    const wOff = baseWorld({ variables: false });
    assert.strictEqual(isModuleEnabled(wOff, "variables"), false);
});

test("isModuleEnabled：world 为 null / 无 modules 时回退默认", () => {
    assert.strictEqual(isModuleEnabled(null, "time"), true);   // 默认开
    assert.strictEqual(isModuleEnabled(null, "variables"), false); // 默认关
    const w = { id: "x", name: "x" }; // 无 modules 字段
    assert.strictEqual(isModuleEnabled(w, "time"), true);
    assert.strictEqual(isModuleEnabled(w, "variables"), false);
});

// ---------- 提示词上下文 ----------
test("buildModulePromptContext：默认世界列出启用系统并约束未启用系统（含任务/地图/日程占位）", () => {
    const w = baseWorld();
    const ctx = buildModulePromptContext(w);
    assert.ok(ctx.includes("已启用的系统"), "应列出启用系统");
    assert.ok(ctx.includes("时间系统"), "默认启用应包含时间系统");
    assert.ok(ctx.includes("未启用"), "应列出未启用约束");
    assert.ok(ctx.includes("任务系统"), "默认关的占位模块应出现在未启用约束中");
    assert.ok(ctx.includes("地图系统"), "默认关的占位模块应出现在未启用约束中");
});

test("buildModulePromptContext：关闭时间系统后约束段包含「时间系统」", () => {
    const w = baseWorld({ time: false });
    const ctx = buildModulePromptContext(w);
    assert.ok(ctx.includes("时间系统"), "关闭的系统应出现在未启用约束中");
    assert.ok(!ctx.includes("【时间系统】"), "关闭后不应再注入启用指令");
});

test("buildModulePromptContext：启用 variables 注入「玩家变量」指令", () => {
    const w = baseWorld({ variables: true });
    const ctx = buildModulePromptContext(w);
    assert.ok(ctx.includes("【玩家变量】"), "应注入启用指令");
});

// ---------- 状态 Tab 显隐 ----------
function captureTabs(world, gameState) {
    resetState();
    S.currentWorld = world;
    S.gameState = gameState || { relationships: {}, bonds: {}, inventory: [], variables: {} };
    const els = installDomStub();
    renderStatusTabs();
    const html = els.statusTabs.innerHTML;
    const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]);
    return keys;
}

test("renderStatusTabs：默认世界显示 时间线/物品/目标/记忆 页签（skills 默认关不出现）", () => {
    const w = baseWorld();
    const keys = captureTabs(w);
    assert.ok(keys.includes("timeline"), "time 默认开 → 时间线页签应出现");
    assert.ok(!keys.includes("skills"), "skills 默认关 → 技能页签不应出现");
    assert.ok(keys.includes("items"), "inventory 默认开 → 物品页签应出现");
    assert.ok(keys.includes("goals"), "goals 默认开 → 目标页签应出现");
    assert.ok(keys.includes("memory"), "memory 核心 → 记忆页签应出现");
});

test("renderStatusTabs：关闭 time 模块后 时间线 页签消失", () => {
    const w = baseWorld({ time: false });
    const keys = captureTabs(w);
    assert.ok(!keys.includes("timeline"), "time 关闭 → 时间线页签应消失");
    assert.ok(keys.includes("memory"), "核心 memory 页签仍应在");
});

test("renderStatusTabs：未启用 variables 且世界无变量定义 → 变量页签不出现", () => {
    const w = baseWorld({ variables: false });
    w.schema = {}; // 无变量定义
    const keys = captureTabs(w);
    assert.ok(!keys.includes("variables"), "variables 关闭且无定义 → 页签不应出现");
});

test("renderStatusTabs：affinity 关闭但世界已有文字关系层 → 关系页签仍保留（兼容老档）", () => {
    const w = baseWorld({ affinity: false });
    const keys = captureTabs(w, { relationships: { "王二": "旧识" }, bonds: {}, inventory: [], variables: {} });
    assert.ok(keys.includes("relations"), "已有文字关系层时应保留关系页签");
});

test("renderStatusTabs：affinity 关闭且无文字关系层 → 关系页签消失", () => {
    const w = baseWorld({ affinity: false });
    const keys = captureTabs(w, { relationships: {}, bonds: {}, inventory: [], variables: {} });
    assert.ok(!keys.includes("relations"), "affinity 关闭且无情关系层时应消失");
});
