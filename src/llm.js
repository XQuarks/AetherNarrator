// ============================================================
// AetherNarrator · llm.js（由 app.js 模块化拆分自动生成）
// ============================================================
import { S } from "./store.js";
import { DEFAULT_PERIOD_LABELS } from "./store.js";
import { buildApiUrl, defaultWorldSchema, getWorldSchema, parseResponse, sleep } from "./utils.js";
import { getNextPeriod, getTemperature } from "./theme.js";
import { getWorldLoreKB, summarizeFactsFromChanges } from "./rag.js";
import { buildSystemPrompt, buildTurnUserMessage, buildWorldGenerationPrompt } from "./prompt.js";
import { updateCacheIndicator, updateLoadingProgress } from "./render.js";
import { processTurn } from "./game.js";

export function logTurnStats(hit, miss, total, usage) {
    const model = document.getElementById("modelName")?.value || "unknown";
    const temp = getTemperature();
    const turnNum = S.debugLog.turns.length + 1;
    S.debugLog.turns.push({
        turn: turnNum,
        time: new Date().toISOString(),
        worldId: S.currentWorld ? S.currentWorld.id : null,
        worldName: S.currentWorld ? S.currentWorld.name : null,
        model: model,
        temperature: temp,
        inputTokens: usage.prompt_tokens || total,
        cacheHitTokens: hit,
        cacheMissTokens: miss,
        outputTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        hitRate: total > 0 ? (hit / total * 100).toFixed(1) : "0"
    });
}

export async function callWorldGenerationLLM(name, type, desc, hero, ipName, sourceContent, styleRef, customStyle, plotFreedom, worldPrefix) {
    const mock = document.getElementById("mockMode").checked;
    if (mock) {
        await sleep(1200);
        return mockGenerateWorld(name, type, desc, hero, ipName);
    }

    const baseUrl = document.getElementById("baseUrl").value.trim();
    const corsProxy = document.getElementById("corsProxy").value.trim();
    const apiKey = document.getElementById("apiKey").value.trim();
    const model = document.getElementById("modelName").value.trim();
    if (!baseUrl || !apiKey || !model) {
        throw new Error("请填写 Base URL、API Key 和模型名称，或开启模拟模式。");
    }

    const prompt = buildWorldGenerationPrompt(name, type, desc, hero, ipName, sourceContent, styleRef, customStyle, plotFreedom, worldPrefix);
    const url = buildApiUrl(baseUrl, corsProxy);
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
            model,
            messages: [{ role: "system", content: prompt }],
            temperature: 0.7,
            max_tokens: 8192,
            response_format: { type: "json_object" }
        })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("API 返回异常：无法获取响应内容");
    return parseResponse(content);
}

export function mockGenerateWorld(name, type, desc, hero, ipName) {
    const isXianxia = /仙|侠|修|道|武|玄|魔/.test(name + desc);
    const isMagicSchool = /霍格沃茨|哈利|魔法|学院|巫师/.test(name + desc);

    let schema, initial_state, lore_snippets, system_prompt;

    if (isMagicSchool) {
        schema = {
            progression_label: "年级",
            progression_path_label: "学院",
            has_skills: true,
            skill_label: "课程/法术",
            attribute_labels: { courage: "勇气", perception: "观察", patience: "耐心", luck: "运气", will: "意志" },
            time_periods: DEFAULT_PERIOD_LABELS,
            game_over_conditions: ["is_alive === false"]
        };
        initial_state = {
            name: "新生",
            age: 11,
            background: "刚刚收到入学通知书，对魔法世界一无所知。",
            personality: ["好奇", "紧张"],
            attributes: {
                courage: "勇气不算出众，但分院帽似乎从你身上嗅到了某种执拗。",
                perception: "观察力不算敏锐，但偶尔能注意到别人遗漏的魔法细节。",
                patience: "坐得住魔药课漫长的准备步骤，可一旦出错就忍不住想摔坩埚。",
                luck: "命运似乎在你看不见的地方悄悄转动。",
                will: "年纪虽小，却有着一股不愿轻易认输的倔劲。"
            },
            progression: { path: "待定", rank: "一年级新生", progress: 0 },
            relationships: {
                "分院帽": "素未谋面，只听说它会在你头上做出决定。",
                "室友": "尚未谋面。",
                "魔药课教授": "只在别人口中听说过，名声让人既敬畏又紧张。"
            },
            skills: {
                "魔药学": "连药材名字都记不全，更别提调配。",
                "变形术": "理论上知道物体可以变形，实际上连火柴都没让变尖过。",
                "飞行": "从没骑过扫帚，光是想象离地就已经手心冒汗。"
            },
            inventory: [{ item_id: "wand", name: "魔杖", count: 1 }, { item_id: "robe", name: "校袍", count: 1 }],
            completed_events: [],
            active_event: null,
            current_location: "学院大厅",
            current_date: { day: 1, period: "morning" },
            goals: [
                { goal_id: "sorted", name: "完成分院仪式", type: "完成事件", deadline: { day: 1, period: "night" }, visible: true },
                { goal_id: "first_class", name: "上完第一堂课", type: "完成事件", deadline: { day: 2, period: "night" }, visible: true }
            ],
            status_effects: [],
            is_alive: true,
            death_reason: null
        };
        lore_snippets = [
            { id: "m1", category: "规则", title: "魔法世界规则", content: "巫师需使用魔杖施法，未成年人禁止在校外施法。", keywords: ["魔杖", "施法", "规则"] },
            { id: "m2", category: "地点", title: "学院大厅", content: "新生入学与分院仪式举行之地，穹顶施有天气咒。", keywords: ["大厅", "分院"] },
            { id: "m3", category: "人物", title: "分院帽", content: "一顶有自我意识的魔法帽，负责为新生分配学院。", keywords: ["分院帽"] }
        ];
        system_prompt = `你是${name}魔法学院背景文字游戏的主持人。规则：符合魔法世界观，一年级新生不能施展高级咒语，不可篡改原著核心事件。输出 JSON。`;
    } else if (isXianxia) {
        schema = {
            progression_label: "境界",
            progression_path_label: "修行路线",
            has_skills: true,
            skill_label: "功法/技艺",
            attribute_labels: { courage: "胆识", perception: "洞察", patience: "耐心", luck: "气运", will: "心志" },
            time_periods: DEFAULT_PERIOD_LABELS,
            game_over_conditions: ["is_alive === false"]
        };
        initial_state = {
            name: "少年",
            age: 16,
            background: "小镇出身的少年，机缘巧合踏上修行路。",
            personality: ["谨慎", "坚韧"],
            attributes: {
                courage: "道心初立，面对修士威压仍会紧张，但已敢抬头看对方的眼睛。",
                perception: "能留意到灵气波动的微弱痕迹，却常常分辨不出真假。",
                patience: "能忍着打坐一个时辰，再多腿就开始发麻。",
                luck: "不算好也不算坏，偶尔能在路边捡到半块灵石。",
                will: "心志尚浅，却被生活磨出了一股不服输的韧劲。"
            },
            progression: { path: "未入门", rank: "凡人", progress: 0 },
            relationships: {
                "老道长": "萍水相逢，他看你的眼神里带着几分打量。",
                "同乡少年": "你们彼此看不顺眼，言语间多有试探。",
                "药铺掌柜": "只是点头之交，谈不上熟悉。"
            },
            skills: {
                "剑术": "只会些庄稼把式，连剑都握不太稳。",
                "打坐": "才学会吐纳的皮毛，坐久了腿麻。",
                "辨识草药": "只认得出最常见的几种，常把杂草当宝贝。"
            },
            inventory: [{ item_id: "bread", name: "干粮", count: 2 }, { item_id: "coin", name: "铜钱", count: 10 }],
            completed_events: [],
            current_location: "小镇入口",
            current_date: { day: 1, period: "morning" },
            goals: [
                { goal_id: "find_shelter", name: "找到落脚之处", type: "完成事件", deadline: { day: 1, period: "night" }, visible: true },
                { goal_id: "meet_someone", name: "认识一位当地人", type: "关系变化", deadline: { day: 3, period: "night" }, visible: true }
            ],
            status_effects: [],
            is_alive: true,
            death_reason: null
        };
        lore_snippets = [
            { id: "x1", category: "规则", title: "修行境界", content: "凡人、练气、筑基、金丹、元婴……境界不可跳跃。", keywords: ["境界", "修行"] },
            { id: "x2", category: "地点", title: "小镇", content: "大千世界边缘的小镇，鱼龙混杂，是修行者的落脚点。", keywords: ["小镇"] },
            { id: "x3", category: "人物", title: "老道长", content: "隐居小镇的落魄修士，看似普通，实则见识广博。", keywords: ["老道长"] }
        ];
        system_prompt = `你是${name}仙侠背景文字游戏的主持人。规则：境界不可跳跃，重大事件不可篡改，NPC不会无条件帮助玩家。输出 JSON。`;
    } else {
        schema = defaultWorldSchema(name + " " + desc);
        initial_state = {
            name: "旅人",
            age: 18,
            background: "从远方而来的旅人，对这个新世界充满好奇。",
            personality: ["谨慎", "好奇"],
            attributes: {
                courage: "初来乍到，遇事不免有些畏缩，但还不到仓皇逃窜的地步。",
                perception: "对周遭动静还算留心，偶尔会注意到旁人忽略的细节。",
                patience: "能坐得住一时半刻，但若长久无望，也会焦躁起来。",
                luck: "不好不坏，像被世界随手一扔的普通石子。",
                will: "心志尚浅，却还没被现实完全磨平。"
            },
            progression: { path: "无", rank: "新手", progress: 0 },
            relationships: {
                "向导": "萍水相逢，对方看你的眼神里带着几分打量。",
                "酒馆老板": "只是点头之交，谈不上熟悉。"
            },
            skills: {
                "交涉": "说话还算有条理，但远未到打动人心的地步。",
                "观察": "能注意到一些明显迹象，深层的线索却常常错过。"
            },
            inventory: [{ item_id: "bread", name: "干粮", count: 2 }, { item_id: "coin", name: "铜币", count: 10 }],
            completed_events: [],
            current_location: "边境驿站",
            current_date: { day: 1, period: "morning" },
            goals: [
                { goal_id: "find_shelter", name: "找到落脚之处", type: "完成事件", deadline: { day: 1, period: "night" }, visible: true }
            ],
            status_effects: [],
            is_alive: true,
            death_reason: null
        };
        lore_snippets = [
            { id: "g1", category: "规则", title: "世界规则", content: desc.slice(0, 120), keywords: ["规则"] },
            { id: "g2", category: "地点", title: "初始地点", content: "玩家旅程开始的地方。", keywords: ["地点"] }
        ];
        system_prompt = `你是${name}背景文字游戏的主持人。世界观：${desc}。规则：符合世界观，不可让玩家轻易获得超规格力量。输出 JSON。`;
    }

    // 开场白
    let opening_narrative = "";
    if (isMagicSchool) {
        opening_narrative = `九月的夜风裹着凉意吹过城堡的石墙。你站在宏伟的大厅门口，手里攥着那封改变一切的录取通知书，周围是和你一样忐忑的新生。穹顶上方，烛火漂浮在半空中，像无数不肯坠落的星辰。远处，长桌尽头坐着几位面容严肃的长者，而最引人注目的，是那顶安安静静搁在椅子上的旧帽子——据说它会决定你未来七年的命运。\n\n分院仪式即将开始。你听见身旁有人小声嘀咕，有人在深呼吸，有人在偷瞄高年级学生的表情。你呢？你的手心微微出汗，心跳声在安静的厅堂里似乎格外清晰。`;
    } else if (isXianxia) {
        opening_narrative = `晨雾尚未散尽，小镇的街巷还笼罩在一层薄薄的灰白里。你背着半旧包袱，踩着湿漉漉的石板路朝镇口走去。路旁的早市摊子刚刚支起来，卖豆腐的老妪朝你点了点头，药铺的门半掩着，里头传来捣药杵沉闷的声响。\n\n你不知道自己要往哪儿去，只知道不能再留在这个地方了。昨夜你在后山看见了不该看见的东西——一道光从崖壁裂缝中渗出来，转瞬即逝，却像一根鱼刺卡在喉咙里，让你整宿没合眼。镇上的人说那座山有古怪，可谁也说不清古怪在哪里。\n\n此刻你站在镇口的岔路前，一条通往山脚，一条通往更远的官道。你的心跳比平时快了一些，呼吸也深了几寸。这不是恐惧——你比恐惧还差一点——是某种尚未说出口的期待。`;
    } else {
        opening_narrative = `你从漫长的昏睡中醒来，发现自己躺在一间陌生的房间里。窗外透进来的光线带着你不熟悉的色调——偏暖、偏沉，像是某个你从未到过的地方的傍晚。空气中有一股若有若无的气味，说不上是好闻还是难闻，只是和记忆里所有已知的气味都不一样。\n\n你坐起身来，四处打量。桌上放着一张字条，上面写着你的名字和一句话：「你来的时间比预期的早了半天，先去楼下看看吧。」\n\n你不知道写下这行字的人是谁，也不清楚"预期"指的是什么。但直觉告诉你，此刻走出去或许比留在原地更安全——或者说，更有趣。`;
    }

    return {
        schema,
        initial_state,
        lore_kb: { ip: name, snippets: lore_snippets },
        system_prompt,
        opening_narrative
    };
}

export async function callLLM(input, retrieved) {
    const sessionEpoch = S.currentSession.epoch;       // ★ P0: 捕获调用时刻的会话标识
    const sessionWorldId = S.currentSession.worldId;
    const mock = document.getElementById("mockMode").checked;
    const systemPrompt = buildSystemPrompt();
    const userContent = buildTurnUserMessage(input, retrieved);

    const messages = [
        { role: "system", content: systemPrompt },
        ...S.chatHistory,
        { role: "user", content: userContent }
    ];

    let parsed;
    if (mock) {
        parsed = mockLLM(input, retrieved);
    } else {
        const baseUrl = document.getElementById("baseUrl").value.trim();
        const corsProxy = document.getElementById("corsProxy").value.trim();
        const apiKey = document.getElementById("apiKey").value.trim();
        const model = document.getElementById("modelName").value.trim();
        if (!baseUrl || !apiKey || !model) {
            throw new Error("请填写 Base URL、API Key 和模型名称，或开启模拟模式。");
        }
        const url = buildApiUrl(baseUrl, corsProxy);
        const useStream = !document.getElementById("noStreamMode") || !document.getElementById("noStreamMode").checked;

        try {
            parsed = useStream
                ? await callLLMStreaming(url, apiKey, model, messages)
                : await callLLMNonStreaming(url, apiKey, model, messages);
        } catch (streamErr) {
            // 流式失败（如 CORS 代理不支持）才自动降级为非流式；
            // 解析失败 / 导航中断(abort) 不应重试，以免重复请求或覆盖废弃响应（P1.2.4/2.5）
            const isParse = /JSON 解析失败/.test(streamErr && streamErr.message || "");
            const isAbort = streamErr && streamErr.name === "AbortError";
            if (useStream && !isParse && !isAbort) {
                console.warn("Streaming failed, falling back to non-streaming:", streamErr.message);
                parsed = await callLLMNonStreaming(url, apiKey, model, messages);
            } else {
                throw streamErr;
            }
        }
    }
    parsed._sessionEpoch = sessionEpoch;             // ★ P0: 回传会话标识供 processTurn 校验
    parsed._sessionWorldId = sessionWorldId;
    parsed._turnUserContent = userContent;
    return parsed;
}

export async function callLLMNonStreaming(url, apiKey, model, messages) {
    const controller = new AbortController();
    S.currentAbortController = controller; // ★ P0: 暴露给导航 abort
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify({
                model, messages,
                temperature: getTemperature(),
                max_tokens: 8192,
                thinking: { type: "disabled" },
                response_format: { type: "json_object" }
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("API 返回异常：无法获取响应内容");
    const parsed = parseResponse(content);

    if (data.usage) {
        const hit = data.usage.prompt_cache_hit_tokens || 0;
        const miss = data.usage.prompt_cache_miss_tokens || 0;
        const total = hit + miss;
        S.lastCacheStats = {
            hitTokens: hit, missTokens: miss, totalTokens: total,
            hitRate: total > 0 ? (hit / total * 100).toFixed(1) + "%" : "0%"
        };
        updateCacheIndicator();
        logTurnStats(hit, miss, total, data.usage);
    }
    return parsed;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === "AbortError") throw new Error("请求超时（60秒），请检查网络或 API 配置");
        throw e;
    }
}

export async function callLLMStreaming(url, apiKey, model, messages) {
    const controller = new AbortController();
    S.currentAbortController = controller; // ★ P0: 暴露给导航 abort
    // ★ P1.2.4: 改为"流式空闲超时"——仅在 30s 内无任何新 chunk 才 abort；而非收到响应头即清（旧 60s 头超时会在长生成时误杀）
    let idleTimer = null;
    const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), 30000);
    };
    resetIdle();
    try {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
            model, messages,
            temperature: getTemperature(),
            max_tokens: 8192,
            thinking: { type: "disabled" },
            stream: true,
            stream_options: { include_usage: true },
            response_format: { type: "json_object" }
        }),
        signal: controller.signal
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let usage = null;

    let buffer = ""; // ★ P1.2.4: 跨 chunk 缓冲，按完整行处理，避免拆行丢字

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle(); // ★ 收到新数据，重置空闲计时

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue; // 流结束标记
            try {
                const json = JSON.parse(data);
                if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                    fullContent += json.choices[0].delta.content;
                    updateLoadingProgress(fullContent.length);
                }
                if (json.usage) usage = json.usage;
            } catch (e) {
                // 跳过无法解析的行
            }
        }
    }
    // 收尾：处理缓冲中残余的最后一行（若不以 \n 结尾）
    if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data !== "[DONE]") {
                try {
                    const json = JSON.parse(data);
                    if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                        fullContent += json.choices[0].delta.content;
                        updateLoadingProgress(fullContent.length);
                    }
                    if (json.usage) usage = json.usage;
                } catch (e) { /* 忽略 */ }
            }
        }
    }
    if (idleTimer) clearTimeout(idleTimer);

    const parsed = parseResponse(fullContent);

    if (usage) {
        const hit = usage.prompt_cache_hit_tokens || 0;
        const miss = usage.prompt_cache_miss_tokens || 0;
        const total = hit + miss;
        S.lastCacheStats = {
            hitTokens: hit, missTokens: miss, totalTokens: total,
            hitRate: total > 0 ? (hit / total * 100).toFixed(1) + "%" : "0%"
        };
        updateCacheIndicator();
        logTurnStats(hit, miss, total, usage);
    }
    return parsed;
    } catch (e) {
        if (idleTimer) clearTimeout(idleTimer);
        if (e.name === "AbortError") throw new Error("流式响应超时（30秒无新数据），请检查网络或 API 配置");
        throw e;
    }
}

export function mockLLM(input, retrieved) {
    const loc = S.gameState.current_location;
    const npcNames = Object.keys(S.gameState.relationships);
    const npc = npcNames.find(n => input.includes(n)) || (npcNames.length ? npcNames[0] : "路人");
    const schema = getWorldSchema(S.currentWorld);

    let narrative = "";
    let choices = [];
    let changes = { attributes: {}, relationships: {}, skills: {}, inventory: [], completed_events: [] };

    if (input.includes("休息") || input.includes("睡觉")) {
        narrative = `你在${loc}找了处安静角落歇下。精神渐好，远处传来几声寻常响动，日子像水一样流过。`;
        changes.skills = { "静修": "短暂的歇息让你心神稍定，思绪不再像无头苍蝇般乱撞。" };
        choices = [
            { text: "睡到明天早晨", action: "sleep" },
            { text: "只歇一会儿，继续行动", action: "rest_short" },
            { text: "回想今天的见闻", action: "reflect" }
        ];
    } else if (input.includes("打听") || input.includes("问") || input.includes("聊天")) {
        narrative = `你向${npc}问起这${loc}的规矩。${npc}打量你片刻，言语间有几分试探，倒也没完全拒你于门外。"外乡人，想在这里活得好，先学会低头看路。"`;
        changes.relationships = { [npc]: "对方话虽不多，但看你的眼神少了些戒备，多了点可有可无的兴趣。" };
        changes.skills = { "交谈": "这番对话让你意识到，打听消息比想象中更需要耐心和分寸。" };
        choices = [
            { text: "继续追问这世界的规则", action: "ask_more" },
            { text: "换个话题，聊点轻松的", action: "change_topic" },
            { text: "道谢后离开", action: "leave" }
        ];
    } else if (input.includes("结束") || input.includes("下一天")) {
        narrative = `你决定结束今日的行动。${loc}渐渐安静下来，你合上眼，等待新的一天。`;
        changes.period = "morning";
        changes.current_date = { ...S.gameState.current_date, day: S.gameState.current_date.day + 1 };
        choices = [
            { text: "开始新的一天", action: "new_day" }
        ];
    } else if (input.includes("走") || input.includes("逛") || input.includes("去")) {
        const places = (getWorldLoreKB().snippets || []).filter(s => s.category === "地点");
        const place = places.length ? places[0].title : "附近的集市";
        narrative = `你沿着${loc}的小路走去，来到了${place}。这里人来人往，烟火气扑面而来。你注意到一个摊位前围了不少人。`;
        changes.current_location = place;
        changes.attributes = { perception: "一路走下来，你学会从嘈杂中分辨出对自己有用的声响。" };
        changes.skills = { "观察": "你开始懂得，热闹背后的安静角落往往藏着更多东西。" };
        changes.inventory = [{ op: "add", item_id: "herb", name: "草药", count: 1 }];
        choices = [
            { text: "上前看看热闹", action: "approach" },
            { text: "找地方歇脚", action: "rest" },
            { text: "继续探索别处", action: "explore" }
        ];
    } else if (input.includes("死") || input.includes("自杀")) {
        narrative = `你做出了一个无法挽回的决定。周围的世界骤然安静下来，${loc}的灯火在视野中逐渐模糊，直至黑暗吞没一切。`;
        changes.is_alive = false;
        changes.death_reason = "主动放弃生命";
        choices = [];
    } else {
        narrative = `你在${loc}做出了尝试。周围的世界似乎因为你的举动泛起了微小的涟漪，但一切都还在规则之内缓缓流动。`;
        changes.attributes = { courage: "这一尝试未必聪明，却让你觉得自己至少还敢迈出这一步。" };
        choices = [
            { text: "继续行动", action: "continue" },
            { text: "先观察周围", action: "observe" },
            { text: "找个人搭话", action: "talk" }
        ];
    }

    return {
        narrative,
        choices,
        state_changes: changes,
        is_forced_plot: false,
        next_period: getNextPeriod(S.gameState.current_date.period),
        comment: "模拟响应",
        key_facts: summarizeFactsFromChanges(input, narrative, changes)
    };
}
