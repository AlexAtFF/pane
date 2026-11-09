'use strict';
// Twitch provider. Loads Twitch's stand-alone player page (player.twitch.tv, or
// clips.twitch.tv/embed for clips), hides Twitch's own controls (page.css), and
// drives Twitch's player object from inside the page (agent.js).

const fs = require('fs');
const path = require('path');
const { parse, hms, LOGIN, SLUG } = require('./url');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

/** "channel:xqc" -> ['channel', 'xqc'] */
const split = (id) => {
  const i = String(id || '').indexOf(':');
  return i < 0 ? ['', ''] : [id.slice(0, i), id.slice(i + 1)];
};

function link(id, time = 0) {
  const [kind, value] = split(id);
  if (kind === 'channel' && LOGIN.test(value)) return `https://www.twitch.tv/${value}`;
  if (kind === 'video' && /^\d+$/.test(value)) return `https://www.twitch.tv/videos/${value}${time > 0 ? `?t=${hms(time)}` : ''}`;
  if (kind === 'clip' && SLUG.test(value)) return `https://clips.twitch.tv/${value}`;
  return null;
}

module.exports = {
  name: 'twitch',
  label: 'Twitch',
  parse,
  css: read('page.css'),
  agent: read('agent.js'),

  link,
  shareLink: link,

  chatUrl(state) {
    const [kind, login] = split(state.id);
    return kind === 'channel' && state.isLive && LOGIN.test(login) ? `https://www.twitch.tv/popout/${login}/chat?darkpopout` : null;
  },
  chatPattern: /^https:\/\/www\.twitch\.tv\/popout\//,

  // Twitch has no stable thumbnail address for a channel or broadcast, so history uses a frame from the player.
  thumbnail: () => null,

  messages: {
    missing: (source) => (source.kind === 'channel' ? "This channel didn't load. Check the name in the link." : "This link didn't open a video."),
    stalled: "This isn't loading. The channel may be offline, or the video may need you to sign in.",
  },

  // Ad blocking (src/main/adblock.js). Twitch splices ads into the stream itself, so there
  // is nothing to hide: vendor/vaft.js (TwitchAdSolutions, MIT, bundled unchanged) watches
  // the stream's playlist and, when an ad break starts, swaps in an ad-free copy of the same
  // stream. It runs in Twitch's page before Twitch's own scripts.
  adblock: {
    hosts: /(^|\.)twitch\.tv$/,
    script: read(path.join('vendor', 'vaft.js')),
  },

  account: {
    url: 'https://www.twitch.tv',
    domain: 'twitch.tv',
    cookie: 'auth-token', // present only while signed in
    signInUrl: 'https://www.twitch.tv/login',
    signedInHost: 'www.twitch.tv',
    httpOnly: null, // Twitch's scripts read their own cookies
    verify: null,
  },
};
