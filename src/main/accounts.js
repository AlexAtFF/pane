'use strict';
// Sign-ins. Every site shares one browser session, so signing in once covers
// every window and survives restarts and updates.
//
// Two ways to get signed in:
//   signIn(provider)          opens the site's own sign-in page in a window (Twitch).
//   importCookies(provider)   brings an existing browser session over. This is the
//                             only route for YouTube: Google deliberately refuses to
//                             show its sign-in page inside apps, and Pane does not
//                             try to get around that.

const { app, session, BrowserWindow } = require('electron');

// Historical name; it holds every provider's cookies, not just YouTube's.
// NEVER rename it: the sign-ins are stored under this name.
const PARTITION = 'persist:youtube';
let configured = null;

// Sites pick their layout from the user agent; without the Electron token they serve the normal desktop site.
function cleanUserAgent(ua) {
  return ua.replace(/\s(Electron|pane|Pane)\/[^\s]+/g, '');
}

function getSession() {
  if (configured) return configured;
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  // The sites need none of these (notifications, location, camera...).
  ses.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  configured = ses;
  return ses;
}

async function isSignedIn(provider) {
  try {
    const cookies = await getSession().cookies.get({ url: provider.account.url, name: provider.account.cookie });
    return cookies.length > 0;
  } catch {
    return false;
  }
}

const signInWindows = new Map();

/** Opens the site's own sign-in page. The user types their details there; Pane never sees them. */
function signIn(provider) {
  const { signInUrl, signedInHost } = provider.account;
  if (!signInUrl) return Promise.resolve(false);
  const open = signInWindows.get(provider.name);
  if (open) {
    open.focus();
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 780,
      title: `Sign in to ${provider.label}`,
      autoHideMenuBar: true,
      backgroundColor: '#18181b',
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
    });
    signInWindows.set(provider.name, win);
    win.setMenu(null);
    let done = false;
    const check = async () => {
      if (done || win.isDestroyed()) return;
      let url = null;
      try {
        url = new URL(win.webContents.getURL());
      } catch {}
      if (url && url.hostname === signedInHost && !/^\/(login|signup)/.test(url.pathname) && (await isSignedIn(provider))) {
        done = true;
        win.close();
      }
    };
    win.webContents.on('did-navigate', check);
    win.webContents.on('did-navigate-in-page', check);
    win.webContents.on('did-finish-load', check);
    const poll = setInterval(check, 1500);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', async () => {
      clearInterval(poll);
      signInWindows.delete(provider.name);
      resolve(await isSignedIn(provider));
    });
    win.loadURL(signInUrl);
  });
}

/** Removes only this site's cookies and stored data. */
async function signOut(provider) {
  const ses = getSession();
  const { domain } = provider.account;
  const cookies = await ses.cookies.get({});
  for (const c of cookies) {
    const host = String(c.domain || '').replace(/^\./, '');
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    try {
      await ses.cookies.remove(`https://${host}${c.path || '/'}`, c.name);
    } catch {}
  }
  for (const origin of [provider.account.url, `https://${domain}`]) {
    try {
      await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    } catch {}
  }
}

// ---- bringing a session over from the user's browser ------------------------------------

/** Accepts a copied Cookie header, a cookies.txt (Netscape) file, or a JSON cookie export. */
function parseCookies(text, domain) {
  const input = String(text || '').trim();
  const inDomain = (d) => {
    const host = String(d || '').replace(/^\./, '').toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  };
  const out = [];

  if (input.startsWith('[')) {
    try {
      for (const c of JSON.parse(input)) {
        if (c && c.name && inDomain(c.domain)) {
          out.push({ name: String(c.name), value: String(c.value || ''), path: c.path || '/', httpOnly: !!c.httpOnly, expires: Number(c.expirationDate) || 0, hostOnly: !!c.hostOnly });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  const lines = input.split(/\r?\n/);
  if (lines.some((line) => line.split('\t').length >= 7)) {
    for (let line of lines) {
      let httpOnly = false;
      if (line.startsWith('#HttpOnly_')) {
        httpOnly = true;
        line = line.slice(10);
      } else if (line.startsWith('#')) continue;
      const f = line.split('\t');
      if (f.length < 7 || !inDomain(f[0])) continue;
      out.push({ name: f[5], value: f[6], path: f[2] || '/', httpOnly, expires: Number(f[4]) || 0, hostOnly: !f[0].startsWith('.') && f[1] !== 'TRUE' });
    }
    return out;
  }

  // A raw Cookie header:  "name=value; name2=value2"
  const header = input.replace(/^cookie:\s*/i, '').replace(/\r?\n/g, '');
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!/^[\w!#$%&'*+.^`|~-]+$/.test(name)) continue;
    out.push({ name, value, path: '/', httpOnly: null, expires: 0, hostOnly: false });
  }
  return out;
}

/**
 * @returns {Promise<{ok: boolean, count: number, signedIn: boolean|null, error?: string}>}
 */
async function importCookies(provider, text) {
  const ses = getSession();
  const { url, domain, httpOnly } = provider.account;
  if (String(text || '').length > 2_000_000) return { ok: false, count: 0, signedIn: false, error: 'That is too much text to be a cookie list.' };
  const cookies = parseCookies(text, domain);
  if (!cookies.length) return { ok: false, count: 0, signedIn: false, error: `No ${provider.label} cookies found in that text.` };
  const yearAhead = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  let count = 0;
  for (const c of cookies) {
    const hostOnly = c.hostOnly || c.name.startsWith('__Host-');
    const details = {
      url,
      name: c.name,
      value: c.value,
      path: c.name.startsWith('__Host-') ? '/' : c.path,
      secure: true,
      httpOnly: c.httpOnly === null ? !!(httpOnly && httpOnly.test(c.name)) : c.httpOnly,
      sameSite: 'no_restriction',
      expirationDate: c.expires > Date.now() / 1000 ? c.expires : yearAhead,
    };
    if (!hostOnly) details.domain = `.${domain}`;
    try {
      await ses.cookies.set(details);
      count += 1;
    } catch {}
  }
  await ses.cookies.flushStore().catch(() => {});
  let signedIn = await isSignedIn(provider);
  if (signedIn && provider.account.verify) {
    const verified = await provider.account.verify(ses);
    if (verified !== null) signedIn = verified;
  }
  return { ok: count > 0 && signedIn, count, signedIn };
}

app.userAgentFallback = cleanUserAgent(app.userAgentFallback);

module.exports = { PARTITION, getSession, isSignedIn, signIn, signOut, importCookies, parseCookies };
