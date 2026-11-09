'use strict';
// Ad blocking for the sites' pages. Setting: `blockAds` (right-click menu "Block ads").
//
// Three layers, so that one of them failing still leaves the others:
//
//   1. network  Requests to ad servers are cancelled for the whole session (install()).
//   2. page     A provider can have a script run in its page before the site's own scripts
//               (`adblock.script` in the provider's index.js; prepare() below). Twitch
//               splices ads into the stream, so its script swaps in an ad-free copy.
//   3. agent    An ad that starts anyway is muted and covered (PlayerWindow.onAgentState)
//               and, where the site allows, skipped through at once (provider agent.js).
//               This is how YouTube is handled: see dodgeAd() in youtube/agent.js for why.
//
// Layer 2 uses the page's debugger connection (the same one DevTools uses): it is the only
// way to run a script ahead of the page's own.

const config = require('./config');
const providers = require('./providers');

const enabled = () => config.get().blockAds !== false;

// Ad and ad-measurement servers. Nothing a video needs in order to play.
const BLOCKED = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/get_midroll_*',
  '*://*.google.com/pagead/*',
  '*://imasdk.googleapis.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.ads.twitch.tv/*',
  '*://*.moatads.com/*',
  '*://*.scorecardresearch.com/*',
];

const stats = { cancelled: 0 };

/** Layer 1. Call once for the session the site pages use. */
function install(ses) {
  ses.webRequest.onBeforeRequest({ urls: BLOCKED }, (_details, done) => {
    const cancel = enabled();
    if (cancel) stats.cancelled += 1;
    done({ cancel });
  });
}

const withRules = () => providers.list.filter((p) => p.adblock && p.adblock.script);

const pages = new WeakMap(); // webContents -> { on, busy }

async function sync(wc) {
  const entry = pages.get(wc);
  if (!entry || wc.isDestroyed()) return;
  const want = enabled();
  if (want === entry.on) return;
  const dbg = wc.debugger;
  entry.on = want;
  try {
    if (!want) {
      if (dbg.isAttached()) dbg.detach(); // takes the scripts with it
      return;
    }
    // A view that has never loaded anything has no page to connect to yet.
    if (!wc.getURL()) await wc.loadURL('about:blank');
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Page.enable'); // without it the scripts are dropped when the page changes site
    for (const provider of withRules()) {
      // Runs in every document this view opens, so it checks whose page it is in.
      const source = `if (${provider.adblock.hosts}.test(location.hostname)) {\n${provider.adblock.script}\n}`;
      await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
    }
  } catch (err) {
    entry.on = false;
    console.warn('[adblock] page layer unavailable:', err.message);
  }
}

/**
 * Layer 2. Call before every load of a site page; resolves once the page is set up
 * to match the current setting (so a toggle applies from the next load).
 */
function prepare(wc) {
  let entry = pages.get(wc);
  if (!entry) {
    entry = { on: false, busy: Promise.resolve() };
    pages.set(wc, entry);
    // Something else took the connection (or the page went away): set up again next load.
    wc.debugger.on('detach', () => {
      entry.on = false;
    });
  }
  entry.busy = entry.busy.then(() => sync(wc)).catch(() => {});
  return entry.busy;
}

module.exports = { enabled, install, prepare, stats };
