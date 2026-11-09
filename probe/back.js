'use strict';
// Probe: highest quality by default, back-only top bar while watching, long volume bar, Back to start.
const fs = require('fs');
const path = require('path');
const { sleep, log, shot, waitFor, hover, key, inOverlay } = require('./lib');

const topLeft = (pw) => inOverlay(pw, `JSON.stringify([...document.querySelectorAll('[data-slot="top-left"] > :not([hidden])')].map((e) => e.dataset.control))`);

module.exports = async ({ app, manager }) => {
  try {
    const src = (name) => require(path.join(app.getAppPath(), 'src', 'main', name));
    const history = src('history.js');
    const store = src('store.js');
    const settings = JSON.parse(fs.readFileSync(path.join(store.DATA_DIR, 'settings.json'), 'utf8'));
    log('settings after upgrade', { quality: settings.playback.quality, settingsVersion: settings.settingsVersion, keptCustom: settings.playback.seekStep });
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1500);
    log('start top-left', await topLeft(pw));

    pw.load('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=60s');
    await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 60, 40000);
    await waitFor(() => pw.state.qualityPref !== 'auto' && pw.state.height >= 1080, 20000);
    log('youtube quality', { pref: pw.state.qualityPref, playing: pw.state.quality, size: [pw.state.width, pw.state.height], best: pw.state.qualities[0] });
    await hover(pw, true);
    await sleep(600);
    log('watching top-left', await topLeft(pw), 'volume bar px', await inOverlay(pw, `Math.round(document.querySelector('.vol-slider').getBoundingClientRect().width)`));
    shot(pw, '80-watching');
    for (const w of [640, 420]) {
      pw.win.setContentSize(w, Math.round((w * 9) / 16));
      await sleep(600);
      log(`width ${w}`, 'volume bar px', await inOverlay(pw, `Math.round(document.querySelector('.vol-slider').getBoundingClientRect().width)`), 'row overflow', await inOverlay(pw, `document.querySelector('#bottom .row').scrollWidth > document.querySelector('#bottom .row').clientWidth`));
      shot(pw, `81-width-${w}`);
    }
    pw.win.setContentSize(960, 540);
    await sleep(3000);

    await inOverlay(pw, `document.querySelector('[data-control="back"]').click(); 0`);
    await sleep(1200);
    log('after back', { source: !!pw.source, page: !!pw.page, state: pw.state, title: pw.win.getTitle() }, 'top-left', await topLeft(pw), 'overlay', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, focus: document.activeElement && document.activeElement.id })`));
    log('history kept position', history.list('youtube').map((e) => ({ id: e.id, pos: e.position })));
    shot(pw, '82-after-back');

    // load something else in the same window, then back with the keyboard
    let live = false;
    for (const name of (process.env.PANE_PROBE_CHANNELS || 'caseoh_,xqc,kaicenat,sodapoppin,moonmoon,ludwig,zackrawrr,shroud,summit1g,lirik').split(',')) {
      pw.load(`https://www.twitch.tv/${name}`);
      live = await waitFor(() => pw.state.ready && pw.state.isLive, 12000);
      if (live) break;
    }
    if (live) await waitFor(() => pw.state.qualityPref !== 'auto', 15000);
    log('twitch', { live, pref: pw.state.qualityPref, playing: pw.state.qualityLabel, best: (pw.state.qualities || [])[0], err: pw.state.error });
    pw.overlay.webContents.focus();
    key(pw, 'Backspace');
    await sleep(1000);
    log('after backspace', { source: !!pw.source, cls: await inOverlay(pw, 'document.body.className') });
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
