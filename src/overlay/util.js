// Small DOM and math helpers shared by the overlay modules.

export const $ = (selector, root = document) => root.querySelector(selector);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** 75 -> "1:15", 3675 -> "1:01:15" */
export function fmt(seconds) {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Calls fn at most once per `ms`, always delivering the latest arguments. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(...pending);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...pending);
      }, wait);
    }
  };
}

/**
 * Turns an element into a horizontal slider. Handlers receive a 0..1 fraction.
 * @param {HTMLElement} node
 * @param {{start?: Function, move?: Function, end?: Function}} handlers
 */
export function dragFraction(node, handlers) {
  const fraction = (e) => {
    const r = node.getBoundingClientRect();
    return r.width ? clamp((e.clientX - r.left) / r.width, 0, 1) : 0;
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    node.classList.add('dragging');
    if (handlers.start) handlers.start(fraction(e), e);
    if (handlers.move) handlers.move(fraction(e), e);
    const move = (ev) => handlers.move && handlers.move(fraction(ev), ev);
    const up = (ev) => {
      node.classList.remove('dragging');
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      if (handlers.end) handlers.end(fraction(ev), ev);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
  return fraction;
}
