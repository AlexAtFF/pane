'use strict';
// YouTube provider. Loads the real watch page and restyles it (page.css) so only
// the video shows; agent.js drives YouTube's own player from inside the page.

const fs = require('fs');
const path = require('path');
const { parse, watchUrl, ID } = require('./url');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

module.exports = {
  name: 'youtube',
  label: 'YouTube',
  parse,
  css: read('page.css'),
  agent: read('agent.js'),

  /** Page to open for a history entry / state id, optionally resuming at `time` seconds. */
  link: (id, time = 0) => (ID.test(id || '') ? watchUrl(id, time) : null),
  /** Short link for the clipboard. */
  shareLink: (id, time = 0) => (ID.test(id || '') ? `https://youtu.be/${id}${time > 0 ? `?t=${Math.floor(time)}` : ''}` : null),

  chatUrl: (state) => (state.isLive && state.chatAvailable && ID.test(state.id || '') ? `https://www.youtube.com/live_chat?is_popout=1&v=${state.id}` : null),
  chatPattern: /^https:\/\/www\.youtube\.com\/live_chat/,

  /** Thumbnail for history. Null would mean "grab a frame from the player instead". */
  thumbnail: (state) => (ID.test(state.id || '') ? `https://i.ytimg.com/vi/${state.id}/mqdefault.jpg` : null),

  messages: {
    missing: (source) => (source.kind === 'channel-live' ? "This channel isn't live right now." : "This link didn't open a video."),
    stalled: "This video isn't loading. It may be unavailable, or need you to sign in.",
  },

  account: {
    url: 'https://www.youtube.com',
    domain: 'youtube.com',
    cookie: 'LOGIN_INFO', // present only while signed in
    // Google refuses to show its sign-in page inside apps, so there is no in-app sign-in window;
    // the session is brought over from the user's browser instead (accounts.js importCookies).
    signInUrl: null,
    // Cookies the site marks HttpOnly. Everything else must stay readable by the page's own scripts.
    httpOnly: /^(SID|HSID|SSID|LOGIN_INFO|__Secure-[13]PSID(TS|CC)?|SIDCC|NID|VISITOR_PRIVACY_METADATA)$/,
    /** Ask YouTube itself whether the session is really signed in. */
    async verify(ses) {
      try {
        const res = await ses.fetch('https://www.youtube.com/', { credentials: 'include' });
        const html = await res.text();
        return /"LOGGED_IN"\s*:\s*true/.test(html);
      } catch {
        return null;
      }
    },
  },
};
