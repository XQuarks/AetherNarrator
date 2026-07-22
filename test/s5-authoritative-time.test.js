// S5-6：机制四·权威时间兜底注入
// 覆盖：① buildAuthoritativeTime 纯函数（gregorian / multiverse 双界标 active / none 不展示 / continuous 相对锚点）
//       ② buildAuthorNote 每轮注入【当前权威时间】章节
// 说明：单界/多世界走真实 getTimeConfig() 路径（设全局 S）；none 直接传 tc 隔离（见 docs/20 §13 S5-6）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { S } from "../src/store.js";
import { buildAuthoritativeTime, buildAuthorNote } from "../src/prompt.js";

// 设全局世界状态（贴近运行期真实路径）
function setWorld(schema, gameState) {
    S.currentWorld = { schema };
    S.gameState = gameState || {};
}

test("S5-6 buildAuthoritativeTime：gregorian 含权威时间标题/纪元/年份/覆盖指令", () => {
    setWorld(
        { time_config: { mode: "periods", calendar_mode: "gregorian", era_label: "大航海时代", season: "冬季", calendar_start: { year: 1620, month: 1, date: 1 } } },
        { current_date: { year: 1620, month: 3, date: 15, period: "morning", step: 1 } }
    );
    const out = buildAuthoritativeTime(S.gameState);
    assert.ok(out.includes("【当前权威时间】"), "应含权威时间标题");
    assert.ok(out.includes("大航海时代"), "应含纪元");
    assert.ok(out.includes("1620"), "应含年份 1620");
    assert.ok(out.includes("以本权威时间为准"), "应含覆盖指令");
});

test("S5-6 buildAuthoritativeTime：multiverse 两界都给且标 active 界", () => {
    setWorld(
        {
            time_config: {
                mode: "multiverse",
                active_timeline: "earth",
                timelines: {
                    earth: { name: "地球", calendar_mode: "gregorian", era_label: "现实纪元", current_date: { year: 2003, month: 5, date: 1, period: "morning" } },
                    moon: { name: "月球", calendar_mode: "lunar", era_label: "月纪元", current_date: { year: 3024, month: 3, date: 9, period: "night" } }
                }
            }
        },
        {
            active_timeline: "earth",
            current_date: { year: 2003, month: 5, date: 1, period: "morning" },
            timelines: {
                earth: { current_date: { year: 2003, month: 5, date: 1, period: "morning" } },
                moon: { current_date: { year: 3024, month: 3, date: 9, period: "night" } }
            }
        }
    );
    const out = buildAuthoritativeTime(S.gameState);
    assert.ok(out.includes("地球"), "应含地球界");
    assert.ok(out.includes("月球"), "应含月球界");
    assert.ok(out.includes("2003"), "应含地球年份");
    assert.ok(out.includes("农历三月初九") || out.includes("月纪元"), "月球行应含农历日期或月纪元（lunar 不显示年份）");
    assert.ok(out.includes("地球（当前所在界）"), "active 界应标「当前所在界」");
    assert.ok(!out.includes("月球（当前所在界）"), "非 active 界不应标「当前所在界」");
});

test("S5-6 buildAuthoritativeTime：none 模式给不展示时间提示", () => {
    const tc = { mode: "periods", timeConfig: { mode: "none" }, timelines: null, active_timeline: "main" };
    const out = buildAuthoritativeTime({}, tc);
    assert.ok(out.includes("不展示具体时间"), "none 模式应给不展示时间提示");
});

test("S5-6 buildAuthoritativeTime：continuous 模式用相对锚点", () => {
    setWorld(
        { time_mode: "continuous", time_config: { mode: "periods", calendar_mode: "none" } },
        { current_date: { relative_label: "你来到这里的第三年", period: "morning" } }
    );
    const out = buildAuthoritativeTime(S.gameState);
    assert.ok(out.includes("【当前权威时间】"), "应含权威时间标题");
    assert.ok(out.includes("你来到这里的第三年"), "continuous 应含相对锚点");
});

test("S5-6 buildAuthorNote：每轮注入【当前权威时间】章节", () => {
    setWorld(
        { time_config: { mode: "periods", calendar_mode: "gregorian", era_label: "大航海时代", season: "冬季", calendar_start: { year: 1620, month: 1, date: 1 } } },
        { current_date: { year: 1620, month: 3, date: 15, period: "morning", step: 1 } }
    );
    const note = buildAuthorNote();
    assert.ok(typeof note === "string", "buildAuthorNote 应返回字符串");
    assert.ok(note.includes("【当前权威时间】"), "中部纠偏位应含权威时间章节");
});
