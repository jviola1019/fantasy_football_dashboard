import type { RAEEnvelope } from "@/lib/governance";
import { AssumptionsDrawer } from "@/components/governance/AssumptionsDrawer";

/**
 * The always-visible model-governance strip: league format/season + draft state,
 * data source + freshness + confidence + validation, the metrics still lacking a
 * data source, and a disclosure of the model assumptions. Surfaced on every
 * route so the data lineage never goes missing in the multi-route shell.
 */
export function GovernanceBanner({ envelope }: { envelope: RAEEnvelope }) {
  const fmt = envelope.leagueFormat;
  const draftState = envelope.draftState ?? "unknown";
  return (
    <div className="governance-banner" role="status">
      {fmt ? (
        <span>
          <b>League:</b>{" "}
          {fmt.scoringFormat === "PPR" ? "PPR" : fmt.scoringFormat === "HALF" ? "Half-PPR" : "Standard"}
          {" · "}
          {fmt.numTeams}-team
          {envelope.season
            ? ` · ${envelope.season.completed ? `${envelope.season.completed}→` : ""}${envelope.season.upcoming}`
            : ""}
          {draftState !== "unknown"
            ? ` · ${draftState === "pre" ? "pre-draft (full universe)" : "post-draft (free agents)"}`
            : ""}
          {" · "}
        </span>
      ) : null}
      <b>Source state:</b> {envelope.sourceState.source} · freshness {envelope.sourceState.freshness} · confidence{" "}
      {(envelope.sourceState.confidence * 100).toFixed(0)}% · validation {envelope.sourceState.validation}.
      {envelope.sourceState.failure ? <span> Failure: {envelope.sourceState.failure}</span> : null}
      {envelope.sourceState.missingFields.length > 0 ? (
        <span>
          {" · "}
          <b>Metrics without a data source yet:</b> {envelope.sourceState.missingFields.join(", ")}. Tiles or panels
          that depend on these render &quot;—&quot; instead of a number.
        </span>
      ) : null}
      <AssumptionsDrawer sourceState={envelope.sourceState} />
    </div>
  );
}
