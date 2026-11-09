// Overlay entry point. Holds the UI state, decides when the controls are
// visible, and implements the pieces that aren't simple buttons (seek bar,
// menus, link box, toasts). Buttons live in controls.js, keys in shortcuts.js.

import { $, el, fmt, clamp, throttle, dragFraction } from './util.js';
import { icon } from './icons.js';
import { controls } from './controls.js';
import { keymap, comboOf, GLOBAL_LABELS } from './shortcuts.js';
import { createHistory } from './history.js';
import { createAccounts } from './accounts.js';

const pane = window.pane;
const body = document.body;

const EMPTY_STATE = { source: false, captions: { available: false, on: false }, ad: { showing: false, skippable: false }, rates: [], qualities: [] };

/** Shared, read-mostly view of the world handed to controls and shortcuts. */
const ctx = {
  s: { ...EMPTY_STATE }, // player state (youtube/agent.js snapshot + source/loading)
  w: { pinned: false, maximized: false, fullscreen: false, focused: true, chatOpen: false },
  cfg: {
    playback: { seekStep: 5, seekStepLarge: 10, volumeStep: 0.05, wheelVolume: true },
    ui: { hideDelayMs: 2200 },
    globalHotkeys: {},
    version: '',
    providers: [], // [{name, label, domain, canSignInHere}]
  },
  accounts: {}, // provider name -> signed in?
  get historyOpen() {
    return body.classList.contains('history-open');
  },
};

let stamp = performance.now(); // when ctx.s last arrived
let holds = 0; // things that keep the UI up (dragging a slider, an open menu)
let hoverChrome = false;
const scrub = { active: false, time: 0 };

const surface = $('#surface');
const seek = $('#seek');
const seekTip = $('.seek-tip');
const popover = $('#popover');
const sheet = $('#sheet');
const linkInput = $('#link');
const field = $('.field');
const tipBox = $('#tip');

// ---- time -----------------------------------------------------------------------

/** Current position, smoothly extrapolated between state updates. */
function now() {
  const s = ctx.s;
  if (scrub.active) return scrub.time;
  if (!s.ready || s.paused || s.buffering || s.ended || s.isLive) return s.time || 0;
  const t = (s.time || 0) + ((performance.now() - stamp) / 1000) * (s.rate || 1);
  return s.duration ? Math.min(t, s.duration) : t;
}

function range() {
  const s = ctx.s;
  return s.isLive ? { start: s.seekStart || 0, end: s.seekEnd || 0 } : { start: 0, end: s.duration || 0 };
}

const pct = (v) => `${Math.round(v * 100)}%`;
const canSeek = () => !!ctx.s.source && !!ctx.s.ready && !ctx.s.ad.showing;

// ---- actions available to controls and shortcuts ------------------------------------

const sendVolume = throttle((v) => pane.send('player', { name: 'setVolume', arg: v }), 50);
const sendSeek = throttle((t) => pane.send('player', { name: 'seek', arg: t }), 140);

const api = {
  ctx,
  now,
  send: (type, payload) => pane.send(type, payload),
  player: (name, arg) => pane.send('player', { name, arg }),
  flash,
  toast: showToast,

  /** Keep the controls visible while something is in progress. Call with false when done. */
  hold(on) {
    holds = Math.max(0, holds + (on ? 1 : -1));
    wake();
  },

  togglePlay(showFlash) {
    const s = ctx.s;
    if (!s.source || s.loading || s.error) return;
    if (showFlash) flash(s.paused || s.ended ? 'play' : 'pause');
    api.player('toggle');
  },

  toggleMute(showFlash) {
    const s = ctx.s;
    if (!s.source) return;
    const muted = !s.muted;
    if (showFlash) flash(muted ? 'mute' : 'volume', muted ? 'Muted' : pct(s.volume));
    api.player('setMuted', muted);
  },

  setVolume(v) {
    v = clamp(v, 0, 1);
    ctx.s.volume = v;
    ctx.s.muted = false;
    sendVolume(v);
    renderControls();
  },

  nudgeVolume(direction) {
    const s = ctx.s;
    if (!s.source) return;
    const base = s.muted ? 0 : s.volume || 0;
    const v = clamp(Math.round((base + direction * ctx.cfg.playback.volumeStep) * 100) / 100, 0, 1);
    api.setVolume(v);
    flash(v === 0 ? 'mute' : 'volume', pct(v));
  },

  /** @param {boolean} [quiet] no centre flash (the button that was pressed is feedback enough) */
  seekBy(delta, quiet) {
    if (!canSeek()) return;
    if (!quiet) flash(delta < 0 ? 'back' : 'forward', `${Math.abs(delta)}s`);
    api.player('seekBy', delta);
  },

  seekFraction(f) {
    if (!canSeek() || ctx.s.isLive) return;
    api.player('seekFraction', f);
  },

  stepRate(direction) {
    const s = ctx.s;
    if (!canSeek() || s.isLive) return;
    const rates = (s.rates.length ? s.rates : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]).slice().sort((a, b) => a - b);
    let i = rates.findIndex((r) => r >= (s.rate || 1) - 0.001);
    if (i < 0) i = rates.length - 1;
    const next = rates[clamp(i + direction, 0, rates.length - 1)];
    api.player('setRate', next);
    flash('speed', `${next}×`);
  },

  toggleCaptions() {
    const s = ctx.s;
    if (!s.captions.available) return;
    flash('captions', s.captions.on ? 'Off' : 'On');
    api.player('toggleCaptions');
  },

  togglePin() {
    flash('pin', ctx.w.pinned ? 'Not on top' : 'On top');
    pane.send('window:pin');
  },

  async pasteLink(newWindow) {
    const link = await pane.ask('clipboard-link');
    if (!link) return showToast({ kind: 'error', text: 'No YouTube or Twitch link on the clipboard' });
    pane.send('open', { input: link.url, newWindow });
  },

  openPalette,
  /** Show the history page, or go back if it is already showing. */
  openHistory: () => (body.classList.contains('history-open') ? closePalette() : openPalette({ focusInput: false })),
  openAccounts: () => accounts.open(),
  toggleSettings,
  toggleSheet,

  escape() {
    if (closeTransient()) return;
    if (ctx.w.fullscreen) pane.send('window:exit-fullscreen');
  },
};

// ---- controls ---------------------------------------------------------------------

const mounted = [];

function mountControls() {
  for (const def of controls) {
    const slot = $(`[data-slot="${def.slot}"]`);
    if (!slot) continue;
    let node;
    if (def.mount) {
      node = def.mount(api);
    } else {
      node = el('button', `btn${def.className ? ` ${def.className}` : ''}`);
      node.type = 'button';
      node.tabIndex = -1;
      if (def.key) node.dataset.key = def.key;
      node.addEventListener('click', () => def.run(api, node));
    }
    node.dataset.control = def.id;
    slot.append(node);
    mounted.push({ def, el: node, icon: null });
  }
}

function renderControls() {
  const width = window.innerWidth;
  for (const m of mounted) {
    const { def } = m;
    const visible = (!def.show || def.show(ctx)) && !(def.hideBelow && width < def.hideBelow);
    m.el.hidden = !visible;
    if (!visible) continue;
    if (def.update) def.update(m.el, ctx);
    if (def.mount) continue;
    const name = typeof def.icon === 'function' ? def.icon(ctx) : def.icon;
    if (name !== m.icon) {
      m.icon = name;
      m.el.replaceChildren(icon(name));
    }
    m.el.dataset.tip = (typeof def.tip === 'function' ? def.tip(ctx) : def.tip) || '';
    m.el.classList.toggle('is-active', !!(def.active && def.active(ctx)));
  }
}

function renderProgress() {
  const { start, end } = range();
  const span = end - start;
  const played = span > 0 ? clamp((now() - start) / span, 0, 1) : 0;
  const buffered = span > 0 ? clamp(((ctx.s.buffered || 0) - start) / span, 0, 1) : 0;
  seek.style.setProperty('--played', played.toFixed(5));
  seek.style.setProperty('--buffered', buffered.toFixed(4));
  for (const m of mounted) if (m.def.tick && !m.el.hidden) m.def.tick(m.el, api);
}

function render() {
  const { s, w } = ctx;
  body.classList.toggle('is-empty', !s.source);
  // An ad the blocker is getting rid of looks like loading: covered, with the spinner.
  body.classList.toggle('is-loading', !!s.loading || !!s.ad.covered);
  body.classList.toggle('is-buffering', !!s.buffering && !s.loading);
  body.classList.toggle('has-error', !!(s.error || s.gate));
  body.classList.toggle('has-gate', !s.error && !!s.gate);
  body.classList.toggle('no-seek', !!s.isLive && !(s.seekEnd > s.seekStart));
  body.dataset.provider = s.provider || '';
  body.classList.toggle('is-ad', !!s.ad.showing && !s.ad.covered);
  body.classList.toggle('is-fullscreen', !!w.fullscreen);
  $('.message-text').textContent = s.error || s.gate || '';
  renderControls();
  renderProgress();
  if (!popover.hidden) renderPopover();
}

function setState(s) {
  ctx.s = { ...EMPTY_STATE, ...(s || {}) };
  if (!ctx.s.captions) ctx.s.captions = EMPTY_STATE.captions;
  if (!ctx.s.ad) ctx.s.ad = EMPTY_STATE.ad;
  stamp = performance.now();
}

// ---- showing and hiding the UI ---------------------------------------------------------

let hideTimer = 0;
let ticking = false;

function isSticky() {
  return holds > 0 || hoverChrome || !popover.hidden || !sheet.hidden || body.classList.contains('palette-open') || body.classList.contains('history-open');
}

function wake() {
  body.classList.add('ui');
  body.classList.remove('idle');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(rest, ctx.cfg.ui.hideDelayMs);
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
}

function rest() {
  clearTimeout(hideTimer);
  if (isSticky()) {
    hideTimer = setTimeout(rest, 500);
    return;
  }
  body.classList.remove('ui');
  body.classList.add('idle');
  hideTip();
}

function tick() {
  if (!body.classList.contains('ui') || !ctx.s.source) {
    ticking = false;
    return;
  }
  renderProgress();
  requestAnimationFrame(tick);
}

let lastX = -1;
let lastY = -1;
document.addEventListener('pointermove', (e) => {
  // Chromium also fires this when things move under a still cursor; ignore those.
  if (e.screenX === lastX && e.screenY === lastY) return;
  lastX = e.screenX;
  lastY = e.screenY;
  wake();
});

document.documentElement.addEventListener('pointerleave', () => {
  hoverChrome = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(rest, 220);
});

for (const node of [$('#top [data-slot="top-left"]'), $('#top [data-slot="top-right"]'), $('#bottom')]) {
  node.addEventListener('pointerenter', () => {
    hoverChrome = true;
  });
  node.addEventListener('pointerleave', () => {
    hoverChrome = false;
  });
}

// Buttons never take keyboard focus, so Space always means play/pause.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) e.preventDefault();
});

// ---- the video surface: click, double-click, drag, wheel --------------------------------

let press = null;

surface.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY, dragging: false, dismissed: closeTransient() };
  wake(); // a click counts as "I'm here", same as moving the mouse
});

surface.addEventListener('pointermove', (e) => {
  if (!press || press.dragging || !(e.buttons & 1)) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
    press.dragging = true;
    pane.send('window:drag'); // the system takes over the move from here
  }
});

window.addEventListener('pointerup', () => {
  if (press && press.dragging) pane.send('window:drag-end');
});

surface.addEventListener('click', (e) => {
  const p = press;
  press = null;
  if (!p || p.dragging || p.dismissed) return;
  // First click toggles; the second click of a double-click toggles back.
  if (e.detail <= 2) api.togglePlay(e.detail === 1);
});

surface.addEventListener('dblclick', () => pane.send('window:fullscreen'));

surface.addEventListener(
  'wheel',
  (e) => {
    if (!ctx.cfg.playback.wheelVolume || !ctx.s.source || e.ctrlKey) return;
    api.nudgeVolume(e.deltaY < 0 ? 1 : -1);
  },
  { passive: true },
);

window.addEventListener('contextmenu', (e) => {
  if (e.target === linkInput) return;
  e.preventDefault();
  pane.send('menu');
});

// ---- seek bar ---------------------------------------------------------------------------

function timeAt(f) {
  const { start, end } = range();
  return start + f * (end - start);
}

function showSeekTip(f) {
  const s = ctx.s;
  const t = timeAt(f);
  seekTip.textContent = s.isLive ? (f > 0.995 ? 'Live' : `-${fmt(s.seekEnd - t)}`) : fmt(t);
  const w = seek.clientWidth;
  const half = seekTip.offsetWidth / 2;
  seekTip.style.transform = `translateX(${clamp(f * w, half, w - half) - half}px)`;
}

const seekFraction = dragFraction(seek, {
  start: () => {
    if (!canSeek()) return;
    scrub.active = true;
    api.hold(true);
  },
  move: (f) => {
    if (!scrub.active) return;
    scrub.time = timeAt(f);
    sendSeek(scrub.time);
    renderProgress();
    showSeekTip(f);
  },
  end: (f) => {
    if (!scrub.active) return;
    const t = timeAt(f);
    if (ctx.s.isLive && f > 0.995) api.player('goLive');
    else sendSeek(t);
    ctx.s.time = t;
    stamp = performance.now();
    scrub.active = false;
    api.hold(false);
  },
});

seek.addEventListener('pointermove', (e) => showSeekTip(seekFraction(e)));

// ---- centre feedback --------------------------------------------------------------------

const BEZEL_ICONS = { back: 'back10', forward: 'forward10', pin: 'pinOn' };

function flash(name, text) {
  const bezel = $('#bezel');
  $('.bezel-icon').replaceChildren(icon(BEZEL_ICONS[name] || name));
  $('.bezel-text').textContent = text || '';
  bezel.classList.toggle('has-text', !!text);
  bezel.classList.remove('show');
  void bezel.offsetWidth; // restart the animation
  bezel.classList.add('show');
}

// ---- tooltips ---------------------------------------------------------------------------

let tipTarget = null;
let tipTimer = 0;

function hideTip() {
  clearTimeout(tipTimer);
  tipBox.hidden = true;
}

function showTip(target) {
  if (!target.isConnected || !target.dataset.tip) return;
  tipBox.replaceChildren(document.createTextNode(target.dataset.tip));
  if (target.dataset.key) tipBox.append(el('kbd', '', target.dataset.key));
  tipBox.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tipBox.getBoundingClientRect();
  const x = clamp(r.left + r.width / 2 - t.width / 2, 6, Math.max(6, window.innerWidth - t.width - 6));
  const y = r.top > window.innerHeight / 2 ? r.top - t.height - 8 : r.bottom + 8;
  tipBox.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

document.addEventListener('pointerover', (e) => {
  const target = e.target.closest && e.target.closest('[data-tip]');
  if (!target || target === tipTarget) return;
  tipTarget = target;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(target), tipBox.hidden ? 450 : 60);
});

document.addEventListener('pointerout', (e) => {
  if (tipTarget && !tipTarget.contains(e.relatedTarget)) {
    tipTarget = null;
    hideTip();
  }
});

document.addEventListener('pointerdown', hideTip, true);

// ---- quality / speed menu ---------------------------------------------------------------

const menu = { view: 'root', anchor: null };

function menuRow({ label, value, checked, chevron, head, onClick }) {
  const row = el('button', `menu-row${checked ? ' checked' : ''}${head ? ' head' : ''}`);
  row.type = 'button';
  row.tabIndex = -1;
  if (head) row.append(icon('back'));
  else if (checked !== undefined) {
    const mark = icon('check');
    mark.classList.add('check');
    row.append(mark);
  }
  row.append(el('span', 'label', label));
  if (value) row.append(el('span', 'value', value));
  if (chevron) row.append(icon('chevron'));
  row.addEventListener('click', onClick);
  return row;
}

function qualityText(s) {
  if (s.qualityPref === 'auto' || !s.qualityPref) return s.qualityLabel ? `Auto · ${s.qualityLabel}` : 'Auto';
  const base = s.qualityPref.split('|')[0];
  const chosen = s.qualities.find((q) => q.key === s.qualityPref) || s.qualities.find((q) => q.key.split('|')[0] === base);
  return chosen ? chosen.label : s.qualityLabel || 'Auto';
}

const speedText = (rate) => (Math.abs((rate || 1) - 1) < 0.001 ? 'Normal' : `${rate}×`);

function renderPopover() {
  const s = ctx.s;
  const rows = [];
  const show = (view) => () => {
    menu.view = view;
    renderPopover();
  };
  const choose = (name, arg) => () => {
    api.player(name, arg);
    closePopover();
  };
  if (menu.view === 'quality') {
    rows.push(menuRow({ label: 'Quality', head: true, onClick: show('root') }));
    rows.push(menuRow({ label: 'Auto', checked: s.qualityPref === 'auto', onClick: choose('setQuality', 'auto') }));
    for (const q of s.qualities) {
      const checked = s.qualityPref !== 'auto' && (q.key === s.qualityPref || q.key.split('|')[0] === s.qualityPref.split('|')[0]);
      rows.push(menuRow({ label: q.label, checked, onClick: choose('setQuality', q.key) }));
    }
  } else if (menu.view === 'speed') {
    rows.push(menuRow({ label: 'Speed', head: true, onClick: show('root') }));
    const rates = s.rates.length ? s.rates : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    for (const r of rates) {
      rows.push(menuRow({ label: speedText(r), checked: Math.abs(r - (s.rate || 1)) < 0.001, onClick: choose('setRate', r) }));
    }
  } else {
    rows.push(menuRow({ label: 'Quality', value: qualityText(s), chevron: true, onClick: show('quality') }));
    if (!s.isLive) rows.push(menuRow({ label: 'Speed', value: speedText(s.rate), chevron: true, onClick: show('speed') }));
  }
  const scroll = popover.scrollTop;
  popover.replaceChildren(...rows);
  popover.hidden = false;
  const anchor = menu.anchor && menu.anchor.isConnected ? menu.anchor.getBoundingClientRect() : null;
  const right = anchor ? window.innerWidth - anchor.right : 10;
  const bottom = anchor ? window.innerHeight - anchor.top + 10 : 56;
  popover.style.right = `${Math.max(8, right)}px`;
  popover.style.bottom = `${bottom}px`;
  popover.scrollTop = scroll;
}

function toggleSettings(anchor) {
  if (!popover.hidden) return closePopover();
  menu.view = 'root';
  menu.anchor = anchor;
  renderPopover();
  wake();
}

function closePopover() {
  if (popover.hidden) return false;
  popover.hidden = true;
  return true;
}

document.addEventListener(
  'pointerdown',
  (e) => {
    if (popover.hidden || popover.contains(e.target) || (menu.anchor && menu.anchor.contains(e.target))) return;
    if (e.target === surface) return; // the surface handler closes it and swallows the click
    closePopover();
  },
  true,
);

// ---- link box (start screen and Ctrl+L) -------------------------------------------------

async function fillFromClipboard(force) {
  const link = await pane.ask('clipboard-link');
  if (link && (force || !linkInput.value || linkInput.dataset.auto === linkInput.value)) {
    linkInput.value = link.url;
    linkInput.dataset.auto = link.url;
    linkInput.select();
  }
  field.classList.toggle('has-value', !!linkInput.value.trim());
}

/** Opens the home panel: the link box with the watch history underneath. */
function openPalette({ focusInput = true } = {}) {
  closePopover();
  // Two faces of the same panel: the link box, or the history page. Never both.
  body.classList.toggle('history-open', !focusInput);
  body.classList.toggle('palette-open', focusInput && !!ctx.s.source);
  if (!focusInput) history.refresh();
  renderControls();
  if (focusInput) {
    linkInput.value = '';
    linkInput.focus();
    fillFromClipboard(true);
  }
  wake();
}

function closePalette() {
  if (!body.classList.contains('palette-open') && !body.classList.contains('history-open')) return false;
  body.classList.remove('palette-open', 'history-open');
  renderControls();
  if (ctx.s.source) linkInput.blur();
  else linkInput.focus(); // back on the start screen
  return true;
}

function submitLink(newWindow) {
  const input = linkInput.value.trim();
  if (!input) return;
  pane.send('open', { input, newWindow });
  linkInput.value = '';
  field.classList.remove('has-value');
  closePalette();
}

linkInput.addEventListener('input', () => field.classList.toggle('has-value', !!linkInput.value.trim()));
linkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitLink(e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (!closePalette()) linkInput.blur();
  }
});
$('#go').addEventListener('click', (e) => submitLink(e.shiftKey));
$('#start').addEventListener('pointerdown', (e) => {
  if (e.target.id === 'start') closePalette(); // clicked the dimmed backdrop
});

// ---- toasts -------------------------------------------------------------------------------

let toastTimer = 0;

function showToast(t) {
  const box = $('#toasts');
  clearTimeout(toastTimer);
  const node = el('div', `toast ${t.kind || 'info'}`);
  const dismiss = () => {
    node.classList.remove('in');
    setTimeout(() => node.remove(), 250);
  };
  if (t.kind === 'link') {
    node.append(el('span', 'toast-text', `${t.site || 'Video'} link copied`));
    const here = el('button', 'pill-btn primary', 'Play here');
    const fresh = el('button', 'pill-btn', 'New window');
    const close = el('button', 'btn');
    close.append(icon('close'));
    for (const b of [here, fresh, close]) {
      b.type = 'button';
      b.tabIndex = -1;
    }
    here.addEventListener('click', () => {
      pane.send('open', { input: t.url, newWindow: false });
      dismiss();
    });
    fresh.addEventListener('click', () => {
      pane.send('open', { input: t.url, newWindow: true });
      dismiss();
    });
    close.addEventListener('click', dismiss);
    node.append(here, fresh, close);
    if (!ctx.s.source) fillFromClipboard(true);
  } else {
    node.append(el('span', 'toast-text', t.text || ''));
    if (t.action === 'accounts') {
      // A notice with something to do about it (e.g. "YouTube signed Pane out").
      const go = el('button', 'pill-btn primary', t.actionLabel || 'Open');
      go.type = 'button';
      go.tabIndex = -1;
      go.addEventListener('click', () => {
        accounts.open();
        dismiss();
      });
      node.append(go);
    }
  }
  box.replaceChildren(node);
  requestAnimationFrame(() => node.classList.add('in'));
  toastTimer = setTimeout(dismiss, t.kind === 'link' ? 9000 : t.kind === 'notice' ? 15000 : 2600);
}

// ---- shortcuts sheet ----------------------------------------------------------------------

/** One centred card over the video, shared by the shortcuts sheet and the accounts panel. */
const modal = {
  open(kind, nodes) {
    const card = $('.sheet-card');
    card.className = `sheet-card ${kind}`;
    card.replaceChildren(...nodes);
    sheet.dataset.kind = kind;
    sheet.hidden = false;
    closePopover();
  },
  close() {
    if (sheet.hidden) return false;
    sheet.hidden = true;
    $('.sheet-card').replaceChildren();
    return true;
  },
  kind: () => (sheet.hidden ? null : sheet.dataset.kind),
};

function buildSheet() {
  const groups = new Map();
  for (const k of keymap) {
    if (!k.desc) continue;
    if (!groups.has(k.group)) groups.set(k.group, []);
    groups.get(k.group).push([k.desc, k.label]);
  }
  const globals = [];
  for (const [action, keys] of Object.entries(ctx.cfg.globalHotkeys || {})) {
    if (!Array.isArray(keys) || !keys.length) continue;
    const shown = keys.map((k) => k.replace(/^Media(PlayPause|NextTrack|PreviousTrack|Stop)$/, 'Media key').replace(/\+/g, ' '));
    globals.push([GLOBAL_LABELS[action] || action, shown.join('  or  ')]);
  }
  if (globals.length) groups.set('Anywhere in Windows', globals);

  // Two columns, each new group going to whichever is shorter so far.
  const columns = [el('div', 'sheet-col'), el('div', 'sheet-col')];
  const heights = [0, 0];
  for (const [name, rows] of groups) {
    const target = heights[1] < heights[0] ? 1 : 0;
    heights[target] += rows.length + 2;
    const group = el('div', 'sheet-group');
    group.append(el('h3', '', name));
    for (const [desc, keys] of rows) {
      const row = el('div', 'sheet-row');
      row.append(el('span', '', desc), el('kbd', '', keys));
      group.append(row);
    }
    if (name === 'Anywhere in Windows') {
      group.append(el('p', 'sheet-note', 'These act on the window you used last. Change them in settings (right-click, Edit settings).'));
    }
    columns[target].append(group);
  }
  return columns;
}

function toggleSheet(force) {
  const open = force === undefined ? modal.kind() !== 'shortcuts' : force;
  if (open) modal.open('shortcuts', buildSheet());
  else modal.close();
}

sheet.addEventListener('pointerdown', (e) => {
  if (e.target === sheet) modal.close();
});

/** Closes whatever panel is open. Returns true if something was closed. */
function closeTransient() {
  return modal.close() || closePopover() || closePalette();
}

// ---- drag and drop --------------------------------------------------------------------------

let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth += 1;
  body.classList.add('dropping');
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', () => {
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    body.classList.remove('dropping');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  body.classList.remove('dropping');
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
  const first = text.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
  if (first) pane.send('open', { input: first.trim(), newWindow: e.shiftKey });
});

// ---- keyboard ---------------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.target === linkInput) return; // the link box handles its own keys
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') modal.close();
    return; // typing in a panel
  }
  const combo = comboOf(e);
  const hit = keymap.find((k) => k.keys.includes(combo));
  if (!hit) return;
  e.preventDefault();
  hit.run(api, e);
});

// ---- wiring -------------------------------------------------------------------------------------

$('.field-icon').append(icon('link'));
$('#go').append(icon('arrow'));
$('#retry').addEventListener('click', () => pane.send('reload'));
$('#gate').addEventListener('click', () => api.player('acceptGate'));
$('#history-back').append(icon('back'));
$('#history-back').addEventListener('click', () => closePalette());

const history = createHistory({ pane, ctx, onOpen: closePalette });
const accounts = createAccounts({ pane, ctx, modal, toast: showToast });

window.addEventListener('resize', () => {
  renderControls();
  closePopover();
  hideTip();
});

window.addEventListener('focus', () => {
  if (body.classList.contains('history-open')) history.refresh();
  else if (!ctx.s.source) {
    linkInput.focus();
    fillFromClipboard(false);
  }
});

pane.on('state', (s) => {
  const wasEmpty = !ctx.s.source;
  setState(s);
  if (wasEmpty && ctx.s.source) closePalette();
  if (!wasEmpty && !ctx.s.source) {
    // "Back": the video is gone, this is the start screen again.
    closeTransient();
    linkInput.value = '';
    field.classList.remove('has-value');
    linkInput.focus();
  }
  render();
});
pane.on('win', (w) => {
  ctx.w = w;
  render();
});
pane.on('config', (cfg) => {
  ctx.cfg = cfg;
});
pane.on('account', (a) => {
  ctx.accounts = a || {};
  accounts.refresh();
});
pane.on('history', ({ provider }) => {
  // Only redraw while the list is actually on screen.
  if (body.classList.contains('history-open')) history.changed(provider);
});
pane.on('flash', (f) => flash(f.icon, f.text));
pane.on('toast', showToast);
pane.on('ui', ({ action }) => {
  if (action === 'palette') openPalette();
  else if (action === 'history') openPalette({ focusInput: false });
  else if (action === 'accounts') accounts.open();
  else if (action === 'shortcuts') toggleSheet(true);
});

async function boot() {
  mountControls();
  render();
  const init = await pane.ask('init');
  if (init) {
    ctx.cfg = init.config;
    ctx.w = init.win;
    ctx.accounts = init.accounts || {};
    setState(init.state);
    history.setTab(init.historyTab, { remember: false });
  }
  render();
  if (!ctx.s.source) {
    linkInput.focus();
    fillFromClipboard(false);
  }
}

boot();
