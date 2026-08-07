// # docs/65 补强：narrative 字段防御——防回归测试
// 覆盖两种 AI 把结构化 JSON 塞进 narrative 字段的畸形形态：
//   A 型：整段 narrative 是 `{...}` 对象字串
//   B 型：narrative 以真实剧情开头、尾部 glued 上 `","<结构键>"`（模型二次编码）
// 以及正常剧情、含转义引号的正文、非法输入等边界。
import test from "node:test";
import assert from "node:assert/strict";
import { extractNarrativeText } from "../src/utils.js";

// ---- A 型：整段是 {…} 对象 ----
test("A型：整段 JSON 对象字串 → 提取 narrative", () => {
    const raw = '{"narrative":"你在阳台上望去，维港一片灯火。","choices":[{"text":"下去看看"}],"state_changes":{}}';
    assert.equal(extractNarrativeText(raw), "你在阳台上望去，维港一片灯火。");
});

// ---- B 型：剧情 + 尾部 glued 结构键（本次复现的真实形态）----
test("B型：剧情后 glued `\",\"choices\"` → 截断到标记前并取正文", () => {
    const raw = '有人在盯着你。或者说，有人正用你自己亲手写的代码，在这座城市的水面下布一盘你还没看清的局。"","choices":[{"text":"立刻翻找信号源最后的坐标","action":"trace_signal_coordinates","hint":"顺着信号轨迹反推"}],"state_changes":{"current_location":"IFC顶层办公室"},"side_events":[{"title":"维港潜水侦察"}],"atmosphere":"办公室灯光无端闪了一下","is_forced_plot":false,"next_period":"forenoon","comment":"主角发现水下信号关联","key_facts":[{"text":"信号与青铜王座算法吻合","importance":5,"bucket":"important_event"}]}';
    const got = extractNarrativeText(raw);
    assert.ok(got.startsWith("有人在盯着你。"), "应保留剧情开头");
    assert.ok(got.endsWith("布一盘你还没看清的局。"), "应保留剧情结尾（去掉尾部 glued 的 JSON）");
    assert.equal(got.includes('"choices"'), false, "不应残留 choices 结构");
    assert.equal(got.includes("state_changes"), false, "不应残留 state_changes 结构");
    assert.equal(got.includes("key_facts"), false, "不应残留 key_facts 结构");
});

test("B型：尾部 glued 其他结构键（state_changes / key_facts）也能截断", () => {
    const raw = '他合上电脑，长舒一口气。"","state_changes":{"stamina":95},"key_facts":[{"text":"x"}]';
    const got = extractNarrativeText(raw);
    assert.equal(got, "他合上电脑，长舒一口气。");
});

// ---- 正文内的转义引号应被还原 ----
test("B型：正文内的转义引号/换行被还原为真实字符", () => {
    const raw = '她说：\\"今晚别走\\"。\\n门外传来脚步声。"","choices":[{"text":"开门"}]';
    const got = extractNarrativeText(raw);
    assert.equal(got, '她说："今晚别走"。\n门外传来脚步声。');
});

// ---- 正常剧情不受影响 ----
test("正常剧情（无 JSON 残留）→ 原样返回", () => {
    const raw = "香港中环，凌晨一点半。你坐在 IFC 顶层的办公室里。";
    assert.equal(extractNarrativeText(raw), raw);
});

test("正常剧情包含 { 与 choices 字样但不带 `\":` → 不误伤", () => {
    const raw = "他翻出一本《choices》笔记，封面上画着 {龙纹}。";
    assert.equal(extractNarrativeText(raw), raw);
});

// ---- 非法 / 边界输入 ----
test("null / undefined → 返回空串", () => {
    assert.equal(extractNarrativeText(null), "");
    assert.equal(extractNarrativeText(undefined), "");
});

test("非字串 → 转为字串返回", () => {
    assert.equal(extractNarrativeText(123), "123");
});
