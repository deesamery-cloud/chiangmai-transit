# Mobile / Thai-local — build & run

The game is now a **PWA** (installable, offline) and **static-exports** for **Capacitor**
(Play Store / App Store). This is the Thai-local mobile path from the plan.

## 1) PWA (already done — works in any mobile browser)
- `public/manifest.webmanifest` + `public/sw.js` (offline cache of the app shell + sim data)
  + `public/icons/*` + `<PwaRegister/>` registered in `layout.tsx`.
- Test: `pnpm build && npx serve out` (or deploy `out/`), open on a phone → "Add to Home
  Screen" → launches standalone + plays offline after first load.
- Verify installability with Lighthouse (PWA) or `scripts/verify-pwa.mjs`.

## 2) Capacitor → Play Store / App Store (run on your machine — needs Xcode / Android Studio)
`next.config.ts` has `output: "export"`, `capacitor.config.json` points `webDir: "out"`.
```bash
pnpm add -D @capacitor/cli && pnpm add @capacitor/core @capacitor/android @capacitor/ios
npx cap init "CM Transit" com.deesamery.chiangmaitransit --web-dir out   # config already provided
pnpm cap:android      # = next build && cap sync android && cap open android
pnpm cap:ios          # = next build && cap sync ios && cap open ios
```
Then build/sign in Android Studio / Xcode and submit (Thai store listing + ASO).

## 3) Daily Challenge (#5 — done, client-only)
One date-seeded Grade-A / from-scratch / Medium run per day; local best + streak in
localStorage (`cm-daily`). A **global leaderboard** needs a thin serverless KV (e.g.
Upstash/Vercel KV) — deferred; the client hook is ready to POST a score.

## 4) Low-end Android (#4 — done)
`lowEndDevice()` (cores ≤4 / deviceMemory ≤3) → `AGENT_COUNT_LITE` (7k) agents with the
display factor scaled up (`peoplePerAgent`) so on-screen city numbers stay accurate.

## 5) More Thai cities (#6 — scaffolded)
`src/lib/cities.ts` registers Bangkok / Khon Kaen / Phuket with their bboxes. To add a city's
data, run the existing pure-stdlib extractor per its bbox and drop the output in
`public/data/<id>/`:
```bash
# edit pipeline/extract.py bbox to the city's bbox from cities.ts, then:
python3 pipeline/extract.py        # → network.graph.json, zones.json, pois.json
mkdir -p public/data/bangkok && mv public/data/network.graph.json public/data/bangkok/  # etc.
```
Then set `ready: true` in `cities.ts` and wire `useSim` to fetch `/data/<dataDir>/…` + add a
city picker on the start screen + per-city songthaew seeds (pattern: `src/lib/cm-songthaew.ts`).

## 6) Songthaew identity (#7 — done)
The start screen leads with the rod-daeng / songthaew hook; "Existing songthaew" start mode
seeds Chiang Mai's real red-truck corridors.
