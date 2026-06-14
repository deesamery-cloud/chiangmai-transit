import type { GraphData } from "@/lib/types";

const R = 6371000;

export function haversine(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Runtime wrapper over the static road graph: CSR adjacency for fast
 * neighbour iteration plus a uniform spatial hash for nearest-node queries.
 * Constructed identically on the main thread (for editing/render) and inside
 * the worker (for routing).
 */
export class Graph {
  readonly nodeCount: number;
  readonly coords: Float64Array; // [lon, lat, ...]
  readonly bbox: [number, number, number, number];

  // CSR adjacency
  private readonly adjStart: Int32Array;
  private readonly adjNode: Int32Array;
  private readonly adjLen: Float32Array;

  // spatial hash
  private readonly cellDeg = 0.0025; // ~250 m
  private readonly minLon: number;
  private readonly minLat: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: Int32Array[]; // node indices per cell

  constructor(data: GraphData) {
    this.nodeCount = data.meta.nodeCount;
    this.coords = Float64Array.from(data.coords);
    this.bbox = data.meta.bbox;

    const n = this.nodeCount;
    const e = data.edges;
    const edgeCount = e.length / 3;

    // degree count (undirected -> both endpoints)
    const degree = new Int32Array(n);
    for (let i = 0; i < edgeCount; i++) {
      degree[e[i * 3]]++;
      degree[e[i * 3 + 1]]++;
    }
    this.adjStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + degree[i];
    const total = this.adjStart[n];
    this.adjNode = new Int32Array(total);
    this.adjLen = new Float32Array(total);
    const cursor = this.adjStart.slice(0, n);
    for (let i = 0; i < edgeCount; i++) {
      const u = e[i * 3];
      const v = e[i * 3 + 1];
      const len = e[i * 3 + 2];
      this.adjNode[cursor[u]] = v;
      this.adjLen[cursor[u]] = len;
      cursor[u]++;
      this.adjNode[cursor[v]] = u;
      this.adjLen[cursor[v]] = len;
      cursor[v]++;
    }

    // spatial hash
    const [minLon, minLat, maxLon, maxLat] = this.bbox;
    this.minLon = minLon;
    this.minLat = minLat;
    this.cols = Math.max(1, Math.ceil((maxLon - minLon) / this.cellDeg) + 1);
    this.rows = Math.max(1, Math.ceil((maxLat - minLat) / this.cellDeg) + 1);
    const counts = new Int32Array(this.cols * this.rows);
    for (let i = 0; i < n; i++) {
      counts[this.cellIndex(this.coords[i * 2], this.coords[i * 2 + 1])]++;
    }
    this.buckets = new Array(this.cols * this.rows);
    for (let c = 0; c < counts.length; c++) this.buckets[c] = new Int32Array(counts[c]);
    const fill = new Int32Array(this.cols * this.rows);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(this.coords[i * 2], this.coords[i * 2 + 1]);
      this.buckets[c][fill[c]++] = i;
    }
  }

  lon(i: number): number {
    return this.coords[i * 2];
  }
  lat(i: number): number {
    return this.coords[i * 2 + 1];
  }

  /** Iterate neighbours of node `i`; callback receives (neighbour, edgeLen). */
  forEachNeighbor(i: number, cb: (v: number, len: number) => void): void {
    const start = this.adjStart[i];
    const end = this.adjStart[i + 1];
    for (let k = start; k < end; k++) cb(this.adjNode[k], this.adjLen[k]);
  }

  adjRange(i: number): [number, number] {
    return [this.adjStart[i], this.adjStart[i + 1]];
  }
  neighborAt(k: number): number {
    return this.adjNode[k];
  }
  lenAt(k: number): number {
    return this.adjLen[k];
  }

  private cellIndex(lon: number, lat: number): number {
    let cx = Math.floor((lon - this.minLon) / this.cellDeg);
    let cy = Math.floor((lat - this.minLat) / this.cellDeg);
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cx >= this.cols) cx = this.cols - 1;
    if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** Nearest graph node to a lon/lat, searching outward in rings. */
  nearestNode(lon: number, lat: number): number {
    const cx = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((lon - this.minLon) / this.cellDeg)),
    );
    const cy = Math.min(
      this.rows - 1,
      Math.max(0, Math.floor((lat - this.minLat) / this.cellDeg)),
    );
    let best = -1;
    let bestD = Infinity;
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let gy = cy - ring; gy <= cy + ring; gy++) {
        if (gy < 0 || gy >= this.rows) continue;
        for (let gx = cx - ring; gx <= cx + ring; gx++) {
          if (gx < 0 || gx >= this.cols) continue;
          // only the ring shell, not the filled interior
          if (ring > 0 && gx > cx - ring && gx < cx + ring && gy > cy - ring && gy < cy + ring)
            continue;
          const bucket = this.buckets[gy * this.cols + gx];
          for (let b = 0; b < bucket.length; b++) {
            const node = bucket[b];
            const d = haversine(lon, lat, this.coords[node * 2], this.coords[node * 2 + 1]);
            if (d < bestD) {
              bestD = d;
              best = node;
            }
          }
        }
      }
      // once we have a candidate, one extra ring guarantees correctness
      if (best >= 0 && ring > 0) break;
    }
    return best;
  }
}
