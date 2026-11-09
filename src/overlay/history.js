// Watch history inside the home panel: one tab per site, never mixed.
// Data comes from the main process (src/main/history.js) through pane.ask('history').

import { $, el, fmt } from './util.js';
import { icon } from './icons.js';

/** "just now", "5 min ago", "3 hr ago", "yesterday", "4 days ago", "12 Mar" */
function ago(timestamp) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`;
  const days = Math.round(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * @param {{pane: object, ctx: object, onOpen: () => void}} deps
 */
export function createHistory({ pane, ctx, onOpen }) {
  const tabsBox = $('#history .tabs');
  const listBox = $('.history-list');
  const clearButton = $('#history-clear');
  let tab = null;
  let request = 0;

  const labelOf = (name) => (ctx.cfg.providers.find((p) => p.name === name) || { label: name }).label;

  function renderTabs() {
    tabsBox.replaceChildren(
      ...ctx.cfg.providers.map((p) => {
        const button = el('button', `tab${p.name === tab ? ' active' : ''}`, p.label);
        button.type = 'button';
        button.tabIndex = -1;
        button.addEventListener('click', () => setTab(p.name));
        return button;
      }),
    );
  }

  function row(entry) {
    const node = el('div', 'h-row');
    const thumb = el('div', 'h-thumb');
    if (entry.thumb) {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', () => img.remove());
      img.src = entry.thumb;
      thumb.append(img);
    }
    const resumable = !entry.live && entry.duration > 0;
    if (entry.live && entry.kind !== 'channel') thumb.append(el('span', 'h-badge live', 'LIVE'));
    else if (entry.kind === 'clip') thumb.append(el('span', 'h-badge', 'Clip'));
    else if (resumable) thumb.append(el('span', 'h-badge', fmt(entry.duration)));
    if (resumable && entry.position > 5) {
      const bar = el('i', 'h-progress');
      bar.style.setProperty('--p', String(Math.min(1, entry.position / entry.duration)));
      thumb.append(bar);
    }

    const text = el('div', 'h-text');
    text.append(el('div', 'h-title', entry.title || 'Untitled'));
    const meta = [entry.subtitle, ago(entry.watchedAt)].filter(Boolean).join('  ·  ');
    text.append(el('div', 'h-meta', meta));

    const remove = el('button', 'btn h-remove');
    remove.type = 'button';
    remove.tabIndex = -1;
    remove.dataset.tip = 'Remove from history';
    remove.append(icon('close'));
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      pane.send('history:remove', { provider: tab, id: entry.id });
    });

    const open = (newWindow) => {
      pane.send('history:open', { provider: tab, id: entry.id, newWindow });
      if (!newWindow) onOpen();
    };
    node.addEventListener('click', (e) => open(e.shiftKey || e.ctrlKey));
    node.addEventListener('auxclick', (e) => {
      if (e.button === 1) open(true);
    });
    node.append(thumb, text, remove);
    return node;
  }

  async function refresh() {
    if (!tab) return;
    const mine = ++request;
    const entries = (await pane.ask('history', { provider: tab })) || [];
    if (mine !== request) return; // a newer request finished first
    clearButton.disabled = entries.length === 0;
    if (!entries.length) {
      listBox.replaceChildren(el('p', 'history-empty', `What you watch on ${labelOf(tab)} will be listed here.`));
      return;
    }
    const scroll = listBox.scrollTop;
    listBox.replaceChildren(...entries.map(row));
    listBox.scrollTop = scroll;
  }

  function setTab(name, { remember = true } = {}) {
    if (!ctx.cfg.providers.some((p) => p.name === name)) name = ctx.cfg.providers[0].name;
    const changed = name !== tab;
    tab = name;
    renderTabs();
    if (changed) listBox.scrollTop = 0;
    if (changed && remember) pane.send('history:tab', { provider: name });
    refresh();
  }

  clearButton.addEventListener('click', () => pane.send('history:clear', { provider: tab }));

  return {
    setTab,
    refresh,
    /** The main process says a site's history changed. */
    changed(provider) {
      if (provider === tab) refresh();
    },
    get tab() {
      return tab;
    },
  };
}
