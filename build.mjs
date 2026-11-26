// Собирает всё в один файл dist/pripev.html
import { build } from 'esbuild';
import fs from 'node:fs';

const js = (await build({
  entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', write: false,
  target: 'es2022', charset: 'utf8', legalComments: 'inline',
})).outputFiles[0].text;

const dir = 'node_modules/@fontsource-variable/inter';
const fontCss = fs.readFileSync(`${dir}/wght.css`, 'utf8')
  .split('@font-face')
  .slice(1)
  .map((b) => `@font-face${b.slice(0, b.indexOf('}') + 1)}`)
  .filter((b) => /inter-(latin|latin-ext|cyrillic|cyrillic-ext)-wght-normal/.test(b))
  .map((b) => b.replace(/url\(\.\/files\/([^)]+)\)/, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(`${dir}/files/${f}`).toString('base64')})`))
  .join('\n');

const css = `${fontCss}\n${fs.readFileSync('src/style.css', 'utf8')}`;
const html = fs.readFileSync('src/index.html', 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'));

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/pripev.html', html);
console.log('dist/pripev.html', (html.length / 1024).toFixed(0), 'KB');
// копия для desktop-программы
fs.copyFileSync('dist/pripev.html', 'desktop/app.html');
