// Offline support: the whole site is cached on first visit, so Breathe opens
// with no connection (planes, roaming). Recordings live in the page's own
// storage and never pass through here.
//
// Bump CACHE whenever any file changes, so devices pick up the new version.
const CACHE = 'breathe-web-v1';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'sounds/bowl-inhale.m4a',
  'sounds/bowl-hold.m4a',
  'sounds/bowl-exhale.m4a',
  'sounds/wind-chimes.m4a',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Audio elements ask for byte ranges; a cached file must answer with the
// requested slice, or Safari refuses to play it.
async function rangeResponse(request, cached) {
  const blob = await cached.blob();
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const size = blob.size;
  let start = match && match[1] ? Number(match[1]) : 0;
  let end = match && match[2] ? Number(match[2]) : size - 1;
  if (match && !match[1] && match[2]) { start = size - Number(match[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// Serve from the cache straight away and refresh it in the background, so the
// site is instant and offline-proof, and picks up updates on the next visit.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request.headers.has('range') ? request.url : request)
      .then(response => {
        if (response.ok && response.status === 200) cache.put(request.url, response.clone());
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return request.headers.has('range') ? rangeResponse(request, cached) : cached;
    }
    const fresh = await network;
    if (fresh) return request.headers.has('range') ? rangeResponse(request, fresh) : fresh;
    // Offline and never cached: fall back to the app shell for page loads.
    return (request.mode === 'navigate' && (await cache.match('index.html'))) || Response.error();
  })());
});
