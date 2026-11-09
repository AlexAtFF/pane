// Which addresses Pane can play, shared by background.js and content.js (and the node test).
// Mirrors the providers' url.js in the app; `node probe/extension-test.js` checks they agree.
(() => {
  // First path segments on twitch.tv that are site pages, not channels (same list as Pane's).
  const NOT_CHANNELS = new Set([
    'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'downloads', 'jobs',
    'turbo', 'p', 'search', 'store', 'prime', 'privacy', 'legal', 'friends', 'following', 'login', 'signup',
    'popout', 'moderator', 'u', 'embed', 'team', 'event', 'events', 'collections', 'products', 'bits',
    'partner', 'payments', 'annual-recap', 'creatorcamp', 'broadcast', 'dashboard', 'messages', 'user',
  ]);

  /** The address if Pane can play it, else null. Pane checks again; this only avoids pointless launches. */
  function playable(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|music|gaming|go)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(parts[0] || '') ? u.href : null;
    if (host === 'youtube.com') {
      if (u.pathname === '/watch') return /^[\w-]{11}$/.test(u.searchParams.get('v') || '') ? u.href : null;
      if (/^(shorts|live|embed)$/.test(parts[0] || '') && /^[\w-]{11}$/.test(parts[1] || '')) return u.href;
      if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/.test(u.pathname)) return u.href;
      return null;
    }
    if (host === 'clips.twitch.tv') return parts[0] && parts[0] !== 'embed' ? u.href : null;
    if (host === 'twitch.tv') {
      if (parts[0] === 'videos') return /^\d+$/.test(parts[1] || '') ? u.href : null;
      if (parts[0] && /^[a-zA-Z0-9][a-zA-Z0-9_]{2,24}$/.test(parts[0]) && !NOT_CHANNELS.has(parts[0].toLowerCase())) return u.href;
    }
    return null;
  }

  /** "1h2m3s", the form both sites accept in a link. */
  function stamp(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    return `${Math.floor(t / 3600)}h${Math.floor((t % 3600) / 60)}m${t % 60}s`;
  }

  /** Carry the position of a video that is already playing in the browser over to Pane. */
  function withTime(link, seconds) {
    if (!(seconds > 5)) return link;
    const u = new URL(link);
    const twitchLive = /(^|\.)twitch\.tv$/.test(u.hostname) && !/\/videos\//.test(u.pathname);
    if (twitchLive) return link;
    u.searchParams.set('t', stamp(seconds));
    return u.href;
  }

  /** What the installed Pane listens for (LINK_SCHEME in the app's main.js). */
  const address = (link) => `pane://open?url=${encodeURIComponent(link)}`;

  const api = { playable, withTime, stamp, address };
  globalThis.PaneLinks = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
