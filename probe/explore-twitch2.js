'use strict';
// Standalone exploration, part 2: early-load state (ads), offline channels, clips, and driving the player.
// npx electron probe/explore-twitch2.js <outDir> <liveChannel>
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
const channel = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const log = (...p) => fs.appendFileSync(path.join(out, 'explore.log'), `${p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIND = `(() => {
  const fiberOf = (el) => { if (!el) return null; const k = Object.keys(el).find((k) => k.startsWith('__reactFiber')); return k ? el[k] : null; };
  for (const sel of ['[data-a-target="video-player"]', '.video-player', 'video']) {
    let f = fiberOf(document.querySelector(sel));
    for (let i = 0; f && i < 200; i++, f = f.return) {
      const p = f.memoizedProps; const s = f.stateNode && f.stateNode.props;
      const inst = (p && p.mediaPlayerInstance) || (s && s.mediaPlayerInstance);
      if (inst) { window.__tw = inst; return sel + ' hops=' + i; }
    }
  }
  return null;
})()`;

const BRIEF = `(() => {
  const safe = (f) => { try { return f(); } catch (e) { return 'ERR ' + e.message; } };
  const p = window.__tw; const vs = [...document.querySelectorAll('video')];
  const t = (sel) => { const e = document.querySelector(sel); return e ? (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) : null; };
  return JSON.stringify({
    videos: vs.map((v) => [v.videoWidth, v.videoHeight, v.paused, Math.round(v.currentTime), String(v.duration).slice(0, 9)]),
    state: safe(() => p.getState()), paused: safe(() => p.isPaused()), pos: safe(() => Math.round(p.getPosition())), dur: safe(() => String(p.getDuration())),
    q: safe(() => p.getQuality().name), auto: safe(() => p.isAutoQualityMode()), vol: safe(() => p.getVolume()), muted: safe(() => p.isMuted()),
    login: safe(() => p.getLoadedChannelLogin && p.getLoadedChannelLogin()), path: safe(() => p.getPath && p.getPath()),
    meta: safe(() => JSON.stringify(p.getChannelMetadata && p.getChannelMetadata()).slice(0, 300)),
    title: t('[data-a-target="player-info-title"]'), titleLink: t('[data-a-target="player-info-title"] a'), game: t('[data-a-target="player-info-game-name"]'),
    adLabel: t('[data-a-target="video-ad-label"]'), adCountdown: t('[data-a-target="video-ad-countdown"]'),
    gate: [...document.querySelectorAll('[data-a-target*="gate"], [data-a-target*="mature"], [data-a-target*="content-classification"]')].map((e) => e.getAttribute('data-a-target')),
    targets: [...new Set([...document.querySelectorAll('[data-a-target]')].map((e) => e.getAttribute('data-a-target')))].slice(0, 60),
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220),
  });
})()`;

app.whenReady().then(async () => {
  const ses = session.fromPartition('explore-twitch');
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|pane|Pane)\/[^\s]+/g, ''));
  const win = new BrowserWindow({
    width: 960, height: 540, show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  const js = (code) => wc.executeJavaScript(code, true).catch((e) => `EXEC ERR ${e.message}`);
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await wc.capturePage()).toPNG());
  try {
    // 1. early load: sample every 1.5s to see ads / loading states
    wc.loadURL(`https://player.twitch.tv/?channel=${channel}&parent=twitch.tv`);
    for (let i = 0; i < 6; i++) {
      await sleep(1500);
      await js(FIND);
      log(`early ${i}`, await js(BRIEF));
    }
    // 2. hide Twitch's own UI and drive the player
    await wc.insertCSS(`html, body { background:#000 !important; overflow:hidden !important } .video-player__overlay, .extensions-video-overlay-size-container { display:none !important }`, { cssOrigin: 'user' });
    await sleep(500);
    await shot('embed-clean');
    log('drive', await js(`(async () => {
      const p = window.__tw; const out = {}; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const qs = p.getQualities();
      p.setQuality(qs[qs.length - 1]); await wait(2500);
      out.afterSetLowest = [p.getQuality().name, p.isAutoQualityMode(), document.querySelector('video').videoHeight];
      p.setAutoQualityMode(true); await wait(2500);
      out.afterAuto = [p.getQuality().name, p.isAutoQualityMode()];
      p.pause(); await wait(600); out.paused = [p.isPaused(), p.getState()];
      p.play(); await wait(1500); out.resumed = [p.isPaused(), p.getState()];
      p.setVolume(0.3); p.setMuted(true); await wait(300); out.audio = [p.getVolume(), p.isMuted(), document.querySelector('video').volume, document.querySelector('video').muted];
      out.ls = Object.keys(localStorage).filter((k) => /volume|mute|quality/i.test(k)).map((k) => k + '=' + String(localStorage[k]).slice(0, 60));
      out.buffered = (() => { const b = p.getBuffered(); return b ? JSON.stringify(b) + ' ' + Object.keys(b) : null; })();
      return JSON.stringify(out);
    })()`));

    // 3. offline / nonexistent channels
    for (const name of ['twitchdev', 'zz_no_such_channel_zz']) {
      await wc.loadURL(`https://player.twitch.tv/?channel=${name}&parent=twitch.tv`);
      await sleep(7000);
      await js(FIND);
      log(`offline ${name}`, await js(BRIEF));
    }
    await shot('embed-offline');

    // 4. clips
    await wc.loadURL(`https://www.twitch.tv/${channel}/clips?filter=clips&range=7d`);
    await sleep(7000);
    const clips = JSON.parse(await js(`JSON.stringify([...new Set([...document.querySelectorAll('a[href*="/clip/"]')].map((a) => a.getAttribute('href')))].slice(0, 3))`));
    log('clips', clips);
    const slug = clips[0] && clips[0].split('/clip/')[1].split(/[?#]/)[0];
    if (slug) {
      await wc.loadURL(`https://clips.twitch.tv/embed?clip=${slug}&parent=twitch.tv`);
      await sleep(8000);
      log('clip find', await js(FIND));
      log('clip brief', await js(BRIEF));
      await shot('clip');
    }
  } catch (err) {
    log('error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
});
