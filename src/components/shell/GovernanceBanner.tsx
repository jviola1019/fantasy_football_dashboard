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
    // `role="status"` removed 2026-08-22. This is mounted on EVERY route and its
    // content (source, freshness, confidence, validation, failure, the full
    // missing-fields list) changes on every navigation — so a screen reader read
    // the entire governance paragraph aloud on each route change. The
    // information is standing context, not an event.
    //
    // It stays reachable: the content is plain text in the document, and the
    // region is labelled so it can be navigated to deliberately.
    <div className="governance-banner" aria-label="Data governance summary">
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
