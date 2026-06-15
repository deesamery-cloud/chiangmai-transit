// Shared domain types used by both the main thread and the sim worker.

export interface GraphData {
  meta: {
    bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
    center: [number, number]; // [lon, lat]
    nodeCount: number;
    edgeCount: number;
  };
  coords: number[]; // flat [lon, lat, lon, lat, ...]
  edges: number[]; // flat [u, v, lenM, u, v, lenM, ...] undirected
}

export type Purpose =
  | "work"
  | "edu"
  | "health"
  | "temple"
  | "transit"
  | "shop"
  | "leisure";

// Fine visual category for map markers (richer than the coarse engine Purpose).
export type PoiCat =
  | "restaurant"
  | "bar"
  | "temple"
  | "hospital"
  | "school"
  | "attraction"
  | "shop"
  | "office"
  | "transit";

export interface Poi {
  lon: number;
  lat: number;
  p: Purpose;
  name: string;
  cat?: PoiCat; // optional finer category (added by extract-pois.py)
}

// A named residential place — a trip ORIGIN the map shows as a home marker.
export interface HomePlace {
  lon: number;
  lat: number;
  name: string;
  w?: number;
}

export interface PoiData {
  pois: Poi[];
  homes?: HomePlace[];
}

export interface Zone {
  lon: number;
  lat: number;
  prod: number; // production weight (building count)
  attr: Partial<Record<Purpose, number>>; // attraction by purpose
}

export interface ZoneData {
  cell: { w: number; h: number; rows: number; cols: number };
  zones: Zone[];
}

// --- Transit network -------------------------------------------------------

export type LineMode = "metro" | "songthaew";

export interface Stop {
  node: number; // graph node index
  lon: number;
  lat: number;
}

// A station the player has placed but not yet connected with rail. Lives only
// on the client (the sim only needs finished lines); connecting these builds a
// line whose stops ARE these stations.
export interface PlacedStation {
  id: string;
  lon: number;
  lat: number;
  node: number; // snapped road-graph node
  name?: string; // auto-named from the nearest landmark (Bangkok-style)
}

export interface TransitLine {
  id: string;
  mode: LineMode;
  color: [number, number, number];
  stops: Stop[]; // for songthaew these are dense auto-generated hail points
  path: number[]; // ordered graph node indices; for metro a straight off-road alignment
  cumDist: number[]; // cumulative metres at each path node (length == path.length)
  stopDist: number[]; // cumulative metres at each stop (length == stops.length)
  totalLen: number;
  headwaySec: number;
  capacity: number;
  speed: number; // m/s free-flow cruising speed for this mode
  dwellSec: number; // pause at each stop
  fare: number; // baht (flat)
  flexible: boolean; // hail/alight anywhere along the corridor (unused now)
  roadbound: boolean; // true = shares roads, slows in & adds to traffic (bus)
  fleet: number; // number of vehicles (trains/buses) running this line, 1-5
  capex: number; // one-off build cost (baht)
  stationIds?: string[]; // ordered PlacedStation ids this line is built from (for extend / per-station demolish)
}

export interface PerLine {
  id: string;
  mode: LineMode;
  color: [number, number, number];
  riders: number; // currently aboard
  waiting: number; // queued at this line's stops
  util: number; // 0-1 load factor across its vehicles
  fleet: number; // vehicles on this line
}

export interface HotSpot {
  lon: number;
  lat: number;
  demand: number; // unserved demand weight
  label: string; // nearest landmark name
}

// One origin→destination travel corridor, classed met/unmet by the live network.
export interface ODCorridor {
  oName: string; // origin (residential) name
  dName: string; // destination (activity centre) name
  oLon: number;
  oLat: number;
  dLon: number;
  dLat: number;
  demand: number; // ≈ trips/day (relative priority)
  met: boolean; // true = transit beats driving this corridor
}

// --- Worker protocol -------------------------------------------------------

export interface SnapshotMeta {
  simTime: number; // sim-seconds since midnight
  day: number; // whole sim-days elapsed
  agentCount: number;
  walking: number;
  waiting: number;
  riding: number;
  dwelling: number;
  driving: number; // agents currently in a private car
  congestion: number; // 0-100 road-traffic index
  tripsDone: number;
  busRiders: number; // cumulative transit boardings (all modes)
  transferTrips: number; // cumulative journeys that used >1 line
  avgWaitSec: number;
  satisfaction: number; // 0-100 rider satisfaction — falls with crowding + long waits
  // economy
  budget: number; // baht (Infinity in sandbox)
  dailyRevenue: number; // baht/day (rolling)
  dailyOpex: number; // baht/day
  dailyRiders: number; // boardings over the last ~24h (the goal metric)
  goalTarget: number;
  stars: number; // 0-3
  bankrupt: boolean;
  // decision support
  coverage: number; // 0-100 share of demand within walk of a stop
  hotspots: HotSpot[];
  perLine: PerLine[];
  // origin→destination priorities (live)
  odUnmet: ODCorridor[]; // top corridors people still DRIVE — prioritise these
  odMet: ODCorridor[]; // top corridors your transit already serves
  odServedFrac: number; // 0-1 share of total OD demand served by transit
  odMetCount: number; // corridors served
  odTotalCount: number; // corridors tracked
  // who is riding — 24h boardings split by traveller kind
  ridersByKind: { resident: number; student: number; tourist: number };
  activeEvent: { id: string; icon: string; daysLeft: number } | null; // current light event
  events: string[]; // new event messages since last snapshot (for the ticker)
  vehicles: {
    lon: number;
    lat: number;
    load: number;
    cap: number;
    crowd: number; // 1 (empty) .. 5 (full) — live crowding level
    road: boolean; // true = road vehicle (songthaew truck), false = metro train
    color: [number, number, number];
  }[];
}

export type ToWorker =
  | {
      type: "init";
      graph: GraphData;
      zones: ZoneData;
      pois: PoiData;
      agentCount: number;
      startBudget: number;
      bankruptcy: boolean;
      // difficulty multipliers (1 = neutral / Medium)
      costMult?: number;
      opexMult?: number;
      fareMult?: number;
      capMult?: number;
      seed?: number; // per-run seed: perturbs OD demand + the event schedule
    }
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; value: number }
  | { type: "setNetwork"; lines: TransitLine[] };

export type FromWorker =
  | { type: "ready" }
  | {
      type: "snapshot";
      positions: ArrayBuffer; // Float32Array, length 2 * agentCount
      states: ArrayBuffer; // Uint8Array, length agentCount
      meta: SnapshotMeta;
    };
