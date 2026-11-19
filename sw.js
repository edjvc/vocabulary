const scope = self.registration.scope;
const cachePrefix = `vocabulary:${scope}:`;
const cacheName = `${cachePrefix}v8`;
const rootNotesPath = './data/root-notes.json';
const rootNotesURL = new URL(rootNotesPath,scope).href;
const paths = [
  './', './index.html', './style.css', './app.js', './db.js',
  './dictionary.js', './root-notes.js', './data/core.json', rootNotesPath,
  './data/glosses-zh.json', './manifest.webmanifest',
  './assets/icon-192.png', './assets/icon-512.png'
];
const assetURLs = new Set(paths.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(paths.map(path => new Request(new URL(path, scope), {cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  if (request.url === rootNotesURL) {
    event.respondWith(loadCurrentRootNotes(request));
  } else if (request.mode === 'navigate') {
    const url = new URL(request.url);
    if (url.href.split('?')[0] !== scope && url.href.split('?')[0] !== new URL('index.html', scope).href) return;
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(scope) || fetch(request);
    })());
  } else if (assetURLs.has(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(request) || fetch(request);
    })());
  }
});

async function loadCurrentRootNotes(request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(rootNotesURL);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),4000);
  try {
    const response = await fetch(request,{cache:'no-cache',signal:controller.signal});
    if (!response.ok) return cached || response;
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) return cached || response;
    await cache.put(rootNotesURL,response.clone());
    return response;
  } catch(error) {
    if (cached) return cached;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
