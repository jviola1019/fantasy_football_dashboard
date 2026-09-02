import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { RAEEnvelope } from "@/lib/governance";
import { SourceFreshnessBadge } from "@/components/governance/SourceFreshnessBadge";

interface PanelCardProps {
  /** Section id — doubles as the scroll anchor target for the nav. */
  id: string;
  /** id of the <h2>, referenced by aria-labelledby. */
  titleId: string;
  title: string;
  eyebrow?: string;
  /** Right-aligned header controls (tab ranges, run buttons, badges…). */
  controls?: ReactNode;
  /**
   * Per-panel provenance (UX-06). When provided, the panel chrome renders the
   * source · freshness · confidence · validation badge.
   *
   * PASS THIS ONLY WHEN THE PANEL'S LINEAGE DIFFERS from the route-level
   * governance strip — a per-record source (`DraftIntelligence`) or an upstream
   * feed the envelope does not describe (`TradeCenter`). Six panels used to pass
   * `envelope.sourceState`, which is the exact value the banner directly above
   * them already states, so a single route rendered the same provenance line up
   * to six times. Repetition is not disclosure; it trains the reader to skip the
   * thing they most need to read. Design audit 2026-08-22.
   */
  source?: RAEEnvelope["sourceState"];
  children: ReactNode;
  className?: string;
}

/**
 * The standard shell every route panel renders inside. One source of truth for
 * panel padding, border, radius, shadow, and the header layout — so every panel
 * is chromed identically across routes. Built on the shadcn Card token set
 * (bg-card / border).
 */
export function PanelCard({
  id,
  titleId,
  title,
  eyebrow,
  controls,
  source,
  children,
  className
}: PanelCardProps) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        // scroll-mt keeps in-page anchor jumps (deep links to #id) clear of the
        // sticky command bar.
        // FLAT SURFACE, ONE BORDER, NO SHADOW.
        // This was `bg-gradient-to-br from-card to-[#090d12]` under a
        // 32px drop shadow with a 12px radius — the floating-glass card
        // every generated dashboard ships. Three things were wrong with it
        // beyond taste: the gradient made the panel a different colour at
        // its top-left than its bottom-right, so the contrast of anything
        // drawn on it depended on WHERE it sat; the shadow implied a depth
        // the layout does not have (these panels tile, they do not float);
        // and a 12px radius on a data panel is a decoration budget spent
        // where the eye should be reading numbers. A hairline border on a
        // flat ground is what a console looks like.
        "scroll-mt-[88px] overflow-hidden rounded-md border border-border",
        "bg-card",
        "flex flex-col",
        className
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-4">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="truncate text-base font-bold uppercase tracking-[0.04em] text-foreground"
          >
            {title}
          </h2>
          {eyebrow ? (
            <p className="truncate text-xs text-muted-foreground">{eyebrow}</p>
          ) : null}
          {source ? (
            <div className="mt-1">
              <SourceFreshnessBadge sourceState={source} />
            </div>
          ) : null}
        </div>
        {controls ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {controls}
          </div>
        ) : null}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}
