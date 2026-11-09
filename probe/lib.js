'use strict';
// Helpers for development probes (see README in this folder). Not shipped.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const out = process.env.PANE_PROBE_OUT || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  fs.appendFileSync(path.join(out, 'probe.log'), `${line}\n`);
}

// Probes run off-screen unless PANE_PROBE_SHOW=1 (see QUIET in src/main/player-window.js).
const QUIET = !process.env.PANE_PROBE_SHOW;
const pending = new Set();
let quitHooked = false;

/** Off-screen: save what each view drew (<name>.png = Pane's UI, <name>.page.png = the site's page). */
function shotViews(pw, name) {
  const { app } = require('electron');
  if (!quitHooked) {
    quitHooked = true;
    // Let screenshots that are still being written finish before the app goes away.
    app.on('before-quit', (event) => {
      if (!pending.size) return;
      event.preventDefault();
      Promise.allSettled([...pending]).then(() => app.quit());
    });
  }
  const save = (view, file) => {
    if (!view || view.webContents.isDestroyed()) return;
    const job = view.webContents
      .capturePage()
      .then((image) => fs.writeFileSync(file, image.toPNG()))
      .catch((err) => log('shot failed', name, err.message))
      .finally(() => pending.delete(job));
    pending.add(job);
  };
  save(pw.overlay, path.join(out, `${name}.png`));
  save(pw.page, path.join(out, `${name}.page.png`));
  return path.join(out, `${name}.png`);
}

/** Screenshot. On screen (PANE_PROBE_SHOW=1) it is the real, composited window as it appears. */
function shot(pw, name) {
  if (QUIET) return shotViews(pw, name);
  const { screen } = require('electron');
  const wasOnTop = pw.win.isAlwaysOnTop();
  pw.win.setAlwaysOnTop(true);
  const b = screen.dipToScreenRect(null, pw.win.getBounds()); // physical pixels
  const file = path.join(out, `${name}.png`);
  const script = `
$t = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);' -Name Dpi -Namespace PaneProbe -PassThru
[void]$t::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap ${b.width}, ${b.height}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${b.x}, ${b.y}, 0, 0, $bmp.Size)
$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
  } catch (err) {
    log('shot failed', name, err.message);
  }
  pw.win.setAlwaysOnTop(wasOnTop);
  return file;
}

async function waitFor(test, timeout = 20000, step = 250) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(step);
  }
  return false;
}

/** Show the hover UI as if the mouse were over the window (and keep it up for screenshots). */
function hover(pw, on = true) {
  return pw.overlay.webContents.executeJavaScript(
    `document.body.classList.toggle('ui', ${on}); document.body.classList.toggle('idle', ${!on}); 0`,
    true,
  );
}

function click(pw, x, y, clickCount = 1) {
  const wc = pw.overlay.webContents;
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount });
}

function key(pw, keyCode, modifiers = []) {
  const wc = pw.overlay.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

const inPage = (pw, js) => pw.page.webContents.executeJavaScript(js, true);
const inOverlay = (pw, js) => pw.overlay.webContents.executeJavaScript(js, true);

module.exports = { out, sleep, log, shot, waitFor, hover, click, key, inPage, inYouTube: inPage, inOverlay };
