// Chiang Mai's REAL songthaew (rod daeng / red truck) system, approximated as
// route corridors within the map's CBD so a new game can start from "the network
// that already exists" instead of a blank city. Chiang Mai songthaews hub at
// Warorot Market and run colour-coded directions: red roam the old-city centre,
// and fixed colours fan out — north (Chang Phueak / Mae Jo), south (Sarapee /
// Lamphun), west (Nimman / CMU / Suthep), east (railway / San Kamphaeng) and
// south-west (airport / Hang Dong). These are stylised corridors (snapped to the
// road graph + A*-routed at build time), not surveyed GPS traces.
// Sources: chiangmaitravelhub.com, chiangmaitraveller.com (songthaew guides).

import { LINE_COLORS } from "@/lib/config";

const C = (name: string) => LINE_COLORS.find((c) => c.name === name)!.rgb;

export interface SongthaewCorridor {
  name: string;
  nameTh: string;
  color: [number, number, number];
  points: { lon: number; lat: number }[];
}

const P = (lon: number, lat: number) => ({ lon, lat });

// Warorot Market — the central hub everything radiates from (~18.7905, 98.9930)
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
