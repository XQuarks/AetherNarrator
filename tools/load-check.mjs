// ============================================================
// _load.mjs — 真实 ESM 加载全链验证（最接近浏览器的 link 检查）
//   node ESM 在"模块求值"前先做 link：任何 import 找不到对应 export
//   会在此阶段抛 SyntaxError，早于任何顶层 DOM 调用。
//   顶层 document/init() 用宽容 stub 兜底，令其软执行通过。
// ============================================================

// 万能代理：任何属性/调用/构造都返回自身，吞掉一切 DOM 操作
const any = new Proxy(function () {}, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : any),
  apply: () => any,
  construct: () => any,
  has: () => true,
});

const def = (k, v) => { try { globalThis[k] = v; } catch { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } };
def("window", globalThis);
def("document", any);
def("navigator", { userAgent: "node", language: "zh" });
def("location", { href: "http://localhost/", origin: "http://localhost" });
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = () => Promise.reject(new Error("stub-fetch"));
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.alert = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, addListener: () => {} });

let rejections = 0;
process.on("unhandledRejection", (r) => { rejections++; /* init() 内部异步失败，不算 link 错误 */ });

const MODULES = ["store","utils","theme","storage","files","rag","prompt","llm","render","game","app"];

let ok = 0, fail = 0;
for (const m of MODULES) {
  try {
    await import(`../src/${m}.js`);
    console.log(`  ✅ ${m}.js 加载成功`);
    ok++;
  } catch (e) {
    console.log(`  ❌ ${m}.js 加载失败: ${e.message}`);
    fail++;
  }
}

console.log(`\n加载结果: ${ok} 成功 / ${fail} 失败（init 内部异步 rejection ${rejections} 次，与 link 无关）`);
process.exit(fail === 0 ? 0 : 1);
