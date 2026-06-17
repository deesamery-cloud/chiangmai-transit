"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSim } from "@/lib/worker/useSim";
import type { LineMode, ODCorridor, PerLine, PlacedStation, TransitLine } from "@/lib/types";
import { haversine } from "@/lib/geo/graph";
import {
  DEMOGRAPHICS,
  DIFFICULTIES,
  type Difficulty,
  ECONOMY,
  GOALS,
  type GoalKind,
  LINE_COLORS,
  MAX_FLEET,
  MAX_SNAP_M,
  MODE_PARAMS,
  EVENTS,
  PEOPLE_PER_AGENT,
  ROUTE_TOOL,
  SIM,
  TOOLS,
  TRAVEL,
  type Tool,
} from "@/lib/config";
import { playSfx, setSfxMuted } from "@/lib/sfx";
import { AdvisorIntro, AdvisorDock } from "@/components/advisors/AdvisorPanels";
import { CITY_SEEDS } from "@/lib/cm-songthaew";
import { CITIES, DEFAULT_CITY } from "@/lib/cities";
import { OpeningCinematic } from "@/components/cinematic/OpeningCinematic";
import { Icon, type IconName } from "@/components/ui/Icon";

const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

const SPEEDS = [1, 10, 100, 1000]; // quick-preset chips for the speed gauge (slider covers 1–1000×)
const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
// per-line crowding 1..5 colours (match the train ramp) + a load→level helper
const CROWD_COLORS = ["#2f8f6b", "#7fa53c", "#d9a441", "#c26a2a", "#b5462e"];
const crowdOf = (utilPct: number) => (utilPct >= 90 ? 5 : utilPct >= 65 ? 4 : utilPct >= 40 ? 3 : utilPct >= 15 ? 2 : 1);
const TOOL_ICON: Record<string, IconName> = { pan: "pan", station: "station", track: "track", demolish: "demolish", route: "track" };
const modeIcon = (m: LineMode): IconName => (m === "metro" ? "metro" : "songthaew");
// big cinematic photo per goal — the RPG mode-select tiles + featured backdrop
const GOAL_PHOTO: Record<GoalKind, string> = {
  cars: "/modeselect/cars.jpg",
  money: "/modeselect/money.jpg",
  grade: "/modeselect/grade.jpg",
  free: "/modeselect/free.jpg",
};
const GOAL_ORDER: GoalKind[] = ["cars", "money", "grade", "free"];

function clock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
// daily-challenge date helpers (local time)
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dailyKey = () => keyOf(new Date());
const yesterdayKey = () => keyOf(new Date(Date.now() - 86_400_000));
const dailySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function money(v: number): string {
  if (!isFinite(v)) return "∞";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}฿${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}฿${Math.round(a / 1e3)}k`;
  return `${s}฿${Math.round(a)}`;
}

export default function Page() {
  // selected city (multi-city #6) — persisted; drives data load, map center + seeds
  const [city, setCity] = useState(DEFAULT_CITY);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cm-city");
      const c = saved && CITIES.find((x) => x.id === saved && x.ready);
      if (c) setCity(c);
    } catch {}
  }, []);
  const sim = useSim(city.dataDir);
  const { loaded, started, ready, meta, lines, playing, speed, goal } = sim;
  // human-facing "people" count — agents are a 1:K sample; scale up to city scale.
  // K is dynamic (higher on the lite tier, which runs fewer agents) so numbers match.
  const ppl = (n: number) => fmt(n * sim.peoplePerAgent);

  const [tool, setTool] = useState<Tool>("pan");
  const [routeDraft, setRouteDraft] = useState<{ lon: number; lat: number }[]>([]); // songthaew route waypoints
  const [openMenu, setOpenMenu] = useState<"speed" | "metro" | "songthaew" | null>(null); // which bottom-bar menu is expanded
  const [showAgents, setShowAgents] = useState(false); // 👣 commuter dots (walk/drive/ride = traffic) — OFF by default for a clean starting map
  const [showOD, setShowOD] = useState(false); // 🎯 travel-demand panel — OFF by default; player opens it when planning
  const [showCoverage, setShowCoverage] = useState(false); // 📐 station walk-shed coverage circles
  const [selectedOD, setSelectedOD] = useState<ODCorridor | null>(null); // a corridor highlighted on the map
  const [seed, setSeed] = useState(100000); // per-run seed (randomised on mount to avoid an SSR/client mismatch)
  const [muted, setMuted] = useState(false); // 🔊 sound on/off
  // which mode the station→connect build tools produce (metro or songthaew).
  // Songthaew can be built EITHER by drawing a route OR by placing+connecting
  // stations (the station tools are shared; this picks what a connect builds).
  const [buildMode, setBuildMode] = useState<LineMode>("metro");
  // stations the player has placed (standalone until connected with rail)
  const [stations, setStations] = useState<PlacedStation[]>([]);
  // ordered ids being connected into a line right now (rail appears on Finish)
  const [railDraft, setRailDraft] = useState<string[]>([]);
  const railDraftRef = useRef<string[]>([]);
  const setChain = (u: string[] | ((p: string[]) => string[])) => {
    setRailDraft((prev) => {
      const next = typeof u === "function" ? (u as (p: string[]) => string[])(prev) : u;
      railDraftRef.current = next;
      return next;
    });
  };
  const stationSeq = useRef(1);
  const [snapWarn, setSnapWarn] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [infoStation, setInfoStation] = useState<PlacedStation | null>(null); // station clicked to inspect its traffic
  const [colorIdx, setColorIdx] = useState(0);
  const [wonShown, setWonShown] = useState(false); // goal reached at least once
  const [showWin, setShowWin] = useState(false); // win overlay currently open
  const goalDoneRef = useRef(false); // latest goalDone, set during render (avoids a conditional hook)
  const prevScoreRef = useRef(0); // last City Score, to flash the number up/down on change (no extra hook)
  const cityScoreRef = useRef(0); // latest City Score, read by the daily-best tracker effect
  const congAvgRef = useRef<number | null>(null); // smoothed traffic (grade/goal use this, not the rush spike)
  const baselineTrafficRef = useRef<number | null>(null); // no-network traffic, for the "Win the Cars" bar
  // undo: snapshots of {stations, lines} taken before each build/demolish/remove
  const [undoStack, setUndoStack] = useState<{ stations: PlacedStation[]; lines: TransitLine[] }[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const [showCoach, setShowCoach] = useState(false); // first-run just-in-time tutorial
  const [coachAdv, setCoachAdv] = useState(3); // advanced tutorial beat (≥3) after the first line
  // advisory team ("the 4 ladies who assist"): an appointment cutscene on a fresh
  // game, then a persistent bottom-right dock — all 4 faces always visible, click
  // a face for that advisor's live advice (the team is the main advisory UI)
  const [showIntro, setShowIntro] = useState(false); // governor appointment cutscene
  const [showCinematic, setShowCinematic] = useState(false); // ~60s opening cinematic — plays ONCE per browser (skippable; enabled in mount effect)
  const [buildFlash, setBuildFlash] = useState<string | null>(null); // transient "line open" confirmation toast
  const [lang, setLang] = useState<"en" | "th">("en"); // TH/EN toggle
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  // start-screen wizard: pick goal → start-from (scratch / real songthaew) → difficulty → Start
  const [selGoal, setSelGoal] = useState<GoalKind | null>(null);
  const [focusGoal, setFocusGoal] = useState<GoalKind | null>(null); // hovered goal → featured photo/hero
  // daily challenge: today's seeded map + local best + streak (no backend)
  const [daily, setDaily] = useState<{ date: string; best: number; streak: number } | null>(null);
  const dailyRunRef = useRef(false); // is the current game today's daily run?
  const [buildSource, setBuildSource] = useState<"scratch" | "existing">("scratch");
  const seedExistingRef = useRef(false); // seed the real Chiang Mai songthaew network once ready
  // save/load: autosave the network; offer "resume" on the start screen
  const [saved, setSaved] = useState<{ goal: GoalKind; difficulty?: Difficulty; stations: PlacedStation[]; lines: TransitLine[] } | null>(null);
  const restoreRef = useRef<{ stations: PlacedStation[]; lines: TransitLine[] } | null>(null);

  useEffect(() => {
    if (ready) sim.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!sim.notice) return;
    const t = setTimeout(sim.dismissNotice, 3500);
    return () => clearTimeout(t);
  }, [sim.notice, sim.dismissNotice]);

  // auto-clear the "line open" build confirmation toast
  useEffect(() => {
    if (!buildFlash) return;
    const id = setTimeout(() => setBuildFlash(null), 3000);
    return () => clearTimeout(id);
  }, [buildFlash]);

  // pop the win overlay the first time the chosen goal is reached. Runs every
  // render and reads goalDoneRef (set below) so the hook order stays stable
  // regardless of the !started early return.
  useEffect(() => {
    if (goalDoneRef.current && !wonShown) {
      setWonShown(true);
      setShowWin(true);
      playSfx("gong");
    }
  });

  // daily challenge: keep today's best City Score (runs every render, reads refs)
  useEffect(() => {
    if (!dailyRunRef.current || !meta) return;
    const today = dailyKey();
    const score = cityScoreRef.current;
    setDaily((d) => {
      if (d && d.date === today && score <= d.best) return d;
      const next = { date: today, best: Math.max(d && d.date === today ? d.best : 0, score), streak: d?.streak ?? 1 };
      try { localStorage.setItem("cm-daily", JSON.stringify(next)); } catch {}
      return next;
    });
  });

  // show the first-line tutorial once, the first time a game starts
  useEffect(() => {
    if (started && localStorage.getItem("cm-onboarded") !== "1") setShowCoach(true);
  }, [started]);


  // smooth traffic (EMA) so the grade/goal track the network's overall effect,
  // not the rush-hour spike; capture the no-network baseline for the Cars bar
  useEffect(() => {
    if (!meta) return;
    const c = meta.congestion;
    congAvgRef.current = congAvgRef.current == null ? c : congAvgRef.current * 0.9 + c * 0.1;
    // baseline = the WORST no-network traffic (once the city is awake — at 7am
    // start the roads are empty, so capture the peak, not the warmup value)
    if (lines.length === 0)
      baselineTrafficRef.current = Math.max(baselineTrafficRef.current ?? 0, Math.round(congAvgRef.current));
  }, [meta, lines.length]);

  // load any prior save (for the start-screen "Resume" button)
  useEffect(() => {
    setSeed(Math.floor(Math.random() * 900000) + 100000); // client-only: no SSR mismatch
    try {
      const r = localStorage.getItem("cm-save-v1");
      if (r) setSaved(JSON.parse(r));
      const l = localStorage.getItem("cm-lang");
      if (l === "th" || l === "en") setLang(l);
      const dm = localStorage.getItem("cm-difficulty");
      if (dm && dm in DIFFICULTIES) setDifficulty(dm as Difficulty);
      const dly = localStorage.getItem("cm-daily");
      if (dly) setDaily(JSON.parse(dly));
      // the opening cinematic plays ONCE per browser (skippable). `cm-cine-seen` is
      // set when it finishes/skips; `cm-cine-skip` is a test/dev escape hatch.
      if (localStorage.getItem("cm-cine-skip") !== "1" && localStorage.getItem("cm-cine-seen") !== "1") {
        setShowCinematic(true);
      }
    } catch {}
  }, []);

  // autosave the network whenever it changes
  useEffect(() => {
    if (!started || !goal) return;
    try {
      localStorage.setItem("cm-save-v1", JSON.stringify({ goal, difficulty, stations, lines }));
    } catch {}
  }, [started, goal, difficulty, stations, lines]);

  // "Start from existing songthaew": once the worker is ready, lay down the
  // selected city's real songthaew/baht-bus corridors so the player improves a
  // live network (Chiang Mai red trucks, Pattaya baht buses, Hua Hin green, …).
  useEffect(() => {
    if (ready && seedExistingRef.current) {
      seedExistingRef.current = false;
      for (const corr of CITY_SEEDS[city.id] ?? []) sim.addLine(corr.points, corr.mode ?? "songthaew", corr.color);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // after a "Resume", re-apply the saved network once the worker is ready
  useEffect(() => {
    if (ready && restoreRef.current) {
      const r = restoreRef.current;
      restoreRef.current = null;
      setStations(r.stations || []);
      sim.setAllLines(r.lines || []);
      const maxId = Math.max(0, ...(r.stations || []).map((s) => parseInt(String(s.id).replace("st-", ""), 10) || 0));
      stationSeq.current = maxId + 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Ctrl/Cmd+Z = undo (calls the latest closure via a ref)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const pickTool = (t: Tool) => {
    if (t === "track" || t === "route") {
      // a new line gets the first free palette colour
      const used = new Set(lines.map((l) => l.color.join(",")));
      const free = LINE_COLORS.findIndex((c) => !used.has(c.rgb.join(",")));
      setColorIdx(free >= 0 ? free : 0);
      setSelectedLineId(null);
    }
    setChain([]);
    setRouteDraft([]);
    setSnapWarn(false);
    setInfoStation(null);
    setTool(t);
  };
  const cancelDraw = () => {
    setChain([]);
    setSnapWarn(false);
    setTool("pan");
  };
  // reset drafts/selection when opening a build menu (metro ↔ songthaew)
  const switchBuild = () => {
    setTool("pan");
    setChain([]);
    setRouteDraft([]);
    setSnapWarn(false);
    setSelectedLineId(null);
  };
  // 🛻 songthaew: add a free road waypoint, and finish the drawn route into a line
  const addRoutePoint = (lon: number, lat: number) => setRouteDraft((p) => [...p, { lon, lat }]);
  const finishRoute = () => {
    if (routeDraft.length < 2) {
      setRouteDraft([]);
      return;
    }
    pushUndo();
    const nl = sim.addLine(routeDraft, "songthaew", LINE_COLORS[colorIdx].rgb);
    setRouteDraft([]);
    // auto-select the new feeder + drop to pan so the ＋ Add songthaew strip appears.
    // Only sound the success "clack" when the route actually built.
    if (nl) {
      playSfx("clack");
      setSelectedLineId(nl.id);
      setTool("pan");
      const conns = connectsTo(nl);
      const link = conns > 0 ? t(` · 🔗 connects to ${conns} line${conns > 1 ? "s" : ""}`, ` · 🔗 เชื่อม ${conns} สาย`) : "";
      setBuildFlash(t("✓ Songthaew route open — riders boarding…", "✓ เปิดเส้นทางสองแถวแล้ว — ผู้โดยสารกำลังขึ้นรถ…") + link);
    }
  };
  const cancelRoute = () => {
    setRouteDraft([]);
    setTool("pan");
  };
  // 🚉 place a standalone station (snapped to the nearest road), no rail yet
  const placeStation = (lon: number, lat: number) => {
    const g = sim.graph;
    if (!g) return;
    const n = g.nearestNode(lon, lat);
    if (n < 0 || haversine(lon, lat, g.lon(n), g.lat(n)) > MAX_SNAP_M) {
      setSnapWarn(true);
      return;
    }
    if (stations.some((s) => s.node === n)) return; // already a station here
    setSnapWarn(false);
    const seq = stationSeq.current++;
    const slon = g.lon(n);
    const slat = g.lat(n);
    playSfx("place");
    setStations((prev) => [
      ...prev,
      { id: `st-${seq}`, lon: slon, lat: slat, node: n, name: stationName(slon, slat, seq) },
    ]);
  };
  // Bangkok-style auto-naming: the nearest notable landmark within ~1.5 km
  // (non-leisure preferred over guesthouses), else "Station N".
  const stationName = (lon: number, lat: number, seq: number): string => {
    const ps = sim.pois?.pois;
    let best = "";
    let bestScore = Infinity;
    if (ps) {
      for (const p of ps) {
        if (!p.name) continue;
        const d = haversine(lon, lat, p.lon, p.lat);
        if (d > 1500) continue;
        const score = d + (p.p === "leisure" ? 450 : 0); // prefer temples/markets/edu over guesthouses
        if (score < bestScore) {
          bestScore = score;
          best = p.name;
        }
      }
    }
    return best || t(`Station ${seq}`, `สถานี ${seq}`);
  };
  // 🛤️ add a station to the rail chain (skip if it's already the last one)
  const chainStation = (id: string) => {
    setChain((prev) => (prev[prev.length - 1] === id ? prev : [...prev, id]));
  };
  const resolve = (ids: string[], pool: PlacedStation[]) => {
    const byId = new Map(pool.map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter((s): s is PlacedStation => !!s);
  };
  // snapshot current network before a mutating action so it can be undone
  // how many EXISTING lines a new line connects to (a stop within a transfer walk)
  const connectsTo = (line: TransitLine) =>
    lines.filter((o) => o.id !== line.id && line.stops.some((s) => o.stops.some((b) => haversine(s.lon, s.lat, b.lon, b.lat) <= TRAVEL.transferMaxM))).length;
  const pushUndo = () => setUndoStack((s) => [...s.slice(-19), { stations: [...stations], lines: [...lines] }]);
  const undo = () => {
    setUndoStack((s) => {
      if (!s.length) return s;
      const snap = s[s.length - 1];
      setStations(snap.stations);
      sim.setAllLines(snap.lines);
      setSelectedLineId(null);
      setChain([]);
      return s.slice(0, -1);
    });
  };
  undoRef.current = undo;
  // Finish the chain. If it starts/ends at an EXISTING line's endpoint station,
  // EXTEND that line (keeps its colour); otherwise build a new line.
  const finishRail = () => {
    const ids = railDraftRef.current;
    if (ids.length < 2) { setChain([]); setSnapWarn(false); return; }
    pushUndo();
    const c0 = ids[0], cN = ids[ids.length - 1];
    let extended = false;
    let builtId: string | null = null;
    let newLine: TransitLine | null = null;
    for (const line of lines) {
      const sids = line.stationIds;
      if (!sids || sids.length < 2) continue;
      const first = sids[0], last = sids[sids.length - 1];
      let order: string[] | null = null;
      if (c0 === last) order = [...sids, ...ids.slice(1)];
      else if (c0 === first) order = [...ids.slice(1).reverse(), ...sids];
      else if (cN === last) order = [...sids, ...ids.slice(0, -1).reverse()];
      else if (cN === first) order = [...ids.slice(0, -1), ...sids];
      if (order) {
        const sts = resolve(order, stations);
        if (sts.length >= 2) {
          sim.replaceLineFromStations(line.id, sts, line.color, line.fleet, line.mode);
          extended = true;
          builtId = line.id;
        }
        break;
      }
    }
    if (!extended) {
      const chosen = resolve(ids, stations);
      if (chosen.length >= 2) {
        const nl = sim.addLineFromStations(chosen, buildMode, LINE_COLORS[colorIdx].rgb);
        if (nl) { builtId = nl.id; newLine = nl; }
      }
    }
    setChain([]);
    setSnapWarn(false);
    // auto-select the line you just built + drop to pan, so the bottom edit
    // strip (＋ Add train / fare / remove) appears immediately. Only sound the
    // success "clack" when a line was actually created (not on a failed build).
    if (builtId) {
      playSfx("clack");
      setSelectedLineId(builtId);
      setTool("pan");
      const conns = newLine ? connectsTo(newLine) : 0;
      const link = conns > 0 ? t(` · 🔗 connects to ${conns} line${conns > 1 ? "s" : ""}`, ` · 🔗 เชื่อม ${conns} สาย`) : "";
      setBuildFlash(extended
        ? t("✓ Line extended — new stations live", "✓ ต่อสายแล้ว — สถานีใหม่เปิดให้บริการ")
        : t("✓ Metro line open — riders boarding…", "✓ เปิดสายรถไฟฟ้าแล้ว — ผู้โดยสารกำลังขึ้นรถ…") + link);
    }
  };
  // Demolish ONE station: drop it, and re-route any line that used it through
  // the remaining stations (or remove the line if it falls below 2 stations).
  const demolishStation = (id: string) => {
    pushUndo();
    setInfoStation(null);
    const remaining = stations.filter((s) => s.id !== id);
    for (const line of lines) {
      if (!line.stationIds || !line.stationIds.includes(id)) continue;
      const keptIds = line.stationIds.filter((x) => x !== id);
      const sts = resolve(keptIds, remaining);
      if (sts.length >= 2) sim.replaceLineFromStations(line.id, sts, line.color, line.fleet, line.mode);
      else sim.removeLine(line.id);
    }
    setStations(remaining);
    setChain((prev) => prev.filter((x) => x !== id));
    if (selectedLineId && !remaining.length) setSelectedLineId(null);
  };

  const perLineById = new Map<string, PerLine>((meta?.perLine ?? []).map((p) => [p.id, p]));
  const selLine = selectedLineId ? lines.find((l) => l.id === selectedLineId) ?? null : null; // for the bottom edit strip
  const selCrowded = selLine ? (() => { const p = perLineById.get(selLine.id); return p ? p.waiting > 50 && p.util > 0.85 : false; })() : false;
  const goalDef = goal ? GOALS[goal] : null;
  const t = (en: string, th: string) => (lang === "th" ? th : en);
  const toggleLang = () =>
    setLang((l) => {
      const n = l === "en" ? "th" : "en";
      try { localStorage.setItem("cm-lang", n); } catch {}
      return n;
    });
  const gradeSayTh: Record<string, string> = {
    A: "เครือข่ายระดับโลก 🎉",
    B: "แข็งแกร่ง — เชื่อมเส้นทางให้มากขึ้น",
    C: "พอใช้ — เชื่อมความต้องการที่ยังไม่ถูกตอบ",
    D: "ยังอ่อน — สร้างตรงเส้นทางที่คนเดินทางจริง",
    F: "สร้างรถไฟฟ้าตามความต้องการเดินทางจริง",
  };
  const goalTh: Record<GoalKind, { label: string; desc: string; target: string; win: string }> = {
    cars: { label: "เอาชนะรถยนต์", desc: "ดึงคนออกจากถนน — ลดรถติดและทำให้รถไฟแน่น", target: "รถติด ≤ 35% + 25k คน/วัน", win: "คุณทวงเมืองคืนจากรถยนต์! 🚇" },
    money: { label: "เจ้าพ่อขนส่ง", desc: "เริ่มทุนน้อยแล้วสร้างเครือข่ายทำกำไรจนรวย", target: "เพิ่มเงินทุนเป็น ฿60M", win: "เจ้าพ่อขนส่ง — ฿60M แล้ว! 💰" },
    grade: { label: "เมืองเกรด A", desc: "ครอบคลุมเมืองและลดรถติดจนเป็นเครือข่ายระดับโลก", target: "คะแนนเมือง A (≥ 72)", win: "เกรด A — เครือข่ายระดับโลก! 🏆" },
    free: { label: "สร้างอิสระ", desc: "เงินไม่จำกัด ไม่มีเป้าหมาย — สร้างเครือข่ายในฝัน", target: "ไม่มีเป้าหมาย", win: "" },
  };
  // goal-card target line, reflecting the selected difficulty
  const goalTargetText = (g: GoalKind) => {
    const tg = DIFFICULTIES[difficulty].targets[g] ?? {};
    if (g === "cars")
      return t(`Traffic ≤ ${tg.trafficMax}% + ${fmt(tg.ridersMin ?? 0)} riders`, `รถติด ≤ ${tg.trafficMax}% + ${fmt(tg.ridersMin ?? 0)} คน/วัน`);
    if (g === "money") return t(`Grow the fund to ${money(tg.budgetTarget ?? 0)}`, `เพิ่มเงินทุนเป็น ${money(tg.budgetTarget ?? 0)}`);
    if (g === "grade") return t(`Reach City Score ≥ ${tg.scoreTarget}`, `คะแนนเมือง ≥ ${tg.scoreTarget}`);
    return t(GOALS[g].targetLine, goalTh[g].target);
  };

  // 🗓️ Daily Challenge — today's date seeds a fixed Grade-A / from-scratch / Medium
  // run; track local best + streak (no backend). Quick-starts (skips the cutscene).
  const startDaily = () => {
    const today = dailyKey();
    setDaily((d) => {
      let streak = 1;
      if (d) streak = d.date === today ? d.streak : d.date === yesterdayKey() ? d.streak + 1 : 1;
      const next = { date: today, best: d && d.date === today ? d.best : 0, streak };
      try { localStorage.setItem("cm-daily", JSON.stringify(next)); } catch {}
      return next;
    });
    dailyRunRef.current = true;
    seedExistingRef.current = false;
    setSelGoal("grade");
    setDifficulty("medium");
    setShowIntro(false);
    sim.startGame("grade", "medium", dailySeed());
  };

  // --- RPG-style full-screen mode/difficulty select ------------------------
  if (!started) {
    const featured = focusGoal ?? selGoal; // which goal's big photo + hero is shown
    const diffTh: Record<Difficulty, string> = { easy: "ง่าย", medium: "ปานกลาง", challenge: "ท้าทาย", hard: "ยาก" };
    const startNow = (g: GoalKind) => {
      dailyRunRef.current = false;
      seedExistingRef.current = buildSource === "existing";
      setShowIntro(true);
      sim.startGame(g, difficulty, seed);
    };
    return (
      <main className="relative h-full w-full overflow-hidden bg-black">
        {/* featured photo backdrop — crossfades as you hover / pick a goal */}
        <div className="absolute inset-0 z-0">
          {GOAL_ORDER.map((g) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={g}
              src={GOAL_PHOTO[g]}
              alt=""
              draggable={false}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              className={`cm-bg-drift absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${featured === g ? "opacity-100" : "opacity-0"}`}
            />
          ))}
          {/* default backdrop (the cinematic's dusk title) when nothing is featured */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cinematic/6.jpg" alt="" draggable={false} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${featured ? "opacity-0" : "opacity-100"}`} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(12,7,2,0.6) 0%, rgba(12,7,2,0.12) 30%, rgba(12,7,2,0.4) 58%, rgba(12,7,2,0.93) 100%)" }} />
        </div>
        <KranokCorners />

        <div className="absolute inset-0 z-10 flex flex-col">
          {/* top bar: wordmark + intro/lang */}
          <div className="flex items-start justify-between px-5 pt-5 sm:px-10 sm:pt-7">
            <div className="flex items-center gap-2.5">
              <LannaEmblem size={34} />
              <div className="wordmark text-[23px] leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] sm:text-[30px]" style={{ color: "#fff" }}>
                {t(city.name, city.nameTh)} <span style={{ color: "var(--gold)" }}>Transit</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="rpg-ghost" onClick={() => setShowCinematic(true)}>▶ {t("Intro", "ฉากเปิด")}</button>
              <button className="rpg-ghost" onClick={toggleLang}>🌐 {lang === "en" ? "EN" : "ไทย"}</button>
            </div>
          </div>

          {/* featured hero — the chosen path, big over the photo */}
          <div className="flex flex-1 items-center px-6 sm:px-12">
            {featured ? (
              <div key={featured} className="cm-fade-in max-w-[640px]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--gold-soft)] drop-shadow">{t("Your goal", "เป้าหมายของคุณ")}</div>
                <h1 className="wordmark mt-1 text-[42px] leading-[1.04] drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)] sm:text-[62px]" style={{ color: "#fff" }}>
                  {t(GOALS[featured].label, goalTh[featured].label)}
                </h1>
                <div className="num-hero mt-2 text-[15px] text-[var(--gold-soft)] drop-shadow">{goalTargetText(featured)}</div>
                <p className="mt-2 max-w-[520px] text-[14px] leading-relaxed text-white/85 drop-shadow">{t(GOALS[featured].desc, goalTh[featured].desc)}</p>
              </div>
            ) : (
              <div className="cm-fade-in max-w-[600px]">
                <h1 className="wordmark text-[34px] leading-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)] sm:text-[52px]" style={{ color: "#fff" }}>{t("Choose your path", "เลือกเส้นทางของคุณ")}</h1>
                <p className="mt-2 max-w-[540px] text-[14px] leading-relaxed text-white/80 drop-shadow">
                  {city.id === "chiangmai"
                    ? t(
                        `Chiang Mai runs on rod-daeng — its red songthaew trucks. ${fmt(SIM.agentCount * PEOPLE_PER_AGENT)} people travel the real city; most still drive. Master the songthaew, build the metro, and pull the city off the road.`,
                        `เชียงใหม่ขับเคลื่อนด้วย ‘รถแดง’ — สองแถวประจำเมือง · ผู้คน ${fmt(SIM.agentCount * PEOPLE_PER_AGENT)} คนเดินทางจริง ส่วนใหญ่ยังขับรถ · จัดการรถแดง สร้างรถไฟฟ้า แล้วดึงคนออกจากถนน`,
                      )
                    : t(
                        `${city.name} runs on songthaew — its shared baht-bus trucks. Most people still drive. Master the songthaew, build the metro, and pull the city off the road.`,
                        `${city.nameTh}ขับเคลื่อนด้วยสองแถว · ส่วนใหญ่ยังขับรถ · จัดการสองแถว สร้างรถไฟฟ้า แล้วดึงคนออกจากถนน`,
                      )}
                </p>
              </div>
            )}
          </div>

          {/* bottom control deck */}
          <div className="px-4 pb-5 sm:px-8 sm:pb-7">
            {/* 🏙️ City picker (#6) — "fix YOUR city". Ready cities selectable; the rest dimmed "soon". */}
            <div className="mb-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/55">{t("City", "เมือง")}</span>
              {CITIES.map((c) => (
                <button
                  key={c.id}
                  disabled={!c.ready || (city.id === c.id && !loaded)}
                  onClick={() => { if (c.ready && c.id !== city.id) { setCity(c); try { localStorage.setItem("cm-city", c.id); } catch {} } }}
                  className="rpg-chip shrink-0 disabled:opacity-40"
                  data-on={city.id === c.id}
                  title={c.ready ? c.name : `${c.name} — coming soon`}
                >
                  {c.nameTh}{!c.ready && <span className="ml-1 text-[9px] opacity-70">{t("soon", "เร็วๆ นี้")}</span>}
                </button>
              ))}
            </div>
            {/* 🗓️ Daily Challenge — one seeded map a day; reason to come back tomorrow.
                Kept on the default city so the (future) leaderboard stays comparable. */}
            {city.id === DEFAULT_CITY.id && (
            <button
              disabled={!loaded}
              onClick={startDaily}
              className="mb-2.5 flex w-full items-center justify-between rounded-xl border px-3.5 py-2 text-left transition-colors disabled:opacity-50"
              style={{ borderColor: "var(--gold)", background: "rgba(200,150,43,0.14)", backdropFilter: "blur(6px)" }}
            >
              <span className="flex items-center gap-2">
                <span style={{ color: "var(--gold-soft)" }}><Icon name="star" size={16} /></span>
                <span className="text-[13px] font-semibold text-white">{t("Daily Challenge", "สนามรายวัน")}</span>
                {daily && daily.date === dailyKey() && (
                  <span className="num text-[11px] text-white/70">{t("best", "ดีสุด")} {daily.best}</span>
                )}
                {daily && daily.streak > 1 && <span className="text-[11px] font-semibold text-[var(--gold-soft)]">🔥 {daily.streak}</span>}
              </span>
              <span className="rpg-chip" data-on="true">{t("Play ▶", "เล่น ▶")}</span>
            </button>
            )}

            {/* 4 big goal photo tiles */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {GOAL_ORDER.map((g) => {
                const on = selGoal === g;
                return (
                  <button
                    key={g}
                    disabled={!loaded}
                    onMouseEnter={() => setFocusGoal(g)}
                    onMouseLeave={() => setFocusGoal(null)}
                    onClick={() => { setSelGoal(g); setFocusGoal(g); }}
                    className="group relative h-24 overflow-hidden rounded-xl text-left disabled:opacity-50 sm:h-28"
                    style={{ outline: on ? "2px solid var(--gold)" : "1px solid rgba(231,200,120,0.3)", boxShadow: on ? "0 0 22px rgba(200,150,43,0.5)" : undefined }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={GOAL_PHOTO[g]} alt="" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,6,2,0.05), rgba(10,6,2,0.88))" }} />
                    <div className="absolute inset-x-0 bottom-0 p-2">
                      <div className="text-[13px] font-semibold leading-tight text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">{t(GOALS[g].label, goalTh[g].label)}</div>
                    </div>
                    {on && <div className="absolute right-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--gold)", color: "var(--accent-ink)" }}><Icon name="check" size={11} /></div>}
                  </button>
                );
              })}
            </div>

            {/* start-from · difficulty · begin */}
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-white/15 bg-black/45 p-3 backdrop-blur sm:flex-row sm:items-end">
              <div className="flex-1">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">{t("Start from", "เริ่มจาก")}</div>
                <div className="flex gap-1.5">
                  {([["scratch", t("From scratch", "สร้างใหม่"), "🆕"], ["existing", t("Existing songthaew", "สองแถวที่มีอยู่"), "🛻"]] as const).map(([id, label]) => (
                    <button key={id} className="rpg-chip flex-1" data-on={buildSource === id} onClick={() => setBuildSource(id as "scratch" | "existing")}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">{t("Difficulty", "ความยาก")}</div>
                <div className="flex gap-1.5">
                  {(Object.keys(DIFFICULTIES) as Difficulty[]).map((dk) => {
                    const dd = DIFFICULTIES[dk];
                    return (
                      <button
                        key={dk}
                        className="rpg-chip flex-1"
                        data-on={difficulty === dk}
                        onClick={() => { setDifficulty(dk); try { localStorage.setItem("cm-difficulty", dk); } catch {} }}
                        title={`${dd.label}: budget ×${dd.budgetMult}, cost ×${dd.costMult}, grade ×${dd.gradeMult}${dd.bankruptcy ? ", bankruptcy ON" : ""}${dd.deadlineDays ? `, ${dd.deadlineDays}-day deadline` : ""}`}
                      >
                        {dd.icon} {t(dd.label, diffTh[dk])}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                className="rpg-start"
                disabled={!loaded || !selGoal}
                onClick={() => { if (selGoal) startNow(selGoal); }}
              >
                {loaded ? (selGoal ? t("▶ Begin your term", "▶ เริ่มวาระ") : t("Pick a goal", "เลือกเป้าหมาย")) : t("Loading…", "กำลังโหลด…")}
              </button>
            </div>

            {saved && (saved.lines?.length || saved.stations?.length) ? (
              <button
                className="rpg-ghost mt-2.5 w-full !rounded-xl py-2 text-left"
                disabled={!loaded}
                onClick={() => {
                  seedExistingRef.current = false;
                  restoreRef.current = { stations: saved.stations || [], lines: saved.lines || [] };
                  const dm = saved.difficulty ?? "medium";
                  setDifficulty(dm);
                  sim.startGame(saved.goal, dm, seed);
                }}
              >
                ↻ <b style={{ color: "var(--gold-soft)" }}>{t("Resume last build", "เล่นต่อจากที่บันทึก")}</b>
                <span className="text-white/65"> — {saved.lines?.length ?? 0} {t("lines", "สาย")} · {t(GOALS[saved.goal]?.label ?? "goal", goalTh[saved.goal]?.label ?? "")}</span>
              </button>
            ) : null}
          </div>
        </div>

        {showCinematic && (
          <OpeningCinematic
            lang={lang}
            onDone={() => { setShowCinematic(false); try { localStorage.setItem("cm-cine-seen", "1"); } catch {} }}
          />
        )}
      </main>
    );
  }

  const net = meta ? meta.dailyRevenue - meta.dailyOpex : 0;

  // --- headline good/bad signal (works in every mode) ----------------------
  // Grade = how much of the city your metro reaches (coverage of where people
  // live) + how much you've eased traffic. Both respond the instant you finish
  // a well-placed line, so the grade jumps immediately — unlike ridership,
  // which is a rolling 24h figure that lags.
  const congestion = meta?.congestion ?? 0; // live value (shown in HUD, swings with rush)
  const congAvg = Math.round(congAvgRef.current ?? congestion); // smoothed — used by grade + goals
  const coverageFrac = (meta?.coverage ?? 0) / 100;
  const trafficReliefFrac = 1 - Math.min(1, congAvg / 100);
  // grade coverage against a ~62% "well-covered city" target (the 800 m rail
  // walk-shed reaches more, so the bar is a little higher)
  const coverageScore = Math.min(1, coverageFrac / 0.62);
  // the grade is now DOMINATED by how much of the city's real travel demand
  // (origin→destination corridors) your transit actually serves — so blanketing
  // random stations no longer earns a high grade; you must connect where people
  // actually travel. Served fraction is graded against a ~60% "great network"
  // ceiling so an A is reachable but demanding.
  const odServed = meta?.odServedFrac ?? 0;
  // DEMANDING but FAIR (brutal-panel fix): a small metro still scores F, but a
  // single well-placed line that actually serves real corridors now earns a C
  // (it used to read F even while hauling 100k+/day — the grade lied vs the sim).
  // Full demand credit needs ~42% of corridors served; an A still needs a real
  // multi-line network. Rider satisfaction (crowding + waits) still caps the grade.
  // concave curve: the FIRST well-placed line (which can only serve a slice of all
  // corridors) is rewarded into C, while an A still needs a real multi-line network.
  const odScoreFrac = Math.sqrt(Math.min(1, odServed / 0.45));
  const odUnmet = meta?.odUnmet ?? [];
  const odMet = meta?.odMet ?? [];
  const odServedPct = Math.round(odServed * 100);
  const satFrac = (meta?.satisfaction ?? 100) / 100;
  // who rides — resident / student / tourist mix (24h boardings)
  const rk = meta?.ridersByKind ?? { resident: 0, student: 0, tourist: 0 };
  const rkTot = rk.resident + rk.student + rk.tourist;
  const rkPct = (n: number) => (rkTot ? Math.round((n / rkTot) * 100) : 0);
  const baseScore = 100 * (0.68 * odScoreFrac + 0.18 * coverageScore + 0.14 * trafficReliefFrac);
  // difficulty now visibly shapes the grade climb — Easy reaches a grade with a
  // smaller network, Hard demands a denser one (playtest: difficulty felt "cosmetic")
  const gradeMult = DIFFICULTIES[difficulty].gradeMult;
  const cityScore = meta ? Math.min(100, Math.round(baseScore * (0.82 + 0.18 * satFrac) * gradeMult)) : 0;
  // direction of the latest score change → flash the number jade (up) / red (down).
  // compared during render against the previous render's value (cheap, no effect).
  const scoreDir = cityScore > prevScoreRef.current ? 1 : cityScore < prevScoreRef.current ? -1 : 0;
  prevScoreRef.current = cityScore;
  cityScoreRef.current = cityScore; // for the daily-best tracker effect (above the early return)
  const grade =
    cityScore >= 82 ? { g: "A", c: "#2f8f6b", say: "World-class network 🎉" }
    : cityScore >= 66 ? { g: "B", c: "#4f9e78", say: "Strong — serve more corridors" }
    : cityScore >= 44 ? { g: "C", c: "#c8962b", say: "Decent — link unmet demand" }
    : cityScore >= 26 ? { g: "D", c: "var(--warn)", say: "Weak — connect where people travel" }
    : { g: "F", c: "var(--danger)", say: "Build metro along real demand" };
  const gradeGoalTarget = goal === "grade" ? DIFFICULTIES[difficulty].targets.grade?.scoreTarget ?? 82 : null;
  // inline grade breakdown — turn the opaque City Score into a visible equation:
  // three weighted components + the single biggest opportunity wired to an action.
  const scoreComps = [
    { key: "demand", label: t("Demand served", "อุปสงค์ที่เสิร์ฟ"), frac: odScoreFrac, w: 68, c: "var(--ride)" },
    { key: "coverage", label: t("Coverage", "ความครอบคลุม"), frac: coverageScore, w: 18, c: "var(--accent)" },
    { key: "relief", label: t("Traffic relief", "ลดรถติด"), frac: trafficReliefFrac, w: 14, c: "var(--warn)" },
  ];
  // biggest weighted shortfall = where the next click pays off most
  const scoreOpp = scoreComps.reduce((a, b) => (b.w * (1 - b.frac) > a.w * (1 - a.frac) ? b : a));
  const scoreOppHint =
    scoreOpp.key === "demand" ? (odUnmet.length > 0 ? t(" — serve the red corridors in 🎯 Demand", " — เสิร์ฟเส้นสีแดงใน 🎯 อุปสงค์") : "")
    : scoreOpp.key === "coverage" ? t(" — extend lines into new areas", " — ขยายสายไปพื้นที่ใหม่")
    : t(" — pull cars off the busy roads", " — ดึงรถออกจากถนนที่แน่น");
  // crowding — the central pressure: full lines leave riders stuck (they give up
  // and drive). Relieve by adding trains (fleet) or a parallel line.
  const waiting = meta?.waiting ?? 0;
  const crowdedLines = (meta?.perLine ?? []).filter((p) => p.waiting > 50 && p.util > 0.85).length;
  // riders currently aboard, split by mode (metro vs songthaew) for the stats panel
  const ridingMetro = (meta?.perLine ?? []).filter((p) => p.mode === "metro").reduce((s, p) => s + p.riders, 0);
  const ridingSong = (meta?.perLine ?? []).filter((p) => p.mode === "songthaew").reduce((s, p) => s + p.riders, 0);

  // --- chosen goal: live progress 0..100 + done + a one-line metric ---------
  // win targets scale with difficulty (fall back to the goal's base target)
  const difTargets = goal ? DIFFICULTIES[difficulty].targets[goal] ?? {} : {};
  let goalPct = 0;
  let goalDone = false;
  let goalMetric = "";
  if (goalDef && meta) {
    if (goal === "cars") {
      const target = difTargets.trafficMax ?? goalDef.trafficMax ?? 35;
      const ridersMin = difTargets.ridersMin ?? goalDef.ridersMin ?? 0;
      // measure reduction from the ACTUAL captured no-network baseline (was a
      // hardcoded 70 that didn't match live traffic → bar non-zero at 0 lines).
      // Until the city wakes up and traffic exceeds the target, progress is 0.
      const base = baselineTrafficRef.current ?? congAvg;
      goalPct = base <= target ? 0 : Math.max(0, Math.min(100, ((base - congAvg) / (base - target)) * 100));
      goalDone = base > target && congAvg <= target && meta.dailyRiders >= ridersMin;
      goalMetric = `${t("Traffic", "รถติด")} ${congAvg}% → ≤${target}%  ·  ${ppl(meta.dailyRiders)}/${ppl(ridersMin)} ${t("riders", "คน")}`;
    } else if (goal === "money") {
      const target = difTargets.budgetTarget ?? goalDef.budgetTarget ?? 1;
      goalPct = Math.max(0, Math.min(100, (meta.budget / target) * 100));
      goalDone = meta.budget >= target;
      goalMetric = `${money(meta.budget)} / ${money(target)}`;
    } else if (goal === "grade") {
      const target = difTargets.scoreTarget ?? goalDef.scoreTarget ?? 78;
      goalPct = Math.max(0, Math.min(100, (cityScore / target) * 100));
      goalDone = cityScore >= target;
      goalMetric = `${t("City Score", "คะแนนเมือง")} ${cityScore} / ${target}  (${grade.g})`;
    }
  }
  // Hard difficulty: a day deadline — miss it and you lose
  const deadlineDays = goal && goal !== "free" ? DIFFICULTIES[difficulty].deadlineDays : null;
  const outOfTime = deadlineDays != null && !!meta && meta.day > deadlineDays && !goalDone && !wonShown;
  goalDoneRef.current = goalDone; // read by the win-watch effect (declared above the early return)
  // time-of-day rush indicator — so players know high traffic is the rush, not their line
  const hour = meta ? (meta.simTime / 3600) % 24 : 12;
  const isRush = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  const peakBadge = isRush
    ? t("🌅 Rush hour", "🌅 ชั่วโมงเร่งด่วน")
    : hour >= 22 || hour < 5
      ? t("🌙 Quiet", "🌙 เงียบ")
      : t("☀️ Daytime", "☀️ กลางวัน");

  return (
    <main className="relative h-full w-full isolate">
      <div className="absolute inset-0 z-0">
      <MapCanvas
        key={city.id}
        graph={sim.graph}
        lines={lines}
        vehicles={meta?.vehicles}
        snapRef={sim.snapRef}
        tool={tool}
        stations={stations}
        railDraft={railDraft}
        routeDraft={routeDraft}
        onPlaceStation={placeStation}
        onChainStation={chainStation}
        onAddRoutePoint={addRoutePoint}
        onDemolishStation={demolishStation}
        onStationInfo={(s) => setInfoStation(s)}
        onDemolishLine={(id) => {
          pushUndo();
          sim.removeLine(id);
          setSelectedLineId(null);
        }}
        selectedLineId={selectedLineId}
        onSelectLine={(id) => setSelectedLineId((cur) => (cur === id ? null : id))}
        center={city.center}
        showDensity={false}
        showAgents={showAgents}
        showCoverage={showCoverage}
        zones={sim.zones}
        pois={sim.pois}
        simTime={meta?.simTime ?? 0}
        selectedOD={selectedOD}
      />
      </div>

      {/* ── Lanna map dressing (decorative, non-interactive; sits above the map
            but below every panel so only the realistic basemap is affected) ── */}
      {/* very light sepia tint — just a whisper of warmth, keeps the real map clearly readable */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: "rgba(196,142,52,0.05)", mixBlendMode: "multiply" }}
      />
      {/* soft edge vignette + gold hairline frame (kept off the map centre) */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ boxShadow: "inset 0 0 90px 8px rgba(74,50,22,0.14)", border: "1.5px solid rgba(200,150,43,0.45)" }}
      />
      {/* four corner kranok flourishes */}
      <KranokCorners />

      {/* Title + clock + economy */}
      <div className="absolute left-2 top-2 z-20 max-h-[44vh] w-[45vw] overflow-y-auto sm:left-4 sm:top-4 sm:max-h-none sm:w-[250px] sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="panel panel-frame panel-accent px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="wordmark flex items-center gap-1.5 text-[15px] leading-[1.35]">
              <LannaEmblem size={16} /> {t(city.name, city.nameTh)} Transit
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--muted)]">
                {DIFFICULTIES[difficulty].icon}{" "}
                <span className={`opacity-70${lang === "en" ? " uppercase tracking-wide" : ""}`}>{t("goal", "เป้า")}:</span>{" "}
                {goal ? t(goalDef?.label ?? "free", goalTh[goal].label) : "free"} ·{" "}
                {t("day", "วัน")} {meta?.day ?? 0}
                {deadlineDays != null && <span style={{ color: meta && meta.day > deadlineDays - 10 ? "var(--warn)" : undefined }}>/{deadlineDays}</span>}
              </span>
              <button className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]" onClick={toggleLang} title="ภาษา / Language">
                🌐{lang === "en" ? "EN" : "ไทย"}
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-end justify-between">
            <div>
              <div className="num-hero text-lg leading-none text-[var(--muted)]">{meta ? clock(meta.simTime) : "--:--"}</div>
              {meta && <div className="mt-0.5 text-[10.5px] text-[var(--muted)]">{peakBadge}</div>}
              {meta?.activeEvent && (() => {
                const ev = EVENTS.find((e) => e.id === meta.activeEvent!.id);
                return (
                  <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-[var(--fill-2)] px-1.5 py-0.5 text-[10px] font-medium" style={{ color: "var(--warn)" }}>
                    {meta.activeEvent.icon} {ev ? t(ev.en, ev.th) : ""} · {meta.activeEvent.daysLeft}{t("d", "ว")}
                  </div>
                );
              })()}
            </div>
            <div className="text-right">
              <div className="num-hero text-lg" style={{ color: meta && meta.budget < 0 ? "var(--danger)" : "var(--accent)" }}>
                {meta ? money(meta.budget) : "…"}
              </div>
              {meta && meta.budget < 0 && (
                <div className="font-mono text-[9.5px]" style={{ color: "var(--danger)" }}>{t("debt +interest", "หนี้ +ดอกเบี้ย")}</div>
              )}
              <div className="font-mono text-[11px]" style={{ color: net >= 0 ? "var(--ride)" : "var(--warn)" }}>
                {net >= 0 ? "+" : ""}
                {money(net)}/day
              </div>
            </div>
          </div>
          {/* headline: are we winning? grade + city score + transit-vs-cars */}
          {meta && (
            <div className="mt-2.5 border-t border-[var(--line)] pt-2.5">
              <div
                className="flex items-center gap-2.5"
                title={`City Score = (68% demand served + 18% coverage + 14% traffic relief) × satisfaction\nDemand served ${Math.round(odServed * 100)}% of travel corridors (need ~42% for full credit) → ${Math.round(odScoreFrac * 100)}/100\nCoverage ${Math.round(coverageFrac * 100)}% → ${Math.round(coverageScore * 100)}/100\nTraffic relief ${Math.round(trafficReliefFrac * 100)}/100 (traffic ${congestion}%)\nRider satisfaction ${meta?.satisfaction ?? 100}% (crowding + waits cap your grade)`}
              >
                <GradeSeal grade={grade.g} color={grade.c} />
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[var(--muted)]">
                      {t("City score", "คะแนนเมือง")} ⓘ
                      {gradeGoalTarget != null && (
                        <span className="ml-1 text-[var(--accent)]">· {t("goal", "เป้า")} ≥{gradeGoalTarget}</span>
                      )}
                    </span>
                    <span className="num-hero text-xl leading-none text-[var(--text)]">
                      <span key={cityScore} className={scoreDir > 0 ? "cm-flash-up" : scoreDir < 0 ? "cm-flash-down" : "cm-tick"}>{cityScore}</span>
                      <span className="text-[11px] text-[var(--muted)]">/100</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]">
                    <div className="h-full rounded-full" style={{ width: `${cityScore}%`, background: grade.c }} />
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium" style={{ color: grade.c }}>
                    {t(grade.say, gradeSayTh[grade.g])}
                  </div>
                </div>
              </div>
              {/* the score as a visible equation — three weighted bars + biggest opportunity */}
              {lines.length > 0 && (
                <div className="mt-2 space-y-1">
                  {scoreComps.map((c) => {
                    const isOpp = c.key === scoreOpp.key;
                    return (
                      <div key={c.key} className="flex items-center gap-1.5 text-[10.5px]">
                        <span className="w-[74px] shrink-0" style={{ color: isOpp ? "var(--text)" : "var(--muted)", fontWeight: isOpp ? 600 : 400 }}>
                          {c.label}
                        </span>
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fill-2)]">
                          <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.round(c.frac * 100)}%`, background: c.c }} />
                        </span>
                        <span className="w-7 shrink-0 text-right font-mono text-[var(--muted)]">·{c.w}</span>
                      </div>
                    );
                  })}
                  <div className="text-[10.5px]" style={{ color: "var(--accent)" }}>
                    ↗ {t("Biggest gain", "เพิ่มคะแนนได้มากสุด")}: <b>{scoreOpp.label}</b>{scoreOppHint}
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--ride)" }} title="boardings over the last 24 sim-hours (rolling), at city scale">
                  <Icon name="metro" size={13} /> <span className="num">{ppl(meta.dailyRiders)}</span> {t("riders/day", "คน/วัน")} <span className="text-[var(--muted)]">(24h)</span>
                </span>
                <span
                  style={{ color: congestion >= 55 ? "var(--danger)" : "var(--warn)" }}
                  title={t(
                    "Live road traffic. It rises and falls with the time of day — it spikes at the morning & evening rush. Your grade uses a smoothed average, so a rush spike isn't your fault.",
                    "รถติดบนถนนแบบเรียลไทม์ ขึ้นลงตามเวลา — พุ่งช่วงเร่งด่วนเช้า/เย็น เกรดใช้ค่าเฉลี่ย จึงไม่นับช่วงพีคเป็นความผิดคุณ",
                  )}
                >
                  🚗 {t("Traffic", "รถติด")} {congestion}%
                </span>
              </div>
              {/* who is riding — resident / student / tourist mix */}
              {rkTot > 0 && (
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--muted)]" title={t("Share of riders by traveller type", "สัดส่วนผู้โดยสารแยกตามประเภท")}>
                  <span>{DEMOGRAPHICS.resident.icon} {rkPct(rk.resident)}%</span>
                  <span>{DEMOGRAPHICS.student.icon} {rkPct(rk.student)}%</span>
                  <span>{DEMOGRAPHICS.tourist.icon} {rkPct(rk.tourist)}%</span>
                  <span className="ml-auto text-[10px]">{t("resident · student · tourist", "คนเมือง · นักศึกษา · นักท่องเที่ยว")}</span>
                </div>
              )}
              {/* crowding + satisfaction only matter once a line is carrying riders —
                  hide their zeroed rows in the cold (no-network) state (progressive disclosure) */}
              {lines.length > 0 ? (
                <>
                  <div className="mt-1 flex items-center justify-between text-[12px]">
                    <span style={{ color: crowdedLines > 0 ? "var(--danger)" : "var(--muted)" }}>
                      <Icon name="wait" size={13} /> <span className="num">{ppl(waiting)}</span> {t("waiting", "รอ")}{crowdedLines > 0 ? ` · ${crowdedLines} ${t("crowded", "แน่น")}` : ""}
                    </span>
                    {crowdedLines > 0 && (
                      <span className="text-[11px] text-[var(--accent)]">＋ {t("add trains / a line", "เพิ่มรถ / สายใหม่")}</span>
                    )}
                  </div>
                  {/* rider satisfaction (crowding + waits) + average wait — they complain when low */}
                  <div
                    className="mt-1 flex items-center justify-between text-[12px]"
                    title={t("Riders complain when trains are packed or waits are long — it caps your grade.", "ผู้โดยสารบ่นเมื่อรถแน่นหรือรอนาน — มีผลต่อเกรด")}
                  >
                    <span style={{ color: (meta.satisfaction ?? 100) >= 70 ? "var(--ride)" : (meta.satisfaction ?? 100) >= 45 ? "var(--warn)" : "var(--danger)" }}>
                      <Icon name={(meta.satisfaction ?? 100) >= 55 ? "happy" : "unhappy"} size={14} />{" "}
                      <span className="num">{meta.satisfaction ?? 100}%</span> {t("happy", "พอใจ")}
                    </span>
                    <span className="text-[var(--muted)]">
                      ⏱ {Math.round((meta.avgWaitSec ?? 0) / 60)} {t("min wait", "นาทีรอ")}
                    </span>
                  </div>
                </>
              ) : (
                <div className="mt-1.5 text-[11px] text-[var(--accent)]">
                  ↩ {t("Place stations, then connect them to start moving the city.", "วางสถานี แล้วเชื่อมเข้าด้วยกัน เพื่อเริ่มขยับเมือง")}
                </div>
              )}
            </div>
          )}

          {/* 🎯 chosen-goal objective + progress (grade goal is shown by the City Score above — avoid a 2nd grade) */}
          {goalDef && goal !== "free" && goal !== "grade" && meta && (
            <div className="mt-2.5 rounded-lg border border-[var(--line)] bg-[var(--fill)] px-2.5 py-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold">
                  <Icon name="demand" size={13} /> {goalDef.icon} {goal ? t(goalDef.label, goalTh[goal].label) : goalDef.label}
                </span>
                <span className="font-mono text-[var(--accent)]">{Math.round(goalPct)}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${goalPct}%`, background: goalDone ? "var(--ride)" : "var(--accent)" }}
                />
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">{goalMetric}</div>
            </div>
          )}
        </div>

        {/* Your network (hidden in Zen mode) */}
        {lines.length > 0 && (
          <div className="panel mt-2 px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-[var(--muted)]">
              <span>{t("YOUR NETWORK", "เครือข่ายของคุณ")} · {lines.length}</span>
              <button
                className="hover:text-[var(--text)]"
                onClick={() => {
                  pushUndo();
                  sim.clearAll();
                  setStations([]); // also clear orphan stations (was leaking)
                  setSelectedLineId(null);
                  setChain([]);
                }}
              >
                clear all
              </button>
            </div>
            <div className="flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto">
              {lines.map((l) => {
                const pl = perLineById.get(l.id);
                const util = pl ? Math.round(pl.util * 100) : 0;
                const crowded = pl ? pl.waiting > 50 && pl.util > 0.85 : false;
                const sel = selectedLineId === l.id;
                return (
                  <div key={l.id} className={`rounded-md px-1.5 py-1 ${sel ? "bg-[var(--fill-2)]" : ""}`}>
                    <button
                      className="flex w-full items-center gap-2 text-left text-[12px]"
                      title={t("Edit this line — add vehicles, fare, recolour, remove", "แก้ไขสายนี้ — เพิ่มขบวน ค่าโดยสาร เปลี่ยนสี รื้อถอน")}
                      onClick={() => {
                        // come back and edit a line ANY time, not just right after building.
                        // the strip is only actionable in Pan (it's gated off during build
                        // tools), so "active" = selected AND already in Pan. Clicking an
                        // inactive row always selects it + drops to Pan + clears any draft,
                        // so the ＋ vehicle / fare / remove strip reliably appears (rather than
                        // toggling the still-selected-but-hidden line off).
                        const active = selectedLineId === l.id && tool === "pan";
                        if (active) {
                          setSelectedLineId(null);
                        } else {
                          setSelectedLineId(l.id);
                          setTool("pan");
                          setChain([]);
                          setRouteDraft([]);
                          setSnapWarn(false);
                        }
                      }}
                    >
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: rgb(l.color) }} />
                      <span className="w-5 shrink-0 text-center" title={MODE_PARAMS[l.mode].label} style={{ color: rgb(l.color) }}><Icon name={modeIcon(l.mode)} size={15} /></span>
                      <span className="flex-1 truncate text-[var(--muted)]">
                        {(l.totalLen / 1000).toFixed(1)} km
                      </span>
                      <span className="text-[10.5px]" style={{ color: crowded ? "var(--danger)" : "var(--muted)" }}>
                        {crowded ? "⚠" : ""}
                        {util}%
                      </span>
                    </button>
                    {/* per-line performance — crowding · waiting · riding. Click the
                        row to select; edit controls (add vehicle / fare / remove)
                        appear in the bottom bar so all build actions live together. */}
                    <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-[10px]">
                      <span
                        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-[8px] font-bold text-white"
                        style={{ background: CROWD_COLORS[crowdOf(util) - 1] }}
                        title={t(`Crowding ${crowdOf(util)}/5`, `ความแน่น ${crowdOf(util)}/5`)}
                      >
                        {crowdOf(util)}
                      </span>
                      <span style={{ color: (pl?.waiting ?? 0) > 50 ? "var(--danger)" : "var(--muted)" }}>
                        <Icon name="wait" size={11} /> <span className="num">{ppl(pl?.waiting ?? 0)}</span> {t("wait", "รอ")}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[var(--muted)]"><Icon name={modeIcon(l.mode)} size={12} />{l.fleet}</span>
                      {sel && <span className="ml-auto font-medium text-[var(--accent)]">{t("editing ↓", "แก้ไขด้านล่าง ↓")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      {(
      <div className="absolute right-2 top-2 z-20 max-h-[44vh] w-[45vw] overflow-y-auto sm:right-4 sm:top-4 sm:max-h-none sm:w-[224px] sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="panel panel-frame px-4 py-3 text-[13px]">
          <Stat label={t("Travellers", "ผู้คน")} value={meta ? ppl(meta.agentCount) : "…"} />
          <Stat label={t("Walking", "เดิน")} dot="var(--walk)" value={meta ? ppl(meta.walking) : "0"} />
          <Stat label={t("Driving", "ขับรถ")} dot="var(--warn)" value={meta ? ppl(meta.driving) : "0"} />
          <Stat label={t("Waiting", "รอ")} dot="#ffffff" value={meta ? ppl(meta.waiting) : "0"} />
          <Stat label={t("On metro", "บนรถไฟฟ้า")} dot="var(--ride)" value={meta ? ppl(ridingMetro) : "0"} />
          <Stat label={t("On songthaew", "บนสองแถว")} dot={rgb(MODE_PARAMS.songthaew.color)} value={meta ? ppl(ridingSong) : "0"} />
          <div className="my-1.5 h-px bg-[var(--fill-2)]" />
          <Stat label={t("Traffic", "รถติด")} value={meta ? `${meta.congestion}%` : "0%"} valueColor={meta && meta.congestion >= 55 ? "var(--warn)" : undefined} />
          <Stat label={t("Coverage", "ครอบคลุม")} value={meta ? `${meta.coverage}%` : "0%"} valueColor={meta && meta.coverage >= 60 ? "var(--ride)" : undefined} />
          <Stat label={t("Riders/day", "คน/วัน")} value={meta ? ppl(meta.dailyRiders) : "0"} />
          <Stat label={t("Transfers", "เปลี่ยนสาย")} value={meta ? ppl(meta.transferTrips) : "0"} />
          {/* train crowding legend (1 empty → 5 full) */}
          <div className="my-1.5 h-px bg-[var(--fill-2)]" />
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--muted)]"><Icon name="metro" size={13} /> {t("Train crowding", "ความแน่นรถไฟ")}</span>
            <span className="flex items-center gap-[3px]">
              {["#2f8f6b", "#7fa53c", "#d9a441", "#c26a2a", "#b5462e"].map((c, i) => (
                <span key={c} title={`${i + 1}/5`} className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-[8px] font-bold text-white" style={{ background: c }}>
                  {i + 1}
                </span>
              ))}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px] text-[var(--muted)]">
            <span>{t("empty", "ว่าง")}</span>
            <span>{t("full → add trains", "เต็ม → เพิ่มรถ")}</span>
          </div>
        </div>

        {/* Sparkline */}
        {sim.history.length > 4 && (
          <div className="panel mt-2 px-3 py-2.5">
            <div className="mb-1 text-[10px] text-[var(--muted)]">RIDERS/DAY</div>
            <Spark data={sim.history.map((h) => h.riders)} color="rgb(47,143,107)" />
          </div>
        )}

        {/* 🎯 Live Origin→Destination priorities — toggleable; click a corridor to map it */}
        {showOD && meta && (odUnmet.length > 0 || odMet.length > 0) && (() => {
          const odKey = (c: ODCorridor) => `${c.oName}|${c.dName}`;
          const selKey = selectedOD ? odKey(selectedOD) : null;
          const Row = (c: ODCorridor, i: number, arrowColor: string, numbered: boolean) => {
            const on = selKey === odKey(c);
            return (
              <button
                key={`${arrowColor}${i}`}
                onClick={() => setSelectedOD((cur) => (cur && odKey(cur) === odKey(c) ? null : c))}
                className={`flex w-full items-center justify-between gap-1.5 rounded px-1 py-[2px] text-left text-[10.5px] hover:bg-[var(--fill-2)] ${on ? "bg-[var(--fill-3)]" : ""}`}
                title={t(`Show ${c.oName} → ${c.dName} on the map`, `แสดง ${c.oName} → ${c.dName} บนแผนที่`)}
              >
                <span className="truncate">
                  {numbered && <span className="text-[var(--muted)]">{i + 1}. </span>}
                  {on && "📍 "}{c.oName} <span style={{ color: arrowColor }}>→</span> {c.dName}
                </span>
                <span className="shrink-0 font-mono text-[var(--muted)]">{fmt(c.demand)}</span>
              </button>
            );
          };
          // cold state (no lines yet): trim to the 5 busiest corridors as a focused
          // "start here" list, hide the served bar / met section (both meaningless at 0%)
          const coldStart = lines.length === 0;
          const unmetShown = coldStart ? odUnmet.slice(0, 5) : odUnmet;
          return (
            <div className="panel panel-accent mt-2 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold"><Icon name="demand" size={14} /> {t("Travel demand", "ความต้องการเดินทาง")}</span>
                <span className="flex items-center gap-1.5">
                  {!coldStart && (
                    <span className="font-mono text-[11px]" style={{ color: odServedPct >= 50 ? "var(--ride)" : "var(--warn)" }}>
                      {odServedPct}% {t("served", "ตอบโจทย์")}
                    </span>
                  )}
                  <button className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setShowOD(false)} title={t("Close", "ปิด")}>✕</button>
                </span>
              </div>
              {!coldStart && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${odServedPct}%`, background: "var(--ride)" }} />
                </div>
              )}
              <div className="mt-0.5 text-[9.5px] text-[var(--muted)]">{t("click a corridor to see it on the map", "คลิกเส้นทางเพื่อดูบนแผนที่")}</div>

              {/* UNMET — the priority list (people still drive these) */}
              <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--danger)" }}>
                {coldStart ? `🚗 ${t("Start here — busiest unserved", "เริ่มจากตรงนี้ — เส้นที่คนใช้มากสุด")}` : `🚗 ${t("Still driving — build here", "ยังต้องขับรถ — ควรสร้าง")}`}
                <span className="font-mono text-[var(--muted)]">{coldStart ? unmetShown.length : odUnmet.length}</span>
              </div>
              <div className="mt-1 flex max-h-[24vh] flex-col gap-px overflow-y-auto pr-0.5">
                {unmetShown.map((c, i) => Row(c, i, "var(--danger)", true))}
              </div>

              {/* MET — achievements */}
              {odMet.length > 0 && (
                <>
                  <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--ride)" }}>
                    ✓ {t("On transit — done", "ขึ้นรถไฟแล้ว — สำเร็จ")}
                    <span className="font-mono text-[var(--muted)]">{meta.odMetCount}</span>
                  </div>
                  <div className="mt-1 flex max-h-[15vh] flex-col gap-px overflow-y-auto pr-0.5">
                    {odMet.map((c, i) => Row(c, i, "var(--ride)", false))}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
      )}

      {/* Just-in-time tutorial: steps 1-2 state-driven; once a line runs, the
          player advances through OD / fares / songthaew with Next. */}
      {showCoach && (() => {
        const built = lines.length >= 1;
        const step = built ? coachAdv : stations.length >= 2 ? 2 : 1;
        const TOTAL = 6;
        const dismiss = () => {
          setShowCoach(false);
          try { localStorage.setItem("cm-onboarded", "1"); } catch {}
        };
        const next = () => (coachAdv >= TOTAL ? dismiss() : setCoachAdv((s) => s + 1));
        const b = (en: string, th: string) => <b className="text-[var(--text)]">{t(en, th)}</b>;
        const beats: Record<number, [ReactNode, ReactNode]> = {
          1: [<b key="t">{t("Place stations", "วางสถานี")}</b>, <>{t("Pick ", "เลือก ")}{b("🚉 Place stations", "🚉 วางสถานี")}{t(", then click 2+ spots on the streets.", " แล้วคลิกบนถนนอย่างน้อย 2 จุด")}</>],
          2: [<b key="t">{t("Connect stations", "เชื่อมสถานี")}</b>, <>{t("Pick ", "เลือก ")}{b("🛤️ Connect stations", "🛤️ เชื่อมสถานี")}{t(", click your stations in order, then press ", " คลิกสถานีตามลำดับ แล้วกด ")}{b("✓ Finish", "✓ เสร็จ")}.</>],
          3: [<b key="t" style={{ color: "var(--ride)" }}>{t("🎉 Your first line runs!", "🎉 เส้นทางแรกวิ่งแล้ว!")}</b>, <>{t("Watch commuters switch off the roads. Now let’s grow it.", "ดูผู้คนเปลี่ยนจากถนนมาขึ้นรถ ทีนี้มาขยายเครือข่ายกัน")}</>],
          4: [<b key="t">{t("🎯 Travel demand", "🎯 ความต้องการเดินทาง")}</b>, <>{t("Open ", "เปิด ")}{b("🎯 Demand", "🎯 อุปสงค์")}{t(" — the red “still driving” corridors are why your grade is low. Click one to see it on the map, then build toward it.", " — เส้นสีแดง “ยังขับรถ” คือเหตุผลที่เกรดต่ำ คลิกดูบนแผนที่ แล้วสร้างไปหามัน")}</>],
          5: [<b key="t">{t("💰 Fares", "💰 ค่าโดยสาร")}</b>, <>{t("Click a line in ", "คลิกสายใน ")}{b("Your Network", "เครือข่ายของคุณ")}{t(" and set its Fare — raise it to shed crowding & earn more, lower it to attract riders.", " แล้วตั้งค่าโดยสาร — ขึ้นเพื่อลดความแออัดและเพิ่มรายได้ ลดเพื่อดึงผู้โดยสาร")}</>],
          6: [<b key="t">{t("🛻 Songthaew feeders", "🛻 สองแถวสายรอง")}</b>, <>{t("Switch to ", "สลับไป ")}{b("🛻 Songthaew", "🛻 สองแถว")}{t(" and draw a cheap route feeding a metro station — last-mile coverage where a trunk isn’t worth it.", " แล้ววาดเส้นทางราคาถูกป้อนเข้าสถานีรถไฟฟ้า — เก็บระยะสุดท้ายที่ไม่คุ้มจะวางสายหลัก")}</>],
        };
        const [title, body] = beats[step] ?? beats[1];
        return (
          <div
            className="panel pointer-events-none absolute bottom-32 left-1/2 z-30 w-[460px] max-w-[92vw] -translate-x-1/2 px-4 py-3"
            style={{ borderColor: "var(--accent)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12.5px] leading-relaxed">
                <div className="text-[10px] text-[var(--muted)]">{t(`Step ${step}/6`, `ขั้นที่ ${step}/6`)}</div>
                {title}
                <div className="text-[var(--muted)]">{body}</div>
              </div>
              <button className="pointer-events-auto shrink-0 text-[11px] text-[var(--muted)] hover:text-[var(--text)]" onClick={dismiss}>
                {t("Skip", "ข้าม")} ✕
              </button>
            </div>
            {built && (
              <button className="btn btn-accent pointer-events-auto mt-2 w-full justify-center" onClick={next}>
                {coachAdv >= TOTAL ? t("Got it ✓", "เข้าใจแล้ว ✓") : t("Next →", "ถัดไป →")}
              </button>
            )}
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <span key={n} className="h-1 flex-1 rounded-full" style={{ background: n <= step ? "var(--accent)" : "var(--fill-2)" }} />
              ))}
            </div>
          </div>
        );
      })()}

      {/* Bottom-center controls — 4 primary buttons (Speed · Metro · Songthaew ·
          Pan); each opens its sub-features in a popover ABOVE the bar. People /
          Demand / Sound now live under the advisor dock (bottom-right). */}
      <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[96vw] -translate-x-1/2 flex-col items-center gap-2 sm:bottom-8">

        {/* ⏩ speed gauge (1×–1000×) */}
        {openMenu === "speed" && (
          <div className="panel flex items-center gap-3 px-4 py-2.5">
            <button className="btn" onClick={() => (playing ? sim.pause() : sim.play())} disabled={!ready} title={playing ? t("Pause", "หยุด") : t("Play", "เล่น")}>
              <Icon name={playing ? "pause" : "play"} size={14} />
            </button>
            <input
              type="range" min={1} max={1000} step={1} value={Math.min(1000, Math.max(1, speed))}
              onChange={(e) => sim.setSpeed(Number(e.target.value))}
              disabled={!ready}
              className="w-40 sm:w-56"
              style={{ accentColor: "var(--gold)" }}
              aria-label={t("Speed", "ความเร็ว")}
            />
            <span className="w-14 shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums">{speed}×</span>
            <div className="segmented">
              {SPEEDS.map((s) => (
                <button key={s} className={`seg ${speed === s ? "seg-on" : ""}`} onClick={() => sim.setSpeed(s)} disabled={!ready}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 🚆 metro tools (place stations → connect → demolish) */}
        {openMenu === "metro" && (
          <div className="panel flex flex-wrap items-center justify-center gap-1.5 px-3 py-2">
            <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: rgb(MODE_PARAMS.metro.color) }}><Icon name="metro" size={15} /> {t("Metro", "รถไฟฟ้า")}</span>
            {[TOOLS[1], TOOLS[2], TOOLS[3]].map((tl) => {
              const on = tool === tl.id;
              const locked = (tl.id === "track" && stations.length < 2) || (tl.id === "demolish" && stations.length === 0 && lines.length === 0);
              return (
                <button key={tl.id} className="btn flex items-center gap-1" onClick={() => pickTool(tl.id)} disabled={!ready || locked}
                  style={on ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
                  title={locked ? t("Place 2+ stations first (🚉)", "วางสถานีอย่างน้อย 2 จุดก่อน (🚉)") : `${t(tl.en, tl.th)} — ${tl.hint}`}>
                  <Icon name={TOOL_ICON[tl.id]} size={14} /><span className="text-[11px]">{t(tl.en, tl.th)}</span>
                </button>
              );
            })}
            <button className="btn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl/Cmd+Z)">↶</button>
          </div>
        )}

        {/* 🛻 songthaew tools — place+connect stations OR draw a free route */}
        {openMenu === "songthaew" && (
          <div className="panel flex flex-wrap items-center justify-center gap-1.5 px-3 py-2">
            <span className="mr-0.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: rgb(MODE_PARAMS.songthaew.color) }}><Icon name="songthaew" size={15} /> {t("Songthaew", "สองแถว")}</span>
            {[TOOLS[1], TOOLS[2], ROUTE_TOOL, TOOLS[3]].map((tl) => {
              const on = tool === tl.id;
              const locked = (tl.id === "track" && stations.length < 2) || (tl.id === "demolish" && stations.length === 0 && lines.length === 0);
              return (
                <button key={tl.id} className="btn flex items-center gap-1" onClick={() => pickTool(tl.id)} disabled={!ready || locked}
                  style={on ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
                  title={locked ? t("Place 2+ stations first (🚉)", "วางสถานีอย่างน้อย 2 จุดก่อน (🚉)") : `${t(tl.en, tl.th)} — ${tl.hint}`}>
                  <Icon name={TOOL_ICON[tl.id]} size={14} /><span className="text-[11px]">{t(tl.en, tl.th)}</span>
                </button>
              );
            })}
            <button className="btn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl/Cmd+Z)">↶</button>
          </div>
        )}

        {/* 🚉 place stations — click roads to drop standalone stations (no rail yet) */}
        {tool === "station" && (
          <div className="panel flex flex-col items-center gap-1 px-3 py-2">
            <span className="px-1 text-[11px]">
              {snapWarn ? (
                <span className="text-[var(--accent)]">{t("✦ Tap on a street", "✦ แตะบนถนน")}</span>
              ) : (
                <span className="text-[var(--muted)]">
                  {t(
                    `Click streets to drop stations · ${stations.length} placed — then pick 🛤️ Connect stations`,
                    `คลิกถนนเพื่อวางสถานี · ${stations.length} สถานี — แล้วเลือก 🛤️ เชื่อมสถานี`,
                  )}
                </span>
              )}
            </span>
            {/* coverage note — mode-aware: metro = wide walk-shed, songthaew = tiny local hail */}
            <span className="text-[10px] text-[var(--muted)]">
              📐 {buildMode === "metro"
                ? t(
                    `Metro stations cover a ~${MODE_PARAMS.metro.walkAccessM} m walk-shed (~10 min). Toggle 📐 Coverage (under the team) to see it.`,
                    `สถานีรถไฟฟ้าครอบคลุมรัศมีเดิน ~${MODE_PARAMS.metro.walkAccessM} ม. (~10 นาที) · เปิด 📐 ความครอบคลุม (ใต้ทีมงาน) เพื่อดู`,
                  )
                : t(
                    `Songthaew stops cover only a ~${MODE_PARAMS.songthaew.walkAccessM} m local hail — you ride it near home. Space stops close. Toggle 📐 Coverage to see it.`,
                    `จุดสองแถวครอบคลุมแค่ละแวกเล็ก ~${MODE_PARAMS.songthaew.walkAccessM} ม. (ขึ้นใกล้บ้าน) วางจุดถี่ๆ · เปิด 📐 ความครอบคลุม เพื่อดู`,
                  )}
            </span>
          </div>
        )}

        {/* 🛤️ lay track — connect placed stations into a metro line */}
        {tool === "track" && (
          <div className="panel flex flex-wrap items-center justify-center gap-2 px-3 py-2">
            <span
              className="btn"
              style={{ background: rgb(MODE_PARAMS[buildMode].color), color: buildMode === "metro" ? "var(--accent-ink)" : "#fff", borderColor: "transparent", cursor: "default" }}
              title={`${MODE_PARAMS[buildMode].label}: ${Math.round(MODE_PARAMS[buildMode].speed * 3.6)} km/h, cap ${MODE_PARAMS[buildMode].capacity}, fare ฿${MODE_PARAMS[buildMode].fare}`}
            >
              <span className="inline-flex items-center gap-1"><Icon name={modeIcon(buildMode)} size={14} /> {buildMode === "metro" ? "Metro" : "Songthaew"}</span>
            </span>
            <span className="flex items-center gap-1">
              {LINE_COLORS.map((c, i) => (
                <button
                  key={c.name}
                  title={c.name}
                  onClick={() => setColorIdx(i)}
                  className="h-4 w-4 rounded-full"
                  style={{
                    background: rgb(c.rgb),
                    outline: i === colorIdx ? "2px solid var(--ink)" : "1px solid rgba(46,33,19,.28)",
                  }}
                />
              ))}
            </span>
            <span className="px-1 text-[11px] text-[var(--muted)]">
              {stations.length < 2
                ? t("Place 2+ stations first", "วางสถานีอย่างน้อย 2 จุดก่อน")
                : t("Click stations in order to connect", "คลิกสถานีตามลำดับเพื่อเชื่อม")} · {railDraft.length}
            </span>
            <button className="btn" onClick={() => setChain((c) => c.slice(0, -1))} disabled={!railDraft.length}>
              ↶ Undo
            </button>
            <button className="btn btn-accent" onClick={finishRail} disabled={railDraft.length < 2}>
              ✓ Finish
            </button>
            <button className="btn" onClick={cancelDraw}>
              Cancel
            </button>
          </div>
        )}

        {tool === "demolish" && (
          <div className="panel px-3 py-2"><span className="text-[11px] text-[var(--muted)]">{t("Click a station (line re-routes) or a line/route to remove it", "คลิกสถานี (สายจะปรับเส้นทาง) หรือคลิกสาย/เส้นทางเพื่อรื้อถอน")}</span></div>
        )}

        {/* 🛻 draw a songthaew route — click waypoints along the roads, then Finish */}
        {tool === "route" && (
          <div className="panel flex flex-wrap items-center justify-center gap-2 px-3 py-2">
            <span
              className="btn"
              style={{ background: rgb(MODE_PARAMS.songthaew.color), color: "#fff", borderColor: "transparent", cursor: "default" }}
              title={`Songthaew: from ฿${(ECONOMY.songthaew.build / 1e3).toFixed(0)}k, ${Math.round(MODE_PARAMS.songthaew.speed * 3.6)} km/h, cap ${MODE_PARAMS.songthaew.capacity}, fare ฿${MODE_PARAMS.songthaew.fare} · road-bound feeder`}
            >
              <span className="inline-flex items-center gap-1"><Icon name="songthaew" size={14} /> Songthaew</span>
            </span>
            <span className="flex items-center gap-1">
              {LINE_COLORS.map((c, i) => (
                <button
                  key={c.name}
                  title={c.name}
                  onClick={() => setColorIdx(i)}
                  className="h-4 w-4 rounded-full"
                  style={{ background: rgb(c.rgb), outline: i === colorIdx ? "2px solid var(--ink)" : "1px solid rgba(46,33,19,.28)" }}
                />
              ))}
            </span>
            <span className="px-1 text-[11px] text-[var(--muted)]">
              {t("click road points · then Finish", "คลิกจุดบนถนน · แล้วกด Finish")} · {routeDraft.length}
            </span>
            <button className="btn" onClick={() => setRouteDraft((p) => p.slice(0, -1))} disabled={!routeDraft.length}>
              ↶ Undo
            </button>
            <button className="btn btn-accent" onClick={finishRoute} disabled={routeDraft.length < 2}>
              ✓ Finish
            </button>
            <button className="btn" onClick={cancelRoute}>
              Cancel
            </button>
          </div>
        )}

        {/* ▶ selected-line edit strip — click a line, then add vehicles / set fare / recolor / remove */}
        {selLine && tool !== "track" && tool !== "route" && tool !== "station" && (
          <div className="panel flex flex-wrap items-center justify-center gap-2 px-3 py-2">
            <span
              className="inline-flex h-3 w-3 shrink-0 rounded-full"
              style={{ background: rgb(selLine.color) }}
              title={MODE_PARAMS[selLine.mode].label}
            />
            {/* PROMINENT add-vehicle — same visual weight as 🚉 วางสถานี / 🛤️ วางราง */}
            <button
              className={`btn btn-accent flex items-center gap-1.5${selCrowded && selLine.fleet < MAX_FLEET ? " cm-glow-pulse" : ""}`}
              style={{
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 700,
              }}
              onClick={() => sim.setFleet(selLine.id, selLine.fleet + 1)}
              disabled={selLine.fleet >= MAX_FLEET}
              title={t("Add a vehicle to this line", "เพิ่มคันรถในสายนี้")}
            >
              <Icon name={modeIcon(selLine.mode)} size={17} />
              ＋ {t(selLine.mode === "metro" ? "Add train" : "Add songthaew", selLine.mode === "metro" ? "เพิ่มขบวน" : "เพิ่มสองแถว")}
            </button>
            <span className="font-mono text-[12px] text-[var(--muted)]" title={t(`${selLine.fleet}/${MAX_FLEET} vehicles`, `${selLine.fleet}/${MAX_FLEET} คัน`)}>
              {selLine.fleet}/{MAX_FLEET}
            </span>
            <button className="btn" onClick={() => sim.setFleet(selLine.id, selLine.fleet - 1)} disabled={selLine.fleet <= 1} title={t("Remove a vehicle", "ลดคันรถ")}>−</button>
            {/* fare */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-[var(--muted)]">{t("Fare", "ค่าโดยสาร")}</span>
              <button className="btn" onClick={() => sim.setFare(selLine.id, selLine.fare - 5)} disabled={selLine.fare <= 5}>−</button>
              <span className="w-9 text-center font-mono text-[11px]">฿{selLine.fare}</span>
              <button className="btn" onClick={() => sim.setFare(selLine.id, selLine.fare + 5)} disabled={selLine.fare >= 100}>+</button>
            </div>
            {/* recolor */}
            <span className="flex items-center gap-1">
              {LINE_COLORS.map((c) => (
                <button
                  key={c.name}
                  title={c.name}
                  onClick={() => sim.setLineColor(selLine.id, c.rgb)}
                  className="h-4 w-4 rounded-full"
                  style={{ background: rgb(c.rgb), outline: selLine.color.join(",") === c.rgb.join(",") ? "2px solid var(--ink)" : "1px solid rgba(46,33,19,.28)" }}
                />
              ))}
            </span>
            <button
              className="btn"
              onClick={() => { pushUndo(); sim.removeLine(selLine.id); setSelectedLineId(null); }}
              title={t("Remove this line", "รื้อถอนสายนี้")}
            >
<Icon name="demolish" size={14} /> {t("Remove", "รื้อถอน")}
            </button>
            <button className="btn" onClick={() => setSelectedLineId(null)} title={t("Close", "ปิด")}>✕</button>
          </div>
        )}

        {/* ── the 4 primary buttons ───────────────────────────────────────── */}
        <div className="panel panel-frame flex flex-nowrap items-center gap-2 overflow-x-auto px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            className="btn flex items-center gap-1.5"
            onClick={() => setOpenMenu((m) => (m === "speed" ? null : "speed"))}
            disabled={!ready}
            style={openMenu === "speed" ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
            title={t("Speed — set how fast time runs (1×–1000×)", "ความเร็ว — ปรับความเร็วเวลา (1×–1000×)")}
          >
            <Icon name="speed" size={15} /> <span className="text-[12px]">{t("Speed", "ความเร็ว")}</span>
            <span className="num text-[11px] opacity-80">{speed}×</span>
          </button>
          <button
            className="btn flex items-center gap-1.5"
            onClick={() => { switchBuild(); setBuildMode("metro"); setOpenMenu((m) => (m === "metro" ? null : "metro")); }}
            disabled={!ready}
            style={openMenu === "metro" ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
            title={t("Metro — fast, traffic-immune trunk lines", "รถไฟฟ้า — สายหลักเร็ว ไม่ติดรถ")}
          >
            <Icon name="metro" size={16} /> <span className="text-[12px]">{t("Metro", "รถไฟฟ้า")}</span>
          </button>
          <button
            className="btn flex items-center gap-1.5"
            onClick={() => { switchBuild(); setBuildMode("songthaew"); setOpenMenu((m) => (m === "songthaew" ? null : "songthaew")); }}
            disabled={!ready}
            style={openMenu === "songthaew" ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
            title={t("Songthaew — cheap road-bound feeders", "สองแถว — สายรองราคาถูก วิ่งบนถนน")}
          >
            <Icon name="songthaew" size={16} /> <span className="text-[12px]">{t("Songthaew", "สองแถว")}</span>
          </button>
          <button
            className="btn flex items-center gap-1.5"
            onClick={() => { pickTool("pan"); setOpenMenu(null); }}
            disabled={!ready}
            style={tool === "pan" && !openMenu ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
            title={t("Move the map around", "เลื่อนแผนที่ไปมา")}
          >
            <Icon name="pan" size={16} /> <span className="text-[12px]">{t("Pan", "เลื่อนแผนที่")}</span>
          </button>
        </div>
      </div>

      {/* News ticker */}
      {sim.ticker.length > 0 && (
        <div className="panel absolute bottom-3 left-1/2 z-20 max-w-[80vw] -translate-x-1/2 truncate px-3 py-1 text-[12px] text-[var(--text)]">
          📣 {sim.ticker[0]}
        </div>
      )}

      {/* Notice toast */}
      {sim.notice && (
        <div className="panel absolute left-1/2 top-20 z-30 -translate-x-1/2 px-4 py-2 text-[12px]" style={{ borderColor: "var(--accent)" }}>
          {sim.notice}
        </div>
      )}

      {/* ✓ build-success confirmation toast — tells you the line actually launched */}
      {buildFlash && (
        <div
          className="panel cm-pop-in absolute left-1/2 top-32 z-30 -translate-x-1/2 px-4 py-2 text-[12.5px] font-semibold"
          style={{ borderColor: "var(--ride)", color: "var(--ride)" }}
        >
          {buildFlash}
        </div>
      )}

      {/* 🚉 station inspector — click a station (in Pan) to see its traffic */}
      {infoStation && (() => {
        const st = meta?.stopStats?.[infoStation.node];
        const serving = lines.filter((l) => l.stops.some((s) => s.node === infoStation.node));
        return (
          <div className="panel panel-frame panel-accent cm-pop-in absolute left-1/2 top-24 z-30 w-[260px] max-w-[88vw] -translate-x-1/2 px-4 py-3 text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 font-semibold leading-tight">
                <span style={{ color: "var(--gold-deep)" }}><Icon name="station" size={16} /></span>
                <span className="line-clamp-2">{infoStation.name || t("Station", "สถานี")}</span>
              </div>
              <button className="shrink-0 text-[12px] text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setInfoStation(null)}>✕</button>
            </div>
            {/* which lines call here */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {serving.length ? serving.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px]" style={{ background: "var(--fill-2)", color: rgb(l.color) }}>
                  <Icon name={modeIcon(l.mode)} size={12} /> {MODE_PARAMS[l.mode].label}
                </span>
              )) : <span className="text-[11px] text-[var(--muted)]">{t("Not connected yet — connect it with a line", "ยังไม่ได้เชื่อม — ต่อสายเข้าสถานีนี้")}</span>}
              {serving.length > 1 && <span className="text-[10px] font-medium text-[var(--gold-deep)]">{t("· interchange", "· จุดเปลี่ยนสาย")}</span>}
            </div>
            <div className="gold-rule my-2.5" />
            <div className="flex flex-col gap-0.5">
              <Stat label={t("Boarded here (total)", "ขึ้นรถที่นี่ (รวม)")} dot="var(--ride)" value={st ? ppl(st.board) : "0"} />
              <Stat label={t("Alighted here (total)", "ลงรถที่นี่ (รวม)")} dot="var(--jade)" value={st ? ppl(st.alight) : "0"} />
              <Stat label={t("Waiting now", "กำลังรอตอนนี้")} dot="#ffffff" value={st ? ppl(st.wait) : "0"} valueColor={st && st.wait > 50 ? "var(--danger)" : undefined} />
              <Stat label={t("Passed through", "ผ่านเลย (ไม่ลง)")} dot="var(--muted)" value={st ? ppl(st.pass) : "0"} />
            </div>
            <div className="mt-2 text-[10px] text-[var(--muted)]">{t("Tip: more boardings = a well-placed station.", "เคล็ดลับ: ขึ้นรถเยอะ = วางสถานีได้ดี")}</div>
          </div>
        );
      })()}

      {/* Bankruptcy banner */}
      {meta?.bankrupt && (
        <div className="panel absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 px-6 py-4 text-center" style={{ borderColor: "var(--danger)" }}>
          <div className="text-base font-semibold text-[var(--danger)]">Bankrupt</div>
          <div className="mt-1 text-[12px] text-[var(--muted)]">Your budget ran dry. Remove costly lines or restart.</div>
        </div>
      )}

      {/* ⏰ Hard-mode deadline missed */}
      {outOfTime && (
        <div className="panel absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 px-6 py-4 text-center" style={{ borderColor: "var(--warn)" }}>
          <div className="text-base font-semibold" style={{ color: "var(--warn)" }}>
            ⏰ {t("Out of time", "หมดเวลา")}
          </div>
          <div className="mt-1 text-[12px] text-[var(--muted)]">
            {t(
              `Day ${meta?.day} — you didn't hit the goal by day ${deadlineDays}.`,
              `วันที่ ${meta?.day} — ยังไม่ถึงเป้าหมายภายในวันที่ ${deadlineDays}`,
            )}
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <button className="btn btn-accent" onClick={() => window.location.reload()}>
              {t("Try again", "ลองใหม่")}
            </button>
            <button className="btn" onClick={() => setWonShown(true)}>
              {t("Keep building", "สร้างต่อ")}
            </button>
          </div>
        </div>
      )}

      {/* 🏛️ governor appointment cutscene — your team of 4 advisors */}
      {showIntro && (
        <AdvisorIntro
          lang={lang}
          goalLabel={goal ? t(goalDef?.label ?? "Free Build", goalTh[goal].label) : undefined}
          cityName={city.name}
          cityNameTh={city.nameTh}
          onDone={() => setShowIntro(false)}
        />
      )}

      {/* 👥 persistent advisor dock (bottom-right) — the main advisory UI: all 4
          faces always visible; click a face for that advisor's live advice.
          People / Demand / Sound toggles are parked under the team. */}
      <AdvisorDock
        lang={lang}
        meta={meta}
        lines={lines}
        flashDay={meta?.day}
        showAgents={showAgents}
        onToggleAgents={() => setShowAgents((v) => !v)}
        showOD={showOD}
        onToggleOD={() => setShowOD((v) => !v)}
        showCoverage={showCoverage}
        onToggleCoverage={() => setShowCoverage((v) => !v)}
        muted={muted}
        onToggleMuted={() => setMuted((m) => { const n = !m; setSfxMuted(n); return n; })}
      />

      {/* 🏆 win overlay */}
      {showWin && goalDef && (
        <div className="cm-fade-in absolute inset-0 z-40 flex items-center justify-center bg-[rgba(42,28,14,0.5)]">
          <div className="panel cm-pop-in px-8 py-6 text-center" style={{ borderColor: "var(--ride)" }}>
            <div style={{ color: "var(--gold)" }}><Icon name="trophy" size={46} /></div>
            <div className="mt-2 text-lg font-semibold" style={{ color: "var(--ride)" }}>
              {goal ? t(goalDef.winTitle, goalTh[goal].win) : goalDef.winTitle}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              {t(
                `Reached in ${meta?.day ?? 0} days · ${fmt(meta?.dailyRiders ?? 0)} riders/day · grade ${grade.g}`,
                `สำเร็จใน ${meta?.day ?? 0} วัน · ${fmt(meta?.dailyRiders ?? 0)} คน/วัน · เกรด ${grade.g}`,
              )}
            </div>
            <div className="mt-3 tracking-widest text-[var(--accent)]">★ ★ ★</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn btn-accent" onClick={() => setShowWin(false)}>
                {t("Keep playing", "เล่นต่อ")}
              </button>
              <button
                className="btn"
                title={t("Back to the goal menu — your build is autosaved, Resume it anytime", "กลับไปเมนูเป้าหมาย — งานถูกบันทึกอัตโนมัติ กลับมาเล่นต่อได้")}
                onClick={() => window.location.reload()}
              >
                {t("New goal", "เป้าหมายใหม่")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Four gold "kranok" (Lanna flame) flourishes, one per map corner. Purely
// decorative; sits under the panels so the top corners tuck behind the HUD.
function KranokCorners() {
  const flame = (
    <svg width="60" height="60" viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M6 6 C 34 8, 46 20, 46 46 C 46 30, 56 22, 59 21" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 6 C 8 34, 20 46, 46 46" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 15 C 25 17, 31 23, 32 33" stroke="var(--gold)" strokeWidth="1.3" strokeLinecap="round" opacity="0.85" />
      <circle cx="46" cy="46" r="2.3" fill="var(--gold)" />
    </svg>
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10" style={{ opacity: 0.72 }}>
      <div className="absolute left-1.5 top-1.5">{flame}</div>
      <div className="absolute right-1.5 top-1.5" style={{ transform: "scaleX(-1)" }}>{flame}</div>
      <div className="absolute bottom-1.5 left-1.5" style={{ transform: "scaleY(-1)" }}>{flame}</div>
      <div className="absolute bottom-1.5 right-1.5" style={{ transform: "scale(-1,-1)" }}>{flame}</div>
    </div>
  );
}

// Lanna-style gold emblem — a diamond lattice + leaf motif inside a roundel.
// Reads as both a temple ornament and a transit roundel.
function LannaEmblem({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
      <circle cx="16" cy="16" r="14.6" stroke="var(--gold)" strokeWidth="1.5" />
      <path d="M16 4.2 L27.8 16 L16 27.8 L4.2 16 Z" stroke="var(--gold-deep)" strokeWidth="1.1" />
      <path d="M16 8.5 q4.4 7.5 0 15 q-4.4 -7.5 0 -15z" fill="var(--gold)" opacity="0.9" />
      <circle cx="16" cy="16" r="2.1" fill="var(--paper)" />
    </svg>
  );
}

// City Score as a gold "seal" medallion (the headline metric deserves ceremony,
// not a flat dashboard chip). Grade letter set in the Trirong display face.
function GradeSeal({ grade, color }: { grade: string; color: string }) {
  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      <svg width="56" height="56" viewBox="0 0 56 56" className="absolute inset-0" aria-hidden>
        <circle cx="28" cy="28" r="26" fill="var(--paper)" stroke="var(--gold)" strokeWidth="2" />
        <circle cx="28" cy="28" r="22.5" fill="none" stroke="var(--gold-soft)" strokeWidth="1" />
        <path d="M28 6.5 L49.5 28 L28 49.5 L6.5 28 Z" fill="none" stroke="var(--gold-deep)" strokeWidth="0.8" opacity="0.45" />
      </svg>
      <span className="wordmark relative text-[27px] leading-none" style={{ color }}>{grade}</span>
    </div>
  );
}

function Stat({ label, value, dot, valueColor }: { label: string; value: string; dot?: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="flex items-center gap-1.5 text-[var(--muted)]">
        {dot && (
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: dot, boxShadow: dot === "#ffffff" ? "0 0 0 1px rgba(0,0,0,.4)" : undefined }} />
        )}
        {label}
      </span>
      <span className="font-mono tabular-nums" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 180;
  const h = 34;
  const max = Math.max(1, ...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
