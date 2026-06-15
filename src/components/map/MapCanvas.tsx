"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, PathLayer, IconLayer, TextLayer, ArcLayer } from "@deck.gl/layers";
// HeatmapLayer lives in @deck.gl/aggregation-layers; import via the installed
// `deck.gl` umbrella so it resolves under pnpm (aggregation-layers isn't a direct dep).
import { HeatmapLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { Graph, haversine } from "@/lib/geo/graph";
import { linePathCoords } from "@/lib/network/line";
import type { LineMode, ODCorridor, PlacedStation, PoiData, SnapshotMeta, TransitLine, ZoneData } from "@/lib/types";
import type { SnapPair } from "@/lib/worker/useSim";
import { MAP, type Tool } from "@/lib/config";

const WIDTH: Record<LineMode, number> = { metro: 6, songthaew: 3.5 };

// Population-density heat — a warm Lanna ramp (parchment → gold → cinnabar).
const DENSITY_RANGE: [number, number, number][] = [
  [255, 247, 226],
  [243, 214, 142],
  [216, 150, 52],
  [194, 106, 42],
  [181, 70, 46],
  [120, 30, 26],
];
type PresencePt = { position: [number, number]; base: number; group: 0 | 1 | 2 }; // 0 res,1 student,2 tourist
// time-of-day weight per group: residents broad with commute humps; students
// daytime; tourists midday→evening/night.
function groupHourMult(hour: number, group: number): number {
  const g = (c: number, s: number) => Math.exp(-((hour - c) ** 2) / s);
  if (group === 2) return 0.25 + 1.3 * Math.min(1, g(14, 16) + g(20, 10)); // tourist
  if (group === 1) return 0.25 + 1.1 * Math.min(1, g(10, 8) + g(15, 9)); // student
  return 0.55 + 0.6 * Math.min(1, g(8, 8) + g(18, 8)); // resident
}
// temple gold — station rings read as Lanna gold markers over the realistic map
const ACCENT: [number, number, number] = [200, 150, 43];
const INK: [number, number, number] = [46, 33, 19]; // deep teak, for chained station rings

// Lanna chedi (temple stupa) marker — stations sit on the map as little gold
// temples. Bottom tip is the anchor so rail meets the base. Two states:
// gold (idle) / teak (being connected into a line).
const chedi = (body: string, outline: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='64' viewBox='0 0 48 64'>` +
      `<g fill='${body}' stroke='${outline}' stroke-width='2.6' stroke-linejoin='round' stroke-linecap='round'>` +
      `<line x1='24' y1='3' x2='24' y2='15'/>` +
      `<circle cx='24' cy='6' r='2.4'/>` +
      `<path d='M16 31 q8 -17 16 0 q2 12 -3 18 H19 q-5 -6 -3 -18 Z'/>` +
      `<path d='M12 47 H36 L40 59 H8 Z'/>` +
      `</g></svg>`,
  );
const ICON_GOLD = { id: "chedi-gold", url: chedi("#c8962b", "#5e4410"), width: 48, height: 64, anchorY: 64, mask: false };
const ICON_INK = { id: "chedi-ink", url: chedi("#2e2113", "#e7c878"), width: 48, height: 64, anchorY: 64, mask: false };

// Realistic metro-train marker (top-down EMU car), coloured by live crowding
// 1 (empty) .. 5 (full). The rail underneath carries the line's own colour.
const CROWD_FILL: Record<number, string> = {
  1: "#2f8f6b", // jade — empty
  2: "#7fa53c", // olive
  3: "#d9a441", // gold — half
  4: "#c26a2a", // terracotta
  5: "#b5462e", // cinnabar — full
};
// a clean, sleek capsule with the same deep-teak (Lanna ink) outline as the
// chedi stations + a soft window band — reads as a tidy little train and blends
// with the warm map instead of a busy cartoon car.
const trainIcon = (fill: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='52' height='24' viewBox='0 0 52 24'>` +
      `<rect x='2.5' y='3.5' width='47' height='17' rx='8.5' fill='${fill}' stroke='#2e2113' stroke-width='2'/>` +
      `<rect x='8' y='8' width='29' height='5' rx='2.5' fill='#fdf6e8' opacity='0.9'/>` +
      `<circle cx='44.5' cy='12' r='1.5' fill='#fff7d6'/>` +
      `</svg>`,
  );
const TRAIN: Record<number, { id: string; url: string; width: number; height: number }> = {};
for (let c = 1; c <= 5; c++) TRAIN[c] = { id: `train-${c}`, url: trainIcon(CROWD_FILL[c]), width: 52, height: 24 };

// songthaew "rod daeng" — a little covered pickup, crowd-coloured like the train,
// same teak outline so road vehicles read as their own thing vs the metro capsule.
const truckIcon = (fill: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='26' viewBox='0 0 40 26'>` +
      `<rect x='3' y='8' width='22' height='12' rx='2.5' fill='${fill}' stroke='#2e2113' stroke-width='2'/>` + // covered bed
      `<rect x='5.5' y='6' width='17' height='2.5' rx='1.2' fill='#fdf6e8' opacity='0.85'/>` + // canopy rail
      `<path d='M25 11 H31 L36 16 V20 H25 Z' fill='${fill}' stroke='#2e2113' stroke-width='2' stroke-linejoin='round'/>` + // cab
      `<rect x='26.5' y='12.5' width='5.5' height='4' rx='1' fill='#fdf6e8' opacity='0.9'/>` + // windscreen
      `<circle cx='10' cy='21' r='2.6' fill='#241a0e'/><circle cx='29' cy='21' r='2.6' fill='#241a0e'/>` + // wheels
      `</svg>`,
  );
const TRUCK: Record<number, { id: string; url: string; width: number; height: number }> = {};
for (let c = 1; c <= 5; c++) TRUCK[c] = { id: `truck-${c}`, url: truckIcon(CROWD_FILL[c]), width: 40, height: 26 };

interface LineRender {
  id: string;
  path: [number, number][];
  color: [number, number, number];
  width: number;
  selected: boolean;
}
interface StopRender {
  lon: number;
  lat: number;
  color: [number, number, number];
}

interface Props {
  graph: Graph | null;
  lines: TransitLine[];
  vehicles: SnapshotMeta["vehicles"] | undefined;
  snapRef: React.RefObject<SnapPair>;
  tool: Tool;
  stations: PlacedStation[];
  railDraft: string[]; // ordered chained station ids
  routeDraft: { lon: number; lat: number }[]; // songthaew route waypoints being drawn
  onPlaceStation: (lon: number, lat: number) => void;
  onChainStation: (id: string) => void;
  onAddRoutePoint: (lon: number, lat: number) => void;
  onDemolishStation: (id: string) => void;
  onDemolishLine: (id: string) => void;
  selectedLineId: string | null;
  onSelectLine: (id: string | null) => void;
  center: [number, number];
  showDensity: boolean;
  showAgents: boolean;
  zones: ZoneData | null;
  pois: PoiData | null;
  simTime: number;
  selectedOD: ODCorridor | null;
}

interface FrameState {
  lineKey: string;
  lineRenders: LineRender[];
  stopRenders: StopRender[];
  vehicles: SnapshotMeta["vehicles"] | undefined;
  snapRef: React.RefObject<SnapPair>;
  roadSegs: [number, number][][];
  drawActive: boolean;
  tool: Tool;
  stations: PlacedStation[];
  railDraft: string[];
  routeDraft: { lon: number; lat: number }[];
  deckClickAt: React.MutableRefObject<number>;
  onSelectLine: (id: string | null) => void;
  onDemolishLine: (id: string) => void;
  showDensity: boolean;
  showAgents: boolean;
  presence: PresencePt[];
  hour: number;
  hourBucket: number;
  zoom: number;
  selectedOD: ODCorridor | null;
}

function lerp(a: number, b: number, g: number): number {
  return a + (b - a) * g;
}

function DeckLayers({ frameRef }: { frameRef: React.RefObject<FrameState> }) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ interleaved: false, layers: [] }),
  );
  const bufs = useRef<[Float32Array, Float32Array] | null>(null);
  const parity = useRef(0);
  const lineKey = useRef("");
  const netLayers = useRef<Layer[]>([]);
  // vehicle position interpolation so trains/songthaews GLIDE between snapshots
  const vehState = useRef<{ prev: SnapshotMeta["vehicles"]; cur: SnapshotMeta["vehicles"]; t0: number; span: number; ref: unknown }>(
    { prev: [], cur: [], t0: 0, span: 160, ref: null },
  );

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const f = frameRef.current;
      const layers: Layer[] = [];

      // --- population density as a smooth continuous gradient (toggleable) --
      // a tight radius so it follows where people actually live everywhere, not
      // broad blobs and not blocky cells.
      if (f.showDensity && f.presence.length) {
        layers.push(
          new HeatmapLayer({
            id: "density",
            data: f.presence,
            getPosition: (d: PresencePt) => d.position,
            getWeight: (d: PresencePt) => d.base * groupHourMult(f.hour, d.group),
            aggregation: "SUM",
            radiusPixels: 26,
            intensity: 1,
            threshold: 0.02,
            opacity: 0.55,
            colorRange: DENSITY_RANGE,
            updateTriggers: { getWeight: f.hourBucket },
            parameters: { depthTest: false },
          }),
        );
      }

      // --- buildable roads (while placing stations / laying track) --------
      if (f.drawActive && f.roadSegs.length) {
        layers.push(
          new PathLayer({
            id: "buildable-roads",
            data: f.roadSegs,
            getPath: (d: [number, number][]) => d,
            getColor: [90, 220, 255, 70],
            getWidth: 1.4,
            widthUnits: "pixels",
            parameters: { depthTest: false },
          }),
        );
      }

      // --- agents (interpolated, binary; toggleable) ---------------------
      const pair = f.snapRef.current;
      const B = pair.B;
      if (f.showAgents && B && B.count > 0) {
        const count = B.count;
        if (!bufs.current || bufs.current[0].length !== count * 2) {
          bufs.current = [new Float32Array(count * 2), new Float32Array(count * 2)];
        }
        const out = bufs.current[parity.current];
        parity.current ^= 1;
        const A = pair.A;
        if (A && A.count === count) {
          const span = B.t - A.t || 16;
          let g = (performance.now() - B.t) / span;
          if (g < 0) g = 0;
          else if (g > 1) g = 1;
          const pa = A.positions;
          const pb = B.positions;
          for (let i = 0; i < count * 2; i++) out[i] = lerp(pa[i], pb[i], g);
        } else {
          out.set(B.positions.subarray(0, count * 2));
        }
        layers.push(
          new ScatterplotLayer({
            id: "agents",
            data: {
              length: count,
              attributes: {
                getPosition: { value: out, size: 2 },
                getFillColor: { value: B.colors, size: 4, normalized: true },
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            radiusUnits: "pixels",
            getRadius: 1.8,
            radiusMinPixels: 1,
            pickable: false,
            parameters: { depthTest: false },
            updateTriggers: { getPosition: parity.current },
          }),
        );
      }

      // --- transit lines + stops (cached) --------------------------------
      if (f.lineKey !== lineKey.current) {
        lineKey.current = f.lineKey;
        const ll: Layer[] = [];
        // outer white ring for the selected line (drawn widest, underneath)
        const selected = f.lineRenders.filter((r) => r.selected);
        if (selected.length) {
          ll.push(
            new PathLayer({
              id: "line-halo",
              data: selected,
              getPath: (d: LineRender) => d.path,
              getColor: [255, 255, 255, 190],
              getWidth: (d: LineRender) => d.width + 9,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              parameters: { depthTest: false },
            }),
          );
        }
        // dark contrast halo under EVERY line so the coloured rail reads clearly
        // above the dense commuter dot field
        if (f.lineRenders.length) {
          ll.push(
            new PathLayer({
              id: "line-halo-all",
              data: f.lineRenders,
              getPath: (d: LineRender) => d.path,
              getColor: [10, 13, 20, 235],
              getWidth: (d: LineRender) => d.width + 4,
              widthUnits: "pixels",
              widthMinPixels: 5,
              capRounded: true,
              jointRounded: true,
              parameters: { depthTest: false },
            }),
          );
        }
        if (f.lineRenders.length) {
          ll.push(
            new PathLayer({
              id: "lines",
              data: f.lineRenders,
              getPath: (d: LineRender) => d.path,
              getColor: (d: LineRender) => [d.color[0], d.color[1], d.color[2], 235],
              getWidth: (d: LineRender) => d.width,
              widthUnits: "pixels",
              widthMinPixels: 3,
              capRounded: true,
              jointRounded: true,
              pickable: true,
              onClick: (info) => {
                const o = info.object as LineRender | undefined;
                if (!o) return false;
                const fr = frameRef.current;
                // pan-mode click selects; demolish-mode click removes the line
                // (this is how songthaew routes — which have no stations — get deleted)
                if (fr.tool === "pan") {
                  fr.deckClickAt.current = performance.now();
                  fr.onSelectLine(o.id);
                  return true;
                }
                if (fr.tool === "demolish") {
                  fr.deckClickAt.current = performance.now();
                  fr.onDemolishLine(o.id);
                  return true;
                }
                return false;
              },
              parameters: { depthTest: false },
            }),
          );
        }
        if (f.stopRenders.length) {
          ll.push(
            new ScatterplotLayer({
              id: "stops",
              data: f.stopRenders,
              getPosition: (d: StopRender) => [d.lon, d.lat],
              getFillColor: [255, 255, 255, 255],
              getLineColor: (d: StopRender) => [d.color[0], d.color[1], d.color[2], 255],
              stroked: true,
              lineWidthUnits: "pixels",
              getLineWidth: 2,
              radiusUnits: "pixels",
              getRadius: 4,
              parameters: { depthTest: false },
            }),
          );
        }
        netLayers.current = ll;
      }
      layers.push(...netLayers.current);

      // --- vehicles: a line-colour base dot + a crowding-coloured train -----
      if (f.vehicles && f.vehicles.length) {
        // interpolate positions between snapshots so vehicles glide, not teleport
        const vs = vehState.current;
        const vehs = f.vehicles;
        const now = performance.now();
        if (vehs !== vs.ref) {
          vs.prev = vs.cur.length === vehs.length ? vs.cur : vehs; // snap if the network changed
          vs.span = Math.min(420, Math.max(60, now - vs.t0));
          vs.cur = vehs;
          vs.t0 = now;
          vs.ref = vehs;
        }
        let g = vs.span ? (now - vs.t0) / vs.span : 1;
        if (g > 1) g = 1;
        else if (g < 0) g = 0;
        const vpos: [number, number][] = vehs.map((v, i) => {
          const p = vs.prev[i];
          return p ? [lerp(p.lon, v.lon, g), lerp(p.lat, v.lat, g)] : [v.lon, v.lat];
        });
        // line-colour halo underneath so you can still tell which line a train runs
        layers.push(
          new ScatterplotLayer({
            id: "vehicle-line",
            data: vehs,
            getPosition: (_v: SnapshotMeta["vehicles"][number], { index }: { index: number }) => vpos[index],
            getFillColor: (v: SnapshotMeta["vehicles"][number]) => [v.color[0], v.color[1], v.color[2], 220],
            getRadius: 7,
            radiusUnits: "pixels",
            radiusMinPixels: 5.5,
            parameters: { depthTest: false },
            updateTriggers: { getPosition: now, getFillColor: vehs },
          }),
        );
        // the train, coloured 1..5 by how packed it is right now
        layers.push(
          new IconLayer({
            id: "vehicles",
            data: vehs,
            getIcon: (v: SnapshotMeta["vehicles"][number]) =>
              v.road ? TRUCK[v.crowd] ?? TRUCK[1] : TRAIN[v.crowd] ?? TRAIN[1],
            getPosition: (_v: SnapshotMeta["vehicles"][number], { index }: { index: number }) => vpos[index],
            getSize: (v: SnapshotMeta["vehicles"][number]) => (v.road ? 15 : 18) + (v.crowd - 1) * 1.6,
            sizeUnits: "pixels",
            sizeMinPixels: 12,
            billboard: true,
            parameters: { depthTest: false },
            updateTriggers: { getIcon: vehs, getSize: vehs, getPosition: now },
          }),
        );
      }

      // --- rail draft preview (chain being connected) --------------------
      if (f.railDraft.length >= 2) {
        const coords = f.railDraft
          .map((id) => f.stations.find((s) => s.id === id))
          .filter((s): s is PlacedStation => !!s)
          .map((s) => [s.lon, s.lat] as [number, number]);
        if (coords.length >= 2) {
          layers.push(
            new PathLayer({
              id: "rail-draft",
              data: [{ path: coords }],
              getPath: (d: { path: [number, number][] }) => d.path,
              getColor: [ACCENT[0], ACCENT[1], ACCENT[2], 190],
              getWidth: 3.5,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              parameters: { depthTest: false },
            }),
          );
        }
      }

      // --- songthaew route draft (free waypoints being drawn) ------------
      if (f.routeDraft.length) {
        const rc = f.routeDraft.map((p) => [p.lon, p.lat] as [number, number]);
        if (rc.length >= 2) {
          layers.push(
            new PathLayer({
              id: "route-draft",
              data: [{ path: rc }],
              getPath: (d: { path: [number, number][] }) => d.path,
              getColor: [214, 64, 52, 200], // rod-daeng red
              getWidth: 3,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              parameters: { depthTest: false },
            }),
          );
        }
        layers.push(
          new ScatterplotLayer({
            id: "route-draft-pts",
            data: rc,
            getPosition: (d: [number, number]) => d,
            getFillColor: [214, 64, 52, 255],
            getLineColor: [255, 255, 255, 255],
            stroked: true,
            lineWidthUnits: "pixels",
            getLineWidth: 1.5,
            radiusUnits: "pixels",
            getRadius: 4,
            parameters: { depthTest: false },
          }),
        );
      }

      // --- placed stations as Lanna chedi markers (chained ones go teak) -
      if (f.stations.length) {
        const chained = new Set(f.railDraft);
        // a small base dot at the exact node, so the marker reads as "planted"
        // and tiny stations stay clickable-looking even when zoomed out
        layers.push(
          new ScatterplotLayer({
            id: "station-base",
            data: f.stations,
            getPosition: (s: PlacedStation) => [s.lon, s.lat],
            getFillColor: (s: PlacedStation) => (chained.has(s.id) ? [...ACCENT, 255] : [...INK, 220]),
            radiusUnits: "pixels",
            getRadius: 2,
            radiusMinPixels: 1.5,
            parameters: { depthTest: false },
            updateTriggers: { getFillColor: f.railDraft },
          }),
        );
        layers.push(
          new IconLayer({
            id: "stations",
            data: f.stations,
            getIcon: (s: PlacedStation) => (chained.has(s.id) ? ICON_INK : ICON_GOLD),
            getPosition: (s: PlacedStation) => [s.lon, s.lat],
            getSize: 30,
            sizeUnits: "pixels",
            sizeMinPixels: 18,
            billboard: true,
            parameters: { depthTest: false },
            updateTriggers: { getIcon: f.railDraft },
          }),
        );
        // station name labels (Bangkok-style), shown when zoomed in enough
        if (f.zoom >= 12.9) {
          layers.push(
            new TextLayer({
              id: "station-labels",
              data: f.stations,
              getPosition: (s: PlacedStation) => [s.lon, s.lat],
              getText: (s: PlacedStation) => s.name || "",
              getSize: 11,
              getColor: [46, 33, 19, 255],
              getPixelOffset: [0, -32],
              getBackgroundColor: [251, 247, 239, 225],
              background: true,
              backgroundPadding: [4, 2],
              getBorderColor: [200, 150, 43, 220],
              getBorderWidth: 1,
              fontFamily: "'Noto Sans Thai', system-ui, sans-serif",
              fontWeight: 600,
              characterSet: "auto",
              sizeUnits: "pixels",
              parameters: { depthTest: false },
              updateTriggers: { getText: f.stations },
            }),
          );
        }
      }

      // --- selected OD corridor: an O→D arc + endpoints + names (on top) ----
      if (f.selectedOD) {
        const od = f.selectedOD;
        layers.push(
          new ArcLayer({
            id: "od-arc",
            data: [od],
            getSourcePosition: (d: ODCorridor) => [d.oLon, d.oLat],
            getTargetPosition: (d: ODCorridor) => [d.dLon, d.dLat],
            getSourceColor: [62, 92, 138, 235], // origin — indigo
            getTargetColor: [194, 106, 42, 235], // destination — terracotta
            getWidth: 4,
            getHeight: 0.45,
            widthUnits: "pixels",
            parameters: { depthTest: false },
          }),
        );
        layers.push(
          new ScatterplotLayer({
            id: "od-ends",
            data: [
              { lon: od.oLon, lat: od.oLat, c: [62, 92, 138] as [number, number, number] },
              { lon: od.dLon, lat: od.dLat, c: [194, 106, 42] as [number, number, number] },
            ],
            getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
            getFillColor: (d: { c: [number, number, number] }) => [...d.c, 255],
            getLineColor: [255, 255, 255, 255],
            stroked: true,
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            radiusUnits: "pixels",
            getRadius: 8,
            parameters: { depthTest: false },
          }),
        );
        layers.push(
          new TextLayer({
            id: "od-labels",
            data: [
              { lon: od.oLon, lat: od.oLat, t: "◖ " + od.oName },
              { lon: od.dLon, lat: od.dLat, t: "▶ " + od.dName },
            ],
            getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
            getText: (d: { t: string }) => d.t,
            getSize: 12,
            getColor: [46, 33, 19, 255],
            getPixelOffset: [0, -15],
            background: true,
            getBackgroundColor: [251, 247, 239, 235],
            backgroundPadding: [5, 2],
            getBorderColor: [200, 150, 43, 230],
            getBorderWidth: 1,
            fontFamily: "'Noto Sans Thai', system-ui, sans-serif",
            fontWeight: 700,
            characterSet: "auto",
            sizeUnits: "pixels",
            parameters: { depthTest: false },
          }),
        );
      }

      overlay.setProps({ layers });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [overlay, frameRef]);

  return null;
}

export default function MapCanvas(props: Props) {
  const {
    graph, lines, vehicles, snapRef, tool, stations, railDraft, routeDraft,
    onPlaceStation, onChainStation, onAddRoutePoint, onDemolishStation, onDemolishLine,
    selectedLineId, onSelectLine, center,
    showDensity, showAgents, zones, pois, simTime, selectedOD,
  } = props;
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const lastChained = useRef<string | null>(null);
  const pressed = useRef(false);
  const deckClickAt = useRef(0);
  const [zoom, setZoom] = useState(12.6);
  const drawActive = tool === "track" || tool === "station" || tool === "route";

  // road network as 2-pt segments, for the cyan buildable-roads overlay
  const roadSegs = useMemo<[number, number][][]>(() => {
    if (!graph) return [];
    const segs: [number, number][][] = [];
    for (let i = 0; i < graph.nodeCount; i++) {
      const [lo, hi] = graph.adjRange(i);
      const ax = graph.lon(i);
      const ay = graph.lat(i);
      for (let k = lo; k < hi; k++) {
        const j = graph.neighborAt(k);
        if (j > i) segs.push([[ax, ay], [graph.lon(j), graph.lat(j)]]);
      }
    }
    return segs;
  }, [graph]);

  const { lineRenders, stopRenders, lineKey } = useMemo(() => {
    const lr: LineRender[] = [];
    const sr: StopRender[] = [];
    if (graph) {
      for (const line of lines) {
        const flat = linePathCoords(graph, line);
        const path: [number, number][] = [];
        for (let i = 0; i < flat.length; i += 2) path.push([flat[i], flat[i + 1]]);
        lr.push({ id: line.id, path, color: line.color, width: WIDTH[line.mode], selected: line.id === selectedLineId });
        for (const s of line.stops) sr.push({ lon: s.lon, lat: s.lat, color: line.color });
      }
    }
    return {
      lineRenders: lr,
      stopRenders: sr,
      // include a geometry signal (length + stop count) so EXTENDING a line
      // (same id + colour, new path) rebuilds the cached rail layer — without
      // it the extended track never re-renders.
      lineKey:
        lines.map((l) => `${l.id}:${l.color.join(",")}:${Math.round(l.totalLen)}:${l.stops.length}`).join("|") +
        "#" + (selectedLineId ?? ""),
    };
  }, [lines, graph, selectedLineId]);

  // population-presence points for the density heat (resident zones + student
  // campuses + tourist lodging), built once from the static data
  const presence = useMemo<PresencePt[]>(() => {
    const out: PresencePt[] = [];
    if (zones) for (const z of zones.zones) if (z.prod > 0) out.push({ position: [z.lon, z.lat], base: z.prod, group: 0 });
    if (pois)
      for (const p of pois.pois) {
        if (p.p === "edu") out.push({ position: [p.lon, p.lat], base: 70, group: 1 });
        else if (p.p === "leisure") out.push({ position: [p.lon, p.lat], base: 22, group: 2 });
      }
    return out;
  }, [zones, pois]);
  const hour = (((simTime / 3600) % 24) + 24) % 24;
  const hourBucket = Math.floor(hour);

  const frameRef = useRef<FrameState>({
    lineKey, lineRenders, stopRenders, vehicles, snapRef, roadSegs, drawActive, tool,
    stations, railDraft, routeDraft, deckClickAt, onSelectLine, onDemolishLine, showDensity, showAgents, presence, hour, hourBucket, zoom, selectedOD,
  });
  useEffect(() => {
    frameRef.current = {
      lineKey, lineRenders, stopRenders, vehicles, snapRef, roadSegs, drawActive, tool,
      stations, railDraft, routeDraft, deckClickAt, onSelectLine, onDemolishLine, showDensity, showAgents, presence, hour, hourBucket, zoom, selectedOD,
    };
  });

  // nearest placed station to a lng/lat within ~18 px (px→m at current zoom/lat)
  const nearestStation = (lon: number, lat: number): PlacedStation | null => {
    const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    let best: PlacedStation | null = null;
    let bd = 28 * mpp; // wider grab so extend doesn't miss the endpoint and spawn a phantom line
    for (const s of stations) {
      const d = haversine(lon, lat, s.lon, s.lat);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };

  const cursor = tool === "pan" ? "grab" : tool === "demolish" ? "pointer" : "crosshair";

  return (
    <Map
      initialViewState={{ longitude: center[0], latitude: center[1], zoom: 12.6 }}
      mapStyle={MAP.style}
      style={{ position: "absolute", inset: 0 }}
      cursor={cursor}
      dragPan={tool !== "track"}
      onMoveEnd={(e) => setZoom(e.viewState.zoom)}
      onClick={(e) => {
        if (performance.now() - deckClickAt.current < 60) return; // a deck layer (line) handled it
        const { lng, lat } = e.lngLat;
        if (tool === "station") {
          onPlaceStation(lng, lat);
        } else if (tool === "track") {
          if (pressed.current) {
            pressed.current = false; // mousedown already chained this station
            return;
          }
          const s = nearestStation(lng, lat);
          if (s) onChainStation(s.id);
        } else if (tool === "route") {
          onAddRoutePoint(lng, lat); // songthaew: add a free waypoint along the roads
        } else if (tool === "demolish") {
          const s = nearestStation(lng, lat);
          if (s) onDemolishStation(s.id);
        }
      }}
      onMouseDown={(e) => {
        if (tool !== "track") return;
        dragging.current = true;
        dragMoved.current = false;
        lastChained.current = null;
        const s = nearestStation(e.lngLat.lng, e.lngLat.lat);
        if (s) {
          onChainStation(s.id);
          lastChained.current = s.id;
          pressed.current = true;
        } else {
          pressed.current = false;
        }
      }}
      onMouseMove={(e) => {
        if (tool !== "track" || !dragging.current) return;
        const s = nearestStation(e.lngLat.lng, e.lngLat.lat);
        if (s && s.id !== lastChained.current) {
          onChainStation(s.id);
          lastChained.current = s.id;
          dragMoved.current = true;
        }
      }}
      onMouseUp={() => {
        // press-drag and click BOTH just chain stations — pressing ✓ Finish
        // commits the line. (Previously a drag auto-built+charged on mouse-up,
        // an inconsistent, easy-to-trigger-by-accident commit.)
        dragging.current = false;
      }}
    >
      <DeckLayers frameRef={frameRef} />
    </Map>
  );
}
