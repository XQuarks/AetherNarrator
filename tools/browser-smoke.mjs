import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function browserCandidates() {
    if (process.platform === "win32") {
        return [
            path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
            path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
            path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
        ];
    }
    return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

const executablePath = browserCandidates().find(candidate => candidate && fs.existsSync(candidate));
if (!executablePath) throw new Error("未找到可用于烟雾测试的 Edge/Chrome/Chromium");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown" };
const server = http.createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, BASE_URL).pathname);
        const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep)) throw new Error("越界路径");
        const bytes = await readFile(file);
        response.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        response.end(bytes);
    } catch (_) {
        response.writeHead(404);
        response.end("Not found");
    }
});

async function startServer() {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, "127.0.0.1", resolve);
    });
    for (let i = 0; i < 10; i++) {
        try {
            const response = await fetch(BASE_URL);
            if (response.ok) return;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("本地测试服务器启动超时");
}

let browser;
try {
    await startServer();
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.locator('[data-action="showWorldList"]').click();
    await page.locator('[data-action="showWorldDetail"][data-id="demo_cthulhu"]').click();
    await page.locator('#worldDetailModal [data-action="startGame"]').click();
    await page.locator('[data-action="showGameSettings"]').click();
    // 时间设置已迁移至知识库初览，游戏设置中不应再出现独立按钮
    if (await page.locator('[data-action="showTimeConfigModal"]').count() !== 0) throw new Error("游戏设置仍残留已移除的「世界时间设置」按钮");
    if (!(await page.locator("#aiEnhancedToggle").isVisible())) throw new Error("AI 增强开关不可见");
    await page.locator('[data-action="closeModal"][data-modal="gameSettingsModal"]').first().click();

    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error("移动端存在横向溢出");
    if (pageErrors.length) throw new Error("浏览器运行错误：" + pageErrors.join("；"));
    console.log("✅ 浏览器烟雾测试通过：开局、设置（已移除独立时间面板）、移动端布局");
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
