// ============================================================
// AetherNarrator · lore-graph-ui.js（由 lore-ui.js 拆分：图谱视图）
// 说明：世界观图谱总览（force-graph 优先，手写 canvas 力导向兜底）+ 节点预览卡。
// 依赖方向单向：lore-ui → 本模块。预览卡「✎ 打开完整编辑」需回开 lore-ui 的
// 知识库编辑器，由 lore-ui 模块加载时经 setOpenNodeInKB 回调注入，避免反向 import 成环。
// ============================================================
import { S, LINK_RELATION_LABELS, getWorldLoreKB } from "./store.js";
import { deepClone, escapeHtml } from "./utils.js";
import { showToast } from "./render.js";
import { REL_COLORS, ENTITY_COLOR, buildGraphModel, categoryColor } from "./kg-graph.js";

// 回调注入：由 lore-ui.js 提供（切到知识库视图并聚焦条目）
let openNodeInKB = () => {};
export function setOpenNodeInKB(fn) { openNodeInKB = fn; }

// ★ 图谱视图
export function renderGraphPane() {
    return `
      <div class="lore-graph-pane">
        <div class="lore-graph-tools">
            <button class="btn-icon" data-graph="zoom-in" title="放大">＋</button>
            <button class="btn-icon" data-graph="zoom-out" title="缩小">－</button>
            <button class="btn-icon" data-graph="reset" title="复位视图">⟲</button>
            <span id="graphStats" class="graph-stats"></span>
        </div>
        <div class="lore-graph-canvas-wrap">
            <div id="loreGraph"></div>
            <div id="graphLegend" class="graph-legend"></div>
            <div id="graphInfo" class="graph-info"></div>
            <div id="graphPreview" class="graph-preview" hidden></div>
            <div class="graph-hint">滚轮缩放 · 拖空白平移 · 拖节点移动 · 单击节点查看</div>
        </div>
      </div>`;
}

// ★ C：世界观图谱总览（力导向布局 canvas，布局/绘制分离 + 缩放平移 + 类别着色 + 点击开笔记）
// 颜色：节点按类别着色，边按关系着色（与 store.js 的 LINK_RELATION_LABELS 对齐）
// 注：LORE_CATEGORY_COLORS / FALLBACK_CAT_COLOR / REL_COLORS / ENTITY_COLOR / KG_REL_PALETTE
// 已迁至 src/kg-graph.js（纯函数模块），本文件从那里 import。

let G = null;            // 当前图谱状态（节点/边/视图变换/交互）
let graphUIBound = false;

// ★ 图谱迁入知识库弹窗：在图谱视图下把当前知识库绘制到 pane 内 canvas
export function mountGraphNow() {
    if (S._loreView !== "graph") return; // 已切走则放弃
    const kb = (S.activeLoreKB && Array.isArray(S.activeLoreKB.snippets) && S.activeLoreKB.snippets.length)
        ? S.activeLoreKB
        : getWorldLoreKB();
    const snippets = (kb && kb.snippets) || [];
    const stats = document.getElementById("graphStats");
    if (!snippets.length) {
        if (stats) stats.textContent = "知识库为空，无可绘制条目";
        return;
    }
    bindGraphPreviewDelegate(); // 预览卡按钮委托（force-graph 路径不调 bindGraphUI，需单独绑定）
    const el = document.getElementById("loreGraph");
    if (!el) return;
    // 清理旧实例，避免反复打开图谱时堆叠多个 canvas
    if (S._fg && typeof S._fg._destructor === "function") { try { S._fg._destructor(); } catch (_) {} }
    el.innerHTML = "";

    const FG = window.ForceGraph && (window.ForceGraph.default || window.ForceGraph);
    if (typeof FG !== "function") {
        // 兜底：库未加载时退回手写 canvas 力导向
        if (!document.getElementById("loreGraphCanvas")) {
            const c = document.createElement("canvas");
            c.id = "loreGraphCanvas";
            el.appendChild(c);
        }
        bindGraphUI();
        buildGraph(snippets);
        return;
    }

    const model = buildGraphModel(snippets);
    const nodes = model.nodes;
    const links = [...model.linkEdges, ...model.relEdges];
    buildLegend(nodes, model);
    document.getElementById("graphStats").textContent = `${nodes.length} 节点（含 ${model.entityCount} 实体）· ${model.linkEdges.length} 关联 · ${model.relEdges.length} 关系`;
    const infoEl = document.getElementById("graphInfo");
    if (infoEl) infoEl.textContent = "";

    const wrap = el.parentElement;
    const W = wrap.clientWidth || 680, H = wrap.clientHeight || 460;
    const Graph = FG()(el)
        .graphData({ nodes, links })
        .nodeId("id")
        .nodeLabel(d => `【${d.category}】${escapeHtml(d.label)}`)
        .nodeColor("color")
        .nodeVal(d => 1 + Math.min(8, d.degree))
        .nodeRelSize(4)
        // 默认在节点旁绘制常驻标题（不再仅悬停才显示）
        .nodeCanvasObject((node, ctx, globalScale) => {
            const val = 1 + Math.min(8, node.degree || 0);
            const r = Math.sqrt(val) * 4; // 与 nodeRelSize(4) 一致
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            if (node.kind === "entity") {
                ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5 / globalScale;
                ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.stroke(); ctx.setLineDash([]);
            }
            const raw = (node.label || node.id || "");
            const text = raw.length > 12 ? raw.slice(0, 11) + "…" : raw;
            const fontSize = 12 / globalScale; // 屏显字号恒定，不随缩放变小
            ctx.font = fontSize + "px Sans-Serif";
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            const tw = ctx.measureText(text).width;
            const ty = node.y + r + 1 / globalScale;
            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.fillRect(node.x - tw / 2 - 2 / globalScale, ty - 1 / globalScale, tw + 4 / globalScale, fontSize + 2 / globalScale);
            ctx.fillStyle = "#222";
            ctx.fillText(text, node.x, ty);
        })
        .nodePointerAreaPaint((node, color, ctx) => {
            const val = 1 + Math.min(8, node.degree || 0);
            const r = Math.sqrt(val) * 4 + 4; // 命中区略大于视觉圆
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fill();
        })
        .linkColor(d => d.kind === "relation" ? (model.relationColorMap[d.relation] || "#bbb") : (REL_COLORS[d.relation] || "#888"))
        .linkWidth(0.6)
        .linkLineDash(d => d.kind === "relation" ? [4, 2] : [])
        .cooldownTicks(200)
        .onNodeClick(node => { if (node.kind === "entity") focusLoreEntity(node.label); else focusLoreSnippet(node.id); })
        .onNodeHover(node => { if (infoEl) infoEl.textContent = node ? `【${node.category}】${node.label}` : ""; })
        .width(W).height(H);
    Graph.onEngineStop(() => { try { Graph.zoomToFit(400, 40); } catch (_) {} });

    document.querySelectorAll("[data-graph]").forEach(btn => {
        btn.onclick = () => {
            const k = btn.dataset.graph;
            if (k === "zoom-in") Graph.zoom(Graph.zoom() * 1.25);
            else if (k === "zoom-out") Graph.zoom(Graph.zoom() / 1.25);
            else if (k === "reset") { try { Graph.zoomToFit(400, 40); } catch (_) {} }
        };
    });
    S._fg = Graph;
}

function buildGraph(snippets) {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || 680, H = rect.height || 460;
    canvas.width = W * dpr; canvas.height = H * dpr;

    const model = buildGraphModel(snippets);
    const nodes = model.nodes;
    const idIndex = {};
    nodes.forEach((n, i) => idIndex[n.id] = i);
    // 初始环形布局（实体节点也参与，保持与原布局一致的手写兜底体验）
    const baseR = Math.min(W, H) * 0.32;
    nodes.forEach((n, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        n.x = Math.cos(angle) * baseR + (Math.random() - 0.5) * 20;
        n.y = Math.sin(angle) * baseR + (Math.random() - 0.5) * 20;
        n.vx = 0; n.vy = 0;
    });
    const edges = [...model.linkEdges, ...model.relEdges].map(e => ({
        ai: idIndex[e.source], bi: idIndex[e.target], kind: e.kind, relation: e.relation
    }));
    // 邻接表（悬停高亮用）
    const adj = nodes.map(() => new Set());
    edges.forEach(e => { adj[e.ai].add(e.bi); adj[e.bi].add(e.ai); });

    G = {
        canvas, ctx: canvas.getContext("2d"), dpr, W, H,
        cx: W / 2, cy: H / 2,
        nodes, edges, adj, idIndex, relationColorMap: model.relationColorMap,
        view: { scale: 1, offsetX: 0, offsetY: 0 },
        hover: null, dragNode: null, panning: false,
        grabWX: 0, grabWY: 0, downX: 0, downY: 0, moved: false,
        running: true, rafId: null, tick: 0, MAX_TICK: 360
    };
    buildLegend(nodes, model);
    document.getElementById("graphStats").textContent = `${nodes.length} 节点（含 ${model.entityCount} 实体）· ${model.linkEdges.length} 关联 · ${model.relEdges.length} 关系`;
    document.getElementById("graphInfo").textContent = "";
    startSim();
}

function buildLegend(nodes, model) {
    const cats = {};
    nodes.forEach(n => { cats[n.category] = n.color; });
    const catHtml = Object.entries(cats).map(([c, col]) =>
        `<span class="legend-item"><i class="legend-dot" style="background:${col}"></i>${escapeHtml(c)}</span>`).join("");
    const linkRelHtml = Object.entries(REL_COLORS).map(([r, col]) =>
        `<span class="legend-item"><i class="legend-line" style="background:${col}"></i>${LINK_RELATION_LABELS[r] || r}</span>`).join("");
    const relMap = (model && model.relationColorMap) || {};
    const kgRelHtml = Object.entries(relMap).map(([r, col]) =>
        `<span class="legend-item"><i class="legend-line" style="background:repeating-linear-gradient(90deg, ${col} 0 4px, transparent 4px 8px)"></i>${escapeHtml(r)}</span>`).join("");
    const groups = [`<div class="legend-group">${catHtml}</div>`];
    if (linkRelHtml) groups.push(`<div class="legend-group"><span class="legend-title">链接</span>${linkRelHtml}</div>`);
    if (kgRelHtml) groups.push(`<div class="legend-group"><span class="legend-title">抽取关系</span>${kgRelHtml}</div>`);
    const el = document.getElementById("graphLegend");
    if (el) el.innerHTML = groups.join("");
}

// 力导向：每帧只 tick 一次，跑完即停（不再同步 200 帧、不再拖拽重跑）
function startSim() {
    const step = () => {
        if (!G || !document.getElementById("loreReviewModal")?.classList.contains("open") || S._loreView !== "graph") { if (G) G.running = false; return; }
        simulateStep();
        drawGraph();
        G.tick++;
        if (G.tick < G.MAX_TICK) { G.rafId = requestAnimationFrame(step); }
        else { G.running = false; }
    };
    G.rafId = requestAnimationFrame(step);
}

function simulateStep() {
    const { nodes, edges } = G;
    const REPULSE = 2600, SPRING_LEN = 95, SPRING_K = 0.015, CENTER = 0.003, DAMP = 0.86;
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            let dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
            let d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
            let f = REPULSE / d2;
            let fx = dx / d * f, fy = dy / d * f;
            nodes[i].vx -= fx; nodes[i].vy -= fy; nodes[j].vx += fx; nodes[j].vy += fy;
        }
    }
    for (const e of edges) {
        const u = nodes[e.ai], v = nodes[e.bi];
        let dx = v.x - u.x, dy = v.y - u.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        let f = (d - SPRING_LEN) * SPRING_K;
        let fx = dx / d * f, fy = dy / d * f;
        u.vx += fx; u.vy += fy; v.vx -= fx; v.vy -= fy;
    }
    for (const n of nodes) {
        n.vx += (0 - n.x) * CENTER; n.vy += (0 - n.y) * CENTER;
        n.vx *= DAMP; n.vy *= DAMP; n.x += n.vx; n.y += n.vy;
    }
}

function screenToWorld(mx, my) {
    return { x: (mx - G.cx - G.view.offsetX) / G.view.scale, y: (my - G.cy - G.view.offsetY) / G.view.scale };
}
function nodeScreen(n) {
    return { x: G.cx + G.view.offsetX + n.x * G.view.scale, y: G.cy + G.view.offsetY + n.y * G.view.scale };
}
function nodeAt(mx, my) {
    for (let i = G.nodes.length - 1; i >= 0; i--) {
        const s = nodeScreen(G.nodes[i]);
        if (Math.hypot(s.x - mx, s.y - my) < 16) return G.nodes[i];
    }
    return null;
}

function drawGraph() {
    if (!G) return;
    const { ctx, dpr, W, H, view } = G;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(G.cx + view.offsetX, G.cy + view.offsetY);
    ctx.scale(view.scale, view.scale);

    const hoverId = G.hover ? G.hover.id : null;
    const neighbors = hoverId != null ? G.adj[G.idIndex[hoverId]] : null;

    // 边
    for (const e of G.edges) {
        const u = G.nodes[e.ai], v = G.nodes[e.bi];
        const active = hoverId != null && (u.id === hoverId || v.id === hoverId);
        const isRel = e.kind === "relation";
        ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y);
        ctx.strokeStyle = isRel ? ((G.relationColorMap && G.relationColorMap[e.relation]) || "#bbb") : (REL_COLORS[e.relation] || "#888");
        ctx.globalAlpha = hoverId == null ? (isRel ? 0.5 : 0.55) : (active ? 0.95 : 0.12);
        ctx.lineWidth = active ? 2 : 1;
        ctx.setLineDash(isRel ? [4, 2] : []);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // 节点
    for (const n of G.nodes) {
        const isHover = n.id === hoverId;
        const isNeighbor = neighbors && neighbors.has(G.idIndex[n.id]);
        const r = 7 + Math.min(6, n.degree * 0.8);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.globalAlpha = hoverId == null ? 1 : (isHover || isNeighbor ? 1 : 0.35);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isHover) { ctx.lineWidth = 2.5; ctx.strokeStyle = "#fff"; ctx.stroke(); }
        if (n.kind === "entity") { ctx.setLineDash([3, 2]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.stroke(); ctx.setLineDash([]); }
        // 标签：放大或悬停/邻居时显示
        if (view.scale > 0.55 || isHover || isNeighbor) {
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--text") || "#222";
            ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
            const label = n.label.length > 10 ? n.label.slice(0, 9) + "…" : n.label;
            ctx.fillText(label, n.x, n.y + r + 2);
        }
    }
    ctx.restore();
}

function bindGraphPreviewDelegate() {
    if (bindGraphPreviewDelegate._bound) return;
    bindGraphPreviewDelegate._bound = true;
    document.addEventListener("click", e => {
        const closeBtn = e.target.closest("[data-graph-close]");
        if (closeBtn) { const pc = document.getElementById("graphPreview"); if (pc) pc.hidden = true; return; }
        const openBtn = e.target.closest("[data-graph-open]");
        if (openBtn) { openNodeInKB(openBtn.dataset.graphOpen); }
    });
}

function bindGraphUI() {
    const canvas = document.getElementById("loreGraphCanvas");
    if (!canvas) return;

    canvas.addEventListener("mousedown", e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        G.downX = mx; G.downY = my; G.moved = false;
        const n = nodeAt(mx, my);
        if (n) {
            G.dragNode = n;
            const w = screenToWorld(mx, my);
            G.grabWX = n.x - w.x; G.grabWY = n.y - w.y;
        } else { G.panning = true; const pc = document.getElementById("graphPreview"); if (pc) pc.hidden = true; }
    });

    canvas.addEventListener("mousemove", e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (G.dragNode) {
            const w = screenToWorld(mx, my);
            G.dragNode.x = w.x + G.grabWX; G.dragNode.y = w.y + G.grabWY;
            G.moved = true; drawGraph();
        } else if (G.panning) {
            G.view.offsetX += mx - G.downX; G.view.offsetY += my - G.downY;
            G.downX = mx; G.downY = my; G.moved = true; drawGraph();
        } else {
            const n = nodeAt(mx, my);
            if (n !== G.hover) {
                G.hover = n;
                document.getElementById("graphInfo").textContent = n ? `【${n.category}】${n.label}` : "";
                drawGraph();
                canvas.style.cursor = n ? "pointer" : "grab";
            }
        }
    });

    const endDrag = e => {
        if (!G) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const dist = Math.hypot(mx - G.downX, my - G.downY);
        if (G.dragNode && !G.moved && dist < 5) { if (G.dragNode.kind === "entity") focusLoreEntity(G.dragNode.label); else focusLoreSnippet(G.dragNode.id); } // 单击节点：实体看只读卡，片段开笔记
        G.dragNode = null; G.panning = false; canvas.style.cursor = "grab";
    };
    canvas.addEventListener("mouseup", endDrag);
    canvas.addEventListener("mouseleave", () => { if (G) { G.dragNode = null; G.panning = false; } });

    canvas.addEventListener("wheel", e => {
        if (!G) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newScale = Math.max(0.2, Math.min(4, G.view.scale * factor));
        const wx = (mx - G.cx - G.view.offsetX) / G.view.scale;
        const wy = (my - G.cy - G.view.offsetY) / G.view.scale;
        G.view.scale = newScale;
        G.view.offsetX = mx - G.cx - wx * newScale;
        G.view.offsetY = my - G.cy - wy * newScale;
        drawGraph();
    }, { passive: false });

    // 工具按钮：放大/缩小/复位
    document.querySelectorAll("[data-graph]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!G) return;
            const k = btn.dataset.graph;
            if (k === "zoom-in") zoomBy(1.2);
            else if (k === "zoom-out") zoomBy(1 / 1.2);
            else if (k === "reset") { G.view.scale = 1; G.view.offsetX = 0; G.view.offsetY = 0; drawGraph(); }
        });
    });

    // 预览卡交互（document 委托，抽成独立函数，兼容图谱 tab 反复重建）
    bindGraphPreviewDelegate();
}

function zoomBy(factor) {
    const newScale = Math.max(0.2, Math.min(4, G.view.scale * factor));
    const wx = (G.cx - G.cx - G.view.offsetX) / G.view.scale;
    const wy = (G.cy - G.cy - G.view.offsetY) / G.view.scale;
    G.view.scale = newScale;
    G.view.offsetX = G.cx - G.cx - wx * newScale;
    G.view.offsetY = G.cy - G.cy - wy * newScale;
    drawGraph();
}

// 单击节点 → 在图谱内显示轻量预览卡（不切走图谱，视口/缩放完全保留）
function focusLoreSnippet(id) {
    const list = S._loreEdit || [];
    let snippet = list.find(s => s.id === id);
    // 若当前缓冲不含该条目，则载入世界默认知识库
    if (!snippet) {
        const w = S.currentWorld;
        if (!w) { showToast("请先选择世界", "warn"); return; }
        S.activeLoreKB = deepClone(w.lore_kb || { ip: w.name || "", snippets: [] });
        S._loreEditingWorldDefault = true;
        S._loreEdit = deepClone(S.activeLoreKB.snippets);
        snippet = S._loreEdit.find(s => s.id === id);
    }
    if (!snippet) { showToast("该条目不在当前知识库", "warn"); return; }

    const outs = (snippet.links || []).length;
    const backs = (S._loreEdit || []).filter(s => (s.links || []).some(l => l.target === snippet.id)).length;
    const raw = (snippet.content || "").replace(/[#*\[\]\(\)\n>]/g, " ").replace(/\s+/g, " ").trim();
    const summary = raw.slice(0, 200);

    const card = document.getElementById("graphPreview");
    if (!card) return;
    card.innerHTML = `
        <div class="graph-preview-head">
            <span class="graph-preview-cat" style="--c:${categoryColor(snippet.category)}">${escapeHtml(snippet.category || "补充")}</span>
            <span class="graph-preview-title">${escapeHtml(snippet.title || snippet.id)}</span>
            <button class="graph-preview-close" data-graph-close title="收起">×</button>
        </div>
        <div class="graph-preview-summary">${escapeHtml(summary)}${raw.length > 200 ? "…" : ""}</div>
        <div class="graph-preview-foot">
            <span>出链 ${outs} · 入链 ${backs}</span>
            <button class="btn secondary graph-preview-edit" data-graph-open="${escapeHtml(snippet.id)}">✎ 打开完整编辑</button>
        </div>`;
    card.hidden = false;
    const info = document.getElementById("graphInfo");
    if (info) info.style.display = "none";
}


// ★ Phase 4：点击实体节点 → 只读预览卡（实体未收录为独立片段，列出其抽取关系）
function focusLoreEntity(name) {
    const kb = (S.activeLoreKB && Array.isArray(S.activeLoreKB.snippets) && S.activeLoreKB.snippets.length)
        ? S.activeLoreKB : getWorldLoreKB();
    const snippets = (kb && kb.snippets) || [];
    const raw = String(name || "").trim();
    const rels = [];
    for (const s of snippets) {
        if (!Array.isArray(s.relations)) continue;
        for (const r of s.relations) {
            const from = (r.from || "").trim(), to = (r.to || "").trim();
            if (from === raw || to === raw) {
                rels.push({ from, to, relation: r.relation || "related", via: s.title || s.id });
            }
        }
    }
    const card = document.getElementById("graphPreview");
    if (!card) return;
    const relHtml = rels.length
        ? rels.map(r => `<div class="kg-rel-row"><span class="kg-rel-name">${escapeHtml(r.from)}</span><span class="kg-rel-arrow">—[${escapeHtml(r.relation)}]→</span><span class="kg-rel-name">${escapeHtml(r.to)}</span><span class="kg-rel-via">（出自：${escapeHtml(r.via)}）</span></div>`).join("")
        : `<div class="kg-rel-empty">暂未检索到该实体的抽取关系</div>`;
    card.innerHTML = `
        <div class="graph-preview-head">
            <span class="graph-preview-cat" style="--c:${ENTITY_COLOR}">实体</span>
            <span class="graph-preview-title">${escapeHtml(raw)}</span>
            <button class="graph-preview-close" data-graph-close title="收起">×</button>
        </div>
        <div class="graph-preview-summary kg-entity-note">该实体尚未收录为独立知识条目，以下是从知识库中抽取到的它与其它实体的关系：</div>
        <div class="kg-rel-list">${relHtml}</div>`;
    card.hidden = false;
    const info = document.getElementById("graphInfo");
    if (info) info.style.display = "none";
}


