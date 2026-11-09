'use strict';
// Probe: someone watching a YouTube live stream well behind the live point must stay there
// when the ad blocker removes an ad, and must never be shown or played the live point on
// the way (spoilers). A real ad break can't be ordered up, so the probe makes the player
// look like it has switched to an ad (the same signal the ad blocker reacts to).
//   PANE_LIVE_LINK    the stream (default: a 24/7 stream with a long rewind window)
//   PANE_LIVE_BEHIND  how far behind live to watch from, in seconds (default 1800)
const { sleep, log, waitFor, inPage } = require('./lib');

const LINK = process.env.PANE_LIVE_LINK || 'https://www.youtube.com/@LofiGirl/live';
const BEHIND = Number(process.env.PANE_LIVE_BEHIND) || 1800;

const FAKE_AD = `(() => {
  const p = document.getElementById('movie_player');
  if (!p.__paneWrapped) {
    p.__paneWrapped = true;
    window.__reloads = 0;
    const real = p.loadVideoById;
    p.loadVideoById = function (...args) { window.__reloads += 1; p.classList.remove('ad-showing'); return real.apply(this, args); };
  }
  p.classList.add('ad-showing');
  setTimeout(() => p.classList.remove('ad-showing'), 1500);
})()`;

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = false; // so "muted" below can only come from the ad blocker's cover
    pw.audio.volume = 0.01;
    await sleep(1200);
    pw.load(LINK);
    const ok = await waitFor(() => pw.state.ready && pw.state.isLive && !pw.state.paused && pw.state.seekEnd > pw.state.seekStart + 120, 45000);
    await sleep(4000);
    const behind = () => Math.round(pw.state.seekEnd - pw.state.time);
    log('live', { ok, title: (pw.state.title || '').slice(0, 40), window: Math.round(pw.state.seekEnd - pw.state.seekStart) });

    const back = Math.min(BEHIND, Math.round((pw.state.seekEnd - pw.state.seekStart) * 0.8));
    pw.player('seek', pw.state.seekEnd - back);
    await sleep(5000);
    log('watching behind live', { behind: behind(), liveHead: pw.state.liveHead });

    const round = async (label, action) => {
      const before = behind();
      await action();
      const t0 = Date.now();
      const seen = { coveredMs: 0, nearLiveUncovered: 0, nearLiveAudible: 0, minBehindWhileCovered: null, samples: 0 };
      let last = t0;
      while (Date.now() - t0 < 14000) {
        await sleep(100);
        const now = Date.now();
        const s = pw.state;
        const b = behind();
        const covered = !!(s.ad && s.ad.covered);
        seen.samples += 1;
        if (covered) {
          seen.coveredMs += now - last;
          if (seen.minBehindWhileCovered === null || b < seen.minBehindWhileCovered) seen.minBehindWhileCovered = b;
        }
        // Anything within ten minutes of live would be a spoiler for someone 30 minutes back.
        if (b < before - 600) {
          if (!covered) seen.nearLiveUncovered += 1;
          if (!pw.page.webContents.isAudioMuted()) seen.nearLiveAudible += 1;
        }
        last = now;
      }
      const s = pw.state;
      const result = { label, before, after: behind(), reloads: await inPage(pw, 'window.__reloads || 0'), ...seen, playing: !s.paused && !s.buffering, liveHead: s.liveHead, stillCovered: !!(s.ad && s.ad.covered), mutedNow: pw.page.webContents.isAudioMuted() };
      log('round', result);
      return result;
    };

    const a = await round('ad while behind live', () => inPage(pw, FAKE_AD));
    const b = await round('step back 5s, ad cuts in', async () => {
      pw.player('seekBy', -5);
      await sleep(150);
      await inPage(pw, FAKE_AD);
    });
    const kept = (r, expected) => Math.abs(r.after - expected) <= 12 && !r.liveHead && r.playing && !r.stillCovered && !r.mutedNow;
    const safe = (r) => r.nearLiveUncovered === 0 && r.nearLiveAudible === 0;
    log('live rescue summary', {
      reloadHappened: a.reloads > 0,
      keptPlace: kept(a, a.before) && kept(b, b.before + 5),
      noSpoilers: safe(a) && safe(b),
    });
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
