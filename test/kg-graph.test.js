// Phase 4 · 知识图谱模型 buildGraphModel 单元测试
// 覆盖：关系边解析（匹配片段→连片段 / 不匹配→建实体节点且合并）、
// 链接边与关系边区分、实体节点不计入片段数、关系取色稳定、自环跳过。
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraphModel, expandRelationNeighbors, REL_COLORS, KG_REL_PALETTE, LORE_CATEGORY_COLORS } from "../src/kg-graph.js";

const SNIPPETS = [
    {
        id: "a", title: "哈利", category: "人物",
        links: [{ target: "b", relation: "related" }, { target: "zzz", relation: "related" }], // zzz 不存在，应被丢弃
        relations: [
            { from: "哈利", relation: "敌对", to: "伏地魔" },
            { from: "哈利", relation: "校友", to: "赫敏" }
        ]
    },
    {
        id: "b", title: "霍格沃茨", category: "地点",
        links: [],
        relations: [{ from: "霍格沃茨", relation: "位于", to: "英国" }]
    },
    {
        id: "c", title: "英国", category: "地点",
        links: [], relations: []
    }
];

test("model 节点：片段 + 未收录实体（伏地魔/赫敏）自动建节点且合并", () => {
    const m = buildGraphModel(SNIPPETS);
    const snippets = m.nodes.filter(n => n.kind === "snippet");
    const entities = m.nodes.filter(n => n.kind === "entity");
    assert.equal(snippets.length, 3, "片段节点应为 3");
    assert.equal(entities.length, 2, "实体节点应为 2（伏地魔、赫敏）");
    assert.equal(m.entityCount, 2, "entityCount 应为 2");
    const vold = m.nodes.find(n => n.id === "entity:伏地魔");
    assert.ok(vold, "应存在 entity:伏地魔 节点");
    assert.equal(vold.category, "实体");
    assert.equal(vold.color, LORE_CATEGORY_COLORS["实体"], "实体节点应取实体配色");
});

test("关系边解析：匹配片段连片段 id，不匹配连 entity: 节点", () => {
    const m = buildGraphModel(SNIPPETS);
    const rel = m.relEdges;
    assert.equal(rel.length, 3, "关系边应为 3（哈利-伏地魔、哈利-赫敏、霍格沃茨-英国）");
    const harryVold = rel.find(e => e.target === "entity:伏地魔");
    assert.ok(harryVold, "哈利→伏地魔 应连到 entity 节点");
    assert.equal(harryVold.source, "a", "起点应为哈利片段 id");
    assert.equal(harryVold.relation, "敌对");
    const hogwUK = rel.find(e => e.source === "b" && e.target === "c");
    assert.ok(hogwUK, "霍格沃茨→英国 两端都应解析为片段 id");
    assert.equal(hogwUK.relation, "位于");
});

test("链接边与关系边区分，且不存在的 link.target 被丢弃", () => {
    const m = buildGraphModel(SNIPPETS);
    assert.equal(m.linkEdges.length, 1, "链接边只有 哈利→霍格沃茨（zzz 不存在被丢弃）");
    assert.equal(m.linkEdges[0].kind, "link");
    assert.equal(m.linkEdges[0].source, "a");
    assert.equal(m.linkEdges[0].target, "b");
    assert.ok(m.relEdges.every(e => e.kind === "relation"), "关系边 kind 应为 relation");
});

test("关系取色稳定（同输入两次结果一致）", () => {
    const m1 = buildGraphModel(SNIPPETS);
    const m2 = buildGraphModel(SNIPPETS);
    assert.deepEqual(m1.relationColorMap, m2.relationColorMap, "两次取色映射应一致");
    assert.equal(Object.keys(m1.relationColorMap).length, 3, "distinct 关系应为 3");
    for (const col of Object.values(m1.relationColorMap)) {
        assert.ok(KG_REL_PALETTE.includes(col), "关系色应来自 KG_REL_PALETTE");
    }
});

test("自环关系被跳过（from 与 to 同指一个片段）", () => {
    const snips = [
        { id: "x", title: "张三", category: "人物",
          relations: [{ from: "张三", relation: "认识", to: "张三" }] }
    ];
    const m = buildGraphModel(snips);
    assert.equal(m.relEdges.length, 0, "自环关系不应生成边");
    assert.equal(m.entityCount, 0, "无外部实体，不应建实体节点");
});

test("同一实体被多个片段提及只建一个节点", () => {
    const snips = [
        { id: "a", title: "哈利", category: "人物", relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }] },
        { id: "b", title: "邓布利多", category: "人物", relations: [{ from: "邓布利多", relation: "敌对", to: "伏地魔" }] }
    ];
    const m = buildGraphModel(snips);
    const voldNodes = m.nodes.filter(n => n.id === "entity:伏地魔");
    assert.equal(voldNodes.length, 1, "伏地魔 只应有一个实体节点（两片段提及合并）");
    assert.equal(m.relEdges.length, 2, "两条关系边");
});

test("空/非法输入不崩溃", () => {
    assert.deepEqual(buildGraphModel(null).nodes, []);
    assert.deepEqual(buildGraphModel([]).nodes, []);
    assert.equal(buildGraphModel([{ id: "a" }]).entityCount, 0);
});

// ============================================================
// ★ Phase 4 增补：expandRelationNeighbors（RAG 图遍历召回，纯函数）
// ============================================================

const TRAV = [
    { id: "harry", title: "哈利", category: "人物",
      relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }, { from: "哈利", relation: "校友", to: "赫敏" }] },
    { id: "voldemort", title: "伏地魔", category: "人物",
      relations: [{ from: "伏地魔", relation: "领导", to: "食死徒" }] },
    { id: "death", title: "食死徒", category: "势力", relations: [] }
    // 赫敏 为 entity-only（无片段）
];

test("expandRelationNeighbors：2 跳命中直接邻居 + 经实体中转的下游片段", () => {
    const res = expandRelationNeighbors(["harry"], TRAV, { maxDepth: 2 });
    assert.ok(res.has("voldemort"), "直接关系邻居 伏地魔 应被召回");
    assert.ok(res.has("death"), "经 伏地魔 中转的 食死徒 应被召回（2 跳）");
    assert.equal(res.size, 2, "哈利/赫敏 不应出现在结果（赫敏 entity-only、哈利 是 seed）");
});

test("expandRelationNeighbors：seed 自身被排除", () => {
    const res = expandRelationNeighbors(["harry"], TRAV, { maxDepth: 2 });
    assert.ok(!res.has("harry"), "seed 哈利 不应被当作邻居回灌");
});

test("expandRelationNeighbors：实体-only 节点作为中转但不注入（无内容）", () => {
    // 伏地魔 不收录为片段，只有关系 哈利—敌对→伏地魔、伏地魔—领导→食死徒
    const snips = [
        { id: "harry", title: "哈利", relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }] },
        { id: "death", title: "食死徒", relations: [{ from: "伏地魔", relation: "领导", to: "食死徒" }] }
    ];
    const res = expandRelationNeighbors(["harry"], snips, { maxDepth: 2 });
    assert.ok(res.has("death"), "伏地魔 作为中转把 食死徒 带出来");
    assert.equal(res.size, 1, "伏地魔 无内容，不应出现在结果");
});

test("expandRelationNeighbors：maxDepth=1 不摸到第 2 跳", () => {
    // 哈利→伏地魔(entity-only)→食死徒，1 跳摸不到 食死徒
    const snips = [
        { id: "harry", title: "哈利", relations: [{ from: "哈利", relation: "敌对", to: "伏地魔" }] },
        { id: "death", title: "食死徒", relations: [{ from: "伏地魔", relation: "领导", to: "食死徒" }] }
    ];
    const res = expandRelationNeighbors(["harry"], snips, { maxDepth: 1 });
    assert.equal(res.size, 0, "1 跳只能到 entity-only 的伏地魔，无片段可注入");
});

test("expandRelationNeighbors：无 relations / 空输入安全返回空集", () => {
    assert.deepEqual([...expandRelationNeighbors(["a"], [{ id: "a", title: "甲", relations: [] }])], []);
    assert.deepEqual([...expandRelationNeighbors([], TRAV)], []);
    assert.deepEqual([...expandRelationNeighbors(["harry"], null)], []);
    assert.deepEqual([...expandRelationNeighbors(["harry"], TRAV, { maxDepth: 0 })], []);
});

