/* Загрузка сохранений из прошлых версий. Запуск:
 *   node test/saves.mjs
 *
 * Отвечает на один вопрос: откроется ли игра у человека, который
 * последний раз играл год назад и с тех пор не заходил.
 *
 * Это не абстрактная предосторожность. Ровно этот класс уже выстрелил:
 * сейв, сделанный до появления восьми ролей, подменял счётчики штата
 * целиком, роль из новой версии приходила как undefined, и цена найма
 * показывалась как «NaN млрд ₽». Проверка версией сохранения не спасала
 * бы: каждая новая роль ломала бы старые сейвы заново.
 *
 * Поэтому фикстуры берутся не из головы, а из самой истории репозитория:
 * для каждого релизного коммита открывается ТА версия игры, в ней
 * заводится живая партия, её сохранение снимается — и скармливается
 * СЕГОДНЯШНЕЙ версии. Список версий растёт сам вместе с историей.
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC = process.env.CHROME_PATH || undefined;
const git = (...a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 1 << 28 });

// Релизные коммиты: те, где менялась версия игры. Берём по одному на
// версию, начиная с той, где вообще появилось сохранение.
const commits = git("log", "--format=%H %s", "--reverse", "main")
  .toString().trim().split("\n")
  .map(l => { const i = l.indexOf(" "); return { sha: l.slice(0, i), subj: l.slice(i + 1) }; })
  .filter(c => /^\d+\.\d+\.\d+:/.test(c.subj) || /Сохранение прогресса/.test(c.subj));

let failed = 0;
const ok = (name, cond, got) => {
  if (cond) { console.log("  ✓ " + name); return; }
  failed++; console.log("  ✗ " + name + (got !== undefined ? " — " + JSON.stringify(got) : ""));
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const tmp = mkdtempSync(resolve(tmpdir(), "retro-saves-"));

// Партия, которую заводим в старой версии: немного денег, немного людей,
// немного истории. Достаточно, чтобы сейв был не пустой заготовкой.
const PLAY = () => {
  const G = window.GAME, S = G.S;
  S.cash = 5e6; S.earned = 4e7; S.month = 96; S.llc = true;
  const роли = G.C.roles.filter(r => !r.viaBlock).slice(0, 6);
  роли.forEach(r => { try { G.addStaff(r); } catch (e) {} });
  G.C.ups.slice(0, 2).forEach(u => { try { S.bought.add(u.id); u.f(S); } catch (e) {} });
  try { G.log("Партия из старой версии.", "lore"); } catch (e) {}
  G.saveGame();
  return localStorage.getItem("retro_save_v1");
};

console.log("\nСохранения из прошлых версий\n");

for (const c of commits) {
  const ver = c.subj.split(":")[0];
  const file = resolve(tmp, "old-" + c.sha.slice(0, 7) + ".html");
  writeFileSync(file, git("show", c.sha + ":index.html"));

  // 1. Завести партию в старой версии и снять её сохранение.
  let raw;
  const old = await browser.newPage({ viewport: { width: 393, height: 852 } });
  try {
    await old.goto("file://" + file);
    await old.waitForTimeout(250);
    raw = await old.evaluate(PLAY);
  } catch (e) { raw = null; }
  await old.close();
  if (!raw) { console.log("  · " + ver + " — сейв не снялся, пропуск"); continue; }

  // 2. Скормить его сегодняшней версии.
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto("file://" + resolve(ROOT, "index.html"));
  await page.evaluate(s => {
    localStorage.setItem("retro_save_v1", s);
    // Уход со страницы сохраняет игру — и затирает подложенный сейв
    // свежим ещё до перезагрузки. Флаг финала глушит автосохранение:
    // saveGame() на нём выходит сразу. Ровно на этом спотыкалась
    // первая попытка воспроизвести баг с NaN.
    window.GAME.S.ended = true;
  }, raw);
  await page.reload();
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const G = window.GAME, S = G.S;
    document.querySelector('nav button[data-tab=team]')?.click();
    const цены = G.C.roles.map(x => G.hireCost(x));
    const тексты = [...document.querySelectorAll("#hire .row")].map(d => d.innerText).join(" ");
    return {
      год: G.year(), касса: Math.round(S.cash), штат: S.staff.length,
      всеЦелые: цены.every(Number.isFinite),
      считает: [G.revenue(), G.payroll(), G.overhead(), G.profit(), G.clickVal()].every(Number.isFinite),
      nanНаЭкране: /NaN|Infinity/.test(тексты),
    };
  });

  console.log("── " + ver + " (" + c.sha.slice(0, 7) + ")");
  ok("открылась без ошибок", errors.length === 0, errors);
  ok("прогресс на месте", r.год >= 2007 && r.касса > 0, r);
  ok("все цены найма — числа", r.всеЦелые && !r.nanНаЭкране, r);
  ok("экономика считается", r.считает, r);
  await page.close();
}

rmSync(tmp, { recursive: true, force: true });
await browser.close();
console.log(failed ? "\nПровалено: " + failed + "\n" : "\nВсе старые сохранения открылись\n");
process.exit(failed ? 1 : 0);
