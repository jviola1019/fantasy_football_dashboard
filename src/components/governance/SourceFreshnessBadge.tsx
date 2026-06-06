import type { RAEEnvelope } from "@/lib/governance";

/**
 * Compact source · freshness · confidence · validation line. Reusable wherever a
 * panel wants to declare its lineage inline (blueprint: "source freshness
 * visible").
 */
export function SourceFreshnessBadge({ sourceState }: { sourceState: RAEEnvelope["sourceState"] }) {
  const { source, freshness, confidence, validation } = sourceState;
  const freshClass =
    freshness === "fresh" ? "pos-text" : freshness === "stale" ? "neu-text" : "neg-text";
  return (
    <span className="src-badge" title={`${source} · ${freshness} · ${(confidence * 100).toFixed(0)}% confidence · ${validation}`}>
      <span className="src-badge-src">{source}</span>
      <span className={`src-badge-fresh ${freshClass}`}>{freshness}</span>
      <span className="src-badge-conf">{(confidence * 100).toFixed(0)}%</span>
      <span className="src-badge-val">{validation}</span>
    </span>
  );
}
