'use strict';
// Bridge between the overlay UI and the main process.
//   pane.send(type, payload)  fire a command        (handled in src/main/commands.js `commands`)
//   pane.ask(type, payload)   ask and await a reply  (src/main/commands.js `queries`)
//   pane.on(channel, fn)      listen for pushes: state, win, config, account, flash, toast, ui

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pane', {
  send: (type, payload) => ipcRenderer.send('pane:cmd', type, payload),
  ask: (type, payload) => ipcRenderer.invoke('pane:ask', type, payload),
  on: (channel, fn) => {
    ipcRenderer.on(`pane:${channel}`, (_event, data) => fn(data));
  },
});
