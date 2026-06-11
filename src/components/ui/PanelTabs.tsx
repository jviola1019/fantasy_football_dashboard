"use client";

import { useId, useRef } from "react";
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
 * Controlled in-panel tab bar — a recessed segmented control with a single
 * slate-blue pill that slides between segments (Framer Motion `layoutId`), so
 * switching reads as one continuous instrument rather than a row of toggling
 * buttons.
 *
 * Accessibility: a WAI-ARIA tablist with **roving tabindex** and full keyboard
 * support — ←/→ (and ↑/↓) move to and select the adjacent tab, Home/End jump to
 * the first/last, wrapping at the ends (automatic-activation pattern, since
 * switching a panel is cheap). Only the active tab is in the Tab order; the
 * focus ring is deliberately stronger than hover. `useId()` namespaces the
 * `layoutId` per instance so two tab bars on screen animate independently, and
 * the slide collapses to an instant swap under `prefers-reduced-motion`.
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, className }: PanelTabsProps) {
  const layoutId = useId();
  const reduce = useReducedMotion();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusSelect = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (tab === undefined) return;
    onSelect(tab);
    btnRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusSelect(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusSelect(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusSelect(0);
        break;
      case "End":
        e.preventDefault();
        focusSelect(tabs.length - 1);
        break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        "panel-tabs mb-3 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border/70 p-1.5",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {tabs.map((tab, index) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            ref={(el) => {
              btnRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative isolate shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-[0.07em]",
              // ≥44px touch target on coarse pointers (WCAG 2.2 / audit F-10);
              // desktop keeps the denser 36px row.
              "pointer-coarse:min-h-11",
              "transition-[color,background-color,transform] duration-200 active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rae-blue focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
              isActive
                ? "text-background"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`panel-tab-pill-${layoutId}`}
                aria-hidden="true"
                className="panel-tab-pill absolute inset-0 -z-10 rounded-lg"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 480, damping: 38, mass: 0.7 }
                }
              />
            )}
            <span className="relative">{tab}</span>
          </button>
        );
      })}
    </div>
  );
}
