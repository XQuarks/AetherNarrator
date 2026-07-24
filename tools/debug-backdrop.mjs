import { chromium } from 'playwright-core';
import path from 'path';

const ROOT = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

async function capture(theme, filename) {
  await page.goto('http://127.0.0.1:8137/index.html');
  await page.waitForTimeout(800);
  if (theme === 'light') {
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('theme', 'light'); });
    await page.waitForTimeout(200);
  }
  await page.click('[data-action="showWorldList"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(ROOT, 'docs/_shots', filename), fullPage: false });
}

await capture('dark', 'debug-dark.png');
await capture('light', 'debug-light.png');

await browser.close();
