// Tunable constants for the simulation sandbox. Times are sim-seconds,
// distances metres, speeds metres/second.

import type { LineMode } from "@/lib/types";

export const SIM = {
  agentCount: 15000, // a busier, livelier city — more demand → fuller lines (crowding) + more fares
  walkSpeed: 1.4, // ~5 km/h
  maxAccessWalkM: 800, // rail walk-shed: people walk ~10 min to a metro (real TOD catchment ~800 m–1 km). Wider than a bus → a well-placed station pulls far more riders
  dwellMinSec: 240, // min time spent at a destination before next trip
  dwellMaxSec: 1500,
  tickHz: 30,
  daySeconds: 24 * 3600,
  startSeconds: 7 * 3600,
} as const;

// Max lines the player may build per mode.
export const LINE_CAP: Record<LineMode, number> = { bus: 20, metro: 8 };

// --- Population mix (residents · students · tourists) -----------------------
// Chiang Mai's travellers are not one undifferentiated crowd. The sim's agents
// are split into three kinds, each with its own spatial anchor, daily rhythm and
// transit appetite — so the dense residential core, the university campuses and
// the old-city / Nimman tourist cores all generate distinct, realistic demand
// (shadow/floating population is folded into residents via the city-scale factor).
// Shares are of ACTIVE TRAVELLERS (tourists & students travel more per head than
// their population share), tuned for a lively, visible mix.
export type AgentKind = "resident" | "student" | "tourist";

export const DEMOGRAPHICS: Record<
  AgentKind,
  {
    share: number; // fraction of agents
    propensity: number; // × transit preference (higher → rides more)
    tripsScale: number; // trip frequency (>1 → re-trips sooner)
    // time-of-day demand curve: base + amp·Σ exp(-((h-hour)²)/spread)
    peakHours: number[];
    peakSpread: number;
    peakBase: number;
    peakAmp: number;
    icon: string;
    label: string;
    labelTh: string;
  }
> = {
  resident: {
    share: 0.70, propensity: 1.0, tripsScale: 1.0,
    peakHours: [8, 18], peakSpread: 4.5, peakBase: 0.65, peakAmp: 0.85,
    icon: "🧑", label: "Resident", labelTh: "คนเมือง",
  },
  student: {
    share: 0.12, propensity: 1.4, tripsScale: 1.05, // few own cars → ride more
    peakHours: [8.5, 16], peakSpread: 3.5, peakBase: 0.55, peakAmp: 0.9,
    icon: "🎓", label: "Student", labelTh: "นักศึกษา",
  },
  tourist: {
    share: 0.18, propensity: 1.8, tripsScale: 1.35, // no car, sightsee all day
    peakHours: [12, 19.5], peakSpread: 4.5, peakBase: 0.7, peakAmp: 0.8,
    icon: "🧳", label: "Tourist", labelTh: "นักท่องเที่ยว",
  },
};

// The 15,000 agents are a sample of the real travel market; multiply human-facing
// flow numbers (riders/day, per-line riders, the moving-people stats) by this so
// they read at city scale. Calibrated against real metros (single trunk line
// ~40-200k/day & ~5-15k/km/day; good-system rail ~20-40% mode share) with the
// 800 m catchment doing the real capture. The ECONOMY stays on sim units.
export const PEOPLE_PER_AGENT = 6;

// --- Origin→Destination demand model ---------------------------------------
// The city's real travel desire: named residential ORIGINS (homes) → clustered
// activity-center DESTINATIONS, weighted by a gravity model. Each corridor is
// classed MET (your transit beats driving it) or UNMET (people still drive) —
// exactly the rule agents use — so the player sees what to prioritise, live.
export const OD = {
  originHubs: 16, // top home/residential clusters used as trip origins
  destHubs: 18, // clustered POI activity centers used as destinations
  cellM: 850, // grid cell for clustering destinations
  accessM: 900, // a hub (area centroid) counts as served if a stop is within this (tightened — a small metro shouldn't "serve" the whole city)
  decayM: 3000, // gravity distance decay  e^(-dist/decayM)
  refreshSec: 1500, // recompute met/unmet at most this often (sim-seconds)
  topUnmet: 20, // unmet corridors surfaced to the player
  topMet: 12, // met corridors surfaced (achievements)
  scaleTop: 5400, // scale the top corridor to ~this for a readable "trips/day"
} as const;

// How people decide to travel. A trip is WALKED if short; otherwise the agent
// compares the cheapest transit option against DRIVING (generalised cost in
// minutes, fares + parking folded in) and picks the cheaper. Driving and buses
// add to road congestion; metro (off-road) is immune.
// NOTE: these are GAME-FUN calibrations, deliberately metro-favourable and not
// real-life-accurate (a sim game, not a planning model): people walk less for
// whole trips, switching to metro is cheap/easy, and traffic is dramatic so a
// good line visibly clears jams. Tune freely.
export const TRAVEL = {
  walkMaxM: 650, // trips shorter than this are just walked (lowered → more metro/car decisions)
  carFreeSpeed: 12, // m/s (~43 km/h) free-flow driving
  carMinSpeed: 2.5, // m/s gridlocked floor
  parkPenaltyMin: 16, // fixed hassle of taking a car (parking, fuel, ownership) — nudges to metro
  fareMinPerBaht: 0.1, // converts a fare (baht) into an equivalent time cost — high enough that the FARE is a real demand lever (raise fare → shed riders, lower → attract)
  transitPref: 2.2, // people take transit even if up to ~120% "costlier" than driving (low switching cost)
  congCellM: 320, // congestion grid cell size
  congCellCap: 12, // vehicles in a cell at which speed roughly halves (lower → traffic builds dramatically)
  busCongWeight: 2.5, // a bus occupies more road than a car
  transferMaxM: 500, // two lines' stops within this can be a transfer
  transferPenaltyMin: 2.5, // disutility of making a transfer (low → networks get used)
} as const;

export interface ModeParams {
  label: string;
  color: [number, number, number]; // default colour (player can recolour)
  speed: number; // m/s free-flow
  capacity: number;
  headwaySec: number; // baseline only; actual headway is derived from fleet
  dwellSec: number;
  fare: number; // baht (flat)
  gradeSeparated: boolean; // follows roads but immune to traffic (metro)
  flexible: boolean;
  stopSpacingM: number;
}

// Two clearly-contrasted modes.
//  Bus   – small, slow, road-bound (slows in traffic AND adds to it), cheap.
//  Metro – big, fast, its own alignment (no traffic), but a pricier fare.
export const MODE_PARAMS: Record<LineMode, ModeParams> = {
  bus: {
    label: "Bus",
    color: [240, 180, 40],
    speed: 7, // ~25 km/h free-flow, less in traffic
    capacity: 35,
    headwaySec: 300,
    dwellSec: 14,
    fare: 15,
    gradeSeparated: false, // shares the road, slows in & adds to traffic
    flexible: false,
    stopSpacingM: 500, // a stop roughly every 500 m
  },
  metro: {
    label: "Metro",
    color: [170, 90, 235],
    speed: 19, // ~68 km/h, unaffected by traffic
    capacity: 200, // per train — popular lines crowd, so add trains / lines
    headwaySec: 200,
    dwellSec: 8,
    fare: 40, // healthy revenue per rider (fare barely affects mode choice now)
    gradeSeparated: true, // follows the road corridor but elevated/underground
    flexible: false,
    stopSpacingM: 900, // stations spaced wider
  },
};

// Metro-only game — the bus mode is retained in the model/types but not offered.
export const MODE_ORDER: LineMode[] = ["metro"];

// Player-selectable line colours (metro-style multi-colour networks).
export const LINE_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Red", rgb: [230, 70, 70] },
  { name: "Blue", rgb: [70, 140, 240] },
  { name: "Green", rgb: [60, 200, 120] },
  { name: "Orange", rgb: [240, 150, 40] },
  { name: "Purple", rgb: [170, 90, 235] },
  { name: "Pink", rgb: [235, 90, 180] },
  { name: "Teal", rgb: [40, 200, 200] },
  { name: "Gold", rgb: [220, 190, 50] },
];

// Vehicles (trains/buses) per line: a new line opens with ONE train; the player
// adds more (fleet +/-) as crowding demands.
export const DEFAULT_FLEET = 1;
export const MAX_FLEET = 5;

// --- Economy (all values in baht) ------------------------------------------
// GAME-FUN economy: deliberately forgiving. Building is cheap and a decent line
// turns a clear daily PROFIT, so money is never the wall — the real pressure is
// crowding (relieve it by adding trains / expanding). Tune freely.
export const ECONOMY: Record<
  LineMode,
  { build: number; perKm: number; perStop: number; opexPerKmDay: number; opexPerVehDay: number }
> = {
  bus: {
    build: 80_000,
    perKm: 12_000,
    perStop: 2_500,
    opexPerKmDay: 1_800,
    opexPerVehDay: 1_200,
  },
  metro: {
    build: 500_000,
    perKm: 90_000,
    perStop: 25_000,
    opexPerKmDay: 4_000,
    opexPerVehDay: 3_000,
  },
};

/** One-off cost to build a line of the given geometry. */
export function lineCapex(mode: LineMode, totalLenM: number, stopCount: number): number {
  const e = ECONOMY[mode];
  return e.build + e.perKm * (totalLenM / 1000) + e.perStop * stopCount;
}

// The player picks ONE of these on the start screen — it sets the win condition
// (checked client-side from the live metrics) plus the starting purse.
export type GoalKind = "cars" | "money" | "grade" | "free";

export const GOALS: Record<
  GoalKind,
  {
    icon: string;
    label: string;
    desc: string;
    targetLine: string; // short "how you win" line on the card + banner
    startBudget: number;
    bankruptcy: boolean;
    // win targets (tunable)
    trafficMax?: number; // cars: city Traffic % at/below this
    ridersMin?: number; // cars: also need this many riders/day
    budgetTarget?: number; // money: budget at/above this
    scoreTarget?: number; // grade: City Score at/above this
    winTitle: string;
  }
> = {
  cars: {
    icon: "🚗",
    label: "Win the Cars",
    desc: "Pull the city off the road — cut traffic and pack the trains.",
    targetLine: "Traffic ≤ 35% + 25k riders/day",
    startBudget: 80_000_000,
    bankruptcy: false,
    trafficMax: 35,
    ridersMin: 25_000,
    winTitle: "You won the city back from cars! 🚇",
  },
  money: {
    icon: "💰",
    label: "Transit Tycoon",
    desc: "Start lean and grow a profitable network into a fortune.",
    targetLine: "Grow the fund to ฿60M",
    startBudget: 25_000_000,
    bankruptcy: false,
    budgetTarget: 60_000_000,
    winTitle: "Transit tycoon — ฿60M in the bank! 💰",
  },
  grade: {
    icon: "🅰",
    label: "Grade A City",
    desc: "Cover the city and ease traffic until the network is world-class.",
    targetLine: "Reach City Score A (≥ 72)",
    startBudget: 80_000_000,
    bankruptcy: false,
    scoreTarget: 72,
    winTitle: "Grade A — a world-class network! 🏆",
  },
  free: {
    icon: "🆓",
    label: "Free Build",
    desc: "Unlimited money, no goal — just build the city's dream network.",
    targetLine: "No goal — sandbox",
    startBudget: Infinity,
    bankruptcy: false,
    winTitle: "",
  },
};

// Difficulty scales the economy, the win target, and (on Hard) adds a deadline +
// bankruptcy. Medium == the current balance, so picking it changes nothing.
// Free Build ignores difficulty. Per-goal target overrides fall back to GOALS.
export type Difficulty = "easy" | "medium" | "challenge" | "hard";

type GoalTargets = { trafficMax?: number; ridersMin?: number; budgetTarget?: number; scoreTarget?: number };

export const DIFFICULTIES: Record<
  Difficulty,
  {
    label: string;
    icon: string;
    budgetMult: number; // × the goal's startBudget
    costMult: number; // × capex (build/km/stop)
    opexMult: number; // × daily operating cost
    fareMult: number; // × fare revenue per boarding
    capacityMult: number; // × train capacity (lower → crowds faster)
    bankruptcy: boolean;
    deadlineDays: number | null; // reach the goal within N days, else you lose
    targets: Partial<Record<GoalKind, GoalTargets>>;
  }
> = {
  easy: {
    label: "Easy",
    icon: "🟢",
    budgetMult: 1.6,
    costMult: 0.7,
    opexMult: 0.6,
    fareMult: 1.3,
    capacityMult: 1.15, // was 1.3 — let crowding occasionally bite so the core loop shows
    bankruptcy: false,
    deadlineDays: null,
    targets: {
      cars: { trafficMax: 45, ridersMin: 12_000 },
      money: { budgetTarget: 40_000_000 },
      grade: { scoreTarget: 62 },
    },
  },
  medium: {
    label: "Medium",
    icon: "🟡",
    budgetMult: 1.0,
    costMult: 1.0,
    opexMult: 1.0,
    fareMult: 1.0,
    capacityMult: 1.0,
    bankruptcy: false,
    deadlineDays: null,
    targets: {
      cars: { trafficMax: 35, ridersMin: 25_000 },
      money: { budgetTarget: 60_000_000 },
      grade: { scoreTarget: 72 },
    },
  },
  // a real fail-state (bankruptcy) to beat, but NO deadline — for average-skill
  // players who want stakes without Hard's stacked clock+penalties crushing them
  challenge: {
    label: "Challenge",
    icon: "🟠",
    budgetMult: 0.8,
    costMult: 1.15,
    opexMult: 1.2,
    fareMult: 0.9,
    capacityMult: 0.9,
    bankruptcy: true,
    deadlineDays: null,
    targets: {
      cars: { trafficMax: 32, ridersMin: 32_000 },
      money: { budgetTarget: 80_000_000 },
      grade: { scoreTarget: 76 },
    },
  },
  hard: {
    label: "Hard",
    icon: "🔴",
    budgetMult: 0.65, // was 0.55 — a single line no longer eats the whole purse
    costMult: 1.25, // was 1.4
    opexMult: 1.5,
    fareMult: 0.8,
    capacityMult: 0.8,
    bankruptcy: true,
    deadlineDays: 85, // was 60 — too tight for deliberate min-maxing
    targets: {
      cars: { trafficMax: 28, ridersMin: 40_000 }, // riders 45k→40k
      money: { budgetTarget: 100_000_000 }, // 120M→100M
      grade: { scoreTarget: 80 }, // 82→80
    },
  },
};

// Daily-ridership goal: milestone ladder (cash rewards) + star thresholds.
export const GOAL = {
  target: 30_000, // daily boardings to "win"
  milestones: [
    { riders: 5_000, reward: 1_500_000, label: "First riders" },
    { riders: 15_000, reward: 3_000_000, label: "It's catching on" },
    { riders: 30_000, reward: 0, label: "City on rails" },
  ],
  stars: [5_000, 15_000, 30_000], // daily riders for 1 / 2 / 3 stars
};

// Per-line service level (frequency) multipliers the player can dial.
export const SERVICE_LEVELS = [0.5, 1, 1.5, 2] as const;

// Agent render colours by state (RGBA). Kept light/translucent so the dense
// commuter field never buries the rail lines or stations drawn above it; the
// transit-relevant states (waiting, riding) stay the most visible.
export const STATE_COLOR: Record<number, [number, number, number, number]> = {
  0: [120, 150, 190, 95], // walking  – soft blue, translucent
  1: [255, 255, 255, 200], // waiting  – white
  2: [80, 240, 170, 255], // in-vehicle – bright green (the "win" state)
  3: [120, 140, 165, 38], // dwelling – barely there
  4: [255, 150, 85, 120], // driving  – light orange, translucent (cars / traffic)
};

export const MAP = {
  style: process.env.NEXT_PUBLIC_MAP_STYLE ||
    "https://tiles.openfreemap.org/styles/liberty",
};

// max distance a draw-click may be from any road before it's rejected
export const MAX_SNAP_M = 200;

// Bangkok-style build tools.
//  pan      เลื่อนแผนที่  — navigate the map
//  station  วางสถานี     — click to drop stations (anchors); track auto-routes between them
//  track    วางราง       — click or drag along roads to trace an alignment
//  demolish รื้อถอน      — click a line to remove it
export type Tool = "pan" | "station" | "track" | "demolish";

export const TOOLS: { id: Tool; icon: string; th: string; en: string; hint: string }[] = [
  { id: "pan", icon: "🖐️", th: "เลื่อนแผนที่", en: "Pan", hint: "Drag to move the map" },
  { id: "station", icon: "🚉", th: "วางสถานี", en: "Place stations", hint: "Click to drop stations; track routes between them" },
  { id: "track", icon: "🛤️", th: "วางราง", en: "Lay track", hint: "Click or drag along roads to trace the line" },
  { id: "demolish", icon: "🗑️", th: "รื้อถอน", en: "Demolish", hint: "Click a line to remove it" },
];

// Map marker styling for the fine POI categories (and residential origins).
export const POI_CAT_STYLE: Record<
  string,
  { color: [number, number, number]; icon: string; th: string; en: string; role: "O" | "D" }
> = {
  residential: { color: [125, 211, 252], icon: "🏘️", th: "ที่อยู่อาศัย", en: "Residential", role: "O" },
  restaurant: { color: [249, 115, 22], icon: "🍜", th: "ร้านอาหาร", en: "Restaurant", role: "D" },
  bar: { color: [236, 72, 153], icon: "🍺", th: "บาร์/สถานบันเทิง", en: "Bar / nightlife", role: "D" },
  temple: { color: [180, 110, 30], icon: "🛕", th: "วัด", en: "Temple", role: "D" },
  hospital: { color: [239, 68, 68], icon: "🏥", th: "โรงพยาบาล", en: "Hospital", role: "D" },
  school: { color: [96, 165, 250], icon: "🏫", th: "โรงเรียน/มหาวิทยาลัย", en: "School / university", role: "D" },
  attraction: { color: [21, 128, 61], icon: "🏛️", th: "แหล่งท่องเที่ยว", en: "Attraction", role: "D" },
  shop: { color: [168, 85, 247], icon: "🛍️", th: "ร้านค้า/ตลาด", en: "Shop / market", role: "D" },
  office: { color: [148, 163, 184], icon: "🏢", th: "ที่ทำงาน", en: "Workplace", role: "D" },
  transit: { color: [20, 184, 166], icon: "🚉", th: "ขนส่ง", en: "Transit", role: "D" },
};

// coarse engine purpose -> a fine category, for POIs that lack `cat`
export const PURPOSE_TO_CAT: Record<string, string> = {
  health: "hospital",
  edu: "school",
  temple: "temple",
  shop: "shop",
  work: "office",
  transit: "transit",
  leisure: "attraction",
};
