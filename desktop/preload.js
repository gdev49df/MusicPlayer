// Узкий мостик для кнопок обновления: страница не получает доступ к Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  version: () => ipcRenderer.invoke('update:version'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  onProgress: (fn) => ipcRenderer.on('update:progress', (_e, percent) => fn(percent)),
});
