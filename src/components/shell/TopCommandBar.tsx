"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "../topbar/UserMenu";
import { LeagueSwitcher, type LeagueOption } from "../topbar/LeagueSwitcher";
import { ModeBanner } from "../governance/ModeBanner";

interface Props {
  mode: "live" | "fixture" | "unavailable";
  freshness: string;
  leagueOptions?: LeagueOption[];
  activeLeagueId?: string | null;
}

/**
 * Sticky top command bar for the multi-route app shell: sidebar toggle, brand,
 * the active-league switcher, the account menu, and the live/fixture/unavailable
 * mode badge with freshness. The route navigation lives in the sidebar/mobile
 * nav, so this bar stays slim.
 */
export function TopCommandBar({ mode, freshness, leagueOptions = [], activeLeagueId = null }: Props) {
  return (
    <header
      aria-label="RAE command bar"
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/85 px-3 py-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4"
    >
      <SidebarTrigger className="text-muted-foreground" />
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-extrabold tracking-[0.14em] text-rae-blue">RAE</span>
        <span className="hidden text-[9px] uppercase leading-tight tracking-[0.16em] text-muted-foreground md:inline">
          Reputation Arbitrage Engine
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <LeagueSwitcher leagues={leagueOptions} activeLeagueId={activeLeagueId} />
        <UserMenu />
        <ModeBanner mode={mode} freshness={freshness} />
      </div>
    </header>
  );
}
