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
  const G = window.GAME, b = document.getElementById("chBadge");
  G.S.unread = 3; G.paintBadge();
  const есть = { n: b.querySelector(".chn"), arrow: !!b.querySelector(".chv"),
                 orange: b.classList.contains("unread") };
  G.S.unread = 0; G.paintBadge();
  const нет = { n: b.querySelector(".chn"), arrow: !!b.querySelector(".chv"),
                orange: b.classList.contains("unread") };
  // Стрелка есть всегда — это кнопка. Цифра и оранжевый приходят вместе.
  return есть.arrow && есть.n && есть.n.textContent === "3" && есть.orange &&
         нет.arrow && !нет.n && !нет.orange &&
         document.querySelectorAll("#chPeek .chx").length === 1;
}));
ok("стрелка и цифра выровнены по центру", await page.evaluate(() => {
  const G = window.GAME, b = document.getElementById("chBadge");
  G.S.unread = 3; G.paintBadge();
  const mid = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
  const dv = Math.abs(mid(b.querySelector(".chv")) - mid(b.querySelector(".chn")));
  // Глиф ⌃ висел выше базовой линии почти на треть кегля. У svg центр
  // там, где написано, поэтому расхождение обязано быть нулевым.
  return dv < 1 && b.getBoundingClientRect().height <= 30;
}), await page.evaluate(() => {
  const b = document.getElementById("chBadge");
  const mid = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
  return { расхождение: +(Math.abs(mid(b.querySelector(".chv")) - mid(b.querySelector(".chn")))).toFixed(2),
           высота: Math.round(b.getBoundingClientRect().height) };
}));
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
ok("крестик остаётся на месте при скролле списка", await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  // Список должен быть заведомо длиннее экрана, иначе прокручивать нечего
  // и проверка сойдётся сама с собой.
  S.era = 5; S.cash = 3e6; S.earned = 6e7;
  G.paintUpsTree();
  document.getElementById("upsSheet").classList.add("on");
  await new Promise(r => setTimeout(r, 500));
  const tree = document.querySelector("#upsSheet .upstree");
  const before = document.getElementById("upsClose").getBoundingClientRect().top;
  tree.scrollTop = 700;
  await new Promise(r => setTimeout(r, 200));
  const scrolled = tree.scrollTop;
  const after = document.getElementById("upsClose").getBoundingClientRect().top;
  tree.scrollTop = 0;
  document.getElementById("upsSheet").classList.remove("on");
  // Прокручивается список, а не шит: крестик не двигается ни на пиксель.
  // Проверяем и сам факт прокрутки — иначе тест сойдётся на пустом списке.
  return scrolled > 0 && Math.abs(after - before) < 1;
}));
ok("шапка шита не полагается на position:sticky", await page.evaluate(() =>
  // На iOS Safari sticky внутри предка с transform перестаёт
  // перерисовываться, а у шита transform есть — им он выезжает снизу.
  getComputedStyle(document.querySelector("#upsSheet .shead")).position !== "sticky"));

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

console.log("\nПотолок ранней задачи");
ok("до 2014-го задача не приносит больше ста тысяч", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  // Разгоняем всё, что множит клик: две смены работы, оба множителя
  // к задаче, полный поток и десять человек в штате.
  S.month = 6 * 12; S.click = 5000;
  S.jobAt = undefined; G.changeJob(); S.jobAt = undefined; G.changeJob();
  ["u1", "u2"].forEach(id => { const u = G.C.ups.find(x => x.id === id);
                               if (!S.bought.has(id)) { S.bought.add(id); u.f(S); } });
  for (let i = 0; i < 10; i++) G.addStaff(G.C.roles.find(r => r.id === "crew"));
  S.flow = 1; G.bumpEcon();
  return G.year() < G.CAP_YEAR && G.clickVal() <= G.EARLY_CAP + 1;
}), await page.evaluate(() => ({ год: window.GAME.year(), клик: Math.round(window.GAME.clickVal()) })));
ok("после 2014-го потолка нет", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  // Ставка заведомо выше потолка при любой сложности задачи: проверяем
  // сам факт снятия ограничения, а не то, что выпало в этот момент.
  S.click = 5e6;
  S.month = 6 * 12;  const до = G.clickVal();
  S.month = 8 * 12;  const после = G.clickVal();
  return до <= G.EARLY_CAP + 1 && после > G.EARLY_CAP;
}), await page.evaluate(() => ({ год: window.GAME.year(), клик: Math.round(window.GAME.clickVal()) })));

console.log("\nТемп времени");
ok("оборот ускоряет календарь, но не больше чем втрое", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = { rev: S.lastRev, era: S.era };
  S.era = 0;
  S.lastRev = 0;        const пол = G.pace();
  S.lastRev = 60000;    const норма = G.pace();
  S.lastRev = 1e12;     const потолок = G.pace();
  S.lastRev = было.rev; S.era = было.era;
  return пол === 1 && норма > 1.9 && норма < 2.1 && потолок === 3;
}));
ok("событий на игровой месяц столько же, сколько было в бете", await page.evaluate(() => {
  // Месяц вырос вдесятеро, значит и все таймеры событий должны считать
  // вдесятеро медленнее. Проверяем через сам месяц: сколько «старых
  // секунд» укладывается в один игровой месяц при обычном темпе.
  const G = window.GAME;
  return Math.abs(G.MONTH / 90 - 1) < 1e-9 && Math.abs(G.BURN_TAP - 0.05) < 1e-9;
}));

console.log("\nКасса-ключ и волны рынка");
ok("эпоха не наступает без денег на счету", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = { month: S.month, era: S.era, cash: S.cash, held: S.eraHeld };
  S.era = 0; S.month = 12*4 + 1; S.cash = 0; S.eraHeld = undefined;   // календарь уже 2011
  G.checkEra();
  const держит = S.era === 0 && S.eraHeld !== undefined;
  S.cash = 1e9; G.checkEra();
  const пустил = S.era === 1;
  S.month = было.month; S.era = было.era; S.cash = было.cash; S.eraHeld = было.held;
  return держит && пустил;
}));
ok("ожидание не длится дольше года", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = { month: S.month, era: S.era, cash: S.cash, held: S.eraHeld };
  S.era = 0; S.month = 12*4 + 1; S.cash = 0; S.eraHeld = undefined;
  G.checkEra();
  S.month += 13;               // год терпения прошёл, денег так и нет
  G.checkEra();
  const пустил = S.era === 1;
  S.month = было.month; S.era = было.era; S.cash = было.cash; S.eraHeld = было.held;
  return пустил;
}));
ok("ковид и ИИ множат выработку, ранние эпохи — нет", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = S.era;
  const at = e => { S.era = e; G.bumpEcon(); return G.revenue(); };
  const до = at(2), ковид = at(3), ии = at(5);
  S.era = было; G.bumpEcon();
  return до > 0 && ковид > до * 1.5 && ии > ковид * 1.9;
}));

console.log("\nЦикличные улучшения");
ok("эффект захода тает, а цена растёт", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const l = G.C.loops.find(x => x.id === "lp3");     // Рефакторинг: +15% и вниз
  const было = { loops: S.loops, click: S.click };
  S.loops = {};
  const ц1 = G.loopCost(l), э1 = G.loopMath(l);
  S.loops = { lp3: 3 };
  const ц2 = G.loopCost(l), э2 = G.loopMath(l);
  S.loops = было.loops; S.click = было.click;
  return ц2 > ц1 * 4 && э2.k < э1.k * 0.5;
}));
ok("карточка называет и шаг, и сумму, и потолок", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = S.loops; S.loops = { lp3: 2 };
  const line = G.loopMath(G.C.loops.find(x => x.id === "lp3")).line;
  S.loops = было;
  return /Этот заход/.test(line) && /набрано/.test(line) && /возможных/.test(line);
}));

console.log("\nГрафик кассы");
ok("линия появляется, когда накопилась история", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const было = S.cashHist;
  S.cashHist = [1000, 5000, 20000, 90000, 300000, 900000, 4000000];
  G.paintSpark();
  const есть = !document.getElementById("sparkCard").hidden &&
               document.getElementById("spark").querySelector("path");
  S.cashHist = было;
  return !!есть;
}));

console.log("\nСохранение");
ok("старый сейв мигрирует", await page.evaluate(() => {
  const m = window.GAME.migrate({ v: 1, S: { staff: [{ uid: 1, role: "middle" }] } });
  return m.v === window.GAME.SAVE_V && m.S.llc === true;
}));
// Сейв, сделанный старой версией, знает не про все роли. Раньше такой
// сейв подменял счётчики штата целиком, роль из следующей версии приходила
// как undefined, и цена найма показывалась как «NaN млрд ₽». Пересчёт из
// самого штата чинит это на любой глубине старости сохранения.
ok("роль из новой версии не ломает цену найма", await page.evaluate(() => {
  const G = window.GAME, S = G.S;
  const штат = S.staff, счёт = S.hired;
  S.hired = { middle: 2 };                      // сейв «из прошлого»
  S.staff = [{ uid: 901, role: "middle" }, { uid: 902, role: "middle" }];
  G.countHired();
  const все = G.C.roles.every(r => Number.isFinite(G.hireCost(r)));
  const мидлы = S.hired.middle === 2;
  S.staff = штат; S.hired = счёт;                // вернуть как было
  return все && мидлы;
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

console.log("\nСброс прогресса");
await page.evaluate(() => {
  const S = window.GAME.S;
  S.cash = 5e9; S.earned = 5e9; S.month = 90; S.era = 3; S.volSfx = 0.4; S.theme = "dark";
  const r = window.GAME.C.roles.find(x => x.id === "middle");
  window.GAME.addStaff(r);
  document.getElementById("openSet").click();
});
await page.waitForTimeout(150);
ok("кнопка сброса ждёт первого тапа", await page.evaluate(() =>
  document.getElementById("resetBtn")?.textContent.includes("Сбросить прогресс")));
await page.evaluate(() => document.getElementById("resetBtn").click());
await page.waitForTimeout(100);
ok("второй тап требует подтверждения, а не сбрасывает сразу", await page.evaluate(() =>
  !!document.getElementById("resetGo") && !!document.getElementById("resetNo")));
await page.evaluate(() => document.getElementById("resetNo").click());
await page.waitForTimeout(100);
ok("«Отмена» возвращает первый шаг, прогресс цел", await page.evaluate(() =>
  !document.getElementById("resetGo") && window.GAME.S.cash > 0));
await page.evaluate(() => { document.getElementById("resetBtn").click(); });
await page.waitForTimeout(100);
await page.evaluate(() => document.getElementById("resetGo").click());
await page.waitForTimeout(150);
const afterReset = await page.evaluate(() => {
  const S = window.GAME.S;
  return { cash: S.cash, earned: S.earned, staff: S.staff.length, era: S.era,
           volSfx: S.volSfx, theme: S.theme, sheetOpen: document.getElementById("setSheet").classList.contains("on") };
});
ok("сброс обнуляет компанию, штат и оборот", afterReset.cash === 0 && afterReset.earned === 0 && afterReset.staff === 0, afterReset);
ok("настройки звука и темы переживают сброс", afterReset.volSfx === 0.4 && afterReset.theme === "dark", afterReset);
ok("шит настроек закрылся сам", afterReset.sheetOpen === false);
ok("сброс пишет в хронику и сохраняет чистое состояние", await page.evaluate(() => {
  const raw = localStorage.getItem("retro_save_v1");
  if (!raw) return false;
  const saved = JSON.parse(raw).S;
  return saved.cash === 0 && (saved.staff || []).length === 0;
}));

console.log("\nПрогон");
const run = await page.evaluate(async () => {
  const G = window.GAME, S = G.S;
  // Год не зависит от того, что оставили предыдущие тесты: сброс прогресса
  // выше нарочно зануляет месяц, поэтому ждём не фиксированное время,
  // а сам переход в 2008-й — так тест не привязан к чужому состоянию.
  // Скорость 250: месяц теперь 90 игровых секунд, на старой скорости
  // тринадцать месяцев шли бы дольше таймаута.
  S.speed = 250;
  const started = S.month;
  const t0 = Date.now();
  const $ = id => document.getElementById(id);
  while(S.month < started + 13 && Date.now() - t0 < 15000){
    await new Promise(r => setTimeout(r, 50));
    // На такой скорости успевают открыться мини-игра, развилка про ООО
    // и карточка эпохи — все они честно останавливают время. Живой игрок
    // их закрывает; прогон обязан делать то же, иначе стоит на месте.
    if($("mgSheet").classList.contains("on")){
      if(!$("mgOk").hidden) $("mgOk").click();
      else if(!$("mgDial").hidden && !$("mgHit").disabled) $("mgHit").click();
      else if(!$("mgPick").hidden) $("mgPick").querySelector(".mgo")?.click();
    }
    if($("llcSheet").classList.contains("on")) $("llcNo").click();
    if($("eraSheet").classList.contains("on")) $("eraOk").click();
  }
  return { год: G.year(), эпоха: S.era, записей: S.logHistory.length };
});
ok("время идёт и эпохи меняются", run.год > 2007, run);
ok("хроника наполняется", run.записей > 0, run);
ok("за прогон не было ошибок", errors.length === 0, errors);

await browser.close();
console.log(failed ? "\nПровалено проверок: " + failed + "\n" : "\nВсё сошлось\n");
process.exit(failed ? 1 : 0);
