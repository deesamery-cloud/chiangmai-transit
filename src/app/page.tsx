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
  type Tool,
} from "@/lib/config";
import { playSfx, setSfxMuted } from "@/lib/sfx";

const MapCanvas = dynamic(() => import("@/components/map/MapCanvas"), { ssr: false });

const CENTER: [number, number] = [98.984, 18.79];
const SPEEDS = [1, 60, 300, 1200];
const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
// per-line crowding 1..5 colours (match the train ramp) + a load→level helper
const CROWD_COLORS = ["#2f8f6b", "#7fa53c", "#d9a441", "#c26a2a", "#b5462e"];
const crowdOf = (utilPct: number) => (utilPct >= 90 ? 5 : utilPct >= 65 ? 4 : utilPct >= 40 ? 3 : utilPct >= 15 ? 2 : 1);

function clock(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
// human-facing "people" count: the agents are a 1:K sample of the real travel
// market, so multiply visible flow numbers up to city scale (economy stays sim).
const ppl = (n: number) => fmt(n * PEOPLE_PER_AGENT);
function money(v: number): string {
  if (!isFinite(v)) return "∞";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}฿${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}฿${Math.round(a / 1e3)}k`;
  return `${s}฿${Math.round(a)}`;
}

export default function Page() {
  const sim = useSim();
  const { loaded, started, ready, meta, lines, playing, speed, goal } = sim;

  const [tool, setTool] = useState<Tool>("pan");
  const [buildMode, setBuildMode] = useState<"metro" | "songthaew">("metro"); // which mode the build tools build
  const [routeDraft, setRouteDraft] = useState<{ lon: number; lat: number }[]>([]); // songthaew route waypoints
  const [showDensity, setShowDensity] = useState(false); // 🔥 population-density heat overlay
  const [showAgents, setShowAgents] = useState(true); // 👣 commuter dots (walk/drive/ride) overlay
  const [showOD, setShowOD] = useState(true); // 🎯 travel-demand panel open/closed
  const [selectedOD, setSelectedOD] = useState<ODCorridor | null>(null); // a corridor highlighted on the map
  const [seed, setSeed] = useState(100000); // per-run seed (randomised on mount to avoid an SSR/client mismatch)
  const [zen, setZen] = useState(false); // minimal HUD: map + grade + palette only
  const [muted, setMuted] = useState(false); // 🔊 sound on/off
  const mode: LineMode = "metro"; // metro-only game
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
  const [colorIdx, setColorIdx] = useState(0);
  const [wonShown, setWonShown] = useState(false); // goal reached at least once
  const [showWin, setShowWin] = useState(false); // win overlay currently open
  const goalDoneRef = useRef(false); // latest goalDone, set during render (avoids a conditional hook)
  const congAvgRef = useRef<number | null>(null); // smoothed traffic (grade/goal use this, not the rush spike)
  const baselineTrafficRef = useRef<number | null>(null); // no-network traffic, for the "Win the Cars" bar
  // undo: snapshots of {stations, lines} taken before each build/demolish/remove
  const [undoStack, setUndoStack] = useState<{ stations: PlacedStation[]; lines: TransitLine[] }[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const [showCoach, setShowCoach] = useState(false); // first-run just-in-time tutorial
  const [coachAdv, setCoachAdv] = useState(3); // advanced tutorial beat (≥3) after the first line
  const [lang, setLang] = useState<"en" | "th">("en"); // TH/EN toggle
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
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
    } catch {}
  }, []);

  // autosave the network whenever it changes
  useEffect(() => {
    if (!started || !goal) return;
    try {
      localStorage.setItem("cm-save-v1", JSON.stringify({ goal, difficulty, stations, lines }));
    } catch {}
  }, [started, goal, difficulty, stations, lines]);

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
    setTool(t);
  };
  const cancelDraw = () => {
    setChain([]);
    setSnapWarn(false);
    setTool("pan");
  };
  // switch which mode the build tools build (metro ↔ songthaew); reset drafts
  const switchBuild = (m: "metro" | "songthaew") => {
    setBuildMode(m);
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
    sim.addLine(routeDraft, "songthaew", LINE_COLORS[colorIdx].rgb);
    playSfx("clack");
    setRouteDraft([]);
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
          sim.replaceLineFromStations(line.id, sts, line.color, line.fleet);
          extended = true;
        }
        break;
      }
    }
    if (!extended) {
      const chosen = resolve(ids, stations);
      if (chosen.length >= 2) sim.addLineFromStations(chosen, mode, LINE_COLORS[colorIdx].rgb);
    }
    playSfx("clack");
    setChain([]);
    setSnapWarn(false);
  };
  // Demolish ONE station: drop it, and re-route any line that used it through
  // the remaining stations (or remove the line if it falls below 2 stations).
  const demolishStation = (id: string) => {
    pushUndo();
    const remaining = stations.filter((s) => s.id !== id);
    for (const line of lines) {
      if (!line.stationIds || !line.stationIds.includes(id)) continue;
      const keptIds = line.stationIds.filter((x) => x !== id);
      const sts = resolve(keptIds, remaining);
      if (sts.length >= 2) sim.replaceLineFromStations(line.id, sts, line.color, line.fleet);
      else sim.removeLine(line.id);
    }
    setStations(remaining);
    setChain((prev) => prev.filter((x) => x !== id));
    if (selectedLineId && !remaining.length) setSelectedLineId(null);
  };

  const perLineById = new Map<string, PerLine>((meta?.perLine ?? []).map((p) => [p.id, p]));
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

  // --- mode-select screen --------------------------------------------------
  if (!started) {
    return (
      <main className="relative h-full w-full">
        <div className="absolute inset-0 flex items-center justify-center lanna-bg">
          <div className="panel panel-accent relative max-w-[560px] px-7 py-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <LannaEmblem size={34} />
                <div>
                  <div className="wordmark text-[25px] leading-none">
                    เชียงใหม่ <span style={{ color: "var(--gold-deep)" }}>Transit</span>
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                    Chiang Mai · ผังเมืองรถไฟฟ้า
                  </div>
                </div>
              </div>
              <button className="btn px-2 py-1 text-[11px]" onClick={toggleLang} title="ภาษา / Language">
                🌐 {lang === "en" ? "EN" : "ไทย"}
              </button>
            </div>
            <div className="gold-rule my-3.5" />
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              {t(
                `${fmt(SIM.agentCount * PEOPLE_PER_AGENT)} people move around the real city; longer trips they drive (jamming roads). Build transit that beats driving.`,
                `ผู้คน ${fmt(SIM.agentCount * PEOPLE_PER_AGENT)} คนเดินทางในเมืองจริง การเดินทางไกลพวกเขาขับรถ (ทำให้รถติด) สร้างขนส่งที่ดีกว่าการขับรถ`,
              )}{" "}
              <b className="text-[var(--text)]">{t("Choose your goal:", "เลือกเป้าหมายของคุณ:")}</b>
            </p>

            {/* difficulty selector (Free Build ignores it) */}
            <div className="mt-3">
              <div className="mb-1 text-[11px] text-[var(--muted)]">{t("Difficulty", "ระดับความยาก")}</div>
              <div className="flex gap-1.5">
                {(Object.keys(DIFFICULTIES) as Difficulty[]).map((dk) => {
                  const dd = DIFFICULTIES[dk];
                  const on = difficulty === dk;
                  return (
                    <button
                      key={dk}
                      className="btn flex-1 justify-center text-[12px]"
                      onClick={() => {
                        setDifficulty(dk);
                        try { localStorage.setItem("cm-difficulty", dk); } catch {}
                      }}
                      style={on ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
                      title={`${dd.label}: budget ×${dd.budgetMult}, cost ×${dd.costMult}, opex ×${dd.opexMult}, fare ×${dd.fareMult}${dd.bankruptcy ? ", bankruptcy ON" : ""}${dd.deadlineDays ? `, ${dd.deadlineDays}-day deadline` : ""}`}
                    >
                      {dd.icon} {t(dd.label, { easy: "ง่าย", medium: "ปานกลาง", challenge: "ท้าทาย", hard: "ยาก" }[dk])}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* per-run seed — different hot corridors + events each seed */}
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <span className="text-[var(--muted)]">{t("Seed", "ซีด")}</span>
              <span className="rounded bg-[var(--fill-2)] px-2 py-0.5 font-mono text-[var(--text)]">{seed}</span>
              <button
                className="btn px-2 py-0.5 text-[11px]"
                onClick={() => setSeed(Math.floor(Math.random() * 900000) + 100000)}
                title={t("New seed — a different city build each run", "ซีดใหม่ — เมืองต่างออกไปทุกครั้ง")}
              >
                🎲 {t("re-roll", "สุ่มใหม่")}
              </button>
              <span className="text-[10px] text-[var(--muted)]">{t("varies demand + events", "เปลี่ยนความต้องการ + เหตุการณ์")}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(Object.keys(GOALS) as GoalKind[]).map((g) => {
                const m = GOALS[g];
                return (
                  <button
                    key={g}
                    className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--fill)] px-3 py-3 text-left transition-colors hover:border-[var(--gold)] hover:bg-[var(--paper)] disabled:opacity-50"
                    onClick={() => sim.startGame(g, difficulty, seed)}
                    disabled={!loaded}
                  >
                    <span className="text-[13px] font-semibold">
                      {m.icon} {t(m.label, goalTh[g].label)}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-[var(--gold-deep)]">{goalTargetText(g)}</span>
                    <span className="text-[10.5px] leading-snug text-[var(--muted)]">{t(m.desc, goalTh[g].desc)}</span>
                  </button>
                );
              })}
            </div>
            {saved && (saved.lines?.length || saved.stations?.length) ? (
              <button
                className="mt-2 w-full rounded-xl border border-[var(--gold)] bg-[var(--fill)] px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--paper)] disabled:opacity-50"
                onClick={() => {
                  restoreRef.current = { stations: saved.stations || [], lines: saved.lines || [] };
                  const dm = saved.difficulty ?? "medium";
                  setDifficulty(dm);
                  sim.startGame(saved.goal, dm, seed);
                }}
                disabled={!loaded}
              >
                ↻ <b>{t("Resume last build", "เล่นต่อจากที่บันทึก")}</b>{" "}
                <span className="text-[var(--muted)]">
                  — {saved.lines?.length ?? 0} {t("lines", "สาย")}, {saved.stations?.length ?? 0}{" "}
                  {t("stations", "สถานี")} · {t(GOALS[saved.goal]?.label ?? "goal", goalTh[saved.goal]?.label ?? "")}
                </span>
              </button>
            ) : null}
            <div className="mt-3 text-center text-[11px] text-[var(--muted)]">
              {loaded
                ? t("Pick a goal to begin.", "เลือกเป้าหมายเพื่อเริ่ม")
                : t("Loading Chiang Mai street network…", "กำลังโหลดแผนที่เชียงใหม่…")}
            </div>
          </div>
        </div>
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
  const cityScore = meta ? Math.round(baseScore * (0.82 + 0.18 * satFrac)) : 0;
  const grade =
    cityScore >= 82 ? { g: "A", c: "#2f8f6b", say: "World-class network 🎉" }
    : cityScore >= 66 ? { g: "B", c: "#4f9e78", say: "Strong — serve more corridors" }
    : cityScore >= 44 ? { g: "C", c: "#c8962b", say: "Decent — link unmet demand" }
    : cityScore >= 26 ? { g: "D", c: "var(--warn)", say: "Weak — connect where people travel" }
    : { g: "F", c: "var(--danger)", say: "Build metro along real demand" };
  const gradeGoalTarget = goal === "grade" ? DIFFICULTIES[difficulty].targets.grade?.scoreTarget ?? 82 : null;
  // crowding — the central pressure: full lines leave riders stuck (they give up
  // and drive). Relieve by adding trains (fleet) or a parallel line.
  const waiting = meta?.waiting ?? 0;
  const crowdedLines = (meta?.perLine ?? []).filter((p) => p.waiting > 50 && p.util > 0.85).length;

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
        onDemolishLine={(id) => {
          pushUndo();
          sim.removeLine(id);
          setSelectedLineId(null);
        }}
        selectedLineId={selectedLineId}
        onSelectLine={(id) => setSelectedLineId((cur) => (cur === id ? null : id))}
        center={CENTER}
        showDensity={showDensity}
        showAgents={showAgents}
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
      <div className="absolute left-4 top-4 z-20 w-[250px]">
        <div className="panel panel-accent px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="wordmark flex items-center gap-1.5 text-[15px] leading-none">
              <LannaEmblem size={16} /> เชียงใหม่ Transit
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase text-[var(--muted)]">
                {DIFFICULTIES[difficulty].icon} {goal ? t(goalDef?.label ?? "free", goalTh[goal].label) : "free"} ·{" "}
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
              <div className="font-mono text-2xl tabular-nums leading-none">{meta ? clock(meta.simTime) : "--:--"}</div>
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
              <div className="font-mono text-lg tabular-nums" style={{ color: meta && meta.budget < 0 ? "var(--danger)" : "var(--accent)" }}>
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
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
                  style={{ background: grade.c, color: "var(--accent-ink)" }}
                >
                  {grade.g}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[var(--muted)]">
                      {t("City score", "คะแนนเมือง")} ⓘ
                      {gradeGoalTarget != null && (
                        <span className="ml-1 text-[var(--accent)]">· {t("goal", "เป้า")} ≥{gradeGoalTarget}</span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums">{cityScore}/100</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]">
                    <div className="h-full rounded-full" style={{ width: `${cityScore}%`, background: grade.c }} />
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium" style={{ color: grade.c }}>
                    {t(grade.say, gradeSayTh[grade.g])}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12px]">
                <span style={{ color: "var(--ride)" }} title="boardings over the last 24 sim-hours (rolling), at city scale">
                  🚆 {ppl(meta.dailyRiders)} {t("riders/day", "คน/วัน")} <span className="text-[var(--muted)]">(24h)</span>
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
              <div className="mt-1 flex items-center justify-between text-[12px]">
                <span style={{ color: crowdedLines > 0 ? "var(--danger)" : "var(--muted)" }}>
                  🧍 {ppl(waiting)} {t("waiting", "รอ")}{crowdedLines > 0 ? ` · ${crowdedLines} ${t("crowded", "แน่น")}` : ""}
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
                  {(meta.satisfaction ?? 100) >= 70 ? "😀" : (meta.satisfaction ?? 100) >= 45 ? "😐" : "😣"}{" "}
                  {meta.satisfaction ?? 100}% {t("happy", "พอใจ")}
                </span>
                <span className="text-[var(--muted)]">
                  ⏱ {Math.round((meta.avgWaitSec ?? 0) / 60)} {t("min wait", "นาทีรอ")}
                </span>
              </div>
            </div>
          )}

          {/* 🎯 chosen-goal objective + progress (grade goal is shown by the City Score above — avoid a 2nd grade) */}
          {goalDef && goal !== "free" && goal !== "grade" && meta && (
            <div className="mt-2.5 rounded-lg border border-[var(--line)] bg-[var(--fill)] px-2.5 py-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold">
                  🎯 {goalDef.icon} {goal ? t(goalDef.label, goalTh[goal].label) : goalDef.label}
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
        {!zen && lines.length > 0 && (
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
                      onClick={() => setSelectedLineId((c) => (c === l.id ? null : l.id))}
                    >
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: rgb(l.color) }} />
                      <span className="w-9 shrink-0">{MODE_PARAMS[l.mode].label}</span>
                      <span className="flex-1 text-[var(--muted)]">
                        {(l.totalLen / 1000).toFixed(1)} km · {l.mode === "metro" ? "🚆" : "🛻"}
                        {l.fleet}
                      </span>
                      <span className="text-[10.5px]" style={{ color: crowded ? "var(--danger)" : "var(--muted)" }}>
                        {crowded ? "⚠" : ""}
                        {util}%
                      </span>
                    </button>
                    {/* per-line performance — always visible: crowding · waiting · riding */}
                    <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-[10px]">
                      <span
                        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-[8px] font-bold text-white"
                        style={{ background: CROWD_COLORS[crowdOf(util) - 1] }}
                        title={t(`Crowding ${crowdOf(util)}/5`, `ความแน่น ${crowdOf(util)}/5`)}
                      >
                        {crowdOf(util)}
                      </span>
                      <span style={{ color: (pl?.waiting ?? 0) > 50 ? "var(--danger)" : "var(--muted)" }}>
                        🧍 {ppl(pl?.waiting ?? 0)} {t("wait", "รอ")}
                      </span>
                      <span className="text-[var(--muted)]">{l.mode === "metro" ? "🚆" : "🛻"} {ppl(pl?.riders ?? 0)} {t("riding", "บนรถ")}</span>
                    </div>
                    {sel && (
                      <div className="mt-1.5 flex flex-col gap-1.5 pl-[18px]">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-[var(--muted)]">{l.mode === "metro" ? t("Trains", "ขบวน") : t("Trucks", "คันรถ")}</span>
                          <button
                            className="rounded bg-[var(--fill-2)] px-1.5 leading-none hover:bg-[var(--fill-3)] disabled:opacity-30"
                            onClick={() => sim.setFleet(l.id, l.fleet - 1)}
                            disabled={l.fleet <= 1}
                          >
                            −
                          </button>
                          <span className="w-4 text-center font-mono">{l.fleet}</span>
                          <button
                            className="rounded bg-[var(--fill-2)] px-1.5 leading-none hover:bg-[var(--fill-3)] disabled:opacity-30"
                            onClick={() => sim.setFleet(l.id, l.fleet + 1)}
                            disabled={l.fleet >= MAX_FLEET}
                          >
                            +
                          </button>
                          <button
                            className="ml-auto text-[var(--muted)] hover:text-[var(--danger)]"
                            onClick={() => {
                              pushUndo();
                              sim.removeLine(l.id);
                              setSelectedLineId(null);
                            }}
                          >
                            remove ✕
                          </button>
                        </div>
                        {/* fare — a demand lever: ↑ fare = more revenue, fewer riders */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-[var(--muted)]">{t("Fare", "ค่าโดยสาร")}</span>
                          <button
                            className="rounded bg-[var(--fill-2)] px-1.5 leading-none hover:bg-[var(--fill-3)] disabled:opacity-30"
                            onClick={() => sim.setFare(l.id, l.fare - 5)}
                            disabled={l.fare <= 5}
                          >
                            −
                          </button>
                          <span className="w-10 text-center font-mono">฿{l.fare}</span>
                          <button
                            className="rounded bg-[var(--fill-2)] px-1.5 leading-none hover:bg-[var(--fill-3)] disabled:opacity-30"
                            onClick={() => sim.setFare(l.id, l.fare + 5)}
                            disabled={l.fare >= 100}
                          >
                            +
                          </button>
                          <span className="ml-auto text-[10px] text-[var(--muted)]">{t("↑ revenue · ↓ riders", "↑ รายได้ · ↓ คน")}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {LINE_COLORS.map((c) => (
                            <button
                              key={c.name}
                              title={c.name}
                              onClick={() => sim.setLineColor(l.id, c.rgb)}
                              className="h-4 w-4 rounded-full"
                              style={{
                                background: rgb(c.rgb),
                                outline:
                                  l.color.join(",") === c.rgb.join(",")
                                    ? "2px solid var(--ink)"
                                    : "1px solid rgba(46,33,19,.28)",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Stats (hidden in Zen mode) */}
      {!zen && (
      <div className="absolute right-4 top-4 z-20 w-[224px]">
        <div className="panel px-4 py-3 text-[13px]">
          <Stat label={t("Travellers", "ผู้คน")} value={meta ? ppl(meta.agentCount) : "…"} />
          <Stat label={t("Walking", "เดิน")} dot="var(--walk)" value={meta ? ppl(meta.walking) : "0"} />
          <Stat label={t("Driving", "ขับรถ")} dot="var(--warn)" value={meta ? ppl(meta.driving) : "0"} />
          <Stat label={t("Waiting", "รอ")} dot="#ffffff" value={meta ? ppl(meta.waiting) : "0"} />
          <Stat label={t("On transit", "บนรถไฟ")} dot="var(--ride)" value={meta ? ppl(meta.riding) : "0"} />
          <div className="my-1.5 h-px bg-[var(--fill-2)]" />
          <Stat label={t("Traffic", "รถติด")} value={meta ? `${meta.congestion}%` : "0%"} valueColor={meta && meta.congestion >= 55 ? "var(--warn)" : undefined} />
          <Stat label={t("Coverage", "ครอบคลุม")} value={meta ? `${meta.coverage}%` : "0%"} valueColor={meta && meta.coverage >= 60 ? "var(--ride)" : undefined} />
          <Stat label={t("Riders/day", "คน/วัน")} value={meta ? ppl(meta.dailyRiders) : "0"} />
          <Stat label={t("Transfers", "เปลี่ยนสาย")} value={meta ? ppl(meta.transferTrips) : "0"} />
          {/* train crowding legend (1 empty → 5 full) */}
          <div className="my-1.5 h-px bg-[var(--fill-2)]" />
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-[var(--muted)]">🚆 {t("Train crowding", "ความแน่นรถไฟ")}</span>
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
          return (
            <div className="panel panel-accent mt-2 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold">🎯 {t("Travel demand", "ความต้องการเดินทาง")}</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px]" style={{ color: odServedPct >= 50 ? "var(--ride)" : "var(--warn)" }}>
                    {odServedPct}% {t("served", "ตอบโจทย์")}
                  </span>
                  <button className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setShowOD(false)} title={t("Close", "ปิด")}>✕</button>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fill-2)]">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${odServedPct}%`, background: "var(--ride)" }} />
              </div>
              <div className="mt-0.5 text-[9.5px] text-[var(--muted)]">{t("click a corridor to see it on the map", "คลิกเส้นทางเพื่อดูบนแผนที่")}</div>

              {/* UNMET — the priority list (people still drive these) */}
              <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--danger)" }}>
                🚗 {t("Still driving — build here", "ยังต้องขับรถ — ควรสร้าง")}
                <span className="font-mono text-[var(--muted)]">{odUnmet.length}</span>
              </div>
              <div className="mt-1 flex max-h-[24vh] flex-col gap-px overflow-y-auto pr-0.5">
                {odUnmet.map((c, i) => Row(c, i, "var(--danger)", true))}
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
        const beats: Record<number, [ReactNode, ReactNode]> = {
          1: [<b key="t">วางสถานี · Place stations</b>, <>คลิก <b className="text-[var(--text)]">🚉 วางสถานี</b> แล้วคลิกบนถนน ≥2 จุด · Click 🚉, then click 2+ road spots.</>],
          2: [<b key="t">วางราง · Lay track</b>, <>คลิก <b className="text-[var(--text)]">🛤️ วางราง</b> เชื่อมสถานี แล้วกด <b className="text-[var(--text)]">✓ Finish</b> · click 🛤️, connect stations, press ✓ Finish.</>],
          3: [<b key="t" style={{ color: "var(--ride)" }}>🎉 เส้นทางแรกวิ่งแล้ว! · Your first line runs!</b>, <>Watch commuters switch off the roads. Now let&apos;s grow it.</>],
          4: [<b key="t">🎯 ความต้องการเดินทาง · Travel demand</b>, <>Open <b className="text-[var(--text)]">🎯 Demand</b> — the red &quot;still driving&quot; corridors are <i>why your grade is low</i>. Click one to see it on the map, then build toward it.</>],
          5: [<b key="t">💰 ค่าโดยสาร · Fares</b>, <>Click a line in <b className="text-[var(--text)]">Your Network</b> and set its <b className="text-[var(--text)]">Fare</b> — raise it to shed crowding &amp; earn more, lower it to attract riders.</>],
          6: [<b key="t">🛻 สองแถว · Songthaew feeders</b>, <>Switch to <b className="text-[var(--text)]">🛻 Songthaew</b> and <b className="text-[var(--text)]">draw a cheap route</b> feeding a metro station — last-mile coverage where a trunk isn&apos;t worth it.</>],
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

      {/* Bottom controls — Bangkok-style tool palette */}
      <div className="panel absolute bottom-12 left-1/2 z-20 flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 px-3 py-2.5">
        <button className="btn" onClick={() => (playing ? sim.pause() : sim.play())} disabled={!ready}>
          {playing ? "⏸" : "▶"}
        </button>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button key={s} className={`btn ${speed === s ? "btn-active" : ""}`} onClick={() => sim.setSpeed(s)} disabled={!ready}>
              {s}×
            </button>
          ))}
        </div>
        <div className="mx-1 h-7 w-px bg-[var(--line)]" />

        {/* build-mode: 🚆 Metro trunk vs 🛻 Songthaew feeders */}
        <div className="flex items-center gap-1">
          {(["metro", "songthaew"] as const).map((m) => (
            <button
              key={m}
              className={`btn ${buildMode === m ? "btn-active" : ""}`}
              onClick={() => switchBuild(m)}
              disabled={!ready}
              title={m === "metro"
                ? "Metro — fast, traffic-immune trunk lines (place stations → lay track)"
                : "Songthaew — cheap road-bound feeders; draw a route along the streets"}
            >
              {m === "metro" ? "🚆" : "🛻"} <span className="text-[11px]">{m === "metro" ? t("Metro", "รถไฟฟ้า") : t("Songthaew", "สองแถว")}</span>
            </button>
          ))}
        </div>
        <div className="mx-1 h-7 w-px bg-[var(--line)]" />

        {/* tools — metro: pan/station/track/demolish · songthaew: pan/route */}
        <div className="flex items-center gap-1">
          {(buildMode === "metro" ? TOOLS : [TOOLS[0], ROUTE_TOOL, TOOLS[3]]).map((tl) => {
            const on = tool === tl.id;
            const locked =
              (tl.id === "track" && stations.length < 2) ||
              (tl.id === "demolish" && stations.length === 0 && lines.length === 0);
            return (
              <button
                key={tl.id}
                className="btn flex items-center gap-1"
                onClick={() => pickTool(tl.id)}
                disabled={!ready || locked}
                style={on ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent" } : undefined}
                title={locked ? "Place 2+ stations first (🚉)" : `${tl.en} — ${tl.hint}`}
              >
                <span>{tl.icon}</span>
                <span className="text-[11px]">{tl.th}</span>
              </button>
            );
          })}
        </div>
        <button
          className="btn"
          onClick={undo}
          disabled={!undoStack.length}
          title="Undo (Ctrl/Cmd+Z)"
        >
          ↶
        </button>
        <div className="mx-1 h-7 w-px bg-[var(--line)]" />
        <button
          className={`btn ${showDensity ? "btn-active" : ""}`}
          onClick={() => setShowDensity((v) => !v)}
          title={t(
            "Population density heat — where residents, students & tourists are (plan with it on, build with it off)",
            "ความหนาแน่นประชากร — ที่อยู่ของคนเมือง นักศึกษา นักท่องเที่ยว (เปิดดูตอนวางแผน ปิดตอนสร้าง)",
          )}
        >
          🔥 <span className="text-[11px]">{t("Density", "ความหนาแน่น")}</span>
        </button>
        <button
          className={`btn ${showAgents ? "btn-active" : ""}`}
          onClick={() => setShowAgents((v) => !v)}
          title={t("Show/hide the moving people (walk · drive · ride)", "แสดง/ซ่อนผู้คนที่กำลังเดินทาง (เดิน · ขับรถ · นั่งรถไฟ)")}
        >
          👣 <span className="text-[11px]">{t("People", "ผู้คน")}</span>
        </button>
        <button
          className={`btn ${showOD ? "btn-active" : ""}`}
          onClick={() => setShowOD((v) => !v)}
          title={t("Show/hide the travel-demand priorities panel", "แสดง/ซ่อนแผงความต้องการเดินทาง")}
        >
          🎯 <span className="text-[11px]">{t("Demand", "ความต้องการ")}</span>
        </button>
        <button
          className={`btn ${zen ? "btn-active" : ""}`}
          onClick={() => setZen((v) => !v)}
          title={t("Zen mode — collapse to map + grade + tools; summon panels when you want them", "โหมดเซน — เหลือแผนที่ เกรด เครื่องมือ")}
        >
          🌿 <span className="text-[11px]">{t("Zen", "เซน")}</span>
        </button>
        <button
          className="btn"
          onClick={() => setMuted((m) => { const n = !m; setSfxMuted(n); return n; })}
          title={t("Sound on/off", "เสียง เปิด/ปิด")}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        {/* 🚉 place stations — click roads to drop standalone stations (no rail yet) */}
        {tool === "station" && (
          <>
            <div className="mx-1 h-7 w-px bg-[var(--line)]" />
            <span className="px-1 text-[11px]">
              {snapWarn ? (
                <span className="text-[var(--accent)]">แตะบนถนน ✦ tap a street</span>
              ) : (
                <span className="text-[var(--muted)]">
                  คลิกถนนเพื่อวางสถานี · {stations.length} สถานี — แล้วเลือก 🛤️ วางราง เพื่อเชื่อม
                </span>
              )}
            </span>
          </>
        )}

        {/* 🛤️ lay track — connect placed stations into a metro line */}
        {tool === "track" && (
          <>
            <div className="mx-1 h-7 w-px bg-[var(--line)]" />
            <span
              className="btn"
              style={{ background: rgb(MODE_PARAMS.metro.color), color: "var(--accent-ink)", borderColor: "transparent", cursor: "default" }}
              title={`Metro: from ฿${(ECONOMY.metro.build / 1e6).toFixed(1)}M, ${Math.round(MODE_PARAMS.metro.speed * 3.6)} km/h, cap ${MODE_PARAMS.metro.capacity}, fare ฿${MODE_PARAMS.metro.fare}`}
            >
              🚆 Metro
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
              {stations.length < 2 ? "วางสถานีอย่างน้อย 2 จุดก่อน" : "คลิก/ลากเชื่อมสถานี"} · {railDraft.length}
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
          </>
        )}

        {tool === "demolish" && (
          <span className="px-1 text-[11px] text-[var(--muted)]">{t("Click a station (line re-routes) or a line/route to remove it", "คลิกสถานี (สายจะปรับเส้นทาง) หรือคลิกสาย/เส้นทางเพื่อรื้อถอน")}</span>
        )}

        {/* 🛻 draw a songthaew route — click waypoints along the roads, then Finish */}
        {tool === "route" && (
          <>
            <div className="mx-1 h-7 w-px bg-[var(--line)]" />
            <span
              className="btn"
              style={{ background: rgb(MODE_PARAMS.songthaew.color), color: "#fff", borderColor: "transparent", cursor: "default" }}
              title={`Songthaew: from ฿${(ECONOMY.songthaew.build / 1e3).toFixed(0)}k, ${Math.round(MODE_PARAMS.songthaew.speed * 3.6)} km/h, cap ${MODE_PARAMS.songthaew.capacity}, fare ฿${MODE_PARAMS.songthaew.fare} · road-bound feeder`}
            >
              🛻 Songthaew
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
          </>
        )}
      </div>

      {/* 🔥 density legend (only while the heat overlay is on) */}
      {showDensity && (
        <div className="panel absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-[11px]">
          🔥 <span className="font-medium">{t("Population density", "ความหนาแน่นประชากร")}</span>
          <span className="text-[var(--muted)]">{t("quiet", "น้อย")}</span>
          <span className="inline-block h-2.5 w-20 rounded" style={{ background: "linear-gradient(90deg,#f3d68e,#d89634,#c26a2a,#b5462e)" }} />
          <span className="text-[var(--muted)]">{t("dense", "หนาแน่น")}</span>
          {meta && <span className="ml-1 text-[10px] text-[var(--muted)]">· {t("now", "ตอนนี้")} {peakBadge}</span>}
        </div>
      )}

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

      {/* 🏆 win overlay */}
      {showWin && goalDef && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(42,28,14,0.5)]">
          <div className="panel px-8 py-6 text-center" style={{ borderColor: "var(--ride)" }}>
            <div className="text-4xl">🏆</div>
            <div className="mt-2 text-lg font-semibold" style={{ color: "var(--ride)" }}>
              {goal ? t(goalDef.winTitle, goalTh[goal].win) : goalDef.winTitle}
            </div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">
              Reached in {meta?.day ?? 0} days · {fmt(meta?.dailyRiders ?? 0)} riders/day · grade {grade.g}
            </div>
            <div className="mt-3 tracking-widest text-[var(--accent)]">★ ★ ★</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className="btn btn-accent" onClick={() => setShowWin(false)}>
                Keep playing
              </button>
              <button
                className="btn"
                title="Back to the goal menu — your build is autosaved, Resume it anytime"
                onClick={() => window.location.reload()}
              >
                New goal
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
