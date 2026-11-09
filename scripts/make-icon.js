'use strict';
// Renders assets/icon.svg to assets/icon.png (256px) and assets/icon.ico.
// Run with: npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg', '<svg width="256" height="256"')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = (await win.webContents.capturePage()).resize({ width: 256, height: 256 });
  const png = image.toPNG();
  fs.writeFileSync(path.join(assets, 'icon.png'), png);

  // An .ico file may simply wrap a PNG: 6-byte header, one 16-byte entry, then the PNG.
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(0, 6); // width 256
  header.writeUInt8(0, 7); // height 256
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, png]));
  console.log('icon written', png.length);
  app.quit();
});
