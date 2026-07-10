// ============================================================
// AetherNarrator · render.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";

import { createElementFromHTML, escapeHtml, escapeRegExp, getAttributeLabel, getWorldSchema } from "./utils.js";
import { getPeriodLabel, getTimeConfig, updateFontSizeButtons, updateTempLabel } from "./theme.js";
import { abortCurrentRequest, chooseOption, confirmRestart, continueLatestSave, deleteSave, deleteWorld, loadSave, startGame } from "./game.js";

export function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

export function setBackgroundInert(on) {
    document.querySelectorAll(".screen").forEach(s => {
        if (on) s.setAttribute("inert", ""); else s.removeAttribute("inert");
    });
}

export function showModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    S.lastFocusedBeforeModal = document.activeElement;
    el.classList.add("show");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    setBackgroundInert(true);
    // 焦点移入模态内第一个可聚焦元素
    const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusable || el).focus();
}

export function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("show");
    el.removeAttribute("role");
    el.removeAttribute("aria-modal");
    setBackgroundInert(false);
    if (S.lastFocusedBeforeModal && typeof S.lastFocusedBeforeModal.focus === "function") {
        S.lastFocusedBeforeModal.focus();
    }
    S.lastFocusedBeforeModal = null;
}

export function showApiModal() {
    showModal("apiModal");
}

export function showSettingsModal() {
    showModal("settingsModal");
    updateFontSizeButtons();
    document.getElementById("temperatureSlider").value = S.temperatureSetting;
    updateTempLabel();
}

export function showCreateWorldModal() {
    showModal("createWorldModal");
}

export function onWorldTypeChange(value) {
    const ipNameField = document.getElementById("ipNameField");
    const worldDescHint = document.getElementById("worldDescHint");
    const worldDescTextarea = document.getElementById("worldDesc");
    if (value === "ip") {
        ipNameField.classList.add("show");
        worldDescHint.innerHTML = "你可以直接使用原作的世界观描述，也可以在此基础上进行修改和扩展——例如调整力量体系、加入新势力、改变时间线等。描述越详细，AI 生成的剧情越贴合你的构想。";
        worldDescTextarea.placeholder = "可以直接填写原作的世界观概述，也可以在此基础上修改...\n例如：在原著的世界观基础上，增加了一个隐秘的地下组织...";
        // 若描述为空，自动填入"原作世界观"
        if (!worldDescTextarea.value.trim()) {
            worldDescTextarea.value = "原作世界观";
        }
    } else {
        ipNameField.classList.remove("show");
        worldDescHint.innerHTML = "描述越详细，AI 生成的内容越贴近你的预期。";
        worldDescTextarea.placeholder = "描述这个世界的规则、力量体系、主要势力、地点、人物关系等...";
    }
}

export function selectStyleRef(value, el) {
    document.querySelectorAll("#styleRefGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#styleRefGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const customField = document.getElementById("customStyleField");
    if (value === "custom") {
        customField.classList.add("show");
    } else {
        customField.classList.remove("show");
    }
}

export function getSelectedStyleRef() {
    const checked = document.querySelector("input[name='styleRef']:checked");
    return checked ? checked.value : "original";
}

export function updatePlotFreedomLabel(value) {
    const labels = {
        1: "严格遵循原著 — 剧情走向基本不偏离",
        2: "以原著为主 — 偶尔有限发散",
        3: "适中发散 — 在原著世界观内适度创新",
        4: "自由发挥 — 世界观为框架，剧情大胆创新",
        5: "完全自由 — 仅用世界框架，剧情独立发展"
    };
    document.getElementById("plotFreedomLabel").textContent = labels[value] || "";
}

export function toggleCustomPrefix(enabled, el) {
    document.querySelectorAll("#customPrefixGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#customPrefixGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const field = document.getElementById("customPrefixField");
    if (enabled) {
        field.classList.add("show");
    } else {
        field.classList.remove("show");
    }
}

export function toggleWorldPrefix(enabled, el) {
    document.querySelectorAll("#worldPrefixGroup .radio-option").forEach(o => o.classList.remove("selected"));
    document.querySelectorAll("#worldPrefixGroup input[type=radio]").forEach(r => r.checked = false);
    el.classList.add("selected");
    el.querySelector("input[type=radio]").checked = true;
    const field = document.getElementById("worldPrefixField");
    if (enabled) {
        field.classList.add("show");
    } else {
        field.classList.remove("show");
    }
}

export function renderWorldList() {
    const container = document.getElementById("worldListContent");
    if (!S.worlds.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="text">还没有世界<br>点击上方按钮创建一个吧</div>
            </div>`;
        return;
    }
    // 按创建时间降序排列（最新的在最上面）
    const sorted = [...S.worlds].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const now = Date.now();
    const newThreshold = 24 * 60 * 60 * 1000;

    // 只给最新创建且 24 小时内的世界加「新」徽章
    let newestTime = 0;
    if (sorted.length > 0) newestTime = new Date(sorted[0].createdAt).getTime();
    const newestId = (now - newestTime) < newThreshold ? sorted[0].id : null;

    container.innerHTML = sorted.map((w, i) => {
        const isNew = w.id === newestId;
        const delay = i * 0.07; // 依次延迟 0/0.07/0.14/... 秒
        return `
        <div class="list-item world-list-item${isNew ? " new-world" : ""}" data-action="showWorldDetail" data-id="${w.id}" tabindex="0" role="button" aria-label="打开世界：${escapeHtml(w.name)}" style="animation: fadeSlideIn 0.4s ease-out ${delay}s both;">
            <div class="item-title">${escapeHtml(w.name)}${isNew ? '<span class="new-badge">新</span>' : ""}</div>
            <div class="item-meta">${escapeHtml(w.desc)}</div>
            <div class="item-tags">
                ${w.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
                <span class="tag accent">${w.type === "ip" ? "已有 IP" : "原创"}</span>
            </div>
            <button class="delete-world-btn" data-action="deleteWorld" data-id="${w.id}">删除</button>
        </div>
    `}).join("");
}

export function renderSaveList() {
    const container = document.getElementById("saveListContent");
    if (!S.saves.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="text">还没有存档<br>进入世界开始游玩后自动生成</div>
            </div>`;
        return;
    }
    container.innerHTML = S.saves.map(s => {
        const isDead = s.state && s.state.is_alive === false;
        return `
        <div class="list-item save-item${isDead ? " dead-save" : ""}">
            <div class="save-info">
                <div class="item-title">${escapeHtml(s.worldName)}${isDead ? ' <span class="dead-badge">&#x2620; 已死亡</span>' : ""}</div>
                <div class="item-meta">${escapeHtml(s.progress)}<br>最后游玩：${escapeHtml(s.updatedAt)}</div>
            </div>
            <div class="save-actions">
                <button class="save-play-btn" data-action="loadSave" data-id="${s.id}">继续游玩</button>
                <button class="save-del-btn" data-action="deleteSave" data-id="${s.id}">删除</button>
            </div>
        </div>
    `}).join("");
}

export function showWorldDetail(worldId) {
    abortCurrentRequest();
    S.currentWorld = S.worlds.find(w => w.id === worldId);
    if (!S.currentWorld) return;
    document.getElementById("detailWorldTitle").textContent = S.currentWorld.name;
    const schema = getWorldSchema(S.currentWorld);
    document.getElementById("detailWorldBody").innerHTML = `
        <div class="form-group">
            <label>世界类型</label>
            <p style="margin:0;font-size:15px;">${S.currentWorld.type === "ip" ? "基于已有 IP / 小说" : "原创世界观"}</p>
        </div>
        ${S.currentWorld.ip_name ? `
        <div class="form-group">
            <label>作品名称</label>
            <p style="margin:0;font-size:15px;color:var(--primary);">${escapeHtml(S.currentWorld.ip_name)}</p>
        </div>` : ""}
        <div class="form-group">
            <label>世界观描述</label>
            <p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(S.currentWorld.desc)}</p>
        </div>
        ${S.currentWorld.hero ? `
        <div class="form-group">
            <label>主角设定</label>
            <p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(S.currentWorld.hero)}</p>
        </div>` : ""}
        <div class="form-group">
            <label>进度系统</label>
            <p style="margin:0;font-size:14px;color:var(--text-secondary);">${escapeHtml(schema.progression_path_label)} / ${escapeHtml(schema.progression_label)}</p>
        </div>
        <div class="form-group">
            <label>创建时间</label>
            <p style="margin:0;font-size:14px;color:var(--text-secondary);">${S.currentWorld.createdAt}</p>
        </div>
        ${S.currentWorld.opening_narrative ? `
        <div class="form-group">
            <label>开场白预览</label>
            <p style="margin:0;font-size:14px;line-height:1.8;color:var(--text-secondary);white-space:pre-line;">${escapeHtml(S.currentWorld.opening_narrative.slice(0, 200))}${S.currentWorld.opening_narrative.length > 200 ? "..." : ""}</p>
        </div>` : ""}
        ${S.currentWorld.style_ref ? `
        <div class="form-group">
            <label>文风参考</label>
            <p style="margin:0;font-size:14px;color:var(--text-secondary);">${S.currentWorld.style_ref === "original" ? "参考原版文风" : S.currentWorld.style_ref === "custom" ? "自定义文风：" + escapeHtml(S.currentWorld.custom_style || "未填写") : "不参考文风"}</p>
        </div>` : ""}
        ${S.currentWorld.plot_freedom ? `
        <div class="form-group">
            <label>剧情自由度</label>
            <p style="margin:0;font-size:14px;color:var(--text-secondary);">${["", "严格遵循原著", "以原著为主", "适中发散", "自由发挥", "完全自由"][S.currentWorld.plot_freedom] || "适中发散"}</p>
        </div>` : ""}
        ${S.currentWorld.custom_prefix ? `
        <div class="form-group">
            <label>特殊要求</label>
            <p style="margin:0;font-size:14px;line-height:1.6;color:var(--text-secondary);">${escapeHtml(S.currentWorld.custom_prefix)}</p>
        </div>` : ""}
        ${S.currentWorld.source_content ? `
        <div class="form-group">
            <label>源文件</label>
            <p style="margin:0;font-size:14px;color:var(--text-secondary);">已上传（${Math.ceil(S.currentWorld.source_content.length / 1024)} KB）</p>
        </div>` : ""}
    `;

    // ★ P0: 区分新游戏 / 继续，避免静默覆盖存档
    const hasSave = S.saves.some(s => s.worldId === S.currentWorld.id);
    const footer = document.getElementById("detailModalFooter");
    if (hasSave) {
        footer.innerHTML = `
            <button class="btn secondary" data-action="closeModal" data-modal="worldDetailModal">返回</button>
            <button class="btn" data-action="continueLatestSave" data-id="${S.currentWorld.id}">继续游戏</button>
            <button class="btn primary" data-action="confirmRestart" data-id="${S.currentWorld.id}">重新开始</button>`;
    } else {
        footer.innerHTML = `
            <button class="btn secondary" data-action="closeModal" data-modal="worldDetailModal">返回</button>
            <button class="btn primary" data-action="startGame" data-opts='{"resetBehavior":true}'>开始游玩</button>`;
    }

    showModal("worldDetailModal");
}

export function showStatusPanel() {
    S.currentStatusTab = "profile";
    renderStatusTabs();
    renderStatusPanel(S.currentStatusTab);
    document.getElementById("statusPanelOverlay").classList.add("show");
}

export function hideStatusPanel() {
    document.getElementById("statusPanelOverlay").classList.remove("show");
}

export function closeStatusPanel() {
    hideStatusPanel();
}

export function renderStatusTabs() {
    const schema = getWorldSchema(S.currentWorld);
    const tabs = [
        { key: "profile", label: "属性" },
        { key: "background", label: "背景" },
        { key: "state", label: "状态" },
        { key: "relations", label: "关系" },
        { key: "items", label: "物品" }
    ];
    if (schema.has_skills) {
        tabs.push({ key: "skills", label: schema.skill_label || "技能" });
    }
    tabs.push({ key: "goals", label: "目标" });

    document.getElementById("statusTabs").innerHTML = tabs.map(t => `
        <button class="status-tab ${S.currentStatusTab === t.key ? "active" : ""}" data-action="switchStatusTab" data-key="${t.key}">${t.label}</button>
    `).join("");
}

export function switchStatusTab(tab) {
    S.currentStatusTab = tab;
    renderStatusTabs();
    renderStatusPanel(tab);
}

export function renderTextAttribute(label, value) {
    const text = renderTextValue(value);
    return `
        <div class="row" style="align-items:flex-start;"><span class="label">${label}</span></div>
        <div class="text-block" style="margin-bottom:10px;">${text}</div>
    `;
}

export function renderTextValue(value) {
    if (typeof value === "string") return escapeHtml(value);
    if (typeof value === "number") return `数值 ${value}（旧版兼容）`;
    if (value && typeof value === "object") {
        if (value.description) return escapeHtml(value.description);
        return escapeHtml(JSON.stringify(value));
    }
    return "暂无描述";
}

export function renderStatusPanel(tab) {
    const container = document.getElementById("statusContent");
    if (!S.gameState) {
        container.innerHTML = '<div class="empty-hint">暂无角色数据</div>';
        return;
    }
    const s = S.gameState;
    const schema = getWorldSchema(S.currentWorld);

    switch (tab) {
        case "profile":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">基本信息</div>
                    <div class="status-card">
                        <div class="row"><span class="label">姓名</span><span class="value">${escapeHtml(s.name)}</span></div>
                        <div class="row"><span class="label">年龄</span><span class="value">${s.age}</span></div>
                        <div class="row"><span class="label">当前地点</span><span class="value">${escapeHtml(s.current_location)}</span></div>
                        <div class="row"><span class="label">时间</span><span class="value">第 ${s.current_date.day} 天 · ${escapeHtml(getPeriodLabel(s.current_date.period))}</span></div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">属性</div>
                    <div class="status-card">
                        ${Object.entries(s.attributes).map(([k, v]) => renderTextAttribute(getAttributeLabel(k), v)).join("")}
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">${escapeHtml(schema.progression_label || "进度")}</div>
                    <div class="status-card">
                        <div class="row"><span class="label">${escapeHtml(schema.progression_path_label || "路线")}</span><span class="value">${escapeHtml(s.progression.path)}</span></div>
                        <div class="row"><span class="label">${escapeHtml(schema.progression_label || "等级")}</span><span class="value">${escapeHtml(s.progression.rank)}</span></div>
                        <div class="row"><span class="label">进度</span><span class="value">${s.progression.progress}</span></div>
                        <div class="stat-bar"><div style="width:${Math.min(s.progression.progress, 100)}%"></div></div>
                    </div>
                </div>
            `;
            break;

        case "background":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">出身背景</div>
                    <div class="status-card text-block">${escapeHtml(s.background)}</div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">性格</div>
                    <div class="status-card">
                        <div class="status-tag-list">
                            ${(s.personality || []).map(p => `<span class="status-tag">${escapeHtml(p)}</span>`).join("") || '<span class="empty-hint" style="padding:0">未设置</span>'}
                        </div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">已完成事件</div>
                    <div class="status-card">
                        <div class="status-tag-list">
                            ${s.completed_events.length ? s.completed_events.map(e => `<span class="status-tag">${escapeHtml(e)}</span>`).join("") : '<span class="empty-hint" style="padding:0">暂无</span>'}
                        </div>
                    </div>
                </div>
            `;
            break;

        case "state":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">当前状态</div>
                    <div class="status-card">
                        <div class="row"><span class="label">地点</span><span class="value">${escapeHtml(s.current_location)}</span></div>
                        <div class="row"><span class="label">时间</span><span class="value">第 ${s.current_date.day} 天 · ${escapeHtml(getPeriodLabel(s.current_date.period))}</span></div>
                        <div class="row"><span class="label">${escapeHtml(schema.progression_label || "等级")}</span><span class="value">${escapeHtml(s.progression.rank)}</span></div>
                    </div>
                </div>
                <div class="status-section">
                    <div class="status-section-title">临时状态</div>
                    <div class="status-card">
                        ${(s.status_effects && s.status_effects.length) ? s.status_effects.map(e => `<div class="row"><span class="label">${escapeHtml(e.name)}</span><span class="value">${escapeHtml(e.desc)}</span></div>`).join("") : '<div class="empty-hint">无临时状态</div>'}
                    </div>
                </div>
            `;
            break;

        case "relations":
            const relEntries = Object.entries(s.relationships);
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">人物关系</div>
                    ${relEntries.length ? relEntries.map(([name, value]) => `
                        <div class="status-card">
                            <div class="row"><span class="label">${escapeHtml(name)}</span></div>
                            <div class="text-block">${renderTextValue(value)}</div>
                        </div>
                    `).join("") : '<div class="empty-hint">暂无人物关系</div>'}
                </div>
            `;
            break;

        case "items":
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">背包物品</div>
                    ${s.inventory.length ? s.inventory.map(i => `
                        <div class="status-card">
                            <div class="row">
                                <span class="label">${escapeHtml(i.name)}</span>
                                <span class="value">x${i.count}</span>
                            </div>
                        </div>
                    `).join("") : '<div class="empty-hint">背包空空如也</div>'}
                </div>
            `;
            break;

        case "skills":
            const skillEntries = Object.entries(s.skills || {});
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">已掌握${escapeHtml(schema.skill_label || "技能")}</div>
                    ${skillEntries.length ? skillEntries.map(([name, value]) => `
                        <div class="status-card">
                            <div class="row"><span class="label">${escapeHtml(name)}</span></div>
                            <div class="text-block">${renderTextValue(value)}</div>
                        </div>
                    `).join("") : '<div class="empty-hint">尚未掌握' + (schema.skill_label || "技能") + '</div>'}
                </div>
            `;
            break;

        case "goals": {
            // ★ P2.2.12: 仅渲染 visible !== false 的目标（AI 可在 state_changes 中设 visible:false 隐藏未解锁目标）
            const visibleGoals = s.goals.filter(g => g.visible !== false);
            container.innerHTML = `
                <div class="status-section">
                    <div class="status-section-title">当前目标</div>
                    ${visibleGoals.length ? visibleGoals.map(g => {
                        let cls = "";
                        if (g.status === "completed") cls = "completed";
                        else if (g.status === "failed") cls = "failed";
                        const deadline = g.deadline ? `截止：第${g.deadline.day}天 ${escapeHtml(getPeriodLabel(g.deadline.period))}` : "无期限";
                        return `<div class="goal-item ${cls}"><strong>${escapeHtml(g.name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(g.type)} · ${deadline}</span></div>`;
                    }).join("") : '<div class="empty-hint">暂无目标</div>'}
                </div>
            `;
            break;
        }
    }
}

export function updateGameDayInfo() {
    if (!S.gameState) return;
    const tc = getTimeConfig();
    if (tc.mode === "hidden") {
        document.getElementById("gameDayInfo").textContent = S.gameState.current_location || "";
        return;
    }
    if (tc.mode === "continuous") {
        document.getElementById("gameDayInfo").textContent = S.gameState.current_date.period || "";
        return;
    }
    document.getElementById("gameDayInfo").textContent = `第 ${S.gameState.current_date.day} 天 · ${getPeriodLabel(S.gameState.current_date.period)}`;
}

export function highlightItems(text) {
    if (!S.gameState || !S.gameState.inventory.length) return text;
    const names = S.gameState.inventory.map(i => i.name).filter(n => n);
    if (!names.length) return text;
    // 按名称长度降序，避免短名先替换导致长名无法匹配
    names.sort((a, b) => b.length - a.length);
    let html = escapeHtml(text);
    for (const name of names) {
        const regex = new RegExp(escapeRegExp(escapeHtml(name)), "g"); // 先 HTML 转义以匹配已转义文本，再转义正则元字符
        html = html.replace(regex, `<span class="item-highlight">${escapeHtml(name)}</span>`);
    }
    return html;
}

export function renderLog(reset) {
    const log = document.getElementById("gameLog");
    if (reset) { S.renderedEntryCount = 0; log.innerHTML = '<div class="choices-row in-log" id="choicesArea"></div>'; }

    // 只追加新增的条目
    for (let i = S.renderedEntryCount; i < S.conversationHistory.length; i++) {
        const entry = S.conversationHistory[i];
        const warningClass = entry.isWarning ? " warning" : "";
        const metaLabel = entry.isWarning
            ? "系统提示"
            : (entry.player ? "你" : "开场");
        const html = `
        <div class="log-entry${warningClass}">
            <div class="meta">
                <span>${metaLabel} · 第${entry.day}天 ${getPeriodLabel(entry.period)}</span>
            </div>
            ${entry.player ? `<div class="player-text">${escapeHtml(entry.player)}</div>` : ""}
            <div class="narrative">${entry.isWarning ? escapeHtml(entry.narrative) : highlightItems(entry.narrative)}</div>
        </div>
        `;
        log.insertBefore(createElementFromHTML(html), document.getElementById("choicesArea"));
    }
    S.renderedEntryCount = S.conversationHistory.length;
    log.scrollTop = log.scrollHeight;
}

export function startTypewriter(index) {
    stopTypewriter();
    const log = document.getElementById("gameLog");
    const entries = log.querySelectorAll(".log-entry");
    const entry = entries[index];
    if (!entry) return Promise.resolve();
    const narrativeEl = entry.querySelector(".narrative");
    const data = S.conversationHistory[index];
    const fullText = data.narrative || "";
    if (!fullText) return Promise.resolve();

    // ★ P3.2.17: 尊重 prefers-reduced-motion — 直接出全文，跳过逐字动画
    const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
        narrativeEl.innerHTML = "";
        narrativeEl.textContent = fullText;
        S.typingIndex = index;
        return new Promise(resolve => { S.typingResolver = resolve; finishTyping(); });
    }

    // 清空容器，进入打字状态
    narrativeEl.innerHTML = "";
    narrativeEl.classList.add("typing");
    log.classList.add("typing-active");
    S.typingIndex = index;

    return new Promise(resolve => {
        S.typingResolver = resolve;
        const chars = Array.from(fullText);  // Array.from 正确处理 emoji / 代理对
        let i = 0;

        function typeNext() {
            if (i >= chars.length) {
                finishTyping();
                return;
            }
            const ch = chars[i];
            // 打字过程中用纯文本（避免高亮在物品名被截断时闪烁）
            narrativeEl.textContent = chars.slice(0, i + 1).join("");
            i++;
            log.scrollTop = log.scrollHeight;

            // 标点处停顿，更接近阅读节奏
            let delay = 28;
            if ("。！？…".includes(ch)) delay = 170;
            else if ("，、；：".includes(ch)) delay = 85;
            else if (ch === "\n") delay = 110;
            else if (ch === "「" || ch === "」" || ch === '"' ) delay = 50;
            S.typingTimer = setTimeout(typeNext, delay);
        }
        typeNext();
    });
}

export function finishTyping() {
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
    if (S.typingIndex >= 0 && S.conversationHistory[S.typingIndex]) {
        const log = document.getElementById("gameLog");
        const entries = log.querySelectorAll(".log-entry");
        const entry = entries[S.typingIndex];
        if (entry) {
            const narrativeEl = entry.querySelector(".narrative");
            const data = S.conversationHistory[S.typingIndex];
            const fullText = data.narrative || "";
            // 完成后替换为带物品高亮的 HTML
            narrativeEl.innerHTML = data.isWarning ? escapeHtml(fullText) : highlightItems(fullText);
            narrativeEl.classList.remove("typing");
        }
        log.classList.remove("typing-active");
    }
    S.typingIndex = -1;
    if (S.typingResolver) {
        const r = S.typingResolver;
        S.typingResolver = null;
        r();
    }
}

export function skipTypewriter() {
    if (S.typingIndex >= 0) finishTyping();
}

export function stopTypewriter() {
    if (S.typingTimer) { clearTimeout(S.typingTimer); S.typingTimer = null; }
    if (S.typingIndex >= 0) {
        const log = document.getElementById("gameLog");
        const entries = log.querySelectorAll(".log-entry");
        const entry = entries[S.typingIndex];
        if (entry) entry.querySelector(".narrative")?.classList.remove("typing");
        log.classList.remove("typing-active");
    }
    S.typingIndex = -1;
    S.typingResolver = null;
}

export function renderChoices(choices) {
    S.currentChoices = choices || [];
    const area = document.getElementById("choicesArea");
    if (!choices || choices.length === 0) {
        area.innerHTML = "";
        return;
    }
    area.innerHTML = choices.map((c, i) => `<button class="choice-chip" data-action="chooseOption" data-index="${i}">${escapeHtml(c.text)}</button>`).join("");
}

export function checkDeathBanner() {
    if (!S.gameState || S.gameState.is_alive !== false) {
        document.getElementById("deathBanner").classList.add("hidden");
        return;
    }
    const reason = S.gameState.death_reason || "你的旅程到此为止。";
    document.getElementById("deathBannerText").textContent = "角色已死亡 — " + reason;
    document.getElementById("deathBanner").classList.remove("hidden");
}

export function updateInputState() {
    const inputEl = document.getElementById("playerInput");
    const sendBtn = document.querySelector(".send-btn");
    const isDead = S.gameState && S.gameState.is_alive === false;
    if (inputEl) {
        inputEl.disabled = isDead;
        inputEl.placeholder = isDead ? "角色已死亡，仅供回顾..." : "输入你想做的事...";
    }
    if (sendBtn) sendBtn.disabled = isDead;
}

export function restoreLastChoices() {
    if (!S.conversationHistory.length) {
        // 新游戏，用世界初始选项
        if (S.currentWorld && S.currentWorld.initial_choices && S.currentWorld.initial_choices.length) {
            S.currentChoices = S.currentWorld.initial_choices;
            renderChoices(S.currentChoices);
        }
        return;
    }
    // 倒序找最后一条有 choices 的记录
    for (let i = S.conversationHistory.length - 1; i >= 0; i--) {
        const entry = S.conversationHistory[i];
        if (entry.choices && entry.choices.length) {
            S.currentChoices = entry.choices;
            renderChoices(S.currentChoices);
            return;
        }
    }
    // 没找到，检查初始选项
    if (S.currentWorld && S.currentWorld.initial_choices && S.currentWorld.initial_choices.length) {
        S.currentChoices = S.currentWorld.initial_choices;
        renderChoices(S.currentChoices);
    }
}

export function showGameOver() {
    const reason = S.gameState && S.gameState.death_reason ? S.gameState.death_reason : "你的旅程到此为止。";
    document.getElementById("gameOverReason").textContent = reason;
    document.getElementById("gameOverOverlay").classList.add("show");
}

export function showToast(msg, type = "", duration = 2000) {
    const el = document.getElementById("toast");
    if (S.toastTimer) clearTimeout(S.toastTimer);
    el.textContent = msg;
    el.className = "toast show " + type;
    S.toastTimer = setTimeout(() => {
        el.classList.remove("show");
        S.toastTimer = null;
    }, duration);
}

export function showLoading(msg) {
    const el = document.getElementById("loadingIndicator");
    if (!el) return;
    S.loadingStartTime = Date.now();
    el.querySelector(".loading-text").textContent = msg;
    el.querySelector(".loading-time").textContent = "0.0s";
    el.classList.add("show");
    S.loadingInterval = setInterval(() => {
        const elapsed = ((Date.now() - S.loadingStartTime) / 1000).toFixed(1);
        el.querySelector(".loading-time").textContent = elapsed + "s";
    }, 200);
}

export function updateLoadingProgress(charCount) {
    const el = document.getElementById("loadingIndicator");
    if (!el || !el.classList.contains("show")) return;
    const elapsed = ((Date.now() - S.loadingStartTime) / 1000).toFixed(1);
    const kChars = charCount > 1000 ? (charCount / 1000).toFixed(1) + "K" : charCount;
    el.querySelector(".loading-text").textContent = "已接收 " + kChars + " 字符...";
    el.querySelector(".loading-time").textContent = elapsed + "s";
}

export function hideLoading() {
    const el = document.getElementById("loadingIndicator");
    if (!el) return;
    el.classList.remove("show");
    if (S.loadingInterval) { clearInterval(S.loadingInterval); S.loadingInterval = null; }
}

export function updateCacheIndicator() {
    const el = document.getElementById("cacheIndicator");
    if (!el || !S.lastCacheStats.totalTokens) {
        if (el) el.classList.add("hidden");
        return;
    }
    el.classList.remove("hidden");
    const rate = parseFloat(S.lastCacheStats.hitRate);
    let cls = "bad";
    if (rate >= 70) cls = "good";
    else if (rate >= 35) cls = "warn";
    el.className = "cache-indicator " + cls;
    el.textContent = "命中 " + S.lastCacheStats.hitRate + " (" + S.lastCacheStats.hitTokens + "/" + S.lastCacheStats.totalTokens + "t)";
    el.title = "缓存命中: " + S.lastCacheStats.hitTokens + " tokens | 未命中: " + S.lastCacheStats.missTokens + " tokens";
}
