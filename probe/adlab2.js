'use strict';
// Probe (exploration): after an ad is skipped YouTube holds the video back. Which of the
// known "ask for the video again, differently" variants gets it playing soonest?
//   PANE_TRICK      channel | lactmilli | yahi | inline | none   (default none = just wait)
//   PANE_ADS_LINKS  comma-separated links      PANE_ADS_WATCH  seconds per link (default 24)
const { sleep, log, inPage } = require('./lib');

const TRICK = process.env.PANE_TRICK || 'none';
const AT_AD = !!process.env.PANE_TRICK_AT_AD; // re-request as soon as an ad shows, instead of once the video is held back

const PEEK = `(() => {
  const p = document.getElementById('movie_player');
  if (!p) return null;
  const v = p.querySelector('video');
  const call = (n, ...a) => { try { return typeof p[n] === 'function' ? p[n](...a) : undefined; } catch (e) { return undefined; } };
  const st = call('getStatsForNerds') || {};
  const r = call('getPlayerResponse') || {};
  const track = r.playbackTracking && r.playbackTracking.videostatsPlaybackUrl && r.playbackTracking.videostatsPlaybackUrl.baseUrl || '';
  return {
    ad: p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'),
    state: call('getPlayerState'),
    res: st.resolution || '', buf: st.buffer_health_seconds || '',
    t: v ? +v.currentTime.toFixed(1) : null, w: v ? v.videoWidth : 0,
    id: r.videoDetails && r.videoDetails.videoId,
    status: r.playabilityStatus && r.playabilityStatus.status,
    reason: r.playabilityStatus && r.playabilityStatus.reason,
    ads: Object.keys(r).filter((k) => /^(ad|player)Ads?|adPlacements|adSlots/.test(k)),
    reloaded: track.includes('reloadxhr'),
    hits: window.__paneTrickHits || 0,
    timerPatched: window.setTimeout.name,
  };
})()`;

const applyTrick = (trick) => `(() => {
  const p = document.getElementById('movie_player');
  const r = p.getPlayerResponse();
  const id = r.videoDetails.videoId;
  if (!window.__paneTrickHooked) {
    window.__paneTrickHooked = true;
    const real = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
      try {
        const trick = window.__paneTrick;
        if (trick && value && typeof value === 'object' && value.attestationRequest && value.context && value.context.client) {
          window.__paneTrickHits = (window.__paneTrickHits || 0) + 1;
          const pc = (value.playbackContext = value.playbackContext || {});
          const cpc = (pc.contentPlaybackContext = pc.contentPlaybackContext || {});
          if (trick === 'channel' && value.context.client.clientName === 'WEB') value.context.client.clientScreen = 'CHANNEL';
          if (trick === 'lactmilli') value.params = '8AUB';
          if (trick === 'yahi') value.params = 'YAHI';
          if (trick === 'inline') cpc.isInlinePlaybackNoAd = true;
          if (trick !== 'yahi') cpc.lactMilliseconds = String(Date.now());
          cpc.referer = String(cpc.referer || location.href).replace(/(?:#reloadxhr)?$/, '#reloadxhr');
        }
      } catch (e) {}
      return real.call(this, value, ...rest);
    };
  }
  window.__paneTrick = ${JSON.stringify(trick)};
  p.loadVideoById(id, 0);
  return id;
})()`;

module.exports = async ({ app, manager }) => {
  const links = (process.env.PANE_ADS_LINKS || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ').split(',').map((s) => s.trim()).filter(Boolean);
  const watchMs = (Number(process.env.PANE_ADS_WATCH) || 24) * 1000;
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    for (const link of links) {
      const t0 = Date.now();
      const at = () => +((Date.now() - t0) / 1000).toFixed(1);
      pw.load(link);
      let adAt = null;
      let stuckSince = null;
      let trickAt = null;
      let playAt = null;
      let last = null;
      while (Date.now() - t0 < watchMs) {
        await sleep(250);
        let p = null;
        try {
          p = await inPage(pw, PEEK);
        } catch {}
        if (!p) continue;
        last = p;
        if (p.ad && adAt === null) adAt = at();
        const stuck = !p.ad && p.state !== 1 && String(p.res).startsWith('0x0') && p.buf === '0.00 s';
        if (stuck && stuckSince === null) stuckSince = at();
        if (!stuck) {
          if (p.state === 1 && p.w > 0 && p.t > 0.2 && !p.ad && playAt === null) playAt = at();
        }
        if (TRICK !== 'none' && trickAt === null && (AT_AD ? p.ad : stuck && at() - stuckSince >= 1)) {
          trickAt = at();
          try {
            await inPage(pw, applyTrick(TRICK));
          } catch (err) {
            log('trick failed', err.message);
          }
        }
      }
      log('lab', { trick: TRICK, atAd: AT_AD, link: link.slice(-11), adAt, stuckSince, trickAt, playAt, end: last });
    }
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
