// AetherNarrator · ann.test.js（Phase 1：ANN 索引逻辑校验）
// 说明：hnswlib-wasm 的浏览器构建无法在 node 运行（"not compiled for this environment"），
// 因此这里用 mock hnswlib 注入，验证「索引构建 / 查询映射 / 失效 / 兜底」逻辑正确。
// 真实 ANN 召回质量由浏览器实测脚本（2000 条 mock 对比暴力 topK）覆盖。
import test from "node:test";
import assert from "node:assert/strict";
import {
    buildLoreIndex, getLoreAnnIndex, invalidateLoreAnn,
    embeddingRetrieveBruteforce, __setTestHnswLib
} from "../src/ann-index.js";

// 精确余弦 topK 的 mock hnswlib，便于验证 ann-index 的映射与得分方向
function makeMockLib() {
    return {
        Space: class { constructor(name, dim) { this.dim = dim; } },
        HierarchicalNSW: class {
            // 真实签名：(spaceName, numDimensions, autoSaveFilename:string)
            constructor(space, dim, autoSaveFilename) { this.space = space; this.dim = dim; this.autoSaveFilename = autoSaveFilename; this.pts = []; }
            initIndex() {}
            addPoint(v, label, replaceDeleted) { this.pts.push({ v, label, replaceDeleted }); }
            searchKnn(q, k) {
                const scored = this.pts.map(p => {
                    let dot = 0, na = 0, nb = 0;
                    for (let i = 0; i < q.length; i++) { dot += q[i] * p.v[i]; na += q[i] * q[i]; nb += p.v[i] * p.v[i]; }
                    const sim = (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
                    return { label: p.label, sim };
                });
                scored.sort((a, b) => b.sim - a.sim);
                const top = scored.slice(0, k);
                return { neighbors: top.map(x => x.label), distances: top.map(x => 1 - x.sim) };
            }
        }
    };
}

const DIM = 4;
const snips = [
    { id: "a", embedding: [1, 0, 0, 0], title: "A" },
    { id: "b", embedding: [0, 1, 0, 0], title: "B" },
    { id: "c", embedding: [0, 0, 1, 0], title: "C" },
    { id: "d", embedding: [0.9, 0.1, 0, 0], title: "D" } // 接近 a
];

test("buildLoreIndex：构建并查询返回正确的 topK 与相似度方向", () => {
    __setTestHnswLib(makeMockLib());
    const idx = buildLoreIndex(makeMockLib(), snips, { dim: DIM });
    const res = idx.search([1, 0, 0, 0], 2);
    assert.equal(res.length, 2);
    assert.equal(res[0].snippet.id, "a");          // 最近邻是自身
    assert.ok(Math.abs(res[0].embScore - 1) < 1e-6); // 自身相似度=1
    assert.equal(res[1].snippet.id, "d");          // 次近（0.9）
});

test("buildLoreIndex：维度不符的向量被过滤", () => {
    __setTestHnswLib(makeMockLib());
    const bad = [...snips, { id: "e", embedding: [1, 0, 0] }]; // dim=3，不符
    const idx = buildLoreIndex(makeMockLib(), bad, { dim: DIM });
    assert.equal(idx.size, 4); // 仅 4 个有效
});

test("getLoreAnnIndex：同 worldId 命中缓存不重建，invalidate 后重建", async () => {
    let buildCount = 0;
    const countingLib = makeMockLib();
    const Orig = countingLib.HierarchicalNSW;
    countingLib.HierarchicalNSW = class extends Orig {
        constructor(...a) { super(...a); buildCount++; }
    };
    __setTestHnswLib(countingLib);
    await getLoreAnnIndex({ snippets: snips }, "w1", { dim: DIM });
    await getLoreAnnIndex({ snippets: snips }, "w1", { dim: DIM });
    assert.equal(buildCount, 1); // 命中缓存
    invalidateLoreAnn("w1");
    await getLoreAnnIndex({ snippets: snips }, "w1", { dim: DIM });
    assert.equal(buildCount, 2); // 失效后重建
});

test("embeddingRetrieveBruteforce：给定查询向量返回正确排序的 topK", () => {
    const bf = embeddingRetrieveBruteforce(snips, [1, 0, 0, 0], 2);
    assert.equal(bf.length, 2);
    assert.equal(bf[0].snippet.id, "a");
    assert.equal(bf[1].snippet.id, "d");
    assert.ok(bf[0].embScore >= bf[1].embScore);
});

test("lib 抛错时 getLoreAnnIndex 抛异常（rag.js 据此回落 O(n) 兜底）", async () => {
    const errLib = { Space: class {}, HierarchicalNSW: class { constructor() { throw new Error("boom"); } } };
    __setTestHnswLib(errLib);
    await assert.rejects(() => getLoreAnnIndex({ snippets: snips }, "w2", { dim: DIM }));
});
