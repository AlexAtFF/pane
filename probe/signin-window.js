'use strict';
// Probe: does the Twitch sign-in window open on Twitch's login page? (It does not sign in.)
const path = require('path');
const { BrowserWindow } = require('electron');
const { sleep, log } = require('./lib');

module.exports = async ({ app, manager }) => {
  try {
    await sleep(1000);
    manager.signIn('twitch'); // resolves when the window closes
    await sleep(9000);
    const win = BrowserWindow.getAllWindows().find((w) => /Sign in|Twitch|Log In/i.test(w.getTitle()));
    if (!win) {
      log('no sign-in window found', BrowserWindow.getAllWindows().map((w) => w.getTitle()));
    } else {
      const info = await win.webContents.executeJavaScript(`JSON.stringify({ url: location.href, title: document.title, hasLoginField: !!document.querySelector('#login-username, input[autocomplete="username"]'), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200) })`);
      log('sign-in window', info);
      require('fs').writeFileSync(path.join(process.env.PANE_PROBE_OUT, 'twitch-login.png'), (await win.webContents.capturePage()).toPNG());
      win.close();
    }
    await sleep(800);
    log('accounts after', manager.accounts);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
