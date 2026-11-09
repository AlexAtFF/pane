'use strict';
// Probe: Twitch live channel, chat, quality, a past broadcast (seek/speed), a clip, an offline channel.
const { sleep, log, shot, waitFor, hover, key, inPage } = require('./lib');

const brief = (s) => ({
  prov: s.provider, id: s.id, kind: s.kind, title: s.title, sub: s.subtitle, ready: s.ready, paused: s.paused,
  t: Math.round(s.time || 0), dur: Math.round(s.duration || 0), live: s.isLive, seek: [Math.round(s.seekStart || 0), Math.round(s.seekEnd || 0)],
  vol: s.volume, muted: s.muted, rate: s.rate, q: s.quality, ql: s.qualityLabel, pref: s.qualityPref, nq: (s.qualities || []).length,
  chat: s.chatAvailable, ad: s.ad, err: s.error, gate: s.gate, size: [s.width, s.height], loading: s.loading, signedIn: s.signedIn,
});

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1000);

    // --- find a live channel ---
    const candidates = (process.env.PANE_PROBE_CHANNELS || 'zackrawrr,caseoh_,xqc,kaicenat,sodapoppin,moonmoon,ludwig').split(',');
    let channel = null;
    for (const name of candidates) {
      pw.load(`https://www.twitch.tv/${name}`);
      if (await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.isLive, 14000)) {
        channel = name;
        break;
      }
      log('not live', name, brief(pw.state));
    }
    if (!channel) throw new Error('no live channel among candidates');
    await sleep(2500);
    log('live', brief(pw.state), 'content', pw.win.getContentBounds(), 'title', pw.win.getTitle());
    log('info dom', await inPage(pw, `(() => { const t = document.querySelector('[data-a-target="player-info-title"]'); let n = t; for (let i = 0; i < 4 && n && n.parentElement; i++) n = n.parentElement; return n ? n.outerHTML.replace(/class="[^"]*"/g, '').replace(/\\s+/g, ' ').slice(0, 1400) : null; })()`));
    shot(pw, '30-twitch-live');
    await hover(pw, true);
    await sleep(500);
    shot(pw, '31-twitch-live-hover');

    // quality + audio + pause
    const lowest = pw.state.qualities[pw.state.qualities.length - 1];
    pw.player('setQuality', lowest.key);
    await sleep(3500);
    log('after lowest', brief(pw.state));
    pw.player('setQuality', 'auto');
    pw.overlay.webContents.focus();
    key(pw, 'Space');
    await sleep(1000);
    log('after space', brief(pw.state));
    key(pw, 'Space');
    key(pw, 'Up');
    await sleep(1200);
    log('after resume + vol up', brief(pw.state), 'audio', pw.audio);
    key(pw, 'm');
    await sleep(600);

    // chat
    pw.toggleChat();
    await sleep(6000);
    log('chat', pw.chatOpen, pw.chatUrl, 'video', pw.videoSize());
    shot(pw, '32-twitch-chat');
    pw.toggleChat();
    await sleep(500);

    // --- past broadcast ---
    const vod = await (async () => {
      const { BrowserWindow } = require('electron');
      const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:youtube', sandbox: true } });
      w.webContents.setAudioMuted(true);
      try {
        await w.loadURL(`https://www.twitch.tv/${channel}/videos?filter=archives&sort=time`);
        await sleep(7000);
        const ids = await w.webContents.executeJavaScript(`[...new Set([...document.querySelectorAll('a[href^="/videos/"]')].map((a) => (a.getAttribute('href').match(/\\/videos\\/(\\d+)/) || [])[1]).filter(Boolean))]`);
        const clips = await (async () => {
          await w.loadURL(`https://www.twitch.tv/${channel}/clips?filter=clips&range=7d`);
          await sleep(6000);
          return w.webContents.executeJavaScript(`[...new Set([...document.querySelectorAll('a[href*="/clip/"]')].map((a) => a.href.split('?')[0]))]`);
        })();
        return { ids, clips };
      } finally {
        w.destroy();
      }
    })();
    log('found', vod);
    if (vod.ids[0]) {
      pw.load(`https://www.twitch.tv/videos/${vod.ids[0]}?t=0h10m0s`);
      log('vod ready', await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 600, 30000), brief(pw.state));
      key(pw, 'Right');
      await sleep(1500);
      log('vod after right', brief(pw.state));
      pw.player('seek', 1800);
      await sleep(2500);
      log('vod after seek 1800', brief(pw.state));
      key(pw, '>', ['shift']);
      await sleep(800);
      log('vod after >', brief(pw.state));
      pw.player('setRate', 1);
      await hover(pw, true);
      await sleep(400);
      shot(pw, '33-twitch-vod');
      log('vod title', pw.win.getTitle());
    }
    if (vod.clips[0]) {
      pw.load(vod.clips[0]);
      log('clip ready', await waitFor(() => pw.state.ready && !pw.state.paused, 25000), brief(pw.state), 'source', pw.source);
      await sleep(1500);
      shot(pw, '34-twitch-clip');
    }

    // --- offline channel ---
    pw.load('https://www.twitch.tv/twitchdev');
    await waitFor(() => !!pw.state.error || pw.state.ready, 30000);
    log('offline', brief(pw.state));
    await hover(pw, false);
    await sleep(400);
    shot(pw, '35-twitch-offline');

    await sleep(11000); // let history flush
    const history = require(require('path').join(app.getAppPath(), 'src', 'main', 'history.js'));
    log('history twitch', history.list('twitch').map((e) => ({ id: e.id, title: e.title, sub: e.subtitle, live: e.live, pos: e.position, dur: e.duration, thumb: String(e.thumb).slice(0, 60) })));
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
