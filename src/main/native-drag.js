'use strict';
// Lets you grab a window by the video itself. On Windows this starts a real
// system move (so Snap, snap layouts and edge docking all work) by sending the
// same message a title bar would. If the native helper can't load, we fall back
// to moving the window by hand, which works everywhere but doesn't snap.

const { screen } = require('electron');

let user32 = null;
let dwmSet = null;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    user32 = {
      ReleaseCapture: lib.func('int __stdcall ReleaseCapture()'),
      PostMessageW: lib.func('int __stdcall PostMessageW(uintptr_t hWnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)'),
    };
    dwmSet = koffi
      .load('dwmapi.dll')
      .func('int __stdcall DwmSetWindowAttribute(uintptr_t hWnd, uint32_t attribute, const uint32_t *value, uint32_t size)');
  } catch (err) {
    console.warn('[native] Windows helpers unavailable, using fallbacks:', err.message);
  }
}

function hwndOf(win) {
  const handle = win.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
}

/** Windows 11 draws a 1px outline around every window; a video looks better without it. */
function styleWindow(win, { rounded = true } = {}) {
  if (!dwmSet) return;
  try {
    dwmSet(hwndOf(win), 34 /* border colour */, [0xfffffffe /* none */], 4);
    dwmSet(hwndOf(win), 33 /* corner preference */, [rounded ? 2 : 1], 4);
  } catch (err) {
    console.warn('[native] could not style window:', err.message);
  }
}

const WM_SYSCOMMAND = 0x0112;
const SC_MOVE_BY_CAPTION = 0xf012;

const manual = new WeakMap();

function start(win) {
  if (win.isFullScreen()) return;
  if (user32) {
    user32.ReleaseCapture();
    user32.PostMessageW(hwndOf(win), WM_SYSCOMMAND, SC_MOVE_BY_CAPTION, 0);
    return;
  }
  if (win.isMaximized()) return;
  stop(win);
  const origin = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  const timer = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(timer);
    const p = screen.getCursorScreenPoint();
    win.setBounds({ ...bounds, x: bounds.x + p.x - origin.x, y: bounds.y + p.y - origin.y });
  }, 8);
  manual.set(win, timer);
}

function stop(win) {
  const timer = manual.get(win);
  if (timer) clearInterval(timer);
  manual.delete(win);
}

module.exports = { start, stop, styleWindow, isNative: () => !!user32 };
