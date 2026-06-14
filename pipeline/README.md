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
and re-run. The app's initial map center in `src/app/page.tsx` (`CENTER`) should
roughly match the new bbox center.

## Notes

- Overpass requires a `User-Agent`; the script sets one and retries across two
  mirrors. Nothing here runs at app request time — the JSON is committed and
  served from the CDN.
- One-way streets are currently ignored (edges are bidirectional) — fine for a
  walk/bus sandbox; revisit if car-realistic routing is needed.
