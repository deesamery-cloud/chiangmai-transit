# Chiang Mai Transit Planner — project guide

A browser **build-and-observe public-transport sandbox** on the real Chiang Mai map. You draw
two modes — **metro** trunk (place stations → lay track → finish; extend/demolish/undo) and
**songthaew** road-bound feeders (draw a route along the streets) — ~15,000 simulated
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
  icons MUST include explicit `width`/`height` attrs or deck's `createImageBitmap` throws. The
  basemap is muted via a CSS filter on `.maplibregl-canvas` (deck overlay stays full-saturation).
  Map build interaction works on mouse AND touch — `onClick` (tap) places/chains stations; the
  press-drag connect is mirrored to `onTouchStart/Move/End` for fingers.
- `src/lib/cm-songthaew.ts` — Chiang Mai's REAL songthaew (rod daeng) network as ~6 route corridors
  (researched: Warorot hub + colour-coded directions — red old-city loop, green→Mae Jo, blue→Sarapee/
  Lamphun, orange→Nimman/CMU, gold→railway, teal→airport). Used by the start screen's "Start from existing
  songthaew" option, which seeds them via `sim.addLine(corridor.points, "songthaew", color)` once the worker
  is ready (`seedExistingRef`).
- `src/app/page.tsx` — the whole HUD: **start screen is a goal → start-from → difficulty → Start flow**
  (goal cards SELECT not start; "start-from" = 🆕 scratch or 🛻 the real songthaew net; the run seed is now
  HIDDEN + auto-randomised, no dice UI). Left panel (clock/economy/
  **single City Score grade** + an **inline grade breakdown** = 3 weighted bars ·68/·18/·14 + "biggest
  gain" next-step + satisfaction + per-line performance), right summary (stats + spark +
  **Travel-demand/OD panel**), bottom control bar, win/lose overlays, i18n (`t(en,th)`), undo,
  autosave (localStorage `cm-save-v1`). **Bottom-center bar = exactly 4 primary buttons** (`openMenu`
  state): ⏩ Speed, 🚆 Metro, 🛻 Songthaew, 🖐️ Pan (เลื่อนแผนที่). Clicking Speed/Metro/Songthaew toggles a
  popover ABOVE the bar with that group's sub-features — **Speed = a 1×–1000× range gauge** (+ play/pause +
  1/10/100/1000 preset chips), **Metro** = place-stations / connect / demolish (+ the contextual build strip:
  colour picker / station count / Finish / Cancel), **Songthaew** = draw-route / demolish (+ its build strip).
  Both Metro and Songthaew build via **place stations → connect** (the station tools are shared; `buildMode`
  decides what a connect produces) — songthaew can ALSO still draw a free route. The station strip shows a
  **coverage note** (each station = a ~800 m walk-shed). Pan just activates pan + closes menus. The selected-line edit strip (＋vehicle / fare / recolour / remove)
  is its own popover above the bar. The active button gets the gold accent. 🔥 **Density and 🌿 Zen are removed**;
  👣 People / 🎯 Demand / 📐 Coverage / 🔊 Sound toggles now live **under the advisor dock** (bottom-right),
  passed into `AdvisorDock`. **📐 Coverage** draws translucent ~800 m walk-shed circles around every stop +
  placed station (MapCanvas `showCoverage` ScatterplotLayer, radiusUnits "meters") so players SEE the area
  each station serves.
- `src/lib/advisors.ts` + `src/components/advisors/AdvisorPanels.tsx` — the Governor's **4-advisor team**
  ("the 4 ladies who assist"): Ploy (metro), Napha (songthaew), Kanya (finance), Mali (city rep). `advisorBrief(id,
  meta, lines)` turns live `SnapshotMeta` into each advisor's bilingual advice (tone good/warn/info). `AdvisorIntro`
  = the appointment cutscene shown once on a fresh game. **`AdvisorDock` is the primary advisory UI** — a persistent
  bottom-right dock with all 4 faces always visible; click a face → that advisor's live advice pops up above the dock
  (click again / ✕ to close). The faces pulse (cm-pop-in, keyed on `meta.day`) when a new day starts. The
  👣 People / 🎯 Demand / 🔊 Sound view toggles are parked in a row **under the faces** (props from page.tsx).
  Portraits in `public/advisors/*.jpg` (Magnific-generated), loaded via `<img>` with an emoji fallback.
  `AdvisorBriefing` (a full 4-advisor panel) still exists but is no longer auto-shown. The dock also hosts
  the People/Demand/Coverage/Sound toggles. Verify: `scripts/verify-advisors.mjs` + `verify-bottombar.mjs` +
  `verify-startflow.mjs` (start wizard, hidden seed, songthaew seeding, coverage, songthaew station-build).
- `src/app/{layout.tsx,globals.css}` — Lanna heritage theme (parchment + temple gold + cinnabar +
  jade), CSS-variable driven; `.panel`, `.panel-accent`, `.gold-rule`, `.wordmark`, `LannaEmblem`,
  the control grammars (`.segmented/.seg/.seg-on`, `.vtoggle/.vtoggle-on`), a small motion vocab
  (`cm-pop-in/cm-fade-in/cm-glow-pulse/cm-tick/cm-flash-up/down`, honours reduced-motion), and a
  `@media (pointer:coarse)` 44px tap-target pass. `layout.tsx` exports `viewport` (device-width) for
  mobile; the `--font-mono` stack appends a Thai fallback so `฿` renders (Geist Mono lacks it).

## Core gameplay model
- **City Score / grade** (`page.tsx`): demand-dominated — `(0.68·served + 0.18·coverage +
  0.14·trafficRelief) × (0.82+0.18·satisfaction)`, thresholds A82/B66/C44/D26. A small metro scores
  F; an A needs a real multi-line network. `OD.accessM` (900 m) governs what counts as "served".
  **"Served" is METRO-WEIGHTED** (`refreshOD` in engine.ts): a corridor served only by songthaew counts
  `OD.songthaewServeCredit` (0.3) and stays red ("build metro here"); only a METRO journey is full credit
  + green. So songthaew (a feeder) can't reach a high grade alone. Because satisfaction multiplies the score,
  **an A also needs fleet investment** to relieve crowding (sat near 0 caps the grade at ~B). Measure tiers
  with `pnpm dlx tsx scripts/measure-existing.ts`.
- **Walk catchment is MODE-AWARE** (`MODE_PARAMS[mode].walkAccessM`): metro stations draw a wide ~800 m
  walk-shed; songthaew stops only a ~200 m local hail (you board a rod daeng near home). Used by the engine's
  coverage calc + journey access (`bestTransitJourney` `accFor`) AND the 📐 Coverage overlay (per-stop circle
  radius). So a songthaew web covers only thin strips along its routes (the seeded "existing" net ≈ 24%
  coverage → **Grade D/F start**); metro is what gives real area coverage. The station build-note is mode-aware.
- **Demographics**: residents (density-weighted homes), students (campus-anchored), tourists
  (hotel↔old-city/markets, ride the most). HUD shows the rider mix.
- **Ridership scale**: `PEOPLE_PER_AGENT` scales DISPLAY flow numbers to real-city magnitude
  (calibrated vs real metros: single trunk line ~40–200k/day & ~5–15k/km/day; mode share ~20–40%).
  The ECONOMY stays on sim units (money is unscaled).
- **Crowding + waits → satisfaction** caps the grade; riders complain when packed/slow.
- **Fares** are a demand lever (per-line, ฿5 steps): ↑fare → fewer riders / more revenue.
- **Difficulty** (Easy/Medium/Challenge/Hard) scales budget/cost/opex/fare/capacity + targets.
- **Modes** (`LineMode = "metro" | "songthaew"`): metro = fast, grade-separated trunk (station→track
  build). Songthaew = cheap, road-bound, tiny-capacity FEEDER (draw-a-route via `addLine`/`buildLine`);
  it overcrowds on busy corridors + adds traffic, so it complements metro and can't reach A alone. Road
  vehicles render as a red truck (`TRUCK` icon, `vehicle.road` flag); metro as the capsule train.
- **Start defaults**: a fresh game runs at **1×** speed (useSim speed state + worker `speed` both 1,
  kept consistent) and auto-plays; the 🎯 Demand/OD panel (`showOD`) and 👣 People overlay (`showAgents`,
  the red driving dots = "traffic") both default **off** for a clean starting map. None of these are
  persisted, so they apply to every fresh start; the player toggles them on at will.
- **Build flow**: finishing a line (`finishRail`/`finishRoute`) auto-selects it + drops to Pan so the
  bottom edit strip (＋ vehicle / fare / recolour / remove) appears immediately. `addLine`/
  `addLineFromStations` guard cap+budget synchronously (via `linesRef`) and return the new line.
  You can re-edit a line ANY time: clicking its row in YOUR NETWORK selects it + drops to Pan + clears
  any draft, so the strip reliably reappears (the strip is gated off during build tools). A row is
  "active" (click again to deselect) only when selected AND already in Pan — so coming back to add
  trains never accidentally toggles a still-selected-but-hidden line off.

## Design system
`design-system/` holds self-contained HTML preview cards mirrored to a **claude.ai/design**
project ("Chiang Mai Transit — Lanna UI") via the DesignSync tool / `/design-sync` skill.

## Conventions
- Keep the SIMULATION + ECONOMY in sim units; scale only human-facing displays.
- Tune gameplay in `config.ts` constants first; verify with `sim-smoke` + a `verify-*.mjs` before
  declaring done. Aim for 0 console errors.
- **UI grammars**: gold = the active/armed control (the open primary bottom-bar button or the armed build
  tool). On/off overlay toggles (People / Demand / Sound, now under the advisor dock) use `.vtoggle`.
- **i18n**: default language is **EN**. Every player-facing string on the critical path must go through
  `t(en, th)` and lead with the active language — including canvas hints, tool labels, coachmark beats,
  and worker `setNotice` errors (no bare single-language strings). Don't letter-space/track Thai runs.
- **Mobile/touch**: keep map interaction pointer-agnostic (tap via `onClick`, drag via touch handlers),
  44px targets on coarse pointers, the bottom bar a swipeable strip, and side panels height-capped so
  the lower map stays tappable.
- The Bangkok repo `~/bangkok-metro-sandbox` (github deesamery-cloud/bangkok-metro-sandbox) is
  REFERENCE ONLY — do not edit it.
