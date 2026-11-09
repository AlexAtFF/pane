'use strict';
// The right-click menu. Add an item to the template to expose a new action.

const { Menu, shell, app } = require('electron');
const config = require('./config');
const clip = require('./clipboard-watch');
const adblock = require('./adblock');

function show(pw, manager) {
  const s = pw.state;
  const w = pw.winState();
  const provider = pw.provider;
  const site = provider ? provider.label : 'site';
  const pageLink = provider && s.id ? provider.link(s.id) : null;
  const copied = clip.readLink();
  const hint = (accelerator) => ({ accelerator, registerAccelerator: false });

  const template = [
    { label: 'Back to start', enabled: !!pw.source, ...hint('Backspace'), click: () => pw.unload() },
    { label: 'Open link…', ...hint('Ctrl+L'), click: () => pw.toOverlay('ui', { action: 'palette' }) },
    { label: 'History', ...hint('Ctrl+H'), click: () => pw.toOverlay('ui', { action: 'history' }) },
    { label: 'Play copied link', ...hint('Ctrl+V'), enabled: !!copied, click: () => pw.load(copied) },
    {
      label: 'Play copied link in new window',
      ...hint('Ctrl+Shift+V'),
      enabled: !!copied,
      click: () => manager.create(copied, { near: pw }),
    },
    { label: 'New window', ...hint('Ctrl+N'), click: () => manager.create(null, { near: pw }) },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: w.pinned, ...hint('T'), click: () => pw.togglePin() },
    { label: 'Full screen', type: 'checkbox', checked: w.fullscreen, ...hint('F'), click: () => pw.toggleFullScreen() },
    {
      label: 'Live chat',
      type: 'checkbox',
      checked: w.chatOpen,
      visible: !!s.chatAvailable || w.chatOpen,
      ...hint('H'),
      click: () => pw.toggleChat(),
    },
    { type: 'separator' },
    { label: 'Copy link', enabled: !!pageLink, ...hint('Ctrl+C'), click: () => manager.copyLink(pw, false) },
    { label: 'Copy link at current time', enabled: !!pageLink && !s.isLive && s.kind !== 'clip', click: () => manager.copyLink(pw, true) },
    { label: `Open on ${site}`, enabled: !!pageLink, click: () => shell.openExternal(pageLink) },
    { label: 'Reload', enabled: !!pw.source, ...hint('Ctrl+R'), click: () => pw.reload() },
    { type: 'separator' },
    {
      label: 'Block ads',
      type: 'checkbox',
      checked: adblock.enabled(),
      click: () => config.set('blockAds', !adblock.enabled()), // main.js reloads what is playing
    },
    { label: 'Accounts…', click: () => pw.toOverlay('ui', { action: 'accounts' }) },
    { label: 'Keyboard shortcuts', ...hint('?'), click: () => pw.toOverlay('ui', { action: 'shortcuts' }) },
    { label: 'Edit settings…', click: () => shell.openPath(config.path()) },
    { type: 'separator' },
    { label: 'Close window', ...hint('Ctrl+W'), click: () => pw.win.close() },
    { label: 'Quit Pane', ...hint('Ctrl+Q'), click: () => app.quit() },
    { type: 'separator' },
    { label: `Pane ${app.getVersion()}`, enabled: false },
  ];

  Menu.buildFromTemplate(template).popup({ window: pw.win });
}

module.exports = { show };
