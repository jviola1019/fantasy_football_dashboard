# Season Monte Carlo

The Nexus Simulator's championship / playoff probabilities come from a **real
simulated fantasy season**, not a threshold heuristic. This document is the
methodology + calibration contract.

- Engine: `src/lib/seasonSim.ts`
- Roster → model mapping + adapter: `src/lib/simulation.ts`
- Tests: `src/lib/seasonSim.test.ts`, `src/lib/simulation.calibration.test.ts`

## What it simulates

For each of `iterations` simulated seasons:

1. **Teams.** Team 0 is the user's team. The other `numTeams − 1` opponents each
   draw a season-long strength from the league distribution.
2. **Regular season.** A balanced round-robin schedule (circle method, cycled to
   `regularSeasonWeeks`). Every weekly matchup is decided by *sampled* team
   scores — higher score wins; points-for is the tiebreaker.
3. **Standings.** Teams are seeded by `(wins, points-for)`.
4. **Playoffs.** The top `playoffTeams` seeds enter a single-elimination bracket
   with first-round byes for the top seeds (re-seeded each round, best vs. worst).
   Each playoff matchup re-samples weekly scores; the bracket winner is champion.

Reported frequencies: `playoffProbability`, `championshipProbability`,
`byeProbability` (top seed), `bottomProbability` (bottom third), `expectedWins`.

## The scoring model (two-level / hierarchical)

All scores are in **weekly fantasy points (PPR)**.

- **User team** has a fixed weekly distribution `N(meanWeekly, sigmaWeekly)`.
- **Each opponent** draws a season strength `μ ~ N(field.meanWeekly,
  betweenTeamSigma)` once per season, then scores weekly `~ N(μ,
  withinTeamSigma)`.

Two variance sources — *between-team* (some teams are simply better) and
*within-team* (week-to-week noise) — is the standard structure for a defensible
fantasy season model.

### Roster → team strength (`deriveSeasonInputs`)

Starters = the top `rosterSlots` players by value. Per starter:

- **weekly mean** — the player's real Sleeper `pts_ppr` projection on the live
  path; off-season it is mapped from season-aggregate `trueValue`
  (`11.5 + (trueValue − 50)·0.18`, so a median player ≈ 11.5 pts).
- **weekly sigma** — `4 + volatility·0.08`.

`team.meanWeekly` = Σ starter means; `team.sigmaWeekly` = √(Σ starter variances)
× a risk-tolerance scale (`0.85 + riskTolerance·0.3`). The field is anchored to
the **actual** number of starters used, so a team with fewer players than
`rosterSlots` isn't scored against a larger field.

### Risk tolerance

Risk tolerance scales the team's week-to-week variance only. Higher variance
helps an underdog (it needs upsets) and hurts a favorite (it risks upsets in the
single-elimination bracket) — the simulator reproduces both effects.

## Calibration contract (enforced by tests)

- **Anchor:** a *league-average* roster (`trueValue 50`, median volatility) makes
  the playoffs ≈ `playoffTeams / numTeams` (≈ 50% in a 12-team / 6-playoff
  league). — `simulation.calibration.test.ts`
- **Monotonic:** playoff probability strictly increases with roster strength
  (weak < average < strong).
- **Favorite variance:** for a stacked favorite, higher risk tolerance lowers
  the title probability.
- **Live projections drive odds:** stronger real `pts_ppr` projections → higher
  playoff probability.
- **Structural:** `championship ⊆ playoffs`, every probability ∈ [0, 100],
  deterministic for a fixed seed.

## League parameters

`numTeams`, `playoffTeams`, and `regularSeasonWeeks` come from the connected
league's format (`envelope.leagueFormat`); the demo and unknown formats fall back
to a standard 12-team / 6-playoff / 14-week league.

## Honest limitations

- The opponent **field is modeled as a distribution**, not each opponent's real
  roster — RAE only has the user's roster in detail. The user's team is exact;
  the field is parameterized by league-average scoring norms (the documented
  constants above).
- No strength-of-schedule from a real fixture list, no injuries/byes within the
  sim, no inter-player correlation inside a team's weekly score.
- These are the explicit assumptions surfaced in the panel's `assumptions` list.
