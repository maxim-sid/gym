// A deploy reaches phones ONLY if CACHE is bumped: files come solely from the install
// precache below, and a new worker installs only when this file changes.
const CACHE = 'liftbook-v31';
const FILES = ['./', 'index.html', 'style.css', 'data/plan.js', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

// No automatic skipWaiting(): a new worker waits until every Liftbook page is closed,
// so an open page never mixes old and new files. The page may ask for it ('skip') when
// it's back in the foreground and idle, then reloads straight into the new version.
// cache:'reload' skips the browser's HTTP cache (GitHub Pages serves max-age=600),
// so the precache gets the files just deployed, not stale copies.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });

// claim() only matters on the very first install (no old worker yet): it lets the
// page that installed it work offline right away. On updates, activation happens
// after all pages are closed, so there's nothing left to claim.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, network only for anything not precached. Responses are never written
// back, so an old cache can't be topped up with new files (no mixed versions).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      return hit || fetch(e.request);
    })
  );
});
