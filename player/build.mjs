// Собирает интерфейс плеера в один файл desktop/app.html. Запуск из корня: node player/build.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const js = (await build({
  entryPoints: [here('src/app.js')], bundle: true, minify: true, format: 'iife', write: false,
  target: 'es2022', charset: 'utf8', legalComments: 'inline',
})).outputFiles[0].text;

const font = here('../node_modules/@fontsource-variable/inter');
const faces = fs.readFileSync(`${font}/wght.css`, 'utf8')
  .split('@font-face')
  .slice(1)
  .map((b) => `@font-face${b.slice(0, b.indexOf('}') + 1)}`)
  .filter((b) => /-(latin|latin-ext|cyrillic|cyrillic-ext)-wght-normal\.woff2/.test(b))
  .map((b) => b.replace(/src:[^;}]+;/, (src) => {
    const file = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
    return `src: url(data:font/woff2;base64,${fs.readFileSync(`${font}/files/${file}`).toString('base64')}) format('woff2');`;
  }));
if (faces.length !== 4) throw new Error(`Шрифт Inter: ждали 4 набора букв, нашли ${faces.length}`);

const html = fs.readFileSync(here('src/index.html'), 'utf8')
  .replace('/*CSS*/', () => `${faces.join('\n')}\n${fs.readFileSync(here('src/style.css'), 'utf8')}`)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'));

fs.writeFileSync(here('desktop/app.html'), html);
console.log('player/desktop/app.html', (html.length / 1024).toFixed(0), 'KB');
