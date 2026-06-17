import { Graph, haversine } from "@/lib/geo/graph";
import type { Router } from "@/lib/routing/astar";
import type { LineMode, Stop, TransitLine } from "@/lib/types";
import { DEFAULT_FLEET, lineCapex, MAX_FLEET, MODE_PARAMS } from "@/lib/config";

export interface DrawPoint {
  lon: number;
  lat: number;
}

/** Effective headway (sec) for a line: round-trip time shared among its fleet. */
export function headwayFor(
  totalLen: number,
  speed: number,
  dwellSec: number,
  stopCount: number,
  fleet: number,
): number {
  const roundTrip = 2 * totalLen;
  const roundTime = roundTrip / speed + 2 * Math.max(0, stopCount - 1) * dwellSec;
  return roundTime / Math.max(1, fleet);
}

/**
 * Turn user-clicked / dragged points into a routable transit line. Both modes
 * route ALONG the road graph (A* between anchors) — metro is grade-separated
 * (immune to traffic) but still follows the road corridor, not straight lines
 * through property. Stations are auto-placed at a realistic spacing.
 *
 * Returns null if fewer than two anchors resolve or any leg is unroutable.
 */
export function buildLine(
  graph: Graph,
  router: Router,
  points: DrawPoint[],
  mode: LineMode,
  color?: [number, number, number],
  fleet: number = DEFAULT_FLEET,
  id?: string,
): TransitLine | null {
  const p = MODE_PARAMS[mode];

  const anchors: Stop[] = [];
  for (const pt of points) {
    const node = graph.nearestNode(pt.lon, pt.lat);
    if (node < 0) continue;
    if (anchors.length && anchors[anchors.length - 1].node === node) continue;
    anchors.push({ node, lon: graph.lon(node), lat: graph.lat(node) });
  }
  if (anchors.length < 2) return null;

  const built = routeAlongRoads(graph, router, anchors);
  if (!built) return null;
  const { path, cumDist } = built;

  const { stops, stopDist } = densifyStops(graph, path, cumDist, p.stopSpacingM);
  const total = cumDist[cumDist.length - 1];
  const fleetN = Math.max(1, Math.min(MAX_FLEET, Math.round(fleet)));

  return {
    id: id ?? `${mode}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    mode,
    color: color ?? p.color,
    stops,
    path,
    cumDist,
    stopDist,
    totalLen: total,
    headwaySec: headwayFor(total, p.speed, p.dwellSec, stops.length, fleetN),
    capacity: p.capacity,
    speed: p.speed,
    dwellSec: p.dwellSec,
    fare: p.fare,
    flexible: p.flexible,
    roadbound: !p.gradeSeparated,
    fleet: fleetN,
    capex: lineCapex(mode, total, stops.length),
    drawPoints: points.map((pt) => ({ lon: pt.lon, lat: pt.lat })), // kept so the route can be extended later
  };
}

function routeAlongRoads(
  graph: Graph,
  router: Router,
  anchors: Stop[],
): { path: number[]; cumDist: number[]; anchorDist: number[] } | null {
  const path: number[] = [];
  const cumDist: number[] = [];
  const anchorDist: number[] = []; // cumulative metres at each anchor (== a stop if stops are the anchors)
  let total = 0;
  const pushNode = (node: number) => {
    if (path.length === 0) {
      path.push(node);
      cumDist.push(0);
      return;
    }
    const prev = path[path.length - 1];
    total += haversine(graph.lon(prev), graph.lat(prev), graph.lon(node), graph.lat(node));
    path.push(node);
    cumDist.push(total);
  };
  for (let s = 0; s < anchors.length; s++) {
    if (s === 0) {
      pushNode(anchors[0].node);
      anchorDist.push(0);
      continue;
    }
    const leg = router.route(anchors[s - 1].node, anchors[s].node);
    if (!leg || leg.path.length < 2) return null;
    for (let k = 1; k < leg.path.length; k++) pushNode(leg.path[k]);
    anchorDist.push(total); // total now equals the distance at anchors[s]
  }
  return { path, cumDist, anchorDist };
}

/**
 * Bangkok-style build: the player places stations, then connects them with
 * rail. The line stops AT exactly those stations (no auto-densification) and
 * the alignment routes along roads between consecutive stations.
 */
export function buildLineFromStations(
  graph: Graph,
  router: Router,
  stations: { id: string; lon: number; lat: number; node: number }[],
  mode: LineMode,
  color?: [number, number, number],
  fleet: number = DEFAULT_FLEET,
  id?: string,
): TransitLine | null {
  const p = MODE_PARAMS[mode];
  const anchors: (Stop & { sid: string })[] = [];
  for (const st of stations) {
    if (st.node < 0) continue;
    if (anchors.length && anchors[anchors.length - 1].node === st.node) continue;
    anchors.push({ node: st.node, lon: graph.lon(st.node), lat: graph.lat(st.node), sid: st.id });
  }
  if (anchors.length < 2) return null;

  const built = routeAlongRoads(graph, router, anchors);
  if (!built) return null;
  const { path, cumDist, anchorDist } = built;
  const stops: Stop[] = anchors.map((a) => ({ node: a.node, lon: a.lon, lat: a.lat }));
  const total = cumDist[cumDist.length - 1];
  const fleetN = Math.max(1, Math.min(MAX_FLEET, Math.round(fleet)));

  return {
    id: id ?? `${mode}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    mode,
    color: color ?? p.color,
    stops,
    path,
    cumDist,
    stopDist: anchorDist,
    totalLen: total,
    headwaySec: headwayFor(total, p.speed, p.dwellSec, stops.length, fleetN),
    capacity: p.capacity,
    speed: p.speed,
    dwellSec: p.dwellSec,
    fare: p.fare,
    flexible: p.flexible,
    roadbound: !p.gradeSeparated,
    fleet: fleetN,
    capex: lineCapex(mode, total, stops.length),
    stationIds: anchors.map((a) => a.sid),
  };
}

/**
 * Place a stop every `spacing` metres along the line geometry (interpolating
 * the position and snapping to the nearest road node for walking access).
 * Endpoints are always stops.
 */
function densifyStops(
  graph: Graph,
  path: number[],
  cumDist: number[],
  spacing: number,
): { stops: Stop[]; stopDist: number[] } {
  const total = cumDist[cumDist.length - 1];
  const n = Math.max(1, Math.round(total / Math.max(50, spacing)));
  const step = total / n;
  const stops: Stop[] = [];
  const stopDist: number[] = [];
  let seg = 0;
  for (let k = 0; k <= n; k++) {
    const d = Math.min(total, k * step);
    while (seg < cumDist.length - 2 && cumDist[seg + 1] < d) seg++;
    const segLen = cumDist[seg + 1] - cumDist[seg] || 1;
    const frac = (d - cumDist[seg]) / segLen;
    const a = path[seg];
    const b = path[Math.min(seg + 1, path.length - 1)];
    const lon = graph.lon(a) + (graph.lon(b) - graph.lon(a)) * frac;
    const lat = graph.lat(a) + (graph.lat(b) - graph.lat(a)) * frac;
    stops.push({ node: graph.nearestNode(lon, lat), lon, lat });
    stopDist.push(d);
  }
  return { stops, stopDist };
}

/** Flat [lon,lat,...] of a line's path, for rendering. */
export function linePathCoords(graph: Graph, line: TransitLine): number[] {
  const out: number[] = [];
  for (const node of line.path) out.push(graph.lon(node), graph.lat(node));
  return out;
}
