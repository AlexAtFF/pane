'use strict';
// Installs (or updates) the packaged build for the current Windows user.
//   npm run release        package + install
//   node scripts/install.js [--close]
//
// Only the program folder is replaced. Everything the user owns (settings, history,
// sign-ins) lives in %APPDATA%\Pane and is never touched here; see src/main/store.js.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const build = path.join(root, 'dist', 'Pane-win32-x64');
const target = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Pane');
const shortcut = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Pane.lnk');
const version = require(path.join(root, 'package.json')).version;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function installedCopyRunning() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process -Name Pane -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }) -join \"`n\""], { encoding: 'utf8' });
    return out.split(/\r?\n/).some((p) => p && path.resolve(p).toLowerCase().startsWith(target.toLowerCase()));
  } catch {
    return false;
  }
}

if (process.platform !== 'win32') fail('This installer is for Windows.');
if (!process.env.LOCALAPPDATA) fail('LOCALAPPDATA is not set.');
if (!fs.existsSync(path.join(build, 'Pane.exe'))) fail('No packaged build found. Run "npm run package" first.');

if (installedCopyRunning()) {
  if (!process.argv.includes('--close')) fail('Pane is running. Close its windows and run this again (or pass --close to close it for you).');
  try {
    execFileSync('taskkill', ['/IM', 'Pane.exe', '/T'], { stdio: 'ignore' }); // polite close first
  } catch {}
  const deadline = Date.now() + 8000;
  while (installedCopyRunning() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  if (installedCopyRunning()) {
    // Frameless windows ignore the polite request; --close was asked for, so end the process.
    try {
      execFileSync('taskkill', ['/F', '/IM', 'Pane.exe', '/T'], { stdio: 'ignore' });
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  if (installedCopyRunning()) fail('Pane is still running; close it and try again.');
}

// Replace the program files. `resources` is removed first so files deleted from the app don't linger.
fs.mkdirSync(target, { recursive: true });
fs.rmSync(path.join(target, 'resources'), { recursive: true, force: true });
fs.cpSync(build, target, { recursive: true, force: true });

// The browser extension ("Open in Pane") sits beside the program, at a path that stays the
// same across updates, because the browser loads it from that folder.
const extension = path.join(root, 'extension');
if (fs.existsSync(extension)) {
  fs.rmSync(path.join(target, 'extension'), { recursive: true, force: true });
  fs.cpSync(extension, path.join(target, 'extension'), { recursive: true });
}

if (!fs.existsSync(shortcut)) {
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut.replace(/'/g, "''")}'); $s.TargetPath = '${path.join(target, 'Pane.exe').replace(/'/g, "''")}'; $s.WorkingDirectory = '${target.replace(/'/g, "''")}'; $s.Description = 'Pane'; $s.Save()`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
  } catch {
    console.warn('Could not create the Start menu shortcut.');
  }
}

console.log(`Pane ${version} installed to ${target}`);
console.log('User data (settings, history, sign-ins) was left as it is in %APPDATA%\\Pane.');
