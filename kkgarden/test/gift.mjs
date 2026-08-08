/* Корешки, КеГЛи и суточный темп. node kkgarden/test/gift.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'index.html');
const out = process.env.OUT || '/tmp';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errs = []; const toasts = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(page_url); await p.waitForTimeout(400);
await p.evaluate(() => {
  const t = window.toast; window.__t = [];
  window.toast = m => { window.__t.push(m); return t(m); };
  S.hourOverride = 13; save(); render();
});
const fail = [];

/* 1. КеГЛи капают за цветок */
await p.evaluate(() => { S.stage = 5; prevStage = -1; render(); });
await p.click('#mainbtn'); await p.waitForTimeout(400);
const k = await p.evaluate(() => ({ kegli: S.kegli, ui: document.querySelector('#kegli').textContent }));
if (k.kegli !== 30) fail.push(`1. кегли ${k.kegli}, ожидалось 30`);
if (k.ui !== '30') fail.push(`1. счётчик показывает «${k.ui}»`);

/* 2. Корешок уходит с именем в дательном падеже */
await p.evaluate(() => closeSheets(true));
await p.click('#albumbtn'); await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/kk-gift-1.png` });
await p.evaluate(() => { addSeed('clover', 3); renderGift(); });   // нужен излишек
await p.click('#giftrnd'); await p.waitForTimeout(400);   // случайному соседу
const sent = await p.evaluate(() => ({ t: window.__t[window.__t.length - 1], gifted: S.gifted, pending: !!S.giftBack }));
if (!/^Корешок ушёл \S+\.$/.test(sent.t)) fail.push(`2. текст отправки: «${sent.t}»`);
if (sent.gifted !== 1 || !sent.pending) fail.push(`2. состояние после отправки: ${JSON.stringify(sent)}`);
await p.screenshot({ path: `${out}/kk-gift-2.png` });

/* 2б. Тот же номер карты — всегда тот же человек */
await p.evaluate(() => { S.giftBack = 0; S.gifted = 0; renderGift(); });
const same = await p.evaluate(() => {
  const a = nameFromCard('12345678').d, b = nameFromCard('12345678').d;
  const diff = new Set(['11112222','33334444','55556666','77778888','99990000','12121212'].map(c => nameFromCard(c).d));
  return { stable: a === b, spread: diff.size };
});
if (!same.stable) fail.push('2б. один номер даёт разные имена');
if (same.spread < 3) fail.push(`2б. разные номера дают всего ${same.spread} имён`);

/* 2в. Короткий номер не отправляется */
await p.evaluate(() => { document.querySelector('#cardin').value = '123'; });
await p.click('#giftbtn'); await p.waitForTimeout(300);
const short = await p.evaluate(() => ({ t: window.__t[window.__t.length - 1], pending: !!S.giftBack }));
if (short.pending) fail.push('2в. корешок ушёл по номеру из трёх цифр');
if (!/восьми цифр/.test(short.t)) fail.push(`2в. нет подсказки про длину: «${short.t}»`);

/* 2г. Нормальный номер уходит нужному человеку и форматируется */
await p.evaluate(() => { document.querySelector('#cardin').value = ''; });
await p.type('#cardin', '4276123456789012');
const shown = await p.evaluate(() => document.querySelector('#cardin').value);
if (shown !== '4276 1234 5678 9012') fail.push(`2г. номер отображается как «${shown}»`);
const expect = await p.evaluate(() => nameFromCard('4276123456789012').d);
await p.click('#giftbtn'); await p.waitForTimeout(300);
const byCard = await p.evaluate(() => ({ t: window.__t[window.__t.length - 1], card: S.lastCard }));
if (byCard.t !== `Корешок ушёл ${expect}.`) fail.push(`2г. ушёл не тому: «${byCard.t}», ожидалось ${expect}`);
if (byCard.card !== '4276 1234 5678 9012') fail.push(`2г. карта запомнилась как «${byCard.card}»`);
await p.screenshot({ path: `${out}/kk-gift-card.png` });

/* 3. Второй корешок не уходит, пока не пришёл ответ */
await p.evaluate(() => { renderGift(); });
const second = await p.evaluate(() => !!document.querySelector('#giftbtn'));
if (second) fail.push('3. кнопка дарения доступна, пока корешок в пути');

/* 4. Ответ приходит и открывает закрытый сорт */
const before = await p.evaluate(() => SEEDS.filter(x => seedKnown(x.id)).length);
await p.evaluate(() => { S.giftBack = Date.now() - 1; tick(); });
await p.waitForTimeout(400);
const got = await p.evaluate(() => ({ t: window.__t[window.__t.length - 1], n: SEEDS.filter(x => seedKnown(x.id)).length, received: S.received }));
if (got.n !== before + 1) fail.push(`4. сортов было ${before}, стало ${got.n}`);
if (!/^Корешок от \S+ — .+\. Семена в магазине\.$/.test(got.t)) fail.push(`4. текст получения: «${got.t}»`);
if (got.received !== 1) fail.push(`4. счётчик получено: ${got.received}`);
await p.screenshot({ path: `${out}/kk-gift-3.png` });

/* 5. Бутон не раскрывается тапами в ту же сессию */
await p.evaluate(() => { closeSheets(true); S.stage = 4; S.prog = 0; S.taps = 0; prevStage = -1; render(); });
for (let i = 0; i < 10; i++) { await p.click('#orb'); await p.waitForTimeout(40); }
const bud = await p.evaluate(() => ({ stage: S.stage, prog: Math.round(S.prog), need: need(4), taps: S.taps }));
if (bud.stage !== 4) fail.push(`5. бутон раскрылся тапами: стадия ${bud.stage}`);
if (bud.prog !== 100) fail.push(`5. десять тапов дали ${bud.prog} из ${bud.need}`);
await p.screenshot({ path: `${out}/kk-bud.png` });

/* 6. Десять тапов на обычной стадии дают ровно стадию */
await p.evaluate(() => { S.stage = 1; S.prog = 0; S.taps = 0; prevStage = -1; render(); });
for (let i = 0; i < 10; i++) { await p.click('#orb'); await p.waitForTimeout(40); }
const norm = await p.evaluate(() => S.stage);
if (norm !== 2) fail.push(`6. после десяти тапов стадия ${norm}, ожидалась 2`);

/* 7. Сутки без полива доводят до бутона, но не до цветка */
await p.evaluate(() => { S.stage = 0; S.prog = 0; S.taps = 10; S.water = 100;
  S.last = Date.now() - 26 * 3600 * 1000; tick(); });
const dry = await p.evaluate(() => S.stage);
if (dry !== 4) fail.push(`7. сутки без полива: стадия ${dry}, ожидался бутон (4)`);

/* 8. Сутки при живой влаге доводят до сбора */
await p.evaluate(() => { S.can = 'can2'; S.owned.push('can2');   // автополив
  S.stage = 0; S.prog = 0; S.taps = 10; S.water = 100;
  S.last = Date.now() - 26 * 3600 * 1000; tick(); });
const wet = await p.evaluate(() => S.stage);
if (wet !== 5) fail.push(`8. сутки с влагой: стадия ${wet}, ожидался сбор (5)`);

/* 9. Полсуток не доводят: цветок не должен успевать за одну сессию */
await p.evaluate(() => { S.stage = 0; S.prog = 0; S.taps = 10; S.water = 100;
  S.last = Date.now() - 8 * 3600 * 1000; tick(); });
const half = await p.evaluate(() => S.stage);
if (half >= 5) fail.push(`9. за 8 ч дошло до ${half} — слишком быстро`);

if (errs.length) fail.push(...errs.map(e => 'ошибка: ' + e));
console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : 'корешки, кегли и темп — в порядке');
await browser.close();
process.exit(fail.length ? 1 : 0);
