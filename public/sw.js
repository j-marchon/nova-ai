const CACHE = "nova-release-__RELEASE__";
const ASSETS = __ASSETS__;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("message", event => {
  if (event.data === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("nova-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()).catch(e => console.warn("SW activate failed", e)));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  /* the bundled skin zips stay out of the install cache (17 MB); each is
     kept here once fetched, so a skin worn online still works offline */
  const keep = url.pathname.endsWith(".zip");
  event.respondWith(fetch(request).then(res => {
    if (keep && res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
    return res;
  }).catch(async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    return hit || (request.mode === "navigate" ? await cache.match("/index.html") : null) || Response.error();
  }));
});
