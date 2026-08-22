/**
 * Visible validation state for in-season opportunity (audit protocol 4).
 *
 * Every other model notice in this audit had to retract a claim. This one is the
 * opposite case — a signal that PASSED — and it is deliberately built to the same
 * standard rather than a looser one, because a positive result is exactly where
 * overstatement is easiest.
 *
 * So the notice always carries three things together and never the headline
 * alone: what was validated, how much it actually buys (+0.0137 out of fold, not
 * a hidden number), and the scope limit that it says nothing about drafting.
 *
 * `role="note"` for the same reason as the other notices: this is a standing
 * property of the metric, not an event, so it must not interrupt a screen reader
 * on every render.
 */
import {
  OPPORTUNITY_DETAIL,
  OPPORTUNITY_EVIDENCE,
  OPPORTUNITY_HEADLINE,
  OPPORTUNITY_OUT_OF_FOLD_GAIN,
  OPPORTUNITY_SCOPE_LIMIT,
  OPPORTUNITY_SHORT
} from "@/lib/models/opportunityEvidence";

export function OpportunityEvidenceNotice({
  variant = "banner",
  className
}: {
  variant?: "banner" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <p className={`model-scenario-inline is-validated${className ? ` ${className}` : ""}`}>
        <span className="model-scenario-flag" aria-hidden="true">
          ✓
        </span>
        <span>
          <b>{OPPORTUNITY_HEADLINE}.</b> {OPPORTUNITY_SHORT}
        </span>
      </p>
    );
  }

  return (
    <aside className={`model-scenario-banner is-validated${className ? ` ${className}` : ""}`} role="note">
      <p className="model-scenario-head">
        <span className="model-scenario-flag" aria-hidden="true">
          ✓
        </span>
        {OPPORTUNITY_HEADLINE}
      </p>
      <p className="model-scenario-body">{OPPORTUNITY_DETAIL}</p>
      {/* The limit is not a footnote. A reader who takes the headline and stops
          would wrongly assume this also applies to their draft board. */}
      <p className="model-scenario-body">
        <b>Scope:</b> {OPPORTUNITY_SCOPE_LIMIT}
      </p>
      <p className="model-scenario-evidence">
        {OPPORTUNITY_EVIDENCE.playerSeasons} player-seasons · {OPPORTUNITY_EVIDENCE.distinctPlayers} players ·{" "}
        {OPPORTUNITY_EVIDENCE.seasons} · out-of-sample gain +{OPPORTUNITY_OUT_OF_FOLD_GAIN.toFixed(4)} · evidence:{" "}
        {OPPORTUNITY_EVIDENCE.result}
      </p>
    </aside>
  );
}
