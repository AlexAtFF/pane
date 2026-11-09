'use strict';
// Probe: how YouTube reports time on a live stream (player API vs <video> element).
const { sleep, log, waitFor, inYouTube } = require('./lib');

const READ = `(() => {
  const p = document.getElementById('movie_player');
  const v = p.querySelector('video');
  const g = p.getProgressState();
  return JSON.stringify({
    vTime: v.currentTime, vDur: v.duration,
    vSeekable: v.seekable.length ? [v.seekable.start(0), v.seekable.end(v.seekable.length - 1)] : null,
    pTime: p.getCurrentTime(), pDur: p.getDuration(),
    prog: { current: g.current, start: g.seekableStart, end: g.seekableEnd, head: g.isAtLiveHead, loaded: g.loaded, duration: g.duration },
    atHead: p.isAtLiveHead && p.isAtLiveHead(),
  });
})()`;

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(800);
    pw.load(process.env.PANE_PROBE_URL || 'https://www.youtube.com/@LofiGirl/live');
    await waitFor(() => pw.state.ready && !pw.state.paused && !pw.state.ad.showing && pw.state.isLive, 90000);
    await sleep(3000);
    log('at head', await inYouTube(pw, READ));
    await inYouTube(pw, `(() => { const p = document.getElementById('movie_player'); p.seekTo(p.getCurrentTime() - 120, true); })()`);
    await sleep(3500);
    log('after seekTo -120', await inYouTube(pw, READ));
    await inYouTube(pw, `document.getElementById('movie_player').seekToLiveHead()`);
    await sleep(3500);
    log('after seekToLiveHead', await inYouTube(pw, READ));
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
