// Запускает установленную программу и управляет ею через протокол отладки Chrome.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const expected = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const programs = path.join(process.env.LOCALAPPDATA, 'Programs');
const exe = fs.readdirSync(programs).map((d) => path.join(programs, d, 'Pripev.exe')).find((p) => fs.existsSync(p));
if (!exe) throw new Error('Установленная программа не найдена');
const version = () => execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`]).toString().trim();
console.log('Установлено:', exe, version());

spawn(exe, ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' }).unref();

let page;
for (let i = 0; i < 90 && !page; i++) {
  await sleep(1000);
  page = await fetch('http://127.0.0.1:9222/json').then((r) => r.json()).then((l) => l.find((t) => t.url.endsWith('app.html'))).catch(() => null);
}
if (!page) throw new Error('Программа не запустилась');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  waiting.set(n, (d) => (d.error ? reject(new Error(d.error.message)) : resolve(d.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expression, seconds, what) => {
  for (let i = 0; i < seconds * 2; i++) {
    if (await js(expression)) return;
    await sleep(500);
  }
  throw new Error(`Не дождались: ${what}`);
};

// тестовый трек: 20 секунд тона в WAV
const rate = 44100, n = rate * 20;
const wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin(i * 0.03) * 8000), 44 + i * 2);
const track = path.join(os.tmpdir(), 'Queen - Bohemian Rhapsody.wav');
fs.writeFileSync(track, wav);

await until("document.readyState === 'complete' && !!window.updater", 30, 'загрузку окна');
const { root } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' });
await send('DOM.setFileInputFiles', { nodeId, files: [track] });
await until("!document.querySelector('#export').disabled", 60, 'чтение трека');

// живые сервисы обложек и текстов (только отчёт: сеть может подвести)
await sleep(20000);
console.log('Поиск:', await js(`JSON.stringify({
  covers: document.querySelectorAll('#covers button').length,
  coverApplied: !!document.querySelector('#covers [aria-pressed=true]'),
  coverStatus: document.querySelector('#coverStatus').textContent,
  lyricVariants: document.querySelectorAll('#variants option').length,
  lyricStatus: document.querySelector('#lyricStatus').textContent,
})`));

await js(`document.querySelector('#lrc').value = '[00:01.00] Проверка экспорта\\n[00:08.00] Вторая строка';
  document.querySelector('#applyLrc').click();
  document.querySelector('[data-len="15"]').click();
  document.querySelector('#export').click();`);
await until('!window.__pripev.state.exporting', 600, 'экспорт видео');
const exported = await js("document.querySelector('#exportStatus').textContent");
console.log('Экспорт:', exported);
if (!exported.startsWith('Готово')) throw new Error('Экспорт не прошёл');

await js("document.querySelector('#done').close()");
await js("document.querySelector('#updCheck').click()");
await until("!document.querySelector('#updCheck').disabled", 90, 'проверку обновлений');
console.log('Обновления:', await js("document.querySelector('#updates').innerText"));
if (await js("document.querySelector('#updInstall').hidden")) throw new Error('Обновление не найдено');
await js("document.querySelector('#updInstall').click()");

for (let i = 0; i < 120; i++) {
  await sleep(3000);
  let now = '';
  try { now = version(); } catch { /* файл заменяется */ }
  if (now.startsWith(expected)) {
    console.log('Обновилось до', now);
    await sleep(10000);
    const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Pripev.exe']).toString().includes('Pripev.exe');
    console.log('После обновления программа запущена:', running);
    execFileSync('taskkill', ['/F', '/IM', 'Pripev.exe'], { stdio: 'ignore' });
    process.exit(0);
  }
}
throw new Error(`Версия не обновилась до ${expected}, сейчас ${version()}`);
