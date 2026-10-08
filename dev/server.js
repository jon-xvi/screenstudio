// Dev-only harness: serves renderer/ + recordings over http with a mocked `api`, so screens can be inspected in a browser.
// Usage: node dev/server.js   →  http://localhost:5177/launcher.html  |  /editor.html?project=<name>  |  /controls.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', 'renderer');
const REC = path.join(os.homedir(), 'Documents', 'ViewBox Recordings');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webm': 'video/webm', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'text/plain') { res.writeHead(code, { 'Content-Type': type }); res.end(body); }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && p === '/__save') { // benchmark helper: stores an uploaded blob in the OS temp dir
    const dir = path.join(os.tmpdir(), 'ss-bench'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(url.searchParams.get('name') || 'out.webm'));
    const ws = fs.createWriteStream(file);
    req.pipe(ws);
    return ws.on('finish', () => send(res, 200, file));
  }
  if (p === '/__mock.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'mock.js')), 'text/javascript');
  if (p === '/__api/projects') {
    const list = fs.existsSync(REC) ? fs.readdirSync(REC).filter((n) => fs.existsSync(path.join(REC, n, 'meta.json'))).sort().reverse().map((n) => {
      let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(REC, n, 'meta.json'), 'utf8')); } catch { /* skip */ }
      return { name: n, createdAt: m.createdAt, duration: m.duration || 0, mode: m.mode || 'screen', hasCam: !!m.hasCam };
    }) : [];
    return send(res, 200, JSON.stringify(list), 'application/json');
  }
  if (p.startsWith('/__api/project/')) {
    const n = p.slice('/__api/project/'.length);
    const dir = path.join(REC, n);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    let state = null; try { state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { /* none */ }
    return send(res, 200, JSON.stringify({ meta, state }), 'application/json');
  }

  const isMedia = p.startsWith('/media/');
  const root = isMedia ? REC : ROOT;
  const file = path.resolve(root, '.' + (isMedia ? p.slice('/media'.length) : p === '/' ? '/launcher.html' : p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
  const type = TYPES[path.extname(file)] || 'application/octet-stream';

  if (type === 'text/html') { // inject the mock before any page script runs
    return send(res, 200, fs.readFileSync(file, 'utf8').replace('</head>', '<script src="/__mock.js"></script></head>'), type);
  }
  const size = fs.statSync(file).size;
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = +s, end = e ? +e : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}).listen(5177, () => console.log('dev harness on http://localhost:5177'));
