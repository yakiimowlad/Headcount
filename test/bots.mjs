/* Балансовый прогон двумя ботами. Запуск:
 *   node test/bots.mjs
 *
 * Тест не проверяет, что игра работает — для этого есть smoke.mjs.
 * Он отвечает на один вопрос: сколько покупок подряд позволяет
 * экономика в первых двух эпохах. Если больше двух — копить не нужно,
 * и прогрессия рвётся скачками вместо ровного набора.
 *
 * Два бота нарочно разные. Торопливый покупает всё, до чего дотянулся,
 * и тапает без пауз. Методичный тапает в ритм и берёт по приоритету.
 * Если у обоих серии длинные — виновата экономика, а не стиль игры.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const GAME = "file://" + resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.html");
const EXEC = process.env.CHROME_PATH || undefined;

// Бот живёт внутри страницы: дёргать сто раз в секунду через мост
// медленнее прогона на порядок.
async function run(page, kind, seconds) {
  return page.evaluate(async ({ kind, seconds }) => {
    const G = window.GAME, S = G.S;

    // Чистый лист: прогон должен начинаться с 2007-го, а не с того,
    // что осталось в localStorage от прошлого бота.
    G.clearSave();
    location.reload();
    await new Promise(r => setTimeout(r, 1));
  }, { kind, seconds });
}

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
let failed = 0;

// Один прогон = одна свежая вкладка. Так между ботами не остаётся ни
// сейва, ни аудиоконтекста, ни накопленного времени.
async function play(kind, seconds) {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(GAME);
  await page.evaluate(() => window.GAME.clearSave());
  await page.reload();
  await page.waitForTimeout(300);

  const res = await page.evaluate(async ({ kind, seconds }) => {
    const G = window.GAME, S = G.S, C = G.C;
    S.speed = 60;                       // ускоряем время, поведение не трогаем
    const curve = {};                   // пик кассы за каждый год
    const turn  = {};                   // накопленный оборот на конец года
    const buys = [];                    // [момент игрового времени, что купили]
    const marks = {};                   // когда впервые случилось важное
    const mark = k => { if (marks[k] === undefined) marks[k] = Math.round(S.playTime); };

    const $ = id => document.getElementById(id);
    // Модалки про ООО и смену эпохи останавливают время. Живой игрок их
    // закрывает, бот обязан делать то же — иначе прогон встанет.
    const dismiss = () => {
      // Онбординг встречает первую жизнь и перекрывает экран. Живой
      // игрок его пролистывает, бот — пропускает.
      if (!$("onb").hidden) $("obSkip").click();
      // Кризис останавливает время и ждёт решения. Бот отвечает наугад:
      // так видно нижнюю границу — сколько теряет тот, кто не вникает.
      if ($("krSheet").classList.contains("on")) {
        if (!$("krOk").hidden) $("krOk").click();
        else $("krPick").querySelector(".mgo")?.click();
      }
      if ($("llcSheet").classList.contains("on")) {
        // Торопливый регистрирует ООО сразу. Методичный читает то, что
        // написано на самой развилке: «сейчас это в минус» — значит рано.
        // Юрлицо с восемью дешёвыми людьми честно убыточно (так и в
        // документе), и игрок, который этого не прочёл, теряет штат.
        const now = kind === "торопливый" || G.llcGain() > 0;
        if (now && S.cash >= G.LLC_COST) { $("llcYes").click(); mark("ооо"); }
        else $("llcNo").click();
      }
      if ($("eraSheet").classList.contains("on")) $("eraOk").click();
      if ($("bScrim").classList.contains("on")) $("bScrim").click();
      // Мини-игра тоже останавливает время. Бот обязан её доиграть,
      // иначе прогон встаёт намертво — ровно так и случилось в первый раз.
      if ($("mgSheet").classList.contains("on")) {
        mark("мини-игра");
        if (!$("mgOk").hidden) $("mgOk").click();
        else if (!$("mgDial").hidden) { if (!$("mgHit").disabled) $("mgHit").click(); }
        else if (!$("mgPick").hidden) {
          // Торопливый жмёт первое попавшееся. Методичный узнаёт вопрос
          // по тексту на экране и выбирает заведомо верный вариант —
          // так видно разницу между «прокликал» и «прочитал».
          const opts = $("mgPick").querySelectorAll(".mgo");
          const shown = $("mgD").textContent;
          const q = G.MG.prompt.qs.find(x => shown.startsWith(x.q));
          const i = kind === "торопливый" ? 0 : (q ? q.right : 0);
          if (opts[i]) opts[i].click();
        }
      }
    };

    const affordableHires = () => C.roles
      .filter(r => !G.roleLocked(r) && G.hireCost(r) <= S.cash)
      .sort((a, b) => (b.out - b.pay) - (a.out - a.pay));
    const affordableUps = () => C.ups
      .filter(u => !S.bought.has(u.id) && !G.upLocked(u) && u.cost <= S.cash);
    const affordableSteps = () => {
      const out = [];
      C.tracks.forEach(t => t.steps.forEach(st => {
        if (!S.done.has(st.id) && G.stepReady(t, st) && !st.dangerous) out.push(st);
      }));
      return out;
    };

    // Тапы считаются от ИГРОВОГО времени, а не от реального. Иначе на
    // скорости ×60 бот успевает тридцать тапов в игровой месяц, а живой
    // игрок за те же девяносто секунд — три сотни, и замер клика врёт
    // на порядок. Плотность взята человеческая: торопливый бьёт 2,5 раза
    // в игровую секунду, методичный — 1,2 и только пока не жжёт.
    const RATE = kind === "торопливый" ? 2.5 : 1.2;
    let taps = 0, tPrev = S.playTime;

    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < seconds) {
      await new Promise(r => setTimeout(r, 50));
      dismiss();
      if (S.ended) break;

      // ── тапы
      taps += (S.playTime - tPrev) * RATE;
      tPrev = S.playTime;
      const canTap = kind === "торопливый" || S.burn < 70;
      while (taps >= 1) { taps -= 1; if (canTap) G.doTask(); }

      // ── покупки
      const take = (what, id) => { buys.push([Math.round(S.playTime), what, id]); };

      if (kind === "торопливый") {
        // Берёт всё, до чего дотянулся, в том же тике.
        let h; while ((h = affordableHires()[0])) {
          S.cash -= G.hireCost(h); G.addStaff(h); take("найм", h.id);
        }
        affordableUps().forEach(u => {
          if (u.cost <= S.cash) { S.cash -= u.cost; S.bought.add(u.id); u.f(S); take("улучшение", u.id); }
        });
        affordableSteps().forEach(st => {
          const p = S.staff.find(x => x.role === st.from && !x.perk);
          if (p && S.cash >= G.promoCost(st)) {
            S.cash -= G.promoCost(st);
            p.perk = st.id; p.pay = st.pay; p.bonus = st.bonus; p.scope = st.scope;
            S.done.add(st.id); if (st.eff) st.eff(S); take("повышение", st.id); }
        });
        // Офферы — тоже «всё, до чего дотянулся»: жмёт при первой
        // возможности и берёт лучший множитель из трёх. Это единственный
        // способ, которым бот трогает смену работы вообще, и он уже раз
        // ловил реальный баг: до правки клик рос без предела при частых
        // переходах, и оборот 2015-го улетал в триллионы.
        if (G.jobReady && G.jobReady()) {
          G.rollOffers();
          let best = 0;
          S.offers.forEach((o, i) => { if (o.mul > S.offers[best].mul) best = i; });
          G.takeOffer(best);
          mark("смена работы");
        }
      } else {
        // Держит подушку в один ФОТ и берёт по одной покупке за раз.
        const cushion = G.payroll() + G.overhead();
        const free = S.cash - cushion;
        // Думающий игрок видит, что бонус к заказам упёрся в потолок:
        // до регистрации восьмой человек — последний, кто хоть что-то
        // даёт. Дальше он копит на юрлицо, а не на девятого «за долю».
        const capped = !S.llc && G.crewBoost() >= 2.19;
        const h = capped ? null : affordableHires()[0];
        if (h && G.hireCost(h) <= free) { S.cash -= G.hireCost(h); G.addStaff(h); take("найм", h.id); }
        else {
          const u = affordableUps().find(u => u.cost <= free);
          if (u) { S.cash -= u.cost; S.bought.add(u.id); u.f(S); take("улучшение", u.id); }
        }
        const st = affordableSteps()[0];
        if (st) {
          const p = S.staff.find(x => x.role === st.from && !x.perk);
          if (p && free >= G.promoCost(st)) {
            S.cash -= G.promoCost(st);
            p.perk = st.id; p.pay = st.pay; p.bonus = st.bonus; p.scope = st.scope;
            S.done.add(st.id); if (st.eff) st.eff(S); take("повышение", st.id); }
        }
      }
      G.bumpEcon();
      if (S.staff.length) mark("первый наём");
      if (G.year() >= 2011) mark("2011");
      if (G.year() >= 2016) mark("2016");
      // Пик кассы за год — это самое большое число, которое игрок видит
      // в шапке. Именно оно отвечает на вопрос «когда на экране появились
      // миллионы». Мгновенная касса не годится: торопливый тратит всё в
      // тот же тик, и по ней видно его импульсивность, а не масштаб.
      const y = G.year();
      curve[y] = Math.max(curve[y] || 0, Math.round(S.cash));
      turn[y] = Math.round(S.earned);
    }

    return {
      год: G.year(), штат: S.staff.length, касса: Math.round(S.cash),
      заработано: Math.round(S.earned), время: Math.round(S.playTime),
      покупки: buys, вехи: marks, кривая: curve, оборот: turn, ошибки: []
    };
  }, { kind, seconds });

  res.ошибки = errors;
  await page.close();
  return res;
}

// Серия — это покупки, между которыми игрок не успел ничего накопить.
// Порог в 45 игровых секунд: половина игрового месяца (месяц — 90 секунд).
//
// Считаем отдельно улучшения с повышениями и отдельно найм. Это разные
// вещи по смыслу: найм подряд — это рост, он и должен быть возможен,
// когда деньги есть. А вот прокачка подряд убивает ощущение выбора:
// если можно взять всё сразу, приоритет не нужен.
function series(buys, untilYear2016at, kinds) {
  const early = buys.filter(b =>
    (untilYear2016at === undefined || b[0] < untilYear2016at) && kinds.includes(b[1]));
  let best = 0, cur = 0, prev = -99;
  early.forEach(([t]) => {
    if (t - prev <= 45) cur++; else cur = 1;
    if (cur > best) best = cur;
    prev = t;
  });
  return { длиннейшая: best, всего: early.length };
}

const SECS = Number(process.env.SECS || 150);
console.log("\nПрогон по " + SECS + " с реального времени, скорость ×60\n");

for (const kind of ["торопливый", "методичный"]) {
  const r = await play(kind, SECS);
  const до2016 = r.вехи["2016"];
  const prog = series(r.покупки, до2016, ["улучшение", "повышение"]);
  const hire = series(r.покупки, до2016, ["найм"]);
  console.log("── " + kind);
  console.log("   дошёл до " + r.год + ", штат " + r.штат + ", заработано " + r.заработано.toLocaleString("ru"));
  console.log("   вехи: " + JSON.stringify(r.вехи));
  // Контрольные точки кривой дохода: не миллионы до 2010-го,
  // не миллиарды до 2020-го, десятки миллиардов — только после ИИ.
  const at = y => r.кривая[y] === undefined ? "—" : r.кривая[y].toLocaleString("ru");
  const ob = y => r.оборот[y] === undefined ? "—" : r.оборот[y].toLocaleString("ru");
  console.log("   пик кассы:  2010: " + at(2010) + " · 2015: " + at(2015) +
              " · 2020: " + at(2020) + " · 2024: " + at(2024));
  console.log("   оборот:     2010: " + ob(2010) + " · 2015: " + ob(2015) +
              " · 2020: " + ob(2020) + " · 2024: " + ob(2024));
  // Контрольные точки кривой: не миллионы до 2010-го, не миллиарды до
  // ковида, десятки миллиардов — только после ИИ-бума.
  if (r.кривая[2010] !== undefined && r.кривая[2010] >= 1e6){
    failed++; console.log("   ✗ миллионы уже в 2010-м: ранняя игра слишком щедрая"); }
  if (r.кривая[2019] !== undefined && r.кривая[2019] >= 1e9){
    failed++; console.log("   ✗ миллиарды до ковида: волна 2020-го не будет ощущаться"); }
  // Масштаб компании меряется оборотом, а не кассой: и живой игрок, и
  // торопливый бот превращают деньги в людей в тот же тик.
  //
  // Проверяем РОСТ, а не абсолют. Осторожный игрок к 2015-му честно
  // беднее торопливого — это разные стили, а не разный баланс. Застой
  // выглядит иначе: оборот стоит на месте пять лет подряд.
  const рост = r.оборот[2010] && r.оборот[2015] ? r.оборот[2015] / r.оборот[2010] : null;
  if (рост !== null) console.log("   рост оборота 2010 → 2015: ×" + рост.toFixed(1));
  if (рост !== null && рост < 2.5){
    failed++; console.log("   ✗ за пять лет оборот вырос меньше чем втрое: застой"); }
  if (r.оборот[2024] !== undefined && r.оборот[2024] < 1e9){
    failed++; console.log("   ✗ к 2024-му оборот не дошёл до миллиарда: ИИ-бум не читается"); }
  // Потолок на 2015-й: не было гейта сверху, только «не меньше» —
  // и оборот 2015-го однажды улетел в триллионы через смену работы,
  // а этот прогон ни разу её не трогал, так и не поймав баг. Число —
  // щедрый потолок (обычный прогон ложится в десятки-сотни миллионов
  // даже у торопливого бота, который теперь и меняет работу).
  if (r.оборот[2015] !== undefined && r.оборот[2015] >= 5e9){
    failed++; console.log("   ✗ оборот 2015-го в миллиардах: до ковида такого быть не должно"); }
  console.log("   до 2016: прокачек " + prog.всего + " (серия " + prog.длиннейшая +
              "), наймов " + hire.всего + " (серия " + hire.длиннейшая + ")");
  if (prog.длиннейшая > 2) { failed++; console.log("   ✗ прокачка серией длиннее двух: копить не нужно"); }
  else console.log("   ✓ прокачка идёт не длиннее двух подряд");
  if (r.ошибки.length) { failed++; console.log("   ✗ ошибки: " + r.ошибки.join("; ")); }
  console.log("");
}

await browser.close();
console.log(failed ? "Замечаний: " + failed + "\n" : "Баланс держится\n");
process.exit(failed ? 1 : 0);
