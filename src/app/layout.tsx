import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/* Self-hosted via next/font (build-time): eliminates the render-blocking
   fonts.googleapis.com round-trip the CSS @import caused, and applies a
   size-adjusted fallback to minimise CLS. Same families/weights as before —
   the editorial stack (Bricolage Grotesque + IBM Plex Sans/Mono) is unchanged.
   Each font exposes a CSS variable consumed by globals.css. */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage"
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-plex-sans"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono"
});

export const metadata: Metadata = {
  // Template so every route gets a distinct tab title (WCAG 2.4.2 — audit
  // 2026-07-08 F-10); pages set `metadata.title` to just their name.
  title: {
    default: "RAE — Reputation Arbitrage Engine",
    template: "%s — RAE"
  },
  description: "Behavioral-market intelligence operating system for fantasy football."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
