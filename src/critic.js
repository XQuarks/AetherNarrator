// ============================================================
// AetherNarrator · critic.js（Phase 3 · Critic 审稿人编排层）
// 复用 lore-revision.js 的 diff 纯函数，不另造轮子。
// 与 B5 的 S._loreRevisionBuffer 隔离，避免互相覆盖。
// ============================================================
import { S } from "./store.js";
import { deepClone } from "./utils.js";
import { showModal, closeModal, showToast } from "./render.js";
import { callWorldCriticLLM } from "./llm.js";
import { applyLoreRevisionDiff } from "./lore-revision.js";
import { ensureLoreEmbeddings } from "./rag.js";
import { saveWorlds } from "./storage.js";

// 自动审稿（生成世界后 fire-and-forget 调用）或手动触发。
// world：世界对象（取其 lore_kb 与 rules）。
export async function runWorldCritic(world) {
    if (!world || !world.lore_kb || !Array.isArray(world.lore_kb.snippets) || !world.lore_kb.snippets.length) {
        showToast("知识库为空，无需审稿", "warn");
        return;
    }
    const diff = await callWorldCriticLLM(world.lore_kb, world);
    if (!diff || (!diff.updates.length && !diff.additions.length)) {
        showToast("🤖 审稿完成：未发现明显矛盾", "success");
        return;
    }
    S._criticBuffer = diff;
    S._criticWorldId = world.id;
    renderCriticModalBody(diff);
    showModal("criticModal");
}

// 手动按钮入口：按 worldId 找到世界后跑审稿。
export async function triggerWorldCritic(worldId) {
    const world = (S.worlds || []).find(w => w.id === worldId) || (S.currentWorld && S.currentWorld.id === worldId ? S.currentWorld : null);
    if (!world) { showToast("未找到对应世界", "error"); return; }
    await runWorldCritic(world);
}

function renderCriticModalBody(diff) {
    const body = document.getElementById("criticModalBody");
    if (!body) return;
    const upd = diff.updates || [];
    const add = diff.additions || [];
    const updItems = upd.slice(0, 20).map(s => `<li>✏️ 更新：<b>${escapeText(s.title || s.id)}</b></li>`).join("");
    const addItems = add.slice(0, 20).map(s => `<li>➕ 新增：<b>${escapeText(s.title || s.id)}</b></li>`).join("");
    const more = (upd.length + add.length) > 40 ? `<li style="color:var(--text-secondary)">…等共 ${upd.length + add.length} 条</li>` : "";
    body.innerHTML = `
        <p style="margin:0 0 10px;font-size:15px;">🤖 AI 审稿发现 <b>${upd.length + add.length}</b> 处可优化：更新 ${upd.length} 条、新增 ${add.length} 条。采纳后将写入知识库并重算检索向量。</p>
        <ul style="margin:0;padding-left:18px;max-height:46vh;overflow:auto;line-height:1.9;">${updItems}${addItems}${more}</ul>
        <p style="margin:10px 0 0;font-size:12px;color:var(--text-secondary);">审稿仅基于当前知识库自动推断，采纳前请留意是否误改你刻意保留的设定。</p>`;
}

function escapeText(t) {
    return String(t || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// 采纳修订：写回 world.lore_kb（并同步当前激活库），重算向量，存盘。
export async function confirmCriticRevision() {
    const world = (S.worlds || []).find(w => w.id === S._criticWorldId);
    if (!world || !S._criticBuffer) { closeModal("criticModal"); return; }
    const candidateKB = deepClone(world.lore_kb);
    candidateKB.snippets = applyLoreRevisionDiff(candidateKB.snippets, S._criticBuffer);
    try { await ensureLoreEmbeddings(candidateKB); }
    catch (e) { console.warn("审稿后向量重算失败，降级为关键词检索：", e && e.message); }
    world.lore_kb = candidateKB;
    if (S.currentWorld && S.currentWorld.id === world.id && S.activeLoreKB) S.activeLoreKB = candidateKB;
    saveWorlds();
    S._criticBuffer = null;
    S._criticWorldId = null;
    closeModal("criticModal");
    closeModal("loreReviewModal"); // 自动审稿可能盖在知识库初览之上，采纳后一并关闭
    showToast("🤖 已采纳审稿修订，知识库已更新", "success");
}

// 忽略修订：丢弃缓冲。
export function rejectCriticRevision() {
    S._criticBuffer = null;
    S._criticWorldId = null;
    closeModal("criticModal");
    showToast("已忽略本次审稿建议", "success");
}
