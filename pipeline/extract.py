#!/usr/bin/env python3
"""
Chiang Mai CBD transit-sandbox data pipeline.

Pure standard-library (urllib) so it runs on a bare Python 3.x with no
geospatial dependencies. Hits the public Overpass API and writes three
static JSON assets into ../public/data/ that the web app loads at runtime:

  network.graph.json  the drivable/walkable road graph (reindexed, compact)
  pois.json           points of interest, bucketed into trip purposes
  zones.json          a uniform grid with a density proxy + POI attraction

Re-run this whenever you want fresh OSM data. Nothing here runs at request
time -- the app only consumes the JSON.
"""

import json
import math
import os
import time
import urllib.parse
import urllib.request

# --- Greater Chiang Mai: 4x the original CBD (Old City + Nimman + Night Bazaar
# + Ping + CMU + airport edge + ring-road belt). 2x per side ~= 9 x 10 km. ---
# (min_lat, min_lon, max_lat, max_lon)
#
# Multi-city: override per run via env vars so we never hand-edit constants.
#   CITY_BBOX="min_lat,min_lon,max_lat,max_lon"  CITY_OUT=<subdir under public/data>
# e.g.  CITY_BBOX="12.88,100.855,12.97,100.93" CITY_OUT=pattaya python3 extract.py
# Defaults below = Chiang Mai (root public/data/, the original target).
BBOX = (18.750, 98.936, 18.830, 99.032)
if os.environ.get("CITY_BBOX"):
    BBOX = tuple(float(x) for x in os.environ["CITY_BBOX"].split(","))
    assert len(BBOX) == 4, "CITY_BBOX must be 'min_lat,min_lon,max_lat,max_lon'"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "chiangmai-transit-sim/1.0 (educational sandbox; contact: local)"

# CITY_OUT="" (or unset) -> root public/data/ (Chiang Mai); otherwise a subdir.
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "data", os.environ.get("CITY_OUT", ""))

# Roads we treat as routable for walking + buses. Footways/cycleways/steps are
# excluded to keep the graph compact; agents walk along these roads.
ROAD_HIGHWAYS = (
    "motorway|trunk|primary|secondary|tertiary|unclassified|residential|"
    "living_street|pedestrian|road|"
    "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
)

# OSM tag -> trip purpose bucket. Checked in order; first hit wins.
PURPOSE_RULES = [
    ("work",    lambda t: t.get("office") is not None
                          or t.get("amenity") in {"bank", "townhall", "courthouse", "police"}
                          or t.get("landuse") == "industrial"),
    ("edu",     lambda t: t.get("amenity") in {"university", "college", "school", "kindergarten", "library"}),
    ("health",  lambda t: t.get("amenity") in {"hospital", "clinic", "doctors", "pharmacy", "dentist"}),
    ("temple",  lambda t: t.get("amenity") == "place_of_worship"
                          or t.get("building") == "temple"),
    ("transit", lambda t: t.get("amenity") in {"bus_station"}
                          or t.get("railway") in {"station"}
                          or t.get("aeroway") == "aerodrome"),
    ("shop",    lambda t: t.get("shop") is not None
                          or t.get("amenity") == "marketplace"
                          or t.get("building") in {"retail", "supermarket"}),
    ("leisure", lambda t: t.get("tourism") is not None
                          or t.get("leisure") is not None
                          or t.get("amenity") in {"restaurant", "cafe", "bar", "fast_food",
                                                  "pub", "food_court", "cinema", "theatre",
                                                  "nightclub", "marketplace"}),
]

GRID_CELL_METERS = 400.0


def haversine(lon1, lat1, lon2, lat2):
    """Great-circle distance in metres."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def overpass(query):
    """POST an Overpass QL query, returning parsed JSON. Tries each mirror."""
    data = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    endpoint, data=data,
                    headers={"User-Agent": UA, "Accept": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    return json.loads(resp.read().decode())
            except Exception as e:  # noqa: BLE001 - report and retry/fallback
                last_err = e
                print(f"  ! {endpoint} attempt {attempt + 1} failed: {e}")
                time.sleep(5 * (attempt + 1))
        print(f"  -> giving up on {endpoint}, trying next mirror")
    raise RuntimeError(f"All Overpass endpoints failed: {last_err}")


def bbox_str():
    return f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"


# --------------------------------------------------------------------------- #
# 1. Road graph
# --------------------------------------------------------------------------- #
def fetch_roads():
    print("Fetching road network...")
    q = f"""
    [out:json][timeout:180];
    way[highway~"^({ROAD_HIGHWAYS})$"]({bbox_str()});
    out body;
    >;
    out skel qt;
    """
    j = overpass(q)
    raw_nodes = {}   # osm_id -> (lon, lat)
    ways = []        # list of node-id sequences
    for el in j["elements"]:
        if el["type"] == "node":
            raw_nodes[el["id"]] = (el["lon"], el["lat"])
        elif el["type"] == "way" and "nodes" in el:
            ways.append(el["nodes"])
    print(f"  raw: {len(raw_nodes)} nodes, {len(ways)} ways")

    # Build undirected adjacency between consecutive way nodes that we have coords for.
    adj = {}  # osm_id -> set(osm_id)
    used = set()
    for seq in ways:
        prev = None
        for nid in seq:
            if nid not in raw_nodes:
                prev = None
                continue
            used.add(nid)
            if prev is not None and prev != nid:
                adj.setdefault(prev, set()).add(nid)
                adj.setdefault(nid, set()).add(prev)
            prev = nid

    # Keep only the largest connected component so routing never dead-ends.
    largest = _largest_component(adj, used)
    print(f"  largest connected component: {len(largest)} nodes "
          f"(of {len(used)} used)")

    # Reindex surviving nodes to 0..N-1 and emit compact flat arrays.
    ordered = sorted(largest)
    index = {osm_id: i for i, osm_id in enumerate(ordered)}
    coords = []
    for osm_id in ordered:
        lon, lat = raw_nodes[osm_id]
        coords.append(round(lon, 6))
        coords.append(round(lat, 6))

    edges = []
    seen_pairs = set()
    for osm_id in ordered:
        u = index[osm_id]
        ulon, ulat = raw_nodes[osm_id]
        for nbr in adj.get(osm_id, ()):
            if nbr not in index:
                continue
            v = index[nbr]
            key = (u, v) if u < v else (v, u)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            vlon, vlat = raw_nodes[nbr]
            length = haversine(ulon, ulat, vlon, vlat)
            edges.append(u)
            edges.append(v)
            edges.append(round(length, 1))

    cx = (BBOX[1] + BBOX[3]) / 2
    cy = (BBOX[0] + BBOX[2]) / 2
    graph = {
        "meta": {
            "bbox": [BBOX[1], BBOX[0], BBOX[3], BBOX[2]],  # [minLon,minLat,maxLon,maxLat]
            "center": [round(cx, 6), round(cy, 6)],
            "nodeCount": len(ordered),
            "edgeCount": len(edges) // 3,
        },
        "coords": coords,           # [lon,lat, lon,lat, ...]
        "edges": edges,             # [u,v,len_m, u,v,len_m, ...] undirected
    }
    return graph


def _largest_component(adj, used):
    seen = set()
    best = set()
    for start in used:
        if start in seen:
            continue
        # BFS
        stack = [start]
        comp = set()
        seen.add(start)
        while stack:
            n = stack.pop()
            comp.add(n)
            for nbr in adj.get(n, ()):
                if nbr not in seen:
                    seen.add(nbr)
                    stack.append(nbr)
        if len(comp) > len(best):
            best = comp
    return best


# --------------------------------------------------------------------------- #
# 2. Points of interest
# --------------------------------------------------------------------------- #
def classify(tags):
    for purpose, rule in PURPOSE_RULES:
        try:
            if rule(tags):
                return purpose
        except Exception:  # noqa: BLE001
            continue
    return None


def fetch_pois():
    print("Fetching POIs...")
    q = f"""
    [out:json][timeout:180];
    (
      nwr[amenity]({bbox_str()});
      nwr[shop]({bbox_str()});
      nwr[office]({bbox_str()});
      nwr[tourism]({bbox_str()});
      nwr[leisure]({bbox_str()});
    );
    out center tags;
    """
    j = overpass(q)
    pois = []
    counts = {}
    for el in j["elements"]:
        tags = el.get("tags", {})
        if not tags:
            continue
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center")
            if not c:
                continue
            lon, lat = c["lon"], c["lat"]
        if lon is None or lat is None:
            continue
        purpose = classify(tags)
        if purpose is None:
            continue
        name = tags.get("name") or tags.get("name:en") or ""
        pois.append({
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "p": purpose,
            "name": name[:60],
        })
        counts[purpose] = counts.get(purpose, 0) + 1
    print(f"  pois: {len(pois)} -> {counts}")
    return {"pois": pois}


# --------------------------------------------------------------------------- #
# 3. Zones (density proxy from building footprints + POI attraction)
# --------------------------------------------------------------------------- #
def fetch_buildings():
    print("Fetching buildings (density proxy)...")
    q = f"""
    [out:json][timeout:180];
    way[building]({bbox_str()});
    out center;
    """
    j = overpass(q)
    pts = []
    for el in j["elements"]:
        c = el.get("center")
        if c:
            pts.append((c["lon"], c["lat"]))
        elif el.get("lon") is not None:
            pts.append((el["lon"], el["lat"]))
    print(f"  buildings: {len(pts)}")
    return pts


def build_zones(buildings, pois):
    print("Building zone grid...")
    min_lat, min_lon, max_lat, max_lon = BBOX
    mid_lat = (min_lat + max_lat) / 2
    cell_h = GRID_CELL_METERS / 111000.0
    cell_w = GRID_CELL_METERS / (111000.0 * math.cos(math.radians(mid_lat)))
    cols = max(1, int(math.ceil((max_lon - min_lon) / cell_w)))
    rows = max(1, int(math.ceil((max_lat - min_lat) / cell_h)))

    def cell_of(lon, lat):
        j = int((lon - min_lon) / cell_w)
        i = int((lat - min_lat) / cell_h)
        if 0 <= i < rows and 0 <= j < cols:
            return i, j
        return None

    prod = {}   # (i,j) -> building count
    for lon, lat in buildings:
        c = cell_of(lon, lat)
        if c:
            prod[c] = prod.get(c, 0) + 1

    attr = {}   # (i,j) -> {purpose: count}
    for poi in pois["pois"]:
        c = cell_of(poi["lon"], poi["lat"])
        if c:
            attr.setdefault(c, {})
            attr[c][poi["p"]] = attr[c].get(poi["p"], 0) + 1

    zones = []
    keys = set(prod) | set(attr)
    for (i, j) in sorted(keys):
        lon = min_lon + (j + 0.5) * cell_w
        lat = min_lat + (i + 0.5) * cell_h
        zones.append({
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "prod": prod.get((i, j), 0),
            "attr": attr.get((i, j), {}),
        })
    print(f"  zones: {len(zones)} populated cells ({rows}x{cols} grid)")
    return {
        "cell": {"w": round(cell_w, 6), "h": round(cell_h, 6), "rows": rows, "cols": cols},
        "zones": zones,
    }


# --------------------------------------------------------------------------- #
def write_json(name, obj):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    size_kb = os.path.getsize(path) / 1024
    print(f"  wrote {name} ({size_kb:.0f} KB)")


def main():
    print(f"OSM pipeline  bbox={BBOX}  out={OUT_DIR}")
    graph = fetch_roads()
    write_json("network.graph.json", graph)

    pois = fetch_pois()
    write_json("pois.json", pois)

    buildings = fetch_buildings()
    zones = build_zones(buildings, pois)
    write_json("zones.json", zones)

    print("Done.")


if __name__ == "__main__":
    main()
