// Dev-only stand-in for the Electron preload `api`. Not shipped.
window.__mediaBase = '/media/';
const getJSON = (u) => fetch(u).then((r) => r.json());
const handlers = {
  'displays:list': async () => [{ id: 1, primary: true, label: 'Display 1 (primary) — 1920×1080', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
  'thumbs:get': async () => ({ screens: {}, window: null }),
  'projects:list': () => getJSON('/__api/projects'),
  'project:load': (name) => getJSON(`/__api/project/${encodeURIComponent(name)}`),
  'project:save': async () => true,
  'sources:list': async () => [],
  'controls:get-config': async () => ({ mic: true, cam: true, sys: false }),
};
window.api = {
  invoke: async (ch, ...a) => { const f = handlers[ch]; if (f) return f(...a); console.info('[mock api]', ch, a); return null; },
  send: (ch, ...a) => console.info('[mock send]', ch, a),
  on: () => () => {},
};
