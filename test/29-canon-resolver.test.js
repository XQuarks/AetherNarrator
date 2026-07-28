// ★ A2 #2：world.canon 统一模型 + 协调器 resolveCanonContext + detectIp 辅助
import test from "node:test";
import assert from "node:assert/strict";
import { detectIp, matchKnownIp } from "../src/utils.js";
import { resolveCanonContext, ensureWorldCanon } from "../src/store.js";

test("detectIp：单 IP 别名识别", () => {
    assert.deepEqual(detectIp("故事发生在霍格沃茨魔法学校"), ["哈利波特"]);
    assert.deepEqual(detectIp("深海中沉睡的 CTHULHU 苏醒了"), ["克苏鲁"]);
});

test("detectIp：多 IP 同时识别并去重", () => {
    const r = detectIp("哈利波特与克苏鲁同处一個世界：伏地魔召唤了修格斯");
    assert.deepEqual(r.sort(), ["克苏鲁", "哈利波特"]);
});

test("detectIp：空/非字符串安全", () => {
    assert.deepEqual(detectIp(""), []);
    assert.deepEqual(detectIp(null), []);
    assert.deepEqual(detectIp(undefined), []);
});

test("matchKnownIp：自由填写映射到标准 IP 名", () => {
    assert.equal(matchKnownIp("harry potter"), "哈利波特");
    assert.equal(matchKnownIp("我的哈利波特同人"), "哈利波特");
    assert.equal(matchKnownIp("原创修仙"), null);
});

test("resolveCanonContext：原创世界 + 描述带 HP → mode=original，不自动断言 IP，记录 detected", () => {
    const r = resolveCanonContext({ type: "original", ipName: "", desc: "霍格沃茨的早晨", sourceFileContent: "" });
    assert.equal(r.mode, "original");
    assert.equal(r.ip_name, null);
    assert.deepEqual(r.detected, ["哈利波特"]);
    assert.deepEqual(r.conflicts, []);
});

test("resolveCanonContext：选 ip 且填名 → ip_adaptation，ip_name 取用户填的", () => {
    const r = resolveCanonContext({ type: "ip", ipName: "哈利波特", desc: "", sourceFileContent: "" });
    assert.equal(r.mode, "ip_adaptation");
    assert.equal(r.ip_name, "哈利波特");
    assert.equal(r.source, "description");
    assert.deepEqual(r.conflicts, []);
});

test("resolveCanonContext：用户填 HP，但文本是克苏鲁 → ip_mismatch 冲突", () => {
    const r = resolveCanonContext({ type: "ip", ipName: "哈利波特", desc: "深潜者从海底升起，旧日支配者降临", sourceFileContent: "" });
    assert.equal(r.mode, "ip_adaptation");
    assert.equal(r.ip_name, "哈利波特");
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].type, "ip_mismatch");
    assert.deepEqual(r.conflicts[0].detected, ["克苏鲁"]);
});

test("resolveCanonContext：选 ip 但留空名 + 上传文本带 HP → 用检测到的单一 IP 补足", () => {
    const r = resolveCanonContext({ type: "ip", ipName: "", desc: "", sourceFileContent: "霍格沃茨特快列车驶向学校" });
    assert.equal(r.mode, "ip_adaptation");
    assert.equal(r.ip_name, "哈利波特");
    assert.equal(r.source, "uploaded_text");
});

test("resolveCanonContext：原创 + 文本同时带两个 IP → ambiguous_ip 冲突，ip_name 留空", () => {
    const r = resolveCanonContext({ type: "original", ipName: "", desc: "哈利波特和克苏鲁对决", sourceFileContent: "" });
    assert.equal(r.mode, "original");
    assert.equal(r.ip_name, null);
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].type, "ambiguous_ip");
    assert.equal(r.detected.length, 2);
});

test("ensureWorldCanon：补齐 detected 默认字段，不破坏既有 canon", () => {
    const w1 = { type: "ip", ip_name: "哈利波特" };
    const c1 = ensureWorldCanon(w1);
    assert.equal(c1.mode, "ip_adaptation");
    assert.deepEqual(c1.detected, []);
    assert.equal(c1.key_divergences, "");
    assert.equal(c1.consistency_pack, null);

    const w2 = { canon: { mode: "original", ip_name: null, source: "description", detected: ["三体"], key_divergences: "时间线改到2026", consistency_pack: { banned: ["手机"], must_read: [], style_anchor: "" }, pack_source: "generated" } };
    const c2 = ensureWorldCanon(w2);
    assert.equal(c2.detected[0], "三体");
    assert.equal(c2.key_divergences, "时间线改到2026");
    assert.equal(c2.pack_source, "generated");
});
