'use strict';
// Probe: the hover controls in the middle of the picture (back / play-pause / forward).
const { sleep, log, shot, waitFor, hover, inOverlay } = require('./lib');

const CENTER = `JSON.stringify({
  cls: document.body.className,
  shown: getComputedStyle(document.querySelector('#center')).opacity,
  buttons: [...document.querySelectorAll('[data-slot="center"] > *')].map((e) => ({ id: e.dataset.control, hidden: e.hidden, tip: e.dataset.tip, text: e.textContent, box: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width)]; })() })),
  window: [innerWidth, innerHeight],
  bezel: getComputedStyle(document.querySelector('#bezel')).display,
})`;
const press = (pw, id) => inOverlay(pw, `document.querySelector('[data-control="${id}"]').click(); 0`);

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    log('start screen', await inOverlay(pw, CENTER));

    pw.load('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=60s');
    await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 60, 40000);
    await sleep(1500);
    await hover(pw, false);
    await sleep(400);
    log('playing, mouse away', await inOverlay(pw, CENTER));
    shot(pw, 'center-1-idle');

    await hover(pw, true);
    await sleep(500);
    log('playing, hover', await inOverlay(pw, CENTER));
    shot(pw, 'center-2-hover');

    await press(pw, 'play-center');
    await waitFor(() => pw.state.paused, 5000);
    await sleep(400);
    log('after centre pause', { paused: pw.state.paused });
    shot(pw, 'center-3-paused');

    let t = pw.state.time;
    await press(pw, 'step-forward');
    await sleep(1200);
    log('forward', { from: +t.toFixed(1), to: +pw.state.time.toFixed(1) });
    t = pw.state.time;
    await press(pw, 'step-back');
    await press(pw, 'step-back');
    await sleep(1200);
    log('back twice', { from: +t.toFixed(1), to: +pw.state.time.toFixed(1) });

    await press(pw, 'play-center');
    await waitFor(() => !pw.state.paused, 5000);
    log('after centre play', { paused: pw.state.paused });

    // Narrow window: the step buttons give way, the play button stays; tiny: all gone.
    pw.win.setContentSize(280, 158);
    await sleep(700);
    await hover(pw, true);
    log('280 wide', await inOverlay(pw, CENTER));
    shot(pw, 'center-4-small');
    pw.win.setContentSize(960, 540);
    await sleep(500);

    // The link box and history drop in over the picture: the centre controls step aside.
    await inOverlay(pw, `document.querySelector('[data-control="new"]'); 0`);
    pw.toOverlay('ui', { action: 'history' });
    await sleep(600);
    log('history open', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, center: getComputedStyle(document.querySelector('#center')).display })`));
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
