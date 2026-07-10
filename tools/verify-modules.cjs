// ============================================================
// _verify.js — 拆分产物静态校验（无浏览器环境唯一保障）
//   1) 逐模块解析，收集 export / import
//   2) link 校验：每个 import 的具名符号必须在来源模块 export 中存在
//   3) 自引用校验：模块不得 import 自己
//   4) 裸状态引用校验：36 个状态名不得以裸标识符出现（必须 S.xxx）
//      —— 排除：MemberExpression.property、对象键、import specifier、
//         变量声明 id、S 容器定义文件 store.js 自身
// ============================================================
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const walk = require("acorn-walk");

const SRC = path.join(__dirname, "..", "src");
const MODULES = ["store","utils","theme","storage","files","rag","prompt","llm","render","game","app"];

// 36 个状态名（store.js 的 S 容器字段）
const STATE_NAMES = new Set([
  "gameState","loreKB","loreEmbeddings","conversationHistory","chatHistory","chatSummary",
  "systemPromptTemplate","cachedSystemPrompt","cachedSysPromptWorldId","currentChoices",
  "embeddingModel","currentWorld","worlds","saves","currentStatusTab","sourceFileContent",
  "currentTheme","currentSession","currentAbortController","isGenerating","lastCacheStats",
  "debugLog","themeClickCount","themeClickTimer","lastFocusedBeforeModal","fontSizeSetting",
  "temperatureSetting","renderedEntryCount","typingTimer","typingIndex","typingResolver",
  "_zhSegmenter","vectorUnavailableWarned","toastTimer","loadingStartTime","loadingInterval"
]);

function parse(code) {
  return acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
}

const exportsMap = {};   // module -> Set(exported names)
const importsMap = {};    // module -> [{name, source}]
const bareStateHits = {}; // module -> [{name, line}]

for (const m of MODULES) {
  const file = path.join(SRC, m + ".js");
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try { ast = parse(code); }
  catch (e) { console.error(`[PARSE FAIL] ${m}.js: ${e.message}`); process.exit(1); }

  const exp = new Set();
  const imp = [];
  const bare = [];

  for (const node of ast.body) {
    // ---- exports ----
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        const d = node.declaration;
        if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") exp.add(d.id.name);
        else if (d.type === "VariableDeclaration") d.declarations.forEach(x => exp.add(x.id.name));
      }
      node.specifiers.forEach(s => exp.add(s.exported.name));
    } else if (node.type === "ExportDefaultDeclaration") {
      exp.add("default");
    }
    // ---- imports ----
    else if (node.type === "ImportDeclaration") {
      const src = node.source.value;
      node.specifiers.forEach(s => {
        const name = s.local.name;
        const imported = s.imported ? s.imported.name : (s.type === "ImportDefaultSpecifier" ? "default" : "*");
        imp.push({ name: imported, local: name, source: src, line: node.loc.start.line });
      });
    }
  }
  exportsMap[m] = exp;
  importsMap[m] = imp;

  // ---- 裸状态引用扫描 ----
  // 关键：必须用 fullAncestor —— ancestor/simple 遍历不访问 Pattern 位置的标识符
  // （如 `gameState = ...` 赋值左值），会造成致命假阴性
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (node.type !== "Identifier") return;
    if (!STATE_NAMES.has(node.name)) return;
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return;
    // 跳过 MemberExpression 的 property（S.gameState 的 gameState / obj.currentWorld）
    if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
    // 跳过对象键 {gameState: ...}
    if (parent.type === "Property" && parent.key === node && !parent.computed) return;
    // 跳过 import/export specifier
    if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier") return;
    if (parent.type === "ExportSpecifier") return;
    // 跳过变量声明 id（let gameState）
    if (parent.type === "VariableDeclarator" && parent.id === node) return;
    // 跳过函数参数
    if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && parent.params.includes(node)) return;
    bare.push({ name: node.name, line: node.loc.start.line });
  });
  bareStateHits[m] = bare;
}

// ---- 报告 ----
let errors = 0;

console.log("========== 1) 自引用 & LINK 校验 ==========");
for (const m of MODULES) {
  for (const i of importsMap[m]) {
    const target = i.source.replace(/^\.\//, "").replace(/\.js$/, "");
    if (target === m) {
      console.log(`  ❌ [SELF-IMPORT] ${m}.js:${i.line} import { ${i.name} } from "${i.source}"`);
      errors++;
      continue;
    }
    if (!MODULES.includes(target)) continue; // 外部模块跳过
    if (i.name === "*" || i.name === "default") continue;
    if (!exportsMap[target].has(i.name)) {
      console.log(`  ❌ [MISSING EXPORT] ${m}.js:${i.line} import { ${i.name} } from "${i.source}" —— ${target}.js 未导出 ${i.name}`);
      errors++;
    }
  }
}
if (errors === 0) console.log("  ✅ 所有 import 均能在来源模块找到对应 export，无自引用");

console.log("\n========== 2) 裸状态引用校验（应为 0，全部须 S.xxx）==========");
let bareTotal = 0;
for (const m of MODULES) {
  if (m === "store") continue; // store.js 定义 S，跳过
  const hits = bareStateHits[m];
  if (hits.length) {
    console.log(`  ❌ ${m}.js: ${hits.length} 处裸状态引用`);
    // 聚合展示
    const byName = {};
    hits.forEach(h => { (byName[h.name] = byName[h.name] || []).push(h.line); });
    for (const [name, lines] of Object.entries(byName)) {
      console.log(`       ${name}: 行 ${lines.join(", ")}`);
    }
    bareTotal += hits.length;
    errors += hits.length;
  }
}
if (bareTotal === 0) console.log("  ✅ 无裸状态引用");

console.log("\n========== 3) 缺失 import 校验（用了跨模块导出符号却未 import）==========");
// 全模块导出符号 -> 来源模块
const exportedFrom = {};
for (const m of MODULES) for (const nm of exportsMap[m]) { if (nm !== "default") (exportedFrom[nm] = exportedFrom[nm] || []).push(m); }
// 各模块顶层本地定义 + import locals
const localDefs = {};
for (const m of MODULES) {
  const code = fs.readFileSync(path.join(SRC, m + ".js"), "utf8");
  const ast = parse(code);
  const defs = new Set(importsMap[m].map(i => i.local));
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") defs.add(node.id.name);
    else if (node.type === "VariableDeclaration") node.declarations.forEach(d => { if (d.id.type === "Identifier") defs.add(d.id.name); });
    else if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const d = node.declaration;
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") defs.add(d.id.name);
      else if (d.type === "VariableDeclaration") d.declarations.forEach(x => { if (x.id.type === "Identifier") defs.add(x.id.name); });
    }
  }
  localDefs[m] = defs;
}
let missImp = 0;
for (const m of MODULES) {
  const code = fs.readFileSync(path.join(SRC, m + ".js"), "utf8");
  const ast = parse(code);
  const reported = new Set();
  walk.fullAncestor(ast, (node, _s, ancestors) => {
    if (node.type !== "Identifier") return;
    const name = node.name;
    if (!exportedFrom[name]) return;             // 不是任何模块导出的符号
    if (exportedFrom[name].includes(m)) return;   // 本模块自己导出的
    if (localDefs[m].has(name)) return;           // 已 import 或本地定义
    if (reported.has(name)) return;
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return;
    if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
    if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return;
    if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ExportSpecifier") return;
    if (parent.type === "VariableDeclarator" && parent.id === node) return;
    reported.add(name);
    console.log(`  ❌ ${m}.js: 使用了 ${name}（导出自 ${exportedFrom[name].join("/")}.js）但未 import`);
    missImp++; errors++;
  });
}
if (missImp === 0) console.log("  ✅ 所有跨模块符号引用均已正确 import");

console.log("\n========== 汇总 ==========");
console.log(errors === 0 ? "  ✅✅✅ 全部校验通过" : `  ❌ 共 ${errors} 个问题待修复`);
process.exit(errors === 0 ? 0 : 1);
