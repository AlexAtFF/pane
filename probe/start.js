'use strict';
// Probe: the bare start screen, the history page from it, and the history page over a video.
// Cleans up after itself: the test video is removed from history again unless it was already there.
const path = require('path');
const { sleep, log, shot, waitFor, hover, key, inOverlay } = require('./lib');

const TEST_ID = 'aqz-KE-bpKQ';

module.exports = async ({ app, manager }) => {
  const history = require(path.join(app.getAppPath(), 'src', 'main', 'history.js'));
  const had = !!history.find('youtube', TEST_ID);
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1500);
    log('start', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, visible: [...document.querySelectorAll('#start *')].filter((e) => e.getClientRects().length && e.children.length === 0).map((e) => e.id || e.className || e.tagName), topLeft: [...document.querySelectorAll('[data-slot="top-left"] > :not([hidden])')].map((e) => e.dataset.control) })`));
    shot(pw, '50-start');

    await inOverlay(pw, `document.querySelector('[data-control="history"]').click(); 0`);
    await sleep(900);
    log('history page', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, linkShown: document.querySelector('#palette').getClientRects().length > 0, rows: document.querySelectorAll('.h-row').length, active: document.querySelector('[data-control="history"]').classList.contains('is-active') })`));
    shot(pw, '51-history-page');
    pw.overlay.webContents.focus();
    key(pw, 'Escape');
    await sleep(400);
    log('after escape', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, focus: document.activeElement && document.activeElement.id })`));

    pw.load(`https://www.youtube.com/watch?v=${TEST_ID}`);
    await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 1, 40000);
    await sleep(1500);
    key(pw, 'h', ['control']);
    await sleep(900);
    log('history over video', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, linkShown: document.querySelector('#palette').getClientRects().length > 0, rows: document.querySelectorAll('.h-row').length })`));
    shot(pw, '52-history-over-video');
    key(pw, 'h', ['control']);
    await sleep(400);
    key(pw, 'l', ['control']);
    await sleep(700);
    log('link over video', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, linkShown: document.querySelector('#palette').getClientRects().length > 0, historyShown: document.querySelector('#history').getClientRects().length > 0 })`));
    shot(pw, '53-link-over-video');
    key(pw, 'Escape');
    await hover(pw, true);
    await sleep(500);
    shot(pw, '54-hover');
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  if (!had) history.remove('youtube', TEST_ID);
  history.flush();
  app.quit();
};
