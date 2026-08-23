"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

interface PanelTabsProps {
  tabs: readonly string[];
  active: string;
  onSelect: (tab: string) => void;
  ariaLabel: string;
  /**
   * Stable prefix for the generated tab / tabpanel ids. Required, because the
   * relationship between a tab and the content it controls has to be stated in
   * the markup — see `TabPanel` below.
   */
  idBase: string;
  className?: string;
}

/** Slug for a tab label, so ids stay stable and valid across renders. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function tabId(idBase: string, tab: string): string {
  return `${idBase}-tab-${slug(tab)}`;
}

export function tabPanelId(idBase: string, tab: string): string {
  return `${idBase}-panel-${slug(tab)}`;
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
 *
 * `aria-controls` / `role="tabpanel"` added 2026-08-22 (design audit D-9).
 * Every tab in the product declared `role="tab"` with NO `role="tabpanel"` and
 * no `aria-controls` anywhere: a screen-reader user activated a tab, heard the
 * selection change, and then tabbed into unlabelled content with no stated
 * relationship to the control they had just used. axe does not flag this —
 * `aria-controls` is advisory in its ruleset — so it passed every scan while
 * being the single worst thing about the product for a keyboard-only or
 * screen-reader user. Pair every `<PanelTabs>` with a `<TabPanel>`.
 */
export function PanelTabs({ tabs, active, onSelect, ariaLabel, idBase, className }: PanelTabsProps) {
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
            id={tabId(idBase, tab)}
            aria-controls={tabPanelId(idBase, tab)}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // -mb-px overlaps the container hairline so the active underline
              // sits exactly on the baseline rather than floating above it.
              "relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium tracking-tight",
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

/**
 * The region a tab controls. Renders the ARIA relationship the tablist promises
 * and gives the panel a tab stop, so the reading order after activating a tab is
 * the content that just changed rather than whatever happens to come next.
 */
export function TabPanel({
  idBase,
  active,
  children,
  className
}: {
  idBase: string;
  active: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idBase, active)}
      aria-labelledby={tabId(idBase, active)}
      tabIndex={0}
      className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rae-blue", className)}
    >
      {children}
    </div>
  );
}
