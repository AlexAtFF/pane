'use strict';
// Plain node test (no Electron):  node probe/extension-test.js
// Checks the browser extension's link logic, and that every address it would send is one
// Pane's own parsers accept (and nothing else gets through the pane:// wrapper).
const assert = require('assert');
const path = require('path');

const { playable, withTime, stamp, address } = require(path.join(__dirname, '..', 'extension', 'links.js'));
const youtube = require(path.join(__dirname, '..', 'src', 'main', 'providers', 'youtube', 'url.js'));
const twitch = require(path.join(__dirname, '..', 'src', 'main', 'providers', 'twitch', 'url.js'));
const parse = (text) => youtube.parse(text) || twitch.parse(text);

const yes = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&index=3',
  'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
  'https://www.youtube.com/shorts/aqz-KE-bpKQ',
  'https://www.youtube.com/live/aqz-KE-bpKQ?si=abc',
  'https://youtu.be/dQw4w9WgXcQ?t=10',
  'https://www.youtube.com/@LofiGirl/live',
  'https://www.twitch.tv/xqc',
  'https://www.twitch.tv/xqc/videos',
  'https://www.twitch.tv/videos/2921546465',
  'https://clips.twitch.tv/AntediluvianCloudyLlamaAMPTropPunch-ONu1fdq2JImYhrDF',
];
const no = [
  'https://www.youtube.com/',
  'https://www.youtube.com/@LofiGirl',
  'https://www.youtube.com/feed/subscriptions',
  'https://www.youtube.com/watch',
  'https://www.youtube.com/results?search_query=x',
  'https://www.twitch.tv/',
  'https://www.twitch.tv/directory',
  'https://www.twitch.tv/settings/profile',
  'https://example.com/watch?v=dQw4w9WgXcQ',
  'javascript:alert(1)',
  'file:///C:/Windows/system32/calc.exe',
  'not a url',
];

for (const link of yes) {
  assert.ok(playable(link), `extension should offer: ${link}`);
  assert.ok(parse(playable(link)), `Pane should accept: ${link}`);
}
for (const link of no) assert.strictEqual(playable(link), null, `extension should ignore: ${link}`);

assert.strictEqual(stamp(3723), '1h2m3s');
assert.strictEqual(address('https://youtu.be/dQw4w9WgXcQ?t=10'), 'pane://open?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D10');
assert.strictEqual(withTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 3), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.ok(parse(withTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 754.2)).url.includes('t=754s'));
assert.ok(parse(withTime('https://www.twitch.tv/videos/2921546465', 3723)).url.includes('time=1h2m3s'));
assert.strictEqual(withTime('https://www.twitch.tv/xqc', 500), 'https://www.twitch.tv/xqc');

console.log(`extension link logic ok (${yes.length} accepted, ${no.length} ignored)`);
