// ============================================================
// 三处线上 bug 的回归测试（2026-08-07 黎总反馈）
// 1) 等待剧情回复时点「今日动态」→ 定稿时日报被重复渲染成两条（数据只有一条，重开存档只剩一条）
// 2) 世界日报把主角在做的游戏《龙裔》写成《龙族》→ 日报 prompt 缺少剧情上下文
// 3) 世界详情里点「选择存档」→ 存档弹窗被世界详情盖住（两者 z-index 都是 1000）
// ============================================================
import test from "node:test";
import assert from "node:assert/strict";

// ---------- 极简 DOM 桩（只实现 render.js 用到的那点子集）----------
function makeClassList(node) {
    const list = () => (node.className || "").split(/\s+/).filter(Boolean);
    return {
        add: (c) => { const s = new Set(list()); s.add(c); node.className = [...s].join(" "); },
        remove: (c) => { const s = new Set(list()); s.delete(c); node.className = [...s].join(" "); },
        contains: (c) => list().includes(c),
        toggle: () => {}
    };
}
function makeNode(html = "", className = "") {
    const node = {
        _html: html,
        className: className || (html.match(/class="([^"]*)"/) || ["", ""])[1],
        parentNode: null,
        childNodes: [],
        style: {},
        scrollTop: 0,
        scrollHeight: 0,
        textContent: "",
        setAttribute() {}, removeAttribute() {}, focus() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        remove() {
            const p = node.parentNode;
            if (!p) return;
            const i = p.childNodes.indexOf(node);
            if (i >= 0) p.childNodes.splice(i, 1);
            node.parentNode = null;
        },
        replaceWith(fresh) {
            const p = node.parentNode;
            if (!p) return;
            const i = p.childNodes.indexOf(node);
            if (i >= 0) { p.childNodes[i] = fresh; fresh.parentNode = p; }
            node.parentNode = null;
        },
        insertBefore(n, ref) {
            const i = ref ? node.childNodes.indexOf(ref) : -1;
            if (i >= 0) node.childNodes.splice(i, 0, n); else node.childNodes.push(n);
            n.parentNode = node;
        }
    };
    node.classList = makeClassList(node);
    return node;
}
function makeTemplate() {
    let child = null;
    return {
        set innerHTML(v) { child = makeNode(v); },
        get innerHTML() { return child ? child._html : ""; },
        get content() { return { firstChild: child }; }
    };
}

const choicesArea = makeNode("", "choices-row in-log");
const gameLog = makeNode("", "game-log");
Object.defineProperty(gameLog, "innerHTML", {
    get() { return ""; },
    set() { gameLog.childNodes = [choicesArea]; choicesArea.parentNode = gameLog; }
});
gameLog.querySelectorAll = (sel) =>
    sel === ".log-entry" ? gameLog.childNodes.filter(n => (n.className || "").split(/\s+/).includes("log-entry")) : [];

const byId = new Map([["gameLog", gameLog], ["choicesArea", choicesArea]]);
const overlays = [];
function registerOverlay(id) {
    const el = makeNode("", "modal-overlay");
    byId.set(id, el);
    overlays.push(el);
    return el;
}
globalThis.window = globalThis;
globalThis.document = {
    activeElement: null,
    getElementById: (id) => {
        if (!byId.has(id)) byId.set(id, makeNode());
        return byId.get(id);
    },
    createElement: (tag) => (tag === "template" ? makeTemplate() : makeNode()),
    querySelectorAll: (sel) => {
        if (sel === ".modal-overlay.show") return overlays.filter(o => (o.className || "").split(/\s+/).includes("show"));
        return [];
    }
};

const { S } = await import("../src/store.js");
const { renderLog, replaceEntryDOM, removeLogEntry, showModal, closeModal } = await import("../src/render.js");
const { buildDailyContext, collectKnownTerms } = await import("../src/prompt.js");

function entry(o) {
    return { player: "", narrative: "", retrieved: [], period: "上午", day: 1, tcd: null, key_facts: [], ...o };
}
function resetLog() {
    S.currentWorld = null;
    S.gameState = { ignoredBanned: [] };
    S.conversationHistory = [];
    S.renderedEntryCount = 0;
    renderLog(true);
}
const logEntryCount = () => gameLog.querySelectorAll(".log-entry").length;
const logHtmlAt = (i) => gameLog.querySelectorAll(".log-entry")[i]._html;

// ============================================================
// 1) 定稿重渲染不得重复已有条目
// ============================================================
test("replaceEntryDOM：定稿时原地替换，其后的「今日动态」不被重复渲染", () => {
    resetLog();
    // 玩家发起一回合（占位条）
    const pending = entry({ player: "去店里看看", narrative: "", _pending: true });
    S.conversationHistory.push(pending);
    renderLog();
    // 等待期间点「今日动态」，日报作为一条播报插到后面
    S.conversationHistory.push(entry({ player: "（查看世界动态）", narrative: "【世界日报】· 头条", isComm: true, commKind: "daily" }));
    renderLog();
    assert.equal(logEntryCount(), 2, "此刻应有 2 条：待生成回合 + 日报");

    // 回合定稿
    pending.narrative = "你推开店门，风铃响了一声。";
    pending._pending = false;
    replaceEntryDOM(0);

    assert.equal(logEntryCount(), 2, "定稿后仍应是 2 条（修复前会变 3 条，日报弹两次）");
    assert.ok(logHtmlAt(0).includes("风铃响了一声"), "第 1 条应为定稿后的剧情");
    assert.ok(logHtmlAt(1).includes("世界日报"), "第 2 条仍是日报，且顺序不变");
    assert.equal(S.renderedEntryCount, 2, "渲染计数与数组长度保持一致");
});

test("replaceEntryDOM：末尾条目定稿（常规路径）仍正常替换，不新增节点", () => {
    resetLog();
    const pending = entry({ player: "继续", narrative: "", _pending: true });
    S.conversationHistory.push(pending);
    renderLog();
    pending.narrative = "夜色更深了。";
    pending._pending = false;
    replaceEntryDOM(0);
    assert.equal(logEntryCount(), 1);
    assert.ok(logHtmlAt(0).includes("夜色更深了"));
});

test("replaceEntryDOM：条目尚未渲染时回落到追加路径（不炸、能出现）", () => {
    resetLog();
    S.conversationHistory.push(entry({ narrative: "开场白。" }));
    // 故意不先 renderLog，直接定稿重渲染
    replaceEntryDOM(0);
    assert.equal(logEntryCount(), 1);
    assert.ok(logHtmlAt(0).includes("开场白"));
});

// ============================================================
// 2) 丢弃过期条目时的渲染计数
// ============================================================
test("removeLogEntry：删掉待生成条后，其后条目不会被重复追加", () => {
    resetLog();
    S.conversationHistory.push(entry({ player: "问路", narrative: "", _pending: true }));
    renderLog();
    S.conversationHistory.push(entry({ narrative: "【世界日报】· 小道消息", isComm: true }));
    renderLog();

    removeLogEntry(0); // 模拟「丢弃过期响应」

    assert.equal(S.conversationHistory.length, 1, "数组里只剩日报");
    assert.equal(logEntryCount(), 1, "DOM 里也只剩日报");
    assert.equal(S.renderedEntryCount, 1, "渲染计数应递减为 1，而不是回退到 0");
    renderLog();
    assert.equal(logEntryCount(), 1, "再次 renderLog 不得把日报又追加一遍");
});

// ============================================================
// 3) 弹窗叠层：后开的弹窗必须压在先开的之上
// ============================================================
test("showModal：叠层打开时后开的弹窗 z-index 更高，关闭后复位", () => {
    const detail = registerOverlay("worldDetailModal");
    const chooser = registerOverlay("worldSaveChooserModal");

    showModal("worldDetailModal");
    assert.equal(detail.style.zIndex || "", "", "第一个弹窗不动 z-index，沿用样式表的 1000");
    showModal("worldDetailModal"); // 重复打开同一个弹窗不该把它自己越抬越高
    assert.equal(detail.style.zIndex || "", "", "重复 showModal 同一弹窗，层级保持不变");

    showModal("worldSaveChooserModal");
    assert.equal(chooser.style.zIndex, "1010", "存档弹窗必须抬到世界详情之上");

    closeModal("worldSaveChooserModal");
    assert.equal(chooser.style.zIndex, "", "关闭后复位，避免层级越堆越高");

    // 再开一次仍应正确抬层（而不是继承上次的值）
    showModal("worldSaveChooserModal");
    assert.equal(chooser.style.zIndex, "1010");
    closeModal("worldSaveChooserModal");
    closeModal("worldDetailModal");
});

// ============================================================
// 4) 世界日报上下文：专有名词不能再被写歪
// ============================================================
test("buildDailyContext：注入近期剧情，让「龙裔」这类专有名词进得了 prompt", () => {
    const ctx = buildDailyContext({
        world: { name: "刘飞是香港人", hero: "刘飞，独立游戏开发者" },
        gameState: { current_location: "旺角工作室" },
        history: [
            { player: "写代码", narrative: "你给《龙裔》的战斗系统改了三版。" },
            { player: "发帖", narrative: "《龙裔》的试玩帖在论坛炸了。" }
        ],
        memories: ["主角正在开发独立游戏《龙裔》"]
    });
    assert.ok(ctx.includes("龙裔"), "近期剧情里的作品名必须进上下文");
    assert.ok(ctx.includes("近期剧情"), "应有近期剧情段");
    assert.ok(ctx.includes("已确立的事实/记忆"), "应有记忆段");
    assert.ok(ctx.includes("主角设定"), "应有主角设定段");
    assert.ok(ctx.includes("旺角工作室"), "地点应进入专有名词表");
    assert.ok(ctx.includes("不得改字"), "必须带上「名词照抄」的约束标题");
});

test("buildDailyContext：过滤系统提示/待生成/日报自身条目，只取最近 N 回合", () => {
    const history = [];
    for (let i = 1; i <= 10; i++) history.push({ player: "act" + i, narrative: "剧情" + i });
    history.push({ narrative: "（系统拦截）不要越权", isWarning: true });
    history.push({ narrative: "生成中", _pending: true });
    history.push({ narrative: "【世界日报】旧日报", isComm: true });
    const ctx = buildDailyContext({ history, recentTurns: 3 });
    assert.ok(ctx.includes("剧情10") && ctx.includes("剧情8"), "应取最近 3 条正常剧情");
    assert.ok(!ctx.includes("剧情7"), "更早的剧情不进上下文");
    assert.ok(!ctx.includes("系统拦截"), "系统提示不进上下文");
    assert.ok(!ctx.includes("生成中"), "待生成条目不进上下文");
    assert.ok(!ctx.includes("旧日报"), "日报自身不进上下文，避免自我复读");
});

test("buildDailyContext：完全空输入返回空串，不给 prompt 塞空段", () => {
    assert.equal(buildDailyContext({}), "");
    assert.equal(buildDailyContext(), "");
});

test("collectKnownTerms：汇总人物卡/地点/知识库/背包/关系，去重且过滤过短过长", () => {
    const terms = collectKnownTerms({
        world: {
            characters: [{ name: "刘飞" }, { name: "阿May" }, { name: "" }],
            locations: [{ name: "旺角工作室" }],
            lore_kb: { snippets: [{ title: "龙裔（开发中的游戏）" }, { title: "刘飞" }] }
        },
        gameState: {
            current_location: "旺角工作室",
            revealed_locations: ["深水埗"],
            relationships: { "阿May": 30 },
            bonds: { "老陈": { affinity: 10 } },
            inventory: [{ name: "笔记本电脑" }, { name: "水" }]
        }
    });
    assert.ok(terms.includes("刘飞") && terms.includes("阿May"), "人物名进表");
    assert.ok(terms.includes("龙裔（开发中的游戏）"), "知识库条目标题进表");
    assert.ok(terms.includes("深水埗") && terms.includes("老陈"), "地点与羁绊对象进表");
    assert.ok(terms.includes("笔记本电脑"), "背包物品进表");
    assert.ok(!terms.includes("水"), "单字词过滤掉（噪音）");
    assert.equal(terms.filter(t => t === "刘飞").length, 1, "重复项只留一个");
    assert.equal(terms.filter(t => t === "旺角工作室").length, 1, "地点重复只留一个");
});

test("collectKnownTerms：无世界/无状态时返回空数组，不抛错", () => {
    assert.deepEqual(collectKnownTerms(), []);
    assert.deepEqual(collectKnownTerms({ world: null, gameState: null }), []);
});
