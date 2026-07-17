// ============================================================
// AetherNarrator · files.js（由 app.js 模块化拆分自动生成）
// ============================================================

import { S } from "./store.js";
import { capSource, escapeHtml, formatFileSize } from "./utils.js";
import { showToast, refreshIpNameRequirement } from "./render.js";

export function autoFillWorldDesc() {
    const descEl = document.getElementById("worldDesc");
    if (descEl && !descEl.value.trim()) {
        descEl.value = "原作世界观";
    }
}

export function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    // ★ Plan A：上传大小上限放宽到 20MB，配合全书分块抽取知识库
    if (file.size > 20 * 1024 * 1024) {
        showToast("文件过大（上限 20MB），请压缩或拆分后上传", "error");
        event.target.value = ""; // 允许重新选择
        return;
    }

    const area = document.getElementById("fileUploadArea");
    const text = document.getElementById("fileUploadText");

    if (file.name.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = function(e) {
            S.sourceFileContent = capSource(e.target.result);
            autoFillWorldDesc();
            area.classList.add("has-file");
            text.innerHTML = `<span class="file-name">${escapeHtml(file.name)}</span> (${formatFileSize(file.size)}) <span class="file-remove" data-action="clearSourceFile" tabindex="0" role="button" aria-label="移除上传的文件">✕</span>`;
            refreshIpNameRequirement(); // ★ 上传后：作品名称改为可选填写
            // 点击已由初始化时的事件委托统一处理（允许重新选择/更换源文件）
        };
        reader.readAsText(file, "UTF-8");
    } else if (file.name.endsWith(".docx")) {
        if (typeof window.mammoth !== "undefined") {
            const reader = new FileReader();
            reader.onload = function(e) {
                window.mammoth.extractRawText({ arrayBuffer: e.target.result })
                    .then(function(result) {
                        S.sourceFileContent = capSource(result.value);
                        autoFillWorldDesc();
                        area.classList.add("has-file");
                        text.innerHTML = `<span class="file-name">${escapeHtml(file.name)}</span> (${formatFileSize(file.size)}) <span class="file-remove" data-action="clearSourceFile" tabindex="0" role="button" aria-label="移除上传的文件">✕</span>`;
                        refreshIpNameRequirement(); // ★ 上传后：作品名称改为可选填写
                        // 点击已由初始化时的事件委托统一处理（允许重新选择/更换源文件）
                    })
                    .catch(function(err) {
                        showToast("DOCX 解析失败：" + err.message, "error");
                    });
            };
            reader.readAsArrayBuffer(file);
        } else {
            showToast("DOCX 解析需要 mammoth.js，请使用 .txt 格式", "error");
        }
    } else if (file.name.endsWith(".epub")) {
        if (typeof window.JSZip !== "undefined") {
            const reader = new FileReader();
            reader.onload = function(e) {
                text.innerHTML = "正在解析 EPUB...";
                parseEpub(e.target.result)
                    .then(function(extracted) {
                        S.sourceFileContent = capSource(extracted);
                        autoFillWorldDesc();
                        area.classList.add("has-file");
                        text.innerHTML = `<span class="file-name">${escapeHtml(file.name)}</span> (${formatFileSize(file.size)}) <span class="file-remove" data-action="clearSourceFile" tabindex="0" role="button" aria-label="移除上传的文件">✕</span>`;
                        refreshIpNameRequirement(); // ★ 上传后：作品名称改为可选填写
                        // 点击已由初始化时的事件委托统一处理（允许重新选择/更换源文件）
                        showToast("EPUB 解析完成，" + Math.round(extracted.length / 1000) + "K 字符", "success");
                    })
                    .catch(function(err) {
                        showToast("EPUB 解析失败：" + err.message, "error");
                        text.innerHTML = "点击上传 TXT / DOCX / EPUB 文件";
                    });
            };
            reader.readAsArrayBuffer(file);
        } else {
            showToast("EPUB 解析需要 JSZip，请使用 .txt 格式", "error");
        }
    }
}

export async function parseEpub(arrayBuffer) {
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    // ★ P1.2.9: 压缩炸弹防护——限制条目数与解压后总大小
    const entries = Object.keys(zip.files);
    if (entries.length > 2000) throw new Error("EPUB 条目过多，疑似压缩炸弹");
    let totalUncompressed = 0;
    for (const n of entries) {
        const f = zip.files[n];
        if (f && !f.dir) totalUncompressed += (f._uncompressedLength || 0);
    }
    if (totalUncompressed > 20 * 1024 * 1024) throw new Error("EPUB 解压后过大，疑似压缩炸弹");
    let containerXml = null;
    for (const name of Object.keys(zip.files)) {
        if (name.toLowerCase().endsWith("container.xml")) {
            containerXml = await zip.files[name].async("string");
            break;
        }
    }
    if (!containerXml) throw new Error("无法找到 container.xml");
    const rootfileMatch = containerXml.match(/full-path="([^"]+)"/) || containerXml.match(/full-path='([^']+)'/);
    if (!rootfileMatch) throw new Error("无法解析 OPF 路径");
    const opfPath = rootfileMatch[1];
    const opfContent = await zip.files[opfPath].async("string");
    const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/);
    const manifestMatch = opfContent.match(/<manifest>([\s\S]*?)<\/manifest>/);
    if (!spineMatch || !manifestMatch) throw new Error("无法解析 OPF");
    const spineItems = [...spineMatch[1].matchAll(/idref="([^"]+)"/g)].map(m => m[1]);
    const manifestItems = [...manifestMatch[1].matchAll(/id="([^"]+)"[^>]*href="([^"]+)"/g)].map(m => ({ id: m[1], href: m[2] }));
    const idToHref = {};
    manifestItems.forEach(item => { idToHref[item.id] = item.href; });
    const opfDir = opfPath.substring(0, opfPath.lastIndexOf("/"));
    let fullText = "";
    for (const idref of spineItems) {
        const href = idToHref[idref];
        if (!href) continue;
        const targetPath = opfDir ? opfDir + "/" + href : href;
        let html;
        try { html = await zip.files[targetPath].async("string"); }
        catch (e) { try { html = await zip.files[href].async("string"); } catch (e2) { continue; } }
        let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&\w+;/g, " ").replace(/&#\d+;/g, " ");
        text = text.replace(/\n\s*\n/g, "\n").trim();
        if (text.length > 50) fullText += text + "\n\n";
    }
    if (!fullText) throw new Error("未能提取到文本内容");
    return fullText;
}

export function clearSourceFile(e) {
    if (e) e.stopPropagation();
    S.sourceFileContent = "";
    const area = document.getElementById("fileUploadArea");
    const text = document.getElementById("fileUploadText");
    const input = document.getElementById("sourceFile");
    area.classList.remove("has-file");
    text.innerHTML = `点击上传 TXT / DOCX 文件`;
    // 文件上传区点击已在初始化时通过事件委托统一绑定
    input.value = "";
    refreshIpNameRequirement(); // ★ 移除文件后：作品名称恢复为必填
}
