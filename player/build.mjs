// Собирает интерфейс плеера в один файл desktop/app.html. Запуск из корня: node player/build.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const js = (await build({
  entryPoints: [here('src/app.js')], bundle: true, minify: true, format: 'iife', write: false,
  target: 'es2022', charset: 'utf8', legalComments: 'inline',
})).outputFiles[0].text;

const ranges = fs.readFileSync(here('../node_modules/@fontsource-variable/inter/wght.css'), 'utf8')
  .split('@font-face')
  .slice(1)
  .map((b) => `@font-face${b.slice(0, b.indexOf('}') + 1)}`);
const data = (file) => `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}) format('woff2')`;
// Inter — для кнопок и подписей; берём латиницу и кириллицу вместе с казахскими буквами
const inter = ranges
  .filter((b) => /-(latin|latin-ext|cyrillic|cyrillic-ext)-wght-normal\.woff2/.test(b))
  .map((b) => b.replace(/src:[^;}]+;/, (src) => {
    const file = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
    return `src: ${data(here(`../node_modules/@fontsource-variable/inter/files/${file}`))};`;
  }));
if (inter.length !== 4) throw new Error(`Шрифт Inter: ждали 4 набора букв, нашли ${inter.length}`);
// Piazzolla — для названий и текстов песен; лежит в src/fonts
const piazzolla = [
  ['latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],
  ['cyrillic', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'],
  ['cyrillic-ext', 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F'],
].map(([set, range]) => `@font-face { font-family: 'Piazzolla Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: ${data(here(`src/fonts/piazzolla-${set}-wght-normal.woff2`))}; unicode-range: ${range}; }`);
const faces = [...inter, ...piazzolla];

const html = fs.readFileSync(here('src/index.html'), 'utf8')
  .replace('/*CSS*/', () => `${faces.join('\n')}\n${fs.readFileSync(here('src/style.css'), 'utf8')}`)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'));

fs.writeFileSync(here('desktop/app.html'), html);
console.log('player/desktop/app.html', (html.length / 1024).toFixed(0), 'KB');
