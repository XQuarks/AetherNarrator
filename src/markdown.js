// ============================================================
// AetherNarrator · markdown.js
// Obsidian 风 markdown 渲染封装（步骤 B）
// 依赖（由 index.html 以经典 <script> 提前加载，离线内置）：
//   window.markdownit  ← vendor/markdown-it.min.js  (UMD, MIT)
//   window.DOMPurify   ← vendor/dompurify.min.js    (UMD, MIT)
// 二者均非本项目 ESM 依赖，避免打包/网络加载；CSP 已是 'self' 放行 vendor/。
// ============================================================

let _md = null;
function getMd() {
    if (_md === null) {
        _md = (typeof window !== "undefined" && typeof window.markdownit === "function")
            ? window.markdownit({ html: false, linkify: true, breaks: true, typographer: false })
            : false;
    }
    return _md || null;
}

function escapeHtml(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// [[目标]] 或 [[目标|别名]] → 可点击锚点。
// 先 escape 可见文本；href 用 "#"，目标挂在 data-wikilink（经 encodeURIComponent 防属性逃逸）。
const WIKILINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
function wikilinksToAnchors(html) {
    return html.replace(WIKILINK_RE, (_, target, label) => {
        const t = String(target || "").trim();
        if (!t) return escapeHtml(label != null ? label : target);
        const attr = encodeURIComponent(t);
        const text = escapeHtml(String(label != null ? label : target).trim());
        return `<a href="#" class="wikilink" data-wikilink="${attr}">${text}</a>`;
    });
}

// 库未就绪时的纯文本降级（仍保留换行与基础转义）
function fallbackPlain(text) {
    return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

// 渲染笔记正文。返回已消毒的 HTML 字符串。
// 点击跳转由调用方用 .wikilink + data-wikilink 委托处理。
export function renderLoreMarkdown(raw, opts = {}) {
    const text = raw == null ? "" : String(raw);
    let html;
    const md = getMd();
    if (md) {
        html = md.render(text);
        html = wikilinksToAnchors(html);
    } else {
        html = fallbackPlain(text);
    }
    const purify = (typeof window !== "undefined") ? window.DOMPurify : null;
    if (purify && typeof purify.sanitize === "function") {
        // 放行自定义 data-wikilink（DOMPurify 默认亦允许 data-*，此处显式声明双重保险）
        html = purify.sanitize(html, {
            ADD_ATTR: ["data-wikilink", "target", "rel"],
            ALLOW_DATA_ATTR: true
        });
    } else if (md) {
        // 无消毒兜底：仅放行安全协议的链接
        html = html.replace(/<a\s+href="([^"]*)"/gi, (m, h) => {
            return /^(https?:|mailto:|#|tel:)/i.test(h) ? m : '<a href="#"';
        });
    }
    return html;
}

export function isMarkdownReady() {
    return !!(getMd() && (typeof window !== "undefined" ? window.DOMPurify : null));
}
