// 可选工具：为纯静态单文件生成 hash-source 版 CSP，以彻底去掉 'unsafe-inline'。
// 前置条件：所有 HTML 内联事件属性（onclick= 等）已迁移为事件委托（见 index.html 的
// document.addEventListener 委托）。本脚本会检查是否仍有残留内联事件属性。
//
// 用法：node tools/recompute-csp-hash.js
// 输出：内联 <script> 块的 sha256 哈希，以及建议的收紧版 CSP 字符串。
const fs = require('fs');
const crypto = require('crypto');
const p = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator/index.html';
const c = fs.readFileSync(p, 'utf8');

// 提取所有内联 <script>（无 src 属性）块内容
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(c)) !== null) scripts.push(m[1]);
if (!scripts.length) { console.log('未找到内联 <script> 块'); process.exit(1); }

const hashes = scripts.map((s) => {
  const h = crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  return "'sha256-" + h + "'";
});

// 检查 HTML 部分是否仍有内联事件属性（排除 <script> 块内的 .onclick= 运行时赋值）
const htmlPart = c.replace(/<script>[\s\S]*?<\/script>/g, '');
const eventAttrs = htmlPart.match(/\son[a-z]+\s*=\s*"/gi);
const remaining = eventAttrs ? eventAttrs.length : 0;

console.log('内联 <script> 块数量:', scripts.length);
console.log('hash-source:', hashes.join(' '));
if (remaining > 0) {
  console.log('警告: HTML 中仍有 ' + remaining + ' 处内联事件属性 (on*="...")。启用 hash CSP 前必须将它们迁移为事件委托，否则这些控件会失效。');
} else {
  console.log('OK: 未发现 HTML 内联事件属性，可安全启用 hash CSP。');
}

const csp = `default-src 'self'; script-src 'self' ${hashes.join(' ')} https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
console.log('\n建议的收紧版 CSP（去 unsafe-inline，改用 hash）。请将 index.html 的 CSP meta 内容替换为：\n');
console.log(csp);
