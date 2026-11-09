'use strict';
// Turns anything the user might paste into a YouTube "source" (see providers/index.js).

const ID = /^[\w-]{11}$/;

function parseTime(value) {
  if (!value) return 0;
  if (/^\d+s?$/.test(value)) return parseInt(value, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function watchUrl(id, t = 0) {
  return `https://www.youtube.com/watch?v=${id}${t > 0 ? `&t=${Math.floor(t)}s` : ''}`;
}

function watch(id, t = 0) {
  return { provider: 'youtube', kind: 'video', id, url: watchUrl(id, t) };
}

function parse(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  if (ID.test(text) && /[\d_-]|[a-z][A-Z]|[A-Z][a-z]/.test(text)) return watch(text);
  if (!/^https?:\/\//i.test(text)) {
    if (!/^([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(text)) return null;
    text = `https://${text}`;
  }
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music|gaming)\./, '');
  const t = parseTime(u.searchParams.get('t') || u.searchParams.get('start'));
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const p = u.pathname;
    const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})(?:\/|$)/.exec(p);
    if (p === '/watch') id = u.searchParams.get('v');
    else if (m) id = m[1];
    else if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/.test(p)) {
      // "whatever this channel is streaming right now"; the real video id arrives from the page
      return { provider: 'youtube', kind: 'channel-live', id: null, url: `https://www.youtube.com${p.replace(/\/$/, '')}` };
    }
  } else {
    return null;
  }
  return id && ID.test(id) ? watch(id, t) : null;
}

module.exports = { parse, watchUrl, ID };
