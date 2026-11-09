'use strict';
// Probe: is the saved YouTube session really signed in, and does YouTube treat it as Premium?
// Reports cookie NAMES and yes/no facts only; never cookie values or account names.
const path = require('path');
const { sleep, log, waitFor, inPage } = require('./lib');

const TEST_ID = 'aqz-KE-bpKQ';

module.exports = async ({ app, manager }) => {
  const src = (name) => require(path.join(app.getAppPath(), 'src', 'main', name));
  const history = src('history.js');
  const accounts = src('accounts.js');
  const providers = src('providers/index.js');
  const had = !!history.find('youtube', TEST_ID);
  try {
    const yt = providers.get('youtube');
    const ses = accounts.getSession();
    const cookies = await ses.cookies.get({ url: 'https://www.youtube.com' });
    const now = Date.now() / 1000;
    log('cookie names', cookies.map((c) => `${c.name}${c.httpOnly ? '(h)' : ''}${c.session ? '(session)' : c.expirationDate < now ? '(EXPIRED)' : ''}@${c.domain}`).sort());
    log('manager.accounts', manager.accounts, 'LOGIN_INFO cookie', await accounts.isSignedIn(yt), 'homepage LOGGED_IN', await yt.account.verify(ses));

    const pw = manager.activeWindow();
    pw.audio.muted = true;
    pw.load(`https://www.youtube.com/watch?v=${process.env.PANE_PROBE_VIDEO || TEST_ID}`);
    await waitFor(() => pw.state.ready, 40000);
    let sawAd = false;
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      if (pw.state.ad && pw.state.ad.showing) sawAd = true;
    }
    log('agent', { signedIn: pw.state.signedIn, adNow: pw.state.ad, sawAd, title: pw.state.title.slice(0, 30) });
    log('page', await inPage(pw, `(() => {
      const g = (k) => { try { return window.ytcfg.get(k); } catch (e) { return 'ERR'; } };
      const logo = document.querySelector('ytd-topbar-logo-renderer a#logo, ytd-topbar-logo-renderer a');
      const cookieNames = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean).sort();
      const pr = (() => { try { return document.getElementById('movie_player').getPlayerResponse(); } catch (e) { return null; } })();
      return JSON.stringify({
        LOGGED_IN: g('LOGGED_IN'),
        hasDelegatedSession: !!g('DELEGATED_SESSION_ID'),
        sessionIndex: g('SESSION_INDEX'),
        hasIdToken: !!g('ID_TOKEN'),
        logoTitle: logo ? logo.getAttribute('title') || logo.getAttribute('aria-label') : null,
        premiumLogo: !!document.querySelector('ytd-topbar-logo-renderer [is-red], #logo-icon [is-red], ytd-topbar-logo-renderer yt-icon[type*="premium" i]'),
        avatarButton: !!document.querySelector('#avatar-btn'),
        signInButton: !!document.querySelector('ytd-masthead a[href*="ServiceLogin"], ytd-masthead ytd-button-renderer a[href*="accounts.google.com"]'),
        jsVisibleCookies: cookieNames,
        adPlacements: pr && pr.adPlacements ? pr.adPlacements.length : 0,
        playerAds: pr && pr.playerAds ? pr.playerAds.length : 0,
        playability: pr && pr.playabilityStatus ? pr.playabilityStatus.status : null,
      });
    })()`));
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  if (!had) history.remove('youtube', TEST_ID);
  history.flush();
  app.quit();
};
