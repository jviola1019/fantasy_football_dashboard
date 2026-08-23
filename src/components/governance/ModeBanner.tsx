import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";

/**
 * Canonical live / fixture / unavailable mode pill with optional freshness.
 * One component so the mode indicator never drifts between the command bar and
 * any panel that needs it.
 */
export function ModeBanner({
  mode,
  freshness,
  className
}: {
  mode: "live" | "fixture" | "unavailable";
  freshness?: string;
  className?: string;
}) {
  const badgeClass =
    mode === "live"
      ? "border-rae-green/40 text-rae-green"
      : mode === "fixture"
        ? "border-rae-amber/40 text-rae-amber"
        : "border-rae-red/40 text-rae-red";
  return (
    <span
      // `aria-live` removed 2026-08-22. This pill is permanently mounted in the
      // sticky command bar and its freshness string is recomputed per request,
      // so every navigation triggered an announcement. Data mode is a standing
      // property, not an event — it stays labelled, it just no longer interrupts.
      aria-label={`Data mode: ${mode}${freshness ? `. Freshness: ${freshness}` : ""}`}
      className={cn("flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-wide", className)}
    >
      <Badge
        variant="outline"
        className={cn("font-semibold", badgeClass)}
        aria-label={mode === "live" ? "Live data" : mode === "fixture" ? "Demo fixture data" : "Data unavailable"}
      >
        {mode === "live" && (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rae-green animate-[live-dot_2.5s_ease-in-out_infinite]"
          />
        )}
        {mode}
      </Badge>
      {freshness ? <span className="hidden text-muted-foreground lg:inline">{freshness}</span> : null}
    </span>
  );
}
