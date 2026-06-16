"use client";

// A ~60-second cinematic opening that plays when the game is launched: how you
// become the Governor of Chiang Mai. Six painted scenes (Magnific-generated)
// drift with a Ken-Burns motion + crossfade, bilingual narration rises in the
// lower third, cinematic letterbox bars, a progress timeline, and Skip. Click
// anywhere to advance a scene; the final title card has a Begin button.
// Falls back to a warm gradient per scene if an image is missing.

import { useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/sfx";

type Lang = "en" | "th";

interface Scene {
  img: string;
  fallback: string; // gradient if the image fails
  en: string;
  th: string;
  dur: number; // ms on screen
}

const SCENES: Scene[] = [
  {
    img: "/cinematic/1.jpg",
    fallback: "linear-gradient(160deg,#f3d68e,#c8962b,#8a5a1e)",
    en: "Chiang Mai — a city of temples, mountains, and a million journeys a day.",
    th: "เชียงใหม่ — เมืองแห่งวัด ขุนเขา และการเดินทางนับล้านครั้งในแต่ละวัน",
    dur: 11000,
  },
  {
    img: "/cinematic/2.jpg",
    fallback: "linear-gradient(160deg,#b5462e,#7a2e1e,#2e2113)",
    en: "But its roads are drowning in traffic. The whole city is grinding to a halt.",
    th: "แต่ทุกถนนกำลังจมอยู่ในการจราจร เมืองทั้งเมืองเกือบหยุดนิ่ง",
    dur: 11000,
  },
  {
    img: "/cinematic/3.jpg",
    fallback: "linear-gradient(160deg,#d9a441,#8a5a1e,#2e2113)",
    en: "Today, the people turn to you. You are appointed Governor.",
    th: "วันนี้ ประชาชนหันมาหาคุณ — คุณได้รับการแต่งตั้งเป็น ‘ผู้ว่าราชการจังหวัด’",
    dur: 11000,
  },
  {
    img: "/cinematic/4.jpg",
    fallback: "linear-gradient(160deg,#e8c074,#c8962b,#5e4410)",
    en: "The future of Chiang Mai is now in your hands.",
    th: "อนาคตของเชียงใหม่อยู่ในมือคุณแล้ว",
    dur: 10000,
  },
  {
    img: "/cinematic/5.jpg",
    fallback: "linear-gradient(160deg,#7fd6b0,#2f8f6b,#1e5a44)",
    en: "Build a transit network the whole city can rely on — and win it back from the cars.",
    th: "สร้างระบบขนส่งที่ทั้งเมืองพึ่งพาได้ — และทวงเมืองคืนจากรถยนต์",
    dur: 11000,
  },
  {
    img: "/cinematic/6.jpg",
    fallback: "linear-gradient(160deg,#3a2a5a,#c8962b,#2e2113)",
    en: "Your term begins now.",
    th: "วาระของคุณเริ่มต้นแล้ว",
    dur: 7000,
  },
];

export function OpeningCinematic({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const t = (en: string, th: string) => (lang === "th" ? th : en);
  const [i, setI] = useState(0);
  const last = SCENES.length - 1;
  const doneRef = useRef(false);
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };

  // auto-advance through the scenes; the final title card ends the cinematic
  useEffect(() => {
    const dur = SCENES[i].dur;
    const id = setTimeout(() => {
      if (i >= last) finish();
      else setI((s) => s + 1);
    }, dur);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const advance = () => { if (i >= last) finish(); else setI((s) => s + 1); };

  return (
    <div
      className="absolute inset-0 z-[60] select-none overflow-hidden bg-black"
      onClick={advance}
      role="presentation"
    >
      {/* stacked scenes, crossfaded by opacity; the active one gets Ken-Burns */}
      {SCENES.map((sc, idx) => (
        <div
          key={idx}
          className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
          style={{ opacity: idx === i ? 1 : 0 }}
        >
          <div
            key={idx === i ? `on-${idx}` : `off-${idx}`}
            className={idx === i ? "cm-cine-img absolute inset-0" : "absolute inset-0"}
            style={
              {
                background: sc.fallback,
                "--cine-dur": `${sc.dur + 1500}ms`,
              } as React.CSSProperties
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sc.img}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              draggable={false}
            />
          </div>
        </div>
      ))}

      {/* cinematic vignette + warm grade so text always reads */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 35%, transparent 40%, rgba(20,12,4,0.55) 100%)" }} />
      {/* letterbox bars */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[7vh] bg-black" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[7vh] bg-black" />

      {/* skip */}
      <button
        className="absolute right-4 top-[calc(7vh+12px)] z-10 rounded-full border border-white/30 bg-black/30 px-3 py-1 text-[12px] font-medium text-white/90 backdrop-blur transition-colors hover:bg-black/55"
        onClick={(e) => { e.stopPropagation(); finish(); }}
      >
        {t("Skip ⏭", "ข้าม ⏭")}
      </button>

      {/* narration / title */}
      <div className="absolute inset-x-0 bottom-[10vh] flex flex-col items-center px-6 text-center">
        {i < last ? (
          <>
            <p key={`th-${i}`} className="cm-cine-cap max-w-[860px] text-balance text-[20px] font-semibold leading-snug text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] sm:text-[26px]">
              {t(SCENES[i].en, SCENES[i].th)}
            </p>
            <p key={`alt-${i}`} className="cm-cine-cap-2 mt-2 max-w-[760px] text-[12.5px] leading-snug text-white/70 drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] sm:text-[14px]">
              {t(SCENES[i].th, SCENES[i].en)}
            </p>
          </>
        ) : (
          <div
            className="flex flex-col items-center rounded-2xl px-10 py-6"
            style={{ background: "radial-gradient(ellipse at center, rgba(10,6,2,0.62), rgba(10,6,2,0.12) 75%, transparent)" }}
          >
            <div className="cm-cine-title wordmark text-[40px] leading-[1.1] drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)] sm:text-[58px]" style={{ color: "#fff" }}>
              เชียงใหม่ <span style={{ color: "var(--gold)" }}>Transit</span>
            </div>
            <p className="cm-cine-cap-2 mt-3 text-[16px] font-medium text-white/90 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
              {t(SCENES[last].en, SCENES[last].th)}
            </p>
            <button
              className="btn btn-accent cm-cine-cap-2 mt-5 px-7 py-2.5 text-[15px] font-semibold"
              onClick={(e) => { e.stopPropagation(); try { playSfx("gong"); } catch {} finish(); }}
            >
              {t("▶ Begin your term", "▶ เริ่มวาระของคุณ")}
            </button>
          </div>
        )}
      </div>

      {/* progress timeline */}
      <div className="absolute inset-x-0 bottom-[calc(7vh+10px)] flex justify-center gap-1.5 px-6">
        {SCENES.map((_, idx) => (
          <span
            key={idx}
            className="h-[3px] w-10 max-w-[12vw] overflow-hidden rounded-full bg-white/25"
          >
            <span
              className="block h-full rounded-full bg-[var(--gold)] transition-[width] duration-300"
              style={{ width: idx < i ? "100%" : idx === i ? "100%" : "0%", transitionDuration: idx === i ? `${SCENES[idx].dur}ms` : "300ms", transitionTimingFunction: "linear" }}
            />
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(7vh+22px)] text-center text-[10.5px] text-white/45">
        {t("click to continue", "คลิกเพื่อไปต่อ")}
      </div>
    </div>
  );
}
