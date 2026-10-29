// Local preview: serves site/ and runs api/reviews.js against a fake in-memory Upstash.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'site');
process.env.KV_REST_API_URL = 'http://fake-upstash';
process.env.KV_REST_API_TOKEN = 'local';

const lists = new Map(), counters = new Map();
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url) !== 'http://fake-upstash') return realFetch(url, opts);
  const [cmd, key, a, b] = JSON.parse(opts.body);
  let result = null;
  if (cmd === 'LRANGE') { const l = lists.get(key) || []; result = l.slice(a, b + 1); }
  else if (cmd === 'LPUSH') { const l = lists.get(key) || []; l.unshift(a); lists.set(key, l); result = l.length; }
  else if (cmd === 'LTRIM') { const l = lists.get(key) || []; lists.set(key, l.slice(a, b + 1)); result = 'OK'; }
  else if (cmd === 'INCR') { counters.set(key, (counters.get(key) || 0) + 1); result = counters.get(key); }
  else if (cmd === 'EXPIRE') { result = 1; }
  return { json: async () => ({ result }) };
};

const handler = require(path.join(root, 'api', 'reviews.js'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/reviews') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { req.body = data ? JSON.parse(data) : {}; } catch (e) { req.body = {}; }
      handler(req, res);
    });
    return;
  }
  let f = path.join(root, url === '/' ? 'index.html' : decodeURIComponent(url));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(5174, () => console.log('dev server on http://localhost:5174'));
