'use strict';
// Probe: seeking in a long video (or behind live in a stream) makes YouTube start a mid-video
// ad. The ad blocker has to get rid of it AND leave the viewer where they were.
// Logs a timeline of what the player does around each step.
//   PANE_MID_LINK   the video or stream to use (pick a long one that carries ads; the default is only a stand-in)
//   PANE_MID_AT     where to go first: seconds from the start (recording) or behind live (stream); default 1800
const { sleep, log, waitFor, inPage } = require('./lib');

const LINK = process.env.PANE_MID_LINK || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const AT = Number(process.env.PANE_MID_AT) || 1800;

const WRAP = `(() => {
  const p = document.getElementById('movie_player');
  if (!p || p.__paneWrapped) return;
  p.__paneWrapped = true;
  window.__reloads = [];
  const real = p.loadVideoById;
  p.loadVideoById = function (...args) { window.__reloads.push(args.length > 1 ? Math.round(args[1]) : 'no start'); return real.apply(this, args); };
})()`;

const PEEK = `(() => {
  const p = document.getElementById('movie_player');
  const v = p && p.querySelector('video');
  if (!p || !v) return null;
  const g = (p.getProgressState && p.getProgressState()) || {};
  const r = (p.getPlayerResponse && p.getPlayerResponse()) || {};
  return {
    ad: p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'),
    state: p.getPlayerState(),
    cur: Math.round(g.current), end: Math.round(g.seekableEnd), live: !!(r.videoDetails && r.videoDetails.isLive),
    vd: Number.isFinite(v.duration) ? Math.round(v.duration) : null, vt: Math.round(v.currentTime),
    status: r.playabilityStatus && r.playabilityStatus.status,
    reloads: (window.__reloads || []).join(','),
  };
})()`;

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    pw.load(LINK);
    const ok = await waitFor(() => pw.state.ready && !pw.state.paused && !(pw.state.ad && pw.state.ad.showing) && pw.state.seekEnd > pw.state.seekStart + 60, 45000);
    await sleep(4000);
    await inPage(pw, WRAP);
    const live = !!pw.state.isLive;
    log('loaded', { ok, live, title: (pw.state.title || '').slice(0, 40), length: Math.round(pw.state.seekEnd - pw.state.seekStart) });

    // Position as the viewer thinks of it: seconds from the start, or seconds behind live.
    const where = () => (live ? Math.round(pw.state.seekEnd - pw.state.time) : Math.round(pw.state.time));

    const watch = async (label, ms) => {
      const t0 = Date.now();
      let last = '';
      let adMs = 0;
      let lastTick = t0;
      while (Date.now() - t0 < ms) {
        await sleep(250);
        let p = null;
        try {
          p = await inPage(pw, PEEK);
        } catch {}
        const now = Date.now();
        if (!p) continue;
        if (p.ad) adMs += now - lastTick;
        lastTick = now;
        const key = JSON.stringify([p.ad, p.state, p.vd, p.status, p.reloads, p.live]);
        if (key !== last) log(`  ${label} +${((now - t0) / 1000).toFixed(1)}s`, p);
        last = key;
      }
      return adMs;
    };

    const target = live ? pw.state.seekEnd - AT : Math.min(AT, pw.state.seekEnd * 0.6);
    pw.player('seek', target);
    await watch('first jump', 12000);
    log('after first jump', { where: where(), playing: !pw.state.paused && !pw.state.buffering, covered: pw.state.ad });

    const results = [];
    for (const step of [5, 5, -5, 5, -5, -5]) {
      const before = where();
      pw.player('seekBy', step);
      const adMs = await watch(`step ${step}`, 9000);
      const after = where();
      // Nine seconds of playing moves a recording 9 s on; a stream stays the same distance behind.
      const moved = live ? before - after : after - before - 9;
      const s = pw.state;
      results.push({ step, before, after, moved, adMs, playing: !s.paused && !s.buffering && !(s.ad && s.ad.showing), liveHead: s.liveHead });
      log('step', results[results.length - 1]);
    }
    const good = results.every((r) => Math.abs(r.moved - r.step) <= 6 && r.playing && !(live && r.liveHead));
    log('stepping keeps position', good);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
