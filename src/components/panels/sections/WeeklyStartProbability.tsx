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
 *
 * 3. THESE PROBABILITIES DO NOT COMPARE ACROSS POSITIONS — the FLEX trap.
 *
 *    Each position has its own start line: QB 18, RB 10, WR 8, TE 6. So
 *    P(TE clears 6) and P(RB clears 10) are probabilities of DIFFERENT EVENTS
 *    and cannot be ordered against one another. This table used to be sorted by
 *    probability across every position, which presented exactly that ordering:
 *    a TE at 89% of clearing six points rendered above an RB at 71% of clearing
 *    ten, and a manager filling a FLEX slot reads the top of a sorted list as
 *    the better play. It is not; it is a different question answered.
 *
 *    Rows are therefore GROUPED BY POSITION, sorted only within a group, with
 *    each group's line stated in its own header. Grouping removes the
 *    misreading rather than annotating it — a caption under a sorted list does
 *    not undo the ranking the list has already implied. The note below says why
 *    the shape is what it is, so nobody tidies it back into one sorted table.
 */
/**
 * The positions with a fitted model, in the order the table shows them.
 *
 * One constant so the group order and the "is this position modelled" check
 * cannot disagree — a position missing from one but not the other would either
 * vanish from the table or be counted as unmodelled while still rendering.
 */
const MODELLED: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];

export function WeeklyStartProbability({
  players,
  envelope
}: {
  players: PlayerMarketRecord[];
  envelope?: RAEEnvelope;
}) {
  const proj = envelope?.weeklyProjections ?? null;
  const meta = envelope?.weeklyProjectionsMeta ?? null;


  const scored = (proj ? players : [])
    .map((p) => {
      // PPR explicitly — see the unit note above.
      const pprPoints = proj?.[p.id]?.ppr ?? null;
      const prob = weeklyStartProbability(p.position, pprPoints);
      return prob == null || pprPoints == null
        ? null
        : { player: p, pprPoints, prob, position: p.position as WeeklyPosition };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  // Grouped, never globally sorted — see point 3 in the header. The position
  // order is fixed rather than data-driven so the table does not reorder itself
  // week to week, and the per-position cap keeps every position visible instead
  // of letting one crowd the others out of a global top 25.
  // WHO IS MISSING, AND WHY — "never hide unavailable data".
  //
  // `weeklyStartProbability` returns null for any position without a fitted
  // model, which is every position except QB/RB/WR/TE. Filtering those rows out
  // silently meant a manager with a kicker or a team defence saw no probability
  // and no explanation, which reads as "not worth showing" rather than "not
  // modelled". Counted and named instead.
  //
  // WHY K AND DST ARE NOT MODELLED — and this reason CHANGED once it was tested.
  //
  // The first version of this comment said the data does not exist. It does:
  // nflverse publishes kicking and team-defence weeklies, and
  // `npm run acquire:kdst` fetches eight seasons of both in 70 KB. They were
  // then modelled, out of holdout, in `docs/holdout-kdst.md`.
  //
  // The result is the reason. Against the same climatology reference and the
  // same protocol as the skill positions, kickers and defences score about **1%**
  // Brier skill with AUC ~0.55, where RB/WR/TE score 18–26% at AUC 0.75–0.80.
  // Their own scoring history barely predicts their next week. Showing a
  // probability that near-worthless beside a genuinely calibrated one would imply
  // an equivalence the data refuses — the same hazard the QB row is flagged for,
  // an order of magnitude worse.
  const unmodelled = (proj ? players : [])
    .filter((p) => proj?.[p.id]?.ppr != null)
    .filter((p) => !MODELLED.includes(p.position as WeeklyPosition))
    .reduce<Record<string, number>>((acc, p) => {
      const key = p.position ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  const unmodelledLabel = Object.entries(unmodelled)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pos, n]) => `${n} ${pos}`)
    .join(", ");

  const PER_POSITION = 8;
  const grouped = MODELLED
    .map((position) => ({
      position,
      rows: scored
        .filter((r) => r.position === position)
        .sort((a, b) => b.prob - a.prob)
        .slice(0, PER_POSITION)
    }))
    .filter((g) => g.rows.length > 0);
  const rows = grouped.flatMap((g) => g.rows);

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
      : MODELLED;

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
          {grouped.map((group) => (
            <tbody key={group.position}>
              <tr>
                <th scope="rowgroup" colSpan={5} className="weekly-prob-group">
                  {group.position} — clears {WEEKLY_PROB_MODELS[group.position].threshold} PPR points
                  {!hasUsefulSkill(group.position) ? (
                    <span className="weekly-prob-weak"> · low skill at this position</span>
                  ) : null}
                </th>
              </tr>
              {group.rows.map(({ player, pprPoints, prob, position }) => (
                <tr key={player.id}>
                  <td>{player.name}</td>
                  <td>{position}</td>
                  <td>{pprPoints.toFixed(1)}</td>
                  <td>{WEEKLY_PROB_MODELS[position].threshold}</td>
                  <td>
                    <b>{formatWeeklyProb(prob)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      )}

      {unmodelledLabel ? (
        <p className="small-note" role="note">
          Not shown: <b>{unmodelledLabel}</b>. This model covers QB, RB, WR and TE only. Kickers
          and team defences were tested on eight seasons and left out on purpose: their own
          scoring history predicts their next week barely better than a coin flip — about 1%
          Brier skill, against 18&ndash;26% for RB, WR and TE. A number that weak shown next to
          these would imply the two are comparable. Their projections are unaffected; only this
          probability is withheld.
        </p>
      ) : null}

      {rows.length > 0 ? (
      <>
      <p className="small-note">
        Grouped by position and sorted only within a group, because these numbers are
        <b> not comparable across positions</b>: each position clears a different start line, so
        a 70% TE and a 70% RB are answering different questions. For a FLEX decision, compare a
        player against others at their own position, not against the top of one long list.
      </p>
      <p className="small-note">
        Projections are shown in PPR regardless of your league&rsquo;s scoring, because that is the
        unit this model was fitted in. Converting the projection first would change the input without
        changing the model, and the number would look reasonable while meaning nothing.
      </p>
      </>
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
            {/*
              S6 — progressive disclosure, and a measurement that made the case.

              Four positions render four disclosure blocks, each with its own
              reliability diagram. Every one of those charts carries twelve SVG
              axis labels at 9px, so this tab put 48 tick labels on screen at
              once: 27% of every sized element on the route, and the single
              reason /players stayed above the collapsed-hierarchy threshold
              after the type work.

              The numbers a reader needs are already in the heading above —
              measured calibration error and Brier skill, per position. The
              diagram is the WORKING, and working belongs one click away rather
              than four-up on first paint. Nothing is removed: the heading, the
              limits and the evidence line stay open, and `<details>` keeps the
              chart in the DOM and in the accessibility tree for anyone who
              wants it.
            */}
            <details className="weekly-prob-chart">
              <summary>Reliability diagram — how the {pos} forecasts actually landed</summary>
              <ReliabilityDiagram
                bins={m.reliabilityBins}
                caption={`${pos}: out-of-fold calibration. Points on the dashed diagonal are perfectly calibrated; the vertical gap is the error.`}
              />
            </details>
            <p className="small-note">Evidence: {d.evidence}</p>
          </section>
        );
      })}
    </div>
  );
}
