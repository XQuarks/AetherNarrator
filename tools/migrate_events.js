const fs = require('fs');
const p = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator/index.html';
let c = fs.readFileSync(p, 'utf8');

const reps = [
  // 动态列表/存档/选项/状态 tab 的 onclick -> data-action / data-*
  ['onclick="deleteSave(\'${s.id}\')"', 'data-action="deleteSave" data-id="${s.id}"'],
  ['onclick="chooseOption(${i})"', 'data-index="${i}"'],
  ['onclick="closeStatusPanel(event)"', 'data-action="closeStatusPanel"'],
  ['onclick="event.stopPropagation()"', 'data-action="statusPanelStop"'],
  // 文件上传区：删除 HTML 内联 onclick，改由 JS 统一绑定（仅点本体打开）
  [' id="fileUploadArea" onclick="document.getElementById(\'sourceFile\').click()"', ' id="fileUploadArea"'],
  // clearSourceFile 里冗余的 area.onclick 重置：删除（已由初始化绑定取代）
  ['    area.onclick = function() { document.getElementById("sourceFile").click(); };', '    // 文件上传区点击已在初始化时通过事件委托统一绑定'],
  // closeStatusPanel 不再依赖 event.target，改为无参
  ['function closeStatusPanel(event) {', 'function closeStatusPanel() {'],
  ['    if (event.target.id === "statusPanelOverlay") {\n        hideStatusPanel();\n    }', '    hideStatusPanel();'],
  // CSP: 允许 Google Fonts 样式（让 Inter 字体加载）
  ['style-src \'self\' \'unsafe-inline\';', 'style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com;'],
];

for (const [old, neu] of reps) {
  if (c.indexOf(old) === -1) { console.log('WARN not found:', JSON.stringify(old).slice(0, 70)); continue; }
  c = c.split(old).join(neu);
  console.log('OK  :', JSON.stringify(old).slice(0, 60));
}

// 在 sanitizeWorldConfig 之前插入事件委托 + 文件上传区绑定
const anchor = 'function sanitizeWorldConfig(raw) {';
const idx = c.indexOf(anchor);
if (idx === -1) {
  console.log('WARN anchor not found for delegation block');
} else {
  const block =
`// ============ 事件委托（替代内联 onclick，便于未来收紧 CSP）============
document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const name = el.dataset.action;
    if (name === "statusPanelStop") { e.stopPropagation(); return; }
    const fn = window[name];
    if (typeof fn !== "function") return;
    const args = [];
    if (el.dataset.id !== undefined) args.push(el.dataset.id);
    if (el.dataset.key !== undefined) args.push(el.dataset.key);
    if (el.dataset.index !== undefined) args.push(Number(el.dataset.index));
    let i = 0;
    while (el.dataset["arg" + i] !== undefined) { args.push(el.dataset["arg" + i]); i++; }
    fn.apply(el, args);
});
// 文件上传区：仅点击本体时打开选择器（避免子元素 file-remove 误触）
(function () {
    const area = document.getElementById("fileUploadArea");
    const input = document.getElementById("sourceFile");
    if (area && input) area.addEventListener("click", (e) => { if (e.target === area) input.click(); });
})();

`;
  c = c.slice(0, idx) + block + c.slice(idx);
  console.log('OK  : inserted delegation block');
}

fs.writeFileSync(p, c);
console.log('DONE');
