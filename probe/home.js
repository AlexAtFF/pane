'use strict';
// Probe: home screen + history tabs, YouTube regression, history panel over a video,
// resume from history, accounts panel, cookie-text parsing, data folder contents.
const fs = require('fs');
const path = require('path');
const { sleep, log, shot, waitFor, hover, key, inOverlay } = require('./lib');

module.exports = async ({ app, manager }) => {
  try {
    const src = (name) => require(path.join(app.getAppPath(), 'src', 'main', name));
    const history = src('history.js');
    const accounts = src('accounts.js');
    const store = src('store.js');
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1500);

    log('version', app.getVersion(), 'data dir', store.DATA_DIR, 'userData', app.getPath('userData'));
    log('accounts', manager.accounts, 'tab', manager.historyTab);
    shot(pw, '40-home');
    await inOverlay(pw, `[...document.querySelectorAll('.tab')].find((t) => t.textContent === 'Twitch').click(); 0`);
    await sleep(900);
    shot(pw, '41-home-twitch');
    log('twitch rows', await inOverlay(pw, `document.querySelectorAll('.h-row').length`), 'imgs loaded', await inOverlay(pw, `[...document.querySelectorAll('.h-thumb img')].map((i) => i.naturalWidth)`));

    // --- YouTube regression + history recording ---
    pw.load('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=120s');
    log('yt ready', await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.time > 120, 40000));
    const s = pw.state;
    log('yt state', { provider: s.provider, id: s.id, kind: s.kind, title: s.title, sub: s.subtitle, signedIn: s.signedIn, t: Math.round(s.time), q: s.quality, cc: s.captions });
    await sleep(11500);
    log('yt history', history.list('youtube').map((e) => ({ id: e.id, title: e.title, sub: e.subtitle, pos: e.position, dur: e.duration, thumb: e.thumb })));
    pw.overlay.webContents.focus();
    key(pw, 'h', ['control']);
    await sleep(1200);
    shot(pw, '42-history-over-video');
    log('panel', await inOverlay(pw, `JSON.stringify({ cls: document.body.className, rows: document.querySelectorAll('.h-row').length, tab: document.querySelector('.tab.active').textContent })`));
    await inOverlay(pw, `[...document.querySelectorAll('.tab')].find((t) => t.textContent === 'YouTube').click(); 0`);
    await sleep(900);
    shot(pw, '43-history-youtube');
    key(pw, 'Escape');
    await sleep(300);

    // --- accounts panel ---
    pw.toOverlay('ui', { action: 'accounts' });
    await sleep(500);
    shot(pw, '44-accounts');
    await inOverlay(pw, `[...document.querySelectorAll('.acct .pill-btn')].find((b) => /browser/.test(b.textContent)).click(); 0`);
    await sleep(500);
    shot(pw, '45-import');
    key(pw, 'Escape');
    await sleep(300);

    // --- resume from history (Twitch recording left at ~10 min, if there is one) ---
    const vod = history.list('twitch').find((e) => e.kind === 'video');
    if (vod) {
      manager.openFromHistory(pw, 'twitch', vod.id, false);
      log('resume ready', await waitFor(() => pw.state.ready && !pw.state.paused && pw.state.provider === 'twitch', 30000), { wanted: vod.position, got: Math.round(pw.state.time), title: pw.state.title, sub: pw.state.subtitle });
    }
    // live Twitch: no seek bar
    const channel = history.list('twitch').find((e) => e.kind === 'channel');
    if (channel) {
      manager.openFromHistory(pw, 'twitch', channel.id, false);
      await waitFor(() => pw.state.ready && pw.state.isLive, 20000);
      await hover(pw, true);
      await sleep(600);
      shot(pw, '46-twitch-live-hover');
      log('live classes', await inOverlay(pw, 'document.body.className'));
    }

    // --- cookie text parsing (no cookies are stored by this check) ---
    const parse = accounts.parseCookies;
    log('parse header', parse('SID=abc; __Secure-1PSID=def; LOGIN_INFO=x=y; bad name=1', 'youtube.com').map((c) => c.name));
    log('parse netscape', parse('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tzzz\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tqqq\n.google.com\tTRUE\t/\tTRUE\t1999999999\tNID\tnope', 'youtube.com').map((c) => [c.name, c.httpOnly]));
    log('parse json', parse(JSON.stringify([{ domain: '.twitch.tv', name: 'auth-token', value: 't' }, { domain: '.example.com', name: 'x', value: 'y' }]), 'twitch.tv').map((c) => c.name));
    log('parse junk', parse('hello world', 'youtube.com').length);

    await sleep(1800);
    const walk = (dir, depth = 0) => fs.readdirSync(dir, { withFileTypes: true }).filter((d) => depth === 0 ? /^(settings|history|window-state|backups|thumbnails)/.test(d.name) : true).map((d) => (d.isDirectory() ? `${d.name}/[${depth < 2 ? walk(path.join(dir, d.name), depth + 1).join(', ') : '…'}]` : d.name));
    log('data files', walk(store.DATA_DIR));
    log('window-state', fs.readFileSync(path.join(store.DATA_DIR, 'window-state.json'), 'utf8'));
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
