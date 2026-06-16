// Measure the City Score grade for: empty city · the seeded "existing songthaew"
// network · existing + 1 metro · existing + 2 metro. Confirms the existing-net
// start is now a LOW tier and metro is what climbs toward A.
// Run: pnpm dlx tsx scripts/measure-existing.ts

import fs from "node:fs";
import path from "node:path";
import { Graph } from "@/lib/geo/graph";
import { Router } from "@/lib/routing/astar";
import { SimEngine } from "@/lib/sim/engine";
import { buildLine, headwayFor } from "@/lib/network/line";
import { CM_SONGTHAEW } from "@/lib/cm-songthaew";
import { SIM } from "@/lib/config";
import type { GraphData, LineMode, PoiData, TransitLine, ZoneData } from "@/lib/types";

const dir = path.join(process.cwd(), "public", "data");
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T;
const graph = new Graph(read<GraphData>("network.graph.json"));
const router = new Router(graph);
const z = read<ZoneData>("zones.json");
const p = read<PoiData>("pois.json");
const AGENTS = SIM.agentCount;

function grade(s: number) {
  return s >= 82 ? "A" : s >= 66 ? "B" : s >= 44 ? "C" : s >= 26 ? "D" : "F";
}
function score(lines: TransitLine[], label: string) {
  const engine = new SimEngine(graph, z, p, AGENTS);
  engine.setNetwork(lines);
  const pos = new Float32Array(AGENTS * 2);
  const st = new Uint8Array(AGENTS);
  for (let i = 0; i < 2 * 3600; i++) engine.step(1);
  const m = engine.writeSnapshot(pos, st);
  const coverageScore = Math.min(1, m.coverage / 100 / 0.62);
  const trafficRelief = 1 - Math.min(1, m.congestion / 100);
  const odScoreFrac = Math.sqrt(Math.min(1, m.odServedFrac / 0.45));
  const satFrac = m.satisfaction / 100;
  const base = 100 * (0.68 * odScoreFrac + 0.18 * coverageScore + 0.14 * trafficRelief);
  const cs = Math.round(base * (0.82 + 0.18 * satFrac));
  console.log(
    `${label.padEnd(26)} score=${String(cs).padStart(3)} (${grade(cs)})  served=${(m.odServedFrac * 100).toFixed(0)}% metMetroCorr=${m.odMetCount}/${m.odTotalCount}  cover=${m.coverage}%  traffic=${m.congestion}%  sat=${m.satisfaction}%`,
  );
  return cs;
}

const seed = (mode: LineMode, pts: { lon: number; lat: number }[]) => {
  const l = buildLine(graph, router, pts, mode);
  if (!l) console.error("  build failed", mode);
  return l;
};

// the existing songthaew network (same corridors the game seeds)
const existing: TransitLine[] = [];
for (const c of CM_SONGTHAEW) { const l = seed("songthaew", c.points); if (l) existing.push(l); }
console.log(`seeded existing songthaew lines: ${existing.length}/${CM_SONGTHAEW.length}\n`);

// metro corridors to add on top (cross-city trunks)
const metroA = seed("metro", [{ lon: 98.95, lat: 18.79 }, { lon: 98.985, lat: 18.79 }, { lon: 99.02, lat: 18.79 }]);
const metroB = seed("metro", [{ lon: 98.985, lat: 18.76 }, { lon: 98.985, lat: 18.79 }, { lon: 98.99, lat: 18.82 }]);
const metroC = seed("metro", [{ lon: 98.955, lat: 18.815 }, { lon: 98.985, lat: 18.79 }, { lon: 99.015, lat: 18.765 }]);

score([], "empty city");
score(existing, "existing songthaew only");
if (metroA) score([...existing, metroA], "existing + 1 metro");
if (metroA && metroB) score([...existing, metroA, metroB], "existing + 2 metro");
if (metroA && metroB && metroC) score([...existing, metroA, metroB, metroC], "existing + 3 metro");

// is A reachable? a real metro network with FLEET investment (relieves crowding)
const fleet5 = (l: TransitLine | null): TransitLine | null =>
  l ? { ...l, fleet: 5, headwaySec: headwayFor(l.totalLen, l.speed, l.dwellSec, l.stops.length, 5) } : null;
const big = [metroA, metroB, metroC, seed("metro", [{ lon: 98.96, lat: 18.80 }, { lon: 98.99, lat: 18.785 }, { lon: 99.01, lat: 18.80 }])].map(fleet5).filter(Boolean) as TransitLine[];
if (big.length >= 4) {
  score(big, "4 metro fleet5 (no songthaew)");
  score([...existing, ...big], "existing + 4 metro fleet5");
}
