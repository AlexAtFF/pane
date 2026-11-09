// The buttons that appear on hover. This list IS the UI: to add a control,
// add an entry. Nothing here is visible unless the mouse is over the window.
//
// A control:
//   id         unique name
//   slot       'top-left' | 'top-right' | 'center' | 'left' | 'right'  (left/right = bottom bar)
//   icon       icon name (icons.js), or (ctx) => name
//   tip        tooltip text, or (ctx) => text;   key: shortcut shown in the tooltip
//   show       (ctx) => boolean, hide the control when false
//   active     (ctx) => boolean, draws the "on" marker
//   hideBelow  hide when the window is narrower than this many pixels
//   run        (api, element) => void, the click action
// Controls that aren't a plain icon button supply mount(api) -> element and
// update(element, ctx); `tick(element, api)` runs every frame while the UI is visible.
//
// ctx = { s: player state (a provider agent.js snapshot), w: window state, cfg, accounts }

import { el, fmt, dragFraction } from './util.js';
import { icon } from './icons.js';

const hasVideo = ({ s }) => !!s.source && !s.loading && !s.error;
// Live Twitch can't be rewound, and an ad can't be skipped by seeking.
const canStep = ({ s }) => !!s.ready && !(s.ad && s.ad.showing) && !(s.isLive && !(s.seekEnd > s.seekStart));

/** Centre button that jumps `playback.seekStep` seconds; the number in the icon is that setting. */
function stepButton(direction) {
  const back = direction < 0;
  return {
    id: back ? 'step-back' : 'step-forward',
    slot: 'center',
    hideBelow: 300,
    show: (ctx) => hasVideo(ctx) && canStep(ctx),
    mount(api) {
      const button = el('button', 'btn step');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.key = back ? '←' : '→';
      button.append(icon(back ? 'back10' : 'forward10'), el('span', 'step-num'));
      button.addEventListener('click', () => api.seekBy(direction * api.ctx.cfg.playback.seekStep, true));
      return button;
    },
    update(button, { cfg }) {
      const seconds = String(cfg.playback.seekStep);
      if (button.lastChild.textContent !== seconds) button.lastChild.textContent = seconds;
      button.dataset.tip = `${back ? 'Back' : 'Forward'} ${seconds} seconds`;
    },
  };
}

export const controls = [
  // ---- centre -----------------------------------------------------------------
  stepButton(-1),
  {
    id: 'play-center',
    slot: 'center',
    className: 'big',
    icon: ({ s }) => (s.ended ? 'replay' : s.paused ? 'play' : 'pause'),
    tip: ({ s }) => (s.ended ? 'Replay' : s.paused ? 'Play' : 'Pause'),
    key: 'Space',
    show: hasVideo,
    run: (api) => api.togglePlay(false),
  },
  stepButton(1),

  // ---- top left ---------------------------------------------------------------
  // While a video plays: Back, then New window. History and accounts live on the
  // start screen (and stay reachable by shortcut and the right-click menu).
  {
    id: 'back',
    slot: 'top-left',
    icon: 'arrowLeft',
    tip: 'Back',
    key: 'Backspace',
    show: ({ s }) => !!s.source,
    run: (api) => api.send('back'),
  },
  {
    id: 'new',
    slot: 'top-left',
    icon: 'plus',
    tip: 'New window',
    key: 'Ctrl+N',
    run: (api) => api.send('window:new'),
  },
  {
    id: 'history',
    slot: 'top-left',
    icon: 'history',
    tip: ({ historyOpen }) => (historyOpen ? 'Close history' : 'History'),
    key: 'Ctrl+H',
    show: ({ s }) => !s.source,
    active: ({ historyOpen }) => historyOpen,
    run: (api) => api.openHistory(),
  },
  {
    id: 'accounts',
    slot: 'top-left',
    icon: 'user',
    tip: 'Accounts',
    show: ({ s }) => !s.source,
    run: (api) => api.openAccounts(),
  },

  // ---- top right --------------------------------------------------------------
  {
    id: 'pin',
    slot: 'top-right',
    icon: ({ w }) => (w.pinned ? 'pinOn' : 'pin'),
    tip: ({ w }) => (w.pinned ? 'Stop keeping on top' : 'Keep on top'),
    key: 'T',
    active: ({ w }) => w.pinned,
    hideBelow: 300,
    show: ({ w }) => !w.fullscreen,
    run: (api) => api.send('window:pin'),
  },
  {
    id: 'minimize',
    slot: 'top-right',
    icon: 'minimize',
    tip: 'Minimize',
    hideBelow: 280,
    run: (api) => api.send('window:minimize'),
  },
  {
    id: 'maximize',
    slot: 'top-right',
    icon: ({ w }) => (w.maximized || w.fullscreen ? 'restore' : 'maximize'),
    tip: ({ w }) => (w.maximized || w.fullscreen ? 'Restore' : 'Maximize'),
    hideBelow: 380,
    run: (api) => api.send('window:maximize'),
  },
  {
    id: 'close',
    slot: 'top-right',
    icon: 'close',
    tip: 'Close',
    key: 'Ctrl+W',
    className: 'danger',
    run: (api) => api.send('window:close'),
  },

  // ---- bottom left ------------------------------------------------------------
  {
    id: 'play',
    slot: 'left',
    icon: ({ s }) => (s.ended ? 'replay' : s.paused ? 'play' : 'pause'),
    tip: ({ s }) => (s.ended ? 'Replay' : s.paused ? 'Play' : 'Pause'),
    key: 'Space',
    run: (api) => api.togglePlay(false),
  },
  {
    id: 'volume',
    slot: 'left',
    mount(api) {
      const root = el('div', 'volume');
      const button = el('button', 'btn');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.key = 'M';
      button.addEventListener('click', () => api.toggleMute(false));
      const slider = el('div', 'vol-slider');
      slider.append(el('div', 'vol-track'), el('div', 'vol-thumb'));
      slider.firstChild.append(el('div', 'vol-fill'));
      dragFraction(slider, {
        start: () => api.hold(true),
        move: (f) => api.setVolume(f),
        end: () => api.hold(false),
      });
      root.append(button, slider);
      return root;
    },
    update(root, { s }) {
      const level = s.muted ? 0 : s.volume || 0;
      root.style.setProperty('--vol', String(level));
      const name = level === 0 ? 'mute' : level < 0.5 ? 'volumeLow' : 'volume';
      const button = root.firstChild;
      if (button.dataset.icon !== name) {
        button.dataset.icon = name;
        button.replaceChildren(icon(name));
      }
      button.dataset.tip = s.muted ? 'Unmute' : 'Mute';
    },
  },
  {
    id: 'time',
    slot: 'left',
    hideBelow: 430,
    show: ({ s }) => !s.isLive || !s.liveHead,
    mount() {
      const root = el('div', 'time');
      root.append(el('span', 'time-now'), el('span', 'time-total'));
      return root;
    },
    tick(root, api) {
      const { s } = api.ctx;
      let now;
      let total;
      if (s.ad && s.ad.showing) {
        now = 'Ad';
        total = s.duration ? ` · ${fmt(Math.max(0, s.duration - api.now()))}` : '';
      } else if (s.isLive) {
        now = `-${fmt(Math.max(0, s.seekEnd - api.now()))}`;
        total = '';
      } else {
        now = fmt(api.now());
        total = s.duration ? ` / ${fmt(s.duration)}` : '';
      }
      if (root.firstChild.textContent !== now) root.firstChild.textContent = now;
      if (root.lastChild.textContent !== total) root.lastChild.textContent = total;
    },
  },
  {
    id: 'live',
    slot: 'left',
    show: ({ s }) => !!s.isLive && !(s.ad && s.ad.showing),
    mount(api) {
      const button = el('button', 'live', 'LIVE');
      button.type = 'button';
      button.tabIndex = -1;
      button.addEventListener('click', () => api.player('goLive'));
      return button;
    },
    update(button, { s }) {
      button.classList.toggle('behind', !s.liveHead);
      button.dataset.tip = s.liveHead ? 'You are watching live' : 'Jump to live';
    },
  },
  {
    id: 'skip-ad',
    slot: 'left',
    show: ({ s }) => !!(s.ad && s.ad.skippable),
    mount(api) {
      const button = el('button', 'pill-btn', 'Skip ad');
      button.type = 'button';
      button.tabIndex = -1;
      button.addEventListener('click', () => api.player('skipAd'));
      return button;
    },
  },

  // ---- bottom right -----------------------------------------------------------
  {
    id: 'captions',
    slot: 'right',
    icon: 'captions',
    tip: ({ s }) => (s.captions.on ? 'Turn captions off' : 'Captions'),
    key: 'C',
    show: (ctx) => hasVideo(ctx) && !!ctx.s.captions && ctx.s.captions.available,
    active: ({ s }) => s.captions.on,
    hideBelow: 380,
    run: (api) => api.player('toggleCaptions'),
  },
  {
    id: 'chat',
    slot: 'right',
    icon: 'chat',
    tip: ({ w }) => (w.chatOpen ? 'Hide live chat' : 'Live chat'),
    key: 'H',
    show: ({ s, w }) => !!s.chatAvailable || !!w.chatOpen,
    active: ({ w }) => w.chatOpen,
    hideBelow: 340,
    run: (api) => api.send('chat:toggle'),
  },
  {
    id: 'settings',
    slot: 'right',
    icon: 'settings',
    tip: 'Quality and speed',
    show: hasVideo,
    hideBelow: 300,
    run: (api, element) => api.toggleSettings(element),
  },
  {
    id: 'fullscreen',
    slot: 'right',
    icon: ({ w }) => (w.fullscreen ? 'fullscreenExit' : 'fullscreen'),
    tip: ({ w }) => (w.fullscreen ? 'Exit full screen' : 'Full screen'),
    key: 'F',
    run: (api) => api.send('window:fullscreen'),
  },
];
