// docs/61：创建向导「模块门禁 + 关联校验 + 群像剧好感度门禁」回归测试
// 覆盖：
//  1) computeWizardValidation：error（好感度但模块未开 / 群像剧设主角卡 / 群像剧好感度 / 填了容器但模块未开）
//     warning（角色名重复） / info（solo 无主角卡）三级分类，及 enableModule 附注
//  2) shapeWizardContainers：opts.modules 门禁过滤（模块未开 → 容器数据不产出）；opts.pov=ensemble → 角色卡剥离好感字段
//  3) 向后兼容：不传 opts 时行为与 docs/60 一致（全开）
//  4) getWizardContainers / validateWizardContainers：轻量 DOM 桩下安全不抛错
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeWizardContainers, computeWizardValidation, getWizardContainers, validateWizardContainers } from "../src/wizard-containers.js";
import { applyWizardContainers } from "../src/game.js";

// 轻量 DOM 桩（game.js 导入链可能触达 document）
globalThis.document = {
    getElementById: () => ({ checked: true, value: "" }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ dataset: {}, addEventListener: () => {} }),
    dispatchEvent: () => {}
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

// ---------- 1) computeWizardValidation ----------
test("computeWizardValidation：填了好感度但羁绊模块未开 → error(enableModule=affinity)", () => {
    const v = computeWizardValidation({
        buffers: { characters: [{ role: "npc", name: "甲", affinity: 60, rel_tags: ["朋友"] }] },
        modules: { affinity: false },
        pov: "solo"
    });
    assert.ok(v.errors.some(e => e.level === "error" && e.enableModule === "affinity"), "应给出可定位到 affinity 模块的错误");
    assert.ok(!v.errors.some(e => e.enableModule === "affinity" && !e.msg.includes("羁绊好感度")), "错误信息应点名羁绊好感度模块");
});

test("computeWizardValidation：群像剧设主角卡 → error；群像剧填好感 → error", () => {
    const v = computeWizardValidation({
        buffers: { characters: [{ role: "protagonist", name: "主角" }, { role: "npc", name: "乙", affinity: 40, rel_tags: [] }] },
        modules: { affinity: true },
        pov: "ensemble"
    });
    assert.ok(v.errors.some(e => e.msg.includes("群像剧") && e.msg.includes("主角")), "应拦截群像剧的主角卡");
    assert.ok(v.errors.some(e => e.msg.includes("群像剧") && e.msg.includes("好感")), "应拦截群像剧的好感度");
});

test("computeWizardValidation：填了容器但对应模块未开 → error，且给出 enableModule", () => {
    const v = computeWizardValidation({
        buffers: { skills: [{ name: "御剑", desc: "x" }], variables: [{ id: "san", name: "理智" }] },
        modules: { skills: false, variables: false },
        pov: "solo"
    });
    assert.ok(v.errors.some(e => e.enableModule === "skills"), "技能模块未开应报 error");
    assert.ok(v.errors.some(e => e.enableModule === "variables"), "变量模块未开应报 error");
});

test("computeWizardValidation：角色名重复 → warning（不拦截）", () => {
    const v = computeWizardValidation({
        buffers: { characters: [{ role: "npc", name: "张三", identity: "a" }, { role: "npc", name: "张三", identity: "b" }] },
        modules: null,
        pov: "solo"
    });
    assert.equal(v.errors.length, 0);
    assert.ok(v.warnings.some(w => w.msg.includes("重复")), "重复角色名应为 warning");
});

test("computeWizardValidation：solo 无主角卡 → info（不拦截）", () => {
    const v = computeWizardValidation({ buffers: { characters: [{ role: "npc", name: "甲" }] }, modules: null, pov: "solo" });
    assert.equal(v.errors.length, 0);
    assert.ok(v.infos.some(i => i.msg.includes("自动设计主角")), "应提示 AI 会自动设计主角");
});

test("computeWizardValidation：完全合法 → 无 error/warning", () => {
    const v = computeWizardValidation({
        buffers: {
            characters: [{ role: "protagonist", name: "", identity: "主角" }, { role: "npc", name: "甲", affinity: 30, rel_tags: [] }],
            skills: [{ name: "御剑", desc: "x" }]
        },
        modules: { affinity: true, skills: true },
        pov: "solo"
    });
    assert.equal(v.errors.length, 0, "合法配置不应有 error：" + JSON.stringify(v.errors));
});

// ---------- 2) shapeWizardContainers 门禁 + 群像剧 ----------
test("shapeWizardContainers：opts.modules 门禁 —— 模块未开则容器数据不产出、不锁定、不强开", () => {
    const r = shapeWizardContainers(SAMPLE_BUFFERS, { modules: { skills: false, variables: false } });
    assert.deepEqual(r.data.skills, {}, "skills 模块未开 → 技能数据不产出");
    assert.equal(r.data.variable_schema.length, 0, "variables 模块未开 → 变量数据不产出");
    assert.ok(!r.locked.has("skills"), "skills 不应被锁定");
    assert.ok(!r.enableModules.includes("skills"), "skills 不应被强制开启");
    // 未受影响的容器照常
    assert.equal(r.data.inventory[0].item_id, "key");
    assert.equal(r.data.characters.length, 1);
});

test("shapeWizardContainers：opts.pov=ensemble → 角色卡剥离 relationship/affinity/rel_tags", () => {
    const r = shapeWizardContainers({
        characters: [{ role: "npc", name: "甲", relationship: "同窗", affinity: 40, rel_tags: ["友"], notes: "x" }],
        variables: [], inventory: [], skills: [], goals: [], sideEvents: []
    }, { pov: "ensemble" });
    assert.equal(r.data.characters.length, 1);
    assert.equal(r.data.characters[0].affinity, undefined, "群像剧应剥离 affinity");
    assert.equal(r.data.characters[0].rel_tags, undefined, "群像剧应剥离 rel_tags");
    assert.equal(r.data.characters[0].relationship, undefined, "群像剧应剥离 relationship");
    assert.equal(r.data.characters[0].notes, "x", "备注应保留（角色间关系改从此填）");
    assert.ok(!r.enableModules.includes("affinity"), "群像剧不应强开羁绊模块");
});

test("shapeWizardContainers：向后兼容 —— 不传 opts 与 docs/60 行为一致", () => {
    const r = shapeWizardContainers(SAMPLE_BUFFERS);
    assert.deepEqual(Array.from(r.locked).sort(), ["characters", "goals", "inventory", "sideEvents", "skills", "variables"].sort());
    assert.ok(r.enableModules.includes("variables"));
    assert.ok(r.enableModules.includes("skills"));
    assert.ok(r.enableModules.includes("events"));
});

// ---------- 3) 端到端：门禁数据不落库 ----------
test("applyWizardContainers：模块未开 → 玩家该容器内容不覆盖 AI（模块=总闸）", () => {
    const world = {
        characters: [],
        initial_state: { skills: { oldAI: "旧技能" }, inventory: [], goals: [] },
        modules: {}
    };
    const wc = shapeWizardContainers(SAMPLE_BUFFERS, { modules: { skills: false } });
    applyWizardContainers(world, wc);
    assert.deepEqual(world.initial_state.skills, { oldAI: "旧技能" }, "skills 模块未开 → 玩家技能不写入，保留 AI 生成");
    assert.ok(!world.modules.skills || !world.modules.skills.enabled, "skills 模块不应被强开");
});

// ---------- 4) DOM 包装函数在轻量桩下安全 ----------
test("getWizardContainers / validateWizardContainers：轻量 DOM 桩下不抛错、无内容为空", () => {
    const r = getWizardContainers();
    assert.ok(r.locked instanceof Set);
    assert.equal(r.locked.size, 0, "无输入时应无锁定容器");
    const v = validateWizardContainers();
    assert.ok(Array.isArray(v.errors) && Array.isArray(v.warnings) && Array.isArray(v.infos), "校验应返回三分类数组");
});
