// Узкий мостик: страница не получает доступ к Node и файлам напрямую.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('kuplet', {
  library: call('library:get'),
  saveUser: (data) => ipcRenderer.send('user:save', data),
  addFolder: call('library:addFolder'),
  addFiles: call('library:addFiles'),
  addPaths: call('library:addPaths'),
  pathFor: (file) => webUtils.getPathForFile(file),
  removeFolder: call('library:removeFolder'),
  rescan: call('library:rescan'),
  remove: call('library:remove'),
  reveal: call('track:reveal'),
  lyrics: call('track:lyrics'),
  saveLyrics: call('track:saveLyrics'),
  json: call('web:json'),
  fetchCover: call('web:cover'),
  onLibrary: listen('library:update'),
  onProgress: listen('library:progress'),
  update: {
    version: call('update:version'),
    check: call('update:check'),
    install: call('update:install'),
    onProgress: listen('update:progress'),
  },
});
