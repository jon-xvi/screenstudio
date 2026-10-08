// Fast static check: every JS file parses, and every inline <script> in the HTML parses.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
};
walk(root);

let failed = 0;
const fail = (f, msg) => { failed++; console.error(`✗ ${path.relative(root, f)}: ${msg}`); };
let count = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.js')) {
    try { new vm.Script(src, { filename: f }); count++; } catch (e) { fail(f, e.message); }
  } else if (f.endsWith('.html')) {
    for (const m of src.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      try { new vm.Script(m[1], { filename: f }); count++; } catch (e) { fail(f, `inline script: ${e.message}`); }
    }
  } else if (f.endsWith('.json') && !f.includes('package-lock')) {
    try { JSON.parse(src); count++; } catch (e) { fail(f, e.message); }
  }
}
console.log(failed ? `${failed} problem(s)` : `OK — ${count} scripts/JSON files parse`);
process.exit(failed ? 1 : 0);
