// Local dev server for public/. No dependencies.
// localhost counts as a secure context, so the microphone and the service worker both work here.
// It also applies public/_headers, so the Content-Security-Policy is exercised before deploying.
// Usage: node tools/serve.js            (or: npm run dev)
//   PORT=3000 node tools/serve.js       pick a port (default 8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

// Netlify-style _headers: a path pattern line, then indented "Name: value" lines.
function loadHeaders() {
  const rules = [];
  let file;
  try { file = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'); } catch (e) { return rules; }
  for (const line of file.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rules.push({ pattern: line.trim(), headers: [] }); continue; }
    const i = line.indexOf(':');
    if (i > 0 && rules.length) rules[rules.length - 1].headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}
const matches = (pattern, url) => pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern;

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, url);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    for (const rule of loadHeaders()) if (matches(rule.pattern, url)) for (const [k, v] of rule.headers) res.setHeader(k, v);
    if (err || path.basename(file) === '_headers') { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, HOST, () => console.log(`Pitch Dial on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
