/* Генератор иконок. Запуск:
 *   node test/icon.mjs
 *
 * Иконка — тот же график, который игрок видит в отчёте: три растущих
 * столбца, и последний охряный. В этом весь тезис игры: числа растут,
 * а последнее число — уже риск. Рисуем в браузере и снимаем в PNG,
 * потому что растровых библиотек в проекте нет и заводить их ради
 * четырёх файлов не стоит.
 *
 * Поля щедрые: Android режет иконку под маску и оставляет центральные
 * 80%, поэтому график не должен подходить к краю.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC = process.env.CHROME_PATH || undefined;

const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="0" fill="#0b0b0c"/>
  <g>
    <rect x="128" y="279" width="66" height="104" rx="14" fill="#80BA27"/>
    <rect x="223" y="215" width="66" height="168" rx="14" fill="#80BA27"/>
    <rect x="318" y="129" width="66" height="254" rx="14" fill="#ff9f0a"/>
  </g>
</svg>`;

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();

for (const size of [32, 180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:#0b0b0c}svg{display:block}</style>${svg(size)}`);
  await page.screenshot({ path: resolve(ROOT, "icons", `icon-${size}.png`), omitBackground: false });
  console.log("icons/icon-" + size + ".png");
}

await browser.close();
