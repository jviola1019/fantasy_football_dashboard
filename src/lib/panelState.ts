import type { RAEEnvelope } from "./governance";

// Shared contract every panel uses to render honestly-degraded UI when the
// envelope it received is missing a data source for one of the behavioral
// metrics the panel depends on. CommandCenter MetricStrip already implements
// this pattern inline; the other panels read from this helper for consistency.

export type PanelMetricKey =
  | "narrative_pressure"
  | "opportunity"
  | "fragility"
  | "market_value"
  | "true_value"
  | "ownership"
  | "perceived_value";

export interface PanelDataState {
  /**
   * `ready`       — every declared dependency is present in the envelope.
   * `degraded`    — at least one but not all dependencies are missing; the
   *                panel should render but mark missing sub-views as "—".
   * `unavailable` — every dependency is missing; the panel should render a
   *                banner/empty-state rather than meaningless zeros.
   */
  status: "ready" | "degraded" | "unavailable";
  /** Banner copy for the design layer. Null when status === "ready". */
  bannerText: string | null;
  /** Per-metric availability — design uses this to render "—" per tile. */
  unavailable: Set<PanelMetricKey>;
}

// Static map: each missing-metric key has one canonical human description used
// across every panel. Banner composition is deterministic (sorted by key) so
// snapshot tests don't flap.
const METRIC_DESCRIPTIONS: Record<PanelMetricKey, string> = {
  narrative_pressure: "Narrative / sentiment source not integrated",
  opportunity: "In-season opportunity data not derived",
  fragility: "Injury / snap-share source not integrated",
  market_value: "Market value data not derived",
  true_value: "True value data not derived",
  ownership: "Ownership data not derived",
  perceived_value: "Perceived value data not derived"
};

/**
 * Compute a panel's data state from the envelope's declared missingFields
 * and the panel's declared dependency list. Pure function — no I/O, safe
 * to call during render.
 *
 * @param envelope the envelope passed to RaeApp / panels
 * @param dependsOn behavioral metrics this panel requires to render meaningfully
 */
export function derivePanelState(
  envelope: RAEEnvelope,
  dependsOn: PanelMetricKey[]
): PanelDataState {
  if (dependsOn.length === 0) {
    return { status: "ready", bannerText: null, unavailable: new Set() };
  }
  const missing = new Set(envelope.sourceState.missingFields);
  const intersected = dependsOn.filter((k) => missing.has(k));
  const unavailable = new Set(intersected);
  if (intersected.length === 0) {
    return { status: "ready", bannerText: null, unavailable };
  }
  const status: PanelDataState["status"] =
    intersected.length === dependsOn.length ? "unavailable" : "degraded";
  // Sort deterministically so snapshot tests don't flap on dependency order.
  const sorted = [...intersected].sort();
  const descriptions = sorted.map((k) => METRIC_DESCRIPTIONS[k]);
  const bannerText =
    status === "unavailable"
      ? descriptions.join(" · ")
      : `Partial data: ${descriptions.join(" · ")}`;
  return { status, bannerText, unavailable };
}

/**
 * Convenience for panels using the existing CommandCenter-style "missingFields
 * string array" prop pattern — returns a Set keyed by PanelMetricKey for O(1)
 * lookup when rendering individual tiles.
 */
export function asMetricSet(missingFields: string[]): Set<PanelMetricKey> {
  return new Set(missingFields.filter(isPanelMetricKey));
}

function isPanelMetricKey(s: string): s is PanelMetricKey {
  return (
    s === "narrative_pressure" ||
    s === "opportunity" ||
    s === "fragility" ||
    s === "market_value" ||
    s === "true_value" ||
    s === "ownership" ||
    s === "perceived_value"
  );
}
