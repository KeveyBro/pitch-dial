// Service worker: makes Pitch Dial work offline after the first visit.
// App files are network-first, so a new deploy shows up on the next load without a version bump;
// the cache is only the fallback. Google Fonts files never change, so they're cache-first.
// v2: the page is cached as './' only. Cloudflare redirects index.html to '/', and browsers refuse
// to show a redirected response for a page load, so caching 'index.html' broke offline use there.
const CACHE = 'pitchdial-v2';
const SHELL = [
  './', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/maths.js', 'js/pitch.js', 'js/audio.js', 'js/mic.js', 'js/canvas.js', 'js/community.js',
  'icons/icon.svg', 'icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pitchdial-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('./'));
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;   // live results: never from the cache
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req));
  else if (url.hostname === 'fonts.googleapis.com') e.respondWith(networkFirst(req));
});
