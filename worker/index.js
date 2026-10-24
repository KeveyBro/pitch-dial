// Pitch Dial's results API, run by Cloudflare Workers. The game's files are served as static
// assets without running this code; only /api/* reaches it (run_worker_first in wrangler.jsonc).
//   POST /api/results  one shared game; checked and rescored by normalizeGame, then stored in D1
//   GET  /api/stats    each mode's histogram of game averages, for the summary's comparison
// Nothing identifying is stored: no IP, ID or exact time. A site-wide cap of shared games per
// minute keeps a flood within D1's free daily write quota (about 3 row writes per game).
import { normalizeGame, binOf, BIN_COUNT } from '../public/js/community.js';

const CAP_PER_MINUTE = 20;
const MAX_BODY = 8192;
const STATS_TTL = 120000;   // ms an isolate reuses the stats it last read
const ZERO_BINS = JSON.stringify(new Array(BIN_COUNT).fill(0));
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
};
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

let statsCache = null;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/results') return request.method === 'POST' ? await submit(request, env) : json({ error: 'use POST' }, 405, { Allow: 'POST' });
      if (pathname === '/api/stats') return ['GET', 'HEAD'].includes(request.method) ? await stats(env) : json({ error: 'use GET' }, 405, { Allow: 'GET' });
      return json({ error: 'not found' }, 404);
    } catch (err) {
      // most likely D1 is unreachable or past its daily limit; the game carries on without stats.
      // The error shows in the Worker's logs (Cloudflare dashboard, or the wrangler dev console).
      console.error('results API failed:', err && err.stack || err);
      return json({ error: 'results are unavailable right now' }, 503);
    }
  }
};

async function submit(request, env) {
  // requiring JSON also means other sites' pages can't post here without a CORS preflight
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'send JSON' }, 415);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let payload;
  try { payload = JSON.parse(text); } catch (e) { return json({ error: 'bad JSON' }, 400); }
  const result = normalizeGame(payload);
  if (!result.ok) return json({ error: result.error }, 422);

  const minute = Math.floor(Date.now() / 60000);
  const count = await env.DB.prepare('INSERT INTO throttle (minute, n) VALUES (?1, 1) ON CONFLICT(minute) DO UPDATE SET n = n + 1 RETURNING n').bind(minute).first('n');
  if (count > CAP_PER_MINUTE) return json({ error: 'busy, try again later' }, 429, { 'Retry-After': '60' });

  const g = result.game;
  const statements = [
    env.DB.prepare(`INSERT INTO games (day, mode, input, family, listen, time_limit, range_key, fold, scored, missed, avg_cents, mean_cents, rounds)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
      .bind(new Date().toISOString().slice(0, 10), g.mode, g.input, g.family, g.listen, g.time, g.range, g.fold ? 1 : 0,
        g.scored, g.missed, g.avgCents, g.meanCents, JSON.stringify(g.rounds)),
    env.DB.prepare('INSERT INTO histogram (mode, n, bins) VALUES (?1, 0, ?2) ON CONFLICT(mode) DO NOTHING').bind(g.mode, ZERO_BINS),
    // the JSON path is built here: D1 binds JS numbers as REAL, and SQLite rejects '$[29.0]'
    env.DB.prepare('UPDATE histogram SET n = n + 1, bins = json_set(bins, ?2, json_extract(bins, ?2) + 1) WHERE mode = ?1')
      .bind(g.mode, `$[${binOf(g.avgCents)}]`)
  ];
  if (count === 1) statements.push(env.DB.prepare('DELETE FROM throttle WHERE minute < ?1').bind(minute - 60));
  await env.DB.batch(statements);
  statsCache = null;
  return json({ ok: true }, 201);
}

async function stats(env) {
  if (!statsCache || Date.now() - statsCache.at > STATS_TTL) {
    const { results } = await env.DB.prepare('SELECT mode, n, bins FROM histogram').all();
    const modes = {};
    for (const r of results) modes[r.mode] = { n: r.n, bins: JSON.parse(r.bins) };
    statsCache = { at: Date.now(), body: { v: 1, modes } };
  }
  return json(statsCache.body, 200, { 'Cache-Control': 'public, max-age=60' });
}
