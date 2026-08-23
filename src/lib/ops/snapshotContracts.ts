import type { FreshnessContract } from "./freshness";

const DAY = 24 * 3600;

/**
 * Snapshot freshness contracts, in ONE place.
 *
 * These used to live only inside `/api/health`, which meant the operator
 * surface knew when a snapshot had gone stale while the ENVELOPE — the thing
 * users actually read — did not. Audit 2026-08-22, P0-5: the opportunity
 * snapshot's `fetchedAt` was dropped on load, so `opportunity` was removed from
 * `missingFields` on PRESENCE alone, and a snapshot of any age was presented
 * with the assumption "a real role/usage proxy from the latest season's games".
 * A two-month-old snap-share map is not that, and nothing in the product said
 * so.
 *
 * Sharing the contract means the health endpoint and the envelope cannot
 * disagree about whether data is current — and, importantly, the thresholds are
 * NOT new numbers invented for this fix. They are the ones the cron contract
 * already declared.
 */
export const SNAPSHOT_CONTRACT = {
  sleeperPlayers: {
    source: "sleeper-players",
    warnAfterSeconds: DAY,
    expireAfterSeconds: 30 * 3600
  },
  fantasyprosPpr: {
    source: "fantasypros-ppr",
    warnAfterSeconds: DAY,
    expireAfterSeconds: 30 * 3600
  },
  /**
   * nflverse opportunity: daily cron, 14-day retention. Warn after 2 days (one
   * missed run), expire when the prune window would have emptied the table.
   */
  nflverseOpportunity: {
    source: "nflverse-opportunity",
    warnAfterSeconds: 2 * DAY,
    expireAfterSeconds: 15 * DAY
  },
  /**
   * Season-to-date actuals. Daily cron; warn after two days (one missed run),
   * expire at seven, which is when the prune window empties the table.
   */
  sleeperSeasonStats: {
    source: "sleeper-season-stats",
    warnAfterSeconds: 2 * DAY,
    expireAfterSeconds: 7 * DAY
  },
  espnNews: {
    source: "espn-news",
    warnAfterSeconds: DAY,
    expireAfterSeconds: 3 * DAY
  }
} as const satisfies Record<string, FreshnessContract>;
