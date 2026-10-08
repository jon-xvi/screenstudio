/* End-to-end suite: launches the real app and drives it over the DevTools protocol.
 *   npm run test:e2e                       (runs from source)
 *   SS_EXE=dist\win-unpacked\ViewBox.exe npm run test:e2e   (runs the packaged build)
 * It records the real screen for a few seconds (camera and microphone are switched off) and deletes its recordings afterwards.
 */
const { spawn, spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXE = process.env.SS_EXE || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ARGS = process.env.SS_EXE ? [] : [ROOT];
const PORT = 9333;
const RECORDS = path.join(os.homedir(), 'Documents', 'ViewBox Recordings');
const EXPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
const FFMPEG = require('ffmpeg-static');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Puppeteer polls waitForFunction with requestAnimationFrame by default, which stalls when an Electron window is covered
// by other windows. Poll on a timer instead.
const origWaitForFunction = puppeteer.Page.prototype.waitForFunction;
puppeteer.Page.prototype.waitForFunction = function (fn, opts, ...args) { return origWaitForFunction.call(this, fn, { polling: 200, ...(opts || {}) }, ...args); };
const results = [];
const consoleErrors = [];
const createdProjects = new Set();
let browser = null;
let app = null;

async function waitFor(fn, { timeout = 15000, interval = 200, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (${last.message})` : ''}`);
}
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
async function test(name, fn) {
  if (process.env.SS_ONLY && !name.toLowerCase().includes(process.env.SS_ONLY.toLowerCase())) return; // SS_ONLY="custom area" runs one test
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); await recover(); }
}
// After a failure, make sure nothing is left recording/processing so one failure can't cascade into the next tests.
async function recover() {
  try {
    const pages = await browser.pages();
    for (const p of pages.filter((x) => /region\.html/.test(x.url()))) await p.keyboard.press('Escape').catch(() => {});
    const hud = pages.find((x) => /controls\.html/.test(x.url()));
    if (hud) await hud.click('#stopBtn').catch(() => {});
    const launcher = pages.find((x) => /launcher\.html/.test(x.url()));
    if (launcher) {
      await launcher.evaluate(() => document.querySelector('.dialog-backdrop')?._close?.(null)).catch(() => {});
      await launcher.waitForFunction(() => !document.querySelector('#startBtn').disabled && !document.querySelector('#view-record').hidden, { timeout: 40000 });
    }
  } catch { /* best effort */ }
}

// ---------- app + pages ----------
function attach(page) {
  const tag = () => { try { return path.basename(new URL(page.url()).pathname); } catch { return '?'; } };
  page.on('pageerror', (e) => consoleErrors.push(`[${tag()}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag()}] ${m.text()}`); });
}
async function launch() {
  app = spawn(EXE, [...ARGS, `--remote-debugging-port=${PORT}`], {
    env: { ...process.env, SS_TEST_EXPORT_DIR: EXPORT_DIR }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stderr.on('data', (d) => { const s = String(d); if (!/wgc_|not capturable/.test(s)) consoleErrors.push(`[main] ${s.trim().slice(0, 300)}`); });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, { timeout: 30000, label: 'app to start' });
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  browser.on('targetcreated', async (t) => { const p = await t.page().catch(() => null); if (p) attach(p); });
  for (const p of await browser.pages()) attach(p);
}
const pageWith = (sub, timeout = 20000) => waitFor(async () => (await browser.pages()).find((p) => p.url().includes(sub)), { timeout, label: `page ${sub}` });
const listProjects = () => (fs.existsSync(RECORDS) ? fs.readdirSync(RECORDS).filter((n) => fs.existsSync(path.join(RECORDS, n, 'meta.json'))) : []);

// ---------- recording helper ----------
async function record({ mode = 'screen', pauseMs = 0, activeMs = 3000, region = false, pickWindow = false, tone = false }) {
  const launcher = await pageWith('launcher.html');
  // the previous recording's processing view must have finished (Start is disabled until then)
  await launcher.waitForFunction(() => !document.querySelector('#view-record').hidden && !document.querySelector('#startBtn').disabled, { timeout: 20000, polling: 200 });
  const before = new Set(listProjects());
  await launcher.evaluate(() => document.querySelector('#tab-record').click());
  await launcher.evaluate((m) => document.querySelector(`.mode[data-mode="${m}"]`).click(), mode);
  await launcher.evaluate(() => { for (const id of ['#camTgl', '#micTgl']) { const b = document.querySelector(id); if (b.getAttribute('aria-pressed') === 'true' && !b.disabled) b.click(); } });
  const t0 = Date.now();
  await launcher.evaluate(() => document.querySelector('#startBtn').click());

  if (region) {
    const rp = await pageWith('region.html', 10000);
    await sleep(500);
    await rp.mouse.move(220, 180); await rp.mouse.down(); await rp.mouse.move(760, 520, { steps: 10 });
    await rp.mouse.up().catch(() => {}); // the overlay closes itself on mouse-up, so the protocol reply can be "Target closed"
  }
  if (pickWindow) {
    await launcher.waitForSelector('.dialog-backdrop .rec-card', { timeout: 10000 });
    await launcher.evaluate(() => document.querySelector('.dialog-backdrop .rec-card').click());
  }
  const hud = await pageWith('controls.html', 15000);
  await hud.waitForSelector('#hud', { timeout: 10000 }); // the page exists a moment before its content does
  assert(await hud.evaluate(() => document.getElementById('hud').dataset.state) === 'countdown', 'HUD should start in countdown');
  await hud.waitForFunction(() => document.getElementById('hud').dataset.state === 'recording', { timeout: 15000, polling: 200 });
  if (tone) { // a quiet 440 Hz tone through the system output, so system-audio capture can be verified in the result
    await launcher.evaluate(() => { const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.2; o.frequency.value = 440; o.connect(g).connect(ac.destination); o.start(); window.__tone = { o, ac }; });
  }
  await sleep(activeMs);
  if (pauseMs) {
    await hud.click('#pauseBtn');
    await hud.waitForFunction(() => document.getElementById('hud').dataset.state === 'paused', { timeout: 5000 });
    const label = await hud.$eval('#label', (e) => e.textContent);
    await sleep(pauseMs);
    assert(await hud.$eval('#label', (e) => e.textContent) === label, 'HUD timer must stop while paused');
    await hud.click('#pauseBtn');
    await hud.waitForFunction(() => document.getElementById('hud').dataset.state === 'recording', { timeout: 5000 });
    await sleep(activeMs);
  }
  const wall = (Date.now() - t0) / 1000;
  if (tone) await launcher.evaluate(() => { window.__tone?.o.stop(); window.__tone?.ac.close(); window.__tone = null; });
  await hud.click('#stopBtn');
  const name = await waitFor(() => listProjects().find((n) => !before.has(n)), { timeout: 60000, label: 'recording to be saved' });
  createdProjects.add(name);
  const editor = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('editor.html') && p.url().includes(name)), { timeout: 30000, label: 'editor to open' });
  await editor.waitForFunction(() => document.querySelector('#loading')?.hidden === true, { timeout: 30000 });
  return { name, editor, launcher, wall };
}

// ---------- export helper ----------
function meanVolume(file) {
  const m = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/mean_volume: (-?[\d.]+) dB/);
  return m ? +m[1] : -999;
}
function probe(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const e = r.stderr;
  const size = (e.match(/Video:.*?(\d{3,5})x(\d{3,5})/) || []);
  const fps = (e.match(/(\d+(?:\.\d+)?) fps/) || [])[1];
  const d = e.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const frames = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/frame=\s*(\d+)/g);
  return {
    w: +size[1], h: +size[2], fps: +fps, audio: /Audio:/.test(e),
    secs: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    frames: frames ? +frames[frames.length - 1].match(/\d+/)[0] : 0,
  };
}
async function exportWith(editor, preset, { cancel = false } = {}) {
  const before = new Set(fs.readdirSync(EXPORT_DIR));
  await editor.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); document.activeElement?.blur(); }); // a previous export's toast must not satisfy this wait
  await editor.evaluate(() => document.querySelector('#exportBtn').click());
  await editor.waitForSelector('.dialog .presets', { timeout: 5000 });
  await editor.evaluate((id) => document.querySelector(`.preset[data-value="${id}"]`).click(), preset);
  await editor.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Export').click());
  if (cancel) {
    await editor.waitForSelector('.dialog #pg-title', { timeout: 10000 });
    await sleep(1500);
    await editor.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Cancel').click());
    await editor.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /cancelled/i.test(t.textContent)), { timeout: 30000, polling: 250 });
    await sleep(500);
    return { cancelled: true, files: fs.readdirSync(EXPORT_DIR).filter((f) => !before.has(f)) };
  }
  const msg = await editor.waitForFunction(() => { const t = [...document.querySelectorAll('.toast')].find((x) => /Export (complete|failed)/.test(x.textContent)); return t ? t.textContent : false; }, { timeout: 150000, polling: 250 }).then((h) => h.jsonValue());
  assert(/complete/.test(msg), `export reported: ${msg}`);
  const file = fs.readdirSync(EXPORT_DIR).find((f) => !before.has(f));
  assert(file, 'no output file was written');
  return { file: path.join(EXPORT_DIR, file), info: probe(path.join(EXPORT_DIR, file)) };
}

const ev = (page, fn, ...a) => page.evaluate(fn, ...a);
const press = async (page, key, mods = []) => { await page.evaluate(() => document.activeElement?.blur()); for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(key); for (const m of mods.reverse()) await page.keyboard.up(m); await sleep(150); };

// ======================================================================
(async () => {
  console.log(`ViewBox e2e — ${process.env.SS_EXE ? 'packaged build' : 'from source'}\n`);
  try { spawnSync('taskkill', ['/F', '/IM', path.basename(EXE)], { stdio: 'ignore' }); } catch { /* none running */ }
  await sleep(800);
  await launch();

  let launcher;
  console.log('Launcher');
  await test('launcher loads with a styled Record view', async () => {
    launcher = await pageWith('launcher.html');
    await launcher.waitForFunction(() => document.querySelectorAll('.mode').length === 3 && window.ui);
    assert(await ev(launcher, () => getComputedStyle(document.querySelector('#startBtn')).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'start button unstyled');
    await launcher.waitForFunction(() => document.querySelectorAll('#summaryList li').length === 4, { timeout: 5000 }).catch(() => { throw new Error('summary should list 4 lines'); });
  });
  await test('mode radiogroup: click and arrow keys', async () => {
    await ev(launcher, () => document.querySelector('.mode[data-mode="custom"]').click());
    assert(await ev(launcher, () => document.querySelector('.mode[data-mode="custom"]').getAttribute('aria-checked') === 'true'));
    assert(await ev(launcher, () => document.querySelector('#summaryList').textContent.includes('Custom area')), 'summary should follow the mode');
    await ev(launcher, () => document.querySelector('.mode[data-mode="screen"]').click());
  });
  await test('inputs: toggles update summary and are exclusive of devices', async () => {
    await ev(launcher, () => document.querySelector('#sysTgl').click());
    assert(await ev(launcher, () => /System audio\s*Off/.test(document.querySelector('#summaryList').textContent)));
    await ev(launcher, () => document.querySelector('#sysTgl').click());
  });
  await test('theme toggle switches and persists', async () => {
    const a = await ev(launcher, () => { document.querySelector('#themeBtn').click(); return document.documentElement.dataset.theme; });
    const b = await ev(launcher, () => { document.querySelector('#themeBtn').click(); return document.documentElement.dataset.theme; });
    assert(a && b && a !== b, `theme did not toggle (${a} → ${b})`);
  });
  await test('recordings tab shows list or empty state', async () => {
    await ev(launcher, () => document.querySelector('#tab-recordings').click());
    await waitFor(() => ev(launcher, () => !document.querySelector('#recGrid').hidden || !document.querySelector('#recEmpty').hidden), { label: 'recordings view' });
    await ev(launcher, () => document.querySelector('#tab-record').click());
  });

  console.log('\nRecording — screen, with pause');
  let rec;
  await test('records, pauses (HUD stops), resumes, stops, processes, opens editor', async () => {
    rec = await record({ mode: 'screen', activeMs: 3000, pauseMs: 2500, tone: true });
  });
  await test('processing view completes and launcher returns to Record', async () => {
    await waitFor(() => ev(launcher, () => !document.querySelector('#view-record').hidden), { timeout: 15000, label: 'launcher back on Record' });
  });
  await test('saved files are valid and paused time is cut', async () => {
    const dir = path.join(RECORDS, rec.name);
    assert(fs.existsSync(path.join(dir, 'screen.webm')) && fs.existsSync(path.join(dir, 'meta.json')), 'missing files');
    assert(!fs.existsSync(path.join(dir, 'screen.raw.webm')), 'raw file should be removed');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const d = await ev(rec.editor, () => dur);
    assert(Math.abs(d - meta.duration) < 1.2, `video ${d.toFixed(1)}s vs meta ${meta.duration.toFixed(1)}s`);
    assert(d > 4.5 && d < 8.2, `expected ~6s of active recording, got ${d.toFixed(1)}s`);
    assert(d < rec.wall - 1.5, `paused time not cut: video ${d.toFixed(1)}s, wall ${rec.wall.toFixed(1)}s`);
  });

  console.log('\nEditor');
  const ed = rec && rec.editor; // undefined when SS_ONLY skips the recording test
  await test('canvas renders real pixels and the inspector shows Canvas', async () => {
    const painted = await ev(ed, () => { const d = view.getContext('2d').getImageData(0, 0, view.width, view.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 8000) seen.add(d[i]); return seen.size > 8; });
    assert(painted, 'canvas looks blank');
    assert(await ev(ed, () => document.querySelector('#inspHead').textContent.includes('Canvas')));
  });
  await test('rail: camera disabled without camera; tools switch inspector', async () => {
    assert(await ev(ed, () => document.querySelector('[data-sel="camera"]').disabled), 'camera tool should be disabled');
    await ev(ed, () => document.querySelector('[data-sel="cursor"]').click());
    assert(await ev(ed, () => document.querySelector('#inspHead').textContent.includes('Cursor')));
    await ev(ed, () => document.querySelector('[data-sel="zoom"]').click());
    assert(await ev(ed, () => document.querySelector('#inspHead').textContent.includes('Zoom')));
  });
  await test('video is seekable and seeks land where asked', async () => {
    const s = await ev(ed, () => ({ end: screenV.seekable.length ? screenV.seekable.end(0) : 0, dur }));
    assert(s.end >= s.dur - 0.6, `seekable range ends at ${s.end} of ${s.dur} (range requests broken?)`);
    await ev(ed, () => seek(2));
    await waitFor(() => ev(ed, () => Math.abs(screenV.currentTime - 2) < 0.3), { timeout: 4000, label: 'seek to 2s' });
  });
  let zoomBase = 0;
  await test('zoom: add, split (S), duplicate (Ctrl+D), delete, undo/redo', async () => {
    const n = () => ev(ed, () => state.zoomSegs.length);
    zoomBase = await n(); // real clicks during the run may have produced auto-zooms
    await ev(ed, () => [...document.querySelectorAll('#inspBody button')].find((b) => /Add at playhead/.test(b.textContent)).click());
    assert(await n() === zoomBase + 1, `add zoom → ${await n()}`);
    await ev(ed, () => { const g = state.zoomSegs.at(-1); g.start = 0.2; g.end = Math.min(dur, 3.2); renderTimeline(); seek(1.4); });
    await waitFor(() => ev(ed, () => Math.abs(screenV.currentTime - 1.4) < 0.3), { timeout: 4000, label: 'seek' });
    await press(ed, 's'); assert(await n() === zoomBase + 2, `split → ${await n()}`);
    await press(ed, 'd', ['Control']); assert(await n() === zoomBase + 3, `duplicate → ${await n()}`);
    await press(ed, 'Delete'); assert(await n() === zoomBase + 2, `delete → ${await n()}`);
    await press(ed, 'z', ['Control']); assert(await n() === zoomBase + 3, `undo delete → ${await n()}`);
    await press(ed, 'z', ['Control']); assert(await n() === zoomBase + 2, `undo duplicate → ${await n()}`);
    await press(ed, 'z', ['Control', 'Shift']); assert(await n() === zoomBase + 3, `redo → ${await n()}`);
    assert(await ev(ed, () => document.querySelectorAll('.tl-zoom').length === state.zoomSegs.length), 'timeline blocks should match state');
  });
  await test('zoom block drag/resize on the timeline changes timing', async () => {
    await ed.bringToFront();
    await sleep(300);
    const box = await ed.$eval('.tl-zoom', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const before = await ev(ed, () => state.zoomSegs.map((g) => [g.start, g.end]));
    await ed.mouse.move(box.x + box.w - 3, box.y + box.h / 2);
    await ed.mouse.down(); await ed.mouse.move(box.x + box.w - 3 + 40, box.y + box.h / 2, { steps: 5 }); await ed.mouse.up();
    const after = await ev(ed, () => state.zoomSegs.map((g) => [g.start, g.end]));
    assert(JSON.stringify(before) !== JSON.stringify(after), 'timing unchanged after dragging the edge');
  });
  await test('canvas aspect ratio switches and undoes', async () => {
    await ev(ed, () => document.querySelector('[data-sel="project"]').click());
    await ev(ed, () => document.querySelector('#inspBody .segmented button[data-value="9:16"]').click());
    assert(await ev(ed, () => view.width === 1080 && view.height === 1920), '9:16 size');
    await press(ed, 'z', ['Control']);
    assert(await ev(ed, () => view.width === 1920 && view.height === 1080), 'undo should restore 16:9');
    await ev(ed, () => document.querySelector('#inspBody .segmented button[data-value="9:16"]').click());
  });
  await test('trim via inspector numbers', async () => {
    await ev(ed, () => document.querySelector('.tl-clip--video').click());
    await ev(ed, () => document.querySelector('.tl-clip--video').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await waitFor(() => ev(ed, () => document.querySelector('#inspHead').textContent.includes('Screen recording')), { label: 'video inspector' });
    await ev(ed, () => { const [s, e] = document.querySelectorAll('#inspBody input[type=number]'); e.value = '4.5'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await ev(ed, () => { const [s] = document.querySelectorAll('#inspBody input[type=number]'); s.value = '1.5'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    const t = await ev(ed, () => [state.trimStart, state.trimEnd]);
    assert(Math.abs(t[0] - 1.5) < 0.05 && Math.abs(t[1] - 4.5) < 0.05, `trim = ${t}`);
  });
  await test('playback plays, advances, pauses and stops at trim end', async () => {
    await ev(ed, () => seek(state.trimStart));
    await sleep(500);
    await ev(ed, () => document.querySelector('#playBtn').click());
    await sleep(1500);
    const mid = await ev(ed, () => ({ t: screenV.currentTime, playing, paused: screenV.paused }));
    assert(mid.playing && mid.t > 2.4, `not advancing at real time: ${JSON.stringify(mid)}`);
    await waitFor(() => ev(ed, () => !playing), { timeout: 8000, label: 'playback to stop at trim end' });
    const end = await ev(ed, () => screenV.currentTime);
    assert(end <= 4.6, `ran past trim end: ${end}`);
  });
  await test('project state persists across reload', async () => {
    const before = await ev(ed, () => state.zoomSegs.length);
    await ev(ed, () => saveNow());
    await ed.reload();
    await ed.waitForFunction(() => document.querySelector('#loading')?.hidden === true, { timeout: 30000 });
    const s = await ev(ed, () => ({ a: state.aspect, te: state.trimEnd, z: state.zoomSegs.length }));
    assert(s.a === '9:16' && Math.abs(s.te - 4.5) < 0.05 && s.z === before, `restored ${JSON.stringify(s)} (expected ${before} zooms)`);
  });

  console.log('\nExport');
  await test('export: Shorts preset → 1080×1920 H.264 with audio, ~3s', async () => {
    const r = await exportWith(ed, 'shorts');
    assert(r.info.w === 1080 && r.info.h === 1920, `size ${r.info.w}x${r.info.h}`);
    assert(r.info.secs > 2.2 && r.info.secs < 4.5, `duration ${r.info.secs}s (trim span is 3s)`);
    assert(r.info.frames >= r.info.secs * 20, `only ${r.info.frames} frames in ${r.info.secs}s (choppy)`);
    assert(r.info.secs < 3.45, `export opens on a held frame? ${r.info.secs}s for a 3s trim`);
    assert(r.info.audio, 'no audio stream');
    const vd = meanVolume(r.file);
    console.log(`      → ${r.info.w}x${r.info.h}, ${r.info.fps} fps, ${r.info.frames} frames, ${r.info.secs}s, mean audio ${vd} dB`);
    assert(vd > -45, `the 440 Hz test tone is missing from the export (mean ${vd} dB): system-audio capture or export audio is broken`);
  });
  await test('export: YouTube preset → 1920×1080', async () => {
    await ev(ed, () => document.querySelector('[data-sel="project"]').click());
    const r = await exportWith(ed, 'youtube');
    assert(r.info.w === 1920 && r.info.h === 1080, `size ${r.info.w}x${r.info.h}`);
    assert(Math.abs(r.info.fps - 30) < 1.5, `fps ${r.info.fps}`);
    console.log(`      → ${r.info.w}x${r.info.h}, ${r.info.fps} fps, ${r.info.frames} frames, ${r.info.secs}s`);
  });
  await test('export: GIF preset writes a GIF', async () => {
    const r = await exportWith(ed, 'gif');
    assert(r.file.endsWith('.gif') && fs.statSync(r.file).size > 20000, 'gif missing/tiny');
  });
  await test('export: cancel stops and leaves no partial file', async () => {
    const r = await exportWith(ed, 'youtube', { cancel: true });
    assert(r.cancelled && r.files.length === 0, `leftover files: ${r.files}`);
  });

  console.log('\nOther capture modes');
  await test('custom area: drag a region → records a cropped video', async () => {
    const r = await record({ mode: 'custom', region: true, activeMs: 2500 });
    const meta = JSON.parse(fs.readFileSync(path.join(RECORDS, r.name, 'meta.json'), 'utf8'));
    assert(meta.crop.w > 0.1 && meta.crop.w < 0.9 && meta.crop.h > 0.1 && meta.crop.h < 0.9, `crop ${JSON.stringify(meta.crop)}`);
    assert(await ev(r.editor, () => document.querySelector('#loading').hidden), 'editor not loaded');
    await r.editor.close();
  });
  await test('window: pick a window → records, cursor tools disabled', async () => {
    const r = await record({ mode: 'window', pickWindow: true, activeMs: 2500 });
    const meta = JSON.parse(fs.readFileSync(path.join(RECORDS, r.name, 'meta.json'), 'utf8'));
    assert(meta.cursorValid === false, 'window recordings should not claim a valid cursor track');
    assert(await ev(r.editor, () => document.querySelector('[data-sel="cursor"]').disabled), 'cursor tool should be disabled');
    await r.editor.close();
  });

  console.log('\nRecordings management');
  await test('delete: cancel keeps it, confirm removes folder and card', async () => {
    await launcher.waitForFunction(() => !document.querySelector('#startBtn').disabled && !document.querySelector('#view-record').hidden, { timeout: 20000 }); // tabs ignore clicks while processing
    await ev(launcher, () => document.querySelector('#tab-recordings').click());
    const sel = `.rec-card[data-name="${rec.name}"]`;
    await launcher.waitForSelector(sel, { timeout: 8000 });
    const del = async () => { await ev(launcher, (s) => document.querySelector(`${s} .rec-card__actions button[aria-label^="Delete"]`).click(), sel); await launcher.waitForSelector('.dialog-backdrop', { timeout: 3000 }); };
    await del();
    await ev(launcher, () => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Cancel').click());
    await sleep(300);
    assert(await ev(launcher, (s) => !!document.querySelector(s), sel) && fs.existsSync(path.join(RECORDS, rec.name)), 'cancel must not delete');
    await del();
    await ev(launcher, () => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Delete').click());
    await waitFor(() => !fs.existsSync(path.join(RECORDS, rec.name)), { timeout: 5000, label: 'folder removal' });
    await waitFor(() => ev(launcher, (s) => !document.querySelector(s), sel), { timeout: 5000, label: 'card removal' });
    createdProjects.delete(rec.name);
  });

  // Optional: a real recording with camera, clicks and audio. Copy one into a project folder and set SS_FIXTURE=<folder name>.
  if (process.env.SS_FIXTURE) {
    console.log('\nFixture recording (camera, clicks, audio)');
    let fx;
    await test('fixture opens in the editor; cam + click data present', async () => {
      await ev(launcher, (n) => api.invoke('project:open', n), process.env.SS_FIXTURE);
      fx = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('editor.html') && p.url().includes(process.env.SS_FIXTURE)), { timeout: 20000, label: 'fixture editor' });
      await fx.waitForFunction(() => document.querySelector('#loading')?.hidden === true, { timeout: 30000 });
      const f = await ev(fx, () => ({ cam: meta.hasCam, clicks: downs.length, zooms: state.zoomSegs.length, seekable: screenV.seekable.end(0) >= dur - 0.6 }));
      assert(f.cam && f.clicks > 0 && f.seekable, JSON.stringify(f));
      assert(f.zooms > 0, 'first open should auto-generate zooms from clicks');
    });
    await test('camera layouts: pip / side / full / off draw differently', async () => {
      await ev(fx, () => document.querySelector('[data-sel="camera"]').click());
      const sig = async () => ev(fx, () => { draw(vctx, view.width, view.height, 1); const d = vctx.getImageData(0, 0, view.width, view.height).data; let s = 0; for (let i = 0; i < d.length; i += 997) s = (s * 31 + d[i]) % 1000003; return { s, cam: !!lastCam }; });
      const seen = {};
      for (const l of ['pip', 'side', 'full', 'off']) {
        await ev(fx, (v) => document.querySelector(`#inspBody .segmented button[data-value="${v}"]`).click(), l);
        await sleep(300);
        seen[l] = await sig();
      }
      assert(seen.pip.cam && seen.side.cam && seen.full.cam && !seen.off.cam, `cam rect flags ${JSON.stringify(seen)}`);
      assert(new Set(Object.values(seen).map((x) => x.s)).size === 4, `layouts render identically: ${JSON.stringify(seen)}`);
      await ev(fx, () => document.querySelector('#inspBody .segmented button[data-value="pip"]').click());
    });
    await test('playback at real time keeps the webcam in sync and visible', async () => {
      await ev(fx, () => { state.trimStart = 0; state.trimEnd = dur; seek(2); });
      await sleep(600);
      await ev(fx, () => document.querySelector('#playBtn').click());
      await sleep(2000);
      const s = await ev(fx, () => ({ t: screenV.currentTime, camT: camV.currentTime, off: meta.camOffset, camW: camV.videoWidth, playing }));
      assert(s.playing && s.t > 3.5, `not advancing: ${JSON.stringify(s)}`);
      assert(Math.abs(s.camT - (s.t - s.off)) < 0.6, `webcam out of sync: ${JSON.stringify(s)}`);
      assert(s.camW > 0, 'webcam has no frame');
      await ev(fx, () => document.querySelector('#playBtn').click());
    });
    await test('export with camera + audio: trimmed length and a non-silent audio track', async () => {
      await ev(fx, () => { state.trimStart = 3; state.trimEnd = 6.5; });
      const r = await exportWith(fx, 'youtube');
      assert(r.info.secs > 2.6 && r.info.secs < 4.6, `duration ${r.info.secs}s (trim span 3.5s)`);
      assert(r.info.audio, 'no audio stream in export');
      console.log(`      → ${r.info.w}x${r.info.h}, ${r.info.fps} fps, ${r.info.frames} frames, ${r.info.secs}s, mean audio ${meanVolume(r.file)} dB (source may be silent)`);
    });
    await fx?.close().catch(() => {});
  }

  console.log('\nHealth');
  await test('no console or page errors anywhere', async () => {
    const real = consoleErrors.filter((e) => !/DevTools|Autofill|favicon/i.test(e));
    assert(real.length === 0, `${real.length} error(s):\n        ${[...new Set(real)].slice(0, 6).join('\n        ')}`);
  });
})().catch((e) => { console.error('\nFATAL', e); results.push({ name: 'suite', ok: false, err: e.message }); }).finally(async () => {
  try { await browser?.disconnect(); } catch { /* ignore */ }
  try { app?.kill(); spawnSync('taskkill', ['/F', '/T', '/PID', String(app?.pid)], { stdio: 'ignore' }); } catch { /* ignore */ }
  for (const n of createdProjects) { try { fs.rmSync(path.join(RECORDS, n), { recursive: true, force: true }); } catch { /* ignore */ } }
  try { fs.rmSync(EXPORT_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — ${failed.length} failed` : ''}`);
  process.exit(failed.length ? 1 : 0);
});
