"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RouteSidebar } from "./RouteSidebar";
import { TopCommandBar } from "./TopCommandBar";
import { MobileBottomNav } from "./MobileBottomNav";
import type { LeagueOption } from "../topbar/LeagueSwitcher";

interface Props {
  mode: "live" | "fixture" | "unavailable";
  freshness: string;
  leagueOptions?: LeagueOption[];
  activeLeagueId?: string | null;
  /** Server-rendered governance banners (DemoBanner + GovernanceBanner). */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * Responsive app shell wrapping every route in `(app)`: a collapsible route
 * sidebar, a sticky top command bar (league switcher / account / mode badge),
 * the always-visible governance banner slot, the route content, and a mobile
 * bottom nav. One shell, every route — so chrome + governance never drift.
 */
export function AppShell({ mode, freshness, leagueOptions = [], activeLeagueId = null, banner, children }: Props) {
  return (
    <SidebarProvider>
      {/* Skip link. axe passes without one because landmarks satisfy its
          `bypass` rule, but a keyboard user still traversed the sidebar trigger,
          a 9-item numbered route sidebar, the league switcher and the user menu
          before reaching content — on EVERY route. Audit 2026-08-22. */}
      <a href="#rae-main" className="skip-link">
        Skip to main content
      </a>
      <RouteSidebar />
      <SidebarInset>
        <TopCommandBar
          mode={mode}
          freshness={freshness}
          leagueOptions={leagueOptions}
          activeLeagueId={activeLeagueId}
        />
        {/* pb-16 on mobile clears the fixed bottom nav; removed at md. */}
        <main id="rae-main" tabIndex={-1} className="flex-1 px-3 pb-16 pt-2 sm:px-4 md:pb-4">
          {banner}
          {children}
        </main>
        <MobileBottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
