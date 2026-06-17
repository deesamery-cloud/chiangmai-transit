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
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if (typeof caches !== "undefined") caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }, []);
  return null;
}
