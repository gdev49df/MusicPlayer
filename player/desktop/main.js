const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, protocol, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Library, readJson, writeJson } = require('./library.js');

app.setName('Kuplet');
if (!app.requestSingleInstanceLock()) app.exit();

// media://track/<id> и media://cover/<хэш>: страница получает только то, что есть в библиотеке
protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
let library = null;

const TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

// кусок файла потоком: без этого не работает перемотка
function fileStream(file, start, end) {
  const stream = fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
  let closed = false;
  return new ReadableStream({
    start(c) {
      stream.on('data', (chunk) => {
        if (closed) return;
        c.enqueue(new Uint8Array(chunk));
        if (c.desiredSize <= 0) stream.pause();
      });
      stream.on('end', () => { if (!closed) { closed = true; c.close(); } });
      stream.on('error', (e) => { if (!closed) { closed = true; c.error(e); } });
    },
    pull() { stream.resume(); },
    cancel() { closed = true; stream.destroy(); },
  }, new ByteLengthQueuingStrategy({ highWaterMark: 1 << 20 }));
}

async function serve(request) {
  const url = new URL(request.url);
  const key = url.pathname.slice(1);
  const file = url.host === 'track' ? library.pathOf(key)
    : url.host === 'cover' ? library.coverFile(key, url.searchParams.has('t')) : null;
  let size;
  try { size = file && (await fsp.stat(file)).size; } catch { size = null; }
  if (size === null || size === undefined || !file) return new Response(null, { status: 404 });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
  }
  const headers = {
    // обложку страница читает и для системного окошка плеера
    'Access-Control-Allow-Origin': '*',
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': String(Math.max(0, end - start + 1)),
    'Accept-Ranges': 'bytes',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (url.host === 'cover') headers['Cache-Control'] = 'max-age=31536000, immutable';
  return new Response(size ? fileStream(file, start, end) : null, { status, headers });
}

/* ---------- окно ---------- */

const windowFile = () => path.join(app.getPath('userData'), 'window.json');

function create() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const saved = readJson(windowFile(), {});
  win = new BrowserWindow({
    width: Math.min(saved.width || 1360, area.width),
    height: Math.min(saved.height || 860, area.height),
    minWidth: Math.min(900, area.width),
    minHeight: Math.min(600, area.height),
    title: 'Куплет',
    backgroundColor: '#191022',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    // своя верхняя полоса, кнопки окна остаются системными
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#191022', symbolColor: '#f6eefc', height: 55 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });
  win.on('close', () => {
    try {
      const { width, height } = win.getNormalBounds();
      writeJson(windowFile(), { width, height, maximized: win.isMaximized() });
    } catch { /* размер окна не важен */ }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => {
    if (e.url !== win.webContents.getURL()) e.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'app.html'));
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

/* ---------- запросы страницы ---------- */

const userFile = () => path.join(app.getPath('userData'), 'user.json');
const isIds = (x) => Array.isArray(x) && x.every((v) => typeof v === 'string');

ipcMain.handle('library:get', () => ({ ...library.snapshot(), user: readJson(userFile(), null) }));
ipcMain.on('user:save', (_e, data) => {
  if (data && typeof data === 'object') {
    try { writeJson(userFile(), data); } catch (e) { console.error('user', e.message); }
  }
});

async function choose(properties, filters) {
  const r = await dialog.showOpenDialog(win, { title: 'Добавить музыку', defaultPath: app.getPath('music'), properties, filters });
  return r.canceled ? [] : library.add(r.filePaths);
}
ipcMain.handle('library:addFolder', () => choose(['openDirectory', 'multiSelections']));
ipcMain.handle('library:addFiles', () => choose(['openFile', 'multiSelections'], [{ name: 'Музыка', extensions: ['mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'webm'] }]));
ipcMain.handle('library:addPaths', (_e, paths) => (isIds(paths) ? library.add(paths) : []));
ipcMain.handle('library:removeFolder', (_e, folder) => library.removeFolder(String(folder)));
ipcMain.handle('library:rescan', () => library.scan());
ipcMain.handle('library:remove', (_e, ids) => { if (isIds(ids)) library.removeTracks(ids); });
ipcMain.handle('track:reveal', (_e, id) => {
  const p = library.pathOf(String(id));
  if (p) shell.showItemInFolder(p);
});
ipcMain.handle('track:lyrics', (_e, id) => library.lyrics(String(id)));
ipcMain.handle('track:saveLyrics', (_e, id, text) => library.saveLyrics(String(id), text === null ? null : String(text)));

// поиск обложек: только эти два сервиса
const SEARCH = new Set(['itunes.apple.com', 'api.deezer.com']);
ipcMain.handle('web:json', async (_e, address) => {
  const url = new URL(String(address));
  if (url.protocol !== 'https:' || !SEARCH.has(url.hostname)) throw new Error('Адрес не разрешён');
  const r = await net.fetch(url.href, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});
ipcMain.handle('web:cover', async (_e, address) => {
  const url = new URL(String(address));
  if (url.protocol !== 'https:' || !/\.(mzstatic\.com|dzcdn\.net)$/.test(url.hostname)) throw new Error('Адрес не разрешён');
  const r = await net.fetch(url.href, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const hash = library.saveCover(Buffer.from(await r.arrayBuffer()));
  if (!hash) return null;
  library.save();
  return { hash, info: library.data.covers[hash] };
});

/* ---------- обновления ---------- */

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('error', () => {});
autoUpdater.on('download-progress', (p) => send('update:progress', p.percent));

function explain(e) {
  const text = String(e?.message || e);
  if (/ENOTFOUND|ETIMEDOUT|ECONNRE|ERR_INTERNET|ERR_NAME|ERR_CONNECTION|ERR_NETWORK/i.test(text)) {
    return 'нет связи с GitHub. Проверьте интернет.';
  }
  return text.split('\n')[0].slice(0, 160);
}

ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { error: 'обновления работают только в установленной программе.' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: Boolean(result?.isUpdateAvailable), latest: result?.updateInfo?.version };
  } catch (e) {
    return { error: explain(e) };
  }
});
ipcMain.handle('update:install', async () => {
  try {
    await autoUpdater.downloadUpdate();
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    return {};
  } catch (e) {
    return { error: explain(e) };
  }
});

/* ---------- запуск ---------- */

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  let pending = null;
  library = new Library({
    dir: app.getPath('userData'),
    nativeImage,
    onUpdate: () => send('library:update', library.snapshot()),
    onProgress: (p) => {
      // не чаще пяти раз в секунду
      clearTimeout(pending);
      if (!p || p.done === p.total) send('library:progress', p);
      else if (Date.now() - (library.told || 0) > 200) { library.told = Date.now(); send('library:progress', p); }
      else pending = setTimeout(() => send('library:progress', p), 200);
    },
  });
  protocol.handle('media', serve);
  create();
  library.watch();
  win.webContents.once('did-finish-load', () => library.scan());
});

app.on('window-all-closed', () => app.quit());
