/**
 * The failure disclosure for the season-simulation model.
 *
 * Audit 2026-08-20 §3 / §20. This has to sit ADJACENT to every decision-facing
 * number the model produces. The previous arrangement put the same warning in
 * `sim.assumptions[4]`, which meant:
 *
 *  - `RiskOfRegret` rendered `assumptions.slice(0, 3)` truncated to 60
 *    characters, so the warning was cut out entirely;
 *  - `RiskDetails` rendered the full list, but only inside the "Risk Analysis"
 *    tab — while the percentages themselves sat on the default "Multiverse" tab.
 *
 * A warning behind a tab is not informed presentation. Text is a single source
 * of truth in `src/lib/models/scenarioBand.ts` so it cannot be softened on one
 * surface and not another.
 */
import {
  MODEL_FAILURE_DETAIL,
  MODEL_FAILURE_EVIDENCE,
  MODEL_FAILURE_HEADLINE
} from "@/lib/models/scenarioBand";

export type NoticeVariant = "banner" | "inline";

/**
 * `banner` — full headline + detail + evidence path. Use once per panel, above
 * the numbers.
 * `inline` — one compact line. Use next to a number that sits away from the
 * banner (a chart caption, a second tab, a small tile).
 */
export function ModelScenarioNotice({
  variant = "banner",
  className
}: {
  variant?: NoticeVariant;
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <p className={`model-scenario-inline${className ? ` ${className}` : ""}`}>
        <span className="model-scenario-flag" aria-hidden="true">
          !
        </span>
        <span>
          {/* Kept in step with MODEL_FAILURE_DETAIL: the holdout refuted the
              "worse than chance" reading, and confirmed the calibration one. */}
          <b>{MODEL_FAILURE_HEADLINE}.</b> No measurable ability to tell teams apart on 13 unseen
          leagues, and worse than your league&apos;s own base rate. Not calibrated.
        </span>
      </p>
    );
  }

  return (
    // role="note" rather than "alert": this is a persistent property of the
    // model, not a transient event, so it must not interrupt a screen reader
    // mid-flow on every render.
    <aside className={`model-scenario-banner${className ? ` ${className}` : ""}`} role="note">
      <p className="model-scenario-head">
        <span className="model-scenario-flag" aria-hidden="true">
          !
        </span>
        {MODEL_FAILURE_HEADLINE}
      </p>
      <p className="model-scenario-body">{MODEL_FAILURE_DETAIL}</p>
      <p className="model-scenario-evidence">Evidence: {MODEL_FAILURE_EVIDENCE}</p>
    </aside>
  );
}
