'use strict';
// Everything the overlay UI can ask the main process to do.
//   overlay:  pane.send('chat:toggle')            -> commands['chat:toggle'](window, payload, manager)
//   overlay:  await pane.ask('clipboard-link')    -> queries['clipboard-link'](window, payload, manager)
// Add a new entry here to give the UI a new ability.

const { app, shell } = require('electron');
const config = require('./config');
const drag = require('./native-drag');
const clip = require('./clipboard-watch');
const hotkeys = require('./hotkeys');
const history = require('./history');
const providers = require('./providers');
const menu = require('./menu');

/** The slice of settings.json (plus app facts) the overlay needs. */
function publicConfig() {
  const cfg = config.get();
  const taken = new Set(hotkeys.failed());
  const globalHotkeys = {};
  for (const [action, keys] of Object.entries(cfg.globalHotkeys || {})) {
    if (Array.isArray(keys)) globalHotkeys[action] = keys.filter((k) => !taken.has(k));
  }
  return {
    playback: cfg.playback,
    ui: cfg.ui,
    globalHotkeys,
    version: app.getVersion(),
    providers: providers.list.map((p) => ({ name: p.name, label: p.label, domain: p.account.domain, canSignInHere: !!p.account.signInUrl })),
  };
}

const commands = {
  // Player commands are defined in each provider's agent.js.
  player: (pw, { name, arg }) => pw.player(name, arg),
  mute: (pw) => pw.toggleMute(),
  open(pw, { input, newWindow }, manager) {
    const source = providers.parse(String(input || ''));
    if (!source) return pw.toOverlay('toast', { kind: 'error', text: "That isn't a YouTube or Twitch link" });
    if (newWindow) manager.create(source, { near: pw });
    else pw.load(source);
  },
  reload: (pw) => pw.reload(),
  back: (pw) => pw.unload(),
  'chat:toggle': (pw) => pw.toggleChat(),

  'history:open': (pw, { provider, id, newWindow }, manager) => manager.openFromHistory(pw, String(provider), String(id), !!newWindow),
  'history:remove': (_pw, { provider, id }) => history.remove(String(provider), String(id)),
  'history:clear': (pw, { provider }, manager) => manager.clearHistory(pw, String(provider)),
  'history:tab': (_pw, { provider }, manager) => manager.setHistoryTab(String(provider)),

  signin: (_pw, { provider }, manager) => manager.signIn(String(provider)),
  signout: (pw, { provider }, manager) => manager.signOut(pw, String(provider)),

  'window:new': (pw, _payload, manager) => manager.create(null, { near: pw }),
  'window:close': (pw) => pw.win.close(),
  'window:minimize': (pw) => pw.win.minimize(),
  'window:maximize': (pw) => pw.toggleMaximize(),
  'window:fullscreen': (pw) => pw.toggleFullScreen(),
  'window:exit-fullscreen': (pw) => pw.win.isFullScreen() && pw.win.setFullScreen(false),
  'window:pin': (pw) => pw.togglePin(),
  'window:drag': (pw) => drag.start(pw.win),
  'window:drag-end': (pw) => drag.stop(pw.win),

  menu: (pw, _payload, manager) => menu.show(pw, manager),
  'copy-link': (pw, { atTime }, manager) => manager.copyLink(pw, !!atTime),
  settings: () => shell.openPath(config.path()),
  devtools: (pw) => pw.overlay.webContents.openDevTools({ mode: 'detach' }),
  quit: () => app.quit(),
};

const queries = {
  init: (pw, _payload, manager) => ({
    config: publicConfig(),
    win: pw.winState(),
    state: pw.state,
    accounts: { ...manager.accounts },
    historyTab: manager.historyTab,
  }),
  'clipboard-link': () => {
    const link = clip.readLink();
    return link ? { url: link.url, provider: link.provider } : null;
  },
  history: (_pw, { provider }) => (providers.get(provider) ? history.list(provider) : []),
  // Sign-in brought over from the user's browser (see accounts.js importCookies).
  'import-signin': (_pw, { provider, text }, manager) => manager.importSignIn(String(provider), String(text || '')),
  'import-signin-file': (pw, { provider }, manager) => manager.importSignInFile(pw, String(provider)),
};

module.exports = { commands, queries, publicConfig };
