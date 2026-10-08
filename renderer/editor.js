/* ViewBox editor: Canvas · Timeline · Inspector. See DESIGN.md §7–§8. */
const $ = (s) => document.querySelector(s);
const name = new URLSearchParams(location.search).get('project');
const view = $('#view');
const vctx = view.getContext('2d');
const screenV = document.createElement('video');
const camV = document.createElement('video');
screenV.preload = camV.preload = 'auto';
camV.muted = true;
screenV.playsInline = camV.playsInline = true;

const BGS = [
  ['#18181b', '#52525b'], ['#0c0a09', '#44403c'], ['#0f172a', '#334155'], ['#1e3a8a', '#0ea5e9'], ['#064e3b', '#34d399'],
  ['#7c2d12', '#fb923c'], ['#fafafa', '#d4d4d8'], ['#e0e7ff', '#fbcfe8'], ['#fef3c7', '#fecaca'], ['#ffffff', '#e4e4e7'],
];
const ASPECTS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080] };
const EASE = { smooth: (x) => x * x * (3 - 2 * x), out: (x) => 1 - (1 - x) ** 3, linear: (x) => x };
const MIN_ZOOM_LEN = 0.6;

let meta = null, dur = 0, vw = 1, vh = 1, crop = { x: 0, y: 0, w: 1, h: 1 };
let state = null, bgImage = null;
let sel = { type: 'project', id: null };
let playing = false, dirty = true, exporting = false;
let downs = [], track = [], sm1 = [], sm2 = [];
let lastView = { vx: 0, vy: 0, vwid: 1, vhei: 1, L: { x: 0, y: 0, w: 1, h: 1 } };
let lastCam = null;
let nextId = 1, uid = 0;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmt1 = (s) => `${s.toFixed(1)}s`;
const even = (n) => Math.round(n / 2) * 2;
const mediaUrl = (file) => `${window.__mediaBase || 'ss://app/media/'}${encodeURIComponent(name)}/${file}`;

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}

// ======================================================================
// State, history, persistence
// ======================================================================
function defaultState() {
  return {
    aspect: '16:9',
    bg: { type: 'preset', i: 0, c1: '#18181b', c2: '#52525b' },
    padding: 8, radius: 18, shadow: 55,
    cursor: { arrow: !!meta.cursorHidden, ring: true, ripple: true, size: 1.4, smoothing: 60, ringSize: 1 },
    zoomScale: 2,
    cam: { layout: 'pip', size: 24, pos: 'br', shape: 'circle', border: true, shadow: 40, mirror: true },
    trimStart: 0, trimEnd: dur,
    zoomSegs: [],
  };
}

function normalize(raw) {
  const d = defaultState();
  if (!raw) return d;
  const s = JSON.parse(JSON.stringify(raw));
  if ('arrow' in s) { // migrate pre-inspector projects
    s.cursor = { ...(s.cursor || {}), arrow: s.arrow, ring: s.ring, ripple: s.ripple, size: s.cursorScale ?? d.cursor.size };
    delete s.arrow; delete s.ring; delete s.ripple; delete s.cursorScale;
  }
  if (s.cam && 'on' in s.cam) { if (!s.cam.on) s.cam.layout = 'off'; delete s.cam.on; }
  const out = { ...d, ...s, cursor: { ...d.cursor, ...s.cursor }, cam: { ...d.cam, ...s.cam }, bg: { ...d.bg, ...s.bg } };
  out.zoomSegs = (s.zoomSegs || []).map((g) => ({ ease: 'smooth', inDur: 0.6, outDur: 0.7, ...g }));
  out.trimEnd = Math.min(out.trimEnd || dur, dur);
  return out;
}

let history = [], hIdx = -1;
const snap = () => JSON.stringify(state);
function commit() {
  const s = snap();
  if (s === history[hIdx]) return;
  history = history.slice(0, hIdx + 1);
  history.push(s); hIdx = history.length - 1;
  if (history.length > 100) { history.shift(); hIdx--; }
  updateHistoryButtons();
  scheduleSave();
}
function restore(i) {
  hIdx = i;
  state = normalize(JSON.parse(history[hIdx]));
  afterStateReplaced();
  updateHistoryButtons();
  scheduleSave();
}
const undo = () => { if (hIdx > 0) restore(hIdx - 1); };
const redo = () => { if (hIdx < history.length - 1) restore(hIdx + 1); };
function updateHistoryButtons() {
  $('#undoBtn').disabled = hIdx <= 0;
  $('#redoBtn').disabled = hIdx >= history.length - 1;
}
function afterStateReplaced() {
  setAspect();
  rebuildTrack();
  if (sel.type === 'zoom' && sel.id && !state.zoomSegs.some((g) => g.id === sel.id)) sel = { type: 'zoom', id: null };
  renderTimeline(); renderInspector(); updateRail(); updateTools();
  dirty = true;
}

let saveTimer = null;
function scheduleSave() {
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}
async function saveNow() {
  clearTimeout(saveTimer);
  const s = JSON.parse(JSON.stringify(state));
  if (s.bg.type === 'image') s.bg.type = 'preset'; // images aren't persisted
  await api.invoke('project:save', { name, state: s });
  $('#saveState').textContent = 'Saved';
}

// ======================================================================
// Cursor track
// ======================================================================
function buildTrack() {
  track = []; downs = [];
  if (!meta.cursorValid) return;
  for (const [ms, k, x, y] of meta.events) {
    const p = { t: ms / 1000, x: (x - crop.x) / crop.w, y: (y - crop.y) / crop.h };
    track.push(p);
    if (k === 1) downs.push(p);
  }
}
function rebuildTrack() {
  if (!track.length) { sm1 = []; sm2 = []; return; }
  const n = Math.ceil(dur * 60) + 2;
  const raw = (t) => {
    let lo = 0, hi = track.length - 1;
    if (t <= track[0].t) return [track[0].x, track[0].y];
    if (t >= track[hi].t) return [track[hi].x, track[hi].y];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t <= t) lo = m; else hi = m; }
    const a = track[lo], b = track[hi];
    const k = (t - a.t) / (b.t - a.t || 1);
    return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
  };
  const run = (alpha) => {
    const out = new Float32Array(n * 2);
    let [sx, sy] = raw(0);
    for (let i = 0; i < n; i++) {
      const [rx, ry] = raw(i / 60);
      sx += (rx - sx) * alpha; sy += (ry - sy) * alpha;
      out[i * 2] = sx; out[i * 2 + 1] = sy;
    }
    return out;
  };
  sm1 = run(0.8 - 0.68 * (state.cursor.smoothing / 100)); // pointer
  sm2 = run(0.05); // camera follow
}
function smAt(arr, t) {
  if (!arr.length) return [0.5, 0.5];
  const f = clamp(t * 60, 0, arr.length / 2 - 2);
  const i = Math.floor(f), k = f - i;
  return [arr[i * 2] + (arr[i * 2 + 2] - arr[i * 2]) * k, arr[i * 2 + 1] + (arr[i * 2 + 3] - arr[i * 2 + 1]) * k];
}

// ======================================================================
// Drawing
// ======================================================================
function drawBackground(ctx, W, H) {
  const bg = state.bg;
  if (bg.type === 'image' && bgImage) {
    const s = Math.max(W / bgImage.width, H / bgImage.height);
    ctx.drawImage(bgImage, (W - bgImage.width * s) / 2, (H - bgImage.height * s) / 2, bgImage.width * s, bgImage.height * s);
    return;
  }
  const [c1, c2] = bg.type === 'custom' ? [bg.c1, bg.c2] : BGS[bg.i] || BGS[0];
  const rad = (135 * Math.PI) / 180;
  const half = (Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad))) / 2;
  const g = ctx.createLinearGradient(W / 2 - Math.cos(rad) * half, H / 2 - Math.sin(rad) * half, W / 2 + Math.cos(rad) * half, H / 2 + Math.sin(rad) * half);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function zoomAt(t) {
  let best = null, bestK = 0, bestA = 0;
  for (const g of state.zoomSegs) {
    const e = EASE[g.ease] || EASE.smooth;
    const a = e(clamp((t - g.start) / g.inDur)) * e(clamp((g.end - t) / g.outDur));
    const k = a * (g.scale - 1);
    if (k > bestK) { bestK = k; best = g; bestA = a; }
  }
  if (!best) return { s: 1, cx: 0.5, cy: 0.5 };
  let fx = best.fx, fy = best.fy;
  if (best.follow && track.length) [fx, fy] = smAt(sm2, t);
  fx = clamp(fx); fy = clamp(fy);
  return { s: 1 + bestK, cx: 0.5 + (fx - 0.5) * bestA, cy: 0.5 + (fy - 0.5) * bestA };
}

function rr(ctx, x, y, w, hh, r) { ctx.beginPath(); ctx.roundRect(x, y, w, hh, r); }

function drawCover(ctx, v, r, radius, mirror) {
  const cw = v.videoWidth, ch = v.videoHeight, ar = r.w / r.h;
  let sw = cw, sh = cw / ar;
  if (sh > ch) { sh = ch; sw = ch * ar; }
  ctx.save();
  rr(ctx, r.x, r.y, r.w, r.h, radius); ctx.clip();
  if (mirror) { ctx.translate(r.x + r.w, r.y); ctx.scale(-1, 1); ctx.translate(-r.x, -r.y); }
  ctx.drawImage(v, (cw - sw) / 2, (ch - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
  ctx.restore();
}

function drawCamBox(ctx, r, radius, sc) {
  const c = state.cam;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.55 * (c.shadow / 100)})`; ctx.shadowBlur = 30 * sc * (c.shadow / 100); ctx.shadowOffsetY = 10 * sc * (c.shadow / 100);
  ctx.fillStyle = '#000'; rr(ctx, r.x, r.y, r.w, r.h, radius); ctx.fill();
  ctx.restore();
  drawCover(ctx, camV, r, radius, c.mirror);
  if (c.border) { ctx.lineWidth = 4 * sc; ctx.strokeStyle = 'rgba(255,255,255,.9)'; rr(ctx, r.x, r.y, r.w, r.h, radius); ctx.stroke(); }
}

function draw(ctx, W, H, t) {
  const sc = Math.sqrt(W * H) / 1440;
  drawBackground(ctx, W, H);
  lastCam = null;

  const pad = state.padding / 100;
  const A = { x: W * pad, y: H * pad, w: W * (1 - 2 * pad), h: H * (1 - 2 * pad) };
  const frameR = state.radius * sc;
  const cam = state.cam;
  const camReady = meta.hasCam && cam.layout !== 'off' && camV.videoWidth > 0;

  if (camReady && cam.layout === 'full') { // camera replaces the screen
    drawCamBox(ctx, A, frameR, sc);
    lastView = { vx: 0, vy: 0, vwid: 1, vhei: 1, L: A };
    lastCam = A;
    return;
  }

  let area = A;
  if (camReady && cam.layout === 'side') {
    const gap = W * 0.02, camW = A.w * 0.3;
    area = { x: A.x, y: A.y, w: A.w - camW - gap, h: A.h };
    const camH = Math.min(A.h, (camW * 4) / 3);
    lastCam = { x: A.x + A.w - camW, y: A.y + (A.h - camH) / 2, w: camW, h: camH };
  }

  // content rect: recorded area fitted into `area`
  const cropAspect = (crop.w * vw) / (crop.h * vh);
  let cw = area.w, ch = cw / cropAspect;
  if (ch > area.h) { ch = area.h; cw = ch * cropAspect; }
  const L = { x: area.x + (area.w - cw) / 2, y: area.y + (area.h - ch) / 2, w: cw, h: ch };

  const z = zoomAt(t);
  const vwid = 1 / z.s, vhei = 1 / z.s;
  const vx = clamp(z.cx - vwid / 2, 0, 1 - vwid);
  const vy = clamp(z.cy - vhei / 2, 0, 1 - vhei);
  lastView = { vx, vy, vwid, vhei, L };

  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${(0.6 * state.shadow) / 100})`;
  ctx.shadowBlur = state.shadow * 0.9 * sc;
  ctx.shadowOffsetY = state.shadow * 0.3 * sc;
  ctx.fillStyle = '#000'; rr(ctx, L.x, L.y, L.w, L.h, frameR); ctx.fill();
  ctx.restore();

  ctx.save();
  rr(ctx, L.x, L.y, L.w, L.h, frameR); ctx.clip();
  ctx.drawImage(
    screenV,
    (crop.x + vx * crop.w) * vw, (crop.y + vy * crop.h) * vh, vwid * crop.w * vw, vhei * crop.h * vh,
    L.x, L.y, L.w, L.h,
  );
  if (track.length) drawCursor(ctx, t, sc);
  ctx.restore();

  if (camReady && cam.layout === 'side') drawCamBox(ctx, lastCam, frameR, sc);
  else if (camReady && cam.layout === 'pip') {
    const d = (Math.min(W, H) * cam.size) / 100, m = 0.06 * Math.min(W, H);
    const r = { x: cam.pos.includes('l') ? m : W - m - d, y: cam.pos.includes('t') ? m : H - m - d, w: d, h: d };
    const radius = cam.shape === 'circle' ? d / 2 : cam.shape === 'round' ? d * 0.18 : 4 * sc;
    drawCamBox(ctx, r, radius, sc);
    lastCam = r;
  }
}

function toScreen(px, py) {
  const { vx, vy, vwid, vhei, L } = lastView;
  return [L.x + ((px - vx) / vwid) * L.w, L.y + ((py - vy) / vhei) * L.h];
}

function drawCursor(ctx, t, sc) {
  const c = state.cursor;
  const cs = c.size * sc;
  if (c.ripple) {
    for (const d of downs) {
      const k = (t - d.t) / 0.6;
      if (k < 0 || k > 1) continue;
      const [x, y] = toScreen(d.x, d.y);
      const e = 1 - (1 - k) * (1 - k);
      ctx.beginPath(); ctx.arc(x, y, (12 + 42 * e) * cs, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.22 * (1 - k)})`; ctx.fill();
      ctx.lineWidth = 3 * sc; ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; ctx.stroke();
    }
  }
  const [px, py] = smAt(sm1, t);
  if (px < -0.02 || px > 1.02 || py < -0.02 || py > 1.02) return;
  const [x, y] = toScreen(px, py);
  if (c.ring) {
    ctx.beginPath(); ctx.arc(x, y, 22 * cs * c.ringSize, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  }
  if (c.arrow) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(cs * 1.1, cs * 1.1);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(7.5, 20); ctx.lineTo(10, 19); ctx.lineTo(7, 12.5); ctx.lineTo(12.5, 12.5); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.2; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.restore();
  }
}

// ======================================================================
// Canvas view (aspect, fit / zoom)
// ======================================================================
let viewScale = 'fit';
const VIEW_STEPS = ['fit', 0.5, 0.75, 1];
function setAspect() {
  const [w, hh] = ASPECTS[state.aspect] || ASPECTS['16:9'];
  if (view.width !== w || view.height !== hh) { view.width = w; view.height = hh; }
  view.style.setProperty('--ar', `${w} / ${hh}`);
  applyViewScale();
}
function applyViewScale() {
  if (viewScale === 'fit') view.style.setProperty('--view-w', 'min(100cqw, calc(100cqh * var(--ar-num)))');
  else view.style.setProperty('--view-w', `${view.width * viewScale}px`);
  view.style.setProperty('--ar-num', String(view.width / view.height));
  $('#zoomLabel').textContent = viewScale === 'fit' ? 'Fit' : `${Math.round(viewScale * 100)}%`;
  dirty = true;
}
function stepView(dir) {
  const i = VIEW_STEPS.indexOf(viewScale);
  viewScale = VIEW_STEPS[clamp(i + dir, 0, VIEW_STEPS.length - 1)];
  applyViewScale();
}
$('#zoomInBtn').onclick = () => stepView(1);
$('#zoomOutBtn').onclick = () => stepView(-1);
$('#fitBtn').onclick = () => { viewScale = 'fit'; applyViewScale(); };

view.addEventListener('click', (e) => {
  const rect = view.getBoundingClientRect();
  const mx = ((e.clientX - rect.left) / rect.width) * view.width;
  const my = ((e.clientY - rect.top) / rect.height) * view.height;
  if (lastCam && mx >= lastCam.x && mx <= lastCam.x + lastCam.w && my >= lastCam.y && my <= lastCam.y + lastCam.h) return setSel('camera');
  const g = sel.type === 'zoom' && sel.id && state.zoomSegs.find((x) => x.id === sel.id);
  if (g && !g.follow) { // set a fixed focus point
    const { vx, vy, vwid, vhei, L } = lastView;
    g.fx = clamp(vx + ((mx - L.x) / L.w) * vwid); g.fy = clamp(vy + ((my - L.y) / L.h) * vhei);
    dirty = true; commit();
    return;
  }
  if (sel.type !== 'project') setSel('project');
});

// ======================================================================
// Playback
// ======================================================================
function seek(t) {
  t = clamp(t, 0, dur);
  camV.playbackRate = 1;
  screenV.currentTime = t;
  if (meta.hasCam) camV.currentTime = Math.max(0, t - meta.camOffset);
  dirty = true;
}
// Keep the webcam clip aligned with the screen clip during playback/export.
// Recorded webm files have sparse keyframes (one every few seconds), so a seek can take seconds. Re-seeking on every small
// drift therefore never catches up and freezes the camera. Seek only for real jumps and otherwise converge by nudging speed.
function syncCam(t) {
  if (!meta.hasCam || camV.seeking) return;
  const want = Math.max(0, t - meta.camOffset);
  const drift = camV.currentTime - want; // > 0: camera is ahead
  if (Math.abs(drift) > 2.5) { camV.currentTime = want; return; }
  camV.playbackRate = Math.abs(drift) > 0.04 ? clamp(1 - drift, 0.5, 2) : 1;
  if (playing && camV.paused && want < (camV.duration || Infinity)) camV.play().catch(() => {});
}
// resolve once both clips have finished any pending seek
async function settleSeeks(ms = 8000) {
  const t0 = performance.now();
  while ((screenV.seeking || (meta.hasCam && camV.seeking)) && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 30));
}
function setPlayIcon(on) {
  const b = $('#playBtn');
  b.querySelector('use').setAttribute('href', `#i-${on ? 'pause' : 'play'}`);
  b.setAttribute('aria-label', on ? 'Pause' : 'Play');
  b.dataset.tip = on ? 'Pause' : 'Play';
}
function play() {
  if (screenV.currentTime >= state.trimEnd - 0.05 || screenV.currentTime < state.trimStart) seek(state.trimStart);
  playing = true;
  screenV.play();
  if (meta.hasCam) {
    const want = Math.max(0, screenV.currentTime - meta.camOffset);
    if (Math.abs(camV.currentTime - want) > 0.3 && !camV.seeking) camV.currentTime = want; // usually already in place after seek()
    camV.play().catch(() => {});
  }
  setPlayIcon(true);
}
function pause() {
  screenV.pause(); camV.pause();
  camV.playbackRate = 1;
  playing = false;
  setPlayIcon(false);
}
$('#playBtn').onclick = () => (playing ? pause() : play());
screenV.addEventListener('seeked', () => { dirty = true; });
camV.addEventListener('seeked', () => { dirty = true; });

function frame() {
  if (!exporting) {
    const t = screenV.currentTime;
    if (playing) {
      if (t >= state.trimEnd - 0.02 || screenV.ended) { pause(); seek(state.trimStart); } else syncCam(t);
    }
    if (playing || dirty) { draw(vctx, view.width, view.height, screenV.currentTime); dirty = false; }
    updatePlayhead();
  }
  requestAnimationFrame(frame);
}

// ======================================================================
// Timeline
// ======================================================================
const area = $('#tlArea');
const pps = () => area.clientWidth / dur;
const TRACKS = [
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'camera', label: 'Camera', icon: 'camera' },
  { id: 'zoom', label: 'Zoom', icon: 'zoom-in' },
  { id: 'cursor', label: 'Cursor', icon: 'cursor' },
];
$('#tlLabels').replaceChildren(...TRACKS.map((t) => h('div', { class: 'tl-label', html: `${ui.icon(t.icon)}<span>${t.label}</span>` })));

function updatePlayhead() {
  const t = screenV.currentTime;
  $('#playhead').style.left = `${t * pps()}px`;
  $('#time').textContent = `${fmt(t)} / ${fmt(dur)}`;
}

function renderTimeline() {
  const k = pps();
  const ruler = $('#ruler');
  ruler.replaceChildren();
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * k >= 80) || 300;
  for (let s = 0; s <= dur; s += step) {
    ruler.append(h('i', { style: `left:${s * k}px` }), h('span', { style: `left:${s * k}px` }, fmt(s)));
  }

  const rows = $('#tlRows');
  rows.replaceChildren();
  const clip = (cls, text, selType, extra = {}) => h('div', {
    class: `tl-clip ${cls}`, role: 'button', tabindex: '0', 'data-sel': selType,
    'aria-selected': String(sel.type === selType), 'aria-label': text,
    style: `left:0;width:${dur * k}px`, ...extra,
  }, text);

  // video
  const rv = h('div', { class: 'tl-row', 'data-row': 'video' }, clip('tl-clip--video', 'Screen recording', 'video'));
  rv.append(
    h('div', { class: 'tl-trim', 'data-edge': 'start', style: `left:${state.trimStart * k - 5}px`, 'aria-label': 'Trim start' }),
    h('div', { class: 'tl-trim', 'data-edge': 'end', style: `left:${state.trimEnd * k - 5}px`, 'aria-label': 'Trim end' }),
  );
  // camera
  const rc = h('div', { class: 'tl-row', 'data-row': 'camera' });
  if (meta.hasCam) rc.append(clip('tl-clip--camera', `Camera · ${LAYOUT_LABEL[state.cam.layout]}`, 'camera'));
  else { rc.dataset.disabled = 'true'; rc.dataset.note = 'No camera in this recording'; }
  // zoom
  const rz = h('div', { class: 'tl-row', 'data-row': 'zoom' });
  for (const g of state.zoomSegs) {
    rz.append(h('div', {
      class: 'tl-clip tl-zoom', role: 'button', tabindex: '0', 'data-id': g.id, 'data-sel': 'zoom',
      'aria-selected': String(sel.type === 'zoom' && sel.id === g.id), 'aria-label': `Zoom ${g.scale.toFixed(1)}× at ${fmt(g.start)}`,
      style: `left:${g.start * k}px;width:${Math.max(16, (g.end - g.start) * k)}px`,
      html: `<span class="h l"></span>${g.scale.toFixed(1)}×${g.follow ? ' · follow' : ''}<span class="h r"></span>`,
    }));
  }
  // cursor
  const ru = h('div', { class: 'tl-row', 'data-row': 'cursor' });
  if (meta.cursorValid) {
    const c = clip('tl-clip--cursor', `Cursor · ${downs.length} click${downs.length === 1 ? '' : 's'}`, 'cursor');
    downs.forEach((d) => c.append(h('i', { class: 'tl-tick', style: `left:${d.t * k}px` })));
    ru.append(c);
  } else { ru.dataset.disabled = 'true'; ru.dataset.note = 'Not available for window recordings'; }
  rows.append(rv, rc, rz, ru);

  $('#dimL').style.width = `${state.trimStart * k}px`;
  $('#dimR').style.left = `${state.trimEnd * k}px`;
  $('#dimR').style.right = '0';
  updatePlayhead();
}

function snapTime(t, ignoreId) {
  const cands = [0, dur, screenV.currentTime, state.trimStart, state.trimEnd];
  for (const g of state.zoomSegs) if (g.id !== ignoreId) cands.push(g.start, g.end);
  const px = 8 / pps();
  let best = t, bd = px;
  for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
  return best;
}

function dragWindow(onMove, onUp) {
  const move = (e) => onMove(e);
  const up = (e) => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); onUp?.(e); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}
const timeAt = (e) => clamp((e.clientX - area.getBoundingClientRect().left) / pps(), 0, dur);

$('#ruler').addEventListener('pointerdown', (e) => {
  seek(timeAt(e));
  dragWindow((ev) => seek(timeAt(ev)));
});

$('#tlRows').addEventListener('pointerdown', (e) => {
  const trim = e.target.closest('.tl-trim');
  if (trim) {
    const edge = trim.dataset.edge;
    dragWindow((ev) => {
      const t = snapTime(timeAt(ev));
      if (edge === 'start') state.trimStart = clamp(t, 0, state.trimEnd - 0.5);
      else state.trimEnd = clamp(t, state.trimStart + 0.5, dur);
      renderTimeline(); if (sel.type === 'video') renderInspector();
    }, commit);
    return;
  }
  const z = e.target.closest('.tl-zoom');
  if (z) {
    const g = state.zoomSegs.find((x) => x.id === +z.dataset.id);
    setSel('zoom', g.id);
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
    const x0 = e.clientX, s0 = g.start, e0 = g.end;
    dragWindow((ev) => {
      const dt = (ev.clientX - x0) / pps();
      if (mode === 'm') {
        const len = e0 - s0;
        const ns = clamp(s0 + dt, 0, dur - len);
        const a = snapTime(ns, g.id), b = snapTime(ns + len, g.id) - len;
        g.start = clamp(Math.abs(a - ns) <= Math.abs(b - ns) ? a : b, 0, dur - len); g.end = g.start + len;
      } else if (mode === 'l') g.start = clamp(snapTime(s0 + dt, g.id), 0, g.end - MIN_ZOOM_LEN);
      else g.end = clamp(snapTime(e0 + dt, g.id), g.start + MIN_ZOOM_LEN, dur);
      renderTimeline(); renderInspector(); dirty = true;
    }, commit);
    return;
  }
  const c = e.target.closest('.tl-clip');
  if (c) return setSel(c.dataset.sel);
  const row = e.target.closest('.tl-row');
  if (row && !row.dataset.disabled) setSel(row.dataset.row === 'zoom' ? 'zoom' : 'project');
});
$('#tlRows').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const c = e.target.closest('.tl-clip');
  if (!c) return;
  e.preventDefault(); e.stopPropagation();
  setSel(c.dataset.sel, c.dataset.id ? +c.dataset.id : null);
});
addEventListener('resize', renderTimeline);

// ======================================================================
// Zoom segments
// ======================================================================
const segById = (id) => state.zoomSegs.find((g) => g.id === id);
function newSeg(start, end, fx, fy, follow) {
  return { id: nextId++, start, end, scale: state.zoomScale, follow, fx, fy, ease: 'smooth', inDur: 0.6, outDur: 0.7 };
}
function autoGenerate() {
  const segs = [];
  for (const d of downs) {
    const s = Math.max(0, d.t - 0.5), e = Math.min(dur, d.t + 2.2);
    const last = segs[segs.length - 1];
    if (last && s <= last.end + 0.4) last.end = Math.max(last.end, e);
    else segs.push(newSeg(s, e, clamp(d.x), clamp(d.y), true));
  }
  return segs;
}
function addZoomAtPlayhead() {
  const t = screenV.currentTime;
  const [fx, fy] = track.length ? smAt(sm1, t) : [0.5, 0.5];
  const g = newSeg(t, Math.min(dur, t + 2.5), clamp(fx), clamp(fy), track.length > 0);
  if (g.end - g.start < MIN_ZOOM_LEN) g.start = Math.max(0, g.end - MIN_ZOOM_LEN);
  state.zoomSegs.push(g);
  commit(); setSel('zoom', g.id);
}
function duplicateZoom() {
  const g = sel.type === 'zoom' && segById(sel.id);
  if (!g) return;
  const len = g.end - g.start;
  const start = Math.min(g.end + 0.2, Math.max(0, dur - len));
  const c = { ...g, id: nextId++, start, end: start + len };
  state.zoomSegs.push(c);
  commit(); setSel('zoom', c.id);
}
function splitZoom() {
  const g = sel.type === 'zoom' && segById(sel.id);
  const t = screenV.currentTime;
  if (!g || t <= g.start + 0.3 || t >= g.end - 0.3) return ui.toast('Move the playhead inside the selected zoom to split it', { kind: 'info' });
  const b = { ...g, id: nextId++, start: t };
  g.end = t;
  state.zoomSegs.push(b);
  commit(); setSel('zoom', b.id);
}
function deleteSelection() {
  if (sel.type !== 'zoom' || !sel.id) return;
  state.zoomSegs = state.zoomSegs.filter((g) => g.id !== sel.id);
  commit(); setSel('zoom');
}
$('#splitBtn').onclick = splitZoom;
$('#dupBtn').onclick = duplicateZoom;
$('#delBtn').onclick = deleteSelection;

// ======================================================================
// Selection, rail, inspector
// ======================================================================
const LAYOUT_LABEL = { off: 'Off', pip: 'Picture-in-picture', full: 'Full screen', side: 'Side by side' };
function setSel(type, id = null) {
  if (type === 'camera' && !meta.hasCam) return;
  if (type === 'cursor' && !meta.cursorValid) return;
  sel = { type, id };
  renderTimeline(); renderInspector(); updateRail(); updateTools();
}
function updateRail() {
  document.querySelectorAll('.rail__btn').forEach((b) => {
    const t = b.dataset.sel;
    b.setAttribute('aria-pressed', String(sel.type === t || (t === 'project' && sel.type === 'video')));
    b.disabled = (t === 'camera' && !meta.hasCam) || (t === 'cursor' && !meta.cursorValid);
  });
}
function updateTools() {
  const z = sel.type === 'zoom' && sel.id;
  ['#splitBtn', '#dupBtn', '#delBtn'].forEach((s) => { $(s).disabled = !z; });
}
document.querySelectorAll('.rail__btn').forEach((b) => { b.onclick = () => setSel(b.dataset.sel); });

// ---- inspector building blocks ----
function section(title, nodes, open = true) {
  const d = h('details', { class: 'section' }, h('summary', {}, title, h('span', { html: ui.icon('chevron-down') })), h('div', { class: 'section__body' }, nodes));
  if (open) d.open = true;
  return d;
}
const appendAll = (parent, ...nodes) => parent.append(...nodes.filter(Boolean)); // lets sections be conditional (`cond && section(...)`)
const field = (label, control, id, stack = false) => h('div', { class: `field${stack ? ' field--stack' : ''}` }, h('label', { for: id }, label), h('div', { class: 'field__control' }, control));
function fRange(label, { min, max, step = 1, get, set, fmtv = (v) => v, live }) {
  const id = `f${++uid}`;
  const input = h('input', { type: 'range', class: 'range', id, min, max, step });
  input.value = get();
  const val = h('span', { class: 'field__value' }, fmtv(get()));
  input.addEventListener('input', () => { set(+input.value); val.textContent = fmtv(+input.value); dirty = true; live?.(); scheduleSave(); });
  input.addEventListener('change', commit);
  ui.syncRange(input);
  return field(label, [input, val], id);
}
function fToggle(label, get, set, disabled = false) {
  const id = `f${++uid}`;
  const input = h('input', { type: 'checkbox', role: 'switch', id, disabled });
  input.checked = !!get();
  input.addEventListener('change', () => { set(input.checked); dirty = true; commit(); });
  return field(label, h('label', { class: 'toggle' }, input, h('span', { class: 'toggle__track' })), id);
}
function fSeg(label, options, get, set) {
  const id = `f${++uid}`;
  const el = h('div', { class: 'segmented segmented--full', role: 'radiogroup', 'aria-label': label, id },
    options.map((o) => h('button', { role: 'radio', 'data-value': o.value, 'aria-checked': String(o.value === get()), tabindex: o.value === get() ? '0' : '-1', disabled: o.disabled, 'aria-label': o.label }, o.label)));
  ui.segmented(el, (v) => { set(v); dirty = true; commit(); });
  return field(label, el, id, true);
}
function fSelect(label, options, get, set) {
  const id = `f${++uid}`;
  const sel_ = h('select', { class: 'select', id }, options.map((o) => h('option', { value: o.value }, o.label)));
  sel_.value = get();
  sel_.addEventListener('change', () => { set(sel_.value); dirty = true; commit(); });
  return field(label, sel_, id);
}
function fNumber(label, { get, set, min, max, step = 0.1, unit = 's' }) {
  const id = `f${++uid}`;
  const input = h('input', { type: 'number', class: 'input', id, min, max, step, style: 'width:88px' });
  input.value = (+get()).toFixed(2);
  input.addEventListener('change', () => { set(+input.value); dirty = true; commit(); renderTimeline(); renderInspector(); });
  return field(label, [input, h('span', { class: 'field__value', style: 'min-width:0' }, unit)], id);
}
const head = (icon, title, sub) => {
  $('#inspHead').replaceChildren(
    h('span', { class: 'inspector__icon', html: ui.icon(icon, 'icon--lg') }),
    h('div', { class: 'inspector__titles' }, h('h2', { class: 't-h3' }, title), h('span', { class: 't-caption subtle' }, sub)),
  );
};

function renderInspector() {
  const body = $('#inspBody');
  const scroll = body.scrollTop;
  body.replaceChildren();
  ({ project: inspProject, video: inspVideo, zoom: sel.id ? inspZoomItem : inspZoomOverview, cursor: inspCursor, camera: inspCamera }[sel.type] || inspProject)(body);
  ui.hydrate(body);
  body.scrollTop = scroll;
}

function inspProject(body) {
  head('layout', 'Canvas', 'Project settings');
  const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Background presets' });
  BGS.forEach(([a, b], i) => sw.append(h('button', {
    class: 'swatch', role: 'radio', 'aria-label': `Background ${i + 1}`,
    'aria-checked': String(state.bg.type === 'preset' && state.bg.i === i),
    style: `background:linear-gradient(135deg,${a},${b})`,
    onclick: () => { state.bg = { ...state.bg, type: 'preset', i }; dirty = true; commit(); renderInspector(); },
  })));
  const c1 = h('input', { type: 'color', class: 'color', value: state.bg.c1, 'aria-label': 'Gradient start colour' });
  const c2 = h('input', { type: 'color', class: 'color', value: state.bg.c2, 'aria-label': 'Gradient end colour' });
  const custom = () => { state.bg = { ...state.bg, type: 'custom', c1: c1.value, c2: c2.value }; dirty = true; };
  [c1, c2].forEach((c) => { c.addEventListener('input', custom); c.addEventListener('change', () => { commit(); renderInspector(); }); });
  const file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'bgFile' });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { bgImage = img; state.bg = { ...state.bg, type: 'image' }; dirty = true; commit(); renderInspector(); };
    img.src = URL.createObjectURL(f);
  });

  body.append(
    section('Canvas', [
      fSeg('Aspect', ['16:9', '9:16', '1:1', '4:3'].map((v) => ({ value: v, label: v })), () => state.aspect, (v) => { state.aspect = v; setAspect(); }),
    ]),
    section('Background', [
      sw,
      field('Custom', [c1, c2]),
      field('Image', [h('button', { class: 'btn btn--secondary btn--sm', onclick: () => file.click() }, 'Choose…'), state.bg.type === 'image' && bgImage
        ? h('button', { class: 'btn btn--tertiary btn--sm', onclick: () => { bgImage = null; state.bg.type = 'preset'; dirty = true; commit(); renderInspector(); } }, 'Remove') : null, file]),
    ]),
    section('Frame', [
      fRange('Padding', { min: 0, max: 20, step: 0.5, get: () => state.padding, set: (v) => { state.padding = v; }, fmtv: (v) => `${v}%` }),
      fRange('Corner radius', { min: 0, max: 48, get: () => state.radius, set: (v) => { state.radius = v; }, fmtv: (v) => `${v}px` }),
      fRange('Shadow', { min: 0, max: 100, get: () => state.shadow, set: (v) => { state.shadow = v; }, fmtv: (v) => `${v}` }),
    ]),
  );
}

function inspVideo(body) {
  head('video', 'Screen recording', `${vw}×${vh} · ${fmt(dur)}`);
  body.append(
    section('Trim', [
      fNumber('Start', { get: () => state.trimStart, min: 0, max: dur, set: (v) => { state.trimStart = clamp(v, 0, state.trimEnd - 0.5); } }),
      fNumber('End', { get: () => state.trimEnd, min: 0, max: dur, set: (v) => { state.trimEnd = clamp(v, state.trimStart + 0.5, dur); } }),
      h('p', { class: 'hint' }, 'Drag the handles on the Video track to trim. Everything outside is left out of the export.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn--secondary btn--sm', onclick: () => { state.trimStart = 0; state.trimEnd = dur; commit(); renderTimeline(); renderInspector(); dirty = true; } }, 'Reset trim')),
    ]),
    section('Source', [
      h('p', { class: 'hint' }, `${{ screen: 'Full screen', custom: 'Custom area', window: 'Window' }[meta.mode] || 'Screen'} · ${vw}×${vh}${meta.hasAudio ? ' · with audio' : ' · no audio'}`),
    ], false),
  );
}

function inspZoomOverview(body) {
  head('zoom-in', 'Zoom', `${state.zoomSegs.length} zoom${state.zoomSegs.length === 1 ? '' : 's'}`);
  const list = h('div', { class: 'list', role: 'listbox', 'aria-label': 'Zooms' });
  [...state.zoomSegs].sort((a, b) => a.start - b.start).forEach((g) => list.append(h('button', {
    class: 'list-item zoom-item', role: 'option', 'aria-selected': 'false',
    onclick: () => { seek(g.start); setSel('zoom', g.id); },
  }, h('span', { html: ui.icon('zoom-in') }), `${g.scale.toFixed(1)}×`, h('span', { class: 'list-item__meta' }, `${fmt1(g.start)} – ${fmt1(g.end)}`))));
  body.append(
    section('Auto-zoom', [
      h('p', { class: 'hint' }, downs.length
        ? `${downs.length} click${downs.length === 1 ? '' : 's'} recorded. Zooms follow your cursor and can be edited individually.`
        : 'No clicks were recorded, so zooms can’t be generated automatically. Add them by hand at the playhead.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn--secondary btn--sm', disabled: !downs.length, onclick: async () => {
          if (state.zoomSegs.length && !await ui.confirm({ title: 'Replace current zooms?', body: 'Auto-zoom will regenerate every zoom point from your clicks. Your manual changes to zooms will be lost.', confirmLabel: 'Replace' })) return;
          state.zoomSegs = autoGenerate(); commit(); setSel('zoom'); ui.toast(`Generated ${state.zoomSegs.length} zoom points`, { kind: 'success' });
        } }, h('span', { html: ui.icon('sparkles') }), 'Generate from clicks'),
        h('button', { class: 'btn btn--secondary btn--sm', onclick: addZoomAtPlayhead }, h('span', { html: ui.icon('plus') }), 'Add at playhead')),
    ]),
    section('Defaults', [
      fRange('Zoom level', { min: 1.2, max: 4, step: 0.1, get: () => state.zoomScale, set: (v) => { state.zoomScale = v; }, fmtv: (v) => `${(+v).toFixed(1)}×` }),
      h('p', { class: 'hint' }, 'Applies to newly created zooms.'),
    ]),
    section('Zoom points', state.zoomSegs.length ? [list] : [h('div', { class: 'empty', style: 'padding:var(--space-4)' }, h('p', { class: 'muted' }, 'No zooms yet. Add one at the playhead or generate them from your clicks.'))]),
  );
}

function inspZoomItem(body) {
  const g = segById(sel.id);
  if (!g) return inspZoomOverview(body);
  head('zoom-in', 'Zoom', `${fmt1(g.start)} – ${fmt1(g.end)}`);
  const upd = () => { renderTimeline(); dirty = true; };
  body.append(
    section('Timing', [
      fNumber('Start', { get: () => g.start, min: 0, max: dur, set: (v) => { const len = g.end - g.start; g.start = clamp(v, 0, dur - MIN_ZOOM_LEN); g.end = Math.min(dur, Math.max(g.end, g.start + MIN_ZOOM_LEN)); if (g.end - g.start > len) g.end = g.start + len; } }),
      fNumber('Duration', { get: () => g.end - g.start, min: MIN_ZOOM_LEN, max: dur, set: (v) => { g.end = clamp(g.start + Math.max(MIN_ZOOM_LEN, v), g.start + MIN_ZOOM_LEN, dur); } }),
    ]),
    section('Scale', [
      fRange('Level', { min: 1.2, max: 4, step: 0.1, get: () => g.scale, set: (v) => { g.scale = v; }, fmtv: (v) => `${(+v).toFixed(1)}×`, live: upd }),
    ]),
    section('Focus', [
      fToggle('Follow cursor', () => g.follow, (v) => { g.follow = v; renderTimeline(); renderInspector(); }, !track.length),
      h('p', { class: 'hint' }, g.follow ? 'The camera follows the pointer during this zoom.' : 'Click the preview to set the focus point.'),
    ]),
    section('Motion', [
      fSelect('Easing', [{ value: 'smooth', label: 'Smooth' }, { value: 'out', label: 'Ease out' }, { value: 'linear', label: 'Linear' }], () => g.ease, (v) => { g.ease = v; }),
      fRange('Transition in', { min: 0.2, max: 1.5, step: 0.1, get: () => g.inDur, set: (v) => { g.inDur = v; }, fmtv: (v) => `${(+v).toFixed(1)}s` }),
      fRange('Transition out', { min: 0.2, max: 1.5, step: 0.1, get: () => g.outDur, set: (v) => { g.outDur = v; }, fmtv: (v) => `${(+v).toFixed(1)}s` }),
    ], false),
    h('div', { class: 'inspector__pad actions' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: duplicateZoom }, h('span', { html: ui.icon('copy') }), 'Duplicate'),
      h('button', { class: 'btn btn--secondary btn--sm', onclick: splitZoom }, h('span', { html: ui.icon('scissors') }), 'Split'),
      h('button', { class: 'btn btn--secondary btn--sm', onclick: deleteSelection }, h('span', { html: ui.icon('trash') }), 'Delete')),
  );
}

function inspCursor(body) {
  const c = state.cursor;
  head('cursor', 'Cursor', downs.length ? `${downs.length} clicks recorded` : 'Pointer effects');
  body.append(
    section('Appearance', [
      fToggle('Smooth cursor', () => c.arrow, (v) => { c.arrow = v; }),
      h('p', { class: 'hint' }, meta.cursorHidden ? 'Replaces the system cursor with a smoothed one.' : 'The system cursor is already in the recording, so this is off by default to avoid two cursors.'),
      fRange('Size', { min: 0.6, max: 3, step: 0.1, get: () => c.size, set: (v) => { c.size = v; }, fmtv: (v) => `${(+v).toFixed(1)}×` }),
    ]),
    section('Interaction', [
      fToggle('Highlight', () => c.ring, (v) => { c.ring = v; }),
      fToggle('Click ripple', () => c.ripple, (v) => { c.ripple = v; }),
    ]),
    section('Motion', [
      fRange('Smoothing', { min: 0, max: 100, get: () => c.smoothing, set: (v) => { c.smoothing = v; }, fmtv: (v) => `${v}`, live: () => { cancelAnimationFrame(rebuildRaf); rebuildRaf = requestAnimationFrame(rebuildTrack); } }),
    ]),
    section('Advanced', [
      fRange('Highlight size', { min: 0.5, max: 2, step: 0.1, get: () => c.ringSize, set: (v) => { c.ringSize = v; }, fmtv: (v) => `${(+v).toFixed(1)}×` }),
    ], false),
  );
}
let rebuildRaf = 0;

function inspCamera(body) {
  const c = state.cam;
  head('camera', 'Camera', LAYOUT_LABEL[c.layout]);
  if (!meta.hasCam) {
    body.append(h('div', { class: 'empty' }, h('p', { class: 'muted' }, 'This recording has no camera. Turn the camera on in the recorder to add a presenter next time.')));
    return;
  }
  const re = () => { renderTimeline(); renderInspector(); };
  appendAll(body,
    section('Layout', [
      fSeg('Layout', [{ value: 'off', label: 'Off' }, { value: 'pip', label: 'PiP' }, { value: 'full', label: 'Full' }, { value: 'side', label: 'Side' }], () => c.layout, (v) => { c.layout = v; re(); }),
      h('p', { class: 'hint' }, { off: 'Camera hidden.', pip: 'A small camera over the screen recording.', full: 'The camera fills the frame.', side: 'Screen and camera next to each other.' }[c.layout]),
    ]),
    c.layout === 'pip' && section('Size & position', [
      fRange('Size', { min: 10, max: 40, get: () => c.size, set: (v) => { c.size = v; }, fmtv: (v) => `${v}%` }),
      fSelect('Position', [{ value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }, { value: 'tr', label: 'Top right' }, { value: 'tl', label: 'Top left' }], () => c.pos, (v) => { c.pos = v; }),
    ]),
    c.layout !== 'off' && section('Style', [
      c.layout === 'pip' && fSeg('Shape', [{ value: 'circle', label: 'Circle' }, { value: 'round', label: 'Rounded' }, { value: 'square', label: 'Square' }], () => c.shape, (v) => { c.shape = v; }),
      fToggle('Border', () => c.border, (v) => { c.border = v; }),
      fRange('Shadow', { min: 0, max: 100, get: () => c.shadow, set: (v) => { c.shadow = v; }, fmtv: (v) => `${v}` }),
      fToggle('Mirror', () => c.mirror, (v) => { c.mirror = v; }),
    ]),
  );
}

// ======================================================================
// Export
// ======================================================================
const PRESETS = [
  { id: 'youtube', name: 'YouTube', desc: '16:9 · 1080p · 30 fps', aspect: '16:9', fmt: 'mp4', res: 1080, fps: 30, q: 'high' },
  { id: 'shorts', name: 'Shorts / TikTok', desc: '9:16 · 1080×1920 · 30 fps', aspect: '9:16', fmt: 'mp4', res: 1080, fps: 30, q: 'high' },
  { id: 'linkedin', name: 'LinkedIn', desc: '1:1 · 1080 · 30 fps', aspect: '1:1', fmt: 'mp4', res: 1080, fps: 30, q: 'high' },
  { id: 'presentation', name: 'Presentation', desc: '16:9 · 1080p · 60 fps', aspect: '16:9', fmt: 'mp4', res: 1080, fps: 60, q: 'max' },
  { id: 'gif', name: 'GIF', desc: '16:9 · 720p · 15 fps', aspect: '16:9', fmt: 'gif', res: 720, fps: 15, q: 'standard' },
  { id: 'custom', name: 'Custom', desc: 'Choose your own settings', aspect: null, fmt: 'mp4', res: 1080, fps: 30, q: 'high' },
];
const CRF = { standard: 20, high: 16, max: 13 }; // x264 veryfast: crf 16 ≈ the size/quality of the old medium crf 18

// Frame pacing that doesn't depend on display refresh: requestAnimationFrame stalls when the window is
// covered or minimised, which silently dropped export to ~16 fps. A MessageChannel keeps ticking.
const paceChannel = new MessageChannel();
const paceTick = () => new Promise((r) => { paceChannel.port1.onmessage = () => r(); paceChannel.port2.postMessage(0); });
function outSize(cfg) {
  const [bw, bh] = ASPECTS[cfg.aspect || state.aspect];
  const s = cfg.res / 1080;
  return [even(bw * s), even(bh * s)];
}

async function openExport(presetId = 'youtube') {
  const base = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  const cfg = { ...base, aspect: base.aspect || state.aspect, audio: !!meta.hasAudio };
  const summary = h('div', { class: 'export-summary' });
  const upd = () => {
    const [w, hh] = outSize(cfg);
    summary.textContent = `${w}×${hh} · ${cfg.fps} fps · ${cfg.fmt.toUpperCase()} · renders in real time (about ${fmt(state.trimEnd - state.trimStart)})`;
  };
  const presetBtns = PRESETS.map((p) => h('button', { class: 'preset', role: 'radio', 'data-value': p.id, 'aria-checked': String(p.id === cfg.id), tabindex: p.id === cfg.id ? '0' : '-1' }, p.name, h('span', {}, p.desc)));
  const presetGrid = h('div', { class: 'presets', role: 'radiogroup', 'aria-label': 'Export preset' }, presetBtns);
  const adv = h('div', { class: 'export-adv' });
  const markCustom = () => { cfg.id = 'custom'; presetBtns.forEach((b) => { const on = b.dataset.value === 'custom'; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); upd(); };
  const mkSel = (label, opts, key, parse = (v) => v) => {
    const s = h('select', { class: 'select', 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = cfg[key]; s.addEventListener('change', () => { cfg[key] = parse(s.value); markCustom(); });
    return [label, s, key];
  };
  const controls = [
    mkSel('Format', [['mp4', 'MP4'], ['gif', 'GIF']], 'fmt'),
    mkSel('Aspect ratio', Object.keys(ASPECTS).map((k) => [k, k]), 'aspect'),
    mkSel('Resolution', [[720, '720p'], [1080, '1080p'], [1440, '1440p']], 'res', Number),
    mkSel('Frame rate', [[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], 'fps', Number),
    mkSel('Quality', [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']], 'q'),
  ];
  const rebuildAdv = () => {
    adv.replaceChildren(...controls.map(([label, s, key]) => { s.value = cfg[key]; return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'field__control' }, s)); }));
    if (meta.hasAudio) {
      const a = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Include audio' }); a.checked = cfg.audio;
      a.addEventListener('change', () => { cfg.audio = a.checked; });
      adv.append(h('div', { class: 'field' }, h('label', {}, 'Audio'), h('div', { class: 'field__control' }, h('label', { class: 'toggle' }, a, h('span', { class: 'toggle__track' })))));
    }
  };
  rebuildAdv();
  ui.segmented(presetGrid, (id) => {
    const p = PRESETS.find((x) => x.id === id);
    Object.assign(cfg, { id: p.id, fmt: p.fmt, res: p.res, fps: p.fps, q: p.q, aspect: p.aspect || cfg.aspect });
    rebuildAdv(); upd();
  });
  upd();
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:var(--space-3)' },
    presetGrid,
    h('details', { class: 'section', style: 'border:0' }, h('summary', { style: 'padding:0;height:28px' }, 'Advanced', h('span', { html: ui.icon('chevron-down') })), adv),
    summary);
  const go = await ui.dialog({ title: 'Export', body, wide: true, actions: [{ label: 'Cancel', value: false }, { label: 'Export', value: true, kind: 'primary', primary: true }] });
  if (go) runExport(cfg);
}

const exportMenu = $('#exportMenu');
function buildExportMenu() {
  exportMenu.replaceChildren(h('div', { class: 'menu__label t-micro subtle' }, 'Export for'),
    ...PRESETS.filter((p) => p.id !== 'custom').map((p) => h('button', { class: 'menu__item', role: 'menuitem', onclick: () => { closeMenu(); openExport(p.id); } }, p.name, h('small', {}, p.desc.split(' · ').slice(0, 2).join(' · ')))));
}
function closeMenu() { exportMenu.hidden = true; $('#exportMenuBtn').setAttribute('aria-expanded', 'false'); }
$('#exportMenuBtn').onclick = (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; $('#exportMenuBtn').setAttribute('aria-expanded', String(!exportMenu.hidden)); if (!exportMenu.hidden) exportMenu.querySelector('button')?.focus(); };
document.addEventListener('click', closeMenu);
exportMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); $('#exportMenuBtn').focus(); } });
$('#exportBtn').onclick = () => openExport('youtube');

function progressDialog(onCancel) {
  const title = h('h2', { class: 't-h2', id: 'pg-title' }, 'Exporting…');
  const sub = h('p', {}, 'Keep this window open. Export renders in real time.');
  const bar = h('div', { class: 'progress__bar' });
  const cancel = h('button', { class: 'btn btn--secondary', onclick: onCancel }, 'Cancel');
  const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pg-title' },
    h('div', { class: 'dialog__head' }, title),
    h('div', { class: 'dialog__body' }, sub, h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar)),
    h('div', { class: 'dialog__foot' }, cancel));
  const back = h('div', { class: 'dialog-backdrop' }, dlg);
  document.body.append(back); cancel.focus();
  return {
    set(t, s, pct) { if (t) title.textContent = t; if (s) sub.textContent = s; if (pct != null) { bar.style.width = `${pct}%`; dlg.querySelector('.progress').setAttribute('aria-valuenow', Math.round(pct)); } },
    busy() { cancel.hidden = true; },
    close() { back.remove(); },
  };
}

async function runExport(cfg) {
  if (state.aspect !== cfg.aspect) { state.aspect = cfg.aspect; setAspect(); commit(); renderInspector(); }
  const format = cfg.fmt === 'gif' ? 'gif' : 'mp4';
  const [W, H] = outSize(cfg);
  const id = await api.invoke('export:begin', { format, name, fps: cfg.fps, crf: CRF[cfg.q] });
  if (!id) return;
  pause();
  exporting = true;
  let cancelled = false;
  const prog = progressDialog(() => { cancelled = true; });
  const prevT = screenV.currentTime;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(c);
  const x = c.getContext('2d');
  try {
    screenV.volume = 0; // silent while exporting; captureStream() below is unaffected by element volume
    await new Promise((res) => { screenV.addEventListener('seeked', res, { once: true }); seek(state.trimStart); });
    await settleSeeks(); // the camera clip may still be seeking (sparse keyframes)
    draw(x, W, H, state.trimStart);

    const stream = c.captureStream(cfg.fps);
    // Audio comes straight from the element (no Web Audio graph: a MediaElementSource route stalled the video clock).
    if (meta.hasAudio && cfg.audio && format !== 'gif') screenV.captureStream().getAudioTracks().forEach((t) => stream.addTrack(t));
    // Hardware H.264 first (measured: ~28 fps and half the intermediate size vs software VP9 at ~16–27 fps).
    const mime = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const pixels = (W * H) / (1920 * 1080);
    const bps = Math.round(clamp(20_000_000 * pixels * (cfg.fps / 30), 8_000_000, 45_000_000)); // high-bitrate intermediate; ffmpeg makes the small final file
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps });
    let chain = Promise.resolve();
    rec.ondataavailable = (e) => { if (e.data.size) chain = chain.then(async () => api.invoke('export:chunk', { id, buf: await e.data.arrayBuffer() })); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    // Start playback first and begin recording only once frames are actually moving, so the file doesn't open on a held frame.
    await screenV.play();
    if (meta.hasCam) camV.play().catch(() => {});
    const startedWaiting = performance.now();
    while (screenV.currentTime <= state.trimStart + 0.03 && performance.now() - startedWaiting < 3000) await new Promise((r) => setTimeout(r, 10));
    rec.start(1000);
    const span = state.trimEnd - state.trimStart;
    const interval = 1000 / cfg.fps;
    let last = 0;
    for (;;) {
      await paceTick();
      const now = performance.now();
      if (now - last < interval - 2) { await new Promise((r) => setTimeout(r, 1)); continue; } // don't spin a core between frames
      last = now;
      const t = screenV.currentTime;
      if (cancelled || t >= state.trimEnd - 0.02 || screenV.ended) break;
      syncCam(t);
      draw(x, W, H, t);
      prog.set(null, `About ${fmt(Math.max(0, state.trimEnd - t))} left. Keep this window open.`, clamp((t - state.trimStart) / span) * 100);
    }
    screenV.pause(); camV.pause();
    rec.stop();
    await stopped; await chain;

    if (cancelled) { await api.invoke('export:cancel', id); ui.toast('Export cancelled'); }
    else {
      prog.busy(); prog.set('Finishing…', `Writing your ${format.toUpperCase()} file.`, 100);
      const out = await api.invoke('export:finish', { id });
      ui.toast('Export complete', { kind: 'success', action: { label: 'Show file', onClick: () => api.invoke('project:reveal', name) }, duration: 6000 });
      console.info('exported to', out);
    }
  } catch (e) {
    console.error(e);
    await api.invoke('export:cancel', id);
    ui.toast(`Export failed: ${String(e.message || e).slice(0, 120)}`, { kind: 'error', duration: 8000 });
  } finally {
    c.remove(); prog.close();
    screenV.volume = 1;
    exporting = false;
    seek(prevT);
  }
}

// ======================================================================
// Keyboard
// ======================================================================
const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && !['range', 'checkbox'].includes(document.activeElement.type);
addEventListener('keydown', (e) => {
  if (document.querySelector('.dialog-backdrop')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow().then(() => ui.toast('Project saved', { kind: 'success' })); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateZoom(); return; }
  if (typing() || mod) return;
  if (e.code === 'Space' && !(document.activeElement?.tagName === 'BUTTON')) { e.preventDefault(); playing ? pause() : play(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(screenV.currentTime - (e.shiftKey ? 1 : 0.1)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(screenV.currentTime + (e.shiftKey ? 1 : 0.1)); }
  else if (e.key === 'Home') seek(state.trimStart);
  else if (e.key === 'End') seek(state.trimEnd);
  else if (e.key.toLowerCase() === 's') splitZoom();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
  else if (e.key.toLowerCase() === 'r') api.invoke('launcher:show');
});

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#themeBtn').onclick = () => window.toggleTheme();
$('#folderBtn').onclick = () => api.invoke('project:reveal', name);
$('#homeBtn').onclick = () => api.invoke('launcher:show');

// ======================================================================
// Boot
// ======================================================================
async function boot() {
  $('#projName').textContent = name;
  document.title = `${name} — ViewBox`;
  buildExportMenu();
  const loaded = await api.invoke('project:load', name);
  meta = loaded.meta;
  crop = meta.crop;

  screenV.src = mediaUrl('screen.webm');
  if (meta.hasCam) camV.src = mediaUrl('cam.webm');
  await new Promise((res, rej) => { screenV.onloadedmetadata = res; screenV.onerror = () => rej(new Error('Could not load the recording.')); });
  if (!Number.isFinite(screenV.duration)) {
    screenV.currentTime = 1e9;
    await new Promise((r) => screenV.addEventListener('durationchange', r, { once: true }));
    screenV.currentTime = 0;
  }
  dur = Number.isFinite(screenV.duration) ? screenV.duration : meta.duration;
  vw = screenV.videoWidth; vh = screenV.videoHeight;

  state = normalize(loaded.state);
  nextId = Math.max(0, ...state.zoomSegs.map((g) => g.id)) + 1;
  buildTrack();
  let generated = 0;
  if (!loaded.state && downs.length) { state.zoomSegs = autoGenerate(); generated = state.zoomSegs.length; }
  rebuildTrack();

  history = [snap()]; hIdx = 0;
  setAspect(); renderTimeline(); renderInspector(); updateRail(); updateTools(); updateHistoryButtons();
  seek(0);
  $('#loading').hidden = true;
  requestAnimationFrame(frame);
  if (generated) ui.toast(`Generated ${generated} zoom point${generated === 1 ? '' : 's'} from your clicks`, { kind: 'success' });
}
boot().catch((e) => {
  console.error(e);
  $('#loading').replaceChildren(h('div', { class: 'empty' },
    h('div', { class: 'empty__icon', html: ui.icon('alert', 'icon--lg') }),
    h('h2', { class: 't-h3' }, 'Couldn’t open this recording'),
    h('p', { class: 'muted' }, e.message || 'The files may be missing or damaged.'),
    h('button', { class: 'btn btn--secondary', onclick: () => api.invoke('launcher:show') }, 'Back to recordings')));
});
