import { Graph, haversine } from "@/lib/geo/graph";
import { Router } from "@/lib/routing/astar";
import type {
  HomePlace,
  HotSpot,
  ODCorridor,
  PerLine,
  Poi,
  PoiData,
  Purpose,
  SnapshotMeta,
  TransitLine,
  ZoneData,
} from "@/lib/types";
import { type AgentKind, DEMOGRAPHICS, ECONOMY, GOAL, OD, SIM, TRAVEL } from "@/lib/config";

const KINDS: AgentKind[] = ["resident", "student", "tourist"];

// One end of an OD corridor (a named origin home or destination activity centre).
interface ODHub {
  lon: number;
  lat: number;
  node: number;
  name: string;
  w: number; // gravity weight
}
interface ODPair {
  o: number; // index into odO
  d: number; // index into odD
  base: number; // base gravity demand
  dist: number; // straight-line metres O→D
}

// agent.state
const WALKING = 0;
const WAITING = 1;
const IN_VEHICLE = 2;
const DWELL = 3;
const DRIVING = 4;
// agent.after
const AFTER_ARRIVE = 0;
const AFTER_BOARD = 1;

const PURPOSE_WEIGHT: Record<Purpose, number> = {
  work: 3,
  edu: 2.5,
  shop: 1.5,
  health: 1,
  temple: 0.6,
  leisure: 1,
  transit: 0.3,
};

interface Vehicle {
  rt: LineRuntime;
  s: number;
  dir: number;
  seg: number;
  lon: number;
  lat: number;
  load: number;
  aboard: number[];
  dwell: number;
  nextStop: number;
}

interface LineRuntime {
  line: TransitLine;
  vehicles: Vehicle[];
  waitQ: number[][];
}

interface RideLeg {
  rt: LineRuntime;
  board: number; // stop index to board at
  alight: number; // stop index to get off at
}

interface Agent {
  id: number;
  kind: AgentKind;
  lon: number;
  lat: number;
  state: number;
  curNode: number;
  atHome: boolean;
  homeNode: number;
  homeLon: number;
  homeLat: number;
  path: number[] | null;
  cum: number[] | null;
  seg: number;
  dist: number;
  after: number;
  destNode: number;
  destLon: number;
  destLat: number;
  rt: LineRuntime | null; // current leg's line
  veh: Vehicle | null;
  boardStopIdx: number; // current leg board
  alightStopIdx: number; // current leg alight
  legs: RideLeg[] | null; // full journey (1 or 2 legs)
  legIdx: number;
  waitStart: number;
  dwellUntil: number;
}

export class SimEngine {
  private graph: Graph;
  private router: Router;
  private agents: Agent[] = [];
  private lines: LineRuntime[] = [];
  private transfers = new Map<string, { aIdx: number; bIdx: number; walk: number }>();
  private transferTrips = 0;

  private pois: Poi[];
  private poiNode: Int32Array;
  private poiCum: Float64Array;
  private poiTotal = 0;
  // demographic anchor pools (indices into this.pois)
  private eduIdx: number[] = []; // universities / schools — student campuses
  private hotelIdx: number[] = []; // leisure POIs — tourist lodging anchors
  private touristDestIdx: number[] = []; // temples/markets/sights — tourist destinations
  private kindCum: number[] = []; // cumulative share thresholds for sampling a kind
  private hourlyBoardKind: Record<AgentKind, Float64Array> = {
    resident: new Float64Array(24),
    student: new Float64Array(24),
    tourist: new Float64Array(24),
  };

  private zoneCum: Float64Array;
  private zoneNode: Int32Array;
  private zoneLon: Float64Array;
  private zoneLat: Float64Array;
  private zoneProd: Float64Array;
  private zoneTotal = 0;
  private cellW: number;
  private cellH: number;

  // congestion grid
  private congCols: number;
  private congRows: number;
  private congMinLon: number;
  private congMinLat: number;
  private congDLon: number;
  private congDLat: number;
  private congLoad: Float32Array;
  private readonly minSpeedRatio = TRAVEL.carMinSpeed / TRAVEL.carFreeSpeed;
  private avgFactor = 1; // weighted mean road-speed factor (1 = free-flow)

  private time = SIM.startSeconds;
  private tripsDone = 0;
  private boardings = 0;
  private waitSum = 0;
  private waitCount = 0;

  // economy + objectives
  private budget: number;
  private bankruptcy: boolean;
  private bankrupt = false;
  private opexPerSec = 0;
  private elapsed = 0; // unwrapped sim-seconds (for day/hour rollups)
  private lastHb = 0;
  private hourlyBoard = new Float64Array(24); // boardings in last ~24h
  private hourlyRev = new Float64Array(24); // revenue (baht) in last ~24h
  private milestoneDone: boolean[] = GOAL.milestones.map(() => false);
  private goalDone = false;
  private events: string[] = [];
  // decision support
  private coverage = 0;
  private hotspots: HotSpot[] = [];
  private overcrowded = new Set<string>();

  // origin→destination demand model
  private odO: ODHub[] = [];
  private odD: ODHub[] = [];
  private odPairs: ODPair[] = [];
  private odScale = 1;
  private odUnmet: ODCorridor[] = [];
  private odMet: ODCorridor[] = [];
  private odServedFrac = 0;
  private odMetCount = 0;
  private lastOD = -1e9;

  // difficulty multipliers (1 = Medium / neutral)
  private costMult = 1;
  private opexMult = 1;
  private fareMult = 1;
  private capMult = 1;

  constructor(
    graph: Graph,
    zones: ZoneData,
    poiData: PoiData,
    agentCount: number,
    startBudget = Infinity,
    bankruptcy = false,
    mults?: { costMult?: number; opexMult?: number; fareMult?: number; capMult?: number },
  ) {
    this.budget = startBudget;
    this.bankruptcy = bankruptcy;
    this.costMult = mults?.costMult ?? 1;
    this.opexMult = mults?.opexMult ?? 1;
    this.fareMult = mults?.fareMult ?? 1;
    this.capMult = mults?.capMult ?? 1;
    this.graph = graph;
    this.router = new Router(graph);
    this.pois = poiData.pois;

    const P = this.pois.length;
    this.poiNode = new Int32Array(P);
    this.poiCum = new Float64Array(P);
    for (let i = 0; i < P; i++) {
      const poi = this.pois[i];
      this.poiNode[i] = graph.nearestNode(poi.lon, poi.lat);
      this.poiTotal += PURPOSE_WEIGHT[poi.p] ?? 1;
      this.poiCum[i] = this.poiTotal;
      // demographic anchor pools
      if (poi.p === "edu") this.eduIdx.push(i);
      if (poi.p === "leisure") this.hotelIdx.push(i); // guesthouses/hotels/bars
      if (poi.p === "temple" || poi.p === "shop" || poi.p === "leisure") this.touristDestIdx.push(i);
    }
    // fallbacks so sampling never divides by zero on sparse data
    if (!this.eduIdx.length) this.eduIdx = [0];
    if (!this.hotelIdx.length) this.hotelIdx = [0];
    if (!this.touristDestIdx.length) this.touristDestIdx = [0];
    // cumulative share thresholds for picking a traveller kind
    let acc = 0;
    this.kindCum = KINDS.map((k) => (acc += DEMOGRAPHICS[k].share));

    this.cellW = zones.cell.w;
    this.cellH = zones.cell.h;
    const Z = zones.zones.length;
    this.zoneCum = new Float64Array(Z);
    this.zoneNode = new Int32Array(Z);
    this.zoneLon = new Float64Array(Z);
    this.zoneLat = new Float64Array(Z);
    this.zoneProd = new Float64Array(Z);
    for (let i = 0; i < Z; i++) {
      const z = zones.zones[i];
      const w = z.prod + 0.5;
      this.zoneTotal += w;
      this.zoneCum[i] = this.zoneTotal;
      this.zoneNode[i] = graph.nearestNode(z.lon, z.lat);
      this.zoneLon[i] = z.lon;
      this.zoneLat[i] = z.lat;
      this.zoneProd[i] = z.prod;
    }

    // congestion grid over the map bbox
    const [minLon, minLat, maxLon, maxLat] = graph.bbox;
    const midLat = (minLat + maxLat) / 2;
    this.congDLat = TRAVEL.congCellM / 111000;
    this.congDLon = TRAVEL.congCellM / (111000 * Math.cos((midLat * Math.PI) / 180));
    this.congMinLon = minLon;
    this.congMinLat = minLat;
    this.congCols = Math.max(1, Math.ceil((maxLon - minLon) / this.congDLon) + 1);
    this.congRows = Math.max(1, Math.ceil((maxLat - minLat) / this.congDLat) + 1);
    this.congLoad = new Float32Array(this.congCols * this.congRows);

    this.spawnAgents(agentCount);
    this.computeCoverage();
    this.buildOD(poiData.homes ?? []);
    this.refreshOD();
  }

  get agentCount(): number {
    return this.agents.length;
  }

  // ------------------------------------------------------------------ setup
  private sampleKind(): AgentKind {
    const r = Math.random();
    for (let i = 0; i < KINDS.length; i++) if (r < this.kindCum[i]) return KINDS[i];
    return "resident";
  }
  // a home node appropriate to the traveller kind: tourists lodge at central
  // hotels, students near a campus, residents by building density.
  private homeNodeFor(kind: AgentKind): number {
    const g = this.graph;
    if (kind === "tourist") {
      const p = this.hotelIdx[(Math.random() * this.hotelIdx.length) | 0];
      return this.poiNode[p];
    }
    if (kind === "student") {
      const poi = this.pois[this.eduIdx[(Math.random() * this.eduIdx.length) | 0]];
      const jLon = poi.lon + (Math.random() - 0.5) * 0.011; // ~±600 m dorm spread
      const jLat = poi.lat + (Math.random() - 0.5) * 0.011;
      return g.nearestNode(jLon, jLat);
    }
    const z = this.sampleZone();
    const jLon = this.zoneLon[z] + (Math.random() - 0.5) * this.cellW;
    const jLat = this.zoneLat[z] + (Math.random() - 0.5) * this.cellH;
    return g.nearestNode(jLon, jLat);
  }

  private spawnAgents(count: number): void {
    for (let i = 0; i < count; i++) {
      const kind = this.sampleKind();
      const homeNode = this.homeNodeFor(kind);
      this.agents.push({
        id: i,
        kind,
        lon: this.graph.lon(homeNode),
        lat: this.graph.lat(homeNode),
        state: DWELL,
        curNode: homeNode,
        atHome: true,
        homeNode,
        homeLon: this.graph.lon(homeNode),
        homeLat: this.graph.lat(homeNode),
        path: null,
        cum: null,
        seg: 0,
        dist: 0,
        after: AFTER_ARRIVE,
        destNode: homeNode,
        destLon: 0,
        destLat: 0,
        rt: null,
        veh: null,
        boardStopIdx: -1,
        alightStopIdx: -1,
        legs: null,
        legIdx: 0,
        waitStart: 0,
        dwellUntil: this.time + Math.random() * SIM.dwellMaxSec,
      });
    }
  }

  private sampleZone(): number {
    return this.lowerBound(this.zoneCum, Math.random() * this.zoneTotal);
  }
  private samplePoi(): number {
    return this.lowerBound(this.poiCum, Math.random() * this.poiTotal);
  }
  // a destination POI appropriate to the traveller kind: tourists sightsee
  // (temples/markets/sights), students mostly head to campus, residents anywhere.
  private destPoiFor(kind: AgentKind): number {
    if (kind === "tourist") return this.touristDestIdx[(Math.random() * this.touristDestIdx.length) | 0];
    if (kind === "student" && Math.random() < 0.7) return this.eduIdx[(Math.random() * this.eduIdx.length) | 0];
    return this.samplePoi();
  }
  private kindRiders(): { resident: number; student: number; tourist: number } {
    const sum = (a: Float64Array) => {
      let s = 0;
      for (let i = 0; i < 24; i++) s += a[i];
      return Math.round(s);
    };
    return {
      resident: sum(this.hourlyBoardKind.resident),
      student: sum(this.hourlyBoardKind.student),
      tourist: sum(this.hourlyBoardKind.tourist),
    };
  }
  // time-of-day demand multiplier, per traveller kind: residents peak at the
  // 8am/6pm commute, students at class hours, tourists midday→evening.
  private peakMult(kind: AgentKind = "resident"): number {
    const d = DEMOGRAPHICS[kind];
    const h = (this.time / 3600) % 24;
    let hump = 0;
    for (const hr of d.peakHours) hump += Math.exp(-((h - hr) ** 2) / d.peakSpread);
    return d.peakBase + d.peakAmp * Math.min(1, hump);
  }
  private lowerBound(cum: Float64Array, r: number): number {
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ----------------------------------------------------------- congestion
  private congCell(lon: number, lat: number): number {
    let cx = Math.floor((lon - this.congMinLon) / this.congDLon);
    let cy = Math.floor((lat - this.congMinLat) / this.congDLat);
    if (cx < 0) cx = 0;
    else if (cx >= this.congCols) cx = this.congCols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.congRows) cy = this.congRows - 1;
    return cy * this.congCols + cx;
  }

  /** Speed multiplier (fraction of free-flow) at a point given current traffic. */
  private factorAt(lon: number, lat: number): number {
    const load = this.congLoad[this.congCell(lon, lat)];
    const f = 1 / (1 + load / TRAVEL.congCellCap);
    return f < this.minSpeedRatio ? this.minSpeedRatio : f;
  }

  private accumulateCongestion(): void {
    this.congLoad.fill(0);
    for (const a of this.agents) {
      if (a.state === DRIVING) this.congLoad[this.congCell(a.lon, a.lat)] += 1;
    }
    for (const rt of this.lines) {
      if (!rt.line.roadbound) continue;
      for (const v of rt.vehicles) {
        this.congLoad[this.congCell(v.lon, v.lat)] += TRAVEL.busCongWeight;
      }
    }
    // weighted mean speed factor across occupied cells (what the average
    // road vehicle experiences) — drives both the meter and mode choice
    let wsum = 0;
    let fsum = 0;
    for (let c = 0; c < this.congLoad.length; c++) {
      const load = this.congLoad[c];
      if (load <= 0) continue;
      let f = 1 / (1 + load / TRAVEL.congCellCap);
      if (f < this.minSpeedRatio) f = this.minSpeedRatio;
      fsum += f * load;
      wsum += load;
    }
    this.avgFactor = wsum ? fsum / wsum : 1;
  }

  // ------------------------------------------------------------- network edits
  setNetwork(lines: TransitLine[]): void {
    const byId = new Map<string, LineRuntime>();
    for (const rt of this.lines) byId.set(rt.line.id, rt);
    const hadId = new Set(this.lines.map((rt) => rt.line.id));
    const next: LineRuntime[] = [];
    const kept = new Set<LineRuntime>();
    for (const line of lines) {
      const old = byId.get(line.id);
      if (old && sameLine(old.line, line)) {
        old.line = line; // adopt cosmetic updates (colour) without a rebuild
        next.push(old);
        kept.add(old);
      } else {
        const rt: LineRuntime = { line, vehicles: [], waitQ: line.stops.map(() => []) };
        this.rebuildVehicles(rt);
        next.push(rt);
        if (!hadId.has(line.id)) {
          // a brand-new line: charge the build cost
          if (isFinite(this.budget)) this.budget -= line.capex * this.costMult;
          this.events.push(`Built ${line.mode === "metro" ? "Metro" : "Bus"} line — ฿${money(line.capex)}`);
        }
      }
    }
    for (const a of this.agents) {
      if (a.rt && !kept.has(a.rt)) {
        a.curNode = this.graph.nearestNode(a.lon, a.lat);
        a.state = DWELL;
        a.dwellUntil = this.time;
        a.rt = null;
        a.veh = null;
        a.legs = null;
        a.path = null;
        a.cum = null;
      }
    }
    this.lines = next;
    this.buildTransfers();
    this.recomputeOpex();
    this.computeCoverage();
    this.refreshOD(); // reclassify met/unmet immediately when the network changes
    this.lastOD = this.elapsed;
  }

  /** Best transfer point (closest stop pair) for each ordered pair of lines. */
  private buildTransfers(): void {
    this.transfers.clear();
    const L = this.lines;
    for (let i = 0; i < L.length; i++) {
      for (let j = 0; j < L.length; j++) {
        if (i === j) continue;
        const A = L[i].line;
        const B = L[j].line;
        let best: { aIdx: number; bIdx: number; walk: number } | null = null;
        for (let sa = 0; sa < A.stops.length; sa++) {
          const as = A.stops[sa];
          for (let sb = 0; sb < B.stops.length; sb++) {
            const d = haversine(as.lon, as.lat, B.stops[sb].lon, B.stops[sb].lat);
            if (d <= TRAVEL.transferMaxM && (!best || d < best.walk)) {
              best = { aIdx: sa, bIdx: sb, walk: d };
            }
          }
        }
        if (best) this.transfers.set(`${A.id}|${B.id}`, best);
      }
    }
  }

  private recomputeOpex(): void {
    let o = 0;
    for (const rt of this.lines) {
      const e = ECONOMY[rt.line.mode];
      o += (e.opexPerKmDay * (rt.line.totalLen / 1000) + e.opexPerVehDay * rt.vehicles.length) * this.opexMult;
    }
    this.opexPerSec = o / SIM.daySeconds;
  }

  /** A zone is "covered" if any stop is within walking distance of it. */
  private computeCoverage(): void {
    const stops: { lon: number; lat: number }[] = [];
    for (const rt of this.lines) for (const s of rt.line.stops) stops.push(s);

    let coveredProd = 0;
    let total = 0;
    const uncovered: { i: number; prod: number }[] = [];
    for (let i = 0; i < this.zoneProd.length; i++) {
      const prod = this.zoneProd[i];
      total += prod;
      let covered = false;
      const zl = this.zoneLon[i];
      const zt = this.zoneLat[i];
      for (let s = 0; s < stops.length; s++) {
        if (haversine(zl, zt, stops[s].lon, stops[s].lat) <= SIM.maxAccessWalkM) {
          covered = true;
          break;
        }
      }
      if (covered) coveredProd += prod;
      else if (prod > 0) uncovered.push({ i, prod });
    }
    this.coverage = total ? (coveredProd / total) * 100 : 0;

    uncovered.sort((a, b) => b.prod - a.prod);
    this.hotspots = uncovered.slice(0, 8).map((u) => ({
      lon: this.zoneLon[u.i],
      lat: this.zoneLat[u.i],
      demand: u.prod,
      label: this.nearestPoiName(this.zoneLon[u.i], this.zoneLat[u.i]),
    }));
  }

  private nearestPoiName(lon: number, lat: number): string {
    let best = "";
    let bestD = Infinity;
    for (const poi of this.pois) {
      if (!poi.name) continue;
      const d = haversine(lon, lat, poi.lon, poi.lat);
      if (d < bestD) {
        bestD = d;
        best = poi.name;
      }
    }
    return best || "this area";
  }

  // ----------------------------------------------------------- OD demand model
  /** Build named origin (homes) + destination (clustered POIs) hubs + the
   *  gravity demand matrix between them. Runs once at startup. */
  private buildOD(homes: HomePlace[]): void {
    const g = this.graph;
    // origins: residential homes (fall back to top-production zones)
    let origins: ODHub[] = homes
      .filter((h) => h.name)
      .map((h) => ({ lon: h.lon, lat: h.lat, node: g.nearestNode(h.lon, h.lat), name: h.name, w: h.w ?? 1 }));
    if (origins.length < 2) {
      const idx = Array.from(this.zoneProd.keys()).sort((a, b) => this.zoneProd[b] - this.zoneProd[a]);
      origins = idx.slice(0, OD.originHubs).map((i) => ({
        lon: this.zoneLon[i], lat: this.zoneLat[i], node: this.zoneNode[i],
        name: this.nearestPoiName(this.zoneLon[i], this.zoneLat[i]), w: this.zoneProd[i] + 1,
      }));
    }
    origins.sort((a, b) => b.w - a.w);
    this.odO = origins.slice(0, OD.originHubs);
    // diversify origins with tourist hotel cores + student campuses, so the OD
    // priority list shows touristy/campus corridors, not only village→work
    const meanW = this.odO.reduce((s, h) => s + h.w, 0) / Math.max(1, this.odO.length);
    this.odO = [
      ...this.odO,
      ...this.clusterHubs(this.hotelIdx, 4, meanW * 1.2),
      ...this.clusterHubs(this.eduIdx, 4, meanW * 1.0),
    ];

    // destinations: grid-cluster POI attraction; label each cell by its strongest
    // named non-leisure POI (recognisable anchors — temples, schools, markets…)
    const [minLon, minLat, maxLon, maxLat] = g.bbox;
    const midLat = (minLat + maxLat) / 2;
    const dLat = OD.cellM / 111000;
    const dLon = OD.cellM / (111000 * Math.cos((midLat * Math.PI) / 180));
    const cols = Math.max(1, Math.ceil((maxLon - minLon) / dLon) + 1);
    const rows = Math.max(1, Math.ceil((maxLat - minLat) / dLat) + 1);
    const W = new Float64Array(cols * rows);
    const sLon = new Float64Array(cols * rows);
    const sLat = new Float64Array(cols * rows);
    const bestScore = new Float64Array(cols * rows);
    const bestName: string[] = new Array(cols * rows).fill("");
    for (let i = 0; i < this.pois.length; i++) {
      const poi = this.pois[i];
      const w = PURPOSE_WEIGHT[poi.p] ?? 1;
      let cx = Math.floor((poi.lon - minLon) / dLon);
      let cy = Math.floor((poi.lat - minLat) / dLat);
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      const c = cy * cols + cx;
      W[c] += w;
      sLon[c] += poi.lon * w;
      sLat[c] += poi.lat * w;
      const score = w + (poi.name ? 2 : -5) + (poi.p !== "leisure" ? 1.5 : 0);
      if (poi.name && score > bestScore[c]) { bestScore[c] = score; bestName[c] = poi.name; }
    }
    const cells: { c: number; w: number }[] = [];
    for (let c = 0; c < W.length; c++) if (W[c] > 0) cells.push({ c, w: W[c] });
    cells.sort((a, b) => b.w - a.w);
    this.odD = cells.slice(0, OD.destHubs).map(({ c, w }) => {
      const lon = sLon[c] / w, lat = sLat[c] / w;
      return { lon, lat, node: g.nearestNode(lon, lat), name: bestName[c] || this.nearestPoiName(lon, lat), w };
    });

    // gravity demand matrix O×D (skip walkable-short pairs)
    this.odPairs = [];
    let maxBase = 0;
    for (let o = 0; o < this.odO.length; o++) {
      for (let d = 0; d < this.odD.length; d++) {
        const O = this.odO[o], D = this.odD[d];
        const dist = haversine(O.lon, O.lat, D.lon, D.lat);
        if (dist < TRAVEL.walkMaxM) continue;
        const base = (O.w * D.w * Math.exp(-dist / OD.decayM)) / 1000;
        if (base <= 0) continue;
        this.odPairs.push({ o, d, base, dist });
        if (base > maxBase) maxBase = base;
      }
    }
    this.odScale = maxBase > 0 ? OD.scaleTop / maxBase : 1;
  }

  /** Pick up to `count` well-separated named POIs from a pool as OD hubs. */
  private clusterHubs(idxs: number[], count: number, w: number): ODHub[] {
    const g = this.graph;
    const used: { lon: number; lat: number }[] = [];
    const hubs: ODHub[] = [];
    for (const i of idxs) {
      if (hubs.length >= count) break;
      const poi = this.pois[i];
      if (!poi.name) continue;
      if (used.some((u) => haversine(u.lon, u.lat, poi.lon, poi.lat) < 1500)) continue;
      used.push({ lon: poi.lon, lat: poi.lat });
      hubs.push({ lon: poi.lon, lat: poi.lat, node: g.nearestNode(poi.lon, poi.lat), name: poi.name, w });
    }
    return hubs;
  }

  /** Cheapest transit JOURNEY (direct or one transfer) in generalised minutes
   *  between two points. Shared by agent trip-planning AND OD classification, so
   *  "met" means exactly what an agent would actually choose. */
  private bestTransitJourney(
    oLon: number, oLat: number, destLon: number, destLat: number,
    access: number = SIM.maxAccessWalkM,
  ): { cost: number; legs: RideLeg[] | null } {
    const fareMin = TRAVEL.fareMinPerBaht;
    const boardInfo = this.lines.map((rt) => nearestStop(rt.line, oLon, oLat));
    const alightInfo = this.lines.map((rt) => nearestStop(rt.line, destLon, destLat));
    let bestLegs: RideLeg[] | null = null;
    let bestCost = Infinity;
    const inVehMin = (line: TransitLine, from: number, to: number): number => {
      const ride = Math.abs(line.stopDist[to] - line.stopDist[from]) / line.speed;
      const dwell = Math.abs(to - from) * line.dwellSec;
      return (ride + dwell + line.headwaySec / 2) / 60;
    };
    // direct (single line)
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i].line;
      if (line.stops.length < 2) continue;
      const b = boardInfo[i];
      const al = alightInfo[i];
      if (b.idx < 0 || al.idx < 0 || b.idx === al.idx || b.dist > access || al.dist > access) continue;
      const cost =
        b.dist / SIM.walkSpeed / 60 + inVehMin(line, b.idx, al.idx) + al.dist / SIM.walkSpeed / 60 + line.fare * fareMin;
      if (cost < bestCost) { bestCost = cost; bestLegs = [{ rt: this.lines[i], board: b.idx, alight: al.idx }]; }
    }
    // one transfer
    for (let i = 0; i < this.lines.length; i++) {
      const bA = boardInfo[i];
      if (bA.idx < 0 || bA.dist > access) continue;
      const A = this.lines[i].line;
      for (let j = 0; j < this.lines.length; j++) {
        if (i === j) continue;
        const alB = alightInfo[j];
        if (alB.idx < 0 || alB.dist > access) continue;
        const B = this.lines[j].line;
        const tr = this.transfers.get(`${A.id}|${B.id}`);
        if (!tr || bA.idx === tr.aIdx || tr.bIdx === alB.idx) continue;
        const cost =
          bA.dist / SIM.walkSpeed / 60 + inVehMin(A, bA.idx, tr.aIdx) + tr.walk / SIM.walkSpeed / 60 +
          TRAVEL.transferPenaltyMin + inVehMin(B, tr.bIdx, alB.idx) + alB.dist / SIM.walkSpeed / 60 +
          (A.fare + B.fare) * fareMin;
        if (cost < bestCost) {
          bestCost = cost;
          bestLegs = [
            { rt: this.lines[i], board: bA.idx, alight: tr.aIdx },
            { rt: this.lines[j], board: tr.bIdx, alight: alB.idx },
          ];
        }
      }
    }
    return { cost: bestCost, legs: bestLegs };
  }

  /** Recompute, live, which corridors transit serves (met) vs not (unmet). */
  private refreshOD(): void {
    if (!this.odPairs.length) {
      this.odServedFrac = 0; this.odMetCount = 0; this.odUnmet = []; this.odMet = [];
      return;
    }
    const day = Math.floor(this.elapsed / SIM.daySeconds);
    const peak = this.peakMult();
    const driveSpeed = Math.max(TRAVEL.carMinSpeed, TRAVEL.carFreeSpeed * this.avgFactor);
    const corr: ODCorridor[] = [];
    let metSum = 0, allSum = 0, metCount = 0;
    for (const p of this.odPairs) {
      const h = Math.sin(p.o * 12.9898 + p.d * 78.233 + day * 3.71) * 43758.5453;
      const jit = 0.85 + 0.3 * (h - Math.floor(h)); // deterministic daily wobble ("each turn")
      const demand = p.base * jit * peak;
      const driveCost = (p.dist * 1.3) / driveSpeed / 60 + TRAVEL.parkPenaltyMin;
      const O = this.odO[p.o], D = this.odD[p.d];
      const { cost } = this.bestTransitJourney(O.lon, O.lat, D.lon, D.lat, OD.accessM);
      const met = isFinite(cost) && cost <= driveCost * TRAVEL.transitPref;
      allSum += demand;
      if (met) { metSum += demand; metCount++; }
      corr.push({
        oName: O.name, dName: D.name, oLon: O.lon, oLat: O.lat, dLon: D.lon, dLat: D.lat,
        demand: Math.round(demand * this.odScale), met,
      });
    }
    this.odServedFrac = allSum ? metSum / allSum : 0;
    this.odMetCount = metCount;
    this.odUnmet = corr.filter((c) => !c.met).sort((a, b) => b.demand - a.demand).slice(0, OD.topUnmet);
    this.odMet = corr.filter((c) => c.met).sort((a, b) => b.demand - a.demand).slice(0, OD.topMet);
  }

  private rebuildVehicles(rt: LineRuntime): void {
    const line = rt.line;
    if (line.totalLen <= 0 || line.stops.length < 2) return;
    const roundTrip = 2 * line.totalLen;
    const n = Math.max(1, Math.min(5, Math.round(line.fleet))); // player-chosen fleet
    for (let v = 0; v < n; v++) {
      const phase = (v / n) * roundTrip;
      let s: number;
      let dir: number;
      if (phase <= line.totalLen) {
        s = phase;
        dir = 1;
      } else {
        s = 2 * line.totalLen - phase;
        dir = -1;
      }
      const veh: Vehicle = {
        rt,
        s,
        dir,
        seg: locateSeg(line.cumDist, s),
        lon: 0,
        lat: 0,
        load: 0,
        aboard: [],
        dwell: 0,
        nextStop: firstStopAhead(line.stopDist, s, dir),
      };
      this.setVehiclePos(veh);
      rt.vehicles.push(veh);
    }
  }

  private setVehiclePos(veh: Vehicle): void {
    const line = veh.rt.line;
    const cum = line.cumDist;
    let seg = veh.seg;
    while (seg < cum.length - 2 && cum[seg + 1] < veh.s) seg++;
    while (seg > 0 && cum[seg] > veh.s) seg--;
    veh.seg = seg;
    const a = line.path[seg];
    const b = line.path[Math.min(seg + 1, line.path.length - 1)];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const frac = Math.min(1, Math.max(0, (veh.s - cum[seg]) / segLen));
    veh.lon = this.graph.lon(a) + (this.graph.lon(b) - this.graph.lon(a)) * frac;
    veh.lat = this.graph.lat(a) + (this.graph.lat(b) - this.graph.lat(a)) * frac;
  }

  // -------------------------------------------------------------------- step
  step(dt: number): void {
    if (dt <= 0) return;
    if (dt > 60) dt = 60;
    this.time = (this.time + dt) % SIM.daySeconds;
    this.elapsed += dt;
    this.rollHours();

    this.accumulateCongestion();

    for (const rt of this.lines) {
      for (const veh of rt.vehicles) this.stepVehicle(veh, dt);
    }
    for (const a of this.agents) this.stepAgent(a, dt);

    if (isFinite(this.budget)) this.budget -= this.opexPerSec * dt;
    if (this.elapsed - this.lastOD > OD.refreshSec) {
      this.lastOD = this.elapsed;
      this.refreshOD();
    }
    this.checkObjectives();
  }

  private rollHours(): void {
    const hb = Math.floor(this.elapsed / 3600);
    if (hb !== this.lastHb) {
      const gap = Math.min(24, hb - this.lastHb);
      for (let k = 0; k < gap; k++) {
        const b = (this.lastHb + 1 + k) % 24;
        this.hourlyBoard[b] = 0;
        this.hourlyRev[b] = 0;
        this.hourlyBoardKind.resident[b] = 0;
        this.hourlyBoardKind.student[b] = 0;
        this.hourlyBoardKind.tourist[b] = 0;
      }
      this.lastHb = hb;
    }
  }

  private dailyRiders(): number {
    let s = 0;
    for (let i = 0; i < 24; i++) s += this.hourlyBoard[i];
    return Math.round(s);
  }

  private checkObjectives(): void {
    const riders = this.dailyRiders();
    for (let i = 0; i < GOAL.milestones.length; i++) {
      const m = GOAL.milestones[i];
      if (!this.milestoneDone[i] && riders >= m.riders) {
        this.milestoneDone[i] = true;
        if (m.reward > 0 && isFinite(this.budget)) this.budget += m.reward;
        this.events.push(
          `★ ${m.label}: ${riders.toLocaleString()} riders/day` +
            (m.reward ? ` (+฿${money(m.reward)})` : ""),
        );
      }
    }
    if (!this.goalDone && riders >= GOAL.target) {
      this.goalDone = true;
      this.events.push(`🎉 Goal reached — ${GOAL.target.toLocaleString()} riders/day!`);
    }
    if (this.bankruptcy && !this.bankrupt && this.budget < 0) {
      this.bankrupt = true;
      this.events.push("⚠ Bankrupt — the budget ran dry.");
    }
  }

  private stepVehicle(veh: Vehicle, dt: number): void {
    const line = veh.rt.line;
    // buses crawl in traffic; metro keeps its own speed
    const eff = line.roadbound ? line.speed * this.factorAt(veh.lon, veh.lat) : line.speed;
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 128) {
      if (veh.dwell > 0) {
        const d = Math.min(remaining, veh.dwell);
        veh.dwell -= d;
        remaining -= d;
        if (veh.dwell > 0) break;
        continue;
      }
      const target = line.stopDist[veh.nextStop];
      const toStop = (target - veh.s) * veh.dir;
      const step = eff * remaining;
      if (step < toStop) {
        veh.s += veh.dir * step;
        remaining = 0;
      } else {
        veh.s = target;
        remaining -= toStop / eff;
        this.serviceStop(veh, veh.nextStop);
        veh.dwell = line.dwellSec;
        if (veh.dir > 0) {
          if (veh.nextStop >= line.stops.length - 1) {
            veh.dir = -1;
            veh.nextStop = line.stops.length - 2;
          } else veh.nextStop++;
        } else {
          if (veh.nextStop <= 0) {
            veh.dir = 1;
            veh.nextStop = 1;
          } else veh.nextStop--;
        }
      }
    }
    this.setVehiclePos(veh);
    for (const id of veh.aboard) {
      this.agents[id].lon = veh.lon;
      this.agents[id].lat = veh.lat;
    }
  }

  private serviceStop(veh: Vehicle, stopIdx: number): void {
    const rt = veh.rt;
    if (veh.aboard.length) {
      const keep: number[] = [];
      for (const id of veh.aboard) {
        const a = this.agents[id];
        if (a.alightStopIdx === stopIdx && a.rt === rt) {
          veh.load--;
          a.veh = null;
          a.curNode = rt.line.stops[stopIdx].node;
          a.lon = rt.line.stops[stopIdx].lon;
          a.lat = rt.line.stops[stopIdx].lat;
          if (a.legs && a.legIdx + 1 < a.legs.length) {
            // transfer to the next leg: walk to its boarding stop
            a.legIdx++;
            const leg = a.legs[a.legIdx];
            a.rt = leg.rt;
            a.boardStopIdx = leg.board;
            a.alightStopIdx = leg.alight;
            const boardNode = leg.rt.line.stops[leg.board].node;
            if (a.curNode === boardNode) {
              a.state = WAITING;
              a.waitStart = this.time;
              leg.rt.waitQ[leg.board].push(a.id);
            } else {
              this.startWalk(a, boardNode, AFTER_BOARD);
            }
          } else {
            if (a.legs && a.legs.length > 1) this.transferTrips++;
            a.rt = null;
            a.legs = null;
            this.startWalk(a, a.destNode, AFTER_ARRIVE);
          }
        } else {
          keep.push(id);
        }
      }
      veh.aboard = keep;
    }
    const q = rt.waitQ[stopIdx];
    if (q && q.length) {
      const remain: number[] = [];
      for (const id of q) {
        const a = this.agents[id];
        // drop stale entries (reneged / re-planned / transferred away)
        if (a.state !== WAITING || a.rt !== rt || a.boardStopIdx !== stopIdx) continue;
        const needDir = Math.sign(a.alightStopIdx - a.boardStopIdx);
        if (needDir === veh.dir && veh.load < rt.line.capacity * this.capMult) {
          veh.aboard.push(id);
          veh.load++;
          a.state = IN_VEHICLE;
          a.veh = veh;
          this.waitSum += this.time - a.waitStart;
          this.waitCount++;
          this.boardings++;
          // fare revenue
          const fare = rt.line.fare * this.fareMult; // difficulty scales operator revenue
          if (isFinite(this.budget)) this.budget += fare;
          const b = this.lastHb % 24;
          this.hourlyBoard[b]++;
          this.hourlyRev[b] += fare;
          this.hourlyBoardKind[a.kind][b]++;
        } else {
          remain.push(id);
        }
      }
      rt.waitQ[stopIdx] = remain;
    }
  }

  private stepAgent(a: Agent, dt: number): void {
    switch (a.state) {
      case DWELL:
        if (this.time >= a.dwellUntil) this.planTrip(a);
        return;
      case WALKING:
        this.advanceAlong(a, dt, false);
        return;
      case DRIVING:
        this.advanceAlong(a, dt, true);
        return;
      case WAITING: {
        // give up if the wait is hopeless (overcrowded line) and DRIVE the rest
        // of the way — don't re-queue (that oscillation duplicates queue entries
        // and never relieves the line). Driving adds traffic: cue to add service.
        const hw = a.rt ? a.rt.line.headwaySec : 300;
        if (this.time - a.waitStart > Math.max(480, hw * 2.5)) {
          a.rt = null;
          a.legs = null;
          const od = this.router.route(a.curNode, a.destNode);
          if (od) this.startWalkRoute(a, od.path, AFTER_ARRIVE, true);
          else {
            a.state = DWELL;
            a.dwellUntil = this.time + 60;
          }
        }
        return;
      }
      default:
        return; // IN_VEHICLE driven by the vehicle
    }
  }

  private advanceAlong(a: Agent, dt: number, driving: boolean): void {
    const path = a.path!;
    const cum = a.cum!;
    const total = cum[cum.length - 1];
    const speed = driving
      ? TRAVEL.carFreeSpeed * this.factorAt(a.lon, a.lat)
      : SIM.walkSpeed;
    a.dist += speed * dt;
    if (a.dist >= total) {
      const lastNode = path[path.length - 1];
      a.lon = this.graph.lon(lastNode);
      a.lat = this.graph.lat(lastNode);
      a.curNode = lastNode;
      a.path = null;
      a.cum = null;
      this.onArrive(a);
      return;
    }
    let seg = a.seg;
    while (seg < cum.length - 2 && cum[seg + 1] < a.dist) seg++;
    a.seg = seg;
    const an = path[seg];
    const bn = path[seg + 1];
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const frac = (a.dist - cum[seg]) / segLen;
    a.lon = this.graph.lon(an) + (this.graph.lon(bn) - this.graph.lon(an)) * frac;
    a.lat = this.graph.lat(an) + (this.graph.lat(bn) - this.graph.lat(an)) * frac;
  }

  private onArrive(a: Agent): void {
    if (a.after === AFTER_BOARD && a.rt) {
      a.state = WAITING;
      a.waitStart = this.time;
      a.rt.waitQ[a.boardStopIdx].push(a.id);
    } else {
      a.state = DWELL;
      a.atHome = !a.atHome;
      // diurnal rhythm per kind: at that kind's peak people re-trip sooner → more
      // cars + riders on the move; tourists trip more often (tripsScale).
      const dwell = SIM.dwellMinSec + Math.random() * (SIM.dwellMaxSec - SIM.dwellMinSec);
      a.dwellUntil = this.time + dwell / (this.peakMult(a.kind) * DEMOGRAPHICS[a.kind].tripsScale);
      this.tripsDone++;
    }
  }

  // ----------------------------------------------------------- trip planning
  private planTrip(a: Agent): void {
    let destNode: number;
    let destLon: number;
    let destLat: number;
    if (a.atHome) {
      const p = this.destPoiFor(a.kind);
      destNode = this.poiNode[p];
      destLon = this.pois[p].lon;
      destLat = this.pois[p].lat;
    } else {
      destNode = a.homeNode;
      destLon = a.homeLon;
      destLat = a.homeLat;
    }
    a.destNode = destNode;
    a.destLon = destLon;
    a.destLat = destLat;
    a.rt = null;
    a.veh = null;

    const origin = a.curNode;
    const od = this.router.route(origin, destNode);
    if (!od) {
      a.state = DWELL;
      a.dwellUntil = this.time + 60;
      return;
    }
    const dist = od.dist;

    // short trips are simply walked
    if (dist <= TRAVEL.walkMaxM) {
      this.startWalkRoute(a, od.path, AFTER_ARRIVE, false);
      return;
    }

    // cheapest transit journey vs driving — uses the same shared rule the OD
    // priorities panel uses, so "people ride here" and "met corridor" agree.
    const oLon = this.graph.lon(origin);
    const oLat = this.graph.lat(origin);
    const { cost: bestCost, legs: bestLegs } = this.bestTransitJourney(oLon, oLat, destLon, destLat);

    // driving cost: time at the CURRENT traffic speed + parking hassle
    const driveSpeed = Math.max(TRAVEL.carMinSpeed, TRAVEL.carFreeSpeed * this.avgFactor);
    const driveCost = dist / driveSpeed / 60 + TRAVEL.parkPenaltyMin;

    // tourists & students ride far more readily (no/few cars) → their corridors
    // fill trains. propensity widens the "transit still wins" margin per kind.
    if (bestLegs && bestCost <= driveCost * TRAVEL.transitPref * DEMOGRAPHICS[a.kind].propensity) {
      this.commitJourney(a, bestLegs, oLon, oLat);
      return;
    }

    // otherwise drive (adds to congestion)
    this.startWalkRoute(a, od.path, AFTER_ARRIVE, true);
  }

  private commitJourney(a: Agent, legs: RideLeg[], oLon: number, oLat: number): void {
    a.legs = legs;
    a.legIdx = 0;
    const leg = legs[0];
    a.rt = leg.rt;
    a.boardStopIdx = leg.board;
    a.alightStopIdx = leg.alight;
    const boardNode = leg.rt.line.stops[leg.board].node;
    if (a.curNode === boardNode) {
      a.state = WAITING;
      a.waitStart = this.time;
      a.lon = oLon;
      a.lat = oLat;
      leg.rt.waitQ[leg.board].push(a.id);
    } else {
      this.startWalk(a, boardNode, AFTER_BOARD);
    }
  }

  private startWalk(a: Agent, toNode: number, after: number): void {
    const r = this.router.route(a.curNode, toNode);
    if (!r) {
      a.state = DWELL;
      a.dwellUntil = this.time + 60;
      a.rt = null;
      return;
    }
    this.startWalkRoute(a, r.path, after, false);
  }

  private startWalkRoute(a: Agent, path: number[], after: number, driving: boolean): void {
    if (path.length < 2) {
      a.curNode = path[0] ?? a.curNode;
      a.after = after;
      this.onArrive(a);
      return;
    }
    const cum = new Array<number>(path.length);
    cum[0] = 0;
    for (let i = 1; i < path.length; i++) {
      cum[i] =
        cum[i - 1] +
        haversine(
          this.graph.lon(path[i - 1]),
          this.graph.lat(path[i - 1]),
          this.graph.lon(path[i]),
          this.graph.lat(path[i]),
        );
    }
    a.path = path;
    a.cum = cum;
    a.seg = 0;
    a.dist = 0;
    a.after = after;
    a.state = driving ? DRIVING : WALKING;
    a.lon = this.graph.lon(path[0]);
    a.lat = this.graph.lat(path[0]);
  }

  // ---------------------------------------------------------------- snapshot
  writeSnapshot(positions: Float32Array, states: Uint8Array): SnapshotMeta {
    let walking = 0;
    let waiting = 0;
    let riding = 0;
    let dwelling = 0;
    let driving = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      positions[i * 2] = a.lon;
      positions[i * 2 + 1] = a.lat;
      states[i] = a.state;
      switch (a.state) {
        case WALKING:
          walking++;
          break;
        case WAITING:
          waiting++;
          break;
        case IN_VEHICLE:
          riding++;
          break;
        case DRIVING:
          driving++;
          break;
        default:
          dwelling++;
      }
    }

    // congestion index: speed loss experienced by the average road vehicle
    const congestion = Math.round((1 - this.avgFactor) * 100);

    const vehicles: SnapshotMeta["vehicles"] = [];
    const perLine: PerLine[] = [];
    for (const rt of this.lines) {
      let lineRiders = 0;
      let capSum = 0;
      for (const v of rt.vehicles) {
        const cap = Math.round(rt.line.capacity * this.capMult);
        vehicles.push({
          lon: v.lon,
          lat: v.lat,
          load: v.load,
          cap,
          crowd: crowdLevel(v.load, cap),
          color: rt.line.color,
        });
        lineRiders += v.load;
        capSum += rt.line.capacity * this.capMult;
      }
      let lineWaiting = 0;
      for (const q of rt.waitQ) lineWaiting += q.length;
      const util = capSum ? lineRiders / capSum : 0;
      perLine.push({
        id: rt.line.id,
        mode: rt.line.mode,
        color: rt.line.color,
        riders: lineRiders,
        waiting: lineWaiting,
        util,
        fleet: rt.line.fleet,
      });
      // overcrowding alert (debounced per line)
      if (lineWaiting > 50 && util > 0.85) {
        if (!this.overcrowded.has(rt.line.id)) {
          this.overcrowded.add(rt.line.id);
          this.events.push(
            `⚠ ${rt.line.mode === "metro" ? "Metro" : "Bus"} line crowded — ${lineWaiting} waiting. Raise frequency or add a line.`,
          );
        }
      } else {
        this.overcrowded.delete(rt.line.id);
      }
    }

    // rider satisfaction: crowded lines + long average waits make people complain
    let crowdedCount = 0;
    for (const p of perLine) if (p.waiting > 50 && p.util > 0.85) crowdedCount++;
    const avgWaitSec = this.waitCount ? this.waitSum / this.waitCount : 0;
    const avgWaitMin = avgWaitSec / 60;
    let satisfaction = 100 - crowdedCount * 14 - Math.max(0, avgWaitMin - 7) * 6;
    if (satisfaction < 0) satisfaction = 0;
    else if (satisfaction > 100) satisfaction = 100;

    const dailyRiders = this.dailyRiders();
    let dailyRev = 0;
    for (let i = 0; i < 24; i++) dailyRev += this.hourlyRev[i];
    let stars = 0;
    for (const t of GOAL.stars) if (dailyRiders >= t) stars++;

    const events = this.events;
    this.events = [];

    return {
      simTime: this.time,
      day: Math.floor(this.elapsed / SIM.daySeconds),
      agentCount: this.agents.length,
      walking,
      waiting,
      riding,
      dwelling,
      driving,
      congestion,
      tripsDone: this.tripsDone,
      busRiders: this.boardings,
      transferTrips: this.transferTrips,
      avgWaitSec,
      satisfaction: Math.round(satisfaction),
      budget: this.budget,
      dailyRevenue: dailyRev,
      dailyOpex: this.opexPerSec * SIM.daySeconds,
      dailyRiders,
      goalTarget: GOAL.target,
      stars,
      bankrupt: this.bankrupt,
      coverage: Math.round(this.coverage),
      hotspots: this.hotspots,
      perLine,
      odUnmet: this.odUnmet,
      odMet: this.odMet,
      odServedFrac: this.odServedFrac,
      odMetCount: this.odMetCount,
      odTotalCount: this.odPairs.length,
      ridersByKind: this.kindRiders(),
      events,
      vehicles,
    };
  }
}

// --- module helpers ---------------------------------------------------------

function sameLine(a: TransitLine, b: TransitLine): boolean {
  return (
    a.id === b.id &&
    a.totalLen === b.totalLen &&
    a.stops.length === b.stops.length &&
    a.headwaySec === b.headwaySec &&
    a.capacity === b.capacity &&
    a.speed === b.speed &&
    a.fleet === b.fleet
  );
}

/** Compact baht formatter for event strings (e.g. 4_600_000 -> "4.6M"). */
function money(v: number): string {
  if (!isFinite(v)) return "∞";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return Math.round(v / 1_000) + "k";
  return String(Math.round(v));
}

// Live crowding level 1 (empty) .. 5 (full) from a vehicle's load factor.
function crowdLevel(load: number, cap: number): number {
  if (cap <= 0) return 1;
  const f = load / cap;
  if (f >= 0.9) return 5;
  if (f >= 0.65) return 4;
  if (f >= 0.4) return 3;
  if (f >= 0.15) return 2;
  return 1;
}

function nearestStop(line: TransitLine, lon: number, lat: number): { idx: number; dist: number } {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < line.stops.length; i++) {
    const d = haversine(lon, lat, line.stops[i].lon, line.stops[i].lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { idx: best, dist: bestD };
}

function firstStopAhead(stopDist: number[], s: number, dir: number): number {
  if (dir > 0) {
    for (let k = 0; k < stopDist.length; k++) if (stopDist[k] >= s) return k;
    return stopDist.length - 1;
  }
  for (let k = stopDist.length - 1; k >= 0; k--) if (stopDist[k] <= s) return k;
  return 0;
}

function locateSeg(cum: number[], s: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
