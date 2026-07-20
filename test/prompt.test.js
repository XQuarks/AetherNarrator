// 开局从原文开头优化 · prompt 构造单测
// 验证：导入小说原文时，生成世界的 prompt 必须注入【原文开头】段与第二人称改写要求；
// 纯描述生成（无 sourceContent）时不出现该段，保持原逻辑。
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorldGenerationPrompt } from "../src/prompt.js";

// 统一用最小参数调用；sourceContent 为唯一变量
function gen(opts = {}) {
    return buildWorldGenerationPrompt(
        opts.name || "测试世界",
        opts.type || "original",
        opts.desc || "一个被读者改造为中世纪魔法背景的世界",
        opts.hero || "赫敏·格兰杰（读者把主角从哈利改为赫敏）",
        opts.ipName || null,
        opts.sourceContent || "",          // 关键变量
        opts.styleRef || "none",
        opts.customStyle || undefined,
        opts.plotFreedom || 3,
        opts.worldPrefix || ""
    );
}

test("有原文：注入【原文开头】段 + 第二人称改写要求", () => {
    const src = "第一章 风暴前夕\n哈利在女贞路4号的楼梯下醒来，猫头鹰的信塞满了信箱……";
    const p = gen({ sourceContent: src });

    // 1) 必须出现故事起点段与原文包裹标签
    assert.ok(p.includes("原文开头"), "应注入【原文开头】段标题");
    assert.ok(p.includes("<opening_source>"), "应包裹 <opening_source> 标签");
    assert.ok(p.includes("</opening_source>"), "应有闭合标签");
    // 2) 原文内容确实被切片注入（取前 OPENING_SRC_CHARS 字，此处短串应整段出现）
    assert.ok(p.includes("哈利在女贞路4号的楼梯下醒来"), "原文开头内容应出现在 prompt 中");
    // 3) opening_narrative 要求必须显式引用原文开头 + 第二人称
    assert.ok(p.includes("opening_narrative"), "应包含 opening_narrative 字段要求");
    assert.ok(p.includes("第二人称"), "开场白要求应包含「第二人称」改写指令");
    assert.ok(p.includes("原文第 1 章第 1 段"), "应要求从原文第 1 章第 1 段出发");
    // 4) 服从读者改造：hero 改主角 + desc 改世界观 都应在 prompt 中可见（已被系统字段承载）
    assert.ok(p.includes("赫敏"), "主角设定 hero 应出现在 prompt");
    assert.ok(p.includes("中世纪"), "世界观描述 desc 应出现在 prompt");
    // 5) 同时要求「按改造后设定重写」的约束文本
    assert.ok(p.includes("服从读者调整"), "应包含服从读者改造的约束");
    assert.ok(p.includes("赫敏→赫敏") || p.includes("哈利→赫敏"), "应包含主角改造示例说明");
});

test("无原文：不出现【原文开头】段，保留原兜底逻辑", () => {
    const p = gen({ sourceContent: "" });

    assert.ok(!p.includes("<opening_source>"), "无原文时不应注入 opening_source 标签");
    assert.ok(!p.includes("原文开头（故事起点参考"), "无原文时不应出现原文开头段");
    // 但 opening_narrative 字段与其兜底要求仍在
    assert.ok(p.includes("opening_narrative"), "仍应要求 opening_narrative 字段");
    assert.ok(p.includes("兜底"), "无原文时应保留「兜底」写富有氛围感开场的要求");
});

test("原文截断长度受 OPENING_SRC_CHARS 控制（不超长注入）", () => {
    const longSrc = "开头".repeat(5000); // 10000 字
    const p = gen({ sourceContent: longSrc });
    const idx = p.indexOf("<opening_source>");
    const endIdx = p.indexOf("</opening_source>");
    const body = p.slice(idx, endIdx);
    // 默认 3000 字上限，包裹标签/前后文字会略多，但原文主体不应整段 10000 字都进 prompt
    assert.ok(body.length < 5000, "原文开头注入应被 OPENING_SRC_CHARS 截断，而非整本塞入");
});
