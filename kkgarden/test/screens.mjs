/* Прогон экранов Клеверника: снимки + проверка, что консоль чистая.
   Запуск из корня репозитория: node kkgarden/test/screens.mjs
   Куда класть снимки: OUT=/куда-нибудь node kkgarden/test/screens.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'index.html');
const out = process.env.OUT || '/tmp';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));

const shot = (n) => page.screenshot({ path: `${out}/kk-${n}.png` });
const closeSheet = async () => { await page.click('.sheet.on [data-close]'); await page.waitForTimeout(500); };

await page.goto(page_url);
await page.waitForTimeout(500);

/* день, растение на середине пути, деньги на весь магазин */
await page.evaluate(() => {
  S.hourOverride = 13; S.coins = 3000; S.water = 60; S.stage = 3; S.prog = 55; S.taps = 4;
  SEEDS.forEach(s => { if (!S.seedsOwned.includes(s.id)) S.seedsOwned.push(s.id); });
  S.album = { clover: 3, chamo: 1 }; S.tasksDone = ['t1'];
  prevStage = -1; save(); render();
});
await page.waitForTimeout(400);
await shot('01-day');

await page.click('#orb'); await page.waitForTimeout(400);
await shot('02-tap');

await page.click('#shopbtn'); await page.waitForTimeout(600); await shot('03-seeds');
await page.click('[data-tab="pot"]'); await page.waitForTimeout(400); await shot('04-pots');
await closeSheet();

await page.click('#tasksbtn'); await page.waitForTimeout(600); await shot('05-tasks');
await closeSheet();
await page.click('#albumbtn'); await page.waitForTimeout(600); await shot('06-album');
await closeSheet();
await page.click('#devbtn'); await page.waitForTimeout(600); await shot('07-dev');

/* готово к сбору */
await page.click('[data-dev="ready"]'); await page.waitForTimeout(200);
await closeSheet();
await page.waitForTimeout(400);
await shot('08-ready');

const coinsBefore = await page.evaluate(() => S.coins);
await page.click('#mainbtn');
await page.waitForTimeout(500);
await shot('09-harvest');
await page.waitForTimeout(900);

/* ночь */
await closeSheet();
await page.click('#devbtn'); await page.waitForTimeout(500);
await page.click('[data-hour="23"]'); await page.waitForTimeout(300);
await closeSheet();
await page.waitForTimeout(700);
await shot('10-night');

const st = await page.evaluate(() => ({
  coins: S.coins,
  album: S.album,
  stage: S.stage,
  swayAnim: getComputedStyle(document.querySelector('.sway')).animationName,
  growAnim: getComputedStyle(document.querySelector('.grow')).animationName,
  scrollW: document.documentElement.scrollWidth,
  viewW: window.innerWidth
}));

const fail = [];
if (st.coins !== coinsBefore + 60) fail.push(`сбор не заплатил: ${coinsBefore} -> ${st.coins}`);
if ((st.album.clover || 0) !== 4) fail.push(`альбом не пополнился: ${JSON.stringify(st.album)}`);
if (st.stage !== 0) fail.push(`после сбора стадия ${st.stage}, ожидалась 0`);
if (st.swayAnim !== 'sway') fail.push(`покачивание сбито: ${st.swayAnim}`);
if (st.growAnim !== 'pop') fail.push(`появление сбито: ${st.growAnim}`);
if (st.scrollW > st.viewW) fail.push(`горизонтальная прокрутка: ${st.scrollW} > ${st.viewW}`);
if (errs.length) fail.push(...errs);

console.log(JSON.stringify(st, null, 2));
console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : `снимки в ${out}, ошибок нет`);

await browser.close();
process.exit(fail.length ? 1 : 0);
