import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Dashboard layout primitives — one coherent spacing scale (Tailwind's 4px
 * base) replaces the old ad-hoc 6/8/10/14px pixel gaps.
 *
 *   <PanelGrid>          vertical stack, consistent outer padding + row gap
 *     <PanelRow cols=2>  Command Center + Market Intelligence
 *     <PanelRow cols=3>  Player / Narrative / Nexus
 *     <PanelRow cols=1>  Draft Intelligence (full width)
 *     <PanelRow cols=3>  Pre-Draft / Waiver / Trade
 *   </PanelGrid>
 *
 * Every row collapses to a single column below the `lg` breakpoint, so the
 * dashboard reflows cleanly from ultrawide down to mobile.
 */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 p-3 sm:p-4">{children}</div>;
}

type RowCols = 1 | 2 | 3;

const ROW_CLASS: Record<RowCols, string> = {
  1: "grid grid-cols-1 gap-4",
  // Command Center is the hero panel — slightly wider on xl screens.
  2: "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]",
  3: "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3"
};

export function PanelRow({
  cols,
  children,
  className
}: {
  cols: RowCols;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(ROW_CLASS[cols], className)}>{children}</div>;
}
