'use strict';
// Watch history: one list per provider, newest first, never mixed.
// Stored in history.json (see store.js for the persistence contract).
//
// Entry: { id, kind, title, subtitle, live, duration, position, watchedAt, thumb }
//   id        the provider's key (YouTube video id, "channel:name", "video:123", "clip:slug")
//   position  where playback was, in seconds (used to resume recordings)
//   thumb     a remote image address, or "file:<name>" for a frame saved in thumbnails/

const { protocol, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const store = require('./store');
const providers = require('./providers');
const config = require('./config');

const FILE = 'history.json';
const VERSION = 1;
const THUMBS = path.join(store.DATA_DIR, 'thumbnails');
const THUMB_NAME = /^[a-f0-9]{20}\.jpg$/;

const events = new EventEmitter();
let data = null;
let saveTimer = null;

function migrate(raw) {
  const out = { version: VERSION };
  // v1 is the first format. Future versions: transform `raw` step by step here.
  for (const name of providers.names) out[name] = raw && Array.isArray(raw[name]) ? raw[name].filter((e) => e && typeof e.id === 'string') : [];
  // Keep lists for providers this build doesn't know (e.g. after a downgrade).
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) if (!(key in out) && Array.isArray(value)) out[key] = value;
  }
  return out;
}

function load() {
  data = migrate(store.readJson(FILE, null));
  try {
    fs.mkdirSync(THUMBS, { recursive: true });
  } catch {}
  // Lets the overlay show saved frames:  <img src="pane-thumb://local/<name>">
  protocol.handle('pane-thumb', (request) => {
    const name = path.basename(new URL(request.url).pathname);
    if (!THUMB_NAME.test(name)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(THUMBS, name)).toString());
  });
}

function save(soon = true) {
  clearTimeout(saveTimer);
  if (soon) saveTimer = setTimeout(() => store.writeJson(FILE, data), 1500);
  else store.writeJson(FILE, data);
}

const listOf = (provider) => (data && data[provider]) || [];
const thumbFile = (provider, id) => `${crypto.createHash('sha1').update(`${provider}:${id}`).digest('hex').slice(0, 20)}.jpg`;

function dropThumb(entry) {
  if (entry && typeof entry.thumb === 'string' && entry.thumb.startsWith('file:')) {
    fs.rm(path.join(THUMBS, entry.thumb.slice(5)), { force: true }, () => {});
  }
}

/** Entries for the overlay, with thumbnails as addresses an <img> can load. */
function list(provider) {
  return listOf(provider).map((e) => ({
    ...e,
    thumb: typeof e.thumb === 'string' && e.thumb.startsWith('file:') ? `pane-thumb://local/${e.thumb.slice(5)}?t=${e.thumbAt || 0}` : e.thumb || null,
  }));
}

const find = (provider, id) => listOf(provider).find((e) => e.id === id) || null;

/** Record that something is being watched (moves it to the top) and update what we know about it. */
function touch(provider, info, { bump = false } = {}) {
  if (!data || !data[provider] || !info || !info.id) return null;
  const items = data[provider];
  const index = items.findIndex((e) => e.id === info.id);
  const entry = index >= 0 ? items[index] : { id: info.id, watchedAt: Date.now() };
  for (const key of ['kind', 'title', 'subtitle', 'live', 'duration', 'position', 'thumb']) {
    if (info[key] !== undefined && info[key] !== null && info[key] !== '') entry[key] = info[key];
  }
  const isNew = index < 0;
  if (isNew || bump) {
    entry.watchedAt = Date.now();
    if (!isNew) items.splice(index, 1);
    items.unshift(entry);
    const max = Math.max(20, Number(config.get().history.maxPerSite) || 400);
    for (const old of items.splice(max)) dropThumb(old);
  }
  save();
  if (isNew || bump) events.emit('change', provider);
  return entry;
}

function saveThumb(provider, id, image) {
  const entry = find(provider, id);
  if (!entry || !image || image.isEmpty()) return;
  try {
    const size = image.getSize();
    if (size.width < 16 || size.height < 16) return;
    const small = image.resize({ width: 320, quality: 'good' });
    const name = thumbFile(provider, id);
    fs.writeFile(path.join(THUMBS, name), small.toJPEG(74), (err) => {
      if (err) return;
      entry.thumb = `file:${name}`;
      entry.thumbAt = Date.now();
      save();
      events.emit('change', provider);
    });
  } catch {}
}

function remove(provider, id) {
  const items = listOf(provider);
  const index = items.findIndex((e) => e.id === id);
  if (index < 0) return;
  dropThumb(items[index]);
  items.splice(index, 1);
  save();
  events.emit('change', provider);
}

function clear(provider) {
  for (const entry of listOf(provider)) dropThumb(entry);
  if (data && data[provider]) data[provider] = [];
  save(false);
  events.emit('change', provider);
}

module.exports = {
  load,
  list,
  find,
  touch,
  saveThumb,
  remove,
  clear,
  flush: () => data && save(false),
  onChange: (fn) => events.on('change', fn),
};
