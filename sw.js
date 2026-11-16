// Bump CACHE when you change any file so phones pick up the new version.
const CACHE = 'liftbook-v28';
const FILES = ['./', 'index.html', 'style.css', 'data/plan.js', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

// No skipWaiting(): a new worker waits until every Liftbook page is closed, so an
// open page never mixes old and new files. The update applies on the next launch.
// cache:'reload' skips the browser's HTTP cache (GitHub Pages serves max-age=600),
// so the precache gets the files just deployed, not stale copies.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))));
});

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

// Serve from cache right away (works with no signal in the gym), refresh the cache in the background.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then(res => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
