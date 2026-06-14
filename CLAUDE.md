# Chiang Mai Transit Planner — project guide

A browser **build-and-observe public-transport sandbox** on the real Chiang Mai map. You draw
metro lines (place stations → lay track → finish; extend / demolish / undo); ~15,000 simulated
commuters (residents, students, tourists) walk, drive (jamming roads), or ride. You fight
**crowding** and serve real **origin→destination demand** while watching a live **City Score**.

## Run
```bash
pnpm install
pnpm dev          # http://localhost:3000  (dev server works on :3000)
```
- Typecheck: **`./node_modules/.bin/tsc --noEmit`** — do NOT use `pnpm exec tsc` (it mis-resolves to
  a bogus standalone `tsc` package and pulls extra deps).
- Headless sim test: `pnpm dlx tsx scripts/sim-smoke.ts` (prints economy + OD + demographic +
  real-world ridership benchmark; ends `SMOKE: PASS ✅`).
- Browser verification: `scripts/verify-*.mjs` drive headless system-Chrome via `playwright-core`
  with `--use-angle=swiftshader` (WebGL). Pass `CM_URL` to override the URL.

## Stack
- Next.js 16 App Router (`src/app/`), TypeScript strict, Tailwind v4.
- Map: **deck.gl 9 + MapLibre 5** via react-map-gl 8, **OpenFreeMap** basemap (no API keys).
  `HeatmapLayer`/`GridLayer` are imported from the **`deck.gl` umbrella** (not `@deck.gl/aggregation-layers`,
  which isn't a direct dep and won't resolve under pnpm).
- Simulation runs in a **Web Worker**; routing is in-browser A* over an OSM road graph.
- Data in `public/data/` (`network.graph.json`, `zones.json`, `pois.json`) extracted offline by
  pure-stdlib Python in `pipeline/` (no osmnx/GDAL).
- pnpm. Fonts via `next/font` (Geist, Noto Sans Thai, Chonburi display) — never CSS `@import`
  (Tailwind v4 inlines its own import and breaks load order → 500).

## Architecture / key files
- `src/lib/sim/engine.ts` — the simulation: agents (kind = resident/student/tourist, each with
  spatial anchors + daily rhythm + transit propensity), congestion grid, mode choice
  (`bestTransitJourney` shared by agents AND OD classification), economy, coverage, **OD demand
  model** (named origin/dest hubs + gravity matrix, met/unmet by the agents' own cost rule),
  `writeSnapshot` → `SnapshotMeta`.
- `src/lib/config.ts` — ALL tunables: `SIM`, `TRAVEL`, `ECONOMY`, `MODE_PARAMS`, `DEMOGRAPHICS`,
  `PEOPLE_PER_AGENT` (display scale), `OD`, `DIFFICULTIES`, `GOALS`, `LINE_COLORS`, `TOOLS`.
- `src/lib/worker/{sim.worker.ts,useSim.ts}` — worker protocol + the `useSim()` React hook
  (network edits, `setFleet`/`setFare`/`setLineColor`, snapshots, exposes `zones`/`pois`).
- `src/lib/network/line.ts` — build a line from placed stations (`buildLineFromStations`) or drawn
  points; routes along roads; metro is grade-separated (traffic-immune).
- `src/components/map/MapCanvas.tsx` — all deck layers: agents, rail (+halo), **chedi station
  markers** (IconLayer) + names (TextLayer), **crowd-coloured capsule trains** (IconLayer 1–5),
  **density heat** (HeatmapLayer, hour-weighted, toggle), **selected O→D arc**. NOTE: SVG data-URI
  icons MUST include explicit `width`/`height` attrs or deck's `createImageBitmap` throws.
- `src/app/page.tsx` — the whole HUD: start screen (goals + difficulty), left panel (clock/economy/
  **single City Score grade** + satisfaction + per-line performance), right summary (stats + spark +
  **Travel-demand/OD panel**), tool palette + 🔥 Density / 👣 People / 🎯 Demand toggles, win/lose
  overlays, i18n (`t(en,th)`), undo, autosave (localStorage `cm-save-v1`).
- `src/app/{layout.tsx,globals.css}` — Lanna heritage theme (parchment + temple gold + cinnabar +
  jade), CSS-variable driven; `.panel`, `.panel-accent`, `.gold-rule`, `.wordmark`, `LannaEmblem`.

## Core gameplay model
- **City Score / grade** (`page.tsx`): demand-dominated — `(0.68·served + 0.18·coverage +
  0.14·trafficRelief) × (0.82+0.18·satisfaction)`, thresholds A82/B66/C46/D26. A small metro scores
  F; an A needs a real multi-line network. `OD.accessM` (900 m) governs what counts as "served".
- **Demographics**: residents (density-weighted homes), students (campus-anchored), tourists
  (hotel↔old-city/markets, ride the most). HUD shows the rider mix.
- **Ridership scale**: `PEOPLE_PER_AGENT` scales DISPLAY flow numbers to real-city magnitude
  (calibrated vs real metros: single trunk line ~40–200k/day & ~5–15k/km/day; mode share ~20–40%).
  The ECONOMY stays on sim units (money is unscaled).
- **Crowding + waits → satisfaction** caps the grade; riders complain when packed/slow.
- **Fares** are a demand lever (per-line, ฿5 steps): ↑fare → fewer riders / more revenue.
- **Difficulty** (Easy/Medium/Challenge/Hard) scales budget/cost/opex/fare/capacity + targets.

## Design system
`design-system/` holds self-contained HTML preview cards mirrored to a **claude.ai/design**
project ("Chiang Mai Transit — Lanna UI") via the DesignSync tool / `/design-sync` skill.

## Conventions
- Keep the SIMULATION + ECONOMY in sim units; scale only human-facing displays.
- Tune gameplay in `config.ts` constants first; verify with `sim-smoke` + a `verify-*.mjs` before
  declaring done. Aim for 0 console errors.
- The Bangkok repo `~/bangkok-metro-sandbox` (github deesamery-cloud/bangkok-metro-sandbox) is
  REFERENCE ONLY — do not edit it.
