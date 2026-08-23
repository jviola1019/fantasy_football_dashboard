/**
 * Explicit evidence state for a player's injury / activity status.
 *
 * Audit 2026-08-20 §8 + §9. Two defects shared one root cause: nothing in the
 * type system distinguished "we know this player is healthy" from "we have a
 * day-old cache that said healthy".
 *
 *  - §8 — `materializeSleeperRoster` stamped every roster record
 *    `fetchedAt: now, ttlSeconds: 120, freshness: "fresh"`, while the
 *    `injury_status` it carried came from the DAILY players snapshot. A roster
 *    fetched now plus a snapshot fetched 36h ago produced a record claiming a
 *    two-minute-old injury status.
 *  - §9 — the lifecycle engine marked the `injured-starter` family EVALUATED
 *    whenever `roster.length > 0`. Roster membership proves the roster was
 *    readable. It says nothing about whether injury state is known, so an
 *    upstream freshness failure could RESOLVE a real injury alert — turning a
 *    data outage into false reassurance.
 *
 * The governing rule: a composite record's decision-relevant freshness can
 * never be newer than its oldest decision-relevant input.
 */
import { evaluateFreshness, type FreshnessContract } from "../ops/freshness";

/**
 * The freshness contract for the Sleeper players snapshot, which is where
 * injury/activity status actually comes from.
 *
 * These are the SAME numbers the health endpoint publishes for
 * `sleeper-players` (`src/app/api/health/route.ts`), deliberately — the cron
 * runs daily at 08:00 UTC, so 24h is one missed run and 30h means the contract
 * is broken. Injury state must not be judged fresh by a looser rule than the
 * one the operator is paged on.
 */
export const PLAYERS_SNAPSHOT_CONTRACT: FreshnessContract = {
  source: "sleeper-players",
  warnAfterSeconds: 24 * 3600,
  expireAfterSeconds: 30 * 3600
};

export type InjuryEvidence =
  | {
      /** Status came from a snapshot inside its freshness contract. */
      state: "verified";
      fetchedAt: string;
      ageSeconds: number;
    }
  | {
      /** Status exists but is older than the contract allows. */
      state: "stale";
      fetchedAt: string;
      ageSeconds: number;
    }
  | {
      /** No usable status source at all. */
      state: "unavailable";
      reason: string;
    };

/**
 * Classify how much we actually know about injury status, from the age of the
 * snapshot that supplied it.
 *
 * Deliberately delegates to the shared `evaluateFreshness` rather than
 * re-deriving thresholds, so there is one definition of "the players snapshot is
 * too old" in the codebase.
 */
export function classifyInjuryEvidence(
  snapshotFetchedAt: Date | string | null | undefined,
  now: Date = new Date()
): InjuryEvidence {
  if (snapshotFetchedAt == null) {
    return { state: "unavailable", reason: "no Sleeper players snapshot" };
  }
  const verdict = evaluateFreshness(PLAYERS_SNAPSHOT_CONTRACT, snapshotFetchedAt, now);
  if (verdict.ageSeconds == null) {
    return { state: "unavailable", reason: verdict.detail };
  }
  const fetchedAt =
    typeof snapshotFetchedAt === "string"
      ? new Date(snapshotFetchedAt).toISOString()
      : snapshotFetchedAt.toISOString();

  // `stale` and `expired` are both "older than the contract allows"; only the
  // operator escalation differs, and that is not this function's concern.
  if (verdict.verdict === "fresh") {
    return { state: "verified", fetchedAt, ageSeconds: verdict.ageSeconds };
  }
  return { state: "stale", fetchedAt, ageSeconds: verdict.ageSeconds };
}

/**
 * May a *negative* reconciliation — resolving an existing injury alert because
 * the player now looks healthy — be trusted?
 *
 * Only `verified` qualifies. This is the asymmetry the audit demands: a positive
 * signal (this player IS hurt) is still worth surfacing from an older snapshot,
 * but the ABSENCE of a signal in stale or missing data is not evidence of
 * recovery. Getting this backwards means an upstream outage silently clears the
 * user's alerts.
 */
export function canResolveInjuryAlerts(evidence: InjuryEvidence): boolean {
  return evidence.state === "verified";
}

/** Operator/UI-facing one-liner. Never claims more than the state supports. */
export function describeInjuryEvidence(evidence: InjuryEvidence): string {
  if (evidence.state === "unavailable") {
    return `injury status unavailable — ${evidence.reason}`;
  }
  const hours = (evidence.ageSeconds / 3600).toFixed(1);
  if (evidence.state === "stale") {
    return `injury status ${hours}h old — past the ${(
      PLAYERS_SNAPSHOT_CONTRACT.warnAfterSeconds / 3600
    ).toFixed(0)}h contract; alerts will not be resolved from it`;
  }
  return `injury status ${hours}h old — within contract`;
}
