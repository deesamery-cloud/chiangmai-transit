"use client";

// The Governor's advisory team UI — "the 4 ladies who assist":
//  • AdvisorIntro    — the appointment cutscene shown when a new game starts.
//  • AdvisorBriefing — the daily morning briefing (each advisor reports from the
//                      live metrics). Reopenable any time from the HUD.
// Portraits are loaded from /advisors/<id>.png with a graceful emoji fallback,
// so the feature works whether or not the generated art is present.

import { useState } from "react";
import {
  ADVISORS,
  ADVISOR_BY_ID,
  advisorBrief,
  type Advisor,
  type AdvisorId,
  type BriefTone,
} from "@/lib/advisors";
import type { SnapshotMeta, TransitLine } from "@/lib/types";

type Lang = "en" | "th";

// A round portrait with an emoji fallback if the image is missing/failed.
// `active` thickens + glows the accent ring (used by the dock's selected face).
function Face({ advisor, size, active }: { advisor: Advisor; size: number; active?: boolean }) {
  const [err, setErr] = useState(false);
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full transition-all"
      style={{
        width: size,
        height: size,
        border: `${active ? 3 : 2}px solid ${advisor.accent}`,
        boxShadow: active
          ? `0 0 0 2px var(--paper), 0 0 12px ${advisor.accent}`
          : `0 2px 10px rgba(74,50,22,0.18)`,
        background: "var(--fill-2)",
      }}
    >
      {err ? (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ fontSize: size * 0.5 }}
        >
          {advisor.emoji}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={advisor.portrait}
          alt={advisor.name}
          onError={() => setErr(true)}
          className="h-full w-full object-cover"
          style={{ objectPosition: "center 22%" }}
        />
      )}
    </div>
  );
}

const toneColor: Record<BriefTone, string> = {
  good: "var(--ride)",
  warn: "var(--warn)",
  info: "var(--muted)",
};
const toneIcon: Record<BriefTone, string> = { good: "✓", warn: "▲", info: "•" };

// ── Appointment cutscene ────────────────────────────────────────────────────
export function AdvisorIntro({
  lang,
  goalLabel,
  onDone,
}: {
  lang: Lang;
  goalLabel?: string;
  onDone: () => void;
}) {
  const t = (en: string, th: string) => (lang === "th" ? th : en);
  // step 0 = appointment briefing; steps 1..4 = meet each advisor
  const [step, setStep] = useState(0);
  const TOTAL = ADVISORS.length;
  const advance = () => (step >= TOTAL ? onDone() : setStep((s) => s + 1));

  return (
    <div className="cm-fade-in absolute inset-0 z-50 flex items-center justify-center bg-[rgba(42,28,14,0.62)] px-4">
      <div className="panel panel-accent cm-pop-in relative w-[460px] max-w-[94vw] px-7 py-6">
        <button
          className="absolute right-3 top-3 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
          onClick={onDone}
        >
          {t("Skip ✕", "ข้าม ✕")}
        </button>

        {step === 0 ? (
          <div className="text-center">
            <div className="text-3xl">🏛️</div>
            <div className="wordmark mt-2 text-[20px] leading-snug" style={{ color: "var(--gold-deep)" }}>
              {t("You are the new Governor", "ท่านคือผู้ว่าราชการคนใหม่")}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
              {t(
                "Chiang Mai has appointed you Governor. Your charge: build a public-transport network the whole city can rely on — and pull people off the jammed roads.",
                "เชียงใหม่แต่งตั้งท่านเป็นผู้ว่าราชการจังหวัด ภารกิจของท่านคือสร้างระบบขนส่งสาธารณะที่ทั้งเมืองพึ่งพาได้ — และดึงผู้คนออกจากถนนที่รถติด",
              )}
            </p>
            {goalLabel ? (
              <p className="mt-2 text-[12px] text-[var(--text)]">
                {t("Your goal: ", "เป้าหมายของท่าน: ")}
                <b style={{ color: "var(--gold-deep)" }}>{goalLabel}</b>
              </p>
            ) : null}
            <p className="mt-3 text-[12.5px] font-medium text-[var(--text)]">
              {t("Four experts will assist you. Meet your team:", "ผู้เชี่ยวชาญสี่ท่านจะคอยช่วยเหลือท่าน มาพบทีมงานกัน:")}
            </p>
          </div>
        ) : (
          (() => {
            const a = ADVISORS[step - 1];
            return (
              <div className="flex flex-col items-center text-center">
                <Face advisor={a} size={148} />
                <div className="mt-3 text-[17px] font-semibold">
                  {a.name} <span className="text-[var(--muted)]">· {a.nameTh}</span>
                </div>
                <div className="text-[12px] font-medium" style={{ color: a.accent }}>
                  {t(a.role, a.roleTh)}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text)]">
                  “{t(a.intro, a.introTh)}”
                </p>
              </div>
            );
          })()
        )}

        <button className="btn btn-accent mt-5 w-full justify-center" onClick={advance}>
          {step >= TOTAL ? t("Begin building ▶", "เริ่มสร้างเมือง ▶") : t("Next →", "ถัดไป →")}
        </button>

        {/* progress dots: appointment + one per advisor */}
        <div className="mt-3 flex justify-center gap-1.5">
          {Array.from({ length: TOTAL + 1 }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: i <= step ? "var(--accent)" : "var(--fill-2)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Daily morning briefing ──────────────────────────────────────────────────
export function AdvisorBriefing({
  lang,
  day,
  meta,
  lines,
  onClose,
}: {
  lang: Lang;
  day: number;
  meta: SnapshotMeta;
  lines: TransitLine[];
  onClose: () => void;
}) {
  const t = (en: string, th: string) => (lang === "th" ? th : en);
  return (
    <div className="cm-fade-in absolute inset-0 z-40 flex items-center justify-center bg-[rgba(42,28,14,0.5)] px-4">
      <div className="panel panel-accent cm-pop-in relative max-h-[88vh] w-[480px] max-w-[94vw] overflow-y-auto px-6 py-5 [scrollbar-width:thin]">
        <div className="flex items-start justify-between">
          <div>
            <div className="wordmark text-[17px]" style={{ color: "var(--gold-deep)" }}>
              {t(`Morning briefing · Day ${day}`, `บรีฟยามเช้า · วันที่ ${day}`)}
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              {t("Your team reports on the city", "ทีมงานรายงานสถานการณ์เมือง")}
            </div>
          </div>
          <button
            className="text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
            onClick={onClose}
          >
            {t("Close ✕", "ปิด ✕")}
          </button>
        </div>
        <div className="gold-rule my-3" />

        <div className="flex flex-col gap-3.5">
          {ADVISORS.map((a) => {
            const brief = advisorBrief(a.id, meta, lines);
            return (
              <div key={a.id} className="flex gap-3">
                <Face advisor={a} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] font-semibold">{a.name}</span>
                    <span className="text-[10.5px]" style={{ color: a.accent }}>
                      {t(a.role, a.roleTh)}
                    </span>
                  </div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {brief.map((b, i) => (
                      <li key={i} className="flex gap-1.5 text-[12px] leading-snug">
                        <span style={{ color: toneColor[b.tone] }}>{toneIcon[b.tone]}</span>
                        <span className="text-[var(--text)]">{t(b.en, b.th)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn btn-accent mt-4 w-full justify-center" onClick={onClose}>
          {t("Got it — back to work ▶", "รับทราบ — กลับไปทำงาน ▶")}
        </button>
      </div>
    </div>
  );
}

// ── Persistent advisor dock (bottom-right) ──────────────────────────────────
// The team is the game's primary advisory UI: all four faces are visible at all
// times in the bottom-right corner. Click a face → that advisor's live advice
// pops up above the dock. Click again (or ✕) to dismiss.
export function AdvisorDock({
  lang,
  meta,
  lines,
  flashDay,
  showAgents,
  onToggleAgents,
  showOD,
  onToggleOD,
  showCoverage,
  onToggleCoverage,
  muted,
  onToggleMuted,
}: {
  lang: Lang;
  meta: SnapshotMeta | null;
  lines: TransitLine[];
  flashDay?: number; // bumps when a new day starts → pulse the faces for attention
  // view toggles, parked under the advisors
  showAgents: boolean;
  onToggleAgents: () => void;
  showOD: boolean;
  onToggleOD: () => void;
  showCoverage: boolean;
  onToggleCoverage: () => void;
  muted: boolean;
  onToggleMuted: () => void;
}) {
  const t = (en: string, th: string) => (lang === "th" ? th : en);
  const [sel, setSel] = useState<AdvisorId | null>(null);
  const selAdv = sel ? ADVISOR_BY_ID[sel] : null;
  const brief = selAdv && meta ? advisorBrief(selAdv.id, meta, lines) : [];

  return (
    <div className="pointer-events-none absolute bottom-20 right-2 z-30 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4">
      {/* advice popover for the selected advisor */}
      {selAdv && (
        <div
          className="panel panel-accent cm-pop-in pointer-events-auto w-[300px] max-w-[82vw] px-4 py-3"
          style={{ borderColor: selAdv.accent }}
        >
          <div className="flex items-start gap-2.5">
            <Face advisor={selAdv} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">
                  {selAdv.name} <span className="text-[var(--muted)]">· {selAdv.nameTh}</span>
                </span>
                <button
                  className="shrink-0 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
                  onClick={() => setSel(null)}
                >
                  ✕
                </button>
              </div>
              <div className="text-[10.5px] font-medium" style={{ color: selAdv.accent }}>
                {t(selAdv.role, selAdv.roleTh)}
              </div>
            </div>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {brief.map((b, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-snug">
                <span style={{ color: toneColor[b.tone] }}>{toneIcon[b.tone]}</span>
                <span className="text-[var(--text)]">{t(b.en, b.th)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* always-visible team strip — the 4 faces + view toggles underneath */}
      <div className="panel pointer-events-auto flex flex-col gap-1.5 px-2.5 py-2">
        <div className="flex items-end gap-2">
        <div className="mr-0.5 flex flex-col items-center justify-center self-stretch pr-1.5" style={{ borderRight: "1px solid var(--line)" }}>
          <span className="text-[15px] leading-none">👥</span>
          <span className="mt-0.5 text-[8.5px] leading-tight text-[var(--muted)]">{t("Team", "ทีม")}</span>
        </div>
        {ADVISORS.map((a) => (
          <button
            key={a.id}
            className="flex flex-col items-center gap-0.5"
            onClick={() => setSel((s) => (s === a.id ? null : a.id))}
            title={`${a.name} · ${t(a.role, a.roleTh)}`}
          >
            <span key={flashDay ?? 0} className={flashDay ? "cm-pop-in" : ""}>
              <Face advisor={a} size={42} active={sel === a.id} />
            </span>
            <span
              className="text-[9px] font-medium leading-none"
              style={{ color: sel === a.id ? a.accent : "var(--muted)" }}
            >
              {a.name}
            </span>
          </button>
        ))}
        </div>
        {/* view toggles, parked under the team */}
        <div className="flex items-center justify-center gap-1.5 border-t border-[var(--line)] pt-1.5">
          <button
            className={`vtoggle ${showAgents ? "vtoggle-on" : ""}`}
            aria-pressed={showAgents}
            onClick={onToggleAgents}
            title={t("Show/hide moving people (walk · drive · ride)", "แสดง/ซ่อนผู้คน (เดิน · ขับรถ · นั่งรถไฟ)")}
          >
            👣 {t("People", "ผู้คน")}
          </button>
          <button
            className={`vtoggle ${showOD ? "vtoggle-on" : ""}`}
            aria-pressed={showOD}
            onClick={onToggleOD}
            title={t("Show/hide the travel-demand panel", "แสดง/ซ่อนแผงความต้องการเดินทาง")}
          >
            🎯 {t("Demand", "ความต้องการ")}
          </button>
          <button
            className={`vtoggle ${showCoverage ? "vtoggle-on" : ""}`}
            aria-pressed={showCoverage}
            onClick={onToggleCoverage}
            title={t("Show/hide station coverage — metro ~800 m walk-shed, songthaew only ~200 m local hail", "แสดง/ซ่อนพื้นที่ครอบคลุม — รถไฟฟ้า ~800 ม. สองแถวแค่ ~200 ม. ใกล้บ้าน")}
          >
            📐 {t("Coverage", "ครอบคลุม")}
          </button>
          <button className="vtoggle" onClick={onToggleMuted} title={t("Sound on/off", "เสียง เปิด/ปิด")}>
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>
    </div>
  );
}
