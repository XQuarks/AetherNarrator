# docs/39 · ANN 索引持久化方案（对应 docs/34 #14）

> 状态：**已实施（2026-07-28，路径 A）**。本文基于代码实测，非猜测。
> 关联：docs/34 §3.4 #14、docs/20 §1.5/§5、docs/Phase0-Phase1改造方案.md:110、docs/架构评估与方案脑暴.md:95。
> 实施落点：`src/ann-index.js`（snippetFingerprint / annFileName / getLoreAnnIndex 持久化路径 / clearLoreAnnCache 清除缓存）；新增 `test/41-ann-persist.test.js`（3 项）+ `test/42-ann-clear-cache.test.js`（2 项）。验证：`syntax_check`+`verify-modules`+`npm test` 全绿（414/414）。设置界面「选项」页已加「清除索引缓存」入口（呼应 #16）。

---

## 一、用大白话讲清楚这是啥

知识库的"语义检索"（你说一句话，它懂意思、找出相关设定）背后靠一个**向量索引**（技术名 HNSW）。
现在的问题是：**每次刷新页面，这个索引都要从零搭一遍**——把已经存好的向量（设定片段的数字表示）重新塞进索引结构。世界大、设定多的时候，搭索引会"瞬间冻住界面一下"。

目标：让索引在浏览器里**存下来**，刷新直接读、不用重建 → 不卡。

---

## 二、现状根因（代码实测，非猜测）

| 事实 | 证据 | 含义 |
|---|---|---|
| 向量本身**已经存盘** | `rag.js:239` `ensureLoreEmbeddings` 检查 `s.embedDim===EMBED_DIM && s.embedModel===EMBED_MODEL` 才跳过；`snippet.embedding` 随存档持久化 | 刷新**不会重算向量**（只有换模型/老存档才重算） |
| 重建 = 同步 `addPoint` | `ann-index.js:53` `valid.forEach(s => index.addPoint(...))` | 这是**同步 wasm 调用**，跑完才放手，期间**主线程冻结、界面卡住** |
| 内存缓存刷新即清空 | `ann-index.js:18` `_cache` 是模块级 `Map`，仅当前页面生命周期 | 刷新 → 缓存没了 → 重新 `buildLoreIndex` |
| 库能力被主动关掉 | `ann-index.js:49` `new HierarchicalNSW(space, dim, "")` 第 3 参传空串 = 关闭自动存盘 | 持久化能力现成，只是没开 + 没接同步 |

文档自己记录：`2000×512` 建索引"约 2s……可接受"（架构评估.md:95），但**同步阻塞**对玩家就是"点开世界卡一下"。

---

## 三、好消息：库自带存储能力（已确认）

用的 `hnswlib-wasm 0.8.2` 浏览器版，内嵌 **Emscripten IDBFS（IndexedDB 虚拟文件系统）**：

- `vendor/ann/hnswlib.js` 文件头暴露 `IDBFS_STORE_NAME="FILE_DATA"`、`syncFileSystem("read"/"write")`、`initializeFileSystemAsync("IDBFS")`。
- `loadHnswlib()`（`hnswlib.js` 尾部）**已经初始化了 IDBFS**。
- 但当前 `ann-index.js` 构造索引传 `autoSaveFilename=""` 关掉自动存盘，且**从没人调用 `syncFileSystem`** 把虚拟 FS 刷进 IndexedDB。

→ "持久化"在库层面是现成的，只是被关了 + 没接 sync 这一步。**写入侧（autoSave→虚拟FS）确定可用；读取侧（loadIndex）已用探针确认存在（见 §九）。**

---

## 四、两条路（要你拍板选哪条 / 还是组合）

### 路径 A：真·持久化（符合"持久化"字面）
- **做法**：构造时开 `autoSaveFilename`（带版本标识）→ 构建/编辑后 `syncFileSystem("write")` 把索引落 IndexedDB → 启动 `loadHnswlib` 后 `syncFileSystem("read")` 恢复虚拟 FS → `loadIndex` 读回索引，跳过 `addPoint`。
- **收益**：刷新/重开直接读索引，**零重建延迟**，大世界收益最大。
- **复杂度/风险：中高**。要管：
  1. **版本化**：模型/维度变了旧索引必须失效，文件名带 `sig`（`dim`+模型简写）。
  2. **失效**：编辑/切世界要删旧文件 + 重建 + 重新 sync（扩展现有 `invalidateLoreAnn`）。
  3. **启动恢复顺序**：先 `sync read` 再 `loadIndex`。
  4. **IDBFS 是整 FS 镜像**：单世界索引约 `2000×512×4≈4MB`，多世界叠加，IndexedDB 容量足够（但需给"清除索引缓存"入口）。
  5. **sync 有 4s 超时 + 错误处理**（库内 `waitForFileSystemSynced`）。
  6. **读取侧 `loadIndex` 是否暴露未 100% 确认**（写入侧确定）。
- **改动文件**：`src/ann-index.js`（主）、`src/rag.js`/`src/lore-ui.js`/`src/save.js` 的 invalidate 钩子。

### 路径 B：异步构建（不持久化，但解卡顿）
- **做法**：保持内存构建（现状），把同步 `addPoint` 挪到 **Web Worker** 跑，主线程不冻结；加"索引构建中"轻提示。
- **收益**：直接消除"冻界面"痛点，逻辑最简单。
- **复杂度/风险：低~中**。**但** HNSW 索引是 wasm 堆对象，**不能 `postMessage` 直接传回主线程**，得在 Worker 内建好并 search、或传回序列化字节——这条本身也有坑，未必比 A 简单。
- **实质**：没真正"持久化"，刷新仍重建（只是不冻界面）。

---

## 五、推荐

- 若你要的是字面"**持久化**"、且想彻底消除刷新卡顿 → **路径 A**（先跑探针验证 `loadIndex`，通过则做 A；不通过自动降级 B）。
- 若你只关心"**别卡**"、不在乎刷新是否重建 → 路径 B。
- **我倾向路径 A**：库能力现成，一次性把 #14 做扎实；探针门控把读取侧风险提前暴露，不会写到一半才发现读不回。

---

## 六、工程细节（路径 A）

- **版本化**：持久化文件名带 `sig`，如 `/ann_idx_<worldId>_<sig>.hnsw`；`load` 前校验 `sig` 一致，否则重建。当前 `getLoreAnnIndex` 已用 `sig=dim` 作内存键（ann-index.js:71），复用即可。
- **失效**：现有 `invalidateLoreAnn(worldId)`（ann-index.js:89）扩展为同时删对应持久化文件 + 清内存缓存；`lore-ui.js`（词条增删改）、`save.js`（切世界/读档）的失效钩子一并接上。
- **启动恢复**：`_HNSWLib` 首次加载后做一次 `syncFileSystem("read")`；`getLoreAnnIndex` 先尝试 `loadIndex`（命中且 `sig` 一致则返回），否则 `buildLoreIndex` → `saveIndex` → `syncFileSystem("write")`。
- **存储估算**：约 4MB/世界；需在设置/调试面板给"清除 ANN 索引缓存"入口（呼应 #16 清理）。
- **回滚**：SourceTree revert 即可；纯新增逻辑，不碰存档/世界数据格式（与 Phase0 方案.md:128 风险评级一致）。

### 第 0 步（实施前必做）：探针验证
- 写 `tools/` 临时脚本（验证后归档 `_archive/`），在浏览器/node 加载该 wasm，确认：
  1. `HierarchicalNSW` 实例是否暴露 `loadIndex`/`saveIndex`（或 autoSave 文件恢复机制）；
  2. `syncFileSystem("read"/"write")` 往返是否真把索引落进 IndexedDB（`FILE_DATA`）、重启后能 `loadIndex` 恢复。
- **gate**：探针通过 → 走路径 A；探针证明库不支持 `loadIndex` → 降级路径 B（异步构建）。不通过绝不硬写。

---

## 七、测试

- **探针**：`tools/ann-persist-probe`（临时）→ 验证 save/load + IDBFS sync 往返 → 归档。
- **单元**：现有 `test/ann.test.js`（mock 注入，ann-index.js `__setTestHnswLib`）保持通过；新增：持久化命中 / 失效重建 / 版本错配重建 的 node 测试（用 `_testLib` mock 模拟 save/load）。
- **浏览器手测**：大世界刷新前后检索延迟对比（用现有 `tools/ann-browser-test.mjs` 思路）。

---

## 八、决策已落地（2026-07-28）

黎总确认：**走路径 A（真·持久化）**。三件事一并确认：
1. **路径 A** 已实施（见 §九）。
2. 接受 **IDBFS 整 FS 镜像**存储方式（单世界约 4MB×世界数；IndexedDB 容量充足，待加"清除 ANN 索引缓存"入口）。
3. **第 0 步探针已跑**——结论：`loadIndex`/`writeIndex`/`saveIndex` 均存在于内联 wasm（用 base64 解码后搜 embind 字符串确认），`HierarchicalNSW`/`initIndex`/`addPoint`/`searchKnn` 亦在。Node 因 wasm 仅编译给浏览器环境无法实跑，但方法存在性已确证。

> 注：#14 实质是"功能"非"债"（docs/38 §六 已单列），复杂度高于一般小修；故按项目"大改动先出方案"规矩走此文档。

---

## 九、实施记录（2026-07-28，路径 A）

### 落地方案（与 §四/§六 方案一致，细节微调）
- **文件名含"内容指纹"**而非仅 `dim`：`ann_<worldId>_<dim>_<fp>_v1.idx`。
  - `fp = FNV-1a(snippets 的 id+category+title+content+keywords)`。编辑任一片段文本 → fp 变 → 旧文件名失配 → `loadIndex` 找不到 → 自动重建。
  - **好处**：无需在 `invalidateLoreAnn` 里显式删文件；天然抗"编辑后未检索就刷新"的边角情况（旧文件只是成为孤儿，不影响正确性）。
- **读回顺序**：`loadHnswlib` 后首次调用 `syncFileSystem("read")` 把 IDBFS 从 IndexedDB 恢复到虚拟 FS（每会话一次）→ `loadIndex(fileName)`；命中则跳过 `addPoint`。
- **写出**：`buildLoreIndex` 后 `index._raw.writeIndex(fileName)`（写虚拟 FS）→ `_glue.syncFileSystem("write")` 刷 IndexedDB。
- **优雅降级（不破坏现有行为）**：
  - 库未暴露 `loadIndex`（无该方法的环境）→ 跳过读回，走内存重建；`getLoreAnnIndex` 仍正常缓存。
  - `syncFileSystem`/`writeIndex` 任一步抛错 → `catch` 静默忽略，内存索引仍可用；最终由 `rag.js` 的 O(n) 兜底承接。
  - 读回的索引 `size===0`（无有效向量）→ 视为未命中，回落重建并抛"没有可索引的有效向量" → `rag.js` 兜底。
- **改动文件**：仅 `src/ann-index.js`（主，+wrapLoreIndex/snippetFingerprint/annFileName + getLoreAnnIndex 持久化分支）。`rag.js`/`lore-ui.js`/`save.js` 的 `invalidateLoreAnn` 调用点**无需改动**——内容指纹自动处理失效。

### 测试
- 新增 `test/41-ann-persist.test.js`（3 项，mock 注入支持 loadIndex/writeIndex）：
  1. 首次构建并 writeIndex；`invalidate` 后读回应不重建（addPoint 调用数不变）。
  2. 编辑片段 content → fp 变 → 写入不同名新文件（旧文件孤儿化），验证自动失效。
  3. 库无 loadIndex 时优雅回落（缓存/失效行为不变）。
- 新增 `test/42-ann-clear-cache.test.js`（2 项，带 FS.readdir/unlink 的 mock）：
  1. `clearLoreAnnCache` 仅删 `ann_*.idx`（保留 notes.txt 等非 idx/非 ann 文件），返回删除计数。
  2. 库无 FS 时优雅返回 0（不抛错）。
- 全量 `npm test`：414/414 通过（原 409 + 5），`syntax_check`/`verify-modules` 全绿。

### 残留待办（非阻塞）
- ~~**孤儿文件清扫**：编辑历史会在 IDBFS 留下不同 fp 的旧 `.idx`（每世界累计若干，单文件约 4MB）。~~ ✅ **已做**：设置界面「选项」页新增「清除索引缓存」卡片与按钮，`clearLoreAnnCache` 利用 hnswlib 模块暴露的 `FS`（EXPORTED_RUNTIME_METHODS 含 'FS'）`readdir`+`unlink` 删除全部 `ann_*.idx` 并 `syncFileSystem("write")` 刷盘；两次点击确认（禁用原生 confirm），失败静默降级、不影响存档/剧情。
- ~~**"清除索引缓存"入口**：用户手动腾空间/排错用。~~ ✅ 已落地（见上）。
- **浏览器手测**：大世界刷新前后检索延迟对比（沙箱无浏览器，待本机跑）。
