'use strict';
// Preload for the YouTube page. The only thing the page can do with it is hand
// player state to the main process, which validates every field it reads.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__paneBridge', {
  post: (state) => ipcRenderer.send('pane:player-state', state),
});
