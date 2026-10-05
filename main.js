const {
  app, BrowserWindow, ipcMain, desktopCapturer, screen, session, dialog,
  shell, protocol, net, globalShortcut, nativeTheme,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

let uIOhook = null;
try { ({ uIOhook } = require('uiohook-napi')); } catch (e) { console.warn('uiohook unavailable:', e.message); }

const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const RENDERER = path.join(__dirname, 'renderer');
const RECORDS = path.join(app.getPath('documents'), 'ScreenStudio Recordings');
const PRELOAD = path.join(__dirname, 'preload.js');

protocol.registerSchemesAsPrivileged([{
  scheme: 'ss',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
}]);

let launcher = null;
let controls = null;
let pending = null;        // current recording session
let recording = false;
let controlsResolve = null;
let track = null;          // cursor tracking state
const editors = new Set();
const exportJobs = new Map();

const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#09090b' : '#fafafa');
const webPrefs =(extra = {}) => ({ preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, ...extra });

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1000)))));
  });
}

// ---------- windows ----------
function createLauncher() {
  launcher = new BrowserWindow({
    width: 1080, height: 540, frame: false, resizable: false, show: false,
    backgroundColor: windowBg(), title: 'ScreenStudio', webPreferences: webPrefs(),
  });
  launcher.loadURL('ss://app/launcher.html');
  launcher.once('ready-to-show', () => launcher.show());
  launcher.on('closed', () => { launcher = null; if (!editors.size) app.quit(); });
}

function openEditor(name) {
  const w = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700, autoHideMenuBar: true,
    backgroundColor: windowBg(), title: `ScreenStudio — ${name}`, webPreferences: webPrefs(),
  });
  w.loadURL(`ss://app/editor.html?project=${encodeURIComponent(name)}`);
  editors.add(w);
  w.on('closed', () => { editors.delete(w); if (!launcher && !editors.size) app.quit(); });
  return w;
}

// ---------- sources / displays ----------
ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, primary: d.id === primary,
    label: `Display ${i + 1}${d.id === primary ? ' (primary)' : ''} — ${d.size.width}×${d.size.height}`,
  }));
});

// Live previews for the launcher cards. Captured while the launcher is hidden so it isn't in its own thumbnails.
let thumbCache = { screens: {}, window: null };
async function captureThumbs() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'], thumbnailSize: { width: 720, height: 450 }, fetchWindowIcons: false,
    });
    const screens = {};
    for (const s of sources) {
      if (s.id.startsWith('screen:') && !s.thumbnail.isEmpty()) screens[s.display_id] = s.thumbnail.toDataURL();
    }
    const win = sources.find((s) => s.id.startsWith('window:') && s.name && !s.name.includes('ScreenStudio') && !s.thumbnail.isEmpty());
    thumbCache = { screens, window: win ? win.thumbnail.toDataURL() : null };
  } catch (e) {
    console.warn('thumbnail capture failed', e.message);
  }
}
ipcMain.handle('thumbs:get', () => thumbCache);

ipcMain.handle('sources:list', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'], thumbnailSize: { width: 360, height: 220 }, fetchWindowIcons: false,
  });
  return sources
    .filter((s) => s.name && !s.name.includes('ScreenStudio'))
    .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

ipcMain.handle('region:select', (_e, displayId) => {
  const d = screen.getAllDisplays().find((x) => String(x.id) === String(displayId)) || screen.getPrimaryDisplay();
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, hasShadow: false, fullscreenable: false, webPreferences: webPrefs(),
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadURL('ss://app/region.html');
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('region:result', onResult);
      if (!w.isDestroyed()) w.close();
      resolve(rect ? { displayId: d.id, rect, bounds: d.bounds } : null);
    };
    const onResult = (ev, rect) => { if (ev.sender === w.webContents) finish(rect); };
    ipcMain.on('region:result', onResult);
    w.on('closed', () => finish(null));
  });
});

// ---------- recording session ----------
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

ipcMain.handle('record:prepare', (_e, opts) => {
  const display = screen.getAllDisplays().find((d) => String(d.id) === String(opts.displayId)) || screen.getPrimaryDisplay();
  const name = stamp();
  const dir = path.join(RECORDS, name);
  fs.mkdirSync(dir, { recursive: true });
  pending = { mode: opts.mode, sourceId: opts.sourceId || null, systemAudio: !!opts.systemAudio, display, name, dir };
  return { name, display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor } };
});

ipcMain.handle('record:cancel-prepare', () => { pending = null; });

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      if (!pending) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      let src;
      if (pending.mode === 'window') src = sources.find((s) => s.id === pending.sourceId);
      else src = sources.find((s) => s.display_id === String(pending.display.id)) || sources.find((s) => s.id.startsWith('screen:'));
      if (!src) return callback({});
      callback(pending.systemAudio ? { video: src, audio: 'loopback' } : { video: src });
    } catch (e) {
      console.error(e);
      callback({});
    }
  });
}

ipcMain.handle('launcher:hide', () => launcher?.hide());
ipcMain.handle('launcher:show', async () => {
  await captureThumbs(); // launcher is hidden here
  launcher?.webContents.send('thumbs:updated', thumbCache);
  launcher?.show();
  launcher?.focus();
});
ipcMain.on('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// Opens the floating control bar, runs the countdown there, resolves true when recording may begin.
ipcMain.handle('controls:open', (_e, hudConfig) => new Promise((resolve) => {
  const d = pending.display;
  pending.hud = hudConfig || {};
  const w = 480, h = 56;
  controls = new BrowserWindow({
    width: w, height: h, x: d.bounds.x + Math.round((d.bounds.width - w) / 2), y: d.bounds.y + d.bounds.height - h - 48,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: webPrefs(),
  });
  controls.setContentProtection(true); // keep the bar out of the recording
  controls.setAlwaysOnTop(true, 'screen-saver');
  controls.loadURL('ss://app/controls.html');
  controlsResolve = resolve;
  controls.on('closed', () => { controls = null; if (controlsResolve) { controlsResolve(false); controlsResolve = null; } });
}));

ipcMain.on('controls:countdown-done', () => { if (controlsResolve) { controlsResolve(true); controlsResolve = null; } });
ipcMain.on('controls:started', () => { recording = true; controls?.webContents.send('hud:state', 'recording'); });
ipcMain.on('controls:stop', () => requestStop());
ipcMain.handle('controls:get-config', () => pending?.hud || {});
ipcMain.on('controls:pause-toggle', () => requestPause());
ipcMain.on('hud:state', (_e, state) => controls?.webContents.send('hud:state', state)); // launcher -> HUD

function requestPause() {
  if (recording && !controlsResolve) launcher?.webContents.send('rec:pause-toggle');
}

function requestStop() {
  if (!controls) return;
  if (controlsResolve) { controlsResolve(false); controlsResolve = null; controls.close(); return; } // cancelled during countdown
  if (recording) launcher?.webContents.send('rec:stop');
}

ipcMain.handle('controls:close', () => { recording = false; controls?.close(); });

// cursor + click tracking (positions normalised to the recorded display)
let pollTimer = null;
let hookDown = null;
let hookUp = null;
const r4 = (n) => Math.round(n * 10000) / 10000;

function cursorNorm() {
  const p = screen.getCursorScreenPoint();
  const b = pending.display.bounds;
  return [r4((p.x - b.x) / b.width), r4((p.y - b.y) / b.height)];
}

ipcMain.handle('track:pause', () => { if (track) { track.paused = true; track.pausedAt = Date.now(); } });
ipcMain.handle('track:resume', () => {
  if (track && track.paused) { track.t0 += Date.now() - track.pausedAt; track.paused = false; } // paused time is cut from the timeline
});

ipcMain.handle('track:start', () => {
  track = { t0: Date.now(), events: [], last: '', paused: false, pausedAt: 0 };
  pollTimer = setInterval(() => {
    if (track.paused) return;
    const [x, y] = cursorNorm();
    const key = `${x},${y}`;
    if (key !== track.last) { track.last = key; track.events.push([Date.now() - track.t0, 0, x, y]); }
  }, 16);
  if (uIOhook) {
    hookDown = () => { if (track && !track.paused) { const [x, y] = cursorNorm(); track.events.push([Date.now() - track.t0, 1, x, y]); } };
    hookUp = () => { if (track && !track.paused) { const [x, y] = cursorNorm(); track.events.push([Date.now() - track.t0, 2, x, y]); } };
    uIOhook.on('mousedown', hookDown);
    uIOhook.on('mouseup', hookUp);
    try { uIOhook.start(); } catch (e) { console.warn('uiohook start failed', e); }
  }
  return true;
});

ipcMain.handle('track:stop', () => {
  clearInterval(pollTimer);
  if (uIOhook) {
    uIOhook.off('mousedown', hookDown);
    uIOhook.off('mouseup', hookUp);
    try { uIOhook.stop(); } catch { /* ignore */ }
  }
  const events = track ? track.events : [];
  track = null;
  return events;
});

const openStreams = new Map();
ipcMain.handle('rec:chunk', (_e, { file, buf }) => {
  const p = path.join(pending.dir, file);
  let s = openStreams.get(p);
  if (!s) { s = fs.createWriteStream(p); openStreams.set(p, s); }
  return new Promise((res, rej) => s.write(Buffer.from(buf), (err) => (err ? rej(err) : res())));
});

ipcMain.handle('record:finalize', async (_e, meta) => {
  const step = (i) => launcher?.webContents.send('proc:step', i);
  recording = false;
  controls?.close();
  launcher?.show();
  launcher?.focus();
  for (const s of openStreams.values()) await new Promise((r) => s.end(r));
  openStreams.clear();
  const { dir, name } = pending;

  step(0); // Preparing recording — remux so the webm gets a duration + seek index
  await ffmpeg(['-y', '-i', path.join(dir, 'screen.raw.webm'), '-c', 'copy', path.join(dir, 'screen.webm')]);
  fs.rmSync(path.join(dir, 'screen.raw.webm'), { force: true });

  step(1); // Processing camera
  if (meta.hasCam && fs.existsSync(path.join(dir, 'cam.raw.webm'))) {
    await ffmpeg(['-y', '-i', path.join(dir, 'cam.raw.webm'), '-c', 'copy', path.join(dir, 'cam.webm')]);
    fs.rmSync(path.join(dir, 'cam.raw.webm'), { force: true });
  } else meta.hasCam = false;

  step(2); // Analyzing cursor movement
  meta.stats = { clicks: meta.events.filter((e) => e[1] === 1).length, samples: meta.events.length };

  step(3); // Preparing timeline
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  pending = null;
  openEditor(name).focus();
  return { name, stats: meta.stats };
});

// ---------- projects ----------
ipcMain.handle('projects:list', () => {
  if (!fs.existsSync(RECORDS)) return [];
  return fs.readdirSync(RECORDS)
    .filter((n) => fs.existsSync(path.join(RECORDS, n, 'meta.json')))
    .sort().reverse()
    .map((n) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(RECORDS, n, 'meta.json'), 'utf8')); } catch { /* unreadable */ }
      return { name: n, createdAt: meta.createdAt || null, duration: meta.duration || 0, mode: meta.mode || 'screen', hasCam: !!meta.hasCam };
    });
});
ipcMain.handle('project:delete', (_e, name) => {
  const dir = path.resolve(RECORDS, name);
  if (!dir.startsWith(RECORDS + path.sep)) throw new Error('Invalid project');
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
});
ipcMain.handle('project:open', (_e, name) => { openEditor(name).focus(); });
ipcMain.handle('project:load', (_e, name) => {
  const dir = path.join(RECORDS, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { /* none yet */ }
  return { meta, state };
});
ipcMain.handle('project:save', (_e, { name, state }) => {
  fs.writeFileSync(path.join(RECORDS, name, 'state.json'), JSON.stringify(state));
});
ipcMain.handle('project:reveal', (_e, name) => shell.openPath(path.join(RECORDS, name)));

// ---------- export ----------
ipcMain.handle('export:begin', async (e, { format, name }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = format === 'gif' ? 'gif' : 'mp4';
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('videos'), `${name}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (res.canceled || !res.filePath) return null;
  const id = String(Date.now());
  const tmp = path.join(app.getPath('temp'), `screenstudio-${id}.webm`);
  fs.writeFileSync(tmp, '');
  exportJobs.set(id, { tmp, out: res.filePath, format });
  return id;
});

ipcMain.handle('export:chunk', (_e, { id, buf }) => {
  fs.appendFileSync(exportJobs.get(id).tmp, Buffer.from(buf));
});

ipcMain.handle('export:cancel', (_e, id) => {
  const j = exportJobs.get(id);
  if (j) { fs.rmSync(j.tmp, { force: true }); exportJobs.delete(id); }
});

ipcMain.handle('export:finish', async (_e, { id, fps = 30, crf = 18 }) => {
  const j = exportJobs.get(id);
  const f = Math.min(60, Math.max(10, Number(fps) || 30));
  const q = Math.min(30, Math.max(10, Number(crf) || 18));
  const args = j.format === 'gif'
    ? ['-y', '-i', j.tmp, '-an', '-vf', `fps=${Math.min(f, 20)},scale='min(960,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, j.out]
    : ['-y', '-i', j.tmp, '-vf', `fps=${f}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(q), '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', j.out];
  try {
    await ffmpeg(args);
  } finally {
    fs.rmSync(j.tmp, { force: true });
    exportJobs.delete(id);
  }
  shell.showItemInFolder(j.out);
  return j.out;
});

// ---------- app lifecycle ----------
app.whenReady().then(async () => {
  fs.mkdirSync(RECORDS, { recursive: true });
  protocol.handle('ss', (req) => {
    // Same origin (ss://app) for UI and media so the editor canvas is never tainted.
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const isMedia = rel.startsWith('media/');
    if (isMedia) rel = rel.slice('media/'.length);
    const root = isMedia ? RECORDS : RENDERER;
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
  });
  installDisplayMediaHandler();
  globalShortcut.register('CommandOrControl+Shift+R', requestStop);
  globalShortcut.register('CommandOrControl+Shift+P', requestPause);
  await captureThumbs();
  createLauncher();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
