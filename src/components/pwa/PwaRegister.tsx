"use client";

import { useEffect } from "react";

// Service-worker / offline caching is DISABLED (2026-06-17, "remove cache
// permanently"): a cache-first SW kept serving stale chunks → dead, unclickable
// pages. We now NEVER register a worker, and on every load we actively
// unregister any leftover worker + clear all caches, so caching can't come back.
// If a stale worker is still controlling the page, we reload ONCE (guarded) to
// drop it and load the live build.
//
// To bring back installable-offline later: register "/sw.js" here (in
// production) and restore a real caching implementation in public/sw.js.
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
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
  }, []);
  return null;
}
