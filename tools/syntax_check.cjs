#!/usr/bin/env node
// 语法门禁：校验 index.html 内联脚本无语法错误。
// 单文件 HTML 无法用 `node --check` 直接校验内联 <script>，故用 vm.Script 解析替代。
// 退出码 0=全部通过，1=存在语法错误。
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, i = 0, errors = 0;
while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  const code = m[2] || "";
  i++;
  if (/\bsrc=/.test(attrs)) { console.log(`#${i} 外部脚本 (跳过)`); continue; }
  if (/type\s*=\s*["']?module/i.test(attrs)) {
    console.log(`#${i} module(ESM) 脚本 (跳过，由浏览器/构建验证)`);
    continue;
  }
  try {
    new vm.Script(code);
    console.log(`#${i} 经典脚本 OK (${code.length} 字符)`);
  } catch (e) {
    errors++;
    console.error(`#${i} 语法错误: ${e.message}`);
  }
}
if (errors) {
  console.error(`\n失败: ${errors} 个脚本存在语法错误`);
  process.exit(1);
}
console.log(`\n全部通过: 已校验 ${i} 段内联脚本`);
process.exit(0);
