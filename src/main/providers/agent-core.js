// Runs INSIDE the site's page (main world), injected before the provider's own agent.js.
// This is the half every provider shares: it reports state to Pane and receives
// commands. The provider's agent.js supplies an "adapter" that knows the site:
//
//   window.__paneAgentStart((kit) => ({
//     video()        the <video> element, or null
//     snapshot()     the state object sent to Pane (see providers/README in CLAUDE.md)
//     applyAudio()   make the player match kit.desired.volume / kit.desired.muted
//     commands       { play, pause, toggle, seek, seekBy, setQuality, ... }
//     tick()         optional, runs once a second
//     onBind(video)  optional, runs when a (new) <video> element appears
//   }));
//
//   state out:    window.__paneBridge.post(state)      (providers/preload.js)
//   commands in:  window.__paneAgent.cmd(name, arg)
(() => {
  if (window.__paneAgent || window.__paneAgentStart) return;
  const bridge = window.__paneBridge;
  if (!bridge) return;

  const EVENTS = [
    'loadedmetadata', 'durationchange', 'canplay', 'play', 'playing', 'pause', 'waiting', 'seeking',
    'seeked', 'ended', 'volumechange', 'ratechange', 'resize', 'progress', 'timeupdate', 'emptied',
  ];
  const own = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  window.__paneAgentStart = (makeAdapter) => {
    if (window.__paneAgent) return;

    // What this window wants, regardless of what the site remembers from elsewhere.
    const desired = { volume: null, muted: null, quality: 'auto', blockAds: false };
    let boundVideo = null;
    let pushTimer = null;
    let lastPush = 0;

    function push() {
      lastPush = Date.now();
      clearTimeout(pushTimer);
      pushTimer = null;
      try {
        bridge.post(adapter.snapshot());
      } catch {}
    }

    // Coalesce bursts of events; never report more than ~5x a second.
    function schedule() {
      if (pushTimer) return;
      pushTimer = setTimeout(push, Math.max(0, 200 - (Date.now() - lastPush)));
    }

    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';

    const adapter = makeAdapter({ desired, push, schedule, shown });

    const applyAudio = () => {
      try {
        adapter.applyAudio();
      } catch {}
    };

    function bind() {
      const v = adapter.video();
      if (!v || v === boundVideo) return;
      boundVideo = v;
      for (const name of EVENTS) v.addEventListener(name, schedule);
      v.addEventListener('loadedmetadata', applyAudio);
      if (adapter.onBind) adapter.onBind(v);
      applyAudio();
    }

    // When the window is (almost) exactly the video's shape, let the picture cover
    // the last pixel of rounding instead of leaving a hairline bar (see page.css).
    function fit() {
      const v = adapter.video();
      if (!v || !v.videoWidth || !window.innerHeight) return;
      const mismatch = Math.abs(window.innerWidth / window.innerHeight / (v.videoWidth / v.videoHeight) - 1);
      document.documentElement.classList.toggle('pane-cover', mismatch < 0.012);
    }
    window.addEventListener('resize', fit);

    function housekeeping() {
      try {
        bind();
        fit();
        if (adapter.tick) adapter.tick();
      } catch {}
      schedule();
    }

    const common = {
      setVolume(x) {
        desired.volume = Math.min(Math.max(+x || 0, 0), 1);
        if (desired.volume > 0 && desired.muted) desired.muted = false;
        applyAudio();
      },
      setMuted(flag) {
        desired.muted = !!flag;
        applyAudio();
      },
    };

    window.__paneAgent = {
      push,
      cmd(name, arg) {
        const fn = own(adapter.commands, name) ? adapter.commands[name] : own(common, name) ? common[name] : null;
        try {
          if (fn) fn(arg);
        } catch {}
        setTimeout(push, 30);
      },
      configure(opts) {
        if (!opts) return;
        if (typeof opts.volume === 'number') desired.volume = opts.volume;
        if (typeof opts.muted === 'boolean') desired.muted = opts.muted;
        if (typeof opts.quality === 'string') desired.quality = opts.quality;
        if (typeof opts.blockAds === 'boolean') desired.blockAds = opts.blockAds;
        applyAudio();
      },
    };

    setInterval(housekeeping, 1000);
    housekeeping();
  };
})();
