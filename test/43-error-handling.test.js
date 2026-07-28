// #10 错误处理统一 · Phase 3 防回归测试
// 覆盖 docs/40 规划的 5 个测试点：
//  1) logError 写入 S.debugLog.chunkErrors 且不超过 300 上限
//  2) notifyError(Tier2) 既留痕又弹 toast
//  3) logError(Tier1 静默档) 绝不触发 showToast（#10 核心不变量，防回归雷区）
//  4) idbSet 失败 → 关键保存路径(saveWorlds) 触发 notifyError(弹 toast)
//  5) 全局兜底监听 installGlobalErrorGuard 去抖 5s 内只弹一次
import test from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { logError, tryRepairJSON } from "../src/utils.js";
import { notifyError, showToast } from "../src/render.js";
import { saveWorlds } from "../src/storage.js";
import { installGlobalErrorGuard } from "../src/error-guard.js";

// ---- DOM / window mock ----
// render.js 的 showToast 依赖 document.getElementById("toast")；error-guard 依赖 window.addEventListener。
// 模块顶层不触碰这些（已在 414 全绿测试中验证），仅在函数运行时访问，故可安全 mock。
let toastClassName = "";
const toastEl = {
    textContent: "",
    get className() { return toastClassName; },
    set className(v) { toastClassName = v; },
    classList: { add() {}, remove() {} },
};
globalThis.document = { getElementById: () => toastEl };
const winListeners = {};
globalThis.window = { addEventListener: (t, cb) => { winListeners[t] = cb; } };

test("logError：写入 chunkErrors 且不超过 300 上限", () => {
    S.debugLog = { chunkErrors: [] };
    for (let i = 0; i < 305; i++) logError("t" + i, new Error("e" + i));
    assert.equal(S.debugLog.chunkErrors.length, 300, "应截断到 300");
    assert.equal(S.debugLog.chunkErrors[0].scope, "t0");
    assert.equal(S.debugLog.chunkErrors[299].scope, "t299");
});

test("notifyError：既留痕(logError)又弹 toast", () => {
    S.debugLog = { chunkErrors: [] };
    toastClassName = "";
    notifyError("scopeX", new Error("boom"), "保存失败提示");
    assert.ok(toastClassName.includes("show"), "应触发 toast 显示");
    assert.ok(toastClassName.includes("error"), "应为 error 类型");
    assert.equal(S.debugLog.chunkErrors.length, 1, "应留痕 1 条");
});

test("logError（Tier1 静默档）：绝不触发 showToast（#10 核心不变量）", () => {
    S.debugLog = { chunkErrors: [] };
    toastClassName = "";
    logError("silent", new Error("should not toast"));
    assert.equal(toastClassName, "", "静默档不得触碰 toast 显示");
    assert.equal(S.debugLog.chunkErrors.length, 1, "仍应留痕");
});

test("静默路径 tryRepairJSON：无法修复时抛错、且绝不触碰 UI", () => {
    toastClassName = "";
    // 无法修复的坏输入 → 应抛错（由上层 catch 处理），而非静默吞掉
    assert.throws(
        () => tryRepairJSON("{ totally broken", null),
        /无法修复|结构损坏/,
        "无法修复时应抛错"
    );
    assert.equal(toastClassName, "", "tryRepairJSON 不得触发 toast（结构性静默，utils 层无渲染依赖）");
});

test("idbSet 失败 → 关键保存路径(saveWorlds) 触发 notifyError(弹 toast)", async () => {
    S.worlds = [{ id: "w1", name: "测试世界" }];
    S.debugLog = { chunkErrors: [] };
    toastClassName = "";
    // node 环境无 indexedDB → idbSet 失败返回 false → saveWorlds 调 notifyError
    await saveWorlds();
    assert.ok(toastClassName.includes("error"), "存档失败应弹 toast");
    assert.equal(S.worlds.length, 1, "S.worlds 已更新（不依赖 idb 成功）");
    assert.ok(S.debugLog.chunkErrors.length >= 1, "应留痕");
});

test("全局兜底监听：去抖 5s 内只弹一次", () => {
    S.debugLog = { chunkErrors: [] };
    toastClassName = "";
    installGlobalErrorGuard(); // 注册 window 监听
    // 第一次异常：距上次 >5s（_guardLastShown 初始 0，Date.now 远大于 5000）→ 弹
    winListeners["unhandledrejection"]({ reason: new Error("r1") });
    const afterFirst = toastClassName;
    assert.ok(afterFirst.includes("error"), "第一次应弹 toast");
    // 立即第二次异常：5s 内 → 去抖不弹（className 不变）
    winListeners["unhandledrejection"]({ reason: new Error("r2") });
    assert.equal(toastClassName, afterFirst, "5s 内第二次不应重复弹");
});
