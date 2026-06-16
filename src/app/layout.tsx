import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai, Kanit, Trirong } from "next/font/google";
import "./globals.css";

// Body / UI face — Kanit covers BOTH Thai and Latin in one characterful family
// (widely used in Thai games/apps), so the interface reads native rather than a
// generic default sans.
const kanit = Kanit({
  variable: "--font-kanit",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Display / wordmark — Trirong is an elegant Thai+Latin SERIF that blends with the
// warm, painterly Lanna cinematic art (heritage feel for titles & headings).
const trirong = Trirong({
  variable: "--font-trirong",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

// (Numbers are now themed: Kanit tabular for stats, Trirong display for hero
// numbers — see --font-mono / .num-hero in globals.css. No SaaS monospace face.)

// Thai-capable fallback (covers ฿ + any glyph gaps).
const notoThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Chiang Mai Transit Planner",
  description:
    "Build a public-transport network on the real Chiang Mai map and watch commuters respond.",
};

// Mobile/touch: render at device width (was defaulting to a desktop-width page on
// phones). Allow pinch-zoom of the map up to 5× for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#efe3cf",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${kanit.variable} ${trirong.variable} ${notoThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
