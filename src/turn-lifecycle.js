export function acquireTurn(runtime) {
    if (!runtime || runtime.isGenerating) return false;
    runtime.isGenerating = true;
    return true;
}

export function releaseTurn(runtime) {
    if (runtime) runtime.isGenerating = false;
}

// ★ P0: 中止在途 LLM 请求并递增会话 epoch，使任何尚未返回的响应因 epoch 不匹配而被丢弃。
// 与 acquireTurn 同款依赖注入风格（调用方传入 S），保持本模块零 import；
// 原在 save.js，移入此处以打破 render↔save 循环依赖（docs/34 #1）。
export function abortCurrentRequest(runtime) {
    if (!runtime) return;
    if (runtime.currentAbortController) {
        try { runtime.currentAbortController.abort(); } catch (e) {}
        runtime.currentAbortController = null;
    }
    for (const controller of runtime.auxiliaryControllers) {
        try { controller.abort(); } catch (_) {}
    }
    runtime.auxiliaryControllers.clear();
    runtime.currentSession.epoch++; // 任何尚未返回的响应将因 epoch 不匹配而被丢弃
}

export function isSessionContextCurrent(expected, current) {
    return !!expected && !!current
        && expected.epoch === current.epoch
        && expected.worldId === current.worldId;
}
