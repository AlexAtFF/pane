// Runs INSIDE Twitch's player page, after providers/agent-core.js.
// The only code that touches Twitch's player. Twitch has no public page API, so
// the player object is found through the page's React tree (findPlayer); it
// offers play/pause/seekTo/getQualities/setQuality/setVolume and friends.
window.__paneAgentStart &&
  window.__paneAgentStart(({ desired }) => {
    const params = new URLSearchParams(location.search);
    const isClip = location.hostname === 'clips.twitch.tv';
    const kind = isClip ? 'clip' : params.get('video') ? 'video' : 'channel';
    const sourceId =
      kind === 'clip' ? `clip:${params.get('clip') || ''}`
      : kind === 'video' ? `video:${(params.get('video') || '').replace(/^v/, '')}`
      : `channel:${(params.get('channel') || '').toLowerCase()}`;

    let instance = null;
    let kicked = false;
    let qualityApplied = false;

    const fiberOf = (el) => {
      if (!el) return null;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      return key ? el[key] : null;
    };

    function findPlayer() {
      for (const selector of ['[data-a-target="video-player"]', '.video-player', 'video']) {
        let fiber = fiberOf(document.querySelector(selector));
        for (let hops = 0; fiber && hops < 250; hops++, fiber = fiber.return) {
          const props = fiber.memoizedProps;
          const stateProps = fiber.stateNode && fiber.stateNode.props;
          const found = (props && props.mediaPlayerInstance) || (stateProps && stateProps.mediaPlayerInstance);
          if (found && typeof found.getState === 'function') return found;
        }
      }
      return null;
    }

    const player = () => {
      if (!instance) instance = findPlayer();
      return instance;
    };
    const call = (name, ...args) => {
      const p = player();
      try {
        if (p && typeof p[name] === 'function') return p[name](...args);
      } catch {}
      return undefined;
    };
    const video = () => call('getHTMLVideoElement') || document.querySelector('video');
    const text = (selector) => {
      const node = document.querySelector(selector);
      return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
    };

    const qualities = () => (call('getQualities') || []).filter((q) => q && q.group && q.name);

    function setQuality(key) {
      desired.quality = key || 'auto';
      if (desired.quality === 'auto') return call('setAutoQualityMode', true);
      const list = qualities();
      const pick = desired.quality === 'highest' ? list[0] : list.find((q) => q.group === desired.quality);
      if (pick) call('setQuality', pick);
      return undefined;
    }

    function applyAudio() {
      if (!player()) return;
      if (desired.volume != null) {
        const now = call('getVolume');
        if (typeof now !== 'number' || Math.abs(now - desired.volume) > 0.005) call('setVolume', desired.volume);
      }
      if (desired.muted != null && !!call('isMuted') !== desired.muted) call('setMuted', desired.muted);
    }

    // "Start watching" button on streams marked for mature audiences.
    const gateButton = () =>
      document.querySelector(
        '[data-a-target="content-classification-gate-overlay-start-watching-button"], [data-a-target="player-overlay-mature-accept"]',
      );

    function pageError() {
      if (call('getState') === 'Playing') return null;
      const overlay = document.querySelector('.video-player__overlay');
      const all = overlay ? overlay.textContent.replace(/\s+/g, ' ') : '';
      const offline = /OFFLINE\s*(.{1,60}? is offline)\b/i.exec(all);
      if (offline) return `${offline[1]}.`;
      if (/content is unavailable/i.test(all)) return 'That video is no longer available.';
      if (/only available to subscribers|subscriber-only|Subscribe to watch/i.test(all)) return 'This video is for subscribers only.';
      return null;
    }

    function snapshot() {
      const p = player();
      const v = video();
      const signedIn = /(?:^|;\s*)(?:auth-token|login)=/.test(document.cookie);
      const s = { hasPlayer: !!p && !!v, ready: false, error: pageError(), kind, id: sourceId, signedIn };
      if (!p || !v) return s;

      const duration = call('getDuration');
      const state = call('getState');
      s.isLive = duration === Infinity;
      // Twitch's info card (hidden by page.css, still in the page): channel name, stream title, category.
      const name = text('[data-test-selector="stream-info-card-component__title-link"]') || text('[data-a-target="player-info-title"]');
      const headline = text('[data-test-selector="stream-info-card-component__subtitle"]');
      const category = text('[data-a-target="player-info-game-name"]');
      if (kind === 'channel') {
        s.title = name || params.get('channel') || '';
        s.subtitle = category || headline;
      } else if (kind === 'video') {
        s.title = headline || name;
        s.subtitle = headline ? name : '';
      } else {
        s.title = name;
        s.subtitle = '';
      }

      s.width = v.videoWidth;
      s.height = v.videoHeight;
      s.ready = v.readyState >= 1 && v.videoWidth > 0;
      s.paused = !!call('isPaused');
      s.ended = state === 'Ended';
      s.buffering = state === 'Buffering';
      s.time = s.isLive ? 0 : call('getPosition') || 0;
      s.duration = s.isLive || !Number.isFinite(duration) ? 0 : duration;
      // Live Twitch streams can't be rewound from the player, so there is no seekable range.
      s.seekStart = 0;
      s.seekEnd = s.duration;
      s.liveHead = s.isLive;
      s.buffered = 0;
      if (!s.isLive) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= s.time + 0.5 && v.buffered.end(i) >= s.time) s.buffered = v.buffered.end(i);
        }
      }
      s.rate = call('getPlaybackRate') || 1;
      s.rates = s.isLive ? [] : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      s.volume = call('getVolume');
      s.muted = !!call('isMuted');

      const current = call('getQuality') || {};
      const auto = call('isAutoQualityMode') !== false;
      s.qualities = qualities().map((q) => ({ key: q.group, label: q.name }));
      s.quality = current.group || '';
      s.qualityLabel = (current.name || '').replace(/\s*\(source\)/i, '');
      s.qualityPref = auto ? 'auto' : current.group || 'auto';

      s.captions = { available: false, on: false };
      s.ad = { showing: !!document.querySelector('[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"]'), skippable: false };
      s.chatAvailable = kind === 'channel' && s.isLive;
      s.gate = gateButton() ? 'This stream is marked for mature audiences.' : null;
      return s;
    }

    function tick() {
      if (instance && !document.contains(video())) instance = null; // the page rebuilt its player
      const p = player();
      if (!p) return;
      const state = call('getState');
      // Clips (and anything whose autoplay was held back) wait in "Ready": start them once.
      if (!kicked && state === 'Ready' && call('isPaused') && !gateButton()) {
        kicked = true;
        call('play');
      }
      if (state === 'Playing') kicked = true;
      if (!qualityApplied && desired.quality !== 'auto' && qualities().length) {
        qualityApplied = true;
        setQuality(desired.quality);
      }
    }

    const seekTo = (t) => {
      const duration = call('getDuration');
      if (typeof t !== 'number' || !Number.isFinite(duration)) return;
      call('seekTo', Math.min(Math.max(t, 0), Math.max(0, duration - 0.5)));
    };

    const commands = {
      play: () => call('play'),
      pause: () => call('pause'),
      toggle() {
        if (call('getState') === 'Ended') {
          call('seekTo', 0);
          call('play');
        } else if (call('isPaused')) call('play');
        else call('pause');
      },
      seek: seekTo,
      seekBy: (delta) => typeof delta === 'number' && seekTo((call('getPosition') || 0) + delta),
      seekFraction(f) {
        const duration = call('getDuration');
        if (Number.isFinite(duration)) seekTo(duration * Math.min(Math.max(f, 0), 0.999));
      },
      setRate: (r) => call('setPlaybackRate', r),
      setQuality,
      toggleCaptions() {},
      goLive: () => call('play'),
      skipAd() {},
      frame(dir) {
        if (!Number.isFinite(call('getDuration'))) return;
        call('pause');
        seekTo((call('getPosition') || 0) + (dir < 0 ? -1 : 1) / 30);
      },
      acceptGate() {
        const button = gateButton();
        if (button) button.click();
      },
    };

    return { video, snapshot, applyAudio, tick, commands };
  });
