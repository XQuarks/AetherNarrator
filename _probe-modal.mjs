// 探测：点击 showApiModal 后 apiModal 弹窗的真实状态（自带静态服务器，端口 8090）
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(path.join(import.meta.dirname, "noop.js"));
const { chromium } = require("playwright-core");

const ROOT = path.resolve(import.meta.dirname);
const PORT = 8090;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };
const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1:" + PORT).pathname);
        const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT + path.sep)) throw new Error("越界");
        const bytes = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(bytes);
    } catch (_) { res.writeHead(404); res.end("Not found"); }
});

function candidates() {
    if (process.platform === "win32") return [
        path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
        path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
        path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
    ];
    return ["/usr/bin/google-chrome", "/usr/bin/chromium"];
}
const exe = candidates().find(c => c && fs.existsSync(c));
if (!exe) { console.log("无浏览器"); process.exit(2); }

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(PORT, "127.0.0.1", resolve); });
let browser;
try {
    browser = await chromium.launch({ headless: true, executablePath: exe });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", e => console.log("PAGEERROR:", e.message));
    page.on("console", m => { if (m.type() === "error") console.log("CONSOLE.ERROR:", m.text().slice(0, 200)); });
    await page.goto("http://127.0.0.1:" + PORT + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const before = await page.evaluate(() => {
        const m = document.getElementById("apiModal");
        const b = document.querySelector('[data-action="showApiModal"]');
        return {
            modalExists: !!m,
            btnCount: document.querySelectorAll('[data-action="showApiModal"]').length,
            baseUrlExists: !!document.getElementById("baseUrl"),
            screenActive: document.querySelector(".screen.active")?.id || "无",
            title: document.title,
            bodyHtmlHead: document.body ? document.body.innerHTML.slice(0, 300).replace(/\s+/g, " ") : "无body",
            bodyChildren: document.body ? Array.from(document.body.children).map(c => c.tagName + "#" + c.id).join(",") : "无body"
        };
    });
    console.log("点击前:", JSON.stringify(before));

    await page.evaluate(() => document.querySelector('[data-action="showApiModal"]')?.click());
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
        const m = document.getElementById("apiModal");
        const b = document.getElementById("baseUrl");
        return {
            modalClass: m ? m.className : null,
            modalDisplay: m ? getComputedStyle(m).display : null,
            baseUrlExists: !!b,
            baseUrlVisible: b ? getComputedStyle(b).display !== "none" : false,
            inertScreens: document.querySelectorAll('.screen[inert]').length
        };
    });
    console.log("点击后:", JSON.stringify(after));
} catch (e) {
    console.log("异常:", e.message);
} finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
}
