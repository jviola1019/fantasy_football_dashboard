import type { RAEEnvelope } from "@/lib/governance";

/**
 * Clarifies which season's roster you're looking at, so the year is never
 * ambiguous. Two real cases the season-mirror produces:
 *  - pre-draft upcoming league: roster not set; any players are a carryover.
 *  - completed league (post, with a final season): the season is over, the
 *    "upcoming" year hasn't been drafted yet — this is your FINAL roster.
 * In-season (post, no completed season) shows nothing — the live roster is
 * exactly what it claims to be. (Extracted verbatim from the former CommandCenter.)
 */
export function SeasonNotice({ envelope, hasPlayers }: { envelope: RAEEnvelope; hasPlayers: boolean }) {
  const s = envelope.season;
  if (!s || !hasPlayers) return null;
  if (envelope.draftState === "pre") {
    return (
      <div className="predraft-notice">
        <b>Pre-draft {s.upcoming}.</b> Your {s.upcoming} roster isn&apos;t set yet — these are your{" "}
        {s.completed ?? "prior"}-season players, shown as a carryover baseline. Use{" "}
        <a href="/draft">Draft Intelligence</a> or the Mock Draft to plan your {s.upcoming} team.
      </div>
    );
  }
  if (envelope.draftState === "post" && s.completed) {
    return (
      <div className="predraft-notice">
        <b>{s.completed} season — final.</b> This is your completed {s.completed} roster. Your {s.upcoming} league
        hasn&apos;t been drafted yet; use <a href="/draft">Draft Intelligence</a> or the Mock Draft to
        plan {s.upcoming}.
      </div>
    );
  }
  return null;
}
