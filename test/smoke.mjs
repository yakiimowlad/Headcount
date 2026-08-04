/* Смоук-тест. Запуск:
 *   node test/smoke.mjs
 *
 * Нужен Playwright. Если его нет:
 *   npm i -D playwright && npx playwright install chromium
 *
 * Тест не проверяет баланс — только то, что игра запускается, механики
 * отвечают и сохранение переживает перезагрузку. Этого достаточно, чтобы
 * поймать регрессию вроде «хроника перестала открываться»: такая ошибка
 * уже случалась и прошла в main незамеченной.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const GAME = "file://" + resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html");

let failed = 0;
const ok = (name, cond, got) => {
  if (cond) { console.log("  ✓ " + name); return; }
  failed++; console.log("  ✗ " + name + (got !== undefined ? " — получено: " + JSON.stringify(got) : ""));
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto(GAME);
await page.waitForTimeout(400);

console.log("\nЗапуск");
ok("страница поднялась без ошибок", errors.length === 0, errors);
ok("версия объявлена", await page.evaluate(() => /^\d+\.\d+\.\d+$/.test(window.GAME.VERSION ?? "")),
   await page.evaluate(() => window.GAME.VERSION));

console.log("\nВкладки");
const tabs = await page.evaluate(() => {
  const s = {};
  document.querySelectorAll("nav button").forEach(b =>
    s[b.dataset.tab] = !b.classList.contains("lockedtab"));
  return s;
});
ok("на старте открыты «Работа» и «Команда»", tabs.work && tabs.team, tabs);
ok("«Карьера» и «Компания» закрыты", !tabs.career && !tabs.co, tabs);

console.log("\nХроника");
await page.click("#chPeek");
await page.waitForTimeout(500);
ok("раскрывается на весь экран",
   await page.evaluate(() => {
     const c = document.getElementById("chron");
     return c.classList.contains("open") && c.getBoundingClientRect().top === 0;
   }));
ok("время встаёт на паузу", await page.evaluate(async () => {
  const t = window.GAME.S.playTime;
  await new Promise(r => setTimeout(r, 400));
  return window.GAME.S.playTime === t;
}));
await page.click("#chToggle");
await page.waitForTimeout(400);
ok("сворачивается обратно",
   await page.evaluate(() => !document.getElementById("chron").classList.contains("open")));

console.log("\nМеханики");
ok("задача приносит деньги", await page.evaluate(() => {
  const S = window.GAME.S, before = S.cash;
  window.GAME.doTask();
  return S.cash > before;
}));
ok("смена работы множит ставку", await page.evaluate(() => {
  const S = window.GAME.S, before = S.click;
  window.GAME.changeJob();
  return S.click > before && S.jobs === 1;
}));
ok("до ООО пассивного дохода нет", await page.evaluate(async () => {
  const S = window.GAME.S;
  S.llc = false;
  window.GAME.addStaff(window.GAME.C.roles.find(r => r.id === "crew"));
  const before = S.cash;
  await new Promise(r => setTimeout(r, 600));
  return Math.abs(S.cash - before) < 1;
}));
ok("все звуковые эффекты отрабатывают", await page.evaluate(() => {
  const bad = [];
  Object.keys(window.GAME.SFX).forEach(n => {
    try { window.GAME.sfx(n); } catch (e) { bad.push(n); }
  });
  return bad.length === 0;
}));
ok("повышение стоит денег", await page.evaluate(() => {
  const G = window.GAME;
  const st = G.C.tracks.find(t => t.id === "mgmt").steps[0];
  return G.promoCost(st) > 0;
}));
ok("без юрлица найм дороже", await page.evaluate(() => {
  const G = window.GAME, S = G.S, r = G.C.roles.find(x => x.id === "crew");
  const was = S.llc;
  S.llc = false; const grey = G.hireCost(r);
  S.llc = true;  const white = G.hireCost(r);
  // Флаг обязательно вернуть: с включённым ООО бухгалтерия начинает
  // есть кассу, и следующая проверка про перезагрузку падает не по делу.
  S.llc = was;
  return grey > white;
}));

console.log("\nМини-игры");
ok("эпоха выбирает игру", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.mgDone = []; S.era = 0; const early = G.mgDue();
  S.mgDone = []; S.era = 5; const late = G.mgDue();
  S.mgDone = []; S.era = 3; const none = G.mgDue();
  return early === "dial" && late === "prompt" && none === undefined;
}));
ok("время внутри мини-игры стоит", await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  S.era = 5; G.mgOpen("prompt");
  const t = S.playTime;
  await new Promise(r => setTimeout(r, 400));
  const stopped = S.playTime === t;
  document.getElementById("mgSheet").classList.remove("on");
  return stopped;
}));
ok("верные ответы платят", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.era = 5; S.mgDone = []; G.mgOpen("prompt");
  const before = S.cash;
  for (let i = 0; i < 3; i++) {
    const right = G.MG.prompt.qs[i].right;
    document.querySelector('#mgPick .mgo[data-i="' + right + '"]').click();
  }
  document.getElementById("mgSheet").classList.remove("on");
  return S.cash > before;
}));

console.log("\nСохранение");
ok("старый сейв мигрирует", await page.evaluate(() => {
  const m = window.GAME.migrate({ v: 1, S: { staff: [{ uid: 1, role: "middle" }] } });
  return m.v === window.GAME.SAVE_V && m.S.llc === true;
}));
const saved = await page.evaluate(() => {
  const S = window.GAME.S;
  S.cash = 1234567; S.month = 60;
  window.GAME.saveGame();
  return { cash: S.cash, month: S.month };
});
await page.reload();
await page.waitForTimeout(500);
ok("состояние переживает перезагрузку", await page.evaluate(e => {
  const S = window.GAME.S;
  return Math.round(S.cash) >= Math.round(e.cash) && S.month >= e.month;
}, saved), await page.evaluate(() => ({ cash: window.GAME.S.cash, month: window.GAME.S.month })));

console.log("\nПрогон");
const run = await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  S.speed = 25;
  await new Promise(r => setTimeout(r, 4000));
  return { год: G.year(), эпоха: S.era, записей: S.logHistory.length };
});
ok("время идёт и эпохи меняются", run.год > 2007, run);
ok("хроника наполняется", run.записей > 0, run);
ok("за прогон не было ошибок", errors.length === 0, errors);

await browser.close();
console.log(failed ? "\nПровалено проверок: " + failed + "\n" : "\nВсё сошлось\n");
process.exit(failed ? 1 : 0);
