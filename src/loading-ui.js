// ============================================================
// AetherNarrator · loading-ui.js
// 纯 DOM 的加载反馈控制器（启动遮罩 / 引擎角标 / 进入游戏遮罩）。
// 不依赖任何重型模块，可被 rag.js / save.js / app.js 安全 import。
// 所有函数对「非浏览器环境（Node 测试）」做了 null 守卫，不会崩。
// ============================================================

function el(id) {
    if (typeof document === "undefined") return null;
    return document.getElementById(id);
}

// 引擎角标自动隐藏的安全计时器（模型加载失败也不让角标永久挂着）
let _badgeAutoHideTimer = null;

// —— 启动遮罩：JS 解析/数据加载期间显示，init 完成后由 app.js 调用隐藏 ——
export function hideBootOverlay() {
    const o = el("bootOverlay");
    if (o) o.classList.add("hide");
}

// —— 引擎角标：后台 33MB 语义模型下载时的非阻塞提示 ——
export function showEngineBadge(text) {
    const b = el("engineBadge");
    if (!b) return;
    b.classList.remove("hide", "ok");
    const t = el("engineBadgeText");
    if (t) t.textContent = text || "AI 语义引擎准备中…";
    // 兜底：35s 内若未收到 ready（如 worker 异常），自动收起，避免永久「准备中」
    if (_badgeAutoHideTimer) clearTimeout(_badgeAutoHideTimer);
    _badgeAutoHideTimer = setTimeout(() => { if (b && !b.classList.contains("ok")) b.classList.add("hide"); }, 35000);
}

export function setEngineReady() {
    const b = el("engineBadge");
    if (!b) return;
    if (_badgeAutoHideTimer) { clearTimeout(_badgeAutoHideTimer); _badgeAutoHideTimer = null; }
    b.classList.add("ok");
    const t = el("engineBadgeText");
    if (t) t.textContent = "AI 语义引擎已就绪";
    setTimeout(() => { if (b) b.classList.add("hide"); }, 1800);
}

// —— 进入游戏遮罩：点击世界卡片 → 全屏提示，模型就绪/界面就绪后隐藏 ——
export function showEnterOverlay(title, note) {
    const o = el("enterOverlay");
    if (!o) return;
    const t = el("enterTitle");
    if (t) t.textContent = title || "正在进入世界…";
    const n = el("enterNote");
    if (n) n.textContent = note || "";
    o.classList.remove("hide");
}

export function hideEnterOverlay() {
    const o = el("enterOverlay");
    if (o) o.classList.add("hide");
}
