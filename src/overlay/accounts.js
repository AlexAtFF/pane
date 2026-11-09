// The Accounts panel: sign-in state per site, and bringing a sign-in over from
// the user's browser (needed for YouTube, where Google refuses in-app sign-in).
// The actual work happens in src/main/accounts.js.

import { el } from './util.js';

function button(label, className, onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * @param {{pane: object, ctx: object, modal: {open: Function, close: Function, kind: Function}, toast: Function}} deps
 */
export function createAccounts({ pane, ctx, modal, toast }) {
  let view = { name: 'list' };

  function listView() {
    const nodes = [el('h2', '', 'Accounts')];
    nodes.push(el('p', '', 'Signing in gets you your subscriptions and perks, such as no ads with YouTube Premium or Twitch Turbo.'));
    for (const p of ctx.cfg.providers) {
      const signedIn = !!ctx.accounts[p.name];
      const item = el('div', 'acct');
      item.append(el('span', 'acct-name', p.label));
      item.append(el('span', `acct-status${signedIn ? ' on' : ''}`, signedIn ? 'Signed in' : 'Not signed in'));
      if (signedIn) {
        item.append(button('Sign out', 'pill-btn', () => pane.send('signout', { provider: p.name })));
      } else if (p.canSignInHere) {
        item.append(button('Sign in', 'pill-btn primary', () => pane.send('signin', { provider: p.name })));
        item.append(button('Use my browser sign-in', 'pill-btn', () => show({ name: 'import', provider: p })));
      } else {
        item.append(button('Sign in from my browser', 'pill-btn primary', () => show({ name: 'import', provider: p })));
        item.append(el('p', 'acct-note fine', `${p.label}'s owner doesn't allow signing in inside apps like this one, so you sign in in your browser and bring that sign-in over.`));
      }
      nodes.push(item);
    }
    const actions = el('div', 'panel-actions');
    actions.append(button('Done', 'pill-btn', () => modal.close()));
    nodes.push(actions);
    return nodes;
  }

  function importView(p) {
    const site = p.domain;
    const nodes = [el('h2', '', `Bring your ${p.label} sign-in over from your browser`)];
    const steps = el('ol');
    for (const text of [
      `Open a private (incognito) browser window and sign in at ${site} there. Use a private window, not your everyday one: a sign-in shared with a window you keep using gets cancelled after a while.`,
      'Press F12, choose the Network tab, click the "Doc" filter, then press Ctrl+Shift+R to reload.',
      `Click the www.${site} entry with status 200. Under "Request Headers" find "cookie", right-click it and choose "Copy value". (If it says "Provisional headers", press Ctrl+Shift+R again.)`,
      'Paste it below and press Import. Then close the private window without signing out.',
    ]) {
      steps.append(el('li', '', text));
    }
    const box = el('textarea', 'import-box');
    box.placeholder = 'Paste the copied cookie value here';
    box.spellcheck = false;
    const status = el('p', 'import-status');
    const importButton = button('Import', 'pill-btn primary', () => run(() => pane.ask('import-signin', { provider: p.name, text: box.value })));
    const fileButton = button('Choose an exported file…', 'pill-btn', () => run(() => pane.ask('import-signin-file', { provider: p.name })));
    const backButton = button('Back', 'pill-btn', () => show({ name: 'list' }));

    async function run(task) {
      status.className = 'import-status';
      status.textContent = 'Checking…';
      importButton.disabled = true;
      fileButton.disabled = true;
      let result = null;
      try {
        result = await task();
      } catch {
        result = { ok: false, error: 'Something went wrong while importing.' };
      }
      importButton.disabled = false;
      fileButton.disabled = false;
      box.value = '';
      if (!result) {
        status.textContent = ''; // file picker cancelled
        return;
      }
      if (result.ok) {
        toast({ kind: 'info', text: `Signed in to ${p.label}` });
        show({ name: 'list' });
        return;
      }
      status.className = 'import-status bad';
      status.textContent =
        result.error ||
        (result.count
          ? `That was imported, but ${p.label} still says you're signed out. Copy the cookie again from a page where you are signed in.`
          : `No ${p.label} sign-in was found in that text.`);
    }

    const actions = el('div', 'panel-actions');
    actions.append(importButton, fileButton, backButton);
    nodes.push(
      steps,
      box,
      status,
      actions,
      el('p', 'fine', `What you paste is your ${p.label} sign-in, so treat it like a password. Pane keeps it only on this PC, uses it only for ${site}, and "Sign out" removes it. A cookies.txt or JSON export from a cookie extension also works with "Choose an exported file".`),
    );
    setTimeout(() => box.focus(), 0);
    return nodes;
  }

  function show(next) {
    view = next;
    modal.open('panel', view.name === 'import' ? importView(view.provider) : listView());
  }

  return {
    open: () => show({ name: 'list' }),
    /** Sign-in state changed: redraw the list if it is on screen. */
    refresh() {
      if (modal.kind() === 'panel' && view.name === 'list') show(view);
    },
  };
}
