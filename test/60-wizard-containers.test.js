// docs/60：创建向导「叙事结构化容器」前置平台 —— 核心逻辑回归测试
// 覆盖：
//  1) parseCharacters：修复 B4 —— 解析 affinity（夹取 -100~100）/ rel_tags（数组）
//  2) shapeWizardContainers：收集整形（skills→对象映射、goals→goal_id、locked/enableModules）
//  3) mergeGenerated：generate（AI 为主保留未匹配）/ complete（玩家为主补空白）
//  4) applyWizardContainers：玩家预设=权威（覆盖 AI），未配保留 AI，模块门禁联动，预置支线落库
//  5) buildContainerConstraintPrompt：把玩家预设摘要成 AI 约束
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCharacters } from "../src/llm.js";
import { shapeWizardContainers, mergeGenerated, getWizardContainers } from "../src/wizard-containers.js";
import { applyWizardContainers, buildContainerConstraintPrompt } from "../src/game.js";

// 轻量 DOM 桩（game.js 导入链可能触达 document）
globalThis.document = {
    getElementById: () => ({ checked: true, value: "" }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};

const SAMPLE_BUFFERS = {
    characters: [
        { role: "npc", name: "张三", identity: "学生", affinity: 0, rel_tags: [] },
        { role: "npc", name: "", identity: "" } // 空项应被过滤
    ],
    variables: [{ id: "san", name: "理智", type: "number", default: 50 }],
    inventory: [{ item_id: "key", name: "钥匙", count: 1, category: "其他", is_key: true, tags: [] }],
    skills: [{ name: "御剑", desc: "飞行剑术" }],
    goals: [{ name: "找到家", type: "主线", deadline: "" }],
    sideEvents: [{ title: "酒馆密谈", desc: "x", cost_stamina: 20, cost_time: "", tag: "" }]
};

test("parseCharacters：修复 B4 —— 解析初始好感度(夹取)与关系标签(数组)", () => {
    const text = JSON.stringify([
        { name: "甲", role: "npc", affinity: 50, rel_tags: ["朋友", "同窗"] },
        { name: "乙", role: "npc", affinity: 200, rel_tags: "敌,友" },
        { name: "丙", role: "npc", affinity: "不是数字", rel_tags: [] }
    ]);
    const out = parseCharacters(text);
    assert.equal(out.length, 3);
    assert.equal(out[0].affinity, 50);
    assert.deepEqual(out[0].rel_tags, ["朋友", "同窗"]);
    assert.equal(out[1].affinity, 100, "好感应夹取到 100");
    assert.deepEqual(out[1].rel_tags, ["敌", "友"], "字符串关系标签应 split 成数组");
    assert.equal(out[2].affinity, 0, "非法好感回落到 0");
});

test("shapeWizardContainers：过滤空项 + skills 转对象映射 + goals 生成 goal_id", () => {
    const r = shapeWizardContainers(SAMPLE_BUFFERS);
    assert.equal(r.data.characters.length, 1, "空角色卡应被过滤");
    assert.equal(r.data.characters[0].name, "张三");
    assert.deepEqual(r.data.skills, { "御剑": "飞行剑术" }, "技能应为对象映射");
    assert.equal(r.data.goals[0].goal_id, "g_找到家");
    assert.equal(r.data.goals[0].status, "active");
    assert.equal(r.data.inventory[0].item_id, "key");
});

test("shapeWizardContainers：locked 与 enableModules 门禁联动", () => {
    const r = shapeWizardContainers(SAMPLE_BUFFERS);
    assert.deepEqual(
        Array.from(r.locked).sort(),
        ["characters", "goals", "inventory", "sideEvents", "skills", "variables"].sort()
    );
    // characters/ inventory/ goals 为核心或默认开启 → 不强制；variables/skills/sideEvents 触发对应模块
    assert.ok(r.enableModules.includes("variables"));
    assert.ok(r.enableModules.includes("skills"));
    assert.ok(r.enableModules.includes("events"));
    assert.ok(!r.enableModules.includes("affinity"), "好感为 0 且无限签时不强制开羁绊");
});

test("shapeWizardContainers：角色填好感/关系标签 → 自动开羁绊模块", () => {
    const r = shapeWizardContainers({
        characters: [{ name: "甲", role: "npc", affinity: 80, rel_tags: [] }],
        variables: [], inventory: [], skills: [], goals: [], sideEvents: []
    });
    assert.ok(r.enableModules.includes("affinity"), "初始好感≠0 应开羁绊模块");
});

test("mergeGenerated(generate)：AI 为主，仅保留玩家未匹配的条目", () => {
    const cfg = { matchKey: "name" };
    const existing = [{ name: "张三", identity: "学生", affinity: 0 }];
    const generated = [
        { name: "张三", identity: "", motivation: "想回家" },
        { name: "李四", identity: "老师" }
    ];
    const r = mergeGenerated(cfg, existing, generated, "generate");
    assert.equal(r.length, 2);
    const names = r.map(x => x.name).sort();
    assert.deepEqual(names, ["张三", "李四"]);
    assert.equal(r.find(x => x.name === "张三").identity, "", "generate 模式以 AI 的 张三 为准");
});

test("mergeGenerated(complete)：玩家为主，只补空白字段", () => {
    const cfg = { matchKey: "name" };
    const existing = [{ name: "张三", identity: "学生", affinity: 0 }];
    const generated = [
        { name: "张三", identity: "", motivation: "想回家" },
        { name: "李四", identity: "老师" }
    ];
    const r = mergeGenerated(cfg, existing, generated, "complete");
    const z = r.find(x => x.name === "张三");
    assert.equal(z.identity, "学生", "complete 模式应保留玩家已填的 identity");
    assert.equal(z.motivation, "想回家", "complete 模式应补上 AI 提供的空白字段");
    assert.ok(r.find(x => x.name === "李四"), "AI 独有的新条目应追加");
});

test("applyWizardContainers：玩家预设=权威，覆盖 AI 生成；未配保留 AI；模块门禁联动", () => {
    const world = {
        characters: [],
        variable_schema: [],
        initial_state: {
            skills: { oldAI: "旧技能" },
            inventory: [{ item_id: "ai", name: "AI物品" }],
            goals: [{ goal_id: "g_ai", name: "AI目标" }]
        },
        modules: {}
    };
    const wc = shapeWizardContainers(SAMPLE_BUFFERS);
    applyWizardContainers(world, wc);

    assert.equal(world.characters.length, 1, "角色卡应被玩家预设覆盖");
    assert.equal(world.variable_schema[0].id, "san");
    assert.deepEqual(world.initial_state.skills, { "御剑": "飞行剑术" }, "技能映射应以玩家预设覆盖 AI");
    assert.equal(world.initial_state.inventory[0].item_id, "key", "背包应以玩家预设覆盖 AI");
    assert.equal(world.initial_state.goals[0].goal_id, "g_找到家");
    assert.deepEqual(world.initial_state.preset_side_events, SAMPLE_BUFFERS.sideEvents, "预置支线应落库");
    assert.equal(world.modules.variables.enabled, true);
    assert.equal(world.modules.skills.enabled, true);
    assert.equal(world.modules.events.enabled, true);
});

test("applyWizardContainers：未配容器不应破坏 AI 既有 initial_state", () => {
    const world = {
        initial_state: { skills: { aiOnly: "x" }, inventory: [{ item_id: "ai", name: "AI物" }] },
        modules: {}
    };
    // 玩家只填了变量，未填技能/背包 → 技能/背包应保留 AI 的
    const wc = shapeWizardContainers({
        characters: [], variables: [{ id: "hp", name: "血量", type: "number", default: 100 }],
        inventory: [], skills: [], goals: [], sideEvents: []
    });
    applyWizardContainers(world, wc);
    assert.deepEqual(world.initial_state.skills, { aiOnly: "x" }, "未配技能应保留 AI 生成");
    assert.equal(world.initial_state.inventory[0].item_id, "ai", "未配背包应保留 AI 生成");
    assert.equal(world.modules.variables.enabled, true, "填了变量应开 variables 模块");
});

test("buildContainerConstraintPrompt：把玩家预设摘要成 AI 约束；无预设返回空串", () => {
    const filled = shapeWizardContainers(SAMPLE_BUFFERS);
    const s = buildContainerConstraintPrompt(filled);
    assert.ok(s.includes("【玩家预设角色】"), "应含角色约束");
    assert.ok(s.includes("【玩家预设变量】"), "应含变量约束");
    assert.ok(s.includes("【玩家预设目标】"), "应含目标约束");
    assert.ok(s.includes("不要改写玩家已填内容"), "应提示 AI 勿改写");

    const empty = shapeWizardContainers({ characters: [], variables: [], inventory: [], skills: [], goals: [], sideEvents: [] });
    assert.equal(buildContainerConstraintPrompt(empty), "", "无预设应返回空串");
});

test("getWizardContainers：无 DOM 输入时返回空 locked（不抛错）", () => {
    // 在轻量桩下无真实输入，应安全返回空集合
    const r = getWizardContainers();
    assert.ok(r.locked instanceof Set);
    assert.equal(r.locked.size, 0, "无输入时应无锁定容器");
    assert.deepEqual(r.data.skills, {});
});
