'use strict';
// Notices when a playable link (YouTube, Twitch) lands on the clipboard and reports it once.

const { clipboard } = require('electron');
const providers = require('./providers');

let timer = null;
let lastText = null;

function readLink() {
  let text = '';
  try {
    text = clipboard.readText();
  } catch {}
  return providers.parse(text);
}

function start(onLink) {
  stop();
  try {
    lastText = clipboard.readText(); // whatever was already there is not news
  } catch {}
  timer = setInterval(() => {
    let text = '';
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (text === lastText) return;
    lastText = text;
    const link = providers.parse(text);
    if (link) onLink(link);
  }, 800);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Call when Pane itself copies something, so we don't offer our own link back. */
function ignore(text) {
  lastText = text;
}

module.exports = { start, stop, readLink, ignore };
