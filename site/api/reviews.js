// Visitor reviews: stored in Upstash Redis (REST API, no dependencies).
// Env vars are added automatically when the Upstash Redis integration is connected in Vercel.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const KEY = 'reviews';
const KEEP = 500;          // newest reviews kept
const SHOW = 60;           // newest reviews returned to the page
const LIMIT_PER_HOUR = 3;  // per visitor (IP)

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return json(res, 200, { configured: false, reviews: [], count: 0, avg: 0 });

  try {
    if (req.method === 'GET') {
      const raw = await redis(['LRANGE', KEY, 0, KEEP - 1]);
      const all = raw.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
      const count = all.length;
      const avg = count ? all.reduce((s, r) => s + r.rating, 0) / count : 0;
      return json(res, 200, { configured: true, count, avg: Math.round(avg * 10) / 10, reviews: all.slice(0, SHOW) });
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      if (b.website) return json(res, 200, { ok: true }); // honeypot: pretend success to bots

      const rating = parseInt(b.rating, 10);
      const name = clean(b.name, 40);
      const text = clean(b.text, 500);

      if (!(rating >= 1 && rating <= 5)) return json(res, 400, { error: 'rating' });
      if (name.length < 2) return json(res, 400, { error: 'name' });
      if (text.length < 5) return json(res, 400, { error: 'text' });
      if (/https?:|www\.|\.(com|net|org|co|il|ru|xyz)\b|@/i.test(name + ' ' + text)) return json(res, 400, { error: 'links' });

      const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
      const rlKey = 'rl:' + ip;
      const n = await redis(['INCR', rlKey]);
      if (n === 1) await redis(['EXPIRE', rlKey, 3600]);
      if (n > LIMIT_PER_HOUR) return json(res, 429, { error: 'limit' });

      const review = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, text, rating, ts: Date.now() };
      await redis(['LPUSH', KEY, JSON.stringify(review)]);
      await redis(['LTRIM', KEY, 0, KEEP - 1]);
      return json(res, 201, { ok: true, review });
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'method' });
  } catch (e) {
    return json(res, 500, { error: 'server' });
  }
};
