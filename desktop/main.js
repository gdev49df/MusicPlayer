const { app, BrowserWindow, Menu, screen, session, shell } = require('electron');
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
    width: Math.min(1400, area.width),
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
      // экспорт видео не должен замирать, если окно свернули
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'app.html'));
}

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
    item.setSaveDialogOptions({
      title: 'Сохранить видео',
      defaultPath: uniquePath(app.getPath('videos'), item.getFilename()),
      filters: [{ name: 'Видео', extensions: [path.extname(item.getFilename()).slice(1) || 'mp4'] }],
    });
    item.once('done', (_ev, state) => {
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
  });

  create();
});

app.on('window-all-closed', () => app.quit());
