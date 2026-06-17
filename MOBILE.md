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

## 5) More Thai cities (#6 — 5 cities shipped)
`src/lib/cities.ts` is the registry. **Shipped (ready):** Chiang Mai (root `/data/`), Pattaya,
Hua Hin, Hat Yai, Korat. **Scaffolded (bbox only, `ready:false`):** Bangkok / Khon Kaen / Phuket.

The runtime is wired: `useSim(dataDir)` fetches `/data/<dataDir>/…` (a `dataDir`-keyed effect, so
switching city re-fetches), a city-chip picker sits on the start screen (scaffolded cities show a
dimmed "soon"), the map re-centers via `city.center` (MapCanvas is remounted by `key={city.id}`),
and per-city "existing transit" seeds live in `CITY_SEEDS` (`src/lib/cm-songthaew.ts`).

To add another city, extract its data with the env-parameterized pipeline (no source edits) and
drop it under `public/data/<dataDir>/`:
```bash
# CITY_BBOX="min_lat,min_lon,max_lat,max_lon"  CITY_OUT=<dataDir>  (run BOTH scripts, same env)
CITY_BBOX="12.88,100.855,12.97,100.93" CITY_OUT=pattaya python3 pipeline/extract.py
CITY_BBOX="12.88,100.855,12.97,100.93" CITY_OUT=pattaya python3 pipeline/extract-pois.py
```
Then flip `ready:true` in `cities.ts` and add a `CITY_SEEDS[<id>]` corridor set. Non-default cities
are **lazy-loaded**: the service worker precaches only Chiang Mai and runtime-caches `/data/<dir>/*`
on first visit, so keep each bbox tight. Verify with `node scripts/verify-cities.mjs`.

## 6) Songthaew identity (#7 — done)
The start screen leads with the rod-daeng / songthaew hook; "Existing songthaew" start mode
seeds Chiang Mai's real red-truck corridors.
