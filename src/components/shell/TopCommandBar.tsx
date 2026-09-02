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
    // `flex-wrap` is load-bearing at 320px. The right-hand cluster — league
    // switcher, Mock draft / Sign in, and the live/fixture badge — is 248px on
    // its own, which pushed the document 52px wider than the viewport on EVERY
    // route, not just /analytics as previously recorded. Wrapping to a second
    // row fixes it without hiding anything: hiding the mode badge was not an
    // option, because CLAUDE.md requires the fixture/live state to stay visible.
    <header
      aria-label="RAE command bar"
      // Opaque. Same reasoning as the mobile nav: a translucent blurred bar
      // makes the legibility of the controls a function of the content
      // scrolling behind them.
      className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-3 py-2 sm:flex-nowrap sm:px-4"
    >
      <SidebarTrigger className="text-muted-foreground" />
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-[0.14em] text-rae-blue">RAE</span>
        <span className="hidden text-micro uppercase leading-tight tracking-[0.16em] text-muted-foreground md:inline">
          Roster Analytics Engine
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
