'use strict';
// Probe: start screen, load a normal video, hover UI, player API survey.
const { sleep, log, shot, waitFor, hover, inYouTube, inOverlay } = require('./lib');

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1500);
    const native = require(require('path').join(app.getAppPath(), 'src', 'main', 'native-drag.js'));
    log('app path', app.getAppPath(), 'packaged', app.isPackaged, 'native drag', native.isNative());
    log('overlay url', pw.overlay.webContents.getURL());
    log('overlay body class', await inOverlay(pw, 'document.body.className'));
    shot(pw, '01-start');

    pw.load(process.env.PANE_PROBE_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    const ready = await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 1, 30000);
    log('ready', ready, pw.state);
    log('bounds', pw.win.getBounds(), 'ratio', pw.ratio);
    await sleep(1500);
    shot(pw, '02-playing');

    const { screen } = require('electron');
    log('displays', screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scale: d.scaleFactor, work: d.workArea })));
    log('content', pw.win.getContentBounds(), 'size', pw.win.getSize());
    await hover(pw, true);
    await sleep(600);
    shot(pw, '03-hover');
    await inOverlay(pw, `document.querySelector('[data-control="settings"]').click(); 0`);
    await sleep(300);
    shot(pw, '04-settings');
    await inOverlay(pw, `document.querySelector('#popover .menu-row').click(); 0`);
    await sleep(300);
    shot(pw, '05-quality');
    log('overlay class after hover', await inOverlay(pw, 'document.body.className'));

    const survey = await inYouTube(
      pw,
      `(() => {
        const p = document.getElementById('movie_player');
        const names = [];
        for (const k in p) if (typeof p[k] === 'function' && /quality|subtitle|caption|live|rate|volume|mute|progress|option/i.test(k)) names.push(k);
        const safe = (f) => { try { return f(); } catch (e) { return 'ERR ' + e.message; } };
        return JSON.stringify({
          names,
          levels: safe(() => p.getAvailableQualityLevels()),
          data: safe(() => p.getAvailableQualityData && p.getAvailableQualityData()),
          quality: safe(() => p.getPlaybackQuality()),
          pref: safe(() => p.getPreferredQuality && p.getPreferredQuality()),
          progress: safe(() => p.getProgressState && p.getProgressState()),
          rect: (() => { const r = p.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
          vrect: (() => { const r = p.querySelector('video').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })(),
          inner: [innerWidth, innerHeight],
          autonav: (() => { const a = p.querySelector('.ytp-autonav-toggle-button'); return a ? a.getAttribute('aria-checked') : null; })(),
          cc: (() => { const c = p.querySelector('.ytp-subtitles-button'); return c ? [c.style.display, c.getAttribute('aria-pressed'), c.getAttribute('aria-disabled')] : null; })(),
        });
      })()`,
    );
    log('survey', survey);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  if (!process.env.PANE_PROBE_KEEP) app.quit();
};
