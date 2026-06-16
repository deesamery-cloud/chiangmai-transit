// The Governor's advisory team — the "4 ladies who assist". Each is a domain
// expert who gives a short MORNING BRIEFING derived from the live simulation
// metrics (so their words always reflect the real state of the city):
//   • Ploy   — Metro engineer: trunk-line health, crowding, where to grow.
//   • Napha  — Songthaew expert: feeder coverage / last-mile, overcrowding.
//   • Kanya  — Financial advisor: treasury, daily profit/loss, ridership.
//   • Mali   — City representative: speaks for residents — unmet journeys.
// The briefing data already exists in SnapshotMeta; this module is the narrative
// layer that turns it into each advisor's voice. Portraits live in /advisors/.

import { PEOPLE_PER_AGENT } from "@/lib/config";
import type { SnapshotMeta, TransitLine } from "@/lib/types";

export type AdvisorId = "metro" | "songthaew" | "finance" | "city";

export interface Advisor {
  id: AdvisorId;
  name: string; // given name (shown in both languages)
  nameTh: string;
  role: string;
  roleTh: string;
  accent: string; // hex — the advisor's colour
  emoji: string; // fallback avatar if the portrait image is missing
  portrait: string; // /advisors/<id>.png
  intro: string; // line spoken during the appointment cutscene
  introTh: string;
}

export const ADVISORS: Advisor[] = [
  {
    id: "metro",
    name: "Ploy",
    nameTh: "พลอย",
    role: "Metro engineer",
    roleTh: "วิศวกรรถไฟฟ้า",
    accent: "#7a5ad6",
    emoji: "🚆",
    portrait: "/advisors/metro.jpg",
    intro:
      "I'll plan our metro trunk lines, Governor — the fast backbone. Each morning I'll tell you what's running well and where to lay track next.",
    introTh:
      "ดิฉันจะวางแผนสายรถไฟฟ้าหลักให้ค่ะท่านผู้ว่าฯ — กระดูกสันหลังที่เร็วที่สุด ทุกเช้าจะรายงานว่าอะไรดีและควรวางรางต่อตรงไหน",
  },
  {
    id: "songthaew",
    name: "Napha",
    nameTh: "นภา",
    role: "Songthaew (rod daeng) expert",
    roleTh: "ผู้เชี่ยวชาญสองแถว",
    accent: "#d6493a",
    emoji: "🛻",
    portrait: "/advisors/songthaew.jpg",
    intro:
      "The red trucks reach every little lane the trains can't. Every morning I'll brief you on our feeders — what's working and what needs fixing.",
    introTh:
      "รถแดงเข้าถึงทุกซอยที่รถไฟไปไม่ถึงค่ะ ทุกเช้าดิฉันจะสรุปสายรองให้ — อะไรเวิร์ก อะไรต้องปรับ",
  },
  {
    id: "finance",
    name: "Kanya",
    nameTh: "กัญญา",
    role: "Financial advisor",
    roleTh: "ที่ปรึกษาการเงิน",
    accent: "#2f8f6b",
    emoji: "💰",
    portrait: "/advisors/finance.jpg",
    intro:
      "I'll keep the books, Governor — total rides, coverage, money spent, revenue and expenses. I'll summarise the numbers for you each day.",
    introTh:
      "ดิฉันดูแลบัญชีค่ะ — ยอดผู้โดยสาร ความครอบคลุม เงินที่ใช้ รายรับรายจ่าย จะสรุปตัวเลขให้ทุกวัน",
  },
  {
    id: "city",
    name: "Mali",
    nameTh: "มะลิ",
    role: "City representative",
    roleTh: "ตัวแทนชาวเมือง",
    accent: "#c8962b",
    emoji: "🏘️",
    portrait: "/advisors/city.jpg",
    intro:
      "I speak for the people, Governor. Each day I'll tell you where residents still can't go by bus or train — so we build where it truly matters.",
    introTh:
      "ดิฉันเป็นปากเสียงให้ชาวเมืองค่ะ ทุกวันจะบอกว่าผู้คนยังเดินทางด้วยขนส่งสาธารณะไปไหนไม่ได้ — เพื่อให้เราสร้างตรงจุดที่สำคัญจริง",
  },
];

export const ADVISOR_BY_ID: Record<AdvisorId, Advisor> = Object.fromEntries(
  ADVISORS.map((a) => [a.id, a]),
) as Record<AdvisorId, Advisor>;

export type BriefTone = "good" | "warn" | "info";
export interface BriefLine {
  tone: BriefTone;
  en: string;
  th: string;
}

// --- local formatters (mirror page.tsx so the briefing reads at city scale) ---
const ppl = (n: number) => Math.round(n * PEOPLE_PER_AGENT).toLocaleString("en-US");
function money(v: number): string {
  if (!isFinite(v)) return "∞";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}฿${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}฿${Math.round(a / 1e3)}k`;
  return `${s}฿${Math.round(a)}`;
}

/**
 * Build one advisor's morning briefing from the live snapshot. Returns 1-3
 * bilingual lines, each tagged good / warn / info for colour.
 */
export function advisorBrief(
  id: AdvisorId,
  meta: SnapshotMeta,
  lines: TransitLine[],
): BriefLine[] {
  const out: BriefLine[] = [];
  if (id === "metro") {
    const metroLines = lines.filter((l) => l.mode === "metro");
    const per = (meta.perLine ?? []).filter((p) => p.mode === "metro");
    if (metroLines.length === 0) {
      out.push({
        tone: "info",
        en: "We have no metro trunk yet, Governor. The metro is our backbone — place stations along a busy corridor and connect them with track.",
        th: "เรายังไม่มีสายรถไฟฟ้าหลักเลยค่ะท่านผู้ว่าฯ รถไฟฟ้าคือกระดูกสันหลัง — วางสถานีตามแนวที่คนพลุกพล่านแล้วเชื่อมด้วยราง",
      });
      return out;
    }
    const riders = per.reduce((s, p) => s + p.riders, 0);
    out.push({
      tone: "good",
      en: `${metroLines.length} metro line${metroLines.length > 1 ? "s" : ""} running, carrying ${ppl(riders)} riders right now.`,
      th: `มีรถไฟฟ้า ${metroLines.length} สายวิ่งอยู่ บรรทุกผู้โดยสาร ${ppl(riders)} คนในขณะนี้`,
    });
    const crowded = per.filter((p) => p.waiting > 50 && p.util > 0.85);
    if (crowded.length) {
      out.push({
        tone: "warn",
        en: `${crowded.length} line${crowded.length > 1 ? "s are" : " is"} packed — riders are stuck waiting. Add trains (＋) or a parallel line.`,
        th: `มี ${crowded.length} สายแน่นมาก — ผู้โดยสารตกค้างรอ ควรเพิ่มขบวน (＋) หรือสร้างสายขนาน`,
      });
    } else if (per.length && per.every((p) => p.util < 0.25)) {
      out.push({
        tone: "info",
        en: "Loads are light — there's room to grow. Extend toward busier corridors to fill the trains.",
        th: "ผู้โดยสารยังบางอยู่ — มีที่ให้โต ลองขยายไปยังเส้นทางที่คนเยอะเพื่อเติมขบวน",
      });
    }
    out.push({
      tone: "info",
      en: `Coverage of the city: ${Math.round(meta.coverage)}% of homes are within walking distance of a stop.`,
      th: `ความครอบคลุม: บ้าน ${Math.round(meta.coverage)}% อยู่ในระยะเดินถึงสถานี`,
    });
    return out;
  }
  if (id === "songthaew") {
    const st = lines.filter((l) => l.mode === "songthaew");
    const per = (meta.perLine ?? []).filter((p) => p.mode === "songthaew");
    if (st.length === 0) {
      out.push({
        tone: "info",
        en: "No songthaew feeders yet, Governor. They're dirt-cheap and reach the thin streets a metro can't — draw a route feeding a metro station for last-mile coverage.",
        th: "ยังไม่มีสองแถวสายรองค่ะ มันถูกมากและเข้าถึงซอยเล็กที่รถไฟไปไม่ได้ — ลองวาดเส้นทางป้อนเข้าสถานีรถไฟฟ้าเพื่อเก็บระยะสุดท้าย",
      });
      return out;
    }
    const riders = per.reduce((s, p) => s + p.riders, 0);
    out.push({
      tone: "good",
      en: `${st.length} songthaew route${st.length > 1 ? "s" : ""} on the roads, carrying ${ppl(riders)} riders.`,
      th: `มีสองแถว ${st.length} สายวิ่งอยู่บนถนน บรรทุกผู้โดยสาร ${ppl(riders)} คน`,
    });
    const crowded = per.filter((p) => p.waiting > 50 && p.util > 0.85);
    if (crowded.length) {
      out.push({
        tone: "warn",
        en: "A feeder is overcrowding on a busy corridor — the little trucks can't be a trunk. Let metro carry the heavy line; keep songthaew for last-mile.",
        th: "สายรองแน่นเกินบนเส้นทางหลัก — รถเล็กรับเป็นสายหลักไม่ไหว ให้รถไฟฟ้ารับสายหนัก เก็บสองแถวไว้สำหรับระยะสั้น",
      });
    } else {
      out.push({
        tone: "info",
        en: "Feeders are healthy — they funnel riders into the metro from areas a trunk can't reach.",
        th: "สายรองแข็งแรงดี — ช่วยป้อนผู้โดยสารเข้ารถไฟฟ้าจากพื้นที่ที่สายหลักเข้าไม่ถึง",
      });
    }
    return out;
  }
  if (id === "finance") {
    const net = meta.dailyRevenue - meta.dailyOpex;
    out.push({
      tone: "info",
      en: `Treasury balance: ${money(meta.budget)}. Boardings: ${ppl(meta.dailyRiders)}/day.`,
      th: `เงินคงคลัง: ${money(meta.budget)} · ผู้โดยสาร: ${ppl(meta.dailyRiders)} คน/วัน`,
    });
    out.push({
      tone: net >= 0 ? "good" : "warn",
      en: `Daily ${net >= 0 ? "profit" : "loss"}: ${money(net)}/day — revenue ${money(meta.dailyRevenue)} minus operating ${money(meta.dailyOpex)}.`,
      th: `${net >= 0 ? "กำไร" : "ขาดทุน"}รายวัน: ${money(net)}/วัน — รายรับ ${money(meta.dailyRevenue)} ลบค่าเดินรถ ${money(meta.dailyOpex)}`,
    });
    if (meta.budget < 0) {
      out.push({
        tone: "warn",
        en: "We're in the red, and debt accrues interest. Raise a fare or trim a fleet before it spirals.",
        th: "เราติดลบ และหนี้มีดอกเบี้ย ควรขึ้นค่าโดยสารหรือลดขบวนก่อนบานปลาย",
      });
    } else if (net < 0) {
      out.push({
        tone: "info",
        en: "We're spending more than we earn each day — fine while building, but watch the trend.",
        th: "เราจ่ายมากกว่ารับในแต่ละวัน — ช่วงสร้างพอได้ แต่ต้องจับตาแนวโน้ม",
      });
    }
    return out;
  }
  // city representative
  const served = Math.round((meta.odServedFrac ?? 0) * 100);
  out.push({
    tone: served >= 45 ? "good" : "info",
    en: `Transit now serves ${served}% of the city's daily journeys (${meta.odMetCount}/${meta.odTotalCount} corridors).`,
    th: `ขนส่งสาธารณะตอบโจทย์การเดินทาง ${served}% ของเมือง (${meta.odMetCount}/${meta.odTotalCount} เส้นทาง)`,
  });
  const unmet = (meta.odUnmet ?? []).slice(0, 2);
  for (const c of unmet) {
    out.push({
      tone: "warn",
      en: `People still can't get from ${c.oName} to ${c.dName} without a car — please build there.`,
      th: `ผู้คนยังไปจาก ${c.oName} ไป ${c.dName} โดยไม่ใช้รถยนต์ไม่ได้ — ขอให้สร้างตรงนั้นด้วยค่ะ`,
    });
  }
  if (!unmet.length) {
    out.push({
      tone: "good",
      en: "Residents are pleased — nearly every journey has a good transit option now.",
      th: "ชาวเมืองพอใจค่ะ — เกือบทุกการเดินทางมีขนส่งสาธารณะที่ดีแล้ว",
    });
  }
  return out;
}
