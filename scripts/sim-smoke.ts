// Headless smoke test of the bus+metro model on the expanded Chiang Mai area.
// Proves: multiple lines per mode, agents drive (and jam roads) when transit is
// poor, transit pulls them off the road, congestion is measured, metro is
// traffic-immune. Run: pnpm dlx tsx scripts/sim-smoke.ts

import fs from "node:fs";
import path from "node:path";
import { Graph } from "@/lib/geo/graph";
import { Router } from "@/lib/routing/astar";
import { SimEngine } from "@/lib/sim/engine";
import { buildLine } from "@/lib/network/line";
import type { GraphData, LineMode, PoiData, TransitLine, ZoneData } from "@/lib/types";
import { PEOPLE_PER_AGENT } from "@/lib/config";

const dir = path.join(process.cwd(), "public", "data");
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;

const graph = new Graph(read<GraphData>("network.graph.json"));
const router = new Router(graph);
const z = read<ZoneData>("zones.json");
const p = read<PoiData>("pois.json");
const AGENTS = 7000;

function run(label: string, lines: TransitLine[], hours: number) {
  const engine = new SimEngine(graph, z, p, AGENTS);
  engine.setNetwork(lines);
  const pos = new Float32Array(AGENTS * 2);
  const st = new Uint8Array(AGENTS);
  for (let i = 0; i < hours * 3600; i++) engine.step(1);
  return engine.writeSnapshot(pos, st);
}

// baseline: no transit at all -> everyone long-distance drives -> jams
const base = run("no transit", [], 2);

// network: 2 bus + 2 metro lines (multiple per mode)
const draws: { mode: LineMode; pts: { lon: number; lat: number }[] }[] = [
  { mode: "bus", pts: [{ lon: 98.96, lat: 18.79 }, { lon: 98.985, lat: 18.788 }, { lon: 99.006, lat: 18.79 }] },
  { mode: "bus", pts: [{ lon: 98.985, lat: 18.762 }, { lon: 98.986, lat: 18.79 }, { lon: 98.987, lat: 18.818 }] },
  { mode: "metro", pts: [{ lon: 98.95, lat: 18.762 }, { lon: 98.985, lat: 18.79 }, { lon: 99.02, lat: 18.818 }] },
  { mode: "metro", pts: [{ lon: 98.95, lat: 18.818 }, { lon: 98.985, lat: 18.79 }, { lon: 99.02, lat: 18.762 }] },
];
const lines: TransitLine[] = [];
for (const d of draws) {
  const l = buildLine(graph, router, d.pts, d.mode);
  if (!l) {
    console.error("FAILED to build", d.mode);
    process.exit(1);
  }
  console.log(`${d.mode.padEnd(6)} stops=${l.stops.length} ${(l.totalLen / 1000).toFixed(1)}km v=${l.speed} cap=${l.capacity} fare=${l.fare} roadbound=${l.roadbound}`);
  lines.push(l);
}

// timing
const eng = new SimEngine(graph, z, p, AGENTS);
eng.setNetwork(lines);
const pos = new Float32Array(AGENTS * 2);
const st = new Uint8Array(AGENTS);
for (let i = 0; i < 3 * 3600; i++) eng.step(1);
const tA = performance.now();
for (let i = 0; i < 300; i++) eng.step(1);
const tB = performance.now();
const withNet = eng.writeSnapshot(pos, st);

const report = {
  msPerStep: +((tB - tA) / 300).toFixed(3),
  baseline_noTransit: { driving: base.driving, walking: base.walking, congestion: base.congestion },
  withNetwork: {
    walking: withNet.walking,
    driving: withNet.driving,
    waiting: withNet.waiting,
    riding: withNet.riding,
    congestion: withNet.congestion,
    boardings: withNet.busRiders,
    transferTrips: withNet.transferTrips,
    tripsDone: withNet.tripsDone,
    vehicles: withNet.vehicles.length,
  },
};
console.log(JSON.stringify(report, null, 2));

// --- economy + coverage + frequency (Phase A/B/C) --------------------------
const econ = new SimEngine(graph, z, p, AGENTS, 6_000_000, true); // campaign budget
const cov0 = econ.writeSnapshot(pos, st).coverage; // no lines yet
econ.setNetwork(lines);
const afterBuild = econ.writeSnapshot(pos, st);
const budgetAfterBuild = afterBuild.budget; // capex deducted
// run a full sim-day so revenue/opex/riders accrue
for (let i = 0; i < 24 * 3600; i++) econ.step(1);
const day1 = econ.writeSnapshot(pos, st);

// metro now follows roads (A* path has many intermediate nodes, not 3 anchors)
const metroLine = lines.find((l) => l.mode === "metro")!;
const busLine = lines.find((l) => l.mode === "bus")!;
const metroFollowsRoads = metroLine.path.length > metroLine.stops.length + 2;

// set fleet 1 -> 5 on the first line: vehicle count + opex must rise
const opexBefore = day1.dailyOpex;
const lo = lines.map((l, i) => (i === 0 ? { ...l, fleet: 1 } : l));
econ.setNetwork(lo);
const f1 = econ.writeSnapshot(pos, st).perLine[0].fleet;
const hi = lines.map((l, i) => (i === 0 ? { ...l, fleet: 5 } : l));
econ.setNetwork(hi);
for (let i = 0; i < 300; i++) econ.step(1);
const day1b = econ.writeSnapshot(pos, st);
const f5 = day1b.perLine[0].fleet;
const opexAfter = day1b.dailyOpex;

// colour round-trips without dropping the line's riders
const recoloured = hi.map((l, i) => (i === 0 ? { ...l, color: [1, 2, 3] as [number, number, number] } : l));
econ.setNetwork(recoloured);
for (let i = 0; i < 30; i++) econ.step(1);
const day1c = econ.writeSnapshot(pos, st);
const colourApplied = day1c.perLine[0].color.join(",") === "1,2,3";

const ecoReport = {
  metro_roadbound: metroLine.roadbound,
  bus_roadbound: busLine.roadbound,
  metro_pathNodes: metroLine.path.length,
  metro_stops: metroLine.stops.length,
  metroFollowsRoads,
  coverageWithLines: afterBuild.coverage,
  hotspots: afterBuild.hotspots.length,
  dailyRiders: day1.dailyRiders,
  dailyOpexBefore: Math.round(opexBefore),
  fleet_1_then_5: [f1, f5],
  dailyOpexAfter: Math.round(opexAfter),
  colourApplied,
  stars: day1.stars,
};
console.log(JSON.stringify(ecoReport, null, 2));

// --- origin→destination demand (live priorities) ---------------------------
const odReport = {
  base_unmet: base.odUnmet.length,
  base_met: base.odMet.length, // no lines → 0 met
  od_total: day1.odTotalCount,
  od_servedFrac: +day1.odServedFrac.toFixed(2),
  od_metCount: day1.odMetCount,
  topUnmet: day1.odUnmet.slice(0, 4).map((c) => `${c.oName}→${c.dName} ~${c.demand}`),
  topMet: day1.odMet.slice(0, 4).map((c) => `${c.oName}→${c.dName} ~${c.demand}`),
};
console.log(JSON.stringify(odReport, null, 2));
const odOk =
  base.odMet.length === 0 &&
  base.odUnmet.length > 0 &&
  day1.odTotalCount > 0 &&
  day1.odMetCount > 0 && // the network serves at least some corridors
  day1.odServedFrac > 0;

// --- demographics (rider mix) ----------------------------------------------
const rk = day1.ridersByKind;
const rkTot = rk.resident + rk.student + rk.tourist;
const pct = (n: number) => (rkTot ? Math.round((n / rkTot) * 100) : 0);
console.log(JSON.stringify({
  ridersByKind: rk,
  mixPct: { resident: pct(rk.resident), student: pct(rk.student), tourist: pct(rk.tourist) },
  dailyRiders: day1.dailyRiders,
}, null, 2));
const demoOk = rkTot > 0 && rk.resident > 0 && rk.student > 0 && rk.tourist > 0;

// --- ridership benchmark vs real-world metros ------------------------------
// build ONE sensible trunk line through the dense core, run a full day
const single = new SimEngine(graph, z, p, AGENTS);
const oneLine = buildLine(graph, router, [
  { lon: 98.95, lat: 18.79 }, { lon: 98.985, lat: 18.79 }, { lon: 99.02, lat: 18.79 },
], "metro");
single.setNetwork(oneLine ? [oneLine] : []);
for (let i = 0; i < 24 * 3600; i++) single.step(1);
const sl = single.writeSnapshot(pos, st);
const km1 = oneLine ? oneLine.totalLen / 1000 : 1;
const netShare = day1.riding / Math.max(1, day1.riding + day1.driving);
const benchmark = {
  PEOPLE_PER_AGENT,
  singleLine_km: +km1.toFixed(1),
  singleLine_ridersPerDay: Math.round(sl.dailyRiders * PEOPLE_PER_AGENT),
  singleLine_perKmPerDay: Math.round((sl.dailyRiders * PEOPLE_PER_AGENT) / km1),
  network_ridersPerDay: Math.round(day1.dailyRiders * PEOPLE_PER_AGENT),
  network_modeShare_pct: Math.round(netShare * 100),
  realWorld: "single trunk line ~40-200k/day & ~5-15k/km/day; good-system rail mode share ~20-40%",
};
console.log(JSON.stringify(benchmark, null, 2));

const ok =
  base.driving > 0 &&
  withNet.busRiders > 0 &&
  withNet.riding > 0 &&
  withNet.congestion < base.congestion &&
  afterBuild.coverage > cov0 &&
  afterBuild.hotspots.length > 0 &&
  budgetAfterBuild < 6_000_000 &&
  day1.dailyRiders > 0 &&
  withNet.transferTrips > 0 &&
  metroLine.roadbound === false && // metro is grade-separated (traffic-immune)
  busLine.roadbound === true &&
  metroFollowsRoads && // metro routes along roads, not a straight line
  f1 === 1 &&
  f5 === 5 && // fleet count applied
  opexAfter > opexBefore && // more vehicles cost more
  colourApplied && // recolour propagated without rebuild
  odOk && // OD demand model live: corridors tracked, some met
  demoOk; // demographic mix: residents + students + tourists all ride
console.log(ok ? "SMOKE: PASS ✅" : "SMOKE: FAIL ❌");
process.exit(ok ? 0 : 1);
