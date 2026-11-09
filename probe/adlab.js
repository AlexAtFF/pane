'use strict';
// Probe (exploration): what does YouTube's player report, second by second, while the ad
// blocker is at work? Logs the player's own view of things for each link.
//   PANE_ADS_LINKS  comma-separated links      PANE_ADS_WATCH  seconds per link (default 20)
const path = require('path');
const { sleep, log, inPage } = require('./lib');

const PEEK = `(() => {
  const p = document.getElementById('movie_player');
  if (!p) return { noPlayer: true, ready: document.readyState };
  const v = p.querySelector('video');
  const call = (n, ...a) => { try { return typeof p[n] === 'function' ? p[n](...a) : undefined; } catch (e) { return 'ERR ' + e.message; } };
  const st = call('getStatsForNerds') || {};
  const g = call('getProgressState') || {};
  const r = call('getPlayerResponse') || {};
  const keys = Object.keys(r);
  return {
    cls: [...p.classList].filter((c) => /ad-|playing|paused|buffering|unstarted|ended/.test(c)).join(' '),
    v: v ? { t: +v.currentTime.toFixed(1), d: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : String(v.duration), w: v.videoWidth, rs: v.readyState, paused: v.paused, src: (v.currentSrc || '').slice(0, 20) } : null,
    stats: { res: st.resolution, buf: st.buffer_health_seconds, dbg: (st.debug_info || '').slice(0, 60) },
    prog: { cur: g.current, dur: g.duration, loaded: g.loaded },
    resp: { ads: keys.filter((k) => /ad|no_ads/i.test(k)), status: r.playabilityStatus && r.playabilityStatus.status, len: r.videoDetails && r.videoDetails.lengthSeconds, id: r.videoDetails && r.videoDetails.videoId },
    state: call('getPlayerState'),
    skip: !!p.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'),
    ua: (window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.INNERTUBE_CONTEXT && window.ytcfg.data_.INNERTUBE_CONTEXT.client && window.ytcfg.data_.INNERTUBE_CONTEXT.client.userAgent || '').slice(-40),
  };
})()`;

module.exports = async ({ app, manager }) => {
  const links = (process.env.PANE_ADS_LINKS || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ').split(',').map((s) => s.trim()).filter(Boolean);
  const watchMs = (Number(process.env.PANE_ADS_WATCH) || 20) * 1000;
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    for (const link of links) {
      log('---', link);
      const t0 = Date.now();
      pw.load(link);
      let last = '';
      while (Date.now() - t0 < watchMs) {
        await sleep(500);
        let peek;
        try {
          peek = await inPage(pw, PEEK);
        } catch (err) {
          peek = { err: err.message };
        }
        const line = JSON.stringify(peek);
        // Log only when something other than the clock changed.
        const key = line.replace(/"(t|cur|loaded|buf)":[^,}]+/g, '');
        if (key !== last) log(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, line);
        last = key;
      }
    }
    const adblock = require(path.join(app.getAppPath(), 'src', 'main', 'adblock.js'));
    log('blocker', adblock.stats);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
