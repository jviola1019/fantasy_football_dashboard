import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema, type Db } from "../../db";
import type { PlayerMarketRecord } from "../governance";
import { detectByeWeekRisks, BYE_SCHEDULE, BYE_SCHEDULE_DISCLOSURE } from "./byes";

export type Severity = "info" | "warn" | "alert";

export interface NotificationInput {
  userId: string;
  leagueId?: string | null;
  severity: Severity;
  rule: string;
  message: string;
}

export interface NotificationRow {
  id: string;
  userId: string;
  leagueId: string | null;
  severity: Severity;
  rule: string;
  message: string;
  createdAt: Date;
  dismissedAt: Date | null;
}

export async function insertNotification(input: NotificationInput, db: Db = getDb()): Promise<NotificationRow> {
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      leagueId: input.leagueId ?? null,
      severity: input.severity,
      rule: input.rule,
      message: input.message,
      createdAt: new Date()
    })
    .returning();
  return toRow(inserted[0]!);
}

export async function listNotificationsForUser(
  userId: string,
  opts: { includeDismissed?: boolean } = {},
  db: Db = getDb()
): Promise<NotificationRow[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      opts.includeDismissed
        ? eq(schema.notifications.userId, userId)
        : and(eq(schema.notifications.userId, userId), isNull(schema.notifications.dismissedAt))
    )
    .orderBy(desc(schema.notifications.createdAt));
  return rows.map(toRow);
}

export async function dismissNotificationForUser(
  userId: string,
  notificationId: string,
  db: Db = getDb()
): Promise<boolean> {
  const updated = await db
    .update(schema.notifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, notificationId)))
    .returning({ id: schema.notifications.id });
  return updated.length > 0;
}

// ---- Rules engine -----------------------------------------------------------

export interface LifecycleRulesInput {
  userId: string;
  leagueId: string;
  roster: PlayerMarketRecord[];
  /** FAAB remaining / starting FAAB. Pass null when not applicable. */
  faabRemainingRatio?: number | null;
  /** Players with current injury_status === "out" or "ir". */
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

  // Rule 1: stacked bye weeks
  const byeAlerts = detectByeWeekRisks(input.roster);
  for (const alert of byeAlerts.filter((a) => a.stacked)) {
    out.push({
      dedupKey: `bye:${input.leagueId}:${alert.position}:${alert.week}`,
      userId: input.userId,
      leagueId: input.leagueId,
      severity: "warn",
      rule: "stacked-bye-week",
      message:
        `Week ${alert.week}: ${alert.affectedPlayers.length} ${alert.position}s on bye ` +
        `(${alert.affectedPlayers.map((p) => p.name).join(", ")}). Plan waiver bids now.` +
        // Never present an unverified schedule as confirmed (see byes.ts).
        (BYE_SCHEDULE.verified ? "" : ` (${BYE_SCHEDULE_DISCLOSURE})`)
    });
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

function toRow(row: typeof schema.notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    leagueId: row.leagueId,
    severity: row.severity as Severity,
    rule: row.rule,
    message: row.message,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as number),
    dismissedAt:
      row.dismissedAt == null
        ? null
        : row.dismissedAt instanceof Date
        ? row.dismissedAt
        : new Date(row.dismissedAt as unknown as number)
  };
}
