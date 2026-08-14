import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, nowSql, schema, type Db } from "../../db";
import { NOTIFICATION_STATUSES } from "../../db/schema";
import type { PlayerMarketRecord } from "../governance";
import { detectByeWeekRisks } from "./byes";
import type { ByeSchedule } from "../schedule/byeSchedule";

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
          ELSE notifications."resolvedAt" END`
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
}

export interface DraftedNotification extends NotificationInput {
  /** Deterministic key used for dedup so the same rule doesn't fire twice in a session. */
  dedupKey: string;
}

/**
 * Pure rules engine — returns the notifications that *should* be persisted,
 * leaving the actual DB write to the caller. Lets the cron route batch them
 * and lets tests assert behavior without a DB.
 */
export function evaluateLifecycleRules(input: LifecycleRulesInput): DraftedNotification[] {
  const out: DraftedNotification[] = [];

  // Rule 1: stacked bye weeks. Fails closed — an unverified or wrong-season
  // schedule produces NO advice rather than confident advice from stale data.
  const bye = input.byeSchedule;
  if (bye.status === "verified") {
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

  // Rule 2: FAAB drained
  if (typeof input.faabRemainingRatio === "number" && input.faabRemainingRatio < 0.1) {
    out.push({
      dedupKey: `faab:${input.leagueId}:low`,
      userId: input.userId,
      leagueId: input.leagueId,
      severity: "alert",
      rule: "faab-depleted",
      message: `FAAB at ${(input.faabRemainingRatio * 100).toFixed(0)}% — fewer than 10% of your bidding budget remains.`
    });
  }

  // Rule 3: injured starter
  for (const injured of input.injuredStarters ?? []) {
    out.push({
      dedupKey: `injury:${input.leagueId}:${injured.id}`,
      userId: input.userId,
      leagueId: input.leagueId,
      severity: "alert",
      rule: "injured-starter",
      message: `${injured.name} (${injured.position}) is listed as ${injured.status}. Review your lineup.`
    });
  }

  return out;
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
