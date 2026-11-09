'use strict';
// Probe: the accounts button in the top bar opens the Accounts panel.
const { sleep, log, shot, inOverlay } = require('./lib');
module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    await sleep(1500);
    shot(pw, '60-start');
    await inOverlay(pw, `document.querySelector('[data-control="accounts"]').click(); 0`);
    await sleep(500);
    log('panel', await inOverlay(pw, `JSON.stringify({ topLeft: [...document.querySelectorAll('[data-slot="top-left"] > :not([hidden])')].map((e) => e.dataset.control), open: !document.querySelector('#sheet').hidden, title: document.querySelector('.sheet-card h2')?.textContent })`));
    shot(pw, '61-accounts');
  } catch (err) { log('probe error', String(err && err.stack || err)); }
  app.quit();
};
