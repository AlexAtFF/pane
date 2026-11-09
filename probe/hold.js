'use strict';
// Probe: open a muted video at a known spot and stay running, logging every change in
// window bounds / UI state, so real mouse interaction can be checked from outside.
const { sleep, log, waitFor, inOverlay } = require('./lib');

module.exports = async ({ manager }) => {
  const pw = manager.activeWindow();
  pw.audio.muted = true;
  await sleep(800);
  pw.win.setPosition(240, 160);
  pw.load(process.env.PANE_PROBE_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await waitFor(() => pw.state.ready, 30000);
  let last = '';
  setInterval(async () => {
    try {
      for (const w of manager.windows) {
        const cls = await inOverlay(w, 'document.body.className');
        const c = w.win.getContentBounds();
        const line = JSON.stringify({
          win: [...manager.windows].indexOf(w), bounds: w.win.getBounds(), ratio: +(c.width / c.height).toFixed(4),
          max: w.win.isMaximized(), full: w.win.isFullScreen(), top: w.win.isAlwaysOnTop(), cls,
          paused: w.state.paused, muted: w.state.muted, vol: w.state.volume, t: Math.round(w.state.time || 0), chat: w.chatOpen,
        });
        if (w === pw && line !== last) {
          last = line;
          log(line);
        }
      }
    } catch {}
  }, 400);
};
