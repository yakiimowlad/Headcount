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
    S.speed = 12;                       // ускоряем время, поведение не трогаем
    const buys = [];                    // [момент игрового времени, что купили]
    const marks = {};                   // когда впервые случилось важное
    const mark = k => { if (marks[k] === undefined) marks[k] = Math.round(S.playTime); };

    const $ = id => document.getElementById(id);
    // Модалки про ООО и смену эпохи останавливают время. Живой игрок их
    // закрывает, бот обязан делать то же — иначе прогон встанет.
    const dismiss = () => {
      if ($("llcSheet").classList.contains("on")) {
        // Торопливый регистрирует ООО сразу, методичный — с пятью людьми.
        const now = kind === "торопливый" || S.staff.length >= 5;
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

    const t0 = Date.now();
    while ((Date.now() - t0) / 1000 < seconds) {
      await new Promise(r => setTimeout(r, 50));
      dismiss();
      if (S.ended) break;

      // ── тапы
      if (kind === "торопливый") {
        // Долбит без разбора: два тапа за шаг, в ритм не целится.
        G.doTask(); G.doTask();
      } else {
        // Тапает по волне и пропускает то, что дорого жжёт.
        if (S.burn < 70) G.doTask();
      }

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
      } else {
        // Держит подушку в один ФОТ и берёт по одной покупке за раз.
        const cushion = G.payroll() + G.overhead();
        const free = S.cash - cushion;
        const h = affordableHires()[0];
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
    }

    return {
      год: G.year(), штат: S.staff.length, касса: Math.round(S.cash),
      заработано: Math.round(S.earned), время: Math.round(S.playTime),
      покупки: buys, вехи: marks, ошибки: []
    };
  }, { kind, seconds });

  res.ошибки = errors;
  await page.close();
  return res;
}

// Серия — это покупки, между которыми игрок не успел ничего накопить.
// Порог в 4 игровых секунды: меньше половины игрового месяца.
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
    if (t - prev <= 4) cur++; else cur = 1;
    if (cur > best) best = cur;
    prev = t;
  });
  return { длиннейшая: best, всего: early.length };
}

const SECS = Number(process.env.SECS || 40);
console.log("\nПрогон по " + SECS + " с реального времени, скорость ×12\n");

for (const kind of ["торопливый", "методичный"]) {
  const r = await play(kind, SECS);
  const до2016 = r.вехи["2016"];
  const prog = series(r.покупки, до2016, ["улучшение", "повышение"]);
  const hire = series(r.покупки, до2016, ["найм"]);
  console.log("── " + kind);
  console.log("   дошёл до " + r.год + ", штат " + r.штат + ", заработано " + r.заработано.toLocaleString("ru"));
  console.log("   вехи: " + JSON.stringify(r.вехи));
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
