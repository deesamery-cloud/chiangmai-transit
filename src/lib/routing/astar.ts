import { Graph, haversine } from "@/lib/geo/graph";

export interface Route {
  path: number[]; // node indices, start..goal inclusive
  dist: number; // metres
}

/**
 * A* shortest-path over the road graph with a haversine heuristic. Reuses
 * scratch arrays across queries (generation-stamped) and memoises results by
 * (start, goal) so the thousands of agents sharing origin/destination pairs
 * only pay for pathfinding once.
 */
export class Router {
  private readonly g: Graph;
  private readonly gScore: Float64Array;
  private readonly cameFrom: Int32Array;
  private readonly gen: Int32Array;
  private generation = 0;

  // binary min-heap (parallel arrays)
  private heapNode: Int32Array;
  private heapF: Float64Array;
  private heapSize = 0;

  private cache = new Map<number, Route>();
  private readonly maxCache = 20000;

  constructor(graph: Graph) {
    this.g = graph;
    const n = graph.nodeCount;
    this.gScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.gen = new Int32Array(n);
    this.heapNode = new Int32Array(1024);
    this.heapF = new Float64Array(1024);
  }

  route(start: number, goal: number): Route | null {
    if (start < 0 || goal < 0) return null;
    if (start === goal) return { path: [start], dist: 0 };
    const key = start * this.g.nodeCount + goal;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = this.search(start, goal);
    if (result) {
      if (this.cache.size >= this.maxCache) this.cache.clear();
      this.cache.set(key, result);
    }
    return result;
  }

  private search(start: number, goal: number): Route | null {
    const g = this.g;
    const gen = ++this.generation;
    this.heapSize = 0;

    const glon = g.lon(goal);
    const glat = g.lat(goal);

    this.gScore[start] = 0;
    this.gen[start] = gen;
    this.cameFrom[start] = -1;
    this.push(start, haversine(g.lon(start), g.lat(start), glon, glat));

    while (this.heapSize > 0) {
      const current = this.pop();
      if (current === goal) return this.reconstruct(start, goal);
      const cg = this.gScore[current];
      const [lo, hi] = g.adjRange(current);
      for (let k = lo; k < hi; k++) {
        const nbr = g.neighborAt(k);
        const tentative = cg + g.lenAt(k);
        if (this.gen[nbr] !== gen || tentative < this.gScore[nbr]) {
          this.gen[nbr] = gen;
          this.gScore[nbr] = tentative;
          this.cameFrom[nbr] = current;
          const f = tentative + haversine(g.lon(nbr), g.lat(nbr), glon, glat);
          this.push(nbr, f);
        }
      }
    }
    return null;
  }

  private reconstruct(start: number, goal: number): Route {
    const path: number[] = [];
    let cur = goal;
    while (cur !== -1) {
      path.push(cur);
      if (cur === start) break;
      cur = this.cameFrom[cur];
    }
    path.reverse();
    return { path, dist: this.gScore[goal] };
  }

  // --- heap ---------------------------------------------------------------
  private push(node: number, f: number): void {
    if (this.heapSize >= this.heapNode.length) this.growHeap();
    let i = this.heapSize++;
    this.heapNode[i] = node;
    this.heapF[i] = f;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heapF[parent] <= this.heapF[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private pop(): number {
    const top = this.heapNode[0];
    const last = --this.heapSize;
    this.heapNode[0] = this.heapNode[last];
    this.heapF[0] = this.heapF[last];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.heapSize && this.heapF[l] < this.heapF[smallest]) smallest = l;
      if (r < this.heapSize && this.heapF[r] < this.heapF[smallest]) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tn = this.heapNode[a];
    this.heapNode[a] = this.heapNode[b];
    this.heapNode[b] = tn;
    const tf = this.heapF[a];
    this.heapF[a] = this.heapF[b];
    this.heapF[b] = tf;
  }

  private growHeap(): void {
    const node = new Int32Array(this.heapNode.length * 2);
    const f = new Float64Array(this.heapF.length * 2);
    node.set(this.heapNode);
    f.set(this.heapF);
    this.heapNode = node;
    this.heapF = f;
  }
}
