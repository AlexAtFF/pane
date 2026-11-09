# Pane

A Windows desktop app (Electron) that plays YouTube and Twitch with nothing on screen but the video. Each window is frameless, locked to the video's aspect ratio, and shows controls only while the mouse is over it. One app instance, many windows. Current version: see `package.json`.

## Product rules (from the owner)

- **Nothing about the video is shown unless the mouse is over the window**: no title, no viewer count, no persistent chrome. New features go behind the hover UI, the right-click menu, the home panel, or a shortcut.
- The player must look and operate the same for every site.
- No "PiP mode". Every window plays its own audio; the user mutes by hand.
- History is kept **per site in separate tabs**, never merged.
- While a video plays, the top-left corner holds **Back** (returns the window to the start screen; `PlayerWindow.unload()`) **and New window**, nothing else. History, accounts and open-link stay reachable by shortcut and right-click menu.
- Videos default to the **highest available quality** (`playback.quality: 'highest'`). The volume bar is always visible and long (272px).
- While a video plays and the mouse is over it, the **middle of the picture** holds back-N-seconds, play/pause, forward-N-seconds (N = `playback.seekStep`, 5). Like everything else they are gone when the mouse is.
- **Ads are blocked by default** (`blockAds`; "Block ads" in the right-click menu turns it off). The owner should never see or hear an ad: one that can't be prevented is muted and covered with the loading spinner until it is gone.
- **Resizing** by a side keeps the middle of the opposite side where it is (the window grows evenly both ways across); by a corner, the opposite corner stays put.
- The start screen is **only the link box** plus the top bar (new window, history, accounts, window buttons). No hints, logo, footer or lists. History is its own page behind the history button / `Ctrl+H`; Accounts and Shortcuts live in the right-click menu.
- **User data must survive updates.** See "Persistence contract" below before touching anything that stores data.

## How it works

Each window (`src/main/player-window.js`) stacks three views:

1. **page** – the site's real page (YouTube watch page; Twitch's stand-alone `player.twitch.tv` / `clips.twitch.tv/embed`). The provider's `page.css` hides everything except the `<video>`; its `agent.js` runs inside the page, reports player state and executes commands through the site's own player object. The page is never clicked.
2. **overlay** – our UI (`src/overlay/`), a transparent page on top that receives all mouse and keyboard input. Identical for every site.
3. **chat** – the site's popout live chat, docked right when open.

Everything site-specific lives in a **provider**: `src/main/providers/<name>/` (`index.js`, `url.js`, `page.css`, `agent.js`). `providers/agent-core.js` is the shared half of the in-page agent; `providers/index.js` lists the providers and documents the "source" object.

Data flow: provider `agent.js snapshot()` → `providers/preload.js` → main (`sanitize()` in player-window.js) → overlay `pane.on('state')`. Commands: overlay `pane.send('player', {name, arg})` → `commands.js` → `PlayerWindow.player()` → provider `agent.js commands[name]`.

Other main-process modules: `main.js` (window manager, app lifecycle), `history.js` (watch history + thumbnails), `accounts.js` (sign-in, cookie import), `adblock.js` (ad blocking; read its header first), `store.js` (data folder, safe JSON writes), `config.js` (settings.json), `hotkeys.js`, `clipboard-watch.js`, `menu.js`, `native-drag.js`.

## Browser extension ("Open in Pane")

`extension/` is a small Brave/Chrome extension that hands a video's address to Pane as `pane://open?url=<address>`. Three ways in: on youtube.com and twitch.tv, right-clicking a video's thumbnail or title shows **Pane's own short menu** with Open in Pane first (`content.js`; Shift+right-click gives the browser's menu); the browser's own right-click menu has an **Open in Pane** item on video links and video pages (`background.js`); and a toolbar button sends the current tab's video. The installed Pane registers the `pane://` link type with Windows at start-up (`LINK_SCHEME` in `main.js`); `linkFromArgs()` unwraps it and only ever opens what a provider's `parse()` accepts. A video sent from its own page is paused in the browser and continues in Pane at the same position.

- It is not part of the app bundle. `scripts/install.js` copies it to `%LOCALAPPDATA%\Programs\Pane\extension`, and the owner loads that folder once in `brave://extensions` (Developer mode, Load unpacked). After changing `extension/`, reinstall and press the reload arrow on the extension's card.
- **The owner wants Open in Pane at the top of the right-click menu.** A browser never lets an extension place its item there (extension items sit in their own block lower down), which is why `content.js` replaces the menu on video links with its own. It is built with `createElement` only (YouTube forbids `innerHTML`), lives in a closed shadow root, and the click that dismisses it is swallowed so it doesn't also open the video underneath. The player on a video's own page keeps its normal right-click.
- Which links count as a video is decided in `links.js` (`playable()`, `NOT_CHANNELS`), shared by both scripts; it mirrors the providers' `url.js` and `node probe/extension-test.js` checks they agree. A new provider needs adding there, to the `matches` in `manifest.json`, and to the patterns in `background.js`.
- `probe/menu-test.html` loads the real `links.js` + `content.js` with a stand-in for the extension API (serve the project folder with `python -m http.server 8765`, open `/probe/menu-test.html`); it exposes `menuRoot`, `mouse()` and `fullClick()` for driving the menu from the console.
- YouTube's player shows its own menu on right-click; the browser's menu (with Open in Pane) is the second right-click, or use the toolbar button.

## Where to add things

| I want to… | Edit |
| --- | --- |
| Add a button to the hover UI | `src/overlay/controls.js` (one entry; icon in `icons.js`; slots: `top-left`, `top-right`, `center`, `left`, `right`) |
| Add a keyboard shortcut (window focused) | `src/overlay/shortcuts.js` |
| Add a system-wide hotkey | default binding in `src/main/config.js`, action in `src/main/hotkeys.js`, label in `shortcuts.js` `GLOBAL_LABELS` |
| Read something new from a site's player | that provider's `agent.js snapshot()` **and** `sanitize()` in `player-window.js` (fields not copied there are dropped) |
| Make the player do something new | provider `agent.js commands` (add it to every provider, even as a no-op) |
| Give the UI a new app/window ability | `src/main/commands.js` (`commands` = fire-and-forget, `queries` = returns a value) |
| Add a right-click menu item | `src/main/menu.js` |
| Change a default that existing users should follow | bump `SETTINGS_VERSION` and add a step to `upgradeUserFile()` in `src/main/config.js` (the user's file spells out old defaults) |
| Add a user setting | `DEFAULTS` in `src/main/config.js` (merged over the user's `settings.json`, hot-reloaded); expose via `publicConfig()` in `commands.js` if the UI needs it |
| Hide more of a site's page furniture | provider `page.css` |
| Change how ads are blocked | `src/main/adblock.js` (network list, running a provider's script ahead of the page); YouTube: `blockAds()` in its `agent.js`; Twitch: `adblock` in its `index.js` + `vendor/vaft.js` |
| Support another video site | copy a provider folder, adapt its four files, add it to `list` in `providers/index.js`. History tabs, accounts panel and clipboard watching pick it up from the list. |
| Change the home panel / history list | `src/overlay/history.js`, markup in `index.html` (`#home`), styles in `styles.css` |
| Change the accounts panel | `src/overlay/accounts.js` |

Overlay state classes on `<body>` (`is-empty`, `is-loading`, `has-error`, `has-gate`, `is-ad`, `no-seek`, `ui`, `palette-open`, …) are set in `app.js render()` and styled in `styles.css`.

## Persistence contract

Everything the user owns is in `%APPDATA%\Pane` (pinned in `store.js`, independent of the app's name):

- `settings.json` – user settings; merged over `DEFAULTS`, so new options appear by themselves.
- `history.json` + `thumbnails/` – watch history (`version` field + `migrate()` in `history.js`).
- `window-state.json` – last window size, last history tab, last app version.
- `Partitions/youtube/` – cookies/sign-ins for **all** sites. The partition is named `persist:youtube` for historical reasons.
- `backups/<old version>/` – copies of the JSON files, taken on the first run of each new version.

Rules: never rename the data folder or the partition; never change a file's format without bumping its `version` and adding a migration step; write JSON only through `store.writeJson` (atomic, keeps `.bak`). The program itself lives in `%LOCALAPPDATA%\Programs\Pane` and is the only thing an update replaces.

## Gotchas

- YouTube live: the `<video>` element's clock is offset from the player's; always use `getProgressState()` (`progress()` / `seekTo()` in the YouTube agent).
- Twitch has no public page API. The agent finds Twitch's player object through the page's React tree (`findPlayer()`); if Twitch changes its markup, that is the first thing to check. Live Twitch can't be rewound, so the seek bar hides (`no-seek`).
- Twitch thumbnails in history are frames captured from the player (`history.saveThumb`), served to the overlay through the `pane-thumb://` protocol; YouTube uses `i.ytimg.com`. Both hosts are allow-listed in the overlay's CSP (`index.html`).
- **Google blocks sign-in inside embedded browsers** ("This browser or app may not be secure"). Do not try to defeat that. YouTube sign-in works by importing the user's own browser session (`accounts.importCookies`, Accounts panel). Twitch has a normal in-app sign-in window plus the same import route.
- Windows keeps a 1–2px non-client frame on frameless windows; size maths goes through `PlayerWindow.frame()`.
- Every resize is done by hand in the `will-resize` handler (`player-window.js`): Windows' own aspect lock (`setAspectRatio`) anchors a side-drag on a corner and can't exclude the chat panel. The handler takes the size Windows proposes, fits it to the video's shape and places it around the anchor point. `probe/resize.js` checks all eight edges.
- Dragging the video moves the window via a real system move (`native-drag.js`, koffi → user32) so Windows Snap works; after it starts the overlay gets no `pointerup`.
- The overlay page is `sandbox: true` with a CSP; build DOM with `el()`/`textContent`, never interpolate site strings into HTML.
- **Ad blocking** has three layers (`adblock.js`): ad servers are refused for the whole session; a provider's script can run in the page before the site's own (through the page's debugger connection, `webContents.debugger`; opening DevTools on the page takes that connection away until the next load); and the provider's agent deals with an ad that starts anyway while the window mutes and covers it (`state.ad.covered`).
  - YouTube: the instant an ad shows, the agent asks for the same video again with the request marked as a no-ad surface (`REQUEST_VARIANTS` in `youtube/agent.js`); the video plays ~0.8 s later. Removing the ad lists from the player data, or merely skipping through the ad, makes YouTube hold the video back ~15 s: measured, don't go back to it. YouTube changes this a few times a year; when ads or long waits return, `probe/ads.js` shows it and uBlock Origin's "quick fixes" list (youtube.com lines) shows what currently works. The answer to that re-request has its ad lists removed, so after one rescue a video has no ads left (seeking would otherwise set off mid-video breaks).
  - **Live streams and spoilers.** The re-request reloads a stream at the live point. The owner often watches well behind live, so the agent takes them straight back to where they were (`rescue.restore`) and reports the whole thing as an ad, which keeps the picture covered and the sound off until they are back. Never let a reload, or anything else, show or play the live point to someone who is behind it. `probe/live-rescue.js` forces this path and checks both the position and that nothing near live was visible or audible.
  - Twitch: `providers/twitch/vendor/vaft.js` is TwitchAdSolutions' script (MIT, bundled unchanged, licence beside it; the upstream project was archived in March 2026). It swaps in an ad-free copy of the stream during ad breaks. `probe/twitch-ads.js` exercises it with the script's own `simulateAds` switch; a real Twitch ad break has not been observed in a probe.
  - With "Block ads" off, ads play as the sites send them and the UI reflects them (yellow bar, "Skip ad").

## Run, test, ship

- `npm start` – run from source. `npm start -- <link>` opens that link.
- `PANE_PROBE=probe/<script>.js PANE_PROBE_OUT=<dir> npx electron .` – scripted runs that drive the real app and save composited screenshots + a log (`probe/lib.js` has the helpers). There is no unit test suite; the probes are the regression check: `live.js` (YouTube), `twitch.js`, `home.js` (history, accounts, data folder), `basic.js`, `states.js`. Probe windows open **off-screen, never take focus and make no sound** (the process's audio output is off; `PANE_PROBE_SOUND=1` turns it on), so probes can run while the PC is in use; screenshots are then per view (`<name>.png` = Pane's UI on transparent, `<name>.page.png` = the site's page). `PANE_PROBE_SHOW=1` puts the window on screen and takes real composited screenshots instead. Set `PANE_DATA_DIR=<empty temp folder>` when running probes: they then use a throwaway data folder, can run while the user's Pane is open, and never touch the real history or sign-ins. `start.js` covers the start screen and history page; `center.js` the middle-of-the-picture controls; `resize.js` the resize anchors; `ads.js` (how many ads get through, and how long the video takes to start), `adcheck.js` (resume position, live, the on/off switch) and `twitch-ads.js` cover ad blocking, signed out; `adlab.js` / `adlab2.js` are the exploration scripts used to find what works against YouTube; `live-seek.js` (stepping while behind live lands where it should), `live-rescue.js` (see the ad-blocking notes) and `midroll.js` (stepping in a long recording) cover seeking; `proto.js` covers `pane://` links (start it with one as the argument), and `node probe/extension-test.js` (plain node) the extension's link logic.
- `npm run release` – package and install/update the user's copy (`scripts/install.js`; leaves user data alone). `npm run package` only builds `dist/Pane-win32-x64/`. `npm run icon` regenerates the icon from `assets/icon.svg`.
- Bump `version` in `package.json` for every release; the app shows it on the start screen and in the right-click menu.
