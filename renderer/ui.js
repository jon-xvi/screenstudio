/* ScreenStudio UI runtime: icon sprite, tooltips, toasts, dialogs, range fill, segmented controls. */
(function () {
  // One icon system: 24px grid, stroke drawn by .icon (1.75, round caps).
  const ICONS = {
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    camera: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    'camera-off': '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><path d="M16 16v-1M10 6h4a2 2 0 0 1 2 2v2M2 8v8a2 2 0 0 0 2 2h10"/><path d="m2 2 20 20"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    'mic-off': '<path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M19 10v2a7 7 0 0 1-.11 1.23M5 10v2a7 7 0 0 0 12 5M12 19v3"/><path d="m2 2 20 20"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    'volume-off': '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    play: '<path d="M7 4.5v15a.5.5 0 0 0 .77.42l11.5-7.5a.5.5 0 0 0 0-.84L7.77 4.08A.5.5 0 0 0 7 4.5z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    record: '<circle cx="12" cy="12" r="7"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
    'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    cursor: '<path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
    more: '<path d="M12 12h.01M19 12h.01M5 12h.01"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  };

  function sprite() {
    if (document.getElementById('ss-sprite')) return;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.id = 'ss-sprite';
    s.setAttribute('width', '0'); s.setAttribute('height', '0');
    s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('');
    document.body.prepend(s);
  }

  function icon(name, cls = '') {
    return `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('i[data-icon]').forEach((el) => {
      const wrap = document.createElement('span');
      wrap.innerHTML = icon(el.dataset.icon, el.dataset.class || '');
      const svg = wrap.firstChild;
      if (el.dataset.fill !== undefined) svg.classList.add('icon--fill');
      el.classList.forEach((c) => svg.classList.add(c)); // keep layout classes set on the placeholder
      if (el.id) svg.id = el.id;
      el.replaceWith(svg);
    });
    root.querySelectorAll('[data-tip]').forEach((el) => {
      if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', el.dataset.tip);
    });
    root.querySelectorAll('input.range').forEach(syncRange);
  }

  // ---- slider fill ----
  function syncRange(el) {
    const min = +el.min || 0, max = +el.max || 100;
    el.style.setProperty('--fill', `${((el.value - min) / (max - min)) * 100}%`);
  }
  document.addEventListener('input', (e) => { if (e.target.matches?.('input.range')) syncRange(e.target); });

  // ---- tooltips (one floating element; shows on hover/focus after a short delay) ----
  let tip = null, tipTimer = null;
  function showTip(el) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
      tip.textContent = el.dataset.tip;
      if (el.dataset.kbd) { const k = document.createElement('kbd'); k.textContent = el.dataset.kbd; tip.append(k); }
      const r = el.getBoundingClientRect();
      tip.style.left = '0px'; tip.style.top = '0px';
      const tr = tip.getBoundingClientRect();
      const below = r.top < tr.height + 12;
      let x = r.left + r.width / 2 - tr.width / 2;
      x = Math.max(8, Math.min(innerWidth - tr.width - 8, x));
      tip.style.left = `${x}px`;
      tip.style.top = `${below ? r.bottom + 8 : r.top - tr.height - 8}px`;
      tip.classList.add('is-visible');
    }, 450);
  }
  function hideTip() { clearTimeout(tipTimer); tip?.classList.remove('is-visible'); }
  document.addEventListener('pointerover', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-tip]'); if (t && e.target.matches(':focus-visible')) showTip(t); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip);

  // ---- toasts ----
  function toast(message, { kind = 'info', action, duration = 3500 } = {}) {
    let region = document.querySelector('.toast-region');
    if (!region) { region = document.createElement('div'); region.className = 'toast-region'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite'); document.body.append(region); }
    const t = document.createElement('div');
    t.className = `toast toast--${kind}`;
    t.innerHTML = icon(kind === 'success' ? 'check' : kind === 'error' ? 'alert' : 'info');
    const msg = document.createElement('span');
    msg.textContent = message;
    t.append(msg);
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn btn--tertiary btn--sm';
      b.textContent = action.label;
      b.onclick = () => { action.onClick(); t.remove(); };
      t.append(b);
    }
    region.append(t);
    setTimeout(() => t.remove(), duration);
  }

  // ---- dialogs (focus trapped, Esc closes) ----
  function dialog({ title, body, actions, wide = false, labelledBy = 'dlg-title' }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const back = document.createElement('div');
      back.className = 'dialog-backdrop';
      const d = document.createElement('div');
      d.className = `dialog${wide ? ' dialog--wide' : ''}`;
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', labelledBy);
      const head = document.createElement('div'); head.className = 'dialog__head';
      const h = document.createElement('h2'); h.className = 't-h2'; h.id = labelledBy; h.textContent = title; head.append(h);
      const bodyEl = document.createElement('div'); bodyEl.className = 'dialog__body';
      if (typeof body === 'string') { const p = document.createElement('p'); p.textContent = body; bodyEl.append(p); } else if (body) bodyEl.append(body);
      const foot = document.createElement('div'); foot.className = 'dialog__foot';
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
      let primary = null;
      for (const a of actions) {
        const b = document.createElement('button');
        b.className = `btn btn--${a.kind || 'secondary'}`;
        b.textContent = a.label;
        b.onclick = () => close(a.value);
        if (a.primary) primary = b;
        foot.append(b);
      }
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
        if (e.key === 'Tab') {
          const f = [...d.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKey, true);
      d.append(head, bodyEl, foot); back.append(d); document.body.append(back);
      hydrate(d);
      (primary || foot.lastChild)?.focus();
      back._close = close;
    });
  }
  function confirm({ title, body, confirmLabel = 'Confirm', destructive = false }) {
    return dialog({ title, body, actions: [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, kind: destructive ? 'destructive' : 'primary', primary: true }] }).then(Boolean);
  }

  // ---- segmented control (radiogroup with arrow-key support) ----
  function segmented(el, onChange) {
    const btns = () => [...el.querySelectorAll('button[role="radio"]')];
    const set = (value, fire = true) => {
      btns().forEach((b) => { const on = b.dataset.value === String(value); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
      if (fire) onChange?.(String(value));
    };
    el.addEventListener('click', (e) => { const b = e.target.closest('button[role="radio"]'); if (b && !b.disabled) set(b.dataset.value); });
    el.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const list = btns().filter((b) => !b.disabled);
      const i = list.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const n = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
      n.focus(); set(n.dataset.value);
    });
    return { set };
  }

  window.ui = { icon, hydrate, toast, dialog, confirm, segmented, syncRange, ICONS };
  document.addEventListener('DOMContentLoaded', () => { sprite(); hydrate(); });
})();
