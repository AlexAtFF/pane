'use strict';
// Turns a pasted Twitch link into a "source" (see providers/index.js).
// Channels, past broadcasts (videos) and clips are supported.

const LOGIN = /^[a-zA-Z0-9][a-zA-Z0-9_]{2,24}$/;
const SLUG = /^[A-Za-z0-9_-]{4,120}$/;

// First path segments on twitch.tv that are site pages, not channels.
const RESERVED = new Set([
  'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'downloads', 'jobs',
  'turbo', 'p', 'search', 'store', 'prime', 'privacy', 'legal', 'friends', 'following', 'login', 'signup',
  'popout', 'moderator', 'u', 'embed', 'team', 'event', 'events', 'collections', 'products', 'bits',
  'partner', 'payments', 'annual-recap', 'creatorcamp', 'broadcast', 'dashboard', 'messages', 'user',
]);

function seconds(value) {
  if (!value) return 0;
  if (/^\d+s?$/.test(value)) return parseInt(value, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function hms(total) {
  const t = Math.max(0, Math.floor(total));
  return `${Math.floor(t / 3600)}h${Math.floor((t % 3600) / 60)}m${t % 60}s`;
}

// Twitch's own stand-alone player page: the video and nothing else.
const PLAYER = 'https://player.twitch.tv/?parent=twitch.tv&autoplay=true';

const channel = (login) => {
  const name = login.toLowerCase();
  return { provider: 'twitch', kind: 'channel', id: `channel:${name}`, url: `${PLAYER}&channel=${name}` };
};
const video = (id, t = 0) => ({
  provider: 'twitch',
  kind: 'video',
  id: `video:${id}`,
  url: `${PLAYER}&video=${id}${t > 0 ? `&time=${hms(t)}` : ''}`,
});
const clip = (slug) => ({
  provider: 'twitch',
  kind: 'clip',
  id: `clip:${slug}`,
  url: `https://clips.twitch.tv/embed?clip=${slug}&parent=twitch.tv&autoplay=true`,
});

function parse(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text)) {
    if (!/^([\w-]+\.)?twitch\.tv\//i.test(text)) return null;
    text = `https://${text}`;
  }
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|go)\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  const q = u.searchParams;
  const t = seconds(q.get('t') || q.get('time'));

  if (host === 'clips.twitch.tv') {
    const slug = segs[0] === 'embed' ? q.get('clip') : segs[0];
    return slug && SLUG.test(slug) ? clip(slug) : null;
  }
  if (host === 'player.twitch.tv') {
    if (q.get('channel') && LOGIN.test(q.get('channel'))) return channel(q.get('channel'));
    const id = (q.get('video') || '').replace(/^v/, '');
    if (/^\d+$/.test(id)) return video(id, t);
    return null;
  }
  if (host !== 'twitch.tv') return null;

  if (segs[0] === 'videos' && /^\d+$/.test(segs[1] || '')) return video(segs[1], t);
  if (segs.length >= 3 && segs[1] === 'clip' && SLUG.test(segs[2])) return clip(segs[2]);
  if (segs.length >= 3 && (segs[1] === 'v' || segs[1] === 'video') && /^\d+$/.test(segs[2])) return video(segs[2], t);
  if (segs.length >= 1 && LOGIN.test(segs[0]) && !RESERVED.has(segs[0].toLowerCase())) return channel(segs[0]);
  return null;
}

module.exports = { parse, hms, LOGIN, SLUG };
