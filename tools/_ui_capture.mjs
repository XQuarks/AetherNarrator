import { chromium } from 'playwright-core';
import fs from 'fs';

const ROOT = 'C:/Users/guoxiaoyan/Desktop/AetherNarrator';
const DIR = ROOT + '/docs/_shots';
fs.mkdirSync(DIR, { recursive: true });
const URL = 'http://127.0.0.1:8137/index.html';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

await page.goto(URL, { waitUntil: 'load' }).catch(e => console.log('goto warn:', e.message));
await page.waitForTimeout(3500);
await page.addStyleTag({ content: '#bgMotes,.mist,.vignette{pointer-events:none!important;}' }).catch(()=>{});

const ok = [], fail = [];
async function step(name, fn) {
  try { await fn(); await page.waitForTimeout(250); ok.push(name); console.log('OK  ', name); }
  catch (e) { fail.push(name + ' :: ' + e.message.split('\n')[0]); console.log('FAIL', name, '->', e.message.split('\n')[0]); }
}
async function shot(n) { await page.screenshot({ path: `${DIR}/${n}.png` }); }
// 兜底关闭：点击关闭按钮 + 直接移除 .show，确保无残留遮罩
async function forceClose(id) {
  await page.click(`[data-action="closeModal"][data-modal="${id}"]`).catch(()=>{});
  await page.evaluate((i) => { const el = document.getElementById(i); if (el) el.classList.remove('show'); }, id).catch(()=>{});
  await page.waitForTimeout(250);
}
// 切换主屏幕前，清掉所有弹窗遮罩
async function clearModals() {
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay.show, .status-panel-overlay.show, .game-over-overlay.show').forEach(e => e.classList.remove('show'));
  }).catch(()=>{});
  await page.waitForTimeout(200);
}
async function clickTry(a) { try { await page.click(a); return true; } catch { return false; } }

// 1
await step('01-home', async () => { await shot('01-home'); });
// 2
await step('02-settings', async () => { await clickTry('[data-action="showSettingsModal"]'); await page.waitForTimeout(500); await shot('02-settings'); await forceClose('settingsModal'); });
// 3 mock
await step('03-api', async () => {
  await clickTry('[data-action="showApiModal"]'); await page.waitForTimeout(500); await shot('03-api');
  await page.check('#mockMode').catch(()=>{});
  await clickTry('[data-action="saveApiConfig"]'); await page.waitForTimeout(500);
  await clearModals();
});
// 4
await step('04-worldlist', async () => { await clickTry('[data-action="showWorldList"]'); await page.waitForTimeout(700); await shot('04-worldlist'); });
// 5 创建向导
await step('05-create-1', async () => { await clickTry('[data-action="showCreateWorldModal"]'); await page.waitForTimeout(500); await shot('05-create-step1'); });
await step('06-create-2', async () => { await clickTry('[data-action="cwNext"]'); await page.waitForTimeout(400); await shot('06-create-step2'); });
await step('07-create-3', async () => { await clickTry('[data-action="cwNext"]'); await page.waitForTimeout(400); await shot('07-create-step3'); });
await step('08-create-4', async () => { await clickTry('[data-action="cwNext"]'); await page.waitForTimeout(400); await shot('08-create-step4'); await forceClose('createWorldModal'); await clearModals(); });
// 6
await step('09-savelist', async () => { await clearModals(); await clickTry('[data-action="showSaveList"]'); await page.waitForTimeout(700); await shot('09-savelist'); await clickTry('[data-action="goHome"]'); await clearModals(); });
// 7 世界详情 + 知识库
await step('10-worlddetail', async () => {
  await clearModals(); await clickTry('[data-action="showWorldList"]'); await page.waitForTimeout(700);
  await clickTry('.world-list-item'); await page.waitForTimeout(600); await shot('10-worlddetail');
});
await step('11-lore-kb', async () => { await clickTry('[data-action="editWorldLore"]'); await page.waitForTimeout(800); await shot('11-lore-kb'); });
await step('12-lore-graph', async () => { await clickTry('.lore-view-tab[data-lore-view="graph"]'); await page.waitForTimeout(1200); await shot('12-lore-graph'); });
await step('13-lore-time', async () => { await clickTry('.lore-view-tab[data-lore-view="time"]'); await page.waitForTimeout(500); await shot('13-lore-time'); });
await step('14-critic', async () => { await clickTry('[data-action="triggerWorldCritic"]'); await page.waitForTimeout(3000); await shot('14-critic'); await forceClose('criticModal'); });
await step('15-openingfix', async () => {
  await clickTry('[data-action="regenerateOpening"]');
  await clickTry('.opening-fix-actions [data-action="regenerateOpening"]');
  await page.waitForTimeout(3000); await shot('15-openingfix'); await forceClose('openingFixModal');
});
await step('16-rule', async () => {
  await forceClose('loreReviewModal'); await clearModals();
  await clickTry('[data-action="openRuleEditor"]'); await page.waitForTimeout(800); await shot('16-rule');
  await forceClose('ruleEditorModal'); await clearModals();
});
// 8 进游戏
await step('17-game', async () => {
  await clickTry('[data-action="showWorldList"]'); await page.waitForTimeout(600);
  await clickTry('.world-list-item'); await page.waitForTimeout(600);
  await clickTry('[data-action="startGame"]'); await page.waitForTimeout(3500); await shot('17-game');
});
await step('17b-play', async () => {
  await page.fill('#playerInput', '我环顾四周，试图理清此刻的处境。').catch(()=>{});
  await clickTry('[data-action="submitInput"]'); await page.waitForTimeout(3500); await shot('17b-game-log');
});
await step('18-status', async () => { await clickTry('[data-action="showStatusPanel"]'); await page.waitForTimeout(800); await shot('18-status'); await forceClose('statusPanelOverlay'); await clearModals(); });
await step('19-gamesettings', async () => { await clickTry('[data-action="showGameSettings"]'); await page.waitForTimeout(500); await shot('19-gamesettings'); });
await step('20-authornote', async () => { await clickTry('[data-action="showAuthorNoteModal"]'); await page.waitForTimeout(500); await shot('20-authornote'); await forceClose('authorNoteModal'); await forceClose('gameSettingsModal'); await clearModals(); });
await step('21-gameover', async () => {
  await page.evaluate(() => { const el = document.getElementById('gameOverOverlay'); if (el) el.classList.add('show'); });
  await page.waitForTimeout(400); await shot('21-gameover');
  await page.evaluate(() => { const el = document.getElementById('gameOverOverlay'); if (el) el.classList.remove('show'); });
});
// 9 存档详情
await step('22-savedetail', async () => {
  await clickTry('[data-action="goHome"]'); await clearModals(); await page.waitForTimeout(400);
  await clickTry('[data-action="showSaveList"]'); await page.waitForTimeout(700);
  const has = await page.$('.save-item');
  if (has) { await clickTry('.save-item'); await page.waitForTimeout(600); await shot('22-savedetail'); }
  else console.log('  (no save yet)');
});

console.log('\n=== SUMMARY ===');
console.log('OK  :', ok.length, '->', ok.join(', '));
console.log('FAIL:', fail.length, '->', fail.join(' | '));
console.log('ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 12)) : 'none');
await browser.close();
console.log('DONE');
