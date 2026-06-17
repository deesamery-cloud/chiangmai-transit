"use client";

import { useEffect } from "react";

// Registers the offline service worker (installable + offline) — but ONLY in
// production. In dev a cache-first SW would serve stale Next chunks and break HMR
// (reloads hang / ChunkLoadError), so in dev we actively unregister any existing
// SW + clear its caches to self-heal a browser that already cached one.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      // Dev self-heal: a SW left over from a production/PWA session would serve
      // STALE chunks under `next dev` → the page loads but isn't interactive
      // (clicks/Skip do nothing). Unregister it, clear caches, and if one was
      // actively controlling this page, reload ONCE (guarded) so we get the live,
      // clickable build instead of the dead cached one.
      const hadController = !!navigator.serviceWorker.controller;
      Promise.all([
        navigator.serviceWorker
          .getRegistrations()
          .then((rs) => Promise.all(rs.map((r) => r.unregister()))),
        typeof caches !== "undefined"
          ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
          : Promise.resolve(),
      ])
        .then(() => {
          if (hadController && !sessionStorage.getItem("cm-sw-healed")) {
            sessionStorage.setItem("cm-sw-healed", "1");
            location.reload();
          }
        })
        .catch(() => {});
    }
  }, []);
  return null;
}
