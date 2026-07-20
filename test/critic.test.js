// Phase 3 · Critic 审稿人 + NER 增强 单元测试
// 说明：critic 的 LLM 调用依赖浏览器 fetch + API Key，无法在 node 单测里烧；
// 这里覆盖 Phase 3 真正新增的纯逻辑：① relations 三元组合并（NER 增强）
// ② 「矛盾设定 → 修订 diff → 修正」机制（critic 编排调用的核心纯函数）。
import test from "node:test";
import assert from "node:assert/strict";
import { mergeLoreSnippets } from "../src/utils.js";
import { parseLoreRevisionResponse, buildLoreRevisionDiff, applyLoreRevisionDiff } from "../src/lore-revision.js";

test("mergeLoreSnippets 保留并合并 relations 三元组（NER 增强）", () => {
    const a = [{ id: "m1", category: "人物", title: "林家", content: "林家", relations: [{ from: "林家", relation: "敌对", to: "王家" }] }];
    const b = [{
        id: "x", category: "人物", title: "林家", content: "林家（续）",
        relations: [{ from: "林家", relation: "盟友", to: "陈家" }, { from: "林家", relation: "敌对", to: "王家" }]
    }];
    const out = mergeLoreSnippets(a, b);
    assert.equal(out.length, 1, "同名条目应合并为 1 条");
    const rels = out[0].relations;
    assert.ok(rels.some(r => r.to === "陈家" && r.relation === "盟友"), "应保留盟友陈家");
    assert.equal(rels.filter(r => r.to === "王家").length, 1, "敌对王家出现两次应去重为 1 条");
});

test("mergeLoreSnippets 旧 snippet 无 relations 时不报错", () => {
    const a = [{ id: "m1", category: "人物", title: "张三", content: "张三活着。" }];
    const b = [{ id: "m2", category: "人物", title: "李四", content: "李四。", relations: [{ from: "李四", relation: "师徒", to: "王五" }] }];
    const out = mergeLoreSnippets(a, b);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0].relations, []);
    assert.equal(out[1].relations[0].to, "王五");
});

test("Critic 机制：矛盾设定被识别为 update 并修正", () => {
    const kb = {
        snippets: [
            { id: "m1", category: "人物", title: "张三", content: "张三还活着。", activation_keys: ["张三"] },
            { id: "m2", category: "人物", title: "李四", content: "李四已死。", activation_keys: ["李四"] }
        ]
    };
    // 模拟 Critic LLM 返回：m1 与某设定矛盾（张三其实已死），应作为 update 修正 m1
    const proposed = [
        { id: "m1", category: "人物", title: "张三", content: "张三已死（修订）。", activation_keys: ["张三"] },
        { id: "m2", category: "人物", title: "李四", content: "李四已死。", activation_keys: ["李四"] }
    ];
    const diff = buildLoreRevisionDiff(kb.snippets, proposed);
    assert.equal(diff.updates.length, 1, "应只有 m1 被修订");
    assert.equal(diff.updates[0].id, "m1");
    const applied = applyLoreRevisionDiff(kb.snippets, diff);
    const zhang = applied.find(s => s.id === "m1");
    assert.match(zhang.content, /已死/);
});

test("Critic 机制：干净知识库不产生 diff（审稿会报无矛盾）", () => {
    const kb = { snippets: [{ id: "m1", category: "人物", title: "张三", content: "张三活着。", activation_keys: ["张三"] }] };
    const proposed = [{ id: "m1", category: "人物", title: "张三", content: "张三活着。", activation_keys: ["张三"] }];
    const diff = buildLoreRevisionDiff(kb.snippets, proposed);
    assert.equal(diff.updates.length + diff.additions.length, 0);
});

test("Critic 机制：违反世界硬规则的建议作为 update 提出", () => {
    // world.rules 中一条「禁词：核弹」硬规则；知识库某条含该词，Critic 应建议修订去掉
    const kb = { snippets: [{ id: "m1", category: "物品", title: "神秘装置", content: "这是一种核弹。", activation_keys: ["神秘装置"] }] };
    const proposed = [{ id: "m1", category: "物品", title: "神秘装置", content: "这是一种被封存的禁忌造物。", activation_keys: ["神秘装置"] }];
    const diff = buildLoreRevisionDiff(kb.snippets, proposed);
    assert.equal(diff.updates.length, 1);
    const applied = applyLoreRevisionDiff(kb.snippets, diff);
    assert.ok(!/核弹/.test(applied.find(s => s.id === "m1").content));
});

test("parseLoreRevisionResponse 拒绝缺 snippets 的响应", () => {
    assert.throws(() => parseLoreRevisionResponse("{ \"foo\": 1 }"));
});
