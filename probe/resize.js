'use strict';
// Probe: resizing by an edge keeps the middle of the opposite edge where it was, resizing by
// a corner keeps the opposite corner. Sends the window the same WM_SIZING messages Windows
// sends while an edge is dragged (no real mouse needed) and logs where the window ended up.
const { screen } = require('electron');
const { sleep, log } = require('./lib');

const WM_SIZING = 0x0214;
const WM_EXITSIZEMOVE = 0x0232;
const EDGES = { left: 1, right: 2, top: 3, 'top-left': 4, 'top-right': 5, bottom: 6, 'bottom-left': 7, 'bottom-right': 8 };

module.exports = async ({ app, manager }) => {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    koffi.struct('PROBE_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const sendRect = user32.func('intptr_t __stdcall SendMessageW(uintptr_t hWnd, uint32_t msg, uintptr_t wParam, _Inout_ PROBE_RECT *lParam)');
    const send = user32.func('intptr_t __stdcall SendMessageW(uintptr_t hWnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)');

    const pw = manager.activeWindow();
    await sleep(1200);
    const handle = pw.win.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
    const results = [];

    const run = (edge, grow) => {
      const before = pw.win.getBounds();
      // Three steps of one drag, the dragged edge moving `grow` DIPs further each time.
      for (let step = 1; step <= 3; step++) {
        const cur = pw.win.getBounds();
        const want = { ...cur };
        const d = grow * step;
        // Windows proposes: the dragged edge(s) follow the mouse, the others stay where the window is.
        if (edge.includes('left')) {
          want.x = before.x - d;
          want.width = cur.x + cur.width - want.x;
        }
        if (edge.includes('right')) want.width = before.x + before.width + d - cur.x;
        if (edge.includes('top')) {
          want.y = before.y - d;
          want.height = cur.y + cur.height - want.y;
        }
        if (edge.includes('bottom')) want.height = before.y + before.height + d - cur.y;
        const px = screen.dipToScreenRect(pw.win, want);
        sendRect(hwnd, WM_SIZING, EDGES[edge], { left: px.x, top: px.y, right: px.x + px.width, bottom: px.y + px.height });
      }
      send(hwnd, WM_EXITSIZEMOVE, 0, 0);
      const after = pw.win.getBounds();
      const mid = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      const r = {
        edge,
        grow,
        size: `${before.width}x${before.height} -> ${after.width}x${after.height}`,
        ratio: +(after.width / after.height).toFixed(4),
        // How far each reference point moved; the anchored ones should read ~0.
        moved: {
          left: after.x - before.x,
          right: after.x + after.width - (before.x + before.width),
          top: after.y - before.y,
          bottom: after.y + after.height - (before.y + before.height),
          midX: +(mid(after).x - mid(before).x).toFixed(1),
          midY: +(mid(after).y - mid(before).y).toFixed(1),
        },
      };
      results.push(r);
      log('resize', r);
    };

    for (const edge of Object.keys(EDGES)) {
      run(edge, 40);
      await sleep(150);
      run(edge, -30);
      await sleep(150);
    }

    const near = (v) => Math.abs(v) <= 2; // a pixel or two of rounding at fractional display scaling
    const ok = results.every((r) => {
      const m = r.moved;
      const e = r.edge;
      const horizontal = e.includes('left') ? near(m.right) : e.includes('right') ? near(m.left) : near(m.midX);
      const vertical = e.includes('top') ? near(m.bottom) : e.includes('bottom') ? near(m.top) : near(m.midY);
      const [was, is] = r.size.split(' -> ');
      return horizontal && vertical && was !== is && Math.abs(r.ratio - 16 / 9) < 0.02;
    });
    log('resize anchors ok', ok);
  } catch (err) {
    log('probe error', String(err && err.stack ? err.stack : err));
  }
  app.quit();
};
