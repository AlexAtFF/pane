'use strict';
// Probe: the edges of ad blocking on YouTube (signed out, empty PANE_DATA_DIR):
//   1. a link that starts part-way (resume) still starts there after an ad is removed
//   2. a live stream still lands on the live stream
//   3. turning "Block ads" off reloads at the same spot and lets ads show; on again blocks again
const path = require('path');
const { sleep, log, waitFor } = require('./lib');

module.exports = async ({ app, manager }) => {
  const config = require(path.join(app.getAppPath(), 'src', 'main', 'config.js'));
  const adblock = require(path.join(app.getAppPath(), 'src', 'main', 'adblock.js'));
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);

    /** Watch a load: was an ad seen, was it covered, where did the video start. */
    const watch = async (label, link, ms = 14000) => {
      const t0 = Date.now();
      const seen = { ad: false, covered: false, uncoveredAd: false, adMs: 0, firstTime: null, playAt: null };
      let last = t0;
      if (link) pw.load(link);
      while (Date.now() - t0 < ms) {
        await sleep(150);
        const now = Date.now();
        const s = pw.state;
        if (s.ad && s.ad.showing) {
          seen.ad = true;
          seen.adMs += now - last;
          if (s.ad.covered) seen.covered = true;
          else seen.uncoveredAd = true;
        } else if (seen.playAt === null && s.ready && !s.paused && !s.buffering && (s.time > 0.5 || s.isLive)) {
          seen.playAt = now - t0;
          seen.firstTime = Math.round(s.time);
        }
        last = now;
      }
      const s = pw.state;
      log(label, { ...seen, end: { time: Math.round(s.time || 0), live: s.isLive, liveHead: s.liveHead, quality: s.qualityLabel, error: s.error, muted: pw.page.webContents.isAudioMuted() } });
      return seen;
    };

    await watch('1 resume at 90s', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s');
    await watch('1b resume at 60s', 'https://www.youtube.com/watch?v=kJQP7kiw5Fk&t=60s');
    await watch('2 live', 'https://www.youtube.com/@LofiGirl/live', 16000);

    pw.load('https://www.youtube.com/watch?v=JGwWNGJdvx8&t=30s');
    await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 36 && !(pw.state.ad && pw.state.ad.showing), 30000);
    const before = Math.round(pw.state.time);
    config.set('blockAds', false);
    await sleep(600);
    log('3 turned off', { enabled: adblock.enabled(), attached: pw.page.webContents.debugger.isAttached(), timeBefore: before });
    const off = await watch('3 off: same video reloads', null, 22000);
    log('3 off: came back near', { before, firstTime: off.firstTime });
    await watch('3 off: another video', 'https://www.youtube.com/watch?v=9bZkp7q19f0', 22000);
    config.set('blockAds', true);
    await sleep(600);
    log('3 turned on', { enabled: adblock.enabled() });
    await watch('3 on again', null, 14000);
    log('3 attached', { attached: pw.page.webContents.debugger.isAttached(), settings: require('fs').readFileSync(config.path(), 'utf8').includes('"blockAds": true') });
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
