// Запускает установленный «Куплет» и управляет им через протокол отладки Chrome.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expected = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
const exe = fs.readdirSync(programs).map((d) => path.join(programs, d, 'Kuplet.exe')).find((p) => fs.existsSync(p));
if (!exe) throw new Error('Установленная программа не найдена');
const version = () => execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`]).toString().trim();
console.log('Установлено:', exe, version());

// тестовая музыка: два трека по 20 секунд в папке с русским именем и текст рядом с первым
const music = fs.mkdtempSync(path.join(os.tmpdir(), 'Музыка '));
const rate = 44100, n = rate * 20;
for (const [name, step] of [['Тест - Первая', 0.03], ['Тест - Вторая', 0.05]]) {
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin(i * step) * 4000), 44 + i * 2);
  fs.writeFileSync(path.join(music, `${name}.wav`), wav);
}
fs.writeFileSync(path.join(music, 'Тест - Первая.lrc'), '[00:01.00] Проверка текста\n[00:09.00] Вторая строка\n');

spawn(exe, ['--remote-debugging-port=9223'], { detached: true, stdio: 'ignore' }).unref();

let page;
for (let i = 0; i < 90 && !page; i++) {
  await sleep(1000);
  page = await fetch('http://127.0.0.1:9223/json').then((r) => r.json()).then((l) => l.find((t) => t.url.endsWith('app.html'))).catch(() => null);
}
if (!page) throw new Error('Программа не запустилась');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const k = ++id;
  waiting.set(k, (d) => (d.error ? reject(new Error(d.error.message)) : resolve(d.result)));
  ws.send(JSON.stringify({ id: k, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expression, seconds, what) => {
  for (let i = 0; i < seconds * 2; i++) {
    if (await js(expression)) return;
    await sleep(500);
  }
  throw new Error(`Не дождались: ${what}`);
};

await until('!!window.__kuplet?.ready', 30, 'загрузку окна');
await js(`window.kuplet.addPaths([${JSON.stringify(music)}])`);
await until('window.__kuplet.lib.tracks.size === 2', 30, 'чтение музыки');

await js(`{ const k = window.__kuplet; const ids = [...k.lib.tracks.values()].sort((a) => (a.title === 'Первая' ? -1 : 1)).map((t) => t.id); k.player.playList(ids, 0, false); }`);
await until("document.querySelector('#audio').readyState >= 2 && document.querySelector('#audio').duration > 19", 20, 'открытие трека');
await js('window.__kuplet.player.seek(8)');
await sleep(4000);
const at = await js("document.querySelector('#audio').currentTime");
console.log('Позиция после перемотки и 4 секунд:', at.toFixed(1));
if (at < 7.9) throw new Error('Перемотка не работает');
// на сервере сборки нет звуковой карты, поэтому движение времени только сообщаем
console.log('Время идёт:', at > 9);

await js("document.querySelector('#lyricsBtn').click()");
await until("document.querySelectorAll('#lyrics .line').length === 2", 15, 'текст песни из файла');
await js("document.querySelector('#stageClose').click(); document.querySelector('#next').click()");
await until("document.querySelector('#nowTitle').textContent === 'Вторая'", 10, 'следующий трек');
console.log('Играет:', await js("document.querySelector('#nowTitle').textContent"));

await js("document.querySelector('[data-route=settings]').click(); document.querySelector('#updateCheck').click()");
await until("!document.querySelector('#updateCheck').disabled", 90, 'проверку обновлений');
console.log('Обновления:', await js("document.querySelector('#updateText').textContent"));
if (await js("document.querySelector('#updateInstall').hidden")) throw new Error('Обновление не найдено');
await js("document.querySelector('#updateInstall').click()");

for (let i = 0; i < 120; i++) {
  await sleep(3000);
  let now = '';
  try { now = version(); } catch { /* файл заменяется */ }
  if (now.startsWith(expected)) {
    console.log('Обновилось до', now);
    await sleep(10000);
    const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Kuplet.exe']).toString().includes('Kuplet.exe');
    console.log('После обновления программа запущена:', running);
    execFileSync('taskkill', ['/F', '/IM', 'Kuplet.exe'], { stdio: 'ignore' });
    process.exit(0);
  }
}
throw new Error(`Версия не обновилась до ${expected}, сейчас ${version()}`);
