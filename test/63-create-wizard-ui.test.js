// ★ 2026-08-04 创建世界界面优化（范围C）静态回归测试
// ★ 2026-08-05 docs/62 分步向导重构：编辑器长页（左 nav 5 页签）→ 顶部步骤条 6 步向导
// 覆盖：
//  1) 分步骨架：#wzStepsBar + 6 个 .wz-pane[data-step=0..5]，旧 .cw-nav/.cw-module 已移除
//  2) 细节收纳：风格模板库折叠开关 / 结构化标签 details / 关键偏离 details
//  3) bug 修复：pov 高亮同步（syncPovHighlight）、keyDivergences 重置、ipNameOptHint 默认隐藏
//  4) 容器条目默认折叠 + AI 双按钮合并为下拉 + 校验徽标降噪（徽标挂步骤节点）
//  5) 死代码清理：openWorldBookFromWizard 彻底移除
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const render = readFileSync(join(root, "src", "render.js"), "utf8");
const game = readFileSync(join(root, "src", "game.js"), "utf8");
const wizardEditor = readFileSync(join(root, "src", "wizard-editor.js"), "utf8");
const wizardContainers = readFileSync(join(root, "src", "wizard-containers.js"), "utf8");
const app = readFileSync(join(root, "src", "app.js"), "utf8");

// ---------- 1) 分步骨架 ----------
test("创建向导为 6 步分步结构（.wz-pane data-step=0..5），旧左侧页签导航已移除", () => {
    assert.ok(html.includes('id="wzStepsBar"'), "应存在顶部步骤条挂载点");
    assert.ok(!html.includes('<nav class="cw-nav">'), "旧左侧页签导航应已移除");
    assert.ok(!html.includes('data-action="selectCwModule"'), "旧页签切换动作应已移除");
    const steps = [...html.matchAll(/<section class="wz-pane[^"]*" data-step="(\d)">/g)].map(m => m[1]);
    assert.deepEqual(steps, ["0", "1", "2", "3", "4", "5"], "应按序存在 6 个步骤页");
});

test("向导导航动作接线（next/prev/skip/gotoStep），selectCwModule 已移除", () => {
    for (const a of ["wizardNextStep", "wizardPrevStep", "wizardSkipStep", "wizardGotoStep"]) {
        assert.ok(app.includes(a), `app.js 应注册 ${a}`);
        assert.ok(wizardEditor.includes(`export function ${a.replace("wizardGotoStep", "gotoWizardStep")}`), `wizard-editor 应实现 ${a}`);
    }
    assert.ok(!wizardEditor.includes("selectCwModule"), "wizard-editor 不应再有 selectCwModule");
    assert.ok(!render.includes("selectCwModule"), "render.js 不应再调用 selectCwModule");
    assert.ok(render.includes("gotoWizardStep(0)"), "打开弹窗应回到第 1 步");
});

test("底部导航按钮齐备（取消/上一步/跳过/下一步/确认生成）", () => {
    for (const id of ["wzCancelBtn", "wzPrevBtn", "wzSkipBtn", "wzNextBtn", "generateWorldBtn"]) {
        assert.ok(html.includes(`id="${id}"`), `footer 应含 #${id}`);
    }
});

test("第 1 步必填校验与 generateWorld 同规则（名称 + 描述或源文件）", () => {
    assert.ok(wizardEditor.includes("validateStep0"), "应有第 1 步必填校验");
    assert.ok(wizardEditor.includes("请填写世界名称"), "校验文案应与 generateWorld 一致");
    assert.ok(wizardEditor.includes("二者至少一项"), "描述/源文件规则应与 generateWorld 一致");
});

test("容器挂载点集中在第 5 步（角色资源），时间系统字段在第 4 步（玩法时间）", () => {
    const preset = html.match(/<section class="wz-pane" data-step="4">([\s\S]*?)<\/section>/);
    assert.ok(preset, "应存在角色资源步骤页");
    for (const key of ["characters", "variables", "inventory", "skills", "goals", "sideEvents"]) {
        assert.ok(preset[1].includes(`id="wc_container_${key}"`), `角色资源步应含容器 ${key}`);
    }
    const modules = html.match(/<section class="wz-pane" data-step="3">([\s\S]*?)<\/section>/);
    assert.ok(modules, "应存在玩法时间步骤页");
    assert.ok(modules[1].includes('id="moduleToggles"'), "应含模块开关");
    assert.ok(modules[1].includes('id="timePreset"'), "应含时间推进偏好下拉");
    assert.ok(modules[1].includes('id="timePresetGate"'), "应保留时间系统门禁占位");
});

test("确认步含配置摘要与校验面板（摘要带可回跳的「修改」按钮）", () => {
    const confirm = html.match(/<section class="wz-pane" data-step="5">([\s\S]*?)<\/section>/);
    assert.ok(confirm, "应存在确认生成步骤页");
    assert.ok(confirm[1].includes('id="wzSummary"'), "应含配置摘要挂载点");
    assert.ok(confirm[1].includes('id="wizardValidationPanel"'), "校验面板应内嵌于确认步");
    assert.ok(wizardEditor.includes("renderWizardSummary"), "应实现摘要渲染");
    assert.ok(wizardEditor.includes("wz-sum-edit"), "摘要卡应含修改回跳按钮");
});

// ---------- 2) 细节收纳 ----------
test("风格模板库默认折叠 + 展开按钮接线", () => {
    assert.ok(html.includes('class="style-template-grid collapsed"'), "模板库应默认带 collapsed");
    assert.ok(html.includes('id="styleGridToggle"'), "应有展开按钮");
    assert.ok(html.includes('data-action="toggleStyleGridExpand"'), "展开按钮应接线");
    assert.ok(wizardEditor.includes("toggleStyleGridExpand"), "wizard-editor 应实现展开切换");
});

test("结构化标签与关键偏离均收进 details 折叠", () => {
    assert.ok(html.includes('id="styleTagsDetails"'), "结构化标签应收进 details");
    const kdIdx = html.indexOf('id="keyDivergences"');
    const before = html.slice(0, kdIdx);
    assert.ok(before.lastIndexOf("<details") > before.lastIndexOf("</details>"), "关键偏离应位于未闭合的 details 内");
});

// ---------- 3) bug 修复 ----------
test("pov 高亮同步：wizard-editor 提供 syncPovHighlight 并在 change 监听中调用", () => {
    assert.ok(wizardEditor.includes("export function syncPovHighlight"), "应导出 syncPovHighlight");
    assert.ok(!render.includes("o.dataset.value") && !game.includes("o.dataset.value"), "不应再依赖不存在的 data-value");
    assert.ok(game.includes("syncPovHighlight()"), "生成成功后应同步 pov 高亮");
});

test("keyDivergences 在打开与生成成功后均被重置", () => {
    assert.ok(render.includes('"keyDivergences"'), "resetCreateWorldForm 清空列表应含 keyDivergences");
    assert.ok(game.includes('getElementById("keyDivergences")'), "game.js 仍读取该字段");
    assert.ok(/kdEl\.value = ""/.test(game), "生成成功后应清空 keyDivergences");
});

test("ipNameOptHint 默认隐藏，按上传状态显隐", () => {
    assert.ok(html.includes('id="ipNameOptHint" style="display:none;'), "提示应默认隐藏");
    assert.ok(render.includes("isSourceFileUploaded() ? \"\" : \"none\""), "refreshIpNameRequirement 应按上传状态切换");
    assert.ok(!render.includes("ipNameReqTag"), "不存在的 ipNameReqTag 死代码应已移除");
});

// ---------- 4) 容器折叠 / AI 下拉 / 校验降噪 ----------
test("容器条目默认折叠：caret + toggle 动作 + 展开状态数组", () => {
    assert.ok(wizardContainers.includes("WC_EXPANDED"), "应维护条目展开状态");
    assert.ok(wizardContainers.includes('data-wc="toggle"'), "标题行应可点击展开");
    assert.ok(wizardContainers.includes("wc-item-caret"), "应有折叠箭头");
});

test("容器工具栏 AI 双按钮已合并为 data-wc-ai 下拉", () => {
    assert.ok(wizardContainers.includes("data-wc-ai"), "应有 AI 生成下拉");
    assert.ok(!wizardContainers.includes('data-wc="ai-gen"'), "旧 ai-gen 按钮应移除");
    assert.ok(!wizardContainers.includes('data-wc="ai-complete"'), "旧 ai-complete 按钮应移除");
});

test("校验降噪：步骤条徽标 + 面板仅 error 或末步（确认生成）显示", () => {
    assert.ok(wizardContainers.includes("updateNavBadges"), "应实现步骤条徽标");
    assert.ok(wizardContainers.includes("cw-badge-err"), "应有 error 徽标样式类");
    assert.ok(wizardContainers.includes("currentCwStep() === 5"), "面板完整显示应限定末步（确认生成）");
    assert.ok(wizardContainers.includes('wz-step-node[data-step="4"]'), "徽标应挂到角色资源步骤节点");
    assert.ok(wizardEditor.includes("renderValidationPanel()"), "切换步骤应刷新面板显隐");
});

// ---------- 5) 死代码清理 ----------
test("openWorldBookFromWizard 死按钮已彻底移除", () => {
    assert.ok(!wizardEditor.includes("openWorldBookFromWizard"), "wizard-editor 不应再定义该函数");
    assert.ok(!app.includes("openWorldBookFromWizard"), "app.js 不应再注册该 action");
    assert.ok(!html.includes("openWorldBookFromWizard"), "index.html 不应再有该按钮");
});
