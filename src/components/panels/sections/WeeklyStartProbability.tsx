import type { PlayerMarketRecord, RAEEnvelope } from "@/lib/governance";
import {
  WEEKLY_PROB_MODELS,
  WEEKLY_PROB_PROVENANCE,
  formatWeeklyProb,
  hasUsefulSkill,
  weeklyProbDisclosure,
  weeklyStartProbability,
  type WeeklyPosition
} from "@/lib/models/weeklyProbability";
import { ReliabilityDiagram } from "@/components/charts/ReliabilityDiagram";
import { DataUnavailable } from "../../ui/DataUnavailable";

/**
 * The one calibrated probability in this product, finally on a screen.
 *
 * The audit of 2026-08-06 recommended shipping it; every session since has
 * deferred it; `audit:reachability` has been classifying `src/lib/stats/logistic.ts`
 * as "reached only by scripts" the entire time. It is reached by the app now.
 *
 * TWO THINGS THIS COMPONENT IS CAREFUL ABOUT.
 *
 * 1. THE UNIT. The model was fitted on Sleeper's `pts_ppr` projections against
 *    PPR thresholds. Feeding it a half-PPR or standard projection would be the
 *    same class of unit mismatch audit 2026-08-20 §7 already had to fix once —
 *    the number would look entirely reasonable and mean nothing. So the PPR
 *    field is selected EXPLICITLY here, whatever the league's own scoring is,
 *    and the column says so. A player with no PPR projection gets no
 *    probability rather than a converted one.
 *
 * 2. QB IS NOT THE OTHERS. QB's Brier skill is +3.7% against RB/WR/TE's
 *    +21.2/+18.5/+17.6. Listing them in one table without saying so would imply
 *    an equivalence the data does not support (risk R5), so a QB row is marked
 *    in the table and its own disclosure carries the warning.
 */
export function WeeklyStartProbability({
  players,
  envelope
}: {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
}) {
  const proj = envelope?.weeklyProjections ?? null;
  const meta = envelope?.weeklyProjectionsMeta ?? null;


  const rows = (proj ? players : [])
    .map((p) => {
      // PPR explicitly — see the unit note above.
      const pprPoints = proj?.[p.id]?.ppr ?? null;
      const prob = weeklyStartProbability(p.position, pprPoints);
      return prob == null || pprPoints == null
        ? null
        : { player: p, pprPoints, prob, position: p.position as WeeklyPosition };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 25);

  // WHEN THERE ARE NO ROWS, THE DISCLOSURE STILL RENDERS.
  //
  // The table needs this week's projections. The model's measured calibration
  // does not: it is frozen from a committed snapshot and is exactly as true in
  // June as in October. Hiding the evidence whenever the input is missing would
  // mean the one place stating how well this model actually performs appears
  // only when it happens to have something to say — and it is also why CI, which
  // runs against an empty database, could not see this block at all.
  const shownPositions: WeeklyPosition[] =
    rows.length > 0
      ? [...new Set(rows.map((r) => r.position))].sort()
      : (["QB", "RB", "WR", "TE"] as WeeklyPosition[]);

  return (
    <div className="weekly-prob" data-testid="weekly-start-probability">
      <div className="section-label">
        WEEKLY START PROBABILITY{meta ? ` — week ${meta.week}, ${meta.season}` : ""}
      </div>
      <p className="tab-lede">
        The chance each player clears their position&rsquo;s start line this week, converted from
        their projection by a model measured on {WEEKLY_PROB_PROVENANCE.totalRows.toLocaleString()}{" "}
        player-weeks of the {WEEKLY_PROB_PROVENANCE.season} season.
      </p>

      {rows.length === 0 ? (
        <DataUnavailable
          title="No weekly projection to convert right now"
          description="This model turns a projection into a probability; it does not produce the projection. Sleeper weekly projections arrive during the regular season via the projections cron, and the model needs the PPR figure specifically because that is the unit it was fitted in. What the model IS, and how well it measured, is below and does not depend on this week's data."
        />
      ) : (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Weekly start probability table">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Position</th>
              <th>Projected pts (PPR)</th>
              <th>Start line</th>
              <th>P(clears line)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, pprPoints, prob, position }) => (
              <tr key={player.id}>
                <td>{player.name}</td>
                <td>
                  {position}
                  {!hasUsefulSkill(position) ? (
                    <span className="weekly-prob-weak"> · low skill at this position</span>
                  ) : null}
                </td>
                <td>{pprPoints.toFixed(1)}</td>
                <td>{WEEKLY_PROB_MODELS[position].threshold}</td>
                <td>
                  <b>{formatWeeklyProb(prob)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {rows.length > 0 ? (
      <p className="small-note">
        Projections are shown in PPR regardless of your league&rsquo;s scoring, because that is the
        unit this model was fitted in. Converting the projection first would change the input without
        changing the model, and the number would look reasonable while meaning nothing.
      </p>
      ) : null}

      {/*
        D2 — the scoped exemption to the "calibrated" wording ban.
        `e2e/20-model-failure-disclosure.spec.ts` bans the phrase across the
        product because, when it was written, nothing here was calibrated. This
        block earns it, and only inside itself: it prints the measured Expected
        Calibration Error and Brier skill for every position it shows, next to
        the reliability diagram those numbers come from. Anywhere without those
        numbers beside it, the ban still stands.
      */}
      {shownPositions.map((pos) => {
        const m = WEEKLY_PROB_MODELS[pos];
        const d = weeklyProbDisclosure(pos);
        return (
          <section key={pos} className="weekly-prob-disclosure" aria-labelledby={`wp-${pos}`}>
            <h3 id={`wp-${pos}`} className="weekly-prob-heading">
              {d.headline} — calibrated probability, {(m.oofEce * 100).toFixed(1)}% calibration error,{" "}
              {(m.brierSkillScore * 100).toFixed(1)}% Brier skill
            </h3>
            <ul className="weekly-prob-limits">
              {d.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
            <ReliabilityDiagram
              bins={m.reliabilityBins}
              caption={`${pos}: out-of-fold calibration. Points on the dashed diagonal are perfectly calibrated; the vertical gap is the error.`}
            />
            <p className="small-note">Evidence: {d.evidence}</p>
          </section>
        );
      })}
    </div>
  );
}
