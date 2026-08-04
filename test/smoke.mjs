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
ok("кнопка и счётчик — один элемент", await page.evaluate(async () => {
  const G = window.GAME;
  G.S.unread = 3; G.paintBadge();
  const b = document.getElementById("chBadge");
  const withN = { t: b.textContent, orange: b.classList.contains("unread"), w: b.offsetWidth };
  G.S.unread = 0; G.paintBadge();
  const без = { t: b.textContent, orange: b.classList.contains("unread") };
  // Стрелка есть всегда — это кнопка. Цифра и оранжевый приходят вместе.
  return withN.t.includes("3") && withN.orange && withN.t.startsWith("⌃") &&
         без.t.trim() === "⌃" && !без.orange &&
         document.querySelectorAll("#chPeek .chx").length === 1;
}), await page.evaluate(() => document.getElementById("chBadge").textContent));
ok("у кнопки раскрытия тап не меньше 44 пикселей", await page.evaluate(() => {
  // Видимый кружок меньше, но ::after расширяет площадь до рекомендованных
  // сорока четырёх: палец попадает туда, куда целился.
  const el = document.querySelector("#chPeek .chx");
  const after = getComputedStyle(el, "::after");
  return parseFloat(after.width) >= 44 && parseFloat(after.height) >= 44;
}), await page.evaluate(() => {
  const a = getComputedStyle(document.querySelector("#chPeek .chx"), "::after");
  return { ширина: a.width, высота: a.height };
}));
ok("шапка раскрытой хроники — полноценная панель, а не полоска", await page.evaluate(async () => {
  document.getElementById("chPeek").click();
  await new Promise(r => setTimeout(r, 450));
  const bar = document.getElementById("chToggle").getBoundingClientRect();
  const btn = document.querySelector("#chToggle .chx").getBoundingClientRect();
  const closes = () => {
    document.getElementById("chToggle").click();
    return new Promise(r => setTimeout(r, 450));
  };
  await closes();
  return bar.height >= 52 && btn.width >= 36 &&
         !document.getElementById("chron").classList.contains("open");
}));
ok("дата — три буквы месяца и две цифры года", await page.evaluate(() => {
  const G = window.GAME;
  G.S.month = 214;                       // ноябрь 2024
  const t = G.stamp();
  return t.m.length === 3 && t.y === "24";
}), await page.evaluate(() => window.GAME.stamp()));
ok("сейв со старой датой одной строкой не теряет её", await page.evaluate(() => {
  const t = window.GAME.stampOf({ time: "январь 2007" });
  return t.m === "янв" && t.y === "07";
}), await page.evaluate(() => window.GAME.stampOf({ time: "январь 2007" })));
ok("в свёрнутой строке помещается четыре строки текста", await page.evaluate(() => {
  const G = window.GAME;
  G.log("Письмо про возврат в офис назвали «культурой сотрудничества». В нём четыре " +
        "абзаца, и ни в одном не сказано, с какого числа это начинается и кого касается.", "bad");
  document.querySelectorAll(".sheet,.scrim").forEach(s => s.classList.remove("on"));
  const p = document.querySelector("#chPeek p"), cs = getComputedStyle(p);
  const lines = Math.round(p.getBoundingClientRect().height / parseFloat(cs.lineHeight));
  return cs.webkitLineClamp === "4" && lines === 4;
}), await page.evaluate(() => {
  const p = document.querySelector("#chPeek p"), cs = getComputedStyle(p);
  return { клемп: cs.webkitLineClamp,
           строк: Math.round(p.getBoundingClientRect().height / parseFloat(cs.lineHeight)) };
}));
ok("столбик даты занимает не больше 28 пикселей", await page.evaluate(() =>
  document.querySelector("#chPeek time").getBoundingClientRect().width <= 28),
  await page.evaluate(() => document.querySelector("#chPeek time").getBoundingClientRect().width));

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

console.log("\nЧёлка");
// На айфоне в режиме приложения статус-бар лежит поверх страницы:
// viewport-fit=cover и black-translucent отдают игре весь экран. Всё,
// что липнет к верху, обязано отступать на высоту чёлки — иначе шапка
// уезжает под часы, и это видно только на устройстве. Подставляем 47
// пикселей и проверяем здесь.
await page.evaluate(() => document.documentElement.style.setProperty("--sat", "47px"));
await page.waitForTimeout(200);
ok("шапка не залезает под часы", await page.evaluate(() =>
  document.getElementById("brand").getBoundingClientRect().top >= 47),
  await page.evaluate(() => Math.round(document.getElementById("brand").getBoundingClientRect().top)));
ok("и не уезжает под них при скролле", await page.evaluate(async () => {
  window.scrollTo(0, 500);
  await new Promise(r => setTimeout(r, 200));
  const top = document.getElementById("brand").getBoundingClientRect().top;
  window.scrollTo(0, 0);
  return top >= 47;
}));
ok("раскрытая хроника тоже отступает", await page.evaluate(async () => {
  document.getElementById("chPeek").click();
  await new Promise(r => setTimeout(r, 450));
  const top = document.querySelector("#chron .chh").getBoundingClientRect().top;
  document.getElementById("chToggle").click();
  await new Promise(r => setTimeout(r, 450));
  return top >= 47;
}));

console.log("\nЭкран «Работа»");
// Проверяем в самых тяжёлых условиях: чёлка 47 пикселей всё ещё
// подставлена, задача — самая длинная из существующих.
ok("кнопка улучшений видна без скролла даже на самой длинной задаче", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.era = 5; S.cash = 9e6; S.earned = 4e7;
  document.getElementById("sig").hidden = true;
  // Берём самый длинный заголовок из всех, что игра вообще может показать.
  const longest = G.C.tasks.map(t => t[1]).sort((a, b) => b.length - a.length)[0];
  document.getElementById("ttl").textContent = longest;
  document.querySelectorAll(".sheet,.scrim").forEach(s => s.classList.remove("on"));
  G.paint();
  const btn = document.getElementById("upsBtn").getBoundingClientRect();
  const chron = document.getElementById("chron").getBoundingClientRect();
  return btn.bottom <= chron.top;
}), await page.evaluate(() => ({
  низКнопки: Math.round(document.getElementById("upsBtn").getBoundingClientRect().bottom),
  верхХроники: Math.round(document.getElementById("chron").getBoundingClientRect().top)
})));
ok("касса показана один раз, а не двумя карточками", await page.evaluate(() =>
  document.getElementById("cash") === null && document.getElementById("hCash") !== null));
console.log("\nУлучшения");
ok("редкость растёт вместе с силой эффекта", await page.evaluate(() => {
  const G = window.GAME;
  const all = [...G.C.ups, ...G.C.loops.map(l => ({ loop: l }))]
    .map(o => ({ g: G.upsGrade(o), p: G.upsPower(o) }))
    .sort((a, b) => a.p - b.p);
  // Грейд обязан быть неубывающим по измеренной силе, иначе тег врёт.
  return all.every((x, i) => i === 0 || x.g >= all[i - 1].g);
}));
ok("заняты все пять грейдов, и легендарных меньше всего", await page.evaluate(() => {
  const G = window.GAME;
  const n = [0, 0, 0, 0, 0];
  [...G.C.ups, ...G.C.loops.map(l => ({ loop: l }))].forEach(o => n[G.upsGrade(o)]++);
  return n.every(x => x > 0) && n[4] === Math.min(...n);
}), await page.evaluate(() => {
  const G = window.GAME, n = [0, 0, 0, 0, 0];
  [...G.C.ups, ...G.C.loops.map(l => ({ loop: l }))].forEach(o => n[G.upsGrade(o)]++);
  return n;
}));
ok("цвет несёт только тег редкости", await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  S.era = 5; S.cash = 3e6; S.earned = 6e7;
  S.bought.add("u1");
  G.paintUpsTree();
  document.getElementById("upsSheet").classList.add("on");
  await new Promise(r => setTimeout(r, 150));
  const css = s => getComputedStyle(document.querySelector(s));
  const ink = css(":root").getPropertyValue("--ink").trim();
  const mut = css(":root").getPropertyValue("--mut").trim();
  const paint = c => { const d = document.createElement("i"); d.style.color = c;
                       document.body.appendChild(d); const v = getComputedStyle(d).color;
                       d.remove(); return v; };
  const done = document.querySelector("#upsTree .ub.done .un");
  const other = document.querySelector("#upsTree .ub:not(.done) .un");
  document.getElementById("upsSheet").classList.remove("on");
  // Купленное — в полный цвет текста, некупленное — серым. В тёмной теме
  // это белое против серого, в светлой чёрное против серого: обе величины
  // берутся из переменных, поэтому проверка одна на обе темы.
  return done && other &&
         getComputedStyle(done).color === paint(ink) &&
         getComputedStyle(other).color === paint(mut);
}));
ok("шапка шита прилипает при скролле", await page.evaluate(async () => {
  const G = window.GAME;
  G.paintUpsTree();
  document.getElementById("upsSheet").classList.add("on");
  await new Promise(r => setTimeout(r, 200));
  const box = document.querySelector("#upsSheet .sh-in");
  box.scrollTop = 700;
  await new Promise(r => setTimeout(r, 200));
  const h = document.querySelector("#upsSheet .shead").getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const x = document.getElementById("upsClose").getBoundingClientRect();
  box.scrollTop = 0;
  document.getElementById("upsSheet").classList.remove("on");
  // Ровно у края: щель над прилипшей шапкой означала бы, что в неё
  // просвечивает уезжающий список.
  return Math.abs(h.top - b.top) < 2 && x.top >= b.top && x.bottom <= b.bottom;
}));

ok("на экране улучшений видна касса", await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  S.cash = 111000;
  document.getElementById("upsBtn").click();
  await new Promise(r => setTimeout(r, 300));
  const h = document.querySelector("#upsSheet h2").textContent;
  // Сумма идёт тем же кеглем, что и заголовок: это второе число экрана.
  const sizes = ["#upsSheet h2", "#upsCash"].map(s => getComputedStyle(document.querySelector(s)).fontSize);
  S.cash = 222000; G.paint();                 // цифра живая, пока экран открыт
  const grew = document.getElementById("upsCash").textContent !== "(" + G.rub(111000) + ")";
  document.getElementById("upsClose").click();
  await new Promise(r => setTimeout(r, 300));
  return h.includes("(") && h.includes(")") && sizes[0] === sizes[1] && grew;
}), await page.evaluate(() => document.querySelector("#upsSheet h2").textContent.trim()));

console.log("\nТочки на вкладках");
ok("точка «Команда» загорается, когда найм по карману", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.tab = "work"; S.cash = 0; G.paintDots();
  const off = document.getElementById("dotTeam").classList.contains("on");
  S.cash = 5e7; G.paintDots();
  const on = document.getElementById("dotTeam").classList.contains("on");
  return !off && on;
}));
ok("точка не горит на вкладке, где игрок уже стоит", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.cash = 5e7; S.tab = "team"; G.paintDots();
  return !document.getElementById("dotTeam").classList.contains("on");
}));
ok("точка «Карьера» ждёт денег на повышение", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.tab = "work"; S.era = 2;
  // Вкладка открывается двумя свободными людьми одной роли — без этого
  // повышать некого, и точке неоткуда взяться.
  const mid = G.C.roles.find(r => r.id === "middle");
  G.addStaff(mid); G.addStaff(mid); G.bumpEcon();
  if (!G.careerOpen()) return false;
  S.cash = 0; G.paintDots();
  const off = document.getElementById("dotCareer").classList.contains("on");
  S.cash = 5e7; G.paintDots();
  const on = document.getElementById("dotCareer").classList.contains("on");
  return !off && on;
}));
ok("на закрытой вкладке точки нет", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  S.tab = "work"; S.cash = 5e7; S.month = 0; S.era = 0;
  G.paintDots();
  // «Карьера» в 2007-м закрыта — значит и звать туда нечем.
  return G.careerOpen() ? true : !document.getElementById("dotCareer").classList.contains("on");
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
