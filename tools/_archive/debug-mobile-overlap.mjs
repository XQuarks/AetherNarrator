import { chromium } from 'playwright-core';
import path from 'path';

const ROOT = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:8137/index.html');
await page.waitForTimeout(800);
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('theme', 'light'); });
await page.waitForTimeout(200);
await page.click('[data-action="showWorldList"]');
await page.waitForTimeout(800);

const cards = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.world-card')).map((c, i) => {
    const r = c.getBoundingClientRect();
    const cover = c.querySelector('.wc-cover')?.getBoundingClientRect();
    const body = c.querySelector('.wc-body')?.getBoundingClientRect();
    const foot = c.querySelector('.wc-foot')?.getBoundingClientRect();
    return { i, top: r.top, bottom: r.bottom, height: r.height, coverH: cover?.height, bodyH: body?.height, footH: foot?.height };
  });
});
console.log('cards layout:', JSON.stringify(cards, null, 2));

await page.screenshot({ path: path.join(ROOT, 'docs/_shots/debug-mobile-overlap.png'), fullPage: false });
await browser.close();
