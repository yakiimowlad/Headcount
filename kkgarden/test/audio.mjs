/* Проверка звукового движка Клеверника без колонок: считаем, сколько узлов
   WebAudio создаётся, и когда именно.
   Запуск из корня репозитория: node kkgarden/test/audio.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = 'file://' + resolve(here, '..', 'index.html');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();

const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

/* оборачиваем конструкторы узлов до загрузки страницы */
await page.addInitScript(() => {
  window.__n = { ctx: 0, osc: 0, gain: 0, buf: 0, filter: 0 };
  const AC = window.AudioContext;
  window.AudioContext = function (...a) {
    window.__n.ctx++;
    const c = new AC(...a);
    const wrap = (name, key) => {
      const orig = c[name].bind(c);
      c[name] = (...x) => { window.__n[key]++; return orig(...x); };
    };
    wrap('createOscillator', 'osc'); wrap('createGain', 'gain');
    wrap('createBufferSource', 'buf'); wrap('createBiquadFilter', 'filter');
    return c;
  };
});

await page.goto(page_url);
await page.waitForTimeout(300);
const idle = await page.evaluate(() => window.__n);

await page.click('#orb');
await page.waitForTimeout(300);
const tapped = await page.evaluate(() => window.__n);

const ALL = ['tap','water','stage','harvest','coin','buy','plant','task',
             'open','close','tabc','press','deny','bird','cricket'];
await page.evaluate(list => list.forEach(k => SFX[k](2)), ALL);
await page.waitForTimeout(400);
const all = await page.evaluate(() => window.__n);

/* выключаем звук: узлы не должны создаваться вовсе */
await page.click('#soundbtn');
await page.waitForTimeout(200);
const muted = await page.evaluate(() => ({
  sound: S.sound,
  saved: JSON.parse(localStorage.getItem('kk-garden')).sound,
  osc: window.__n.osc
}));
await page.evaluate(() => SFX.harvest());
await page.waitForTimeout(200);
const afterMuted = await page.evaluate(() => window.__n.osc);

await page.click('#soundbtn');
await page.waitForTimeout(200);
const back = await page.evaluate(() => S.sound);

const fail = [];
if (idle.ctx !== 0) fail.push('контекст создан до касания — нарушена политика автоплея');
if (tapped.ctx !== 1) fail.push(`контекстов после касания: ${tapped.ctx}, ожидался 1`);
if (tapped.osc < 1) fail.push('тап не создал ни одного осциллятора');
if (all.osc <= tapped.osc) fail.push('библиотека звуков ничего не сыграла');
if (all.buf < 2) fail.push('шумовые слои не сыграли');
if (muted.sound !== false || muted.saved !== false) fail.push('выключение звука не сохранилось');
if (afterMuted !== muted.osc) fail.push(`при выключенном звуке создано ${afterMuted - muted.osc} осцилляторов — должно быть 0`);
if (back !== true) fail.push('звук не включился обратно');
if (errs.length) fail.push(...errs);

console.log('до касания      ', JSON.stringify(idle));
console.log('после тапа      ', JSON.stringify(tapped));
console.log('вся библиотека  ', JSON.stringify(all));
console.log('выключён        ', JSON.stringify(muted), '→ новых осцилляторов:', afterMuted - muted.osc);
console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : 'звук в порядке');

await browser.close();
process.exit(fail.length ? 1 : 0);
