// Runs on youtube.com and twitch.tv. Right-clicking a video's thumbnail or title shows Pane's
// own short menu instead of the browser's, with "Open in Pane" first (the browser won't let an
// extension put its item at the top of its own menu). Everything else is left alone:
//   - Shift + right-click always gives the browser's full menu.
//   - Anything that isn't a link to a video (including the player on a video's own page)
//     keeps its normal right-click.
// Built with createElement only: YouTube forbids innerHTML on its pages (Trusted Types).
(() => {
  const { playable, address } = globalThis.PaneLinks;

  // Cards a video sits in when the thing under the mouse isn't inside the link itself
  // (for instance the preview that starts playing when a thumbnail is hovered).
  const CARDS = [
    'ytd-video-preview', 'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer',
    'ytd-reel-item-renderer', 'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
  ].join(',');
  const CARD_LINKS = 'a[href*="/watch?v="], a[href*="/shorts/"], a[href*="/live/"]';

  /** The video link under the mouse, or null. */
  function videoLinkAt(target) {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest('a[href]');
    if (anchor) return playable(anchor.href);
    const card = target.closest(CARDS);
    const inCard = card && card.querySelector(CARD_LINKS);
    return inCard ? playable(inCard.href) : null;
  }

  const CSS = `
    :host { all: initial; }
    .menu {
      position: fixed; z-index: 2147483647; min-width: 248px; padding: 6px 0; margin: 0;
      font: 400 14px/1.2 system-ui, 'Segoe UI', sans-serif; letter-spacing: 0.01em;
      color: #f2f0f1; background: #231d20; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3);
      user-select: none; cursor: default; outline: none;
    }
    .item { display: flex; align-items: center; gap: 12px; height: 34px; padding: 0 28px 0 14px; white-space: nowrap; }
    .item .icon { flex: none; width: 18px; height: 18px; }
    .item.plain { padding-left: 44px; }
    .item.first { font-weight: 600; }
    .item.on { background: rgba(255, 255, 255, 0.1); }
    .rule { height: 1px; margin: 6px 0; background: rgba(255, 255, 255, 0.12); }
    .hint { padding: 5px 14px 3px 44px; font-size: 11.5px; color: rgba(242, 240, 241, 0.5); white-space: nowrap; }
    @media (prefers-color-scheme: light) {
      .menu { color: #1c1b1f; background: #fff; border-color: rgba(0, 0, 0, 0.14); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12); }
      .item.on { background: rgba(0, 0, 0, 0.07); }
      .rule { background: rgba(0, 0, 0, 0.1); }
      .hint { color: rgba(28, 27, 31, 0.55); }
    }
  `;

  const SVG = 'http://www.w3.org/2000/svg';
  /** Pane's mark: a rounded screen with a play triangle. */
  function paneIcon() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    const screen = document.createElementNS(SVG, 'rect');
    for (const [k, v] of Object.entries({ x: 2.6, y: 4.6, width: 18.8, height: 14.8, rx: 3.6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 })) screen.setAttribute(k, v);
    const play = document.createElementNS(SVG, 'path');
    play.setAttribute('d', 'M10 9.1v5.8a.6.6 0 0 0 .92.5l4.5-2.9a.6.6 0 0 0 0-1L10.92 8.6a.6.6 0 0 0-.92.5z');
    play.setAttribute('fill', 'currentColor');
    svg.append(screen, play);
    return svg;
  }

  let host = null; // the open menu's holder, if any

  function close() {
    if (!host) return;
    host.remove();
    host = null;
    for (const [type, fn, opts] of LISTENERS) window.removeEventListener(type, fn, opts);
  }
  // Clicking somewhere else closes the menu and, like a real menu, does nothing more:
  // without this the click would also land on the page (and open the video under it).
  function onOutsideDown(e) {
    if (e.target === host) return;
    close();
    if (e.button !== 0) return; // a right-click elsewhere simply opens the next menu
    const types = ['mousedown', 'pointerup', 'mouseup', 'click'];
    const done = () => types.forEach((type) => window.removeEventListener(type, swallow, true));
    function swallow(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'click') done();
    }
    swallow(e);
    types.forEach((type) => window.addEventListener(type, swallow, true));
    setTimeout(done, 2000);
  }

  const LISTENERS = [
    ['pointerdown', onOutsideDown, true],
    ['wheel', close, { capture: true, passive: true }],
    ['blur', close, false],
    ['resize', close, false],
    ['keydown', onKey, true],
  ];

  let items = [];
  let current = -1;
  function highlight(index) {
    current = index;
    items.forEach((it, i) => it.node.classList.toggle('on', i === index));
  }
  function onKey(e) {
    if (!host) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') highlight((current + 1) % items.length);
    else if (e.key === 'ArrowUp') highlight((current - 1 + items.length) % items.length);
    else if (e.key === 'Enter' && items[current]) run(items[current]);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function run(item) {
    close();
    item.run();
  }

  function open(link, x, y) {
    close();
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');

    const ask = (how) => () => chrome.runtime.sendMessage({ type: 'pane:open-link', how, url: link });
    const rows = [
      { label: 'Open in Pane', first: true, run: () => (location.href = address(link)) },
      null,
      { label: 'Open link in new tab', run: ask('tab') },
      { label: 'Open link in new window', run: ask('window') },
      { label: 'Open link in private window', run: ask('private') },
      null,
      { label: 'Copy link address', run: () => navigator.clipboard.writeText(link).catch(() => {}) },
    ];
    items = [];
    for (const row of rows) {
      if (!row) {
        const rule = document.createElement('div');
        rule.className = 'rule';
        menu.append(rule);
        continue;
      }
      const node = document.createElement('div');
      node.className = `item ${row.first ? 'first' : 'plain'}`;
      node.setAttribute('role', 'menuitem');
      if (row.first) node.append(paneIcon());
      node.append(document.createTextNode(row.label));
      const item = { node, run: row.run };
      const index = items.push(item) - 1;
      node.addEventListener('pointerenter', () => highlight(index));
      node.addEventListener('pointerleave', () => highlight(-1));
      // pointerup, so press-drag-release works like a real menu; the right button counts too.
      node.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        run(item);
      });
      menu.append(node);
    }
    const rule = document.createElement('div');
    rule.className = 'rule';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Shift + right-click for the full menu';
    menu.append(rule, hint);
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    menu.addEventListener('contextmenu', (e) => e.preventDefault());

    root.append(menu);
    document.documentElement.append(host);
    // Keep it on screen: flip to the other side of the mouse near the right or bottom edge.
    const box = menu.getBoundingClientRect();
    const left = x + box.width > innerWidth - 4 ? Math.max(4, x - box.width) : x;
    const top = y + box.height > innerHeight - 4 ? Math.max(4, y - box.height) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    highlight(-1);
    for (const [type, fn, opts] of LISTENERS) window.addEventListener(type, fn, opts);
  }

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (host && e.composedPath().includes(host)) return;
      close();
      if (e.shiftKey) return; // the browser's own menu
      const link = videoLinkAt(e.target);
      if (!link) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      open(link, e.clientX, e.clientY);
    },
    true,
  );
})();
