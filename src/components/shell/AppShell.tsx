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
      <RouteSidebar />
      <SidebarInset>
        <TopCommandBar
          mode={mode}
          freshness={freshness}
          leagueOptions={leagueOptions}
          activeLeagueId={activeLeagueId}
        />
        {/* pb-16 on mobile clears the fixed bottom nav; removed at md. */}
        <div className="flex-1 px-3 pb-16 pt-2 sm:px-4 md:pb-4">
          {banner}
          {children}
        </div>
        <MobileBottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
