// ============================================================
// C4 · 玩家备注 + 分支预测（理解 A·后果预览）单元测试
// 覆盖：buildPlayerNote 注入/空降级/长度裁剪；normalizeBranches 归总；
// buildBranchPreviewPrompt 形状；predictBranches mock 返回且不污染状态。
// 纯函数 + mock 模式，不依赖真实 API / 浏览器 DOM（最小 document stub）。
// ============================================================
import { test } from "node:test";
import assert from "node:assert";

import { S } from "../src/store.js";
import { buildPlayerNote } from "../src/prompt.js";
import { normalizeBranches, buildBranchPreviewPrompt, predictBranches } from "../src/llm.js";

// ---- 最小 DOM stub（mock 模式走 mockFn，不烧 token）----
global.document = {
    getElementById: (id) => {
        if (id === "mockMode") return { checked: true, value: "on" };
        if (id === "noStreamMode") return { checked: false, value: "" };
        return { checked: false, value: "https://api.deepseek.com/v1" };
    }
};

function resetState() {
    S.currentWorld = null;
    S.gameState = null;
    S.conversationHistory = [];
    S.playerNotes = "";
}

function setupWorld() {
    S.currentWorld = {
        id: "w_c4", name: "测试世界", desc: "一个用于 C4 单测的样例世界，背景足够长以验证截断逻辑abcdefghij", type: "original",
        schema: { variables: [{ name: "勇气" }, { name: "声望" }] }
    };
    S.gameState = { location: "酒馆", variables: { "勇气": 3, "声望": 1 } };
    S.conversationHistory = [
        { player: "我走进了酒馆", narrative: "木门吱呀作响，暖光扑面而来。" },
        { player: "向老板打听消息", narrative: "老板压低声音，说起城外的异动。" }
    ];
}

// ---------- A-1 玩家备注注入 ----------
test("buildPlayerNote：空备注返回空串", () => {
    resetState();
    S.playerNotes = "";
    assert.strictEqual(buildPlayerNote(), "");
    S.playerNotes = "   ";
    assert.strictEqual(buildPlayerNote(), "");
});

test("buildPlayerNote：正常备注包裹为中部槽位文本", () => {
    resetState();
    S.playerNotes = "我想之后找到张三";
    const out = buildPlayerNote();
    assert.ok(out.includes("【玩家笔记"));
    assert.ok(out.includes("我想之后找到张三"));
});

test("buildPlayerNote：超长备注裁剪到 600 字并附截断标记", () => {
    resetState();
    S.playerNotes = "笔记".repeat(400); // 800 字，超过 600
    const out = buildPlayerNote();
    const body = out.replace("【玩家笔记（你自己的备忘，请酌情纳入叙事）】\n", "");
    assert.ok(body.endsWith("…(已截断)"), "应以截断标记结尾");
    assert.ok(body.length <= 600 + "…(已截断)".length);
});

// ---------- A-2 分支预测归总 ----------
test("normalizeBranches：数组形态归总", () => {
    const r = normalizeBranches([
        { branch: "坦白", likely: "关系真实", risk: "失利益" },
        { branch: "隐瞒", likely: "表面平静" }
    ]);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].branch, "坦白");
    assert.strictEqual(r[0].likely, "关系真实");
});

test("normalizeBranches：{branches:[...]} 形态归总", () => {
    const r = normalizeBranches({ branches: [{ branch: "A" }, { branch: "B", likely: "x" }] });
    assert.strictEqual(r.length, 2);
});

test("normalizeBranches：单条 {branch} 也接受", () => {
    const r = normalizeBranches({ branch: "孤注一掷", likely: "赌一把", risk: "高风险" });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].branch, "孤注一掷");
});

test("normalizeBranches：缺 branch 的条目被过滤；超 4 条截断", () => {
    const many = [];
    for (let i = 0; i < 7; i++) many.push({ branch: "方向" + i });
    many.push({ likely: "没有标题" }); // 应被过滤
    const r = normalizeBranches(many);
    assert.strictEqual(r.length, 4);
});

test("normalizeBranches：非法输入回退空数组", () => {
    assert.deepStrictEqual(normalizeBranches(null), []);
    assert.deepStrictEqual(normalizeBranches("不是数组"), []);
    assert.deepStrictEqual(normalizeBranches({}), []);
});

// ---------- A-2 prompt 形状 ----------
test("buildBranchPreviewPrompt：返回 system+user 双消息且含上下文", () => {
    setupWorld();
    S.playerNotes = "别轻易相信老板";
    const msgs = buildBranchPreviewPrompt();
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].role, "system");
    assert.strictEqual(msgs[1].role, "user");
    assert.ok(msgs[1].content.includes("测试世界"));
    assert.ok(msgs[1].content.includes("酒馆"));
    assert.ok(msgs[1].content.includes("勇气=3"));
    assert.ok(msgs[1].content.includes("别轻易相信老板"));
    assert.ok(msgs[1].content.includes("向老板打听消息")); // 近期对话
});

// ---------- A-2 调用：mock 返回 + 不污染状态 ----------
test("predictBranches：mock 下返回归总后的方向，且不改 history/gameState", () => {
    setupWorld();
    const beforeHistory = S.conversationHistory.length;
    const beforeLoc = S.gameState.location;
    return predictBranches().then((branches) => {
        assert.strictEqual(branches.length, 3);
        assert.ok(branches.every(b => b.branch));
        // 纯展示：不写历史、不改游戏状态
        assert.strictEqual(S.conversationHistory.length, beforeHistory);
        assert.strictEqual(S.gameState.location, beforeLoc);
    });
});
