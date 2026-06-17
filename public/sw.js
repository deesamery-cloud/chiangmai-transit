// KILL SWITCH — offline caching was REMOVED (2026-06-17, "too problematic":
// a cache-first worker served stale chunks → dead, unclickable pages).
//
// This worker now self-destructs: any browser that still has the old service
// worker will, on its next update check, install THIS script, which deletes
// every cache, unregisters itself, and reloads open tabs — permanently removing
// the cache. It never intercepts fetches, so nothing stale is ever served.
//
// To re-enable a PWA offline worker later, restore a cache-first/network-first
// implementation here and re-add registration in PwaRegister.tsx.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {}
      try {
        await self.registration.unregister();
      } catch {}
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.navigate(c.url));
      } catch {}
    })(),
  );
});

// pass-through: never serve from cache (browser does its normal network fetch)
self.addEventListener("fetch", () => {});
