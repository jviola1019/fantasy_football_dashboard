"use client";

import type { RAEEnvelope } from "@/lib/governance";
import { cn } from "@/lib/cn";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "../topbar/UserMenu";
import { SearchInput } from "../topbar/SearchInput";
import { systems } from "../systems";

interface Props {
  envelope: RAEEnvelope;
  active: string;
  onSelect: (system: string) => void;
}

/**
 * Sticky application header: sidebar toggle, brand, the numbered system tab
 * strip, search, account menu, and the live/fixture status badge. Laid out
 * with Tailwind utilities on a flex row that reflows cleanly down to mobile.
 */
export function TopBar({ envelope, active, onSelect }: Props) {
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
      className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border bg-background/85 px-3 py-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-4"
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
          <div className="hidden lg:block">
            <SearchInput />
          </div>
          <UserMenu />
          <div
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-wide"
          >
            <Badge variant="outline" className={cn("font-semibold", badgeClass)}>
              {mode}
            </Badge>
            <span className="hidden text-muted-foreground sm:inline">
              {envelope.sourceState.freshness}
            </span>
          </div>
        </div>
      </div>

      {/* Numbered system tab strip — scrolls horizontally on narrow screens. */}
      <nav
        aria-label="Top-level systems"
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors",
                isActive
                  ? "bg-rae-amber/12 text-foreground ring-1 ring-rae-amber/40"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span className="tabular-nums text-rae-amber/80">{index + 1}</span>{" "}
              {system}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
