#!/usr/bin/env node
// 最小回归测试：从 index.html 提取内联经典脚本，在 vm 沙箱中加载并断言核心纯函数。
// 覆盖 P1.2.5/tryRepairJSON、P1.2.10/escapeRegExp、P2.2.11/isNonStoryResponse、P2.2.14/getPeriodLabel。
// 采用原生 node 断言，避免为单文件纯前端项目强加 Vitest 构建链（功能等价于 Vitest 用例）。
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, classicCode = "";
while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  const code = m[2] || "";
  if (/\bsrc=/.test(attrs)) continue;
  if (/type\s*=\s*["']?module/i.test(attrs)) continue;
  classicCode += code + "\n;\n";
}

// ---- 万能 mock：让脚本顶层初始化在 node 下不抛错 ----
function makeEl() {
  const handler = {
    get(t, p) {
      if (p === "style") return {};
      if (p === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === "dataset") return {};
      if (p === "value") return "";
      if (p === "files") return [];
      if (p === "textContent" || p === "innerHTML") return "";
      if (p === "length") return 0;
      if (typeof p === "string" && ["focus", "blur", "click", "appendChild", "removeChild", "setAttribute", "removeAttribute", "addEventListener", "removeEventListener", "querySelector", "querySelectorAll", "getAttribute", "closest", "remove", "setProperty", "getPropertyValue"].includes(p)) {
        return (...a) => makeEl();
      }
      if (p === Symbol.toPrimitive) return () => "";
      if (p === "then") return undefined;
      return makeEl();
    },
    set() { return true; },
    apply() { return makeEl(); }
  };
  return new Proxy(function () {}, handler);
}
const documentMock = {
  getElementById: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => makeEl(),
  body: makeEl(),
  documentElement: makeEl()
};
const store = {};
const localStorageMock = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const sandbox = {
  document: documentMock,
  localStorage: localStorageMock,
  navigator: { userAgent: "node", language: "zh-CN" },
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error("no network in test")),
  location: { href: "" },
  alert: () => {}, confirm: () => true,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener: () => {}, removeEventListener: () => {},
  scrollTo: () => {}, scroll: () => {}, open: () => {}, close: () => {},
  JSON, Math, Date, RegExp, Promise, Array, Object, String, Number, Boolean, Symbol, parseInt, parseFloat, isNaN
};
sandbox.window = sandbox;
sandbox.window.matchMedia = sandbox.matchMedia;

let loadError = null;
try {
  vm.createContext(sandbox);
  new vm.Script(classicCode).runInContext(sandbox);
} catch (e) {
  loadError = e;
}

let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.error("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
}
function eq(name, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  assert(name, sa === sb, "期望 " + sb + " 实得 " + sa);
}

if (loadError) {
  console.error("脚本加载失败: " + loadError.message);
  process.exit(1);
}

console.log("\nescapeRegExp (P1.2.10):");
const esc = sandbox.escapeRegExp;
assert("函数存在", typeof esc === "function");
if (typeof esc === "function") {
  eq("转义点", esc("."), "\\.");
  eq("转义星", esc("*"), "\\*");
  eq("转义括号", esc("(a)"), "\\(a\\)");
  eq("转义美元", esc("$"), "\\$");
  eq("组合", esc("a.b*c"), "a\\.b\\*c");
  assert("C++ 可安全构造正则", new RegExp(esc("C++")).test("my C++ class"));
}

console.log("\ntryRepairJSON (P1.2.5):");
const rep = sandbox.tryRepairJSON;
assert("函数存在", typeof rep === "function");
if (typeof rep === "function") {
  eq("闭合单层", JSON.parse(rep('{"a":1')), { a: 1 });
  eq("闭合嵌套+数组", JSON.parse(rep('{"a":[1,2')), { a: [1, 2] });
  eq("截断字符串", JSON.parse(rep('{"n":"hello')), { n: "hello" });
  let threw = false;
  try { rep("彻底损坏{不是json"); } catch (e) { threw = true; }
  assert("彻底损坏抛错（非伪造成功回合）", threw);
}

console.log("\nisNonStoryResponse (P2.2.11):");
const ins = sandbox.isNonStoryResponse;
assert("函数存在", typeof ins === "function");
if (typeof ins === "function") {
  assert("正常叙事不误杀", ins("你推开沉重的木门，走廊尽头传来脚步声。") === false);
  assert("NPC 拒绝台词不误杀", ins("抱歉，我不能告诉你这个秘密，但你可以去问问守卫。") === false);
  assert("系统身份声明判非故事", ins("作为AI语言模型，我无法生成此类内容。") === true);
  assert("内容政策违反判非故事", ins("该请求违反了内容政策。") === true);
  assert("空文本判非故事", ins("") === true);
}

console.log("\ngetPeriodLabel (P2.2.14):");
const gpl = sandbox.getPeriodLabel;
assert("函数存在", typeof gpl === "function");
if (typeof gpl === "function") {
  eq("未知时段回退原值", gpl("zzz_unknown_period"), "zzz_unknown_period");
  assert("常见时段返回字符串", typeof gpl("morning") === "string");
}

console.log("\n结果: " + passed + " 通过, " + failed + " 失败");
process.exit(failed ? 1 : 0);
