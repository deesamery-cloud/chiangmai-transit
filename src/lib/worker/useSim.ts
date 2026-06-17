"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Graph } from "@/lib/geo/graph";
import { Router } from "@/lib/routing/astar";
import { buildLine, buildLineFromStations, headwayFor, type DrawPoint } from "@/lib/network/line";
import { AGENT_COUNT_LITE, CITY_POPULATION, DIFFICULTIES, GOALS, LINE_CAP, lowEndDevice, MAX_FLEET, PEOPLE_PER_AGENT, SIM, STATE_COLOR, type Difficulty, type GoalKind } from "@/lib/config";
import type {
  FromWorker,
  GraphData,
  LineMode,
  PlacedStation,
  PoiData,
  SnapshotMeta,
  ToWorker,
  TransitLine,
  ZoneData,
} from "@/lib/types";

export interface Snap {
  positions: Float32Array;
  colors: Uint8Array;
  count: number;
  t: number;
}
export interface SnapPair {
  A: Snap | null;
  B: Snap | null;
}
export interface HistoryPoint {
  riders: number;
  budget: number;
  coverage: number;
  congestion: number;
}

export interface UseSim {
  loaded: boolean; // data ready, can pick a mode
  peoplePerAgent: number; // display scale (higher on lite tier, which runs fewer agents)
  started: boolean; // game mode chosen, sim running
  ready: boolean;
  goal: GoalKind | null;
  meta: SnapshotMeta | null;
  lines: TransitLine[];
  playing: boolean;
  speed: number;
  graph: Graph | null;
  zones: ZoneData | null;
  pois: PoiData | null;
  snapRef: React.RefObject<SnapPair>;
  history: HistoryPoint[];
  ticker: string[];
  notice: string | null;
  startGame: (goal: GoalKind, difficulty: Difficulty, seed?: number) => void;
  play: () => void;
  pause: () => void;
  setSpeed: (v: number) => void;
  addLine: (
    points: DrawPoint[],
    mode: LineMode,
    color?: [number, number, number],
  ) => TransitLine | null;
  addLineFromStations: (
    stations: PlacedStation[],
    mode: LineMode,
    color?: [number, number, number],
  ) => TransitLine | null;
  // rebuild an existing line in place from a new ordered station list (extend / per-station demolish)
  replaceLineFromStations: (
    lineId: string,
    stations: PlacedStation[],
    color: [number, number, number],
    fleet: number,
    mode?: LineMode,
  ) => TransitLine | null;
  removeLine: (id: string) => void;
  setAllLines: (lines: TransitLine[]) => void; // replace the whole network (undo/restore)
  setFleet: (id: string, n: number) => void;
  setFare: (id: string, fare: number) => void;
  setLineColor: (id: string, color: [number, number, number]) => void;
  clearAll: () => void;
  dismissNotice: () => void;
}

export function useSim(): UseSim {
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [goal, setGoal] = useState<GoalKind | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [lines, setLines] = useState<TransitLine[]>([]);
  // keep a synchronous mirror of `lines` so add* can guard + return the new line
  // immediately (the setLines updater runs lazily, so its result can't be returned)
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1); // start at 1× — the player speeds up time deliberately
  const [peoplePerAgent, setPeoplePerAgent] = useState(PEOPLE_PER_AGENT);
  const [graph, setGraphState] = useState<Graph | null>(null);
  const [zones, setZones] = useState<ZoneData | null>(null);
  const [pois, setPois] = useState<PoiData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [ticker, setTicker] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const graphRef = useRef<Graph | null>(null);
  const routerRef = useRef<Router | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const dataRef = useRef<{ g: GraphData; z: ZoneData; p: PoiData } | null>(null);
  const snapRef = useRef<SnapPair>({ A: null, B: null });
  const budgetRef = useRef<number>(Infinity);
  const linesRef = useRef<TransitLine[]>([]);
  const throttle = useRef(0);

  useEffect(() => {
    let alive = true;
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "ready") {
        setReady(true);
        return;
      }
      const positions = new Float32Array(m.positions);
      const states = new Uint8Array(m.states);
      const count = states.length;
      const colors = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        const c = STATE_COLOR[states[i]] ?? STATE_COLOR[0];
        const o = i * 4;
        colors[o] = c[0];
        colors[o + 1] = c[1];
        colors[o + 2] = c[2];
        colors[o + 3] = c[3];
      }
      snapRef.current = {
        A: snapRef.current.B,
        B: { positions, colors, count, t: performance.now() },
      };
      budgetRef.current = m.meta.budget;
      if (m.meta.events.length) {
        setTicker((t) => [...m.meta.events, ...t].slice(0, 8));
      }
      if (throttle.current++ % 5 === 0) {
        setMeta(m.meta);
        setHistory((h) =>
          [
            ...h,
            {
              riders: m.meta.dailyRiders,
              budget: m.meta.budget,
              coverage: m.meta.coverage,
              congestion: m.meta.congestion,
            },
          ].slice(-60),
        );
      }
    };

    (async () => {
      const [g, z, p] = await Promise.all([
        fetch("/data/network.graph.json").then((r) => r.json() as Promise<GraphData>),
        fetch("/data/zones.json").then((r) => r.json() as Promise<ZoneData>),
        fetch("/data/pois.json").then((r) => r.json() as Promise<PoiData>),
      ]);
      if (!alive) return;
      const gr = new Graph(g);
      graphRef.current = gr;
      routerRef.current = new Router(gr);
      dataRef.current = { g, z, p };
      setGraphState(gr);
      setZones(z);
      setPois(p);
      setLoaded(true);
    })();

    return () => {
      alive = false;
      worker.terminate();
    };
  }, []);

  const send = useCallback((msg: ToWorker) => {
    workerRef.current?.postMessage(msg);
  }, []);

  const startGame = useCallback(
    (g: GoalKind, difficulty: Difficulty, seed = 1) => {
      const d = dataRef.current;
      if (!d || started) return;
      const gm = GOALS[g];
      const dif = DIFFICULTIES[difficulty];
      const budget = gm.startBudget === Infinity ? Infinity : Math.round(gm.startBudget * dif.budgetMult);
      budgetRef.current = budget;
      // lite tier: fewer agents on weak phones, but scale the display factor up
      // so on-screen city numbers stay at full scale
      const agentCount = lowEndDevice() ? AGENT_COUNT_LITE : SIM.agentCount;
      setPeoplePerAgent(Math.round(CITY_POPULATION / agentCount));
      setGoal(g);
      setStarted(true);
      send({
        type: "init",
        graph: d.g,
        zones: d.z,
        pois: d.p,
        agentCount,
        startBudget: budget,
        bankruptcy: dif.bankruptcy,
        costMult: dif.costMult,
        opexMult: dif.opexMult,
        fareMult: dif.fareMult,
        capMult: dif.capacityMult,
        seed,
      });
    },
    [send, started],
  );

  const play = useCallback(() => {
    send({ type: "play" });
    setPlaying(true);
  }, [send]);
  const pause = useCallback(() => {
    send({ type: "pause" });
    setPlaying(false);
  }, [send]);
  const setSpeed = useCallback(
    (v: number) => {
      send({ type: "speed", value: v });
      setSpeedState(v);
    },
    [send],
  );

  const addLine = useCallback(
    (points: DrawPoint[], mode: LineMode, color?: [number, number, number]) => {
      const g = graphRef.current;
      const router = routerRef.current;
      if (!g || !router) return null;
      const l = buildLine(g, router, points, mode, color);
      if (!l) {
        setNotice("ไม่พบเส้นทาง — ลองเลือกจุดบนถนนที่เชื่อมกัน · Couldn\u2019t route that line — try points along connected streets.");
        return null;
      }
      // synchronous guards (read refs) so we can return the new line immediately
      if (linesRef.current.filter((x) => x.mode === mode).length >= LINE_CAP[mode]) {
        setNotice(`ครบจำนวนสาย${mode === "metro" ? "รถไฟฟ้า" : "สองแถว"}แล้ว (${LINE_CAP[mode]}) · Max ${mode === "metro" ? "Metro" : "Songthaew"} lines reached.`);
        return null;
      }
      if (l.capex > budgetRef.current) {
        setNotice(`งบไม่พอ — สายนี้ราคา ฿${(l.capex / 1e6).toFixed(1)}M · Not enough budget for this ${mode} line.`);
        return null;
      }
      setLines((prev) => {
        const next = [...prev, l];
        send({ type: "setNetwork", lines: next });
        return next;
      });
      return l;
    },
    [send],
  );
  const addLineFromStations = useCallback(
    (stations: PlacedStation[], mode: LineMode, color?: [number, number, number]) => {
      const g = graphRef.current;
      const router = routerRef.current;
      if (!g || !router) return null;
      const l = buildLineFromStations(g, router, stations, mode, color);
      if (!l) {
        setNotice("ต่อรางไม่ได้ — เลือกสถานีบนถนนที่เชื่อมกัน · Couldn\u2019t route rail between those stations — pick stations on connected streets.");
        return null;
      }
      // synchronous guards (read refs) so we can return the new line immediately
      if (linesRef.current.filter((x) => x.mode === mode).length >= LINE_CAP[mode]) {
        setNotice(`ครบจำนวนสาย${mode === "metro" ? "รถไฟฟ้า" : "สองแถว"}แล้ว (${LINE_CAP[mode]}) · Max ${mode === "metro" ? "Metro" : "Songthaew"} lines reached.`);
        return null;
      }
      if (l.capex > budgetRef.current) {
        setNotice(`งบไม่พอ — สายนี้ราคา ฿${(l.capex / 1e6).toFixed(1)}M · Not enough budget for this ${mode} line.`);
        return null;
      }
      setLines((prev) => {
        const next = [...prev, l];
        send({ type: "setNetwork", lines: next });
        return next;
      });
      return l;
    },
    [send],
  );
  const replaceLineFromStations = useCallback(
    (lineId: string, stations: PlacedStation[], color: [number, number, number], fleet: number, mode: LineMode = "metro") => {
      const g = graphRef.current;
      const router = routerRef.current;
      if (!g || !router) return null;
      const l = buildLineFromStations(g, router, stations, mode, color, fleet, lineId);
      if (!l) {
        setNotice("เชื่อมไม่ได้ — เลือกสถานีบนถนนที่เชื่อมกัน · Couldn\u2019t route that — pick stations on connected streets.");
        return null;
      }
      setLines((prev) => {
        const next = prev.map((x) => (x.id === lineId ? l : x));
        send({ type: "setNetwork", lines: next });
        return next;
      });
      return l;
    },
    [send],
  );
  const removeLine = useCallback(
    (id: string) => {
      setLines((prev) => {
        const next = prev.filter((l) => l.id !== id);
        send({ type: "setNetwork", lines: next });
        return next;
      });
    },
    [send],
  );
  const setAllLines = useCallback(
    (next: TransitLine[]) => {
      setLines(next);
      send({ type: "setNetwork", lines: next });
    },
    [send],
  );
  const setFleet = useCallback(
    (id: string, n: number) => {
      const fleet = Math.max(1, Math.min(MAX_FLEET, Math.round(n)));
      setLines((prev) => {
        const next = prev.map((l) =>
          l.id === id
            ? {
                ...l,
                fleet,
                headwaySec: headwayFor(l.totalLen, l.speed, l.dwellSec, l.stops.length, fleet),
              }
            : l,
        );
        send({ type: "setNetwork", lines: next });
        return next;
      });
    },
    [send],
  );
  const setFare = useCallback(
    (id: string, fare: number) => {
      const f = Math.max(5, Math.min(100, Math.round(fare / 5) * 5)); // ฿5 steps, 5–100
      setLines((prev) => {
        const next = prev.map((l) => (l.id === id ? { ...l, fare: f } : l));
        send({ type: "setNetwork", lines: next });
        return next;
      });
    },
    [send],
  );
  const setLineColor = useCallback(
    (id: string, color: [number, number, number]) => {
      setLines((prev) => {
        const next = prev.map((l) => (l.id === id ? { ...l, color } : l));
        send({ type: "setNetwork", lines: next });
        return next;
      });
    },
    [send],
  );
  const clearAll = useCallback(() => {
    setLines([]);
    send({ type: "setNetwork", lines: [] });
  }, [send]);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    loaded,
    peoplePerAgent,
    started,
    ready,
    goal,
    meta,
    lines,
    playing,
    speed,
    graph,
    zones,
    pois,
    snapRef,
    history,
    ticker,
    notice,
    startGame,
    play,
    pause,
    setSpeed,
    addLine,
    addLineFromStations,
    replaceLineFromStations,
    removeLine,
    setAllLines,
    setFleet,
    setFare,
    setLineColor,
    clearAll,
    dismissNotice,
  };
}
