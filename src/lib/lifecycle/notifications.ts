import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { getDb, nowSql, schema, type Db } from "../../db";
import { NOTIFICATION_STATUSES } from "../../db/schema";
import type { PlayerMarketRecord } from "../governance";
import { detectByeWeekRisks } from "./byes";
import type { ByeSchedule } from "../schedule/byeSchedule";
import {
  canResolveInjuryAlerts,
  describeInjuryEvidence,
  type InjuryEvidence
} from "../leagues/injuryEvidence";

export type Severity = "info" | "warn" | "alert";

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationInput {
  userId: string;
  leagueId?: string | null;
  severity: Severity;
  rule: string;
  message: string;
  /**
   * Deterministic identity of the underlying condition. Required (audit F-003):
   * without it the daily cron re-inserted an identical row on every run.
   */
  dedupKey: string;
  season?: number | null;
  week?: number | null;
}

export interface NotificationRow {
  id: string;
  userId: string;
  leagueId: string | null;
  severity: Severity;
  rule: string;
  message: string;
  dedupKey: string;
  status: NotificationStatus;
  occurrences: number;
  season: number | null;
  week: number | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
}

/**
 * Idempotently record a notification.
 *
 * Audit 2026-08-06 F-003: `insertNotification` used to accept an input type with
 * no dedupKey field and write an unconditional row with a fresh UUID, so the
 * daily lifecycle cron accumulated a duplicate of every still-true condition
 * forever, and dismissing one simply meant tomorrow's run resurrected it.
 *
 * This is a single atomic INSERT ... ON CONFLICT DO UPDATE — not a read-then-
 * write — so concurrent cron executions cannot race into duplicates.
 *
 * Re-fire semantics, chosen deliberately:
 *   dismissed → stays dismissed. The user said "don't tell me"; a still-true
 *               condition must not nag daily.
 *   resolved  → becomes `reopened` and resolvedAt is cleared. The condition went
 *               away and came back, which is a genuinely new event.
 *   otherwise → stays active, occurrences increments, message/severity refresh.
 */
export async function upsertNotification(
  input: NotificationInput,
  db: Db = getDb()
): Promise<NotificationRow> {
  // Never pass a JS Date: the SQLite schema objects are used on both drivers and
  // Drizzle would serialize it to epoch-ms, which postgres.js rejects for a
  // TIMESTAMP parameter. See nowSql() in db/index.ts.
  const now = nowSql(db);
  const rows = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      leagueId: input.leagueId ?? null,
      severity: input.severity,
      rule: input.rule,
      message: input.message,
      dedupKey: input.dedupKey,
      status: "active",
      occurrences: 1,
      season: input.season ?? null,
      week: input.week ?? null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [schema.notifications.userId, schema.notifications.dedupKey],
      set: {
        message: sql`excluded.message`,
        severity: sql`excluded.severity`,
        season: sql`excluded.season`,
        week: sql`excluded.week`,
        updatedAt: now,
        occurrences: sql`notifications.occurrences + 1`,
        status: sql`CASE
          WHEN notifications.status = 'dismissed' THEN 'dismissed'
          WHEN notifications.status = 'resolved' THEN 'reopened'
          ELSE 'active' END`,
        resolvedAt: sql`CASE
          WHEN notifications.status = 'resolved' THEN NULL
          ELSE notifications."resolvedAt" END`,
        /**
         * Reopening also clears the dismissal.
         *
         * Without this, a dismissed condition that resolves and later RECURS
         * stays invisible forever: `listNotificationsForUser` filters on
         * `dismissedAt IS NULL`, so the reopened row would never be shown. The
         * user dismissed one occurrence of a condition that had since gone
         * away; its return is a new event and they are entitled to see it.
         */
        dismissedAt: sql`CASE
          WHEN notifications.status = 'resolved' THEN NULL
          ELSE notifications."dismissedAt" END`
      }
    })
    .returning();
  return toRow(rows[0]!);
}

/**
 * Mark a condition resolved so a later recurrence is treated as a new event
 * rather than silently folded into the old row.
 */
export async function resolveNotification(
  userId: string,
  dedupKey: string,
  db: Db = getDb()
): Promise<boolean> {
  const now = nowSql(db);
  const updated = await db
    .update(schema.notifications)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(
      and(eq(schema.notifications.userId, userId), eq(schema.notifications.dedupKey, dedupKey))
    )
    .returning({ id: schema.notifications.id });
  return updated.length > 0;
}

/** Hard ceiling so a long-lived account cannot return an unbounded history. */
export const NOTIFICATION_LIST_MAX = 200;

export async function listNotificationsForUser(
  userId: string,
  opts: { includeDismissed?: boolean; limit?: number } = {},
  db: Db = getDb()
): Promise<NotificationRow[]> {
  // F-003: this query previously had no LIMIT, so it returned every row a user
  // had ever accumulated — which the duplicate-insert bug made unbounded.
  const limit = Math.min(Math.max(1, opts.limit ?? NOTIFICATION_LIST_MAX), NOTIFICATION_LIST_MAX);
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      opts.includeDismissed
        ? eq(schema.notifications.userId, userId)
        : and(eq(schema.notifications.userId, userId), isNull(schema.notifications.dismissedAt))
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

export async function dismissNotificationForUser(
  userId: string,
  notificationId: string,
  db: Db = getDb()
): Promise<boolean> {
  const now = nowSql(db);
  const updated = await db
    .update(schema.notifications)
    .set({ dismissedAt: now, status: "dismissed", updatedAt: now })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, notificationId)))
    .returning({ id: schema.notifications.id });
  return updated.length > 0;
}

// ---- Rules engine -----------------------------------------------------------

export interface LifecycleRulesInput {
  userId: string;
  leagueId: string;
  roster: PlayerMarketRecord[];
  /**
   * Verified bye schedule for the CURRENT season, or a structured unavailable
   * result. Required (audit 2026-08-06 F-002): this used to be an implicit
   * hardcoded 2025 table, so bye alerts fired against the wrong season with no
   * way for a caller to know. When this is `unavailable`, no bye notification is
   * emitted at all — the rule fails closed rather than guessing.
   */
  byeSchedule: ByeSchedule;
  /** FAAB remaining / starting FAAB. Pass null when not applicable. */
  faabRemainingRatio?: number | null;
  /**
   * Players the caller considers injury risks. The lifecycle cron passes
   * status "ir", "out", AND "questionable" — the doc previously claimed only
   * out/ir, which understated how noisy this rule is. Behavior is unchanged;
   * the contract now matches the caller.
   */
  injuredStarters?: PlayerMarketRecord[];
  /**
   * How much is actually KNOWN about injury status (audit 2026-08-20 §9).
   *
   * The `injured-starter` family used to be marked evaluated whenever
   * `roster.length > 0`. That proves the roster was readable; it proves nothing
   * about whether injury state is known. So a players-snapshot outage — which
   * leaves every record looking healthy — could RESOLVE the user's real injury
   * alerts, converting an upstream failure into false reassurance.
   *
   * Omitted (undefined) is treated as `unavailable`, i.e. fail closed. A caller
   * that has not thought about injury provenance must not accidentally acquire
   * the authority to clear alerts.
   */
  injuryEvidence?: InjuryEvidence;
}

export interface DraftedNotification extends NotificationInput {
  /** Deterministic key used for dedup so the same rule doesn't fire twice in a session. */
  dedupKey: string;
}

/**
 * The rule families that can be reconciled independently (audit P1 §6).
 *
 * Reconciliation is per-family because each depends on a DIFFERENT upstream. A
 * failed bye-schedule fetch says nothing about whether a FAAB alert is still
 * true, so resolving both together would invent information.
 */
export const RULE_FAMILIES = ["stacked-bye-week", "faab-depleted", "injured-starter"] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

/** Statuses that represent a live, unresolved condition. */
const OPEN_STATUSES = ["active", "reopened", "dismissed"] as const;

export interface LifecycleEvaluation {
  /** Conditions that are TRUE right now. */
  drafted: DraftedNotification[];
  /**
   * Families whose upstream data was sufficient to reach a verdict.
   *
   * This is the heart of the fix. A family missing from `drafted` means one of
   * two completely different things — "the condition went away" or "we could
   * not tell" — and only the first may resolve anything. A family absent from
   * this list is UNKNOWN and is left strictly alone.
   */
  evaluated: RuleFamily[];
}

/**
 * Pure rules engine — returns the notifications that *should* be persisted plus
 * the families it was actually able to judge, leaving the DB write to the
 * caller. Lets the cron route batch them and lets tests assert behavior
 * without a DB.
 */
export function evaluateLifecycleRules(input: LifecycleRulesInput): LifecycleEvaluation {
  const out: DraftedNotification[] = [];
  const evaluated: RuleFamily[] = [];

  /**
   * An EMPTY roster is treated as unknown, not as "nothing wrong".
   *
   * A platform that returns 200 with an empty roster — a mid-season league
   * wipe, a permissions change, a silently-expired ESPN cookie — is
   * indistinguishable from a genuinely clean team. Believing it would resolve
   * every injury and bye alert the user has, in one run, on bad data. The
   * cron's `snapshot.failure` check cannot catch this because there is no
   * failure to report.
   */
  const rosterKnown = input.roster.length > 0;

  // Rule 1: stacked bye weeks. Fails closed — an unverified or wrong-season
  // schedule produces NO advice rather than confident advice from stale data.
  const bye = input.byeSchedule;
  if (bye.status === "verified") {
    // Emission is unchanged; only RECONCILABILITY depends on the roster being
    // known. An empty roster produces no alerts either way, so gating emission
    // would change nothing real while breaking callers that supply derived
    // inputs directly.
    if (rosterKnown) evaluated.push("stacked-bye-week");
    for (const alert of detectByeWeekRisks(input.roster, bye).filter((a) => a.stacked)) {
      out.push({
        // Season is part of the key: the same position/week recurs every year and
        // must not be suppressed as a duplicate of last season's alert.
        dedupKey: `bye:${input.leagueId}:${alert.position}:${bye.season}:${alert.week}`,
        userId: input.userId,
        leagueId: input.leagueId,
        severity: "warn",
        rule: "stacked-bye-week",
        season: bye.season,
        week: alert.week,
        message:
          `Week ${alert.week}: ${alert.affectedPlayers.length} ${alert.position}s on bye ` +
          `(${alert.affectedPlayers.map((p) => p.name).join(", ")}). Plan waiver bids now. ` +
          `(${bye.season} schedule, ${bye.provenance.source})`
      });
    }
  }

  // Rule 2: FAAB drained. A null ratio means the league does not report FAAB or
  // the fetch did not carry it — either way the rule cannot be judged.
  if (typeof input.faabRemainingRatio === "number") {
    evaluated.push("faab-depleted");
    if (input.faabRemainingRatio < 0.1) {
      out.push({
        dedupKey: `faab:${input.leagueId}:low`,
        userId: input.userId,
        leagueId: input.leagueId,
        severity: "alert",
        rule: "faab-depleted",
        message: `FAAB at ${(input.faabRemainingRatio * 100).toFixed(0)}% — fewer than 10% of your bidding budget remains.`
      });
    }
  }

  // Rule 3: injured starter.
  //
  // Audit 2026-08-20 §9. Reconcilability requires BOTH a readable roster AND
  // trustworthy injury evidence:
  //
  //   fresh healthy   → an old injury alert may resolve
  //   stale healthy   → MUST NOT resolve
  //   missing status  → MUST NOT resolve
  //   source down     → MUST NOT resolve
  //   fresh injured   → current alert
  //   stale injured   → alert still EMITTED, labeled stale (policy: a positive
  //                     injury signal does not become false by ageing, but it is
  //                     not presented as current)
  //
  // Emission is deliberately NOT gated: suppressing a known injury because the
  // snapshot is a day old would hide a real risk. Only RESOLUTION is gated.
  const injuryEvidence: InjuryEvidence = input.injuryEvidence ?? {
    state: "unavailable",
    reason: "caller supplied no injury evidence"
  };
  if (rosterKnown && canResolveInjuryAlerts(injuryEvidence)) {
    evaluated.push("injured-starter");
  }
  const injuryStale = injuryEvidence.state === "stale";
  for (const injured of input.injuredStarters ?? []) {
    out.push({
      dedupKey: `injury:${input.leagueId}:${injured.id}`,
      userId: input.userId,
      leagueId: input.leagueId,
      severity: "alert",
      rule: "injured-starter",
      message: injuryStale
        ? `${injured.name} (${injured.position}) was listed as ${injured.status} as of the last verified update ` +
          `(${describeInjuryEvidence(injuryEvidence)}). Confirm on your platform before acting.`
        : `${injured.name} (${injured.position}) is listed as ${injured.status}. Review your lineup.`
    });
  }

  return { drafted: out, evaluated };
}

export interface ReconcileResult {
  upserted: number;
  resolved: number;
  /** Families deliberately left untouched because their upstream was unusable. */
  skipped: RuleFamily[];
}

/**
 * Reconcile one league's notifications against what is true RIGHT NOW
 * (audit P1 §6).
 *
 * Before this, the cron only ever upserted currently-true conditions and
 * `resolveNotification` had zero production callers, so a bye alert for a week
 * that had already passed, or an injury alert for a player who had recovered or
 * been dropped, stayed `active` forever. The notification list only grew.
 *
 * The ordering is deliberate: resolve stale keys FIRST, then upsert current
 * ones. The two sets are disjoint by construction, so the order cannot lose a
 * write, but resolving first means a crash between the steps leaves stale rows
 * closed rather than leaving fresh rows missing.
 *
 * Scoping is per (user, league, family) and enforced in SQL, so one user's run
 * can never touch another's rows, and a league whose data failed cannot
 * resolve a sibling league's alerts.
 */
export async function reconcileLifecycleNotifications(
  params: { userId: string; leagueId: string; evaluation: LifecycleEvaluation },
  db: Db = getDb()
): Promise<ReconcileResult> {
  const { userId, leagueId, evaluation } = params;
  const now = nowSql(db);
  const skipped = RULE_FAMILIES.filter((f) => !evaluation.evaluated.includes(f));
  let resolved = 0;

  for (const family of evaluation.evaluated) {
    const currentKeys = evaluation.drafted
      .filter((d) => d.rule === family)
      .map((d) => d.dedupKey);

    // One atomic UPDATE per family rather than read-then-write, so a concurrent
    // cron run cannot resolve a row this run is about to re-assert.
    const scope = and(
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.leagueId, leagueId),
      eq(schema.notifications.rule, family),
      inArray(schema.notifications.status, [...OPEN_STATUSES]),
      // `notInArray` with an empty list is not valid SQL; an empty current set
      // legitimately means "every open row in this family is now stale".
      ...(currentKeys.length > 0 ? [notInArray(schema.notifications.dedupKey, currentKeys)] : [])
    );

    const closed = await db
      .update(schema.notifications)
      .set({ status: "resolved", resolvedAt: now, updatedAt: now })
      .where(scope)
      .returning({ id: schema.notifications.id });
    resolved += closed.length;
  }

  for (const n of evaluation.drafted) {
    await upsertNotification(n, db);
  }

  return { upserted: evaluation.drafted.length, resolved, skipped };
}

/** Both drivers are in play, so a timestamp arrives as a Date or as epoch ms. */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as number);
}

function toDateOrNull(value: unknown): Date | null {
  return value == null ? null : toDate(value);
}

function toRow(row: typeof schema.notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    leagueId: row.leagueId,
    severity: row.severity as Severity,
    rule: row.rule,
    message: row.message,
    dedupKey: row.dedupKey,
    status: row.status as NotificationStatus,
    occurrences: Number(row.occurrences),
    season: row.season == null ? null : Number(row.season),
    week: row.week == null ? null : Number(row.week),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    resolvedAt: toDateOrNull(row.resolvedAt),
    dismissedAt: toDateOrNull(row.dismissedAt)
  };
}
