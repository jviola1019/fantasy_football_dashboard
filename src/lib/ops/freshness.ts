// Data-contract freshness evaluation for cron snapshots. Pure + unit-tested; the
// CLI that loads real snapshots lives in scripts/check-cron-freshness.ts.
//
// NOT the same function as `evaluateFreshness` in `src/lib/governance.ts`, which
// shares this name but answers the UI question — a two-state TTL check for an
// envelope badge. This one is the CRON CONTRACT: three states, and `expired` is
// a violation rather than a cosmetic staleness. The signatures are incompatible
// so the compiler rejects the wrong import; this note saves the reader finding
// that out by experiment.

export type FreshnessVerdict = "fresh" | "stale" | "expired" | "missing";

export interface FreshnessContract {
  source: string;
  /** Age past which the snapshot is flagged STALE (a non-fatal warning). */
  warnAfterSeconds: number;
  /** Age past which the snapshot is EXPIRED — a data-contract violation (fatal). */
  expireAfterSeconds: number;
}

export interface FreshnessResult {
  source: string;
  verdict: FreshnessVerdict;
  ageSeconds: number | null;
  /** false for `expired`/`missing` (the cron contract is violated). */
  ok: boolean;
  detail: string;
}

function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function evaluateFreshness(
  contract: FreshnessContract,
  fetchedAt: Date | string | null,
  now: Date
): FreshnessResult {
  if (fetchedAt == null) {
    return { source: contract.source, verdict: "missing", ageSeconds: null, ok: false, detail: "no snapshot found" };
  }
  const t = typeof fetchedAt === "string" ? new Date(fetchedAt) : fetchedAt;
  if (Number.isNaN(t.getTime())) {
    return { source: contract.source, verdict: "missing", ageSeconds: null, ok: false, detail: "invalid fetchedAt" };
  }
  const ageSeconds = Math.max(0, (now.getTime() - t.getTime()) / 1000);
  if (ageSeconds > contract.expireAfterSeconds) {
    return {
      source: contract.source,
      verdict: "expired",
      ageSeconds,
      ok: false,
      detail: `${hours(ageSeconds)} old > expire ${hours(contract.expireAfterSeconds)} — cron likely failed`,
    };
  }
  if (ageSeconds > contract.warnAfterSeconds) {
    return {
      source: contract.source,
      verdict: "stale",
      ageSeconds,
      ok: true,
      detail: `${hours(ageSeconds)} old > warn ${hours(contract.warnAfterSeconds)}`,
    };
  }
  return { source: contract.source, verdict: "fresh", ageSeconds, ok: true, detail: `${hours(ageSeconds)} old` };
}
