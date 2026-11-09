'use strict';
// App entry point: owns the set of video windows and everything app-wide
// (settings, global hotkeys, clipboard watching, accounts, watch history).

const { app, ipcMain, clipboard, nativeTheme, Menu, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// User data lives in a fixed folder that updates never touch. Must run before
// anything else asks Electron for a path or a session. See store.js.
const store = require('./store');
store.pinDataDir();

// Media keys are handled by our own global hotkeys, so they always hit the
// window you used last instead of whichever video Chromium picks.
// Probes run off-screen (see QUIET in player-window.js); keep Chromium drawing a window nobody can see.
const offscreenProbe = !!process.env.PANE_PROBE && !process.env.PANE_PROBE_SHOW;
// A probe never makes a sound, whatever the page or the probe script does: the whole
// process's audio output is off. (PANE_PROBE_SOUND=1 is the only way to hear one.)
if (process.env.PANE_PROBE && !process.env.PANE_PROBE_SOUND) app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('disable-features', `HardwareMediaKeyHandling${offscreenProbe ? ',CalculateNativeWinOcclusion' : ''}`);

const config = require('./config');
const hotkeys = require('./hotkeys');
const clip = require('./clipboard-watch');
const accounts = require('./accounts');
const adblock = require('./adblock');
const history = require('./history');
const providers = require('./providers');
const { PlayerWindow } = require('./player-window');
const { commands, queries, publicConfig } = require('./commands');

const STATE_FILE = 'window-state.json';

// A link can arrive on the command line as it is ("Pane.exe <link>"), or wrapped in Pane's
// own link type, pane://open?url=<link>. The second is how the browser extension
// (extension/, "Open in Pane") hands a video over. Either way only links a provider
// recognises are ever opened; anything else in a pane:// address is ignored.
const LINK_SCHEME = 'pane';
function unwrap(arg) {
  if (typeof arg !== 'string' || !arg.toLowerCase().startsWith(`${LINK_SCHEME}:`)) return arg;
  try {
    return new URL(arg).searchParams.get('url') || '';
  } catch {
    return '';
  }
}
const linkFromArgs = (argv) => argv.map((a) => providers.parse(unwrap(a))).find(Boolean) || null;

const manager = {
  windows: new Set(),
  overlays: new Map(), // overlay webContents id -> PlayerWindow
  players: new Map(), // site page webContents id -> PlayerWindow
  active: null,
  accounts: {}, // provider name -> signed in?
  lastSize: null,
  historyTab: providers.names[0],

  /** Open a new video window. `input` may be a link, a parsed source, or nothing (start screen). */
  create(input, opts = {}) {
    const near = opts.near && !opts.near.destroyed ? opts.near : this.activeWindow();
    const options = {};
    if (near && !near.win.isFullScreen() && !near.win.isMaximized() && !near.win.isMinimized()) {
      // Cascade from the window you were just using, at the same size.
      const b = near.win.getBounds();
      const size = near.videoSize();
      const area = screen.getDisplayMatching(b).workArea;
      let x = b.x + 40;
      let y = b.y + 40;
      if (x + size.width > area.x + area.width) x = area.x + 24;
      if (y + size.height > area.y + area.height) y = area.y + 24;
      options.bounds = { x, y, ...size };
    } else if (this.lastSize) {
      options.size = this.lastSize;
    }
    const pw = new PlayerWindow(this, options);
    this.windows.add(pw);
    this.overlays.set(pw.overlay.webContents.id, pw);
    this.active = pw;
    if (input) pw.load(input);
    return pw;
  },

  registerPlayerContents(wc, pw) {
    this.players.set(wc.id, pw);
  },

  unregisterPlayerContents(wc) {
    this.players.delete(wc.id);
  },

  remove(pw) {
    this.windows.delete(pw);
    for (const map of [this.overlays, this.players]) {
      for (const [id, owner] of map) if (owner === pw) map.delete(id);
    }
    if (this.active === pw) this.active = [...this.windows].pop() || null;
  },

  setActive(pw) {
    this.active = pw;
  },

  activeWindow() {
    if (this.active && !this.active.destroyed) return this.active;
    return [...this.windows].pop() || null;
  },

  withActive(fn) {
    const pw = this.activeWindow();
    if (pw) fn(pw);
  },

  broadcast(channel, data) {
    for (const pw of this.windows) pw.toOverlay(channel, data);
  },

  toggleMuteAll() {
    const playing = [...this.windows].filter((pw) => pw.source);
    const muteAll = playing.some((pw) => !pw.state.muted);
    for (const pw of playing) {
      pw.toOverlay('flash', { icon: muteAll ? 'mute' : 'volume' });
      pw.player('setMuted', muteAll);
    }
  },

  // ---- links ------------------------------------------------------------------

  openClipboardLink() {
    const link = clip.readLink();
    const current = this.activeWindow();
    if (!link) {
      if (current) current.toOverlay('toast', { kind: 'error', text: 'No YouTube or Twitch link on the clipboard' });
      return;
    }
    const pw = current && !current.source ? current : this.create(null);
    pw.load(link);
    pw.win.show();
    pw.win.focus();
  },

  offerCopiedLink(link) {
    const pw = this.activeWindow();
    if (!pw) return;
    if (pw.source && pw.source.provider === link.provider && link.id && (pw.state.id === link.id || pw.source.id === link.id)) return;
    pw.toOverlay('toast', { kind: 'link', url: link.url, site: providers.get(link.provider).label });
  },

  copyLink(pw, atTime) {
    const s = pw.state;
    if (!s.id || !pw.provider) return;
    const text = pw.provider.shareLink(s.id, atTime && !s.isLive ? Math.floor(s.time || 0) : 0);
    if (!text) return;
    clip.ignore(text);
    clipboard.writeText(text);
    pw.toOverlay('toast', { kind: 'info', text: 'Link copied' });
  },

  // ---- history ------------------------------------------------------------------

  openFromHistory(pw, providerName, id, newWindow) {
    const provider = providers.get(providerName);
    const entry = provider && history.find(providerName, id);
    if (!entry) return;
    const { resume } = config.get().history;
    // Pick a recording back up where it was left, unless it had barely started or was nearly over.
    const canResume = resume && !entry.live && entry.duration > 60 && entry.position > 15 && entry.position < entry.duration - 20;
    const source = provider.parse(provider.link(id, canResume ? entry.position : 0) || '');
    if (!source) return;
    if (newWindow) this.create(source, { near: pw });
    else pw.load(source);
  },

  async clearHistory(pw, providerName) {
    const provider = providers.get(providerName);
    if (!provider) return;
    const { response } = await dialog.showMessageBox(pw.win, {
      type: 'question',
      buttons: ['Clear', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Clear your ${provider.label} history in Pane?`,
      detail: 'This only removes the list kept by this app.',
    });
    if (response === 0) history.clear(providerName);
  },

  setHistoryTab(name) {
    if (!providers.get(name) || name === this.historyTab) return;
    this.historyTab = name;
    this.saveState();
  },

  // ---- accounts -----------------------------------------------------------------

  async refreshAccounts() {
    for (const provider of providers.list) this.accounts[provider.name] = await accounts.isSignedIn(provider);
    this.broadcast('account', { ...this.accounts });
    return this.accounts;
  },

  /** The site's own page told us whether it considers the user signed in. */
  noteSignedIn(name, flag) {
    if (this.accounts[name] === flag) return;
    const was = this.accounts[name];
    this.accounts[name] = flag;
    this.broadcast('account', { ...this.accounts });
    this.logAccount(name, flag ? 'site-says-signed-in' : 'site-says-signed-out');
    // The site dropped a sign-in the user didn't ask to end: say so, instead of quietly showing ads.
    if (was && !flag && !this.signingOut) {
      const provider = providers.get(name);
      const pw = this.activeWindow();
      if (pw && provider) pw.toOverlay('toast', { kind: 'notice', text: `${provider.label} signed Pane out`, action: 'accounts', actionLabel: 'Accounts' });
    }
  },

  /** A small local record of sign-in events (no secrets), to make "why am I signed out?" answerable. */
  logAccount(name, event, detail) {
    const log = store.readJson('account-log.json', []);
    const list = Array.isArray(log) ? log : [];
    list.push({ at: new Date().toISOString(), version: app.getVersion(), site: name, event, ...(detail || {}) });
    store.writeJson('account-log.json', list.slice(-200));
  },

  reloadProvider(name) {
    for (const pw of this.windows) if (pw.source && pw.source.provider === name) pw.reload();
  },

  async signIn(name) {
    const provider = providers.get(name);
    if (!provider) return;
    const before = this.accounts[name];
    await accounts.signIn(provider);
    await this.refreshAccounts();
    if (this.accounts[name] && !before) this.reloadProvider(name);
  },

  async importSignIn(name, text) {
    const provider = providers.get(name);
    if (!provider) return { ok: false, count: 0, signedIn: false, error: 'Unknown site.' };
    const result = await accounts.importCookies(provider, text);
    this.logAccount(name, 'import', { cookies: result.count, signedIn: !!result.signedIn });
    await this.refreshAccounts();
    if (provider.account.verify) this.noteSignedIn(name, !!result.signedIn);
    if (result.signedIn) this.reloadProvider(name);
    return result;
  },

  async importSignInFile(pw, name) {
    const picked = await dialog.showOpenDialog(pw.win, {
      title: 'Choose an exported cookies file',
      properties: ['openFile'],
      filters: [{ name: 'Cookie exports', extensions: ['txt', 'json'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    let text = '';
    try {
      const stat = fs.statSync(picked.filePaths[0]);
      if (stat.size > 2_000_000) return { ok: false, count: 0, signedIn: false, error: 'That file is too large to be a cookie export.' };
      text = fs.readFileSync(picked.filePaths[0], 'utf8');
    } catch {
      return { ok: false, count: 0, signedIn: false, error: 'Could not read that file.' };
    }
    return this.importSignIn(name, text);
  },

  async signOut(pw, name) {
    const provider = providers.get(name);
    if (!provider) return;
    const { response } = await dialog.showMessageBox(pw.win, {
      type: 'question',
      buttons: ['Sign out', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Sign out of ${provider.label} in Pane?`,
      detail: 'This clears the sign-in saved in this app only. Your browser is not affected.',
    });
    if (response !== 0) return;
    this.signingOut = true;
    this.logAccount(name, 'user-signed-out');
    await accounts.signOut(provider);
    await this.refreshAccounts();
    this.reloadProvider(name);
    setTimeout(() => {
      this.signingOut = false;
    }, 15000);
  },

  // ---- small things remembered between runs ---------------------------------------

  rememberSize(size) {
    if (!size || size.width < 200) return;
    this.lastSize = { width: size.width, height: size.height };
    this.saveState();
  },

  saveState() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      store.writeJson(STATE_FILE, { lastSize: this.lastSize, historyTab: this.historyTab, appVersion: app.getVersion() });
    }, 400);
  },

  restoreState() {
    const saved = store.readJson(STATE_FILE, {}) || {};
    const s = saved.lastSize;
    if (s && s.width >= 200 && s.height >= 100 && s.width < 8000) this.lastSize = { width: s.width, height: s.height };
    if (providers.get(saved.historyTab)) this.historyTab = saved.historyTab;
    if (saved.appVersion !== app.getVersion()) this.saveState();
  },
};

let blockingAds = null;

function applyConfig(cfg) {
  // Ad blocking is set up as a page loads, so a change means loading again (at the same spot).
  const blocking = adblock.enabled();
  if (blockingAds !== null && blocking !== blockingAds) {
    for (const pw of manager.windows) if (pw.source) pw.reload({ keepTime: true });
  }
  blockingAds = blocking;
  hotkeys.register(manager, cfg);
  if (cfg.clipboardWatch) clip.start((link) => manager.offerCopiedLink(link));
  else clip.stop();
  manager.broadcast('config', publicConfig());
}

function wireIpc() {
  ipcMain.on('pane:player-state', (event, raw) => {
    const pw = manager.players.get(event.sender.id);
    if (pw) pw.onAgentState(raw);
  });
  ipcMain.on('pane:cmd', (event, type, payload) => {
    const pw = manager.overlays.get(event.sender.id);
    const run = Object.prototype.hasOwnProperty.call(commands, type) ? commands[type] : null;
    if (pw && !pw.destroyed && run) run(pw, payload || {}, manager);
  });
  ipcMain.handle('pane:ask', (event, type, payload) => {
    const pw = manager.overlays.get(event.sender.id);
    const run = Object.prototype.hasOwnProperty.call(queries, type) ? queries[type] : null;
    return pw && run ? run(pw, payload || {}, manager) : null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching Pane again (optionally with a link) opens another window in the running app.
  app.on('second-instance', (_event, argv) => {
    const link = linkFromArgs(argv.slice(1));
    // A pane:// address with nothing playable in it (any web page can send one) does nothing.
    if (!link && argv.some((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${LINK_SCHEME}:`))) return;
    // A link goes to a window that is sitting on the start screen, if there is one.
    const idle = link ? [manager.activeWindow(), ...manager.windows].find((w) => w && !w.destroyed && !w.source) : null;
    if (idle) idle.load(link);
    const pw = idle || manager.create(link);
    if (pw.win.isMinimized()) pw.win.restore();
    pw.win.focus();
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    // Before any file is rewritten by this version, keep a copy of the previous version's.
    store.snapshotOnUpgrade(['settings.json', 'history.json', STATE_FILE]);
    const cfg = config.load();
    // Tell Windows that pane:// links belong to this app (per user; only the installed copy claims them).
    if (app.isPackaged) app.setAsDefaultProtocolClient(LINK_SCHEME);
    adblock.install(accounts.getSession());
    manager.restoreState();
    history.load();
    history.onChange((provider) => manager.broadcast('history', { provider }));
    wireIpc();
    await manager.refreshAccounts();
    applyConfig(cfg);
    config.onChange(applyConfig);
    manager.create(linkFromArgs(process.argv.slice(1)));

    // Development hook: PANE_PROBE=<script> runs a script with access to the app (see probe/).
    if (process.env.PANE_PROBE) {
      try {
        require(path.resolve(process.env.PANE_PROBE))({ app, manager });
      } catch (err) {
        console.error('[probe]', err);
      }
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    hotkeys.unregisterAll();
    clip.stop();
    history.flush();
  });
}
