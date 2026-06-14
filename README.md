# Chiang Mai Transit Planner

A build-and-observe **public-transport planning sandbox** on the real map of
Chiang Mai's central business district. The city starts full of individual
simulated commuters (driven by real OSM population density + points of interest)
but with **no transit** — you draw bus / metro / songthaew / taxi routes
yourself and watch commuters respond: choosing modes, walking to stops, waiting,
boarding, crowding vehicles, and completing trips.

Built with **Next.js 16 (App Router) · TypeScript · deck.gl + MapLibre ·
OpenFreeMap basemap** (no API keys, no paid services). Commuter simulation runs
in a **Web Worker** as an agent-based model; routing is in-browser A\* over a
road graph extracted offline from OpenStreetMap.

## Status — Phase 1 (verified)

Real basemap, ~3,500 individual agents moving on real roads between density
zones and POIs, the **draw-a-bus-line** loop (click roads → buses run → nearby
commuters ride), play/pause/speed, and live HUD metrics. Verified end-to-end in
the browser; the engine runs a tick for 3,500 agents in **~0.18 ms** (≈180×
headroom at 30 Hz). Later phases add the remaining modes, a full multinomial
mode-choice model, a richer network editor, and a metrics dashboard
(see `~/.claude/plans/dynamic-roaming-mist.md`).

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Press **Play**, bump the speed to 60×, then use the tool palette —
🖐️ **เลื่อนแผนที่** (pan) · 🚉 **วางสถานี** (place stations) · 🛤️ **วางราง**
(lay track: click/drag along roads, ✓ Finish) · 🗑️ **รื้อถอน** (demolish: click a
line to remove it). Real-map POIs (restaurants, bars, temples, hospitals,
schools, attractions, shops) show by category, residential areas mark trip
origins, and the **🧭 Trip flows (O→D)** overlay draws the morning home→work /
evening work→home desire lines you should serve.

## Regenerate the OSM data

The static assets in `public/data/` (road graph, POIs, density zones) are baked
offline by a pure-stdlib Python script that queries the Overpass API. Re-run it
to refresh the data or change the bounding box (edit `BBOX` in the script):

```bash
python3 pipeline/extract.py        # road graph + POIs + zones (full rebuild)
python3 pipeline/extract-pois.py   # POIs only — adds fine categories (restaurant/
                                   # bar/temple/…) + residential `homes`, keeps the
                                   # coarse engine purpose; leaves graph/zones intact
```

## Smoke-test the engine (headless)

```bash
pnpm dlx tsx scripts/sim-smoke.ts
```

Loads the real assets, builds a bus line, simulates 3 sim-hours, and asserts
agents move + ridership accrues. Also prints per-tick cost.

## Layout

```
src/lib/geo/        road graph (CSR adjacency + spatial hash) + haversine
src/lib/routing/    A* shortest-path with route memoisation
src/lib/network/    transit line model + build-from-clicks
src/lib/demand/      (zone/POI demand lives in the engine for now)
src/lib/sim/        agent-based tick engine (runs in the worker)
src/lib/worker/     worker entry, message protocol, useSim() hook
src/components/map/ MapLibre + deck.gl canvas
public/data/        committed OSM-derived JSON assets
pipeline/           offline Python OSM extractor
```

## Tunables

`src/lib/config.ts` — agent count, walk/bus speeds, dwell, bus appeal
(`busBias`), default headway/capacity, agent colours, basemap style
(`NEXT_PUBLIC_MAP_STYLE` env override).
