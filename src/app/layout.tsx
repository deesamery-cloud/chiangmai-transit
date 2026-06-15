import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Thai, Chonburi } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// proper Thai glyphs (was falling back to a Latin font)
const notoThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

// Lanna-flavoured heritage display face for the wordmark + headings (Latin);
// Thai display text gracefully falls back to Noto Sans Thai via the stack.
const chonburi = Chonburi({
  variable: "--font-chonburi",
  subsets: ["latin"],
  weight: "400",
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
      className={`${geistSans.variable} ${geistMono.variable} ${notoThai.variable} ${chonburi.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
