// City registry — the path to "real Thai cities as maps" (#6). Chiang Mai is the
// only city with data shipped today; the others are scaffolded with their bbox so
// `pipeline/extract.py` can generate their graph/zones/pois (see MOBILE.md). Once a
// city's data lands in public/data/<id>/, set `ready: true` and the loader can fetch
// `/data/<id>/network.graph.json` instead of the root files.
//
// NOTE: useSim currently fetches the root `/data/*.json` (Chiang Mai). Wiring the
// per-city loader + a city picker is the remaining work for multi-city.

export interface City {
  id: string;
  name: string;
  nameTh: string;
  center: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat] for extract.py
  dataDir: string; // public/data/<dataDir>/ ("" = root = current Chiang Mai files)
  ready: boolean;
}

export const CITIES: City[] = [
  {
    id: "chiangmai",
    name: "Chiang Mai",
    nameTh: "เชียงใหม่",
    center: [98.984, 18.79],
    bbox: [98.936, 18.75, 99.032, 18.83],
    dataDir: "",
    ready: true,
  },
  // --- scaffolded (need data extraction; see MOBILE.md) ---
  {
    id: "bangkok",
    name: "Bangkok",
    nameTh: "กรุงเทพฯ",
    center: [100.523, 13.745],
    bbox: [100.46, 13.68, 100.62, 13.83],
    dataDir: "bangkok",
    ready: false,
  },
  {
    id: "khonkaen",
    name: "Khon Kaen",
    nameTh: "ขอนแก่น",
    center: [102.833, 16.432],
    bbox: [102.78, 16.39, 102.89, 16.49],
    dataDir: "khonkaen",
    ready: false,
  },
  {
    id: "phuket",
    name: "Phuket",
    nameTh: "ภูเก็ต",
    center: [98.388, 7.884],
    bbox: [98.33, 7.83, 98.45, 7.95],
    dataDir: "phuket",
    ready: false,
  },
];

export const DEFAULT_CITY = CITIES[0];
