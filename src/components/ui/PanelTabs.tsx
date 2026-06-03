"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

interface PanelTabsProps {
  tabs: readonly string[];
  active: string;
  onSelect: (tab: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Controlled in-panel tab bar, styled as a recessed segmented control. The
 * active segment is marked by a single slate-blue pill that slides between
 * tabs via a Framer Motion shared-layout animation (`layoutId`) — so switching
 * tabs reads as one continuous control rather than a set of toggling buttons.
 *
 * `useId()` namespaces the `layoutId` per instance: two PanelTabs on screen
 * (e.g. Player Universe + Market Intelligence) animate independently instead
 * of the pill flying across panels. Honors `prefers-reduced-motion` by
 * dropping the slide to an instant cross-fade.
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, className }: PanelTabsProps) {
  const layoutId = useId();
  const reduce = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "panel-tabs mb-3 inline-flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-border/70 bg-secondary/40 p-1.5",
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
              "relative shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-[0.07em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rae-blue/70",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`panel-tab-pill-${layoutId}`}
                aria-hidden="true"
                className="panel-tab-pill absolute inset-0 rounded-[6px]"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 480, damping: 38, mass: 0.7 }
                }
              />
            )}
            <span className="relative z-[1]">{tab}</span>
          </button>
        );
      })}
    </div>
  );
}
