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
 * Controlled in-panel tab bar. A presentational swap for the old
 * `.tab-row` / `.tab-btn` markup — each panel keeps its own `useState` for the
 * active tab and just renders this for a consistent, blueprint-grade look
 * (segmented underline, horizontal scroll on overflow, full keyboard + ARIA).
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, className }: PanelTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "mb-3 flex items-center gap-1 overflow-x-auto border-b border-border",
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
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors",
              isActive
                ? "border-rae-amber text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
