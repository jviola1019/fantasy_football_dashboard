"use client";

import type { PlayerMarketRecord } from "@/lib/governance";
import { rankInSeason, IN_SEASON_DISCLOSURE, OPPORTUNITY_WEIGHT } from "@/lib/models/inSeasonScore";

/**
 * The only ranking in this product with a positive out-of-sample result.
 *
 * It gets its OWN section rather than being folded into the existing free-agent
 * table, and that separation is deliberate. The table below it is ordered partly
 * by `scarcityGap`, which protocol 3 refuted — mixing a validated ranking into a
 * refuted one produces a third thing that neither result covers, and the reader
 * would have no way to tell which part of the order they were trusting.
 *
 * Renders NOTHING when the inputs are absent. That is the common case today: the
 * `stats-refresh` cron has to have run, and there is no in-season data before
 * kickoff. An empty state that said "no players qualify" would read as a
 * finding about the players rather than about the data.
 */
export function InSeasonBoard({ players }: { players: PlayerMarketRecord[] }) {
  // No useMemo: the React Compiler handles this, and a manual memo around a
  // type-narrowing filter is one it declines to preserve. The work is a filter,
  // a rank and a sort over a bounded pool.
  const withRates = players.filter(
    (p): p is PlayerMarketRecord & { pointsPerGame: number; touchesPerGame: number } =>
      p.pointsPerGame != null && p.touchesPerGame != null
  );
  const scores = rankInSeason(withRates);
  const ranked = withRates
    .map((player) => ({ player, score: scores.get(player.id)?.score }))
    .filter((r): r is { player: (typeof withRates)[number]; score: number } => r.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // Absent inputs are not a result. Say which is missing, or say nothing.
  if (ranked.length === 0) {
    return (
      <div className="mini-panel" id="in-season-board">
        <div className="mini-panel-title">Validated in-season ranking</div>
        <p className="muted-note">
          Needs season-to-date scoring and usage, both per game. Neither exists before kickoff, and
          the season-stats snapshot has not run yet — so this ranking is unavailable rather than
          estimated.
        </p>
      </div>
    );
  }

  return (
    <div className="mini-panel" id="in-season-board">
      <div className="mini-panel-title">Validated in-season ranking</div>

      {/* The claim and its limits in the same block. This is the model most
          easily overstated, because it is the one that worked. */}
      {/* Its OWN class, not `model-scenario-banner`. The panel already carries
          one validated banner with the evidence (958 player-seasons, the
          out-of-fold move from 0.734 to 0.748); this block carries the LIMITS
          specific to the shipped ranking. Same information, one banner.
          Positive palette, because the one model that survived out-of-sample
          testing must not announce itself in warning colours. */}
      <aside className="in-season-note" role="note" aria-label="In-season ranking limits">
        <p className="in-season-note-head">
          <span aria-hidden="true">✓ </span>
          {IN_SEASON_DISCLOSURE.headline}
        </p>
        <p className="muted-note">{IN_SEASON_DISCLOSURE.body}</p>
        <ul className="gov-assume-list">
          {IN_SEASON_DISCLOSURE.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="intel-ts">Evidence: {IN_SEASON_DISCLOSURE.evidence}</p>
      </aside>

      <div className="table-wrap" tabIndex={0} role="region" aria-label="In-season ranked players">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Position</th>
              <th scope="col" title="Season-to-date PPR points per game">Pts/G</th>
              <th scope="col" title="Receptions plus carries per game">Touch/G</th>
              <th scope="col" title={`z(points) + ${OPPORTUNITY_WEIGHT} x z(touches), standardised within position`}>
                Score
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ player, score }) => (
              <tr key={player.id}>
                <td>{player.name}</td>
                <td>{player.position}</td>
                <td>{player.pointsPerGame.toFixed(1)}</td>
                <td>{player.touchesPerGame.toFixed(1)}</td>
                <td className={score >= 0 ? "pos-text" : "neg-text"}>
                  {score >= 0 ? "+" : ""}
                  {score.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small-note">
        Standardised within position, so a tight end is measured against tight ends. A relative
        ranking, not a points projection.
      </p>
    </div>
  );
}
