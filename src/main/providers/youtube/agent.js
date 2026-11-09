// Runs INSIDE the YouTube watch page, after providers/agent-core.js.
// The only code that touches YouTube's player (#movie_player and its API).
// New player feature: add a field in snapshot() and/or a function in `commands`,
// copy the field through sanitize() in player-window.js, then use it in the overlay.
window.__paneAgentStart &&
  window.__paneAgentStart(({ desired, shown, push }) => {
    const QUALITY_LABELS = {
      highres: '4320p', hd2880: '2880p', hd2160: '2160p', hd1440: '1440p', hd1080: '1080p',
      hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p',
    };
    let qualityAppliedFor = null;

    const player = () => document.getElementById('movie_player');
    const video = () => {
      const p = player();
      return (p && p.querySelector('video')) || null;
    };
    const call = (name, ...args) => {
      const p = player();
      try {
        if (p && typeof p[name] === 'function') return p[name](...args);
      } catch {}
      return undefined;
    };

    function qualityOptions() {
      const out = [];
      const seen = new Set();
      const data = call('getAvailableQualityData');
      if (Array.isArray(data) && data.length) {
        for (const q of data) {
          if (!q || !q.quality || q.quality === 'auto' || q.isPlayable === false) continue;
          const label = q.qualityLabel || QUALITY_LABELS[q.quality] || q.quality;
          if (seen.has(label)) continue;
          seen.add(label);
          out.push({ key: q.formatId ? `${q.quality}|${q.formatId}` : q.quality, label });
        }
        if (out.length) return out;
      }
      for (const q of call('getAvailableQualityLevels') || []) {
        if (q === 'auto' || seen.has(q)) continue;
        seen.add(q);
        out.push({ key: q, label: QUALITY_LABELS[q] || q });
      }
      return out;
    }

    function setQuality(key) {
      desired.quality = key || 'auto';
      if (desired.quality === 'auto') {
        call('setPlaybackQualityRange', 'auto', 'auto');
        return;
      }
      const options = qualityOptions();
      let pick = desired.quality === 'highest' ? options[0] : options.find((o) => o.key === desired.quality);
      if (!pick) pick = options.find((o) => o.key.split('|')[0] === desired.quality.split('|')[0]);
      if (!pick) return;
      const [quality, formatId] = pick.key.split('|');
      if (formatId) call('setPlaybackQualityRange', quality, quality, formatId);
      else call('setPlaybackQualityRange', quality, quality);
    }

    function applyAudio() {
      if (!video()) return;
      if (desired.volume != null) {
        const pct = Math.round(desired.volume * 100);
        if (call('getVolume') !== pct) call('setVolume', pct);
      }
      if (desired.muted != null && !!call('isMuted') !== desired.muted) {
        if (desired.muted) call('mute');
        else call('unMute');
      }
    }

    /** Position and seekable range on the player's own clock, or null if unavailable. */
    function progress() {
      const g = call('getProgressState');
      const ok = g && [g.current, g.seekableStart, g.seekableEnd].every((n) => typeof n === 'number' && Number.isFinite(n));
      return ok && g.seekableEnd > g.seekableStart ? g : null;
    }

    function seekTo(t) {
      const v = video();
      if (!v || typeof t !== 'number' || !Number.isFinite(t)) return;
      const g = progress();
      if (!g) {
        v.currentTime = Math.max(0, t);
        return;
      }
      const target = Math.min(Math.max(t, g.seekableStart), g.seekableEnd);
      // Seeking can set off an ad before the new position ever plays; the ad blocker
      // returns to `content`, so note the new place now.
      if (content.id) Object.assign(content, { time: target, atLive: g.seekableEnd - target < 15 });
      call('seekTo', target, true);
    }

    function captionsButton() {
      const p = player();
      return p ? p.querySelector('.ytp-subtitles-button') : null;
    }

    function skipButton() {
      const p = player();
      if (!p) return null;
      const buttons = p.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
      for (const b of buttons) if (shown(b)) return b;
      return null;
    }

    function pageError() {
      const p = player();
      const v = video();
      if (v && !v.paused && v.readyState >= 3) return null; // it's playing: any error box is stale
      const box = p && p.querySelector('.ytp-error');
      const inPlayer = box && box.style.display !== 'none' && box.querySelector('.ytp-error-content-wrap-reason');
      if (inPlayer && inPlayer.textContent.trim()) return inPlayer.textContent.trim();
      // Removed / private / unavailable videos: YouTube swaps the player for a full-page notice.
      if (document.querySelector('ytd-watch-flexy[player-unavailable]')) {
        const promo = document.querySelector('ytd-background-promo-renderer');
        const title = promo && (promo.querySelector('.promo-title') || promo.querySelector('[class*="title"]'));
        const text = title && title.textContent.trim();
        return text || 'This video is unavailable.';
      }
      return null;
    }

    function captions() {
      const p = player();
      const response = call('getPlayerResponse');
      const list = response && response.captions && response.captions.playerCaptionsTracklistRenderer;
      const available = !!(list && Array.isArray(list.captionTracks) && list.captionTracks.length);
      let on = call('isSubtitlesOn');
      if (typeof on !== 'boolean') {
        const cc = captionsButton();
        on = !!cc && cc.getAttribute('aria-pressed') === 'true';
      }
      return { available: available && !!p, on: available && on };
    }

    function signedIn() {
      try {
        const flag = window.ytcfg && window.ytcfg.get && window.ytcfg.get('LOGGED_IN');
        return typeof flag === 'boolean' ? flag : null;
      } catch {
        return null;
      }
    }

    function snapshot() {
      const p = player();
      const v = video();
      const s = { hasPlayer: !!p, ready: false, error: pageError(), signedIn: signedIn() };
      if (!p || !v) return s;

      const data = call('getVideoData') || {};
      s.id = data.video_id || null;
      s.title = data.title || '';
      s.subtitle = data.author || '';
      s.isLive = !!data.isLive;
      s.kind = s.isLive ? 'live' : 'video';

      s.width = v.videoWidth;
      s.height = v.videoHeight;
      s.ready = v.readyState >= 1 && v.videoWidth > 0;
      s.paused = v.paused;
      s.ended = v.ended;
      s.buffering = !v.paused && !v.ended && v.readyState < 3;
      s.time = v.currentTime;
      s.duration = Number.isFinite(v.duration) ? v.duration : 0;
      s.rate = v.playbackRate;
      s.rates = call('getAvailablePlaybackRates') || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

      s.buffered = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) s.buffered = v.buffered.end(i);
      }
      if (v.seekable.length) {
        s.seekStart = v.seekable.start(0);
        s.seekEnd = v.seekable.end(v.seekable.length - 1);
      } else {
        s.seekStart = 0;
        s.seekEnd = s.duration;
      }
      // "Ad" here also covers the moments after one on a live stream, while the viewer is
      // being taken back to their place (rescue.restore): Pane keeps both covered and muted.
      const adShowing = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') || !!rescue.restore;
      // The player's own clock is the truth: on live streams the <video> element's
      // time is offset from it and its "seekable" range overshoots the live edge.
      const g = adShowing ? null : progress();
      if (g) {
        const offset = g.current - v.currentTime;
        s.time = g.current;
        s.seekStart = g.seekableStart;
        s.seekEnd = g.seekableEnd;
        if (s.buffered) s.buffered += offset;
      }
      const atHead = call('isAtLiveHead');
      s.liveHead = s.isLive && (typeof atHead === 'boolean' ? atHead : s.seekEnd - s.time < 12);

      const vol = call('getVolume');
      s.volume = typeof vol === 'number' ? vol / 100 : v.volume;
      const muted = call('isMuted');
      s.muted = typeof muted === 'boolean' ? muted : v.muted;

      s.qualities = qualityOptions();
      s.quality = call('getPlaybackQuality') || '';
      s.qualityLabel = QUALITY_LABELS[s.quality] || '';
      // "highest" is a standing wish, not a menu entry: report the quality it resolved to.
      s.qualityPref = desired.quality === 'highest' ? (s.qualities[0] ? s.qualities[0].key : 'auto') : desired.quality;

      s.captions = captions();
      s.ad = { showing: adShowing, skippable: adShowing && !!skipButton() };
      s.chatAvailable = s.isLive && !!document.querySelector('ytd-live-chat-frame');
      return s;
    }

    // ---- ad blocking (the setting is `blockAds`; overview in src/main/adblock.js) ----------
    //
    // What works against YouTube's ads (measured Nov 2026, signed out):
    //   * The moment an ad shows, ask YouTube for the same video again with the request
    //     marked the way YouTube's own no-ad surfaces mark theirs (REQUEST_VARIANTS). The
    //     answer comes back without the ad and the video is playing ~0.8 s later.
    //     The answer still lists ad breaks for later in the video (seeking sets them off),
    //     so those lists are taken out of that one answer: after one rescue a video has no
    //     ads left in it at all.
    //   * A live stream reloads at the live point. A viewer who was behind it is taken
    //     straight back to where they were, and stays covered and muted until they are
    //     there (rescue.restore): never a glimpse of "now" for someone watching behind.
    //   * If the re-request ever stops working, the ad is skipped through instead (dodge).
    //     Pane keeps all of this muted and covered (PlayerWindow.onAgentState).
    // What does not work, so don't go back to it:
    //   * Removing the ad lists (adPlacements / adSlots / playerAds) from the player data
    //     the page first loads with, or only skipping through the ad: YouTube then holds
    //     the video back for about as long as the ad would have run (~15 s of nothing).
    //   * The 'YAHI' and 'CHANNEL' request variants other blockers also try: the first
    //     changes nothing, the second answers "This content isn't available".
    const REQUEST_VARIANTS = ['lactmilli', 'inline'];
    const AD_LISTS = ['adPlacements', 'adSlots', 'playerAds'];
    // restore: { id, time, until, soughtAt } while a live viewer is being taken back to their place.
    const rescue = { id: null, tries: 0, at: 0, variant: null, cleanUntil: 0, cleaned: 0, restore: null };
    // Where the viewer is in the real video (player clock), and whether that is the live point.
    const content = { id: null, time: 0, atLive: true };
    let heldSince = 0;
    let requestsHooked = false;
    let watchedPlayer = null;
    let adWasShowing = false;

    // The player builds its "give me this video" request as an object and turns it into
    // text with JSON.stringify; this marks the one request that follows a rescue.
    // Installed only once an ad has actually appeared (never for an ad-free account).
    function hookRequests() {
      if (requestsHooked) return;
      requestsHooked = true;
      const real = JSON.stringify;
      JSON.stringify = function stringify(value, ...rest) {
        try {
          const wanted = rescue.variant && Date.now() - rescue.at < 8000;
          if (wanted && value && typeof value === 'object' && value.videoId && value.attestationRequest && value.context && value.context.client) {
            const playback = (value.playbackContext = value.playbackContext || {});
            const ctx = (playback.contentPlaybackContext = playback.contentPlaybackContext || {});
            if (rescue.variant === 'lactmilli') value.params = '8AUB';
            if (rescue.variant === 'inline') ctx.isInlinePlaybackNoAd = true;
            ctx.lactMilliseconds = String(Date.now());
            ctx.referer = String(ctx.referer || location.href).replace(/(?:#reloadxhr)?$/, '#reloadxhr');
            rescue.variant = null; // one request only
          }
        } catch {}
        return real.call(this, value, ...rest);
      };

      // ...and the answer to that request has its ad lists taken out before the player reads it.
      const realFetch = window.fetch;
      window.fetch = function fetch(input, ...rest) {
        const pending = realFetch.call(this, input, ...rest);
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (Date.now() > rescue.cleanUntil || !/\/youtubei\/v1\/player(\?|$)/.test(url)) return pending;
        } catch {
          return pending;
        }
        rescue.cleanUntil = 0; // one answer only
        return pending.then((res) =>
          res
            .clone()
            .text()
            .then((text) => {
              const data = JSON.parse(text);
              const found = AD_LISTS.filter((key) => key in data);
              if (!found.length) return res;
              for (const key of found) delete data[key];
              rescue.cleaned += 1;
              const clean = new Response(real(data), { status: res.status, statusText: res.statusText, headers: res.headers });
              // A rebuilt answer forgets where it came from; put that back.
              for (const key of ['url', 'redirected', 'type']) {
                try {
                  Object.defineProperty(clean, key, { value: res[key] });
                } catch {}
              }
              return clean;
            })
            .catch(() => res),
        );
      };
    }

    /** Where the real video should (re)start: where it was, else where the link said. */
    function startSeconds(id, response) {
      if (content.id === id && content.time > 1) return content.time;
      const config = response.playerConfig && response.playerConfig.playbackStartConfig;
      if (config && config.startSeconds > 0) return config.startSeconds;
      const t = new URLSearchParams(location.search).get('t') || '';
      const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
      return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    }

    /** Ask YouTube for this video again, ad-free. False once it has been tried enough. */
    function requestAgain(id, response) {
      if (rescue.id !== id) Object.assign(rescue, { id, tries: 0 });
      if (rescue.tries >= 4) return false;
      hookRequests();
      rescue.variant = REQUEST_VARIANTS[rescue.tries % REQUEST_VARIANTS.length];
      rescue.tries += 1;
      rescue.at = Date.now();
      rescue.cleanUntil = rescue.at + 8000;
      qualityAppliedFor = null; // the reloaded player picks its own quality again
      const live = !!(response.videoDetails && response.videoDetails.isLive);
      if (!live) {
        call('loadVideoById', id, startSeconds(id, response));
        return true;
      }
      // A stream comes back at the live point; someone watching behind it must not see that.
      if (rescue.restore && rescue.restore.id === id) rescue.restore.until = rescue.at + 20000;
      else if (content.id === id && !content.atLive) rescue.restore = { id, time: content.time, until: rescue.at + 20000, soughtAt: 0 };
      else rescue.restore = null;
      call('loadVideoById', id);
      return true;
    }

    /** After a live rescue: back to where the viewer was. Covered (snapshot) until it is done. */
    function restorePlace(id, v, state, now) {
      const r = rescue.restore;
      // (While the stream is reloading the player briefly knows no video at all: id is null.)
      if ((id && r.id !== id) || now > r.until) {
        rescue.restore = null; // another video, or it never got there: stop covering
      } else if (id) {
        const g = progress();
        if (g && v.readyState >= 1) {
          const target = Math.min(Math.max(r.time, g.seekableStart), g.seekableEnd);
          if (Math.abs(g.current - target) < 10) {
            if (state === 1) rescue.restore = null; // there, and playing
          } else if (now - r.soughtAt > 1200) {
            r.soughtAt = now;
            call('seekTo', target, true);
          }
        }
      }
      if (!rescue.restore) push();
    }

    /** Fallback: get an ad over with by jumping to its end. */
    function dodge(v, response) {
      const skip = skipButton();
      if (skip) skip.click();
      const stats = call('getStatsForNerds');
      const stitched = !!stats && typeof stats.debug_info === 'string' && stats.debug_info.startsWith('SSAP, AD');
      if (stitched) {
        // The ad is part of the video's own stream: jump to where the player says it ends.
        const g = call('getProgressState');
        if (g && g.duration > 0 && g.current < g.duration - 0.25) call('seekTo', g.duration);
        return;
      }
      // An ordinary ad is its own short clip in the <video> element: go to its end.
      // Never do that to the real video (same length as the video itself, or a live stream).
      const length = Number(response.videoDetails && response.videoDetails.lengthSeconds) || 0;
      const d = v.duration;
      if (!Number.isFinite(d) || d <= 0 || (length > 0 && d > length - 2)) return;
      if (v.currentTime < d - 0.25) v.currentTime = d;
    }

    function blockAds() {
      if (!desired.blockAds) return;
      const p = player();
      const v = video();
      if (!p || !v) return;
      if (p !== watchedPlayer) {
        // React the instant the player switches to an ad, not at the next tick.
        watchedPlayer = p;
        new MutationObserver(blockAds).observe(p, { attributes: true, attributeFilter: ['class'] });
      }
      const response = call('getPlayerResponse') || {};
      const id = (response.videoDetails && response.videoDetails.videoId) || null;
      const now = Date.now();
      const sinceRescue = now - rescue.at;
      const ad = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
      if (ad !== adWasShowing) {
        adWasShowing = ad;
        push(); // so Pane mutes and covers (or uncovers) without delay
      }
      if (ad) {
        if (id && (rescue.id !== id || sinceRescue > 2500) && requestAgain(id, response)) return;
        dodge(v, response);
        return;
      }
      const state = call('getPlayerState');
      if (rescue.restore) restorePlace(id, v, state, now);
      if (rescue.id === id && rescue.tries && sinceRescue > 600 && sinceRescue < 20000) {
        // The re-request was refused, or the video is still being held back: try the other variant.
        const refused = !!response.playabilityStatus && response.playabilityStatus.status === 'UNPLAYABLE';
        const stats = call('getStatsForNerds') || {};
        const held = state !== 1 && String(stats.resolution || '').startsWith('0x0') && stats.buffer_health_seconds === '0.00 s';
        heldSince = held ? heldSince || now : 0;
        if (refused || (held && now - heldSince > 3000 && sinceRescue > 3000)) {
          heldSince = 0;
          requestAgain(id, response);
          return;
        }
      }
      if (state === 1 && !rescue.restore) {
        const g = progress();
        if (g && id) Object.assign(content, { id, time: g.current, atLive: !!response.videoDetails.isLive && call('isAtLiveHead') !== false });
        if (rescue.id === id && sinceRescue > 20000) rescue.tries = 0; // playing fine: a later ad break gets its own tries
      }
    }
    setInterval(blockAds, 200);

    function tick() {
      const p = player();
      if (p) {
        // Turn YouTube's autoplay-next off (stored only in this app's own cookies).
        const autonav = p.querySelector('.ytp-autonav-toggle-button');
        if (autonav && autonav.getAttribute('aria-checked') === 'true') autonav.click();
        // Re-apply the wanted quality once per video, as soon as the list is known.
        const id = (call('getVideoData') || {}).video_id;
        if (id && id !== qualityAppliedFor && desired.quality !== 'auto' && qualityOptions().length) {
          qualityAppliedFor = id;
          setQuality(desired.quality);
        }
      }
      // Tell YouTube someone is here, so it never asks "Still watching?".
      window._lact = Date.now();
    }

    function onBind(v) {
      v.addEventListener('ended', () => {
        // Never roll on to a "next" video by itself.
        const cancel = document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
        if (cancel) cancel.click();
      });
    }

    const commands = {
      play: () => call('playVideo'),
      pause: () => call('pauseVideo'),
      toggle() {
        const v = video();
        if (!v) return;
        if (v.ended) {
          call('seekTo', 0, true);
          call('playVideo');
        } else if (v.paused) call('playVideo');
        else call('pauseVideo');
      },
      seek: seekTo,
      seekBy(delta) {
        const v = video();
        if (!v || typeof delta !== 'number') return;
        const g = progress();
        seekTo((g ? g.current : v.currentTime) + delta);
      },
      seekFraction(f) {
        const v = video();
        if (!v || !Number.isFinite(v.duration)) return;
        seekTo(v.duration * Math.min(Math.max(f, 0), 0.999));
      },
      setRate(r) {
        if (call('setPlaybackRate', r) === undefined) {
          const v = video();
          if (v) v.playbackRate = r;
        }
      },
      setQuality,
      toggleCaptions() {
        const p = player();
        if (p && typeof p.toggleSubtitles === 'function') p.toggleSubtitles();
        else if (captionsButton()) captionsButton().click();
      },
      goLive() {
        const v = video();
        if (call('seekToLiveHead') === undefined && v && v.seekable.length) {
          v.currentTime = v.seekable.end(v.seekable.length - 1);
        }
        content.atLive = true;
        call('playVideo');
      },
      skipAd() {
        const b = skipButton();
        if (b) b.click();
      },
      frame(dir) {
        const v = video();
        if (!v) return;
        if (!v.paused) call('pauseVideo');
        v.currentTime = Math.max(0, v.currentTime + (dir < 0 ? -1 : 1) / 30);
      },
    };

    return { video, snapshot, applyAudio, tick, onBind, commands };
  });
