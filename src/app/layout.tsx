import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAE — Reputation Arbitrage Engine",
  description: "Behavioral-market intelligence operating system for fantasy football."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
