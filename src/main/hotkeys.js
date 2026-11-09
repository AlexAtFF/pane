'use strict';
// System-wide hotkeys. The key bindings come from settings.json (globalHotkeys);
// what each action does is defined in ACTIONS below. To add one: add a default
// binding in config.js and a function here.

const { globalShortcut } = require('electron');

const ACTIONS = {
  playPause: (m) => m.withActive((w) => w.player('toggle', undefined, { flash: true })),
  mute: (m) => m.withActive((w) => w.toggleMute({ flash: true })),
  muteAll: (m) => m.toggleMuteAll(),
  seekBack: (m, cfg) => m.withActive((w) => w.player('seekBy', -cfg.playback.seekStepLarge, { flash: 'back' })),
  seekForward: (m, cfg) => m.withActive((w) => w.player('seekBy', cfg.playback.seekStepLarge, { flash: 'forward' })),
  openClipboard: (m) => m.openClipboardLink(),
};

function register(manager, cfg) {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, accelerators] of Object.entries(cfg.globalHotkeys || {})) {
    const run = ACTIONS[action];
    if (!run || !Array.isArray(accelerators)) continue;
    for (const accelerator of accelerators) {
      let ok = false;
      try {
        ok = globalShortcut.register(accelerator, () => run(manager, cfg));
      } catch {}
      if (!ok) failed.push(accelerator);
    }
  }
  if (failed.length) console.warn('[hotkeys] could not register:', failed.join(', '));
  lastFailed = failed;
  return failed;
}

let lastFailed = [];

module.exports = {
  register,
  unregisterAll: () => globalShortcut.unregisterAll(),
  /** Accelerators another program already owns (so the UI doesn't advertise them). */
  failed: () => lastFailed,
};
