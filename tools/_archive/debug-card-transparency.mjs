import { chromium } from 'playwright-core';
import fs from 'fs';

const ROOT = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator';
const DIR = ROOT + '/docs/_shots';
fs.mkdirSync(DIR, { recursive: true });
const URL = 'http://127.0.0.1:8137/index.html';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });

async function inspect(viewport, name, theme) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'load' }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(1200);
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); localStorage.setItem('theme', t); }, theme);
  await page.click('[data-action="showWorldList"]').catch(() => {});
  await page.waitForTimeout(1800);

  const info = await page.evaluate(() => {
    const card = document.querySelector('.world-card');
    const cs = card ? getComputedStyle(card) : null;
    return {
      activeScreen: document.querySelector('.screen.active')?.id || null,
      theme: document.documentElement.getAttribute('data-theme'),
      cardBg: cs?.background,
      cardBorder: cs?.borderColor,
      cardBackdrop: cs?.backdropFilter,
      cardBoxShadow: cs?.boxShadow,
      motesColor: getComputedStyle(document.documentElement).getPropertyValue('--mote').trim()
    };
  });
  console.log('\n===', name, '===');
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: `${DIR}/transparency-${name}.png`, fullPage: false });
  await page.close();
}

await inspect({ width: 1280, height: 820 }, 'desktop-light', 'light');
await inspect({ width: 390, height: 844 }, 'mobile-light', 'light');
await inspect({ width: 1280, height: 820 }, 'desktop-dark', 'dark');
await inspect({ width: 390, height: 844 }, 'mobile-dark', 'dark');

await browser.close();
console.log('DONE');
