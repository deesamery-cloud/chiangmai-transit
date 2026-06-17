#!/usr/bin/env python3
"""
POI-only re-extraction for the Chiang Mai sandbox.

Re-queries Overpass for the SAME bbox as extract.py but classifies each POI
into a FINE visual category (`cat`) the map can show as a distinct marker —
restaurant, bar, temple, hospital, school, attraction, shop, office, transit —
while keeping the COARSE engine purpose (`p`, one of the original
work/edu/health/temple/transit/shop/leisure buckets) so the simulation's demand
model is unchanged. Also collects named residential places (village / suburb /
neighbourhood) into `homes[]` — trip ORIGINS the map can show as 🏘️ markers.

Writes ONLY public/data/pois.json (road graph + zones are left untouched).
Run:  python3 pipeline/extract-pois.py
"""

import json
import math
import os
import time
import urllib.parse
import urllib.request

BBOX = (18.750, 98.936, 18.830, 99.032)  # (min_lat, min_lon, max_lat, max_lon)
# Multi-city: same env overrides as extract.py (keep them identical per run).
#   CITY_BBOX="min_lat,min_lon,max_lat,max_lon"  CITY_OUT=<subdir under public/data>
if os.environ.get("CITY_BBOX"):
    BBOX = tuple(float(x) for x in os.environ["CITY_BBOX"].split(","))
    assert len(BBOX) == 4, "CITY_BBOX must be 'min_lat,min_lon,max_lat,max_lon'"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = "chiangmai-transit-sim/1.0 (educational sandbox; POI re-extract)"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", os.environ.get("CITY_OUT", ""), "pois.json")

# fine category -> coarse engine purpose (Purpose union in types.ts)
CAT_TO_P = {
    "hospital": "health", "school": "edu", "temple": "temple",
    "transit": "transit", "bar": "leisure", "restaurant": "leisure",
    "attraction": "leisure", "shop": "shop", "office": "work",
}

# ordered fine-category rules — first match wins
CAT_RULES = [
    ("hospital",   lambda t: t.get("amenity") in {"hospital", "clinic", "doctors"}),
    ("school",     lambda t: t.get("amenity") in {"university", "college", "school", "kindergarten"}),
    ("temple",     lambda t: t.get("amenity") == "place_of_worship" or t.get("building") == "temple"),
    ("transit",    lambda t: t.get("amenity") == "bus_station" or t.get("railway") == "station" or t.get("aeroway") == "aerodrome"),
    ("bar",        lambda t: t.get("amenity") in {"bar", "pub", "nightclub", "biergarten"}),
    ("restaurant", lambda t: t.get("amenity") in {"restaurant", "cafe", "fast_food", "food_court"}),
    ("attraction", lambda t: t.get("tourism") in {"attraction", "museum", "gallery", "viewpoint", "artwork", "zoo", "theme_park", "aquarium"}
                             or t.get("leisure") in {"park", "garden", "stadium"}),
    ("office",     lambda t: t.get("office") is not None or t.get("amenity") in {"bank", "townhall", "courthouse", "police"}),
    ("shop",       lambda t: t.get("shop") is not None or t.get("amenity") == "marketplace" or t.get("building") in {"retail", "supermarket"}),
    # generic fallbacks so we never silently drop a tourism/leisure node
    ("attraction", lambda t: t.get("tourism") is not None or t.get("leisure") is not None),
]

PLACE_RANKS = {"town": 60, "suburb": 42, "neighbourhood": 28, "village": 26, "quarter": 24, "hamlet": 20}

# fine categories whose density we cap + thin so the map stays readable
THIN = {"restaurant": (520, 0.16), "bar": (260, 0.14), "shop": (650, 0.12)}


def haversine_km(lon1, lat1, lon2, lat2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for ep in OVERPASS_ENDPOINTS:
        for attempt in range(3):
            try:
                req = urllib.request.Request(ep, data=data,
                    headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read().decode())
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"  ! {ep} attempt {attempt+1}: {e}")
                time.sleep(4 * (attempt + 1))
        print(f"  -> next mirror")
    raise RuntimeError(f"all Overpass mirrors failed: {last}")


def classify(tags):
    for cat, rule in CAT_RULES:
        try:
            if rule(tags):
                return cat
        except Exception:  # noqa: BLE001
            pass
    return None


def thin(pois):
    """Cap + space out the dense categories (greedy, name-bearing first)."""
    by = {}
    out = []
    for p in pois:
        if p["cat"] in THIN:
            by.setdefault(p["cat"], []).append(p)
        else:
            out.append(p)
    for cat, items in by.items():
        cap, mink = THIN[cat]
        items.sort(key=lambda x: (0 if x["name"] else 1))  # named first
        kept = []
        for p in items:
            if len(kept) >= cap:
                break
            if any(haversine_km(p["lon"], p["lat"], q["lon"], q["lat"]) < mink for q in kept):
                continue
            kept.append(p)
        out.extend(kept)
    return out


def main():
    bs = f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
    print(f"POI re-extract bbox={BBOX}")
    q = f"""[out:json][timeout:180];
    (
      nwr[amenity]({bs});
      nwr[shop]({bs});
      nwr[office]({bs});
      nwr[tourism]({bs});
      nwr[leisure]({bs});
      nwr[building=temple]({bs});
      node[place~"^(town|suburb|village|neighbourhood|quarter|hamlet)$"]({bs});
    );
    out center tags;"""
    j = overpass(q)
    pois, homes = [], []
    cat_counts = {}
    for el in j["elements"]:
        tags = el.get("tags", {})
        if not tags:
            continue
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center")
            lon, lat = (c["lon"], c["lat"]) if c else (None, None)
        if lon is None or lat is None:
            continue
        name = (tags.get("name") or tags.get("name:en") or "")[:60]
        place = tags.get("place")
        if place in PLACE_RANKS and name:
            homes.append({"lon": round(lon, 6), "lat": round(lat, 6),
                          "name": name, "w": PLACE_RANKS[place]})
            continue
        cat = classify(tags)
        if cat is None:
            continue
        pois.append({"lon": round(lon, 6), "lat": round(lat, 6),
                     "p": CAT_TO_P[cat], "cat": cat, "name": name})
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

    pois = thin(pois)
    final = {}
    for p in pois:
        final[p["cat"]] = final.get(p["cat"], 0) + 1
    print(f"  pois {len(pois)} (after thin) {final}")
    print(f"  homes {len(homes)}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"pois": pois, "homes": homes}, f, separators=(",", ":"))
    print(f"  wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
