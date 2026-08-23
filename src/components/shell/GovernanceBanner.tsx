import type { RAEEnvelope } from "@/lib/governance";
import { AssumptionsDrawer } from "@/components/governance/AssumptionsDrawer";

/**
 * The always-visible model-governance strip: league format/season + draft state,
 * data source + freshness + confidence + validation, the metrics still lacking a
 * data source, and a disclosure of the model assumptions. Surfaced on every
 * route so the data lineage never goes missing in the multi-route shell.
 *
 * PRESENTED AS A FIELD ROW, NOT A SENTENCE (design audit 2026-08-22).
 *
 * This carried exactly the right information and was scored a PARTIAL on UX
 * question 5 ("can I trust it?") anyway, because it delivered all of it as an
 * 11px run-on sentence in a low-contrast strip: to learn the confidence you had
 * to read a paragraph. Trust is a scanning task, so the values now sit at body
 * size above 9px labels and the reader can answer the question with their eyes
 * instead of their attention. Nothing was removed — the same source, freshness,
 * confidence, validation, failure and missing-field list are all still here.
 *
 * Freshness and validation carry semantic colour AND their own word, never
 * colour alone (WCAG 1.4.1).
 */
function Field({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neu" | "neg" }) {
  return (
    <div className="gov-field">
      <span className="gov-field-label">{label}</span>
      <span className={tone ? `gov-field-value ${tone}-text` : "gov-field-value"}>{value}</span>
    </div>
  );
}

export function GovernanceBanner({ envelope }: { envelope: RAEEnvelope }) {
  const fmt = envelope.leagueFormat;
  const draftState = envelope.draftState ?? "unknown";
  const s = envelope.sourceState;

  const scoring =
    fmt?.scoringFormat === "PPR" ? "PPR" : fmt?.scoringFormat === "HALF" ? "Half-PPR" : "Standard";
  const leagueValue = fmt
    ? [
        `${scoring} · ${fmt.numTeams}-team`,
        envelope.season
          ? `${envelope.season.completed ? `${envelope.season.completed}→` : ""}${envelope.season.upcoming}`
          : null,
        draftState === "unknown"
          ? null
          : draftState === "pre"
            ? "pre-draft (full universe)"
            : "post-draft (free agents)"
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // Tones map to the real enums, not to a guess. Freshness is
  // fresh | stale | missing | unavailable | fixture; validation is
  // valid | invalid | not-run. "fixture" and "not-run" are neutral states, not
  // failures — colouring them red would overstate a problem that isn't one.
  const freshTone =
    s.freshness === "fresh" ? "pos" : s.freshness === "stale" || s.freshness === "fixture" ? "neu" : "neg";
  const validTone = s.validation === "valid" ? "pos" : s.validation === "not-run" ? "neu" : "neg";

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
      <div className="gov-fields">
        {leagueValue ? <Field label="League" value={leagueValue} /> : null}
        <Field label="Source state" value={s.source} />
        <Field label="Freshness" value={s.freshness} tone={freshTone} />
        <Field label="Confidence" value={`${(s.confidence * 100).toFixed(0)}%`} />
        <Field label="Validation" value={s.validation} tone={validTone} />
      </div>
      {s.failure ? <p className="gov-banner-note gov-banner-failure">Failure: {s.failure}</p> : null}
      {s.missingFields.length > 0 ? (
        <p className="gov-banner-note">
          <b>Metrics without a data source yet:</b> {s.missingFields.join(", ")}. Tiles or panels that depend on
          these render &quot;—&quot; instead of a number.
        </p>
      ) : null}
      <AssumptionsDrawer sourceState={s} />
    </div>
  );
}
