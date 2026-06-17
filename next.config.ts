import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The game is 100% client-side, so it static-exports cleanly — required to wrap
  // it in Capacitor (webDir: "out") for the Play Store / App Store. `next dev`
  // ignores this; `next build` emits a static ./out you can `npx cap sync`.
  output: "export",
  images: { unoptimized: true }, // we use plain <img>, but export requires this
};

export default nextConfig;
