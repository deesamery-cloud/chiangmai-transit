#!/usr/bin/env python3
"""
Civic LANDMARKS extractor — the named places locals actually navigate by
(railway/bus stations, universities, hospitals, malls, markets, monuments,
museums/attractions, major temples). Deliberately EXCLUDES hotels/guesthouses
(tourism=hotel/guesthouse) so the map shows real landmarks, not lodging.

Writes public/data/<CITY_OUT>/landmarks.json = {"landmarks":[{lon,lat,name,kind}]}
kind ∈ rail|bus|uni|hospital|mall|market|monument|sight|temple

Same env params as the other extractors:
  CITY_BBOX="min_lat,min_lon,max_lat,max_lon"  CITY_OUT=<subdir under public/data>
Pure stdlib (urllib). Run AFTER extract.py / extract-pois.py for a city.
"""

import json
import math
import os
import time
import urllib.parse
import urllib.request

BBOX = (18.750, 98.936, 18.830, 99.032)  # (min_lat, min_lon, max_lat, max_lon)
if os.environ.get("CITY_BBOX"):
    BBOX = tuple(float(x) for x in os.environ["CITY_BBOX"].split(","))
    assert len(BBOX) == 4, "CITY_BBOX must be 'min_lat,min_lon,max_lat,max_lon'"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
UA = "chiangmai-transit-sim/1.0 (educational sandbox; landmarks)"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "data", os.environ.get("CITY_OUT", ""), "landmarks.json")

# how many of each kind to keep + min spacing (km) so the map stays readable;
# (cap, spacing_km, priority) — lower priority shows first / at lower zoom
KIND_RULES = {
    "rail":     (6,  0.20, 0),
    "bus":      (6,  0.20, 0),
    "uni":      (8,  0.30, 1),
    "mall":     (10, 0.20, 1),
    "monument": (8,  0.20, 1),
    "market":   (10, 0.25, 2),
    "hospital": (8,  0.40, 2),
    "sight":    (12, 0.30, 2),
    "temple":   (6,  0.60, 3),
}
TOTAL_CAP = 46

# names that mean a university SUB-feature (a faculty/building), not the campus
UNI_SKIP = ("คณะ", "ภาควิชา", "อาคาร", "ศูนย์", "สถานวิจัย", "สโมสร", "หอ",
            "faculty", "department", "building", "centre", "center", "research", "club", "dormitory", "hall")


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
        print("  -> next mirror")
    raise RuntimeError(f"all Overpass mirrors failed: {last}")


def classify(t):
    """OSM tags -> landmark kind (or None to drop)."""
    name = (t.get("name") or t.get("name:en") or "").strip()
    if not name:
        return None, None
    if t.get("railway") == "station":
        return "rail", name
    if t.get("amenity") == "bus_station":
        return "bus", name
    if t.get("amenity") == "university":
        low = name.lower()
        if any(s in name or s in low for s in UNI_SKIP):
            return None, None  # a faculty/building, not the campus
        return "uni", name
    if t.get("amenity") == "hospital":
        return "hospital", name
    if t.get("shop") in ("mall", "department_store"):
        return "mall", name
    if t.get("amenity") == "marketplace":
        return "market", name
    if t.get("historic") in ("monument", "memorial"):
        return "monument", name
    if t.get("tourism") in ("attraction", "museum", "zoo", "theme_park", "viewpoint", "gallery"):
        return "sight", name
    if t.get("amenity") == "place_of_worship":
        return "temple", name
    return None, None


def main():
    bs = f"{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
    print(f"landmarks bbox={BBOX}")
    q = f"""[out:json][timeout:180];
    (
      nwr[railway=station]({bs});
      nwr[amenity=bus_station]({bs});
      nwr[amenity=university]({bs});
      nwr[amenity=hospital]({bs});
      nwr[shop=mall]({bs});
      nwr[shop=department_store]({bs});
      nwr[amenity=marketplace]({bs});
      nwr[historic~"^(monument|memorial)$"]({bs});
      nwr[tourism~"^(attraction|museum|zoo|theme_park|viewpoint|gallery)$"]({bs});
      nwr[amenity=place_of_worship]({bs});
    );
    out center tags;"""
    j = overpass(q)
    by_kind = {}
    seen_names = set()
    for el in j["elements"]:
        t = el.get("tags", {})
        if not t:
            continue
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center")
            lon, lat = (c["lon"], c["lat"]) if c else (None, None)
        if lon is None or lat is None:
            continue
        kind, name = classify(t)
        if not kind:
            continue
        name = name[:42]
        key = (kind, name)
        if key in seen_names:
            continue
        seen_names.add(key)
        by_kind.setdefault(kind, []).append({"lon": round(lon, 6), "lat": round(lat, 6), "name": name, "kind": kind})

    # thin + cap each kind (greedy, by min spacing), then global cap by priority
    out = []
    for kind, items in by_kind.items():
        cap, mink, _ = KIND_RULES.get(kind, (6, 0.3, 3))
        kept = []
        for p in items:
            if len(kept) >= cap:
                break
            if any(haversine_km(p["lon"], p["lat"], q["lon"], q["lat"]) < mink for q in kept):
                continue
            kept.append(p)
        out.extend(kept)
    out.sort(key=lambda p: KIND_RULES.get(p["kind"], (0, 0, 9))[2])
    out = out[:TOTAL_CAP]

    counts = {}
    for p in out:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1
    print(f"  landmarks {len(out)} {counts}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"landmarks": out}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
