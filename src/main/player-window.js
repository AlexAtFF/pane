'use strict';
// One video window. It is a frameless window holding up to three stacked views:
//
//   page     the video site's real page (YouTube watch page, Twitch player page),
//            restyled so only the <video> shows
//   overlay  Pane's own transparent UI (src/overlay), drawn on top, takes all input
//   chat     the site's live chat, docked on the right when open
//
// The site's page is never clicked or typed into; it is driven through the
// provider's agent.js and reports back through providers/preload.js. Everything
// site-specific comes from the provider (src/main/providers/<name>/).

const { BaseWindow, WebContentsView, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const drag = require('./native-drag');
const providers = require('./providers');
const history = require('./history');
const adblock = require('./adblock');
const { PARTITION, getSession } = require('./accounts');

const OVERLAY_PRELOAD = path.join(__dirname, '..', 'overlay', 'preload.js');
const OVERLAY_HTML = path.join(__dirname, '..', 'overlay', 'index.html');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

const KINDS = ['video', 'live', 'channel', 'clip'];

// Development probes (PANE_PROBE) keep their windows off-screen and never take focus,
// so they can run while the PC is in use. PANE_PROBE_SHOW=1 puts them on screen again.
const QUIET = !!process.env.PANE_PROBE && !process.env.PANE_PROBE_SHOW;
const OFFSCREEN = { x: -9000, y: -9000 };

// Everything that arrives from the site's page is untrusted: copy field by field.
// A field the agent reports but this function doesn't copy never reaches the UI.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const captions = raw.captions || {};
  const ad = raw.ad || {};
  return {
    hasPlayer: !!raw.hasPlayer,
    ready: !!raw.ready,
    error: str(raw.error, 240) || null,
    gate: str(raw.gate, 160) || null,
    signedIn: typeof raw.signedIn === 'boolean' ? raw.signedIn : null,
    id: typeof raw.id === 'string' && /^[\w:.-]{1,140}$/.test(raw.id) ? raw.id : null,
    kind: KINDS.includes(raw.kind) ? raw.kind : 'video',
    title: str(raw.title, 200),
    subtitle: str(raw.subtitle, 200),
    isLive: !!raw.isLive,
    width: num(raw.width),
    height: num(raw.height),
    paused: !!raw.paused,
    ended: !!raw.ended,
    buffering: !!raw.buffering,
    time: num(raw.time),
    duration: num(raw.duration),
    buffered: num(raw.buffered),
    seekStart: num(raw.seekStart),
    seekEnd: num(raw.seekEnd),
    liveHead: !!raw.liveHead,
    volume: clamp(num(raw.volume, 1), 0, 1),
    muted: !!raw.muted,
    rate: num(raw.rate, 1),
    rates: Array.isArray(raw.rates) ? raw.rates.slice(0, 24).map(Number).filter(Number.isFinite) : [],
    quality: str(raw.quality, 24),
    qualityLabel: str(raw.qualityLabel, 24),
    qualityPref: str(raw.qualityPref, 64) || 'auto',
    qualities: Array.isArray(raw.qualities)
      ? raw.qualities.slice(0, 32).map((q) => ({ key: str(q && q.key, 64), label: str(q && q.label, 32) }))
      : [],
    captions: { available: !!captions.available, on: !!captions.on },
    ad: { showing: !!ad.showing, skippable: !!ad.skippable, covered: false },
    chatAvailable: !!raw.chatAvailable,
  };
}

class PlayerWindow {
  /**
   * @param {object} manager  the app-level window manager (main.js)
   * @param {{bounds?: Electron.Rectangle, size?: {width:number,height:number}}} [opts]
   */
  constructor(manager, opts = {}) {
    const cfg = config.get();
    getSession();
    this.manager = manager;
    this.destroyed = false;
    this.source = null; // what this window is playing: {provider, kind, id, url}
    this.provider = null; // the provider module for this.source
    this.hist = {}; // history bookkeeping for the current load
    this.state = { source: false };
    this.everReady = false;
    this.ratio = 16 / 9;
    this.title = 'Pane';
    this.page = null;
    this.chatView = null;
    this.chatOpen = false;
    this.chatUrl = null;
    this.chatWidth = clamp(num(cfg.chat.width, 340), 240, 640);
    this.audio = { volume: clamp(num(cfg.playback.startVolume, 1), 0, 1), muted: !!cfg.playback.startMuted };
    this.quality = cfg.playback.quality || 'auto';
    this.loadTimer = null;

    const size = opts.bounds || opts.size || { width: cfg.window.width, height: cfg.window.height };
    const minWidth = clamp(num(cfg.window.minWidth, 240), 160, 800);
    this.minVideoWidth = minWidth;
    this.win = new BaseWindow({
      ...(opts.bounds || size),
      ...(QUIET ? OFFSCREEN : null),
      minWidth,
      minHeight: Math.round(minWidth / this.ratio),
      frame: false,
      show: false,
      backgroundColor: '#000000',
      title: 'Pane',
      icon: fs.existsSync(ICON) ? ICON : undefined,
    });

    this.overlay = new WebContentsView({
      webPreferences: { preload: OVERLAY_PRELOAD, sandbox: true, contextIsolation: true, transparent: true },
    });
    this.overlay.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.overlay);
    const owc = this.overlay.webContents;
    owc.on('will-navigate', (e) => e.preventDefault()); // e.g. a link dropped on the window
    owc.setWindowOpenHandler(() => ({ action: 'deny' }));
    owc.once('did-finish-load', () => this.reveal());
    owc.loadFile(OVERLAY_HTML);
    setTimeout(() => this.reveal(), 1500);

    drag.styleWindow(this.win, { rounded: cfg.window.roundedCorners !== false });
    this.win.setContentSize(size.width, size.height);
    this.win.setAspectRatio(this.ratio);
    this.layout();
    this.bindWindowEvents();
  }

  reveal() {
    if (this.destroyed || this.win.isVisible()) return;
    if (QUIET) this.win.showInactive();
    else this.win.show();
  }

  bindWindowEvents() {
    const win = this.win;
    win.on('resize', () => this.layout());
    win.on('resized', () => {
      this.sizing = null;
      if (!this.chatOpen) this.tidyShape();
      this.manager.rememberSize(this.videoSize());
    });
    win.on('focus', () => {
      this.manager.setActive(this);
      this.overlay.webContents.focus();
      this.sendWinState();
    });
    win.on('blur', () => {
      drag.stop(win);
      this.sendWinState();
    });
    for (const event of ['maximize', 'unmaximize', 'always-on-top-changed', 'restore']) {
      win.on(event, () => {
        this.layout();
        this.sendWinState();
      });
    }
    win.on('enter-full-screen', () => {
      this.layout();
      this.sendWinState();
    });
    win.on('leave-full-screen', () => {
      this.applyAspectLock();
      this.layout();
      this.sendWinState();
    });
    // Resizing is done by hand so the window grows and shrinks around the point opposite
    // the one being dragged: drag a side and the middle of the other side stays put
    // (the window grows evenly both ways across); drag a corner and the opposite corner
    // stays put. It also keeps the *video area* in shape when the chat panel is open,
    // which the native aspect lock can't do.
    win.on('will-resize', (event, next, details) => {
      if (win.isFullScreen() || win.isMaximized()) return;
      event.preventDefault();
      const edge = (details && details.edge) || 'bottom-right';
      const now = Date.now();
      // The shape the window had when this drag began ('resized' ends a drag).
      if (!this.sizing || this.sizing.edge !== edge || now - this.sizing.at > 1500) this.sizing = { edge, from: win.getBounds() };
      this.sizing.at = now;
      const { from } = this.sizing;
      const f = this.frame();
      const cw = this.chatW();
      let vw = next.width - f.w - cw;
      if (edge === 'top' || edge === 'bottom') vw = Math.round((next.height - f.h) * this.ratio);
      vw = Math.max(vw, this.minVideoWidth);
      const width = vw + cw + f.w;
      const height = Math.round(vw / this.ratio) + f.h;
      let x = from.x + Math.round((from.width - width) / 2);
      let y = from.y + Math.round((from.height - height) / 2);
      if (edge.includes('left')) x = from.x + from.width - width;
      else if (edge.includes('right')) x = from.x;
      if (edge.includes('top')) y = from.y + from.height - height;
      else if (edge.includes('bottom')) y = from.y;
      win.setBounds({ x, y, width, height });
    });
    win.on('closed', () => this.dispose());
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.loadTimer);
    for (const view of [this.page, this.chatView, this.overlay]) {
      try {
        if (view && !view.webContents.isDestroyed()) view.webContents.close();
      } catch {}
    }
    this.manager.remove(this);
  }

  // ---- talking to the overlay -------------------------------------------------

  toOverlay(channel, data) {
    if (this.destroyed) return;
    const wc = this.overlay.webContents;
    if (!wc.isDestroyed()) wc.send(`pane:${channel}`, data);
  }

  winState() {
    const win = this.win;
    return {
      pinned: win.isAlwaysOnTop(),
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      focused: win.isFocused(),
      chatOpen: this.chatOpen,
    };
  }

  sendWinState() {
    if (!this.destroyed) this.toOverlay('win', this.winState());
  }

  // ---- loading a video --------------------------------------------------------

  /** @returns {boolean} false if the text was not a link Pane can play */
  load(input) {
    const source = typeof input === 'string' ? providers.parse(input) : input;
    const provider = source && providers.get(source.provider);
    if (!provider) {
      this.toOverlay('toast', { kind: 'error', text: "That isn't a YouTube or Twitch link" });
      return false;
    }
    this.source = source;
    this.provider = provider;
    this.hist = {};
    this.everReady = false;
    this.accepting = false; // ignore reports from the page we are leaving
    this.stalled = null;
    this.closeChat();
    this.ensurePage();
    this.state = { source: true, loading: true, provider: provider.name };
    this.toOverlay('state', this.state);
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => this.checkLoaded(), 25000);
    const page = this.page;
    this.coverAd(false);
    // The ad blocker has to be in place before the page starts loading.
    adblock.prepare(page.webContents).then(() => {
      if (this.destroyed || this.page !== page || this.source !== source) return;
      page.webContents.loadURL(source.url).catch(() => {});
    });
    return true;
  }

  /** @param {{keepTime?: boolean}} [opts] keepTime: come back at the current position, not the link's */
  reload(opts = {}) {
    if (!this.source) return;
    const s = this.state;
    if (opts.keepTime && this.provider && s.ready && s.id && !s.isLive && s.time > 5) {
      const resumed = providers.parse(this.provider.link(s.id, s.time) || '');
      if (resumed) return void this.load(resumed);
    }
    this.load(this.source);
  }

  /** While the ad blocker is on, an ad that gets through is never heard (and the overlay covers it). */
  coverAd(on) {
    if (on === !!this.adCovered || !this.page) return;
    this.adCovered = on;
    try {
      this.page.webContents.setAudioMuted(on);
    } catch {}
  }

  /** Stop what is playing and return this window to the start screen. */
  unload() {
    if (this.destroyed || !this.source) return;
    // Remember where playback was before letting go of the page.
    this.hist.savedAt = 0;
    this.trackHistory(this.state);
    clearTimeout(this.loadTimer);
    this.closeChat();
    this.source = null;
    this.provider = null;
    this.hist = {};
    this.everReady = false;
    this.accepting = false;
    this.stalled = null;
    if (this.page) {
      const page = this.page;
      this.page = null;
      this.adCovered = false;
      this.manager.unregisterPlayerContents(page.webContents);
      try {
        this.win.contentView.removeChildView(page);
        page.webContents.close();
      } catch {}
    }
    this.title = 'Pane';
    this.win.setTitle('Pane');
    this.state = { source: false };
    this.toOverlay('state', this.state);
    this.overlay.webContents.focus();
  }

  checkLoaded() {
    if (this.destroyed || this.everReady || this.state.error) return;
    const { messages } = this.provider;
    this.stalled = this.state.hasPlayer ? messages.stalled : messages.missing(this.source);
    this.setError(this.stalled);
  }

  setError(text) {
    this.state = { ...this.state, source: true, loading: false, error: text };
    this.toOverlay('state', this.state);
  }

  ensurePage() {
    if (this.page) return;
    this.page = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        preload: providers.preload,
        sandbox: true,
        contextIsolation: true,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
      },
    });
    this.page.setBackgroundColor('#000000');
    this.win.contentView.addChildView(this.page, 0); // underneath the overlay
    const wc = this.page.webContents;
    this.manager.registerPlayerContents(wc, this);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-navigate', () => {
      this.accepting = true;
    });
    wc.on('dom-ready', () => {
      const provider = this.provider;
      if (!provider) return;
      wc.insertCSS(provider.css, { cssOrigin: 'user' }).catch(() => {});
      const setup = JSON.stringify({ ...this.audio, quality: this.quality, blockAds: adblock.enabled() });
      const script = `${providers.agentCore};${provider.agent};window.__paneAgent && window.__paneAgent.configure(${setup});0`;
      wc.executeJavaScript(script, true).catch(() => {});
    });
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.setError(`Couldn't reach ${this.provider ? this.provider.label : 'the site'} (${description || code}).`);
    });
    wc.on('render-process-gone', () => this.setError('The video stopped unexpectedly. Press Ctrl+R to reload.'));
    this.layout();
  }

  onAgentState(raw) {
    if (this.destroyed || !this.source || !this.accepting) return;
    const s = sanitize(raw);
    if (!s) return;
    const firstPicture = s.ready && !this.everReady;
    if (s.ready) this.everReady = true;
    if (!this.everReady && !s.error && this.stalled) s.error = this.stalled;
    if (s.ready && s.width > 0 && s.height > 0 && !s.ad.showing) this.setRatio(s.width / s.height);
    if (firstPicture) this.tidyShape();
    const title = s.title || 'Pane';
    if (title !== this.title) {
      this.title = title;
      this.win.setTitle(title);
    }
    if (this.chatOpen && s.ready && this.provider.chatUrl(s) !== this.chatUrl) this.closeChat();
    if (s.signedIn !== null) this.manager.noteSignedIn(this.provider.name, s.signedIn);
    s.ad.covered = s.ad.showing && adblock.enabled();
    this.coverAd(s.ad.covered);
    this.state = { ...s, source: true, provider: this.provider.name, loading: !this.everReady && !s.error };
    this.toOverlay('state', this.state);
    this.trackHistory(this.state);
  }

  /** Keep this window's entry in the watch history fresh (position, title, thumbnail). */
  trackHistory(s) {
    const cfg = config.get().history;
    if (!cfg.enabled || !s.ready || !s.id || s.error || s.ad.showing) return;
    const now = Date.now();
    const h = this.hist;
    if (h.id !== s.id) Object.assign(h, { id: s.id, startedAt: now, savedAt: 0, thumbAt: 0, bumped: false });
    const provider = this.provider;
    const needsFrame = !provider.thumbnail(s) && !h.thumbAt;
    if (h.bumped && now - h.savedAt < (needsFrame ? 2500 : 10000)) return;
    h.savedAt = now;
    const info = {
      id: s.id,
      kind: s.kind,
      title: s.title,
      subtitle: s.subtitle,
      live: s.isLive,
      duration: s.isLive ? 0 : Math.round(s.duration),
      position: s.isLive ? 0 : Math.round(s.time),
    };
    const remote = provider.thumbnail(s);
    if (remote) info.thumb = remote;
    history.touch(provider.name, info, { bump: !h.bumped });
    h.bumped = true;
    // Sites without a thumbnail address get a frame from the player, refreshed now and then.
    if (!remote && !s.paused && now - h.startedAt > 2500 && now - h.thumbAt > 5 * 60 * 1000) {
      h.thumbAt = now;
      const id = s.id;
      this.page.webContents
        .capturePage()
        .then((image) => history.saveThumb(provider.name, id, image))
        .catch(() => {});
    }
  }

  /** Run a command from the provider's agent.js `commands`. */
  player(name, arg, opts = {}) {
    if (this.destroyed || !this.page) return;
    if (name === 'setVolume') {
      this.audio.volume = clamp(num(arg, 1), 0, 1);
      if (this.audio.volume > 0) this.audio.muted = false;
    } else if (name === 'setMuted') {
      this.audio.muted = !!arg;
    } else if (name === 'setQuality') {
      this.quality = String(arg || 'auto');
    }
    if (opts.flash) {
      let icon = opts.flash;
      if (name === 'toggle') icon = this.state.paused ? 'play' : 'pause';
      this.toOverlay('flash', { icon });
    }
    const js = `window.__paneAgent && window.__paneAgent.cmd(${JSON.stringify(String(name))}, ${JSON.stringify(arg === undefined ? null : arg)});0`;
    this.page.webContents.executeJavaScript(js, true).catch(() => {});
  }

  toggleMute(opts = {}) {
    const muted = !this.state.muted;
    if (opts.flash) this.toOverlay('flash', { icon: muted ? 'mute' : 'volume' });
    this.player('setMuted', muted);
  }

  // ---- size & shape -----------------------------------------------------------

  chatW() {
    return this.chatOpen ? this.chatWidth : 0;
  }

  /** Windows keeps a hairline of non-client frame even on frameless windows. */
  frame() {
    const b = this.win.getBounds();
    const c = this.win.getContentBounds();
    return { w: Math.max(0, b.width - c.width), h: Math.max(0, b.height - c.height) };
  }

  /** Size of the picture itself (window minus chat panel). */
  videoSize() {
    const c = this.win.getContentBounds();
    return { width: c.width - this.chatW(), height: c.height };
  }

  layout() {
    if (this.destroyed) return;
    const { width, height } = this.win.getContentBounds();
    const cw = this.chatOpen ? Math.min(this.chatWidth, Math.max(0, width - 160)) : 0;
    const area = { x: 0, y: 0, width: Math.max(1, width - cw), height: Math.max(1, height) };
    if (this.page) this.page.setBounds(area);
    this.overlay.setBounds(area);
    if (this.chatView) this.chatView.setBounds({ x: width - cw, y: 0, width: cw, height });
  }

  applyAspectLock() {
    const win = this.win;
    const cw = this.chatW();
    const f = this.frame();
    win.setMinimumSize(this.minVideoWidth + cw + f.w, Math.round(this.minVideoWidth / this.ratio) + f.h);
    win.setAspectRatio(this.chatOpen || win.isFullScreen() ? 0 : this.ratio);
  }

  setRatio(ratio) {
    if (!Number.isFinite(ratio) || ratio < 0.3 || ratio > 4) return;
    if (Math.abs(ratio - this.ratio) < 0.004) return;
    this.ratio = ratio;
    this.fitToRatio();
  }

  /**
   * Nudge the window the last pixel or two so the picture area is exactly the
   * video's shape. Only corrects small rounding drift; a shape the user chose
   * on purpose (snapped, maximised) is left alone.
   */
  tidyShape() {
    if (this.destroyed) return;
    const size = this.videoSize();
    if (size.height < 1) return;
    const drift = Math.abs(size.width / size.height / this.ratio - 1);
    if (drift > 0.002 && drift < 0.02) this.fitToRatio();
  }

  /** Reshape the window so the video area matches the video exactly (no bars). */
  fitToRatio() {
    const win = this.win;
    this.applyAspectLock();
    if (win.isFullScreen() || win.isMaximized() || win.isMinimized()) return;
    const b = win.getBounds();
    const f = this.frame();
    const cw = this.chatW();
    const area = screen.getDisplayMatching(b).workArea;
    let vw = Math.max(this.minVideoWidth, b.width - f.w - cw);
    let vh = Math.round(vw / this.ratio);
    if (vh + f.h > area.height) {
      vh = area.height - f.h;
      vw = Math.round(vh * this.ratio);
    }
    if (vw + cw + f.w > area.width) {
      vw = area.width - cw - f.w;
      vh = Math.round(vw / this.ratio);
    }
    this.placeWithin({ x: b.x, y: b.y, width: vw + cw + f.w, height: vh + f.h }, area);
  }

  placeWithin(bounds, area) {
    const x = clamp(bounds.x, area.x, Math.max(area.x, area.x + area.width - bounds.width));
    const y = clamp(bounds.y, area.y, Math.max(area.y, area.y + area.height - bounds.height));
    this.win.setBounds(QUIET ? bounds : { ...bounds, x, y }); // a probe's window stays off-screen
    this.layout();
  }

  toggleFullScreen() {
    const win = this.win;
    if (!win.isFullScreen()) win.setAspectRatio(0);
    win.setFullScreen(!win.isFullScreen());
  }

  toggleMaximize() {
    const win = this.win;
    if (win.isFullScreen()) return win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }

  togglePin() {
    const next = !this.win.isAlwaysOnTop();
    this.win.setAlwaysOnTop(next, 'floating');
    this.sendWinState();
    return next;
  }

  // ---- live chat --------------------------------------------------------------

  toggleChat() {
    if (this.chatOpen) this.closeChat();
    else this.openChat();
  }

  openChat() {
    const url = this.provider ? this.provider.chatUrl(this.state) : null;
    if (this.destroyed || this.chatOpen || !url) return;
    const pattern = this.provider.chatPattern;
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    });
    view.setBackgroundColor('#0f0f0f');
    const wc = view.webContents;
    const external = (target) => {
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    };
    wc.setWindowOpenHandler(({ url: target }) => {
      external(target);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, target) => {
      if (pattern.test(target)) return;
      event.preventDefault();
      external(target);
    });
    wc.loadURL(url).catch(() => {});
    this.chatView = view;
    this.chatUrl = url;
    this.chatOpen = true;
    this.win.contentView.addChildView(view);
    this.applyAspectLock();
    const win = this.win;
    if (!win.isFullScreen() && !win.isMaximized()) {
      // Grow sideways so the video keeps the size it had.
      const b = win.getBounds();
      const f = this.frame();
      const area = screen.getDisplayMatching(b).workArea;
      let vw = b.width - f.w;
      if (vw + this.chatWidth + f.w > area.width) vw = area.width - this.chatWidth - f.w;
      const height = Math.round(vw / this.ratio) + f.h;
      this.placeWithin({ x: b.x, y: b.y, width: vw + this.chatWidth + f.w, height }, area);
    }
    this.layout();
    this.sendWinState();
  }

  closeChat() {
    if (!this.chatOpen) return;
    const view = this.chatView;
    const cw = this.chatWidth;
    this.chatOpen = false;
    this.chatView = null;
    this.chatUrl = null;
    if (this.destroyed) return;
    try {
      this.win.contentView.removeChildView(view);
      view.webContents.close();
    } catch {}
    const win = this.win;
    if (!win.isFullScreen() && !win.isMaximized()) {
      const b = win.getBounds();
      const f = this.frame();
      const vw = Math.max(this.minVideoWidth, b.width - f.w - cw);
      win.setBounds({ x: b.x, y: b.y, width: vw + f.w, height: Math.round(vw / this.ratio) + f.h });
    }
    this.applyAspectLock();
    this.layout();
    this.sendWinState();
    this.overlay.webContents.focus();
  }
}

module.exports = { PlayerWindow };
