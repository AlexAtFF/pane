'use strict';
// Probe: how many ads does a signed-out window see? Loads each link in turn, watches the
// reported state for a while and logs whether (and for how long) an ad was on screen and
// how long the real video took to start. Run it with an empty PANE_DATA_DIR (signed out).
//   PANE_ADS_LINKS   optional, comma-separated links to use instead of the built-in list
//   PANE_ADS_WATCH   optional, seconds to watch each link (default 30)
const path = require('path');
const { sleep, log, shot } = require('./lib');

const DEFAULT_LINKS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=9bZkp7q19f0',
  'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
  'https://www.youtube.com/watch?v=JGwWNGJdvx8',
  'https://www.youtube.com/watch?v=OPf0YbXqDm0',
  'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
];

module.exports = async ({ app, manager }) => {
  const links = (process.env.PANE_ADS_LINKS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const watchMs = (Number(process.env.PANE_ADS_WATCH) || 30) * 1000;
  const totals = { links: 0, withAd: 0, adMs: 0, played: 0 };
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    let n = 0;
    for (const link of links.length ? links : DEFAULT_LINKS) {
      n += 1;
      const t0 = Date.now();
      let adMs = 0;
      let adSeen = false;
      let contentAt = null;
      let lastTick = t0;
      let shotTaken = false;
      let error = null;
      pw.load(link);
      while (Date.now() - t0 < watchMs) {
        await sleep(200);
        const now = Date.now();
        const s = pw.state;
        if (s.ad && s.ad.showing) {
          adSeen = true;
          adMs += now - lastTick;
          if (!shotTaken) {
            shotTaken = true;
            shot(pw, `ad-${n}`);
          }
        } else if (contentAt === null && s.ready && !s.paused && !s.buffering && (s.time > 0.5 || s.isLive)) {
          contentAt = now - t0;
        }
        if (s.error) error = s.error;
        lastTick = now;
      }
      const s = pw.state;
      totals.links += 1;
      if (adSeen) totals.withAd += 1;
      totals.adMs += adMs;
      if (contentAt !== null) totals.played += 1;
      // After an ad was removed, the video's data should list no ads at all any more.
      let adLists = null;
      try {
        adLists = await pw.page.webContents.executeJavaScript("(() => { const p = document.getElementById('movie_player'); const r = p && p.getPlayerResponse && p.getPlayerResponse(); return r ? Object.keys(r).filter((k) => /^(adPlacements|adSlots|playerAds)$/.test(k)) : null; })()", true);
      } catch {}
      log('ads', { link, adSeen, adMs, contentAt, adLists, error, end: { time: Math.round(s.time || 0), paused: s.paused, ready: s.ready, quality: s.qualityLabel, title: (s.title || '').slice(0, 40) } });
      shot(pw, `end-${n}`);
    }
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  const adblock = require(path.join(app.getAppPath(), 'src', 'main', 'adblock.js'));
  log('ads totals', { ...totals, blocking: adblock.enabled(), blocker: adblock.stats });
  app.quit();
};
