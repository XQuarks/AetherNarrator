// ============================================================
// AetherNarrator · error-guard.js
// 全局未捕获异常兜底监听（去抖），从 app.js 抽出以便单测。
// 运行时行为不变：app.js 仍在 init() 中调用它。
// ============================================================
import { logError } from "./utils.js";
import { showToast } from "./render.js";

// ★ #10 Phase 1：全局未捕获异常兜底（去抖 5s 一次），防止任何漏网错误静默卡死
let _guardLastShown = 0;
export function installGlobalErrorGuard() {
    const handler = (scope, err) => {
        const e = (err instanceof Error) ? err : new Error(String(err));
        logError(scope, e);
        const now = Date.now();
        if (now - _guardLastShown > 5000) {
            _guardLastShown = now;
            showToast("程序出现异常，部分功能可能受影响（已记录诊断）", "error", 4000);
        }
    };
    window.addEventListener("error", (ev) => handler("window.error", ev.error || ev.message));
    window.addEventListener("unhandledrejection", (ev) => handler("unhandledrejection", ev.reason));
}
