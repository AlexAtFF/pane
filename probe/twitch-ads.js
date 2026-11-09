'use strict';
// Probe: is Twitch's ad blocker (vendor/vaft.js) in place, and does a stream keep playing
// through an ad break? Real ad breaks can't be ordered up, so this uses the script's own
// test switch (window.simulateAds), which makes it treat the stream as being in an ad.
//   PANE_TWITCH_CHANNELS  comma-separated channel names to try (the first one that is live is used)
const { sleep, log, shot, waitFor, inPage } = require('./lib');

const CHANNELS = (process.env.PANE_TWITCH_CHANNELS || 'kaicenat,xqc,summit1g,esl_cs2,riotgames,nasa,monstercat').split(',');

const PEEK = `(() => {
  const banner = document.querySelector('.adblock-overlay');
  const v = document.querySelector('video');
  return {
    vaft: typeof window.twitchAdSolutionsVersion,
    workerHooked: /twitchBlobUrl/.test(String(window.Worker)),
    banner: banner ? { text: banner.textContent, own: banner.style.display, shown: banner.getClientRects().length > 0 } : null,
    adLabel: !!document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]'),
    video: v ? { t: +v.currentTime.toFixed(1), w: v.videoWidth, paused: v.paused, rs: v.readyState } : null,
  };
})()`;

module.exports = async ({ app, manager }) => {
  try {
    const pw = manager.activeWindow();
    pw.audio.muted = true;
    await sleep(1200);
    let live = null;
    for (const name of CHANNELS) {
      pw.load(`https://www.twitch.tv/${name.trim()}`);
      const ok = await waitFor(() => (pw.state.ready && !pw.state.paused) || !!pw.state.error, 30000);
      log('try', name, { ok, error: pw.state.error || null, quality: pw.state.qualityLabel });
      if (ok && !pw.state.error) {
        live = name;
        break;
      }
    }
    if (!live) throw new Error('no live channel found');
    const lines = [];
    pw.page.webContents.on('console-message', (event) => {
      const text = String(event.message || '');
      if (/vaft|ads|Blocking|Reloading|player type|backup/i.test(text)) lines.push(text.slice(0, 160));
    });

    const sample = async (label) => {
      const peek = await inPage(pw, PEEK);
      const s = pw.state;
      log(label, { peek, state: { ready: s.ready, paused: s.paused, buffering: s.buffering, quality: s.qualityLabel, ad: s.ad, error: s.error } });
      return peek;
    };

    await sleep(6000);
    const before = await sample('playing');
    shot(pw, 'tw-1-playing');

    log('simulate ad break');
    await inPage(pw, 'window.simulateAds(1); 0');
    const during = [];
    for (let i = 0; i < 8; i++) {
      await sleep(2500);
      during.push(await sample(`in ad +${((i + 1) * 2.5).toFixed(1)}s`));
    }
    shot(pw, 'tw-2-in-ad');

    log('end ad break');
    await inPage(pw, 'window.simulateAds(0); 0');
    const after = [];
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      after.push(await sample(`after +${((i + 1) * 2.5).toFixed(1)}s`));
    }
    shot(pw, 'tw-3-after');

    const moved = (list) => list.length > 1 && list[list.length - 1].video && list[0].video && list[list.length - 1].video.t !== list[0].video.t;
    log('console', lines);
    log('twitch ads summary', {
      channel: live,
      scriptInPage: before.vaft === 'number',
      workerHooked: before.workerHooked,
      keptPlayingDuringAd: moved(during),
      playingAfter: moved(after),
      bannerEverVisible: [...during, ...after].some((p) => p.banner && p.banner.shown),
    });
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
