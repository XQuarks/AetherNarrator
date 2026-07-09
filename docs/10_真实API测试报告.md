# 真实 API 端到端测试报告

## 0. 初始化与连通性
- init() 完成；demo 世界数量=2
- 选定世界: 红楼梦 · 大观园 / id=demo_红楼梦
- 系统提示词字符数≈10930（约 6831 tokens，仅估算）

## 1. 非流式多轮（turn 1-4，真实 API）
- turn1: status=OK apiCalled=true 命中=0/6952 prompt=6952 completion=876 叙事字数=225 选项数=3 估算¥0.0087
- turn2: status=OK apiCalled=true 命中=6912/8231 prompt=8231 completion=907 叙事字数=223 选项数=3 估算¥0.00382
- turn3: status=OK apiCalled=true 命中=8192/9535 prompt=9535 completion=840 叙事字数=264 选项数=4 估算¥0.00384
- turn4: status=OK apiCalled=true 命中=9472/10862 prompt=10862 completion=816 叙事字数=170 选项数=4 估算¥0.00397

## 2. 流式一轮（turn 5，真实 API，验证 streaming 路径 + usage 捕获）
- turn5(stream): status=OK 命中=10752/12111 prompt=12111 completion=658 叙事字数=310 选项数=4 估算¥0.00375

## 3. 缓存未命中分析（核心关注点）
- call#1: hit=0 miss=6952 prompt_tokens=6952 completion=876 hitRate=0.0%
- call#2: hit=6912 miss=1319 prompt_tokens=8231 completion=907 hitRate=84.0%
- call#3: hit=8192 miss=1343 prompt_tokens=9535 completion=840 hitRate=85.9%
- call#4: hit=9472 miss=1390 prompt_tokens=10862 completion=816 hitRate=87.2%
- call#5: hit=10752 miss=1359 prompt_tokens=12111 completion=658 hitRate=88.8%
- 首轮命中率=0.0%（预期≈0%，冷启动）
- 末轮命中率=88.8%（预期随对话增长而上升，system+历史前缀被缓存）

## 4. 离线 JSON 容错测试（不耗 token，覆盖易出错点）
- [PASS] Markdown 代码围栏 → 解析出字段: narrative,choices
- [PASS] 尾部多余逗号 → 解析出字段: narrative,choices,state_changes
- [PASS] 截断（缺闭合括号） → 解析出字段: narrative,choices,state_changes
- [PASS] 多对象（取第一个） → 解析出字段: narrative,choices,state_changes
- [PASS] 前后多余文字 → 解析出字段: narrative,choices

## 5. 汇总
- 真实 API 调用次数: 5
- 累计 prompt_tokens≈47691, completion_tokens≈4097
- 累计估算费用≈¥0.02408（费率假设 ¥1/M 输入 / ¥0.1/M 缓存命中 / ¥2/M 输出，仅供参考，以平台账单为准）
- 各轮状态: turn1=OK, turn2=OK, turn3=OK, turn4=OK, turn5(stream)=OK
