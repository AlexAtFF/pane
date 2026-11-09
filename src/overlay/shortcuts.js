// Keyboard shortcuts that work while a Pane window is focused.
// To add one, add an entry: `keys` are matched against comboOf(event);
// entries with a `label` and `desc` are listed in the shortcuts sheet (press ?).
// System-wide hotkeys live in settings.json + src/main/hotkeys.js instead.

/** Normalises a key event to a string such as "Space", "k", "Ctrl+Shift+v", "ArrowLeft", "?". */
export function comboOf(e) {
  let key;
  if (e.code === 'Space') key = 'Space';
  else if (e.key.length === 1) key = e.key.toLowerCase();
  else key = e.key;
  const named = key.length > 1 || /[a-z0-9]/.test(key);
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey && named ? 'Shift+' : ''}${key}`;
}

const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const keymap = [
  { group: 'Playback', keys: ['Space', 'k'], label: 'Space', desc: 'Play or pause', run: (api) => api.togglePlay(true) },
  { group: 'Playback', keys: ['ArrowLeft'], label: '←', desc: 'Back 5 seconds', run: (api) => api.seekBy(-api.ctx.cfg.playback.seekStep) },
  { group: 'Playback', keys: ['ArrowRight'], label: '→', desc: 'Forward 5 seconds', run: (api) => api.seekBy(api.ctx.cfg.playback.seekStep) },
  { group: 'Playback', keys: ['j'], label: 'J', desc: 'Back 10 seconds', run: (api) => api.seekBy(-api.ctx.cfg.playback.seekStepLarge) },
  { group: 'Playback', keys: ['l'], label: 'L', desc: 'Forward 10 seconds', run: (api) => api.seekBy(api.ctx.cfg.playback.seekStepLarge) },
  { group: 'Playback', keys: digits, label: '0 – 9', desc: 'Jump to 0% – 90%', run: (api, e) => api.seekFraction(Number(e.key) / 10) },
  { group: 'Playback', keys: ['<'], label: '<', desc: 'Slower', run: (api) => api.stepRate(-1) },
  { group: 'Playback', keys: ['>'], label: '>', desc: 'Faster', run: (api) => api.stepRate(1) },
  { group: 'Playback', keys: [','], label: ',', desc: 'Previous frame', run: (api) => api.player('frame', -1) },
  { group: 'Playback', keys: ['.'], label: '.', desc: 'Next frame', run: (api) => api.player('frame', 1) },

  { group: 'Sound and picture', keys: ['ArrowUp'], label: '↑', desc: 'Volume up', run: (api) => api.nudgeVolume(1) },
  { group: 'Sound and picture', keys: ['ArrowDown'], label: '↓', desc: 'Volume down', run: (api) => api.nudgeVolume(-1) },
  { group: 'Sound and picture', keys: ['m'], label: 'M', desc: 'Mute', run: (api) => api.toggleMute(true) },
  { group: 'Sound and picture', keys: ['c'], label: 'C', desc: 'Captions', run: (api) => api.toggleCaptions() },
  { group: 'Sound and picture', keys: ['h'], label: 'H', desc: 'Live chat', run: (api) => api.send('chat:toggle') },

  { group: 'Window', keys: ['f', 'F11'], label: 'F', desc: 'Full screen', run: (api) => api.send('window:fullscreen') },
  { group: 'Window', keys: ['t'], label: 'T', desc: 'Keep on top', run: (api) => api.togglePin() },
  { group: 'Window', keys: ['Ctrl+n'], label: 'Ctrl N', desc: 'New window', run: (api) => api.send('window:new') },
  { group: 'Window', keys: ['Ctrl+w'], label: 'Ctrl W', desc: 'Close window', run: (api) => api.send('window:close') },

  { group: 'Links', keys: ['Ctrl+v'], label: 'Ctrl V', desc: 'Play copied link', run: (api) => api.pasteLink(false) },
  { group: 'Links', keys: ['Ctrl+Shift+v'], label: 'Ctrl Shift V', desc: 'Play copied link in new window', run: (api) => api.pasteLink(true) },
  { group: 'Links', keys: ['Backspace', 'Alt+ArrowLeft'], label: 'Backspace', desc: 'Back to the start screen', run: (api) => api.send('back') },
  { group: 'Links', keys: ['Ctrl+l', 'o'], label: 'Ctrl L', desc: 'Open link box', run: (api) => api.openPalette() },
  { group: 'Links', keys: ['Ctrl+h'], label: 'Ctrl H', desc: 'History', run: (api) => api.openHistory() },
  { group: 'Links', keys: ['Ctrl+c'], label: 'Ctrl C', desc: 'Copy link', run: (api) => api.send('copy-link', { atTime: false }) },
  { group: 'Links', keys: ['Ctrl+r', 'F5'], label: 'Ctrl R', desc: 'Reload', run: (api) => api.send('reload') },

  { keys: ['?'], run: (api) => api.toggleSheet() },
  { keys: ['Escape'], run: (api) => api.escape() },
  { keys: ['F12', 'Ctrl+Shift+i'], run: (api) => api.send('devtools') },
  { keys: ['Ctrl+q'], run: (api) => api.send('quit') },
];

/** Human names for the system-wide hotkeys in settings.json. */
export const GLOBAL_LABELS = {
  playPause: 'Play or pause',
  mute: 'Mute',
  muteAll: 'Mute or unmute every window',
  seekBack: 'Back 10 seconds',
  seekForward: 'Forward 10 seconds',
  openClipboard: 'Play copied link',
};
