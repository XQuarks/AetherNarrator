// AetherNarrator · 41-ann-persist.test.js（#14：ANN 索引持久化逻辑校验）
// 说明：真实 hnswlib-wasm 无法在 node 运行，这里用支持 loadIndex/writeIndex 的 mock 注入，
// 验证「构建→写盘→失效→读回不重建」与「编辑片段内容改变文件名→旧索引自动失效」两条主线。
import test from "node:test";
import assert from "node:assert/strict";
import {
    getLoreAnnIndex, invalidateLoreAnn, __setTestHnswLib
} from "../src/ann-index.js";

const DIM = 4;
const snips = [
    { id: "a", embedding: [1, 0, 0, 0], title: "A", content: "alpha" },
    { id: "b", embedding: [0, 1, 0, 0], title: "B", content: "beta" },
    { id: "c", embedding: [0, 0, 1, 0], title: "C", content: "gamma" },
];

// 支持 loadIndex/writeIndex 的 mock：用 written 集合模拟「虚拟 FS 中该文件是否存在」
function makePersistLib() {
    const written = new Set();
    const lib = {
        HierarchicalNSW: class {
            constructor(space, dim, fn) { this.space = space; this.dim = dim; this.fn = fn; this.pts = []; }
            initIndex() {}
            addPoint(v, label) { this.pts.push({ v, label }); }
            searchKnn(q, k) {
                const top = this.pts.slice(0, k);
                return { neighbors: top.map(p => p.label), distances: top.map(() => 0) };
            }
            writeIndex(fn) { if (!written.has(fn)) written.add(fn); }
            loadIndex(fn) { if (!written.has(fn)) throw new Error("not found: " + fn); }
        }
    };
    return { written, lib };
}

test("#14 getLoreAnnIndex：首次构建并 writeIndex；失效后读回不重建", async () => {
    const { written, lib } = makePersistLib();
    __setTestHnswLib(lib);
    let addPointCalls = 0;
    const origAdd = lib.HierarchicalNSW.prototype.addPoint;
    lib.HierarchicalNSW.prototype.addPoint = function (...a) { addPointCalls++; return origAdd.apply(this, a); };

    await getLoreAnnIndex({ snippets: snips }, "wp", { dim: DIM });
    assert.equal(written.size, 1);             // 已 writeIndex 一个文件
    const afterBuild = addPointCalls;
    assert.ok(afterBuild >= 1);

    invalidateLoreAnn("wp");
    await getLoreAnnIndex({ snippets: snips }, "wp", { dim: DIM });
    assert.equal(written.size, 1);             // 仍是同一文件，未再写
    assert.equal(addPointCalls, afterBuild);   // 读回，未重建（addPoint 没增加）

    await getLoreAnnIndex({ snippets: snips }, "wp", { dim: DIM });
    assert.equal(addPointCalls, afterBuild);   // 缓存命中，也未重建
});

test("#14 内容指纹：编辑片段内容会改变文件名 → 旧索引自动失效", async () => {
    const { written, lib } = makePersistLib();
    __setTestHnswLib(lib);

    await getLoreAnnIndex({ snippets: snips }, "we", { dim: DIM });
    const filesV1 = new Set(written);
    assert.equal(filesV1.size, 1);

    // 编辑一条片段的 content（真实流程：lore-ui 改完知识库后会调 invalidateLoreAnn）
    const edited = snips.map(s => s.id === "a" ? { ...s, content: "ALPHA-EDITED" } : s);
    invalidateLoreAnn("we");
    await getLoreAnnIndex({ snippets: edited }, "we", { dim: DIM });

    // 应写入一个「不同名」的新文件（旧文件成为孤儿），而非读回/覆盖旧文件
    assert.equal(written.size, 2);
    assert.notEqual([...written].sort().join(","), [...filesV1].sort().join(","));
});

test("#14 getLoreAnnIndex：库无 loadIndex 时优雅回落（不持久化但行为正常）", async () => {
    // 无 loadIndex 的 mock（与既有 ann.test.js 的 makeMockLib 同形态）
    const lib = {
        HierarchicalNSW: class {
            constructor(space, dim, fn) { this.space = space; this.dim = dim; this.fn = fn; this.pts = []; }
            initIndex() {}
            addPoint(v, label) { this.pts.push({ v, label }); }
            searchKnn(q, k) {
                const top = this.pts.slice(0, k);
                return { neighbors: top.map(p => p.label), distances: top.map(() => 0) };
            }
        }
    };
    __setTestHnswLib(lib);
    let buildCount = 0;
    const Orig = lib.HierarchicalNSW;
    lib.HierarchicalNSW = class extends Orig { constructor(...a) { super(...a); buildCount++; } };

    await getLoreAnnIndex({ snippets: snips }, "wn", { dim: DIM });
    await getLoreAnnIndex({ snippets: snips }, "wn", { dim: DIM });
    assert.equal(buildCount, 1); // 缓存命中（无 loadIndex 也应正常缓存）
    invalidateLoreAnn("wn");
    await getLoreAnnIndex({ snippets: snips }, "wn", { dim: DIM });
    assert.equal(buildCount, 2); // 失效后重建
});
