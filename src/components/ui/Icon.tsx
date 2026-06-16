// A small, cohesive hand-styled icon set that replaces the emoji used across the
// HUD (emoji were the #1 "generic AI dashboard" tell). All glyphs share one
// language: 24×24 viewBox, 1.7px round strokes, drawn with currentColor so they
// inherit the gold / teak / jade text colour around them. Use <Icon name size/>.

import type { CSSProperties } from "react";

export type IconName =
  | "metro" | "songthaew" | "wait" | "demand" | "people" | "coverage"
  | "sound" | "mute" | "pan" | "speed" | "governor" | "team" | "money"
  | "check" | "lang" | "station" | "track" | "demolish" | "happy" | "unhappy"
  | "star" | "trophy" | "density" | "play" | "pause";

const P: Record<IconName, React.ReactNode> = {
  // EMU train front — body, window band, headlights, wheels
  metro: (
    <>
      <rect x="5" y="3.5" width="14" height="14" rx="3.5" />
      <path d="M5 9h14" />
      <path d="M8.5 13h.01M15.5 13h.01" />
      <path d="M8 17.5l-1.5 3M16 17.5l1.5 3" />
    </>
  ),
  // rod-daeng pickup — cab + covered bed + wheels
  songthaew: (
    <>
      <path d="M3 14V9h7l3 3h6a2 2 0 0 1 2 2v2h-3" />
      <path d="M3 16h4" />
      <path d="M3 9V6h7v6" />
      <circle cx="8.5" cy="17" r="1.8" /><circle cx="17.5" cy="17" r="1.8" />
    </>
  ),
  // standing person waiting
  wait: (
    <>
      <circle cx="12" cy="5.5" r="2.4" />
      <path d="M12 8v8M12 16l-3 4M12 16l3 4M8 11.5h8" />
    </>
  ),
  // target (travel demand)
  demand: (
    <>
      <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // two people (population)
  people: (
    <>
      <circle cx="8" cy="7" r="2.3" /><path d="M3.5 19c0-3 2-5 4.5-5s4.5 2 4.5 5" />
      <circle cx="16.5" cy="8" r="2" /><path d="M14 19c0-2.6 1.7-4.4 3.8-4.4 1.4 0 2.6.8 3.2 2" />
    </>
  ),
  // walk-shed catchment — pin in a coverage ring
  coverage: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.5 2.8" />
      <path d="M12 8.5a3 3 0 0 1 3 3c0 2-3 4.5-3 4.5s-3-2.5-3-4.5a3 3 0 0 1 3-3z" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3l4-3v11l-4-3H4z" />
      <path d="M15 9a4 4 0 0 1 0 6M17.5 7a7 7 0 0 1 0 10" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3l4-3v11l-4-3H4z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </>
  ),
  // open hand (pan / move map)
  pan: (
    <>
      <path d="M9 11V5.5a1.3 1.3 0 0 1 2.6 0V10" />
      <path d="M11.6 10V4.6a1.3 1.3 0 0 1 2.6 0V10" />
      <path d="M14.2 10.2V6a1.3 1.3 0 0 1 2.6 0v7c0 3.6-2.4 6.5-6 6.5-2.2 0-3.6-1-4.7-2.6L4 13.5a1.4 1.4 0 0 1 2.3-1.6L8 14" />
    </>
  ),
  // fast-forward (speed)
  speed: (
    <>
      <path d="M4 6l7 6-7 6zM13 6l7 6-7 6z" />
    </>
  ),
  // governor — Lanna chedi/temple spire
  governor: (
    <>
      <path d="M12 2.5l1.5 3.5h-3z" />
      <path d="M9.5 6h5l-1 3h-3z" />
      <path d="M8.5 9h7l-1.3 4h-4.4z" />
      <path d="M7 13h10l1 7H6z" />
    </>
  ),
  // three heads (advisory team)
  team: (
    <>
      <circle cx="7.5" cy="9" r="2" /><circle cx="16.5" cy="9" r="2" /><circle cx="12" cy="7.5" r="2.2" />
      <path d="M3.5 18c0-2.4 1.6-4 4-4M20.5 18c0-2.4-1.6-4-4-4M8 18.5c0-2.6 1.8-4.5 4-4.5s4 1.9 4 4.5" />
    </>
  ),
  // coin with a baht-ish bar
  money: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 7.5h3a2 2 0 0 1 0 4h-3zM10 11.5h3.4a2 2 0 0 1 0 4H10zM10 7.5v8M12 6v1.5M12 15.5V17" />
    </>
  ),
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  // globe (language)
  lang: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" />
    </>
  ),
  // single chedi station marker
  station: (
    <>
      <path d="M12 2.5l1.4 3h-2.8z" />
      <path d="M10 5.5h4l-1 3.5h-2z" />
      <path d="M8.5 9h7l-1.5 11h-4z" />
    </>
  ),
  // rail track
  track: (
    <>
      <path d="M7 3l-2 18M17 3l2 18" />
      <path d="M4.6 8h14.8M4.2 13h15.6M3.8 18h16.4" />
    </>
  ),
  // demolish — bin
  demolish: (
    <>
      <path d="M4 6.5h16M9 6.5V4.5h6v2M6.5 6.5l1 13.5h9l1-13.5" />
      <path d="M10 10v6M14 10v6" />
    </>
  ),
  happy: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 10h.01M15.5 10h.01" />
      <path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2" />
    </>
  ),
  unhappy: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 10h.01M15.5 10h.01" />
      <path d="M8.5 16c1-1.4 2.2-2 3.5-2s2.5.6 3.5 2" />
    </>
  ),
  star: <path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z" />,
  trophy: (
    <>
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5v1.5A3 3 0 0 0 7 9M17 5h2.5v1.5A3 3 0 0 1 17 9" />
      <path d="M12 13v3M9 20h6M9.5 20c0-1.8 1.1-3 2.5-3s2.5 1.2 2.5 3" />
    </>
  ),
  density: (
    <>
      <path d="M12 3c2.5 3 4 5 4 8a4 4 0 0 1-8 0c0-1.3.6-2.6 1.6-3.8C10.4 8 11 6 12 3z" />
    </>
  ),
  play: <path d="M7 5l12 7-12 7z" />,
  pause: <><rect x="6.5" y="5" width="3.5" height="14" rx="1" /><rect x="14" y="5" width="3.5" height="14" rx="1" /></>,
};

const FILLED: Partial<Record<IconName, boolean>> = { star: true, play: true, speed: true, governor: true, station: true, pause: true };

export function Icon({
  name,
  size = 16,
  className,
  style,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}) {
  const filled = FILLED[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.18em", flexShrink: 0, ...style }}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name]}
    </svg>
  );
}
