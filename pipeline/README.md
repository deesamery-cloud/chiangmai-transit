# OSM data pipeline

Offline extractor that turns OpenStreetMap data for the Chiang Mai CBD into the
static JSON the web app consumes. **Pure Python standard library** (just
`urllib`) — no osmnx/geopandas/GDAL, so it runs on a bare Python 3 with nothing
to install. Hits the public Overpass API.

```bash
python3 extract.py
```

Writes into `../public/data/`:

| File                 | Contents |
|----------------------|----------|
| `network.graph.json` | drivable/walkable road graph — reindexed nodes (`coords`) + undirected `edges` with metre lengths; largest connected component only |
| `pois.json`          | points of interest bucketed into trip purposes (work/edu/health/temple/transit/shop/leisure) |
| `zones.json`         | uniform ~400 m grid with a density proxy (building-footprint count) + per-purpose POI attraction |

## Changing the area

Edit `BBOX = (min_lat, min_lon, max_lat, max_lon)` at the top of `extract.py`
and re-run. The app's initial map center now comes from `src/lib/cities.ts`
(`center` per city), not a single `CENTER` const.

## Adding another city (multi-city)

Both scripts read `CITY_BBOX` + `CITY_OUT` env vars (falling back to the Chiang
Mai constants), so you never hand-edit the source. `CITY_OUT` is the subdir under
`public/data/` (must match the city's `dataDir` in `src/lib/cities.ts`); run
**both** scripts with the **same** env so the trio lands together:

```bash
# Pattaya -> public/data/pattaya/{network.graph,pois,zones}.json
CITY_BBOX="12.88,100.855,12.97,100.93" CITY_OUT=pattaya python3 extract.py
CITY_BBOX="12.88,100.855,12.97,100.93" CITY_OUT=pattaya python3 extract-pois.py

# Hua Hin -> public/data/huahin/...
CITY_BBOX="12.53,99.93,12.61,100.005" CITY_OUT=huahin python3 extract.py
CITY_BBOX="12.53,99.93,12.61,100.005" CITY_OUT=huahin python3 extract-pois.py
```

Then flip that city's `ready: true` in `src/lib/cities.ts`. Non-default cities
are **lazy-loaded** (the service worker runtime-caches `/data/<dir>/*.json` on
first visit; only Chiang Mai is precached), so keep each city's bbox tight to
avoid bloating first-load. `CITY_BBOX` order is `min_lat,min_lon,max_lat,max_lon`
— note this is lat/lon-swapped vs the `[minLon,minLat,…]` bbox in `cities.ts`.

## Notes

- Overpass requires a `User-Agent`; the script sets one and retries across two
  mirrors. Nothing here runs at app request time — the JSON is committed and
  served from the CDN.
- One-way streets are currently ignored (edges are bidirectional) — fine for a
  walk/bus sandbox; revisit if car-realistic routing is needed.
