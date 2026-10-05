const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE_LABEL = { screen: 'Full screen', custom: 'Custom area', window: 'Window' };
const toggles = { cam: true, mic: true, sys: true };
let mode = 'screen';
let phase = 'idle'; // idle | preparing | countdown | recording | paused | stopping | processing
let session = null;

// ---------- window chrome ----------
$('#minBtn').onclick = () => api.send('win:minimize');
$('#closeBtn').onclick = () => api.send('win:close');
$('#themeBtn').onclick = () => window.toggleTheme();

// ---------- tabs ----------
const tabs = { record: $('#tab-record'), recordings: $('#tab-recordings') };
function showView(name) {
  for (const k of ['record', 'recordings', 'processing']) $(`#view-${k}`).hidden = k !== name;
  for (const [k, el] of Object.entries(tabs)) { el.setAttribute('aria-selected', String(k === name)); el.tabIndex = k === name ? 0 : -1; }
  if (name === 'recordings') loadRecordings();
}
tabs.record.onclick = () => phase === 'idle' && showView('record');
tabs.recordings.onclick = () => phase === 'idle' && showView('recordings');
document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const next = document.activeElement === tabs.record ? tabs.recordings : tabs.record;
  next.focus(); next.click();
});
$('#emptyStart').onclick = () => showView('record');

// ---------- status ----------
function setPhase(p) {
  phase = p;
  const busy = p !== 'idle';
  const b = $('#startBtn');
  b.disabled = busy && p !== 'preparing';
  b.setAttribute('aria-busy', String(p === 'preparing'));
}
function showAlert(kind, message) {
  const slot = $('#alertSlot');
  slot.replaceChildren();
  const a = document.createElement('div');
  a.className = `alert alert--${kind}`;
  a.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  a.innerHTML = ui.icon(kind === 'error' ? 'alert' : 'info');
  const t = document.createElement('span');
  t.textContent = message;
  a.append(t);
  slot.append(a);
}
const clearAlert = () => $('#alertSlot').replaceChildren();

// ---------- mode ----------
document.querySelectorAll('.mode').forEach((b) => { b.dataset.value = b.dataset.mode; b.ondblclick = () => startFlow(); });
ui.segmented($('.modes'), (v) => { mode = v; renderSummary(); clearAlert(); });

// ---------- inputs ----------
function setToggle(btn, on, onIcon, offIcon) {
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('use').setAttribute('href', `#i-${on ? onIcon : offIcon}`);
}
const TG = {
  cam: { btn: '#camTgl', sel: '#camSel', on: 'camera', off: 'camera-off' },
  mic: { btn: '#micTgl', sel: '#micSel', on: 'mic', off: 'mic-off' },
  sys: { btn: '#sysTgl', sel: null, on: 'volume', off: 'volume-off' },
};
for (const [k, c] of Object.entries(TG)) {
  $(c.btn).onclick = () => { toggles[k] = !toggles[k]; setToggle($(c.btn), toggles[k], c.on, c.off); renderSummary(); };
}
const available = (k) => !TG[k].sel || !$(TG[k].sel).disabled;
const enabled = (k) => toggles[k] && available(k);
const deviceName = (sel) => $(sel).selectedOptions[0]?.text || '';

function fillSelect(sel, devices, fallback) {
  sel.replaceChildren();
  if (!devices.length) { sel.append(new Option(fallback, '')); sel.disabled = true; return; }
  sel.disabled = false;
  devices.forEach((d, i) => sel.append(new Option(d.label || `${fallback.replace('No ', '').replace(' found', '')} ${i + 1}`, d.deviceId)));
}

async function loadDevices() {
  try {
    const t = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    t.getTracks().forEach((x) => x.stop());
  } catch {
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((x) => x.stop()); } catch { /* no permission */ }
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  fillSelect($('#camSel'), all.filter((d) => d.kind === 'videoinput'), 'No camera found');
  fillSelect($('#micSel'), all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'), 'No microphone found');
  for (const k of ['cam', 'mic']) $(TG[k].btn).disabled = !available(k);

  const displays = await api.invoke('displays:list');
  const sel = $('#displaySel');
  sel.replaceChildren();
  displays.forEach((d) => sel.append(new Option(d.label, d.id)));
  sel.value = (displays.find((d) => d.primary) || displays[0]).id;
  $('#displayRow').hidden = displays.length < 2;
  renderSummary();
}
loadDevices();
['#camSel', '#micSel', '#displaySel'].forEach((s) => $(s).addEventListener('change', renderSummary));

function renderSummary() {
  const ul = $('#summaryList');
  ul.replaceChildren();
  const add = (k, v) => {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = k;
    const s = document.createElement('span'); s.textContent = v; s.title = v;
    li.append(b, s); ul.append(li);
  };
  const multi = !$('#displayRow').hidden;
  add('Capture', MODE_LABEL[mode] + (multi && mode !== 'window' ? ` · ${deviceName('#displaySel').split(' — ')[0]}` : ''));
  add('Camera', !available('cam') ? 'Not available' : enabled('cam') ? deviceName('#camSel') : 'Off');
  add('Microphone', !available('mic') ? 'Not available' : enabled('mic') ? deviceName('#micSel') : 'Off');
  add('System audio', toggles.sys ? 'On' : 'Off');
}

// ---------- live card previews ----------
let thumbs = { screens: {}, window: null };
function paintThumbs() {
  const shot = thumbs.screens[$('#displaySel').value] || Object.values(thumbs.screens)[0];
  document.querySelectorAll('.shot').forEach((img) => { if (shot) img.src = shot; else img.removeAttribute('src'); });
  const w = $('.winshot');
  if (thumbs.window) w.src = thumbs.window; else w.removeAttribute('src');
}
api.invoke('thumbs:get').then((t) => { thumbs = t; paintThumbs(); });
api.on('thumbs:updated', (t) => { thumbs = t; paintThumbs(); });
$('#displaySel').addEventListener('change', paintThumbs);

// ---------- start flow ----------
$('#startBtn').onclick = () => startFlow();

async function pickWindow() {
  $('#startBtn').setAttribute('aria-busy', 'true');
  const sources = await api.invoke('sources:list');
  $('#startBtn').setAttribute('aria-busy', 'false');
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-3)';
  if (!sources.length) { grid.textContent = 'No windows found. Open the app you want to record and try again.'; }
  for (const s of sources) {
    const b = document.createElement('button');
    b.className = 'rec-card';
    const img = new Image(); img.src = s.thumbnail; img.alt = '';
    img.style.cssText = 'width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:var(--background-canvas)';
    const name = document.createElement('span');
    name.textContent = s.name;
    name.style.cssText = 'padding:var(--space-2) var(--space-3);font:var(--text-caption);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    b.append(img, name);
    b.onclick = () => document.querySelector('.dialog-backdrop')._close(s);
    grid.append(b);
  }
  return ui.dialog({ title: 'Choose a window', body: grid, wide: true, actions: [{ label: 'Cancel', value: null }] });
}

async function startFlow() {
  if (phase !== 'idle') return;
  clearAlert();
  const displayId = $('#displaySel').value;
  if (mode === 'screen') return startRecording({ mode, displayId });
  if (mode === 'custom') {
    setPhase('preparing');
    await api.invoke('launcher:hide');
    await sleep(250);
    const sel = await api.invoke('region:select', displayId);
    setPhase('idle');
    if (!sel) { await api.invoke('launcher:show'); return; }
    const { rect, bounds } = sel;
    return startRecording({
      mode, displayId: sel.displayId,
      crop: { x: rect.x / bounds.width, y: rect.y / bounds.height, w: rect.w / bounds.width, h: rect.h / bounds.height },
    });
  }
  const src = await pickWindow();
  if (src) startRecording({ mode: 'window', sourceId: src.id });
}

// ---------- recording ----------
const pickMime = (list) => list.find((m) => MediaRecorder.isTypeSupported(m));

async function startRecording(opts) {
  if (phase !== 'idle') return;
  setPhase('preparing');
  const out = { screenStream: null, camStream: null, micStream: null, ac: null };
  try {
    const prep = await api.invoke('record:prepare', { ...opts, systemAudio: toggles.sys });

    out.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 }, cursor: 'never' },
      audio: toggles.sys,
    });
    const vt = out.screenStream.getVideoTracks()[0];
    const settings = vt.getSettings();

    const degraded = [];
    if (enabled('mic')) {
      try {
        out.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: $('#micSel').value }, echoCancellation: true, noiseSuppression: true },
        });
      } catch (e) { console.warn('mic unavailable', e); degraded.push('microphone'); }
    }
    if (enabled('cam')) {
      try {
        out.camStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: $('#camSel').value }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e) { console.warn('camera unavailable', e); degraded.push('camera'); }
    }

    // mix system audio + mic into one track
    out.ac = new AudioContext();
    const dest = out.ac.createMediaStreamDestination();
    let hasAudio = false;
    if (out.screenStream.getAudioTracks().length) {
      out.ac.createMediaStreamSource(new MediaStream(out.screenStream.getAudioTracks())).connect(dest);
      hasAudio = true;
    }
    if (out.micStream) { out.ac.createMediaStreamSource(out.micStream).connect(dest); hasAudio = true; }
    const recStream = new MediaStream([vt, ...(hasAudio ? dest.stream.getAudioTracks() : [])]);

    await api.invoke('launcher:hide');
    setPhase('countdown');
    const go = await api.invoke('controls:open', { mic: !!out.micStream, cam: !!out.camStream, sys: out.screenStream.getAudioTracks().length > 0 });
    if (!go) throw Object.assign(new Error('cancelled'), { cancelled: true });

    session = beginRecorders(out, recStream, { prep, opts, hasAudio, settings });
    setPhase('recording');
    api.send('controls:started');
    if (degraded.length) console.warn('recording without', degraded.join(', '));
  } catch (e) {
    cleanup(out);
    await api.invoke('record:cancel-prepare');
    await api.invoke('controls:close');
    await api.invoke('launcher:show');
    setPhase('idle');
    if (!e.cancelled) {
      const denied = e.name === 'NotAllowedError' || e.name === 'NotFoundError';
      showAlert('error', denied
        ? 'Screen capture wasn’t available. Check that no other app is blocking capture, then try again.'
        : `Couldn’t start recording: ${e.message}`);
    }
  }
}

function cleanup(out) {
  [out.screenStream, out.camStream, out.micStream].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  out.ac?.close().catch(() => {});
}

function beginRecorders(out, recStream, ctx) {
  const mime = pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  const screenRec = new MediaRecorder(recStream, { mimeType: mime, videoBitsPerSecond: 14_000_000 });
  let chain = Promise.resolve();
  const wire = (rec, file) => {
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chain = chain.then(async () => api.invoke('rec:chunk', { file, buf: await e.data.arrayBuffer() }));
    };
  };
  wire(screenRec, 'screen.raw.webm');

  let camRec = null;
  if (out.camStream) {
    camRec = new MediaRecorder(out.camStream, {
      mimeType: pickMime(['video/webm;codecs=vp8', 'video/webm']), videoBitsPerSecond: 4_000_000,
    });
    wire(camRec, 'cam.raw.webm');
  }

  const s = { screenRec, camRec, out, ctx, startedAt: 0, camStartedAt: 0, paused: false, pauseStart: 0, pausedMs: 0, flush: () => chain };
  screenRec.onstart = () => { s.startedAt = performance.now(); };
  if (camRec) camRec.onstart = () => { s.camStartedAt = performance.now(); };
  camRec?.start(1000);
  screenRec.start(1000);
  api.invoke('track:start');
  // if the shared surface goes away (window closed), stop gracefully
  recStream.getVideoTracks()[0].onended = () => api.send('controls:stop');
  return s;
}

api.on('rec:pause-toggle', async () => {
  const s = session;
  if (!s || phase === 'stopping') return;
  if (!s.paused) {
    s.screenRec.pause(); s.camRec?.pause();
    await api.invoke('track:pause');
    s.paused = true; s.pauseStart = performance.now();
    setPhase('paused');
    api.send('hud:state', 'paused');
  } else {
    s.screenRec.resume(); s.camRec?.resume();
    await api.invoke('track:resume');
    s.pausedMs += performance.now() - s.pauseStart; s.paused = false;
    setPhase('recording');
    api.send('hud:state', 'recording');
  }
});

api.on('rec:stop', async () => {
  const s = session;
  if (!s) return;
  session = null;
  setPhase('stopping');
  api.send('hud:state', 'stopping');
  if (s.paused) s.pausedMs += performance.now() - s.pauseStart;
  const duration = (performance.now() - s.startedAt - s.pausedMs) / 1000;
  const stopped = (rec) => new Promise((res) => { rec.onstop = res; rec.stop(); });
  await Promise.all([stopped(s.screenRec), s.camRec ? stopped(s.camRec) : null]);
  await s.flush();
  const events = await api.invoke('track:stop');
  cleanup(s.out);

  const { prep, opts, hasAudio, settings } = s.ctx;
  const meta = {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: opts.mode,
    display: prep.display,
    crop: opts.crop || { x: 0, y: 0, w: 1, h: 1 },
    cursorValid: opts.mode !== 'window',
    cursorHidden: settings.cursor === 'never',
    hasAudio,
    hasCam: !!s.camRec,
    camOffset: s.camRec ? (s.camStartedAt - s.startedAt) / 1000 : 0,
    duration,
    events,
  };
  runProcessing(meta);
});

// ---------- processing ----------
const STEPS = ['Preparing recording', 'Processing camera and audio', 'Analyzing cursor movement', 'Preparing timeline'];
function renderSteps(active, done = false) {
  const ol = $('#steps');
  ol.replaceChildren();
  STEPS.forEach((label, i) => {
    const li = document.createElement('li');
    const state = done || i < active ? 'done' : i === active ? 'active' : 'pending';
    li.dataset.state = state;
    const mark = document.createElement('span');
    mark.className = 'steps__mark';
    mark.innerHTML = state === 'done' ? ui.icon('check') : state === 'active' ? '<span class="spinner"></span>' : '<span class="dot"></span>';
    const t = document.createElement('span');
    t.textContent = label;
    li.append(mark, t);
    ol.append(li);
  });
  $('#procBar').style.width = `${done ? 100 : (active / STEPS.length) * 100}%`;
}
api.on('proc:step', (i) => { if (phase === 'processing') renderSteps(i); });

async function runProcessing(meta) {
  setPhase('processing');
  $('#procTitle').textContent = 'Processing your recording';
  $('#procSub').textContent = 'This only takes a moment. The editor opens automatically.';
  $('#procError').hidden = true;
  renderSteps(0);
  showView('processing');
  try {
    const { stats } = await api.invoke('record:finalize', meta);
    renderSteps(STEPS.length, true);
    $('#procTitle').textContent = 'Recording ready';
    $('#procSub').textContent = stats.clicks
      ? `Found ${stats.clicks} click${stats.clicks === 1 ? '' : 's'}. Opening the editor with zooms ready.`
      : 'Opening the editor.';
    await sleep(1200);
    setPhase('idle');
    showView('record');
  } catch (e) {
    $('#procTitle').textContent = 'Couldn’t process the recording';
    $('#procSub').textContent = 'Your raw recording is still saved in the recordings folder.';
    $('#procErrorText').textContent = String(e.message || e).split('\n').slice(-2).join(' ');
    $('#procError').hidden = false;
  }
}
$('#procBack').onclick = () => { setPhase('idle'); showView('record'); };

// ---------- recordings ----------
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function parseName(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
function recCard(p) {
  const d = parseName(p.name);
  const title = d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : p.name;

  const art = document.createElement('article');
  art.className = 'rec-card';
  const thumb = document.createElement('div');
  thumb.className = 'rec-card__thumb';
  const v = document.createElement('video');
  v.muted = true; v.preload = 'metadata'; v.setAttribute('aria-hidden', 'true');
  v.src = `ss://app/media/${encodeURIComponent(p.name)}/screen.webm#t=0.5`;
  const dur = document.createElement('span');
  dur.className = 'rec-card__duration';
  dur.textContent = fmtDur(p.duration);
  thumb.append(v, dur);

  const body = document.createElement('div');
  body.className = 'rec-card__body';
  const open = document.createElement('button');
  open.className = 'rec-card__title';
  open.textContent = title;
  open.onclick = () => api.invoke('project:open', p.name);
  const meta = document.createElement('span');
  meta.className = 't-caption subtle';
  meta.textContent = `${MODE_LABEL[p.mode] || 'Screen'}${p.hasCam ? ' · Camera' : ''}`;
  body.append(open, meta);

  const actions = document.createElement('div');
  actions.className = 'rec-card__actions';
  const reveal = document.createElement('button');
  reveal.className = 'btn btn--icon btn--sm';
  reveal.innerHTML = ui.icon('folder');
  reveal.setAttribute('aria-label', `Show ${title} in folder`);
  reveal.dataset.tip = 'Show in folder';
  reveal.onclick = () => api.invoke('project:reveal', p.name);
  const del = document.createElement('button');
  del.className = 'btn btn--icon btn--sm';
  del.innerHTML = ui.icon('trash');
  del.setAttribute('aria-label', `Delete ${title}`);
  del.dataset.tip = 'Delete';
  del.onclick = async () => {
    const ok = await ui.confirm({
      title: 'Delete this recording?',
      body: 'The video files and your edits will be removed from this computer. This can’t be undone.',
      confirmLabel: 'Delete', destructive: true,
    });
    if (!ok) return;
    await api.invoke('project:delete', p.name);
    art.remove();
    ui.toast('Recording deleted', { kind: 'success' });
    loadRecordings();
  };
  actions.append(reveal, del);

  art.append(thumb, body, actions);
  return art;
}

async function loadRecordings() {
  const list = await api.invoke('projects:list');
  const grid = $('#recGrid');
  grid.replaceChildren(...list.map(recCard));
  grid.hidden = !list.length;
  $('#recEmpty').hidden = list.length > 0;
  $('#recCount').textContent = list.length ? `${list.length} recording${list.length === 1 ? '' : 's'}` : '';
}
