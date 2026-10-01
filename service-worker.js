/* SecureWatch service worker — caches the app shell so the guard app opens and works offline.
 * Data is stored in IndexedDB by the page, not here. Bump CACHE when you change any file. */
const CACHE = 'securewatch-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './config.js',
  './utils.js',
  './db.js',
  './remote.js',
  './core.js',
  './guard.js',
  './manager.js',
  './qrcode.js',
  './jsQR.js',
  './icon-192.png',
  './icon-512.png',
  './barlow-latin-400-normal.woff2',
  './barlow-latin-500-normal.woff2',
  './barlow-latin-600-normal.woff2',
  './barlow-latin-700-normal.woff2',
  './barlow-condensed-latin-600-normal.woff2',
  './barlow-condensed-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  // config.js (site setup + logins): always try the network first so updates reach every device.
  if (url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./config.js', copy)); } return res; }).catch(() => caches.match('./config.js')));
    return;
  }
  // Page navigations: network first (fresh app), cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); } return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  // Static files: cache first, then network (and store).
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
