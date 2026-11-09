'use strict';
// Probe: live stream, chat panel, keyboard, small window, panels, error, second window.
const { sleep, log, shot, waitFor, hover, key, inOverlay } = require('./lib');

const brief = (s) => ({
  ready: s.ready, paused: s.paused, time: Math.round(s.time), dur: Math.round(s.duration), live: s.isLive,
  head: s.liveHead, seek: [Math.round(s.seekStart), Math.round(s.seekEnd)], vol: s.volume, muted: s.muted,
  rate: s.rate, q: s.quality, pref: s.qualityPref, cc: s.captions, chat: s.chatAvailable, ad: s.ad,
  err: s.error, size: [s.width, s.height], loading: s.loading,
});

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    log('start bounds', pw.win.getBounds(), 'content', pw.win.getContentBounds());

    // --- live stream ---
    pw.load('https://www.youtube.com/watch?v=jfKfPfyJRdk');
    log('live ready', await waitFor(() => pw.state.ready && !pw.state.paused && !pw.state.ad.showing, 40000), brief(pw.state));
    await sleep(2500);
    log('live state', brief(pw.state), 'content', pw.win.getContentBounds());
    await hover(pw, true);
    await sleep(500);
    shot(pw, '10-live-hover');

    pw.toggleChat();
    await sleep(5000);
    log('chat bounds', pw.win.getBounds(), 'content', pw.win.getContentBounds(), 'video', pw.videoSize());
    shot(pw, '11-live-chat');
    pw.toggleChat();
    await sleep(600);
    log('after chat', pw.win.getBounds(), 'video', pw.videoSize());

    // seek back on live, then go live
    pw.player('seekBy', -60);
    await sleep(2500);
    log('live behind', brief(pw.state));
    shot(pw, '12-live-behind');
    pw.player('goLive');
    await sleep(2500);
    log('live again', brief(pw.state));

    // --- normal video + keyboard ---
    pw.load('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s');
    log('vod ready', await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 30, 40000), brief(pw.state));
    pw.overlay.webContents.focus();
    key(pw, 'Space');
    await sleep(800);
    log('after space', brief(pw.state));
    key(pw, 'Space');
    await sleep(600);
    key(pw, 'Right');
    await sleep(900);
    log('after right', brief(pw.state));
    key(pw, 'Up');
    key(pw, 'Down');
    key(pw, 'Down');
    await sleep(700);
    log('after vol keys', brief(pw.state), 'audio', pw.audio);
    key(pw, 'c');
    await sleep(900);
    log('after c', brief(pw.state));
    key(pw, '>', ['shift']);
    await sleep(700);
    log('after >', brief(pw.state));
    pw.player('setRate', 1);
    pw.player('setQuality', 'hd1080');
    await sleep(4000);
    log('after quality', brief(pw.state));
    await hover(pw, true);
    shot(pw, '13-vod-captions');
    pw.player('setQuality', 'auto');
    key(pw, 'c');

    // --- small window ---
    await hover(pw, true);
    for (const w of [520, 360, 240]) {
      pw.win.setContentSize(w, Math.round((w * 9) / 16));
      await sleep(700);
      shot(pw, `14-small-${w}`);
    }
    pw.win.setContentSize(960, 540);
    await sleep(500);

    // --- panels ---
    await inOverlay(pw, `document.querySelector('[data-control="open"]').click(); 0`);
    await sleep(500);
    shot(pw, '15-palette');
    key(pw, 'Escape');
    await sleep(200);
    key(pw, '?', ['shift']);
    await sleep(400);
    shot(pw, '16-sheet');
    key(pw, 'Escape');
    pw.toOverlay('toast', { kind: 'link', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' });
    await sleep(600);
    shot(pw, '17-toast');
    pw.toOverlay('flash', { icon: 'volume', text: '65%' });
    await sleep(220);
    shot(pw, '18-bezel');

    // --- error ---
    pw.load('https://www.youtube.com/watch?v=xxxxxxxxxxx');
    await waitFor(() => !!pw.state.error, 20000);
    log('error state', brief(pw.state));
    await sleep(500);
    shot(pw, '19-error');

    // --- second window ---
    const second = manager.create('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    second.audio.muted = true;
    await waitFor(() => second.state.ready, 30000);
    log('second bounds', second.win.getBounds(), 'first', pw.win.getBounds(), 'windows', manager.windows.size);
    second.win.close();
    await sleep(500);
    log('windows after close', manager.windows.size);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  if (!process.env.PANE_PROBE_KEEP) app.quit();
};
