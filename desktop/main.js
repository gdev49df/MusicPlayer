const { app, BrowserWindow, Menu, ipcMain, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function uniquePath(dir, name) {
  const { name: base, ext } = path.parse(name);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function create() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, area.width),
    height: Math.min(920, area.height),
    minWidth: Math.min(820, area.width),
    minHeight: Math.min(600, area.height),
    title: 'Припев',
    backgroundColor: '#101114',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      // экспорт видео не должен замирать, если окно свернули
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // разрешена только перезагрузка самой программы («Новый проект»)
  win.webContents.on('will-navigate', (e) => {
    if (e.url !== win.webContents.getURL()) e.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'app.html'));
}

/* ---------- обновления из GitHub Releases ---------- */

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// ошибки возвращаются из вызовов ниже; пустой обработчик не даёт им уронить программу
autoUpdater.on('error', () => {});
autoUpdater.on('download-progress', (p) => win?.webContents.send('update:progress', p.percent));

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
    // даём странице показать сообщение, затем ставим тихо и запускаем снова
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    return {};
  } catch (e) {
    return { error: explain(e) };
  }
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;

  // картинки обложек должны быть доступны для рисования в кадре
  ses.webRequest.onHeadersReceived(
    { urls: ['https://*.mzstatic.com/*', 'https://*.dzcdn.net/*'] },
    (details, done) => {
      const headers = {};
      for (const [k, v] of Object.entries(details.responseHeaders || {})) {
        if (k.toLowerCase() !== 'access-control-allow-origin') headers[k] = v;
      }
      headers['Access-Control-Allow-Origin'] = ['*'];
      done({ responseHeaders: headers });
    },
  );

  ses.on('will-download', (_e, item) => {
    const ext = path.extname(item.getFilename()).slice(1) || 'mp4';
    const video = ext === 'mp4' || ext === 'webm';
    const kind = video ? 'Видео' : ext === 'lrc' ? 'Текст песни' : 'Проект «Припев»';
    item.setSaveDialogOptions({
      title: 'Сохранить',
      defaultPath: uniquePath(app.getPath(video ? 'videos' : 'documents'), item.getFilename()),
      filters: [{ name: kind, extensions: [ext] }],
    });
    item.once('done', (_ev, state) => {
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
  });

  create();
});

app.on('window-all-closed', () => app.quit());
