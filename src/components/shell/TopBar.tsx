"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { RAEEnvelope } from "@/lib/governance";
import { cn } from "@/lib/cn";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "../topbar/UserMenu";
import { LeagueSwitcher, type LeagueOption } from "../topbar/LeagueSwitcher";
import { systems } from "../systems";

interface Props {
  envelope: RAEEnvelope;
  active: string;
  onSelect: (system: string) => void;
  leagueOptions?: LeagueOption[];
  activeLeagueId?: string | null;
}

/**
 * Sticky application header: sidebar toggle, brand, the numbered system tab
 * strip, league switcher, account menu, and the live/fixture status badge. Laid
 * out with Tailwind utilities on a flex row that reflows cleanly down to mobile.
 */
export function TopBar({ envelope, active, onSelect, leagueOptions = [], activeLeagueId = null }: Props) {
  const navId = useId();
  const reduce = useReducedMotion();
  const mode = envelope.mode;
  const badgeClass =
    mode === "live"
      ? "border-rae-green/40 text-rae-green"
      : mode === "fixture"
        ? "border-rae-amber/40 text-rae-amber"
        : "border-rae-red/40 text-rae-red";

  return (
    <header
      aria-label="RAE primary navigation"
      className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border bg-background/85 px-3 pt-2 pb-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4"
    >
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground" />
        <Separator orientation="vertical" className="h-6" />
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-extrabold tracking-[0.14em] text-rae-blue">RAE</span>
          <span className="hidden text-[9px] uppercase leading-tight tracking-[0.16em] text-muted-foreground sm:inline">
            Reputation Arbitrage Engine
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LeagueSwitcher leagues={leagueOptions} activeLeagueId={activeLeagueId} />
          <UserMenu />
          <div
            aria-live="polite"
            aria-label={`Data mode: ${mode}. Freshness: ${envelope.sourceState.freshness}`}
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
            <span className="hidden text-muted-foreground sm:inline">
              {envelope.sourceState.freshness}
            </span>
          </div>
        </div>
      </div>

      {/* Top-level system nav — a recessed segmented rail. The active system is
          a solid slate-blue pill that slides between segments (shared-layout
          `layoutId`); the dark label sitting on the pill makes the current
          selection unmistakable. Scrolls horizontally on narrow screens. */}
      <nav
        aria-label="Top-level systems"
        className="topbar-seg flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border border-border/60 bg-secondary/30 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {systems.map((system, index) => {
          const isActive = active === system;
          return (
            <button
              key={system}
              type="button"
              onClick={() => onSelect(system)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "group relative isolate flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rae-blue/70",
                isActive ? "text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={`topbar-pill-${navId}`}
                  aria-hidden="true"
                  className="topbar-pill absolute inset-0 -z-10 rounded-lg"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
                  }
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-5 min-w-5 place-items-center rounded-md text-[10px] font-bold leading-none tabular-nums transition-colors duration-200",
                  isActive
                    ? "text-background/90"
                    : "bg-muted/70 px-1 text-muted-foreground group-hover:text-rae-blue/90"
                )}
              >
                {index + 1}
              </span>
              {system}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
