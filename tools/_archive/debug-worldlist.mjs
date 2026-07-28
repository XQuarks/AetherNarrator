import { chromium } from 'playwright-core';
import fs from 'fs';

const ROOT = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator';
const DIR = ROOT + '/docs/_shots';
fs.mkdirSync(DIR, { recursive: true });
const URL = 'http://127.0.0.1:8137/index.html';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });

async function inspect(viewport, name) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'load' }).catch(e => console.log('goto warn:', e.message));
  await page.waitForTimeout(1500);
  await page.click('[data-action="showWorldList"]').catch(() => {});
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const card = document.querySelector('.world-card');
    const cover = card?.querySelector('.wc-cover');
    const body = card?.querySelector('.wc-body');
    const foot = card?.querySelector('.wc-foot');
    const content = document.getElementById('worldListContent');
    const cs = card ? getComputedStyle(card) : null;
    return {
      activeScreen: document.querySelector('.screen.active')?.id || null,
      contentGrid: content ? getComputedStyle(content).gridTemplateColumns : null,
      cardHeight: cs?.height,
      cardMinHeight: cs?.minHeight,
      cardMaxHeight: cs?.maxHeight,
      cardOverflow: cs?.overflow,
      cardDisplay: cs?.display,
      cardAlignSelf: cs?.alignSelf,
      cardRect: card ? JSON.stringify(card.getBoundingClientRect()) : null,
      coverRect: cover ? JSON.stringify(cover.getBoundingClientRect()) : null,
      bodyRect: body ? JSON.stringify(body.getBoundingClientRect()) : null,
      footRect: foot ? JSON.stringify(foot.getBoundingClientRect()) : null,
      footComputed: foot ? {
        display: getComputedStyle(foot).display,
        height: getComputedStyle(foot).height,
        minHeight: getComputedStyle(foot).minHeight,
        position: getComputedStyle(foot).position,
        marginTop: getComputedStyle(foot).marginTop
      } : null,
      cardHtml: card ? card.outerHTML.slice(0, 500) : null
    };
  });
  console.log('\n===', name, '===');
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: `${DIR}/debug-${name}.png`, fullPage: false });
  await page.close();
}

await inspect({ width: 1280, height: 820 }, 'desktop');
await inspect({ width: 390, height: 844 }, 'mobile');

await browser.close();
console.log('DONE');
