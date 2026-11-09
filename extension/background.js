// "Open in Pane" for Brave / Chrome: the part that lives in the browser itself.
//
//   - Brave's own right-click menu gets an "Open in Pane" item on links to YouTube / Twitch
//     videos (any site) and on pages that are themselves a video. The browser decides where
//     extension items sit in that menu (low down); it can't be moved.
//   - That is why, on youtube.com and twitch.tv, content.js shows Pane's own short menu when
//     a video thumbnail is right-clicked, with Open in Pane first. This file opens the
//     "new tab / new window / private window" choices that menu offers.
//   - The toolbar button sends the video on the current tab.
//
// A video is handed to Pane through Pane's own link type, pane://open?url=<address>, which
// the installed Pane registers with Windows (LINK_SCHEME in the app's main.js).

importScripts('links.js');
const { playable, withTime, address } = self.PaneLinks;

const VIDEO_LINKS = [
  '*://*.youtube.com/watch*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://youtu.be/*',
  '*://*.twitch.tv/*',
];
const VIDEO_PAGES = [
  '*://*.youtube.com/watch*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://*.youtube.com/*/live',
  '*://*.twitch.tv/*',
];

// Runs in the page: pause the browser's copy of the video and report where it was.
function pauseAndReport() {
  const video = document.querySelector('video');
  if (!video) return null;
  const player = document.getElementById('movie_player');
  let live = !Number.isFinite(video.duration);
  try {
    if (player && typeof player.getVideoData === 'function' && player.getVideoData().isLive) live = true;
  } catch {}
  const time = video.currentTime;
  video.pause();
  return { time, live };
}

// Runs in the page: go to the pane:// address. Doing it from the page (rather than from the
// extension) lets the browser offer "Always allow <site> to open links of this type".
function go(to) {
  location.href = to;
}

async function openInPane(tab, link, fromPage) {
  if (!tab || !link) return;
  let target = link;
  if (fromPage) {
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: pauseAndReport });
      const info = result && result.result;
      if (info && !info.live) target = withTime(link, info.time);
    } catch {}
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: go, args: [address(target)] });
  } catch {
    chrome.tabs.update(tab.id, { url: address(target) }); // pages the extension may not script
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'link', title: 'Open in Pane', contexts: ['link'], targetUrlPatterns: VIDEO_LINKS });
    chrome.contextMenus.create({ id: 'page', title: 'Open in Pane', contexts: ['page', 'video'], documentUrlPatterns: VIDEO_PAGES });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'link') return openInPane(tab, playable(info.linkUrl), false);
  // A video inside a link (a preview playing in a feed) means that link, not the page around it.
  const link = playable(info.linkUrl || '');
  return openInPane(tab, link || playable(info.pageUrl), !link);
});

// Toolbar button: the video on the current tab.
chrome.action.onClicked.addListener((tab) => openInPane(tab, playable(tab.url || ''), true));

// The other choices in content.js's menu: the same things Brave's own menu does with a link.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'pane:open-link' || !/^https?:\/\//i.test(message.url || '')) return;
  const tab = sender.tab;
  if (message.how === 'window') chrome.windows.create({ url: message.url });
  else if (message.how === 'private') chrome.windows.create({ url: message.url, incognito: true });
  else chrome.tabs.create({ url: message.url, active: false, ...(tab ? { index: tab.index + 1, windowId: tab.windowId, openerTabId: tab.id } : {}) });
});
