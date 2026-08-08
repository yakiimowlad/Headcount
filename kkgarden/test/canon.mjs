/* Правила, выведенные из бренда: свежесть, замкнутый цикл семян,
   родословная, честные цены, негромкость. И миграция старых сейвов.
   Запуск из корня репозитория: node kkgarden/test/canon.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'index.html');
const out = process.env.OUT || '/tmp';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fail = [], errs = [];
const fresh = async () => {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return p;
};

/* ── 1. Старый сейв переживает смену схемы ────────────────────────
   До второй версии альбом хранил число, а семена — список без количеств. */
{
  const p = await fresh();
  await p.addInitScript(() => localStorage.setItem('kk-garden', JSON.stringify({
    coins: 500, seed: 'chamo', stage: 2, album: { clover: 3, chamo: 1 },
    seedsOwned: ['clover', 'chamo', 'calen'], owned: ['pot0', 'can0']
  })));
  await p.goto(page_url); await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({
    v: S.v, album: S.album, seeds: S.seeds,
    old: S.seedsOwned, coins: S.coins, seed: S.seed, stage: S.stage
  }));
  if (m.v !== 2) fail.push(`1. версия схемы ${m.v}`);
  if (JSON.stringify(m.album.clover) !== '{"n":3,"fresh":0}') fail.push(`1. альбом не мигрировал: ${JSON.stringify(m.album)}`);
  if (m.seeds.calen !== 1) fail.push(`1. семена не мигрировали: ${JSON.stringify(m.seeds)}`);
  if (m.old !== undefined) fail.push('1. seedsOwned не удалён');
  if (m.coins !== 500 || m.seed !== 'chamo' || m.stage !== 2) fail.push('1. прогресс потерян при миграции');
  await p.close();
}

/* ── 2. Свежесть считается от первого взгляда, не от раскрытия ────*/
{
  const p = await fresh();
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; save(); });

  // цветок раскрылся, пока игры не было: окно ещё не начиналось
  await p.evaluate(() => { S.stage = 5; S.seenAt = 0; prevStage = -1; render(); });
  const seen = await p.evaluate(() => ({ seenAt: !!S.seenAt, fresh: isFresh() }));
  if (!seen.seenAt) fail.push('2. окно не открылось при показе цветка');
  if (!seen.fresh) fail.push('2. только что увиденный цветок не свежий');

  const c0 = await p.evaluate(() => S.coins);
  await p.click('#mainbtn'); await p.waitForTimeout(400);
  const got = await p.evaluate(() => ({ paid: S.coins, a: S.album.clover }));
  if (got.paid - c0 !== 90) fail.push(`2. свежий заплатил ${got.paid - c0}, ожидалось 90 (60 × 1,5)`);
  if (got.a.fresh !== 1) fail.push(`2. свежесть не записана в альбом: ${JSON.stringify(got.a)}`);

  // а теперь игрок увидел и ушёл на полчаса
  await p.evaluate(() => { closeSheets(true); S.stage = 5; S.seenAt = Date.now() - 30 * 60 * 1000; prevStage = -1; render(); });
  const stale = await p.evaluate(() => isFresh());
  if (stale) fail.push('2. через полчаса после взгляда цветок всё ещё свежий');
  const c1 = await p.evaluate(() => S.coins);
  await p.click('#mainbtn'); await p.waitForTimeout(400);
  const base = await p.evaluate(() => S.coins) - c1;
  if (base !== 60) fail.push(`2. несвежий заплатил ${base}, базовая выплата должна остаться 60`);
  await p.close();
}

/* ── 3. Цикл замкнут: посадка тратит семя, сбор возвращает два ────*/
{
  const p = await fresh();
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; save(); });
  const start = await p.evaluate(() => seedCount('clover'));
  await p.evaluate(() => { S.stage = 5; prevStage = -1; render(); harvest(); });
  await p.waitForTimeout(300);
  const afterHarvest = await p.evaluate(() => seedCount('clover'));
  if (afterHarvest !== start + 2) fail.push(`3. сбор вернул ${afterHarvest - start} семян, ожидалось 2`);

  await p.evaluate(() => { addSeed('chamo', 1); plant('chamo'); });
  await p.waitForTimeout(200);
  const afterPlant = await p.evaluate(() => ({ chamo: seedCount('chamo'), clover: seedCount('clover'), seed: S.seed }));
  if (afterPlant.seed !== 'chamo') fail.push('3. посадка не сработала');
  if (afterPlant.chamo !== 0) fail.push(`3. посадка не потратила семя: осталось ${afterPlant.chamo}`);
  if (afterPlant.clover !== afterHarvest + 1) fail.push('3. вынутое из горшка семечко не вернулось в пакет');
  await p.close();
}

/* ── 4. Последнее семя не отдаётся ────────────────────────────────*/
{
  const p = await fresh();
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => {
    S.hourOverride = 13; S.album = { clover: { n: 1, fresh: 0 } };
    S.seeds = { clover: 1 }; S.giftBack = 0; save();
  });
  const noSpare = await p.evaluate(() => spareSort());
  if (noSpare) fail.push(`4. одно семя считается излишком: ${noSpare}`);
  await p.evaluate(() => { const t = window.toast; window.__t = []; window.toast = m => { window.__t.push(m); return t(m); }; giftCutting(); });
  await p.waitForTimeout(200);
  const denied = await p.evaluate(() => ({ t: window.__t[0], pending: !!S.giftBack, left: seedCount('clover') }));
  if (denied.pending) fail.push('4. корешок ушёл, хотя семя было последним');
  if (denied.left !== 1) fail.push(`4. последнее семя израсходовано: ${denied.left}`);
  if (!/Лишних семян нет/.test(denied.t || '')) fail.push(`4. нет объяснения: «${denied.t}»`);

  // с двумя семенами — уходит, и остаётся одно
  await p.evaluate(() => { addSeed('clover', 1); giftCutting(); });
  await p.waitForTimeout(200);
  const sent = await p.evaluate(() => ({ pending: !!S.giftBack, left: seedCount('clover') }));
  if (!sent.pending) fail.push('4. корешок не ушёл при излишке');
  if (sent.left !== 1) fail.push(`4. после подарка осталось ${sent.left}, ожидалось 1`);
  await p.close();
}

/* ── 5. Родословная, нота и прогресс к цене видны ─────────────────*/
{
  const p = await fresh();
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; S.coins = 300; save(); openSheet('shop'); shopTab('seed'); });
  await p.waitForTimeout(300);
  const seedCard = await p.evaluate(() => {
    const c = document.querySelector('#shopbody .card');
    return { note: !!c.querySelector('.note'), from: !!c.querySelector('.from'), n: !!c.querySelector('.seedn') };
  });
  if (!seedCard.note) fail.push('5. дегустационной ноты нет в карточке');
  if (!seedCard.from) fail.push('5. родословной нет в карточке');
  await p.screenshot({ path: `${out}/kk-canon-seeds.png` });

  await p.evaluate(() => shopTab('pot')); await p.waitForTimeout(300);
  const save2 = await p.evaluate(() => {
    const s = document.querySelector('#shopbody .pricecol');
    return s ? { left: s.querySelector('.saveleft').textContent, bar: !!s.querySelector('.saveline i') } : null;
  });
  if (!save2) fail.push('5. прогресса к цене нет');
  else if (!/ещё \d+/.test(save2.left)) fail.push(`5. подпись прогресса: «${save2.left}»`);
  await p.screenshot({ path: `${out}/kk-canon-price.png` });
  await p.close();
}

/* ── 6. Негромкость: нет вечной пульсации и конфетти на тап ───────*/
{
  const p = await fresh();
  await p.goto(page_url); await p.waitForTimeout(400);
  await p.evaluate(() => { S.hourOverride = 13; S.coins = 3000; S.taps = 0; save(); render(); });
  await p.waitForTimeout(300);
  const loops = await p.evaluate(() => document.getAnimations()
    .filter(a => a.effect && a.effect.getTiming().iterations === Infinity)
    .map(a => a.animationName + '@' + ((a.effect.target.className || '') + '').split(' ')[0]));
  if (loops.some(x => x.startsWith('bpulse'))) fail.push(`6. счётчик пульсирует: ${loops}`);

  await p.click('#orb'); await p.waitForTimeout(150);
  const confetti = await p.evaluate(() => document.querySelectorAll('.spark').length);
  if (confetti) fail.push(`6. на тап вылетело искр: ${confetti}`);
  const feedback = await p.evaluate(() => document.querySelectorAll('.floaty').length);
  if (!feedback) fail.push('6. отдача на тап пропала совсем — число должно остаться');
  await p.close();
}

if (errs.length) fail.push(...errs.map(e => 'ошибка страницы: ' + e));
console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : 'канон: все шесть проверок пройдены');
await browser.close();
process.exit(fail.length ? 1 : 0);
