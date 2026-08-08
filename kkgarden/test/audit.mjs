/* Регрессии, найденные аудитом 0.3.1. Каждая проверка — про конкретный
   баг, который однажды уже был.
   Запуск из корня репозитория: node kkgarden/test/audit.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'index.html');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fail = [];
const errs = [];

/* ── 1. Мёртвых кнопок в магазине нет ─────────────────────────────
   Вечная подкормка попадала в S.owned, и карточка предлагала
   «Поставить», хотя use() умеет только горшки и лейки. */
{
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.coins = 99999; S.hourOverride = 13; save(); render(); });

  for (const cat of ['pot', 'can', 'fert', 'light']) {
    await p.evaluate(c => { openSheet('shop'); shopTab(c); }, cat);
    await p.waitForTimeout(150);
    const ids = await p.evaluate(() => [...document.querySelectorAll('#shopbody [data-buy]')].map(b => b.dataset.buy));
    for (const id of ids) {
      await p.evaluate(i => buy(i, itemOf(i) && Object.keys(SHOP).find(k => SHOP[k].items.some(x => x.id === i))), id);
      await p.waitForTimeout(80);
    }
  }
  // всё скуплено — теперь ни одна кнопка «Поставить» не должна быть пустышкой
  for (const cat of ['pot', 'can', 'fert', 'light']) {
    await p.evaluate(c => shopTab(c), cat);
    await p.waitForTimeout(120);
    const dead = await p.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('#shopbody [data-use]')) {
        if (b.dataset.cat !== 'pot' && b.dataset.cat !== 'can') out.push(b.dataset.use);
      }
      return out;
    });
    if (dead.length) fail.push(`1. мёртвая кнопка «Поставить» в «${cat}»: ${dead.join(', ')}`);
  }
  await p.close();
}

/* ── 2. Сбор не перебивает открытый шит ───────────────────────────
   harvest() звал магазин через 900 мс безусловно и выкидывал игрока
   из альбома, если тот успевал его открыть. */
{
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; S.stage = 5; S.prog = NEED; prevStage = -1; render(); });
  await p.click('#mainbtn'); await p.waitForTimeout(150);
  await p.click('#albumbtn'); await p.waitForTimeout(1200);
  const open = await p.evaluate(() => document.querySelector('.sheet.on')?.id);
  if (open !== 'album') fail.push(`2. сбор перебил шит: открыт «${open}», ожидался «album»`);

  // а если игрок никуда не ушёл — магазин обязан открыться сам
  await p.evaluate(() => { closeSheets(true); S.stage = 5; S.prog = NEED; prevStage = -1; render(); });
  await p.click('#mainbtn'); await p.waitForTimeout(1300);
  const auto = await p.evaluate(() => document.querySelector('.sheet.on')?.id);
  if (auto !== 'shop') fail.push(`2. магазин не предложился сам: «${auto}»`);
  await p.close();
}

/* ── 3. Интерфейс не перерисовывается на холостом ходу ────────────
   tick() раз в секунду переписывал innerHTML главной кнопки,
   пересобирая SVG на ровном месте. */
{
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => {
    S.hourOverride = 13; S.water = 50; save(); render();
    window.__m = 0;
    const o = new MutationObserver(ms => window.__m += ms.length);
    o.observe(document.querySelector('#mainbtn'), { childList: true, subtree: true, characterData: true });
    o.observe(document.querySelector('#statustx'), { childList: true, subtree: true, characterData: true });
  });
  await p.waitForTimeout(5200);
  const m = await p.evaluate(() => window.__m);
  if (m > 0) fail.push(`3. холостых перерисовок за 5 с: ${m}, ожидалось 0`);
  await p.close();
}

/* ── 4. Запрет движения соблюдается полностью ─────────────────────
   Частицы живут на Web Animations API — CSS-правило до них не
   достаёт. Полоса роста анимировалась в ::after, а `*` не совпадает
   с псевдоэлементами. */
{
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; S.taps = 0; save(); render(); });
  await p.click('#orb'); await p.waitForTimeout(200);
  await p.evaluate(() => { S.stage = 5; S.prog = NEED; prevStage = -1; render(); harvest(); });
  await p.waitForTimeout(1500);
  const left = await p.evaluate(() => ({
    анимаций: document.getAnimations().length,
    частиц: document.querySelectorAll('.spark,.petal,.floaty,.coinfly').length
  }));
  if (left.анимаций) fail.push(`4. при запрете движения работает анимаций: ${left.анимаций}`);
  if (left.частиц) fail.push(`4. при запрете движения осталось частиц: ${left.частиц}`);
  await p.close();
}

/* ── 5. Долгое отсутствие не вешает вкладку ───────────────────────*/
{
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(page_url); await p.waitForTimeout(400);
  const ms = await p.evaluate(() => {
    S.last = Date.now() - 1000 * 60 * 60 * 24 * 365; S.stage = 0; S.prog = 0;
    const t = performance.now(); tick(); return performance.now() - t;
  });
  if (ms > 50) fail.push(`5. tick после года отсутствия занял ${Math.round(ms)} мс`);
  await p.close();
}

if (errs.length) fail.push(...errs.map(e => 'ошибка страницы: ' + e));
console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : 'аудит: все пять проверок пройдены');
await browser.close();
process.exit(fail.length ? 1 : 0);
