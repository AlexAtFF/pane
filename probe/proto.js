'use strict';
// Probe: Pane started with a pane:// address (what the browser extension sends) plays the
// video inside it, and ignores a pane:// address that doesn't hold a video link.
// Run as:  PANE_PROBE=probe/proto.js npx electron . "pane://open?url=<encoded link>"
const { sleep, log, waitFor } = require('./lib');

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    log('started with', process.argv.slice(2).filter((a) => /^pane:/i.test(a)));
    log('source at start', pw.source);
    if (pw.source) {
      const ok = await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 0, 40000);
      log('playing', { ok, id: pw.state.id, time: Math.round(pw.state.time || 0), title: (pw.state.title || '').slice(0, 40) });
    }
    // A second launch (the app is already running): the link goes to an idle window, or a new one.
    const before = manager.windows.size;
    app.emit('second-instance', {}, ['Pane.exe', `pane://open?url=${encodeURIComponent('https://www.twitch.tv/videos/2921546465?t=0h10m0s')}`]);
    await sleep(500);
    const newest = [...manager.windows].pop();
    log('second launch while playing', { windows: `${before} -> ${manager.windows.size}`, source: newest.source });
    newest.unload();
    await sleep(300);
    app.emit('second-instance', {}, ['Pane.exe', `pane://open?url=${encodeURIComponent('https://youtu.be/aqz-KE-bpKQ')}`]);
    await sleep(500);
    log('second launch with an idle window', { windows: manager.windows.size, reused: newest.source && newest.source.id });
    const count = manager.windows.size;
    for (const bad of ['pane://open?url=file%3A%2F%2F%2FC%3A%2FWindows%2Fsystem32%2Fcalc.exe', 'pane://open?url=https%3A%2F%2Fexample.com%2F', 'pane://open', 'pane:%%%']) {
      app.emit('second-instance', {}, ['Pane.exe', bad]);
      await sleep(250);
      const w = [...manager.windows].pop();
      log('bad address', { bad, opensEmptyWindow: manager.windows.size, source: w.source });
    }
    log('windows', { before: count, after: manager.windows.size });
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
