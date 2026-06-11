"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

interface PanelTabsProps {
  tabs: readonly string[];
  active: string;
  onSelect: (tab: string) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Controlled in-panel tab bar — a quiet underline/rail control: a row of plain
 * text tabs sharing a hairline baseline, the active one marked by a single
 * accent underline. No pill, no fill, no motion — it reads as instrument-panel
 * chrome that recedes behind the data, not a SaaS segmented control. (Replaced
 * the sliding Framer-Motion pill; dropping that import also trims the panel's
 * hydration/JS cost.)
 *
 * Accessibility: a WAI-ARIA tablist with **roving tabindex** and full keyboard
 * support — ←/→ (and ↑/↓) move to and select the adjacent tab, Home/End jump to
 * the first/last, wrapping at the ends (automatic-activation pattern, since
 * switching a panel is cheap). Only the active tab is in the Tab order; the
 * focus ring is deliberately stronger than the active underline. On coarse
 * pointers each tab is ≥44px tall (WCAG 2.2 target size).
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, className }: PanelTabsProps) {
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
        "panel-tabs mb-4 flex max-w-full items-stretch gap-5 overflow-x-auto border-b border-border/60",
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
              // -mb-px overlaps the container hairline so the active underline
              // sits exactly on the baseline rather than floating above it.
              "relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] font-medium tracking-tight",
              "pointer-coarse:min-h-11 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rae-blue focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
              isActive
                ? "border-rae-blue text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
