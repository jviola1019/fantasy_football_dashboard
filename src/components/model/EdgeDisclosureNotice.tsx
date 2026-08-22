/**
 * Visible disclosure for edge-derived numbers (audit protocol 3).
 *
 * Same rule as the season-simulation notice: it sits ADJACENT to the numbers it
 * qualifies, on first paint, not behind a tab or a drawer. The precedent is §3,
 * where the failure notice existed but reached nobody because it lived in an
 * assumptions list on a different tab.
 *
 * `role="note"` rather than `"alert"` — this is a persistent property of the
 * score, not a transient event, so it must not interrupt a screen reader on
 * every render.
 */
import {
  EDGE_DISCLOSURE_DETAIL,
  EDGE_DISCLOSURE_EVIDENCE,
  EDGE_DISCLOSURE_HEADLINE,
  EDGE_DISCLOSURE_SHORT
} from "@/lib/models/edgeDisclosure";

export function EdgeDisclosureNotice({
  variant = "banner",
  className
}: {
  variant?: "banner" | "inline";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <p className={`model-scenario-inline${className ? ` ${className}` : ""}`}>
        <span className="model-scenario-flag" aria-hidden="true">
          !
        </span>
        <span>
          <b>{EDGE_DISCLOSURE_HEADLINE}.</b> {EDGE_DISCLOSURE_SHORT}
        </span>
      </p>
    );
  }

  return (
    <aside className={`model-scenario-banner${className ? ` ${className}` : ""}`} role="note">
      <p className="model-scenario-head">
        <span className="model-scenario-flag" aria-hidden="true">
          !
        </span>
        {EDGE_DISCLOSURE_HEADLINE}
      </p>
      <p className="model-scenario-body">{EDGE_DISCLOSURE_DETAIL}</p>
      <p className="model-scenario-evidence">Evidence: {EDGE_DISCLOSURE_EVIDENCE}</p>
    </aside>
  );
}
