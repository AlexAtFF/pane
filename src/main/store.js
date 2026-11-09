'use strict';
// Where Pane keeps the user's data, and how it is written safely.
//
// PERSISTENCE CONTRACT (this is what makes data survive app updates):
//   - Everything the user owns lives in DATA_DIR (%APPDATA%\Pane), never next to the
//     program files. Updating replaces only the program folder.
//   - DATA_DIR is pinned here by name; renaming the app must not move it.
//   - Files are JSON with a `version` number. When a format changes, bump the
//     version and add a step to that file's migrate(); never drop unknown fields.
//   - Writes are atomic (temp file, then rename) and keep the previous copy as
//     `<file>.bak`, which is used automatically if the main file is unreadable.
//   - On the first run of a new app version the JSON files are copied to
//     DATA_DIR\backups\<old version>\ (see snapshotOnUpgrade).

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// PANE_DATA_DIR is for development only: probes use a throwaway folder so they can run
// while the real app is open and never touch the user's history or sign-ins.
const DATA_DIR = process.env.PANE_DATA_DIR || path.join(app.getPath('appData'), 'Pane');

/** Call once, before anything else touches app paths or sessions. */
function pinDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  app.setPath('userData', DATA_DIR);
}

const file = (name) => path.join(DATA_DIR, name);

function readJson(name, fallback) {
  for (const candidate of [file(name), `${file(name)}.bak`]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] could not read ${path.basename(candidate)}: ${err.message}`);
    }
  }
  return fallback;
}

function writeJson(name, data) {
  const target = file(name);
  const temp = `${target}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data));
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak`);
    fs.renameSync(temp, target);
    return true;
  } catch (err) {
    console.warn(`[store] could not write ${name}: ${err.message}`);
    return false;
  }
}

/** Copies the user's JSON files aside when the app version changes. Returns the previous version, if any. */
function snapshotOnUpgrade(names) {
  const state = readJson('window-state.json', {}) || {};
  const previous = typeof state.appVersion === 'string' ? state.appVersion : fs.existsSync(file('settings.json')) ? '0.1.0' : null;
  const current = app.getVersion();
  if (previous && previous !== current) {
    const dir = path.join(DATA_DIR, 'backups', previous.replace(/[^\w.-]/g, '_'));
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of names) {
        if (fs.existsSync(file(name))) fs.copyFileSync(file(name), path.join(dir, name));
      }
    } catch (err) {
      console.warn('[store] upgrade snapshot failed:', err.message);
    }
  }
  return previous;
}

module.exports = { DATA_DIR, pinDataDir, file, readJson, writeJson, snapshotOnUpgrade };
