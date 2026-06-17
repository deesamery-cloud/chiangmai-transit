// Real Thai songthaew / baht-bus networks per city, approximated as route
// corridors within each map so a new game can start from "the network that
// already exists" instead of a blank city. These are stylised corridors (snapped
// to the road graph + A*-routed at build time via sim.addLine), NOT surveyed GPS
// traces — refine geometry as needed. Keyed by City.id (see src/lib/cities.ts).

import { LINE_COLORS } from "@/lib/config";
import type { LineMode } from "@/lib/types";

const C = (name: string) => LINE_COLORS.find((c) => c.name === name)!.rgb;

export interface SongthaewCorridor {
  name: string;
  nameTh: string;
  color: [number, number, number];
  points: { lon: number; lat: number }[];
  mode?: LineMode; // defaults to "songthaew"
}

const P = (lon: number, lat: number) => ({ lon, lat });

// --- Chiang Mai (rod daeng / red truck) -----------------------------------
// Hub at Warorot Market (~18.7905, 98.9930); red roam the old-city centre and
// fixed colours fan out N/S/W/E/SW. Sources: chiangmaitravelhub, chiangmaitraveller.
export const CM_SONGTHAEW: SongthaewCorridor[] = [
  {
    name: "Red — old city loop",
    nameTh: "แดง — รอบคูเมือง",
    color: C("Red"),
    points: [P(98.9935, 18.7965), P(98.9790, 18.7965), P(98.9790, 18.7820), P(98.9935, 18.7820), P(98.9935, 18.7965)],
  },
  {
    name: "Green — NE to Mae Jo / San Sai",
    nameTh: "เขียว — แม่โจ้ / สันทราย",
    color: C("Green"),
    points: [P(98.9930, 18.7905), P(98.9985, 18.7990), P(99.0040, 18.8120), P(99.0090, 18.8220)],
  },
  {
    name: "Blue — S to Sarapee / Lamphun",
    nameTh: "น้ำเงิน — สารภี / ลำพูน",
    color: C("Blue"),
    points: [P(98.9930, 18.7905), P(98.9980, 18.7800), P(99.0030, 18.7680), P(99.0085, 18.7585)],
  },
  {
    name: "Orange — W to Nimman / CMU",
    nameTh: "ส้ม — นิมมาน / มช.",
    color: C("Orange"),
    points: [P(98.9930, 18.7905), P(98.9850, 18.7900), P(98.9740, 18.7905), P(98.9660, 18.7960)],
  },
  {
    name: "Gold — E to railway / San Kamphaeng",
    nameTh: "ทอง — สถานีรถไฟ / สันกำแพง",
    color: C("Gold"),
    points: [P(98.9930, 18.7905), P(99.0000, 18.7900), P(99.0090, 18.7905), P(99.0180, 18.7905)],
  },
  {
    name: "Teal — SW to airport / Hang Dong",
    nameTh: "เขียวน้ำทะเล — สนามบิน / หางดง",
    color: C("Teal"),
    points: [P(98.9930, 18.7905), P(98.9855, 18.7815), P(98.9790, 18.7695), P(98.9725, 18.7600)],
  },
];

// --- Pattaya (baht buses) -------------------------------------------------
// The classic one-way loop: south down Beach Rd, north up Second Rd; plus the
// Sukhumvit spine, Central Pattaya (Pattaya Klang) crosstown, Jomtien south and
// Naklua north. Stylised corridors within the CBD bbox.
const PATTAYA: SongthaewCorridor[] = [
  {
    name: "Beach ↔ Second Rd loop",
    nameTh: "พัทยาสายชายหาด — เลียบหาด/สายสอง",
    color: C("Red"),
    points: [P(100.8685, 12.953), P(100.8685, 12.927), P(100.8720, 12.927), P(100.8720, 12.953), P(100.8685, 12.953)],
  },
  {
    name: "Sukhumvit spine (N–S)",
    nameTh: "สายสุขุมวิท (เหนือ–ใต้)",
    color: C("Blue"),
    points: [P(100.892, 12.958), P(100.890, 12.940), P(100.889, 12.922), P(100.888, 12.905)],
  },
  {
    name: "Central Pattaya (Pattaya Klang)",
    nameTh: "พัทยากลาง (ตัดขวาง)",
    color: C("Green"),
    points: [P(100.868, 12.929), P(100.878, 12.929), P(100.890, 12.929)],
  },
  {
    name: "Jomtien (south)",
    nameTh: "จอมเทียน (ใต้)",
    color: C("Orange"),
    points: [P(100.888, 12.910), P(100.880, 12.900), P(100.875, 12.892)],
  },
  {
    name: "Naklua (north)",
    nameTh: "นาเกลือ (เหนือ)",
    color: C("Purple"),
    points: [P(100.890, 12.945), P(100.895, 12.958), P(100.898, 12.966)],
  },
];

// --- Hua Hin (green songthaew) --------------------------------------------
// Phetkasem spine, Damnoen Kasem out to the beach/pier, the green Hua Hin–Khao
// Takiab coastal line, a town-market loop and the north (Cha-am) direction.
const HUAHIN: SongthaewCorridor[] = [
  {
    name: "Phetkasem spine (N–S)",
    nameTh: "เพชรเกษม (เหนือ–ใต้)",
    color: C("Green"),
    points: [P(99.957, 12.605), P(99.957, 12.585), P(99.958, 12.568), P(99.960, 12.550)],
  },
  {
    name: "Damnoen Kasem → beach/pier",
    nameTh: "ดำเนินเกษม → ชายหาด/สะพานปลา",
    color: C("Blue"),
    points: [P(99.958, 12.568), P(99.972, 12.568), P(99.988, 12.569)],
  },
  {
    name: "Hua Hin ↔ Khao Takiab",
    nameTh: "หัวหิน ↔ เขาตะเกียบ",
    color: C("Red"),
    points: [P(99.988, 12.569), P(99.987, 12.555), P(99.986, 12.540), P(99.985, 12.532)],
  },
  {
    name: "Town / night-market loop",
    nameTh: "ในเมือง / ตลาดโต้รุ่ง",
    color: C("Orange"),
    points: [P(99.958, 12.572), P(99.965, 12.572), P(99.965, 12.566), P(99.958, 12.566), P(99.958, 12.572)],
  },
  {
    name: "North (Cha-am direction)",
    nameTh: "เหนือ (ทางชะอำ)",
    color: C("Purple"),
    points: [P(99.957, 12.585), P(99.955, 12.598), P(99.953, 12.608)],
  },
];

// --- Hat Yai (songthaew) --------------------------------------------------
// CBD hub around the Kim Yong / Lee Garden market on the Niphat Uthit roads;
// Phetkasem spine, Thamnoonvithi crosstown to the railway, the PSU/Kho Hong
// south line and the north corridor.
const HATYAI: SongthaewCorridor[] = [
  {
    name: "Niphat Uthit market loop",
    nameTh: "นิพัทธ์อุทิศ — ตลาดกลาง",
    color: C("Red"),
    points: [P(100.470, 7.012), P(100.478, 7.012), P(100.478, 7.004), P(100.470, 7.004), P(100.470, 7.012)],
  },
  {
    name: "Phetkasem spine (N–S)",
    nameTh: "เพชรเกษม (เหนือ–ใต้)",
    color: C("Blue"),
    points: [P(100.474, 7.030), P(100.474, 7.010), P(100.475, 6.990)],
  },
  {
    name: "Thamnoonvithi → railway",
    nameTh: "ธรรมนูญวิถี → สถานีรถไฟ",
    color: C("Green"),
    points: [P(100.465, 7.008), P(100.474, 7.008), P(100.485, 7.008)],
  },
  {
    name: "Kho Hong / PSU (south)",
    nameTh: "คอหงส์ / ม.อ. (ใต้)",
    color: C("Orange"),
    points: [P(100.475, 6.995), P(100.490, 6.986), P(100.500, 6.982)],
  },
  {
    name: "North corridor",
    nameTh: "สายเหนือ",
    color: C("Purple"),
    points: [P(100.474, 7.015), P(100.470, 7.028), P(100.466, 7.038)],
  },
];

// --- Korat / Nakhon Ratchasima (songthaew) --------------------------------
// Old-city moat (Thao Suranari/Ya Mo, Chumphon Gate) on Ratchadamnoen; the
// Mittraphap highway spine, Jomsurangyat crosstown, the west (The Mall) line
// and the south/railway corridor.
const KORAT: SongthaewCorridor[] = [
  {
    name: "Ratchadamnoen old-city (E–W)",
    nameTh: "ราชดำเนิน — เมืองเก่า/ย่าโม",
    color: C("Red"),
    points: [P(102.085, 14.975), P(102.098, 14.975), P(102.112, 14.975)],
  },
  {
    name: "Mittraphap spine (N–S)",
    nameTh: "มิตรภาพ (เหนือ–ใต้)",
    color: C("Blue"),
    points: [P(102.100, 15.005), P(102.100, 14.980), P(102.100, 14.955)],
  },
  {
    name: "Jomsurangyat / Suranaree",
    nameTh: "จอมสุรางค์ยาตร์ / สุรนารี",
    color: C("Green"),
    points: [P(102.090, 14.985), P(102.100, 14.985), P(102.115, 14.982)],
  },
  {
    name: "West (The Mall)",
    nameTh: "ตะวันตก (เดอะมอลล์)",
    color: C("Orange"),
    points: [P(102.085, 14.970), P(102.075, 14.965), P(102.066, 14.960)],
  },
  {
    name: "South / railway",
    nameTh: "ใต้ / สถานีรถไฟ",
    color: C("Purple"),
    points: [P(102.098, 14.965), P(102.095, 14.950), P(102.092, 14.943)],
  },
];

// Per-city "existing transit" seeds, keyed by City.id. Cities without an entry
// simply start from a blank network.
export const CITY_SEEDS: Record<string, SongthaewCorridor[]> = {
  chiangmai: CM_SONGTHAEW,
  pattaya: PATTAYA,
  huahin: HUAHIN,
  hatyai: HATYAI,
  korat: KORAT,
};
