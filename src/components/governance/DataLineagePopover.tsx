import { AuditInfoTooltip } from "./AuditInfoTooltip";

/**
 * Attaches a metric's data lineage (where the number comes from) to its label as
 * an ⓘ tooltip. Honest provenance at the point of use — supports the blueprint's
 * "data lineage visible" rule without a heavy popover dependency.
 */
export function DataLineagePopover({
  metric,
  source,
  freshness,
  note
}: {
  metric: string;
  source: string;
  freshness?: string;
  note?: string;
}) {
  return (
    <AuditInfoTooltip label={`${metric} lineage`}>
      <span>
        <b>{metric}</b>
        <br />
        Source: {source}
        {freshness ? ` · ${freshness}` : ""}
        {note ? (
          <>
            <br />
            {note}
          </>
        ) : null}
      </span>
    </AuditInfoTooltip>
  );
}
