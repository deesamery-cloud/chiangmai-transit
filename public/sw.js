// Offline service worker — the game is 100% client-side after load, so we cache
// the app shell + the static sim data (graph/zones/pois) and serve it offline.
// Bump CACHE on each release to invalidate.
const CACHE = "cm-transit-v1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/data/network.graph.json",
  "/data/zones.json",
  "/data/pois.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// cache-first for same-origin GETs (instant repeat loads + offline); navigations
// fall back to the cached app shell when the network is gone.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("/") : undefined)),
    ),
  );
});
