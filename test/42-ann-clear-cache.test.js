// AetherNarrator · 42-ann-clear-cache.test.js（设置界面「清除索引缓存」逻辑校验）
// 说明：真实 hnswlib-wasm 无法在 node 运行，这里用带 FS.readdir/unlink 的 mock 注入，
// 验证 clearLoreAnnCache 仅删除 ann_*.idx、保留其它文件、并返回删除计数；以及库无 FS 时优雅返回 0。
import test from "node:test";
import assert from "node:assert/strict";
import { clearLoreAnnCache, __setTestHnswLib } from "../src/ann-index.js";

function makeFsLib() {
    const files = new Set([
        "ann_world1_4_abc_v1.idx",
        "ann_world2_4_def_v1.idx",
        "ann_world1_4_abc_v2.idx",  // 旧指纹孤儿
        "notes.txt",                // 非 idx，应保留
        "ann_world3_4_ghi_NOEXT",   // 非 .idx，应保留
    ]);
    const lib = {
        FS: {
            mounts: [{ mountpoint: "/" }],
            readdir(root) {
                if (root !== "/") return [];
                return [...files];
            },
            unlink(path) {
                const name = String(path).replace(/^\/+/, "");
                if (files.has(name)) { files.delete(name); return; }
                throw new Error("ENOENT: " + path);
            }
        },
        HierarchicalNSW: class {
            constructor() {}
            initIndex() {}
            addPoint() {}
            searchKnn() { return { neighbors: [], distances: [] }; }
            writeIndex() {}
            loadIndex() { throw new Error("not found"); }
        }
    };
    return { files, lib };
}

test("clearLoreAnnCache：仅删除 ann_*.idx，保留其它文件，返回计数", async () => {
    const { files, lib } = makeFsLib();
    __setTestHnswLib(lib);
    const deleted = await clearLoreAnnCache();
    assert.equal(deleted, 3); // 3 个 ann_*.idx 被删
    assert.ok(files.has("notes.txt"), "非 idx 文件应保留");
    assert.ok(files.has("ann_world3_4_ghi_NOEXT"), "非 .idx 后缀文件应保留");
    const remaining = [...files].filter(f => f.startsWith("ann_") && f.endsWith(".idx"));
    assert.equal(remaining.length, 0, "不应残留 ann_*.idx");
});

test("clearLoreAnnCache：库无 FS 时优雅返回 0（不抛错）", async () => {
    const lib = {
        HierarchicalNSW: class {
            constructor() {}
            initIndex() {}
            addPoint() {}
            searchKnn() { return { neighbors: [], distances: [] }; }
        }
    };
    __setTestHnswLib(lib);
    const deleted = await clearLoreAnnCache();
    assert.equal(deleted, 0);
});
