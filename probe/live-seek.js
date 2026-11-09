'use strict';
// Probe: on a YouTube live stream, well behind the live point, stepping a few seconds back or
// forward must move that many seconds (and not jump to live). Compares the player's own clock
// before and after each step, allowing for the time that passed. (Don't measure this with
// "seconds behind live": the live end moves in jumps and makes a 5 s step look like 0 or 8.)
const { sleep, log, waitFor, inPage } = require('./lib');

const LINK = process.env.PANE_LIVE_LINK || 'https://www.youtube.com/@LofiGirl/live';
const CLOCK = `(() => { const p = document.getElementById('movie_player'); const g = p.getProgressState(); return { cur: g.current, end: g.seekableEnd, state: p.getPlayerState(), at: performance.now() }; })()`;

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    pw.load(LINK);
    await waitFor(() => pw.state.ready && pw.state.isLive && !pw.state.paused && pw.state.seekEnd > pw.state.seekStart + 120, 45000);
    await sleep(4000);
    pw.player('seek', pw.state.seekEnd - 1800);
    await sleep(6000);
    const errors = [];
    for (const step of [5, 5, 5, -5, -5, -5, 10, -10, 5, -5]) {
      const a = await inPage(pw, CLOCK);
      pw.player('seekBy', step);
      await sleep(3000);
      const b = await inPage(pw, CLOCK);
      const elapsed = (b.at - a.at) / 1000;
      const moved = b.cur - a.cur - elapsed; // what the step itself did
      errors.push(+(moved - step).toFixed(1));
      log('step', { step, moved: +moved.toFixed(1), state: b.state, behind: Math.round(b.end - b.cur) });
    }
    log('step errors (s)', errors);
    log('live stepping ok', errors.every((e) => Math.abs(e) <= 1.5) && !pw.state.liveHead);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
