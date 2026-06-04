"use client";

import { cn } from "@/lib/cn";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "../topbar/UserMenu";
import { LeagueSwitcher, type LeagueOption } from "../topbar/LeagueSwitcher";

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
  const badgeClass =
    mode === "live"
      ? "border-rae-green/40 text-rae-green"
      : mode === "fixture"
        ? "border-rae-amber/40 text-rae-amber"
        : "border-rae-red/40 text-rae-red";

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
        <div
          aria-live="polite"
          aria-label={`Data mode: ${mode}. Freshness: ${freshness}`}
          className="flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-wide"
        >
          <Badge
            variant="outline"
            className={cn("font-semibold", badgeClass)}
            aria-label={mode === "live" ? "Live data" : mode === "fixture" ? "Demo fixture data" : "Data unavailable"}
          >
            {mode === "live" && (
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rae-green animate-[live-dot_2.5s_ease-in-out_infinite]"
              />
            )}
            {mode}
          </Badge>
          <span className="hidden text-muted-foreground lg:inline">{freshness}</span>
        </div>
      </div>
    </header>
  );
}
