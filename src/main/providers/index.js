'use strict';
// The video sites Pane can play. Each provider is a folder with:
//   index.js   parse(), link(), chat address, thumbnail, account details, messages
//   url.js     turns pasted text into a source
//   page.css   hides everything on the site's page except the <video>
//   agent.js   runs inside the page: reports state, executes commands
// To add a site: copy one of the folders, adapt those four files, add it to `list`.
//
// A "source" is what parse() returns and what a window is told to play:
//   { provider: 'youtube'|'twitch', kind, id, url }
// `id` is the provider's own key for the thing (also used as the history key);
// `url` is the page Pane actually loads.

const fs = require('fs');
const path = require('path');

const list = [require('./youtube'), require('./twitch')];

module.exports = {
  list,
  names: list.map((p) => p.name),
  get: (name) => list.find((p) => p.name === name) || null,
  /** First provider that recognises the text wins. */
  parse(text) {
    if (typeof text !== 'string') return null;
    for (const provider of list) {
      const source = provider.parse(text);
      if (source) return source;
    }
    return null;
  },
  agentCore: fs.readFileSync(path.join(__dirname, 'agent-core.js'), 'utf8'),
  preload: path.join(__dirname, 'preload.js'),
};
