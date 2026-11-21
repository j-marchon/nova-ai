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
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    return hit || (request.mode === "navigate" ? await cache.match("/index.html") : null) || Response.error();
  }));
});
