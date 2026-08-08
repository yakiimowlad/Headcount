/* Игра должна запускаться в песочницах, которые включают Trusted Types.
   Симптом поломки: пустой горшок, «0» росинок, «Полить» при полной влаге —
   это статическая разметка, потому что render() падает на первом innerHTML.
   Запуск из корня репозитория: node kkgarden/test/sandbox.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(resolve(here, '..', 'index.html'));

/* Должны работать. `trusted-types 'none'` сюда не входит намеренно:
   там запрещены и innerHTML, и DOMParser, и починить это можно только
   полным отказом от строковой разметки. */
const MUST_WORK = {
  'без CSP': null,
  "require-trusted-types-for 'script'": "require-trusted-types-for 'script'",
  'политика default разрешена явно': "require-trusted-types-for 'script'; trusted-types default",
  'внутри iframe': null
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fail = [];

for(const [name, csp] of Object.entries(MUST_WORK)){
  const srv = http.createServer((q, r) => {
    const h = { 'Content-Type': 'text/html; charset=utf-8' };
    if(csp) h['Content-Security-Policy'] = csp;
    if(q.url === '/frame'){
      r.writeHead(200, h);
      return r.end(`<style>html,body{margin:0}iframe{border:0;width:390px;height:844px}</style><iframe src="/"></iframe>`);
    }
    r.writeHead(200, h); r.end(html);
  }).listen(0);
  const port = srv.address().port;
  const p = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.goto(`http://127.0.0.1:${port}/${name === 'внутри iframe' ? 'frame' : ''}`);
  await p.waitForTimeout(800);

  const scope = name === 'внутри iframe' ? p.frames()[1] : p;
  const st = await scope.evaluate(() => ({
    растение: document.querySelector('#plantwrap').children.length,
    звук: document.querySelector('#soundbtn').children.length,
    росинки: document.querySelector('#coins').textContent,
    кнопка: document.querySelector('#mainbtn').textContent.trim(),
    статус: document.querySelector('#statustx').textContent.trim()
  }));

  if(st.растение !== 1) fail.push(`[${name}] горшок не отрисован`);
  if(st.звук !== 1) fail.push(`[${name}] кнопка звука пустая`);
  if(st.росинки === '0') fail.push(`[${name}] росинки «0» — это статическая разметка, render() упал`);
  if(st.кнопка === 'Полить') fail.push(`[${name}] кнопка не перерисована при полной влаге`);
  if(!st.статус) fail.push(`[${name}] строка состояния пустая`);
  if(errs.length) fail.push(`[${name}] ${errs[0].slice(0, 90)}`);

  await p.close(); srv.close();
}

console.log(fail.length ? 'ПРОВАЛ:\n' + fail.join('\n') : 'песочницы: игра запускается во всех четырёх режимах');
await browser.close();
process.exit(fail.length ? 1 : 0);
