// Renders build/icon.png (512x512) from the brand mark. Run: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<!doctype html><body style="margin:0;background:transparent;overflow:hidden">
<svg style="display:block" width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="112" fill="#09090b"/>
  <rect x="112" y="150" width="288" height="212" rx="62" fill="none" stroke="#fafafa" stroke-width="28"/>
  <circle cx="256" cy="256" r="44" fill="#fafafa"/>
</svg></body>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  console.log('wrote icon.png', img.getSize());
  app.quit();
});
