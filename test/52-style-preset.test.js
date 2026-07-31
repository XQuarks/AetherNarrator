// 文档52：W2-Style 创作向导 + 叙事风格预设
// 覆盖：
//   1) serializeStylePreset 规整（完整字段保留 / 缺省兜底 / null 走空自定义骨架）
//   2) buildStyleGuide 正确渲染 12 个模板（narrative_style 作为文风主体 + 结构化标签）
//   3) selectStyleTemplate 套用模板自动填文风 + 推荐温度；getStylePresetFromWizard 读回一致
//   4) hp_canon 已改名为「英国魔幻」
//
// DOM 依赖（selectStyleTemplate / getStylePresetFromWizard 读 #narrativeStyle/#worldTemp 等）
// 用最小桩实现，贴近 s29 的 stub 风格。
import assert from "node:assert/strict";
import test from "node:test";
import { STYLE_PRESETS, getStylePreset, serializeStylePreset } from "../src/style-presets.js";
import { buildStyleGuide } from "../src/prompt.js";

// ---------- 最小 DOM 桩 ----------
function makeClassList() {
    const set = new Set();
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, force) => {
            if (force === undefined) {
                if (set.has(c)) { set.delete(c); return false; }
                set.add(c); return true;
            }
            if (force) set.add(c); else set.delete(c);
            return !!force;
        }
    };
}
function makeEl(extra = {}) {
    return Object.assign({
        value: "",
        textContent: "",
        dataset: {},
        classList: makeClassList(),
        querySelectorAll: () => [],
        querySelector: () => null
    }, extra);
}

const cardStubs = STYLE_PRESETS.map(p => { const c = makeEl(); c.dataset = { preset: p.preset_id }; return c; });
const customCard = makeEl(); customCard.dataset = { preset: "" }; cardStubs.push(customCard);

const els = {
    narrativeStyle: makeEl(),
    worldTemp: makeEl({ value: "0.7" }),
    worldTempLabel: makeEl(),
    styleCurrentTag: makeEl()
};

globalThis.document = {
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: (sel) => sel.includes(".style-card") ? cardStubs : []
};

// ---------- 1) serializeStylePreset 规整 ----------
test("serializeStylePreset：完整模板字段全部保留", () => {
    const t = STYLE_PRESETS[0];
    const s = serializeStylePreset(t);
    assert.equal(s.preset_id, t.preset_id);
    assert.equal(s.name, t.name);
    assert.equal(s.short_tag, t.short_tag);
    assert.equal(s.source, "template");
    assert.equal(s.narrative_style, t.narrative_style);
    assert.equal(s.recommended_temperature, t.recommended_temperature);
    assert.equal(s.system_addendum, t.system_addendum);
    assert.deepEqual(s.tropes, t.tropes);
});

test("serializeStylePreset：缺省字段按兜底填", () => {
    const s = serializeStylePreset({ preset_id: "x", name: "仅ID" });
    assert.equal(s.name, "仅ID");
    assert.equal(s.source, "custom");
    assert.equal(s.narrative_style, "");
    assert.equal(s.genre, null);
    assert.deepEqual(s.tropes, []);
    assert.equal(s.taste, null);
    assert.equal(s.recommended_temperature, 0.6);
    assert.equal(s.system_addendum, "");
});

test("serializeStylePreset：null 走空自定义骨架", () => {
    const s = serializeStylePreset(null);
    assert.equal(s.preset_id, "custom");
    assert.equal(s.name, "自定义风格");
    assert.equal(s.source, "custom");
    assert.equal(s.recommended_temperature, 0.6);
});

// ---------- 2) buildStyleGuide 渲染 12 模板 ----------
test("buildStyleGuide：12 模板 narrative_style 成为文风主体且题材出现", () => {
    assert.equal(STYLE_PRESETS.length, 12, "应有 12 个内置模板");
    for (const p of STYLE_PRESETS) {
        const g = buildStyleGuide({ style_preset: serializeStylePreset(p) });
        assert.ok(g.includes(p.narrative_style), `模板 ${p.preset_id} 的文风长文本应进入主体`);
        assert.ok(g.includes(p.genre), `模板 ${p.preset_id} 的题材(${p.genre})应出现`);
        assert.ok(g.includes("最高优先级叙事约束"), "应含文风最高优先级约束头部");
    }
});

test("buildStyleGuide：hp_canon 改名英国魔幻后 narrative 仍正确渲染", () => {
    const p = getStylePreset("hp_canon");
    const g = buildStyleGuide({ style_preset: serializeStylePreset(p) });
    assert.ok(g.includes(p.narrative_style), "英国魔幻文风应进入主体");
    assert.ok(g.includes("西幻"), "题材仍为西幻");
});

// ---------- 4) hp_canon 改名 ----------
test("style-presets：hp_canon 已改名为「英国魔幻」", () => {
    const p = getStylePreset("hp_canon");
    assert.ok(p, "hp_canon 仍存在");
    assert.equal(p.name, "英国魔幻");
    assert.equal(p.short_tag, "英国魔幻");
});

// ---------- 3) 套用模板自动填温+文风（需 DOM，动态导入 wizard-editor） ----------
test("selectStyleTemplate + getStylePresetFromWizard：套用模板自动填文风与温度", async () => {
    const { selectStyleTemplate, getStylePresetFromWizard } = await import("../src/wizard-editor.js");
    const p = getStylePreset("epic_fantasy"); // 史诗奇幻，温度 0.5
    selectStyleTemplate("epic_fantasy");

    assert.equal(els.narrativeStyle.value, p.narrative_style, "应把模板文风写入文本框");
    assert.equal(els.worldTemp.value, String(p.recommended_temperature), "应把推荐温度写入滑块");
    assert.equal(els.styleCurrentTag.textContent, p.short_tag, "顶部标签应显示模板 short_tag");

    const out = getStylePresetFromWizard();
    assert.equal(out.preset_id, "epic_fantasy");
    assert.equal(out.source, "template");
    assert.equal(out.narrative_style, p.narrative_style);
    assert.equal(out.recommended_temperature, p.recommended_temperature);
    assert.equal(out.system_addendum, p.system_addendum);
});

test("getStylePresetFromWizard：自定义风格 source=custom", async () => {
    const { selectStyleTemplate, getStylePresetFromWizard } = await import("../src/wizard-editor.js");
    selectStyleTemplate(""); // 选「自定义风格」卡
    els.narrativeStyle.value = "我自己的独特文风描述";
    const out = getStylePresetFromWizard();
    assert.equal(out.source, "custom");
    assert.equal(out.preset_id, "custom");
    assert.equal(out.narrative_style, "我自己的独特文风描述");
    assert.equal(out.short_tag, "自定义");
});
