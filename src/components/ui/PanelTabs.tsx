"use client";

import { cn } from "@/lib/cn";

interface PanelTabsProps {
  tabs: readonly string[];
  active: string;
  onSelect: (tab: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Controlled in-panel tab bar. Each tab is a fully-outlined chip — the active
 * one is ringed in the accent colour with a tinted fill — so the tab strip
 * reads clearly as a segmented control. Each panel keeps its own `useState`
 * for the active tab and renders this for a consistent look (horizontal
 * scroll on overflow, full keyboard + ARIA).
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, className }: PanelTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "mb-3 flex items-center gap-1.5 overflow-x-auto pb-0.5",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md border-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.06em] transition-colors",
              isActive
                ? "border-rae-amber bg-rae-amber/10 text-foreground"
                : "border-border text-muted-foreground hover:border-ring/60 hover:text-foreground"
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
