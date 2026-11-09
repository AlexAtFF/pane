'use strict';
// Probe: live stream + chat, captions, unavailable video.
const { sleep, log, shot, waitFor, hover, key } = require('./lib');

const brief = (s) => ({
  ready: s.ready, paused: s.paused, time: Math.round(s.time), dur: Math.round(s.duration), live: s.isLive,
  head: s.liveHead, seek: [Math.round(s.seekStart), Math.round(s.seekEnd)], muted: s.muted, q: s.quality,
  cc: s.captions, chat: s.chatAvailable, ad: s.ad, err: s.error, size: [s.width, s.height], loading: s.loading, id: s.id,
});

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1000);

    pw.load(process.env.PANE_PROBE_URL || 'https://www.youtube.com/@LofiGirl/live');
    await waitFor(() => pw.state.ready && pw.state.ad && pw.state.ad.showing, 15000);
    if (pw.state.ad && pw.state.ad.showing) {
      log('ad state', brief(pw.state));
      await hover(pw, true);
      await sleep(400);
      shot(pw, '20-ad');
    }
    log('live ready', await waitFor(() => pw.state.ready && !pw.state.paused && !pw.state.ad.showing && pw.state.isLive, 90000), brief(pw.state));
    await sleep(2500);
    await hover(pw, true);
    await sleep(500);
    log('live', brief(pw.state), 'content', pw.win.getContentBounds());
    shot(pw, '21-live-hover');

    pw.toggleChat();
    await sleep(6000);
    log('chat open', pw.win.getContentBounds(), 'video', pw.videoSize(), 'chatOpen', pw.chatOpen);
    shot(pw, '22-live-chat');
    pw.toggleChat();
    await sleep(600);
    log('chat closed', pw.win.getContentBounds());

    pw.player('seekBy', -90);
    await sleep(3000);
    log('behind', brief(pw.state));
    shot(pw, '23-live-behind');
    pw.player('goLive');
    await sleep(3000);
    log('back to live', brief(pw.state));

    pw.load('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    log('cc video ready', await waitFor(() => pw.state.ready && !pw.state.paused && !pw.state.ad.showing && pw.state.time > 1, 90000), brief(pw.state), 'bounds', pw.win.getContentBounds(), 'ratio', pw.ratio);
    pw.overlay.webContents.focus();
    key(pw, 'c');
    await sleep(2500);
    log('after c', brief(pw.state));
    await hover(pw, true);
    shot(pw, '24-captions');
    key(pw, 'c');
    await sleep(1200);
    log('after c again', brief(pw.state));
    pw.win.setContentSize(960, 720);
    await sleep(400);
    key(pw, '?', ['shift']);
    await sleep(500);
    shot(pw, '26-sheet');
    key(pw, 'Escape');

    pw.load('https://www.youtube.com/watch?v=xxxxxxxxxxx');
    await waitFor(() => !!pw.state.error, 20000);
    log('unavailable', brief(pw.state));
    await sleep(600);
    await hover(pw, false);
    shot(pw, '25-error');
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
