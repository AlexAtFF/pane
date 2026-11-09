'use strict';
// Standalone exploration (not a PANE_PROBE): npx electron probe/explore-twitch.js <outDir>
// Looks at what Twitch's pages and player expose so providers/twitch can drive them.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const log = (...p) => fs.appendFileSync(path.join(out, 'explore.log'), `${p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIND_PLAYER = `(() => {
  const fiberOf = (el) => { if (!el) return null; const k = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')); return k ? el[k] : null; };
  const seeds = ['[data-a-target="video-player"]', '.video-player', '.video-player__container', 'video'];
  for (const sel of seeds) {
    let f = fiberOf(document.querySelector(sel));
    for (let i = 0; f && i < 200; i++, f = f.return) {
      const p = f.memoizedProps;
      const s = f.stateNode && f.stateNode.props;
      const inst = (p && p.mediaPlayerInstance) || (s && s.mediaPlayerInstance);
      if (inst) { window.__tw = inst; return sel + ' hops=' + i; }
    }
  }
  return null;
})()`;

const SURVEY = `(() => {
  const safe = (f) => { try { return f(); } catch (e) { return 'ERR ' + e.message; } };
  const v = document.querySelector('video');
  const p = window.__tw;
  const methods = [];
  if (p) { let o = p; const seen = new Set(); for (let d = 0; o && d < 4; d++, o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) if (typeof p[k] === 'function' && !seen.has(k)) { seen.add(k); methods.push(k); } }
  const cls = (sel) => [...document.querySelectorAll(sel)].slice(0, 12).map((e) => (e.getAttribute('data-a-target') || '') + '|' + String(e.className).slice(0, 80));
  return JSON.stringify({
    url: location.href, title: document.title,
    video: v ? { paused: v.paused, t: v.currentTime, dur: String(v.duration), w: v.videoWidth, h: v.videoHeight, muted: v.muted, vol: v.volume, rs: v.readyState, rect: (() => { const r = v.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() } : null,
    inner: [innerWidth, innerHeight],
    hasPlayer: !!p,
    methods: methods.sort(),
    qualities: safe(() => p.getQualities()),
    quality: safe(() => p.getQuality()),
    auto: safe(() => p.isAutoQualityMode && p.isAutoQualityMode()),
    position: safe(() => p.getPosition()), duration: safe(() => String(p.getDuration())),
    state: safe(() => p.getState && p.getState()), pVol: safe(() => p.getVolume()), pMuted: safe(() => p.isMuted()),
    rate: safe(() => p.getPlaybackRate && p.getPlaybackRate()),
    buffered: safe(() => p.getBuffered && p.getBuffered()),
    targets: [...new Set([...document.querySelectorAll('[data-a-target]')].map((e) => e.getAttribute('data-a-target')))].slice(0, 120),
    overlays: cls('[class*="overlay"], [class*="Overlay"]'),
    ogImage: safe(() => document.querySelector('meta[property="og:image"]').content),
    ogTitle: safe(() => document.querySelector('meta[property="og:title"]').content),
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
  });
})()`;

app.whenReady().then(async () => {
  const ses = session.fromPartition('explore-twitch');
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|pane|Pane)\/[^\s]+/g, ''));
  const win = new BrowserWindow({
    width: 960, height: 540, show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true).catch((e) => `EXEC ERR ${e.message}`);
  const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), (await wc.capturePage()).toPNG());
  try {
    await wc.loadURL('https://www.twitch.tv/directory/all');
    await sleep(7000);
    const channels = JSON.parse(await js(`JSON.stringify([...new Set([...document.querySelectorAll('a[data-a-target="preview-card-image-link"], a[data-test-selector="TitleAndChannel"], a[href^="/"]')].map((a) => a.getAttribute('href')).filter((h) => /^\\/[a-zA-Z0-9_]{3,25}$/.test(h)).map((h) => h.slice(1)))].filter((n) => !['directory', 'downloads', 'jobs', 'turbo', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'search', 'videos', 'store', 'prime', 'privacy', 'legal', 'friends', 'following'].includes(n)).slice(0, 8))`));
    log('channels', channels);
    const channel = process.argv[3] || channels[0];
    if (!channel) throw new Error('no live channel found');

    await wc.loadURL(`https://player.twitch.tv/?channel=${channel}&parent=twitch.tv`);
    await sleep(9000);
    log('embed find', await js(FIND_PLAYER));
    log('embed survey', await js(SURVEY));
    await shot('embed-live');

    await wc.loadURL(`https://www.twitch.tv/${channel}`);
    await sleep(10000);
    log('site find', await js(FIND_PLAYER));
    log('site survey', await js(SURVEY));
    await shot('site-live');

    await wc.loadURL(`https://www.twitch.tv/${channel}/videos?filter=archives&sort=time`);
    await sleep(7000);
    const vods = JSON.parse(await js(`JSON.stringify([...new Set([...document.querySelectorAll('a[href^="/videos/"]')].map((a) => a.getAttribute('href').match(/\\/videos\\/(\\d+)/)).filter(Boolean).map((m) => m[1]))].slice(0, 3))`));
    log('vods', vods);
    if (vods[0]) {
      await wc.loadURL(`https://player.twitch.tv/?video=${vods[0]}&parent=twitch.tv&time=0h5m0s`);
      await sleep(9000);
      log('vod find', await js(FIND_PLAYER));
      log('vod survey', await js(SURVEY));
      await js(`(() => { try { window.__tw.seekTo(900); } catch (e) {} })()`);
      await sleep(3000);
      log('vod after seekTo(900)', await js(`JSON.stringify({ pos: window.__tw && window.__tw.getPosition(), vt: document.querySelector('video') && document.querySelector('video').currentTime })`));
      await shot('embed-vod');
    }
  } catch (err) {
    log('error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
});
