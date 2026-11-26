// Собирает всё в один файл dist/pripev.html
import { build } from 'esbuild';
import fs from 'node:fs';

// Адрес сервера аккаунтов. Пустой — аккаунты и лимиты выключены.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let server = (process.env.PRIPEV_SERVER ?? pkg.pripev?.server ?? '').trim().replace(/\/+$/, '');
if (server === 'off') server = '';
if (server && !/^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(server)) throw new Error(`Адрес сервера должен начинаться с https://, а не «${server}»`);

const js = (await build({
  entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', write: false,
  target: 'es2022', charset: 'utf8', legalComments: 'inline',
  define: { __SERVER__: JSON.stringify(server) },
})).outputFiles[0].text;

const FONTS = [
  ...['inter', 'montserrat', 'rubik', 'oswald', 'unbounded', 'comfortaa', 'caveat', 'jetbrains-mono'].map((n) => [`@fontsource-variable/${n}`, 'wght']),
  ['@fontsource/lobster', '400'],
];
const fontCss = FONTS.map(([pack, weight]) => {
  const dir = `node_modules/${pack}`;
  const faces = fs.readFileSync(`${dir}/${weight}.css`, 'utf8')
    .split('@font-face')
    .slice(1)
    .map((b) => `@font-face${b.slice(0, b.indexOf('}') + 1)}`)
    .filter((b) => new RegExp(`-(latin|latin-ext|cyrillic|cyrillic-ext)-${weight}-normal\\.woff2`).test(b))
    // оставляем только woff2
    .map((b) => b.replace(/src:[^;}]+;/, (src) => {
      const f = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/)[1];
      return `src: url(data:font/woff2;base64,${fs.readFileSync(`${dir}/files/${f}`).toString('base64')}) format('woff2');`;
    }));
  if (faces.length !== 4) throw new Error(`Шрифт ${pack}: ждали 4 набора букв, нашли ${faces.length}`);
  return faces.join('\n');
}).join('\n');

const css = `${fontCss}\n${fs.readFileSync('src/style.css', 'utf8')}`;
const html = fs.readFileSync('src/index.html', 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'));

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/pripev.html', html);
console.log('dist/pripev.html', (html.length / 1024).toFixed(0), 'KB', server ? `аккаунты: ${server}` : 'без аккаунтов');
// копия для desktop-программы
fs.copyFileSync('dist/pripev.html', 'desktop/app.html');
