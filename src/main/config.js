'use strict';
// User settings. Lives at <userData>/settings.json and is merged over DEFAULTS,
// so adding a new option only means adding it here and reading it where needed.
// The file is watched: edits apply without restarting the app.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Bump when a default changes in a way existing settings files should follow; see upgradeUserFile().
const SETTINGS_VERSION = 2;

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  window: {
    width: 960, // size of a brand new window, in pixels
    height: 540,
    minWidth: 240,
    roundedCorners: true, // false = square corners, for tiling videos edge to edge
  },
  chat: {
    width: 340, // live chat panel width
  },
  playback: {
    startVolume: 1, // 0..1, volume of a new window
    startMuted: false,
    quality: 'highest', // 'highest', 'auto', or a site quality id such as 'hd1080' (YouTube) / '720p60' (Twitch)
    seekStep: 5, // seconds, arrow keys
    seekStepLarge: 10, // seconds, J / L and the global seek hotkeys
    volumeStep: 0.05,
    wheelVolume: true, // mouse wheel over the video changes volume
  },
  ui: {
    hideDelayMs: 2200, // how long the controls stay after the mouse stops
  },
  history: {
    enabled: true, // keep a list of what you watch (per site, on this PC only)
    resume: true, // opening a recording from history continues where you left it
    maxPerSite: 400,
  },
  blockAds: true, // skip the sites' ads (also in the right-click menu); see src/main/adblock.js
  clipboardWatch: true, // offer to play YouTube and Twitch links you copy
  // Hotkeys that work even when Pane is not focused. They act on the window you
  // used last. Each action takes a list of Electron accelerators; use [] to turn one off.
  globalHotkeys: {
    playPause: ['MediaPlayPause', 'Ctrl+Alt+Space'],
    mute: ['Ctrl+Alt+M'],
    muteAll: ['Ctrl+Alt+Shift+M'],
    seekBack: ['Ctrl+Alt+Left'],
    seekForward: ['Ctrl+Alt+Right'],
    openClipboard: ['Ctrl+Alt+V'],
  },
};

const events = new EventEmitter();
let current = DEFAULTS;
let file = null;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, extra) {
  if (!isObj(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isObj(value) && isObj(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function read() {
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[config] ignoring unreadable settings.json:', err.message);
    return null;
  }
}

// The settings file was first written with every default spelled out, so changing a
// default in code would not reach existing users. Each step here moves a value that
// still equals an OLD default to the new one, once, and leaves deliberate choices alone.
function upgradeUserFile() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  const from = Number(raw.settingsVersion) || 1;
  if (from >= SETTINGS_VERSION) return;
  if (from < 2 && raw.playback && raw.playback.quality === 'auto') raw.playback.quality = 'highest'; // v2: always best picture
  raw.settingsVersion = SETTINGS_VERSION;
  try {
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  } catch (err) {
    console.warn('[config] could not upgrade settings.json:', err.message);
  }
}

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2));
    } catch (err) {
      console.warn('[config] could not write default settings:', err.message);
    }
  }
  upgradeUserFile();
  current = read() || DEFAULTS;
  fs.watchFile(file, { interval: 1500 }, () => {
    const next = read();
    if (!next) return; // keep the last good settings while the file is mid-edit
    current = next;
    events.emit('change', current);
  });
  return current;
}

/** Change one top-level setting from inside the app (the file stays the source of truth). */
function set(key, value) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!isObj(raw)) raw = {};
  raw[key] = value;
  try {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(raw, null, 2));
    fs.renameSync(temp, file);
  } catch (err) {
    console.warn('[config] could not save settings.json:', err.message);
  }
  current = merge(DEFAULTS, raw);
  events.emit('change', current);
}

module.exports = {
  DEFAULTS,
  load,
  set,
  get: () => current,
  path: () => file,
  onChange: (fn) => events.on('change', fn),
};
