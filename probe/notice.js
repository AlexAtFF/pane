'use strict';
// Probe: the "signed out" notice and the import instructions.
const fs = require('fs');
const path = require('path');
const { sleep, log, shot, inOverlay } = require('./lib');
module.exports = async ({ app, manager }) => {
  try {
    const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));
    const pw = manager.activeWindow();
    await sleep(1500);
    manager.noteSignedIn('youtube', true);
    await sleep(300);
    manager.noteSignedIn('youtube', false); // as if the site dropped the sign-in
    await sleep(700);
    shot(pw, '70-notice');
    await inOverlay(pw, `document.querySelector('.toast .pill-btn').click(); 0`);
    await sleep(400);
    await inOverlay(pw, `[...document.querySelectorAll('.acct .pill-btn')].find((b) => /browser/.test(b.textContent)).click(); 0`);
    await sleep(400);
    shot(pw, '71-import');
    log('log file', fs.readFileSync(path.join(store.DATA_DIR, 'account-log.json'), 'utf8'));
  } catch (err) { log('probe error', String(err && err.stack || err)); }
  app.quit();
};
