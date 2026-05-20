import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PanelCardProps {
  /** Section id — doubles as the scroll anchor target for the nav. */
  id: string;
  /** id of the <h2>, referenced by aria-labelledby. */
  titleId: string;
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  /** Right-aligned header controls (tab ranges, run buttons, badges…). */
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The standard shell every top-level panel renders inside. One source of
 * truth for panel padding, border, radius, shadow, the header layout, and the
 * scroll-margin offset that clears the sticky TopBar — so all nine panels are
 * spaced identically. Built on the shadcn Card token set (bg-card / border).
 */
export function PanelCard({
  id,
  titleId,
  title,
  eyebrow,
  icon,
  controls,
  children,
  className
}: PanelCardProps) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "scroll-mt-28 overflow-hidden rounded-xl border border-border",
        "bg-gradient-to-br from-card to-[#090d12] shadow-[0_4px_32px_rgba(0,0,0,0.4)]",
        "flex flex-col",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-rae-blue [&_svg]:size-4">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-[15px] font-bold uppercase tracking-[0.04em] text-foreground"
            >
              {title}
            </h2>
            {eyebrow ? (
              <p className="truncate text-[10px] text-muted-foreground">{eyebrow}</p>
            ) : null}
          </div>
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
