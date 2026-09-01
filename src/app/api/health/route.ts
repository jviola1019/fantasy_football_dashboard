import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { redact, unwrap } from "@/lib/redact";
import { safeEqual } from "@/lib/timingSafe";
import { getLatestPlayersSnapshot } from "@/lib/sleeper/snapshot";
import { getLatestRankingsSnapshot } from "@/lib/fantasypros/snapshot";
import { getLatestNewsSnapshot } from "@/lib/espn/newsSnapshot";
import { getLatestOpportunitySnapshot } from "@/lib/nflverse/opportunitySnapshot";
import { getLatestSeasonStatsSnapshot } from "@/lib/sleeper/seasonStatsSnapshot";
import { getNflState } from "@/lib/sleeper/league";
import { evaluateFreshness, type FreshnessContract, type FreshnessResult } from "@/lib/ops/freshness";
import { SNAPSHOT_CONTRACT } from "@/lib/ops/snapshotContracts";

export const runtime = "nodejs";

// Snapshot freshness contracts for the fixed-source-key sources that drive the
// envelope. Surfaced (query-gated) for an uptime monitor /
// scripts/check-cron-freshness.ts; intentionally does NOT flip the top-level
// `status` (a behind cron during the off-season shouldn't read as "app down").
// Projections (keyed per season-week) and KTC (per format) have no fixed key
// to contract against — deferred deliberately, not forgotten.
// The thresholds themselves live in `@/lib/ops/snapshotContracts` so the
// ENVELOPE evaluates staleness against exactly the same numbers this endpoint
// reports (audit 2026-08-22, P0-5).
const SNAPSHOT_CONTRACTS: Array<{
  contract: FreshnessContract;
  load: () => Promise<{ fetchedAt: Date } | null>;
}> = [
  {
    contract: SNAPSHOT_CONTRACT.sleeperPlayers,
    load: () => getLatestPlayersSnapshot()
  },
  {
    contract: SNAPSHOT_CONTRACT.fantasyprosPpr,
    load: () => getLatestRankingsSnapshot("PPR")
  },
  {
    contract: SNAPSHOT_CONTRACT.nflverseOpportunity,
    load: () => getLatestOpportunitySnapshot("nfl")
  },
  {
    contract: SNAPSHOT_CONTRACT.sleeperSeasonStats,
    // Keyed by SEASON, not a fixed key: last year's totals are not this year's
    // points-to-date, and reading them as such would be the P0-5 error again.
    load: async () => {
      const state = await getNflState();
      const season = state.data?.season;
      return season ? getLatestSeasonStatsSnapshot(season) : null;
    }
  },
  {
    contract: SNAPSHOT_CONTRACT.espnNews,
    load: () => getLatestNewsSnapshot("espn-nfl")
  }
];

async function snapshotFreshness(now: Date): Promise<FreshnessResult[]> {
  const results = await Promise.all(
    SNAPSHOT_CONTRACTS.map(async (s) => {
      let fetchedAt: Date | null = null;
      let readError: string | null = null;
      try {
        fetchedAt = (await s.load())?.fetchedAt ?? null;
      } catch (err) {
        // "missing (no such table: …)" must be distinguishable from
        // "missing (cron not yet run)" — this endpoint is the operator surface.
        fetchedAt = null;
        readError = redact(err instanceof Error ? err.message : String(err));
      }
      const result = evaluateFreshness(s.contract, fetchedAt, now);
      if (readError) result.detail = `${result.detail} (read error: ${readError})`;
      return result;
    })
  );
  return results;
}

type DatabaseStatus = "ok" | "unreachable" | "not-initialized";

interface HealthChecks {
  authSecret: boolean;
  credentialEncryptionKey: boolean;
  databaseUrl: boolean;
  database: DatabaseStatus;
}

interface HealthResponse {
  status: "ok" | "degraded";
  // Present only for callers presenting `Authorization: Bearer CRON_SECRET` —
  // which env vars are configured is operator detail, not public surface (SEC-03).
  checks?: HealthChecks;
  // Present only when `database` is not "ok". Includes the postgres-js
  // error code and a redacted message — the actual cause (auth failure,
  // DNS, TLS, etc.) instead of a generic "unreachable" bucket. Anything
  // resembling a connection string is scrubbed before being returned.
  databaseError?: string;
  // Present only when requested with `?snapshots=1`. Cron data-contract
  // freshness; informational (does not affect `status`).
  snapshots?: FreshnessResult[];
}

interface CheckResult {
  status: DatabaseStatus;
  error?: string;
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const db = getDb();
    // A trivial read against the users table — presence confirms schema is initialized.
    await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return { status: "ok" };
  } catch (err: unknown) {
    const root = unwrap(err);
    const raw = root instanceof Error ? root.message : String(root);
    const msg = raw.toLowerCase();
    // Postgres: 'relation "users" does not exist'
    // SQLite: 'no such table: users'
    if (
      msg.includes('relation "users" does not exist') ||
      msg.includes("no such table") ||
      msg.includes("no such table: users")
    ) {
      return { status: "not-initialized" };
    }
    // Connection failures, auth errors, DNS, etc. Capture postgres-js's
    // `code` field if present so the dashboard can distinguish 28P01
    // (bad password) from ENOTFOUND (bad host) at a glance.
    const code =
      root && typeof root === "object" && "code" in root && typeof (root as { code: unknown }).code === "string"
        ? (root as { code: string }).code
        : undefined;
    const name = root instanceof Error ? root.name : "Error";
    const detail = `[${name}${code ? ` ${code}` : ""}] ${raw}`;
    return { status: "unreachable", error: redact(detail) };
  }
}

export async function GET(request: Request): Promise<Response> {
  const dbCheck = await checkDatabase();
  const checks: HealthChecks = {
    authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
    credentialEncryptionKey: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()),
    databaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    database: dbCheck.status
  };

  const status: "ok" | "degraded" =
    checks.authSecret &&
    checks.credentialEncryptionKey &&
    checks.databaseUrl &&
    checks.database === "ok"
      ? "ok"
      : "degraded";

  const body: HealthResponse = { status };
  // Operator-only detail requires the same bearer the cron routes use (SEC-03):
  //   - `checks` (which env vars are configured) + DB error text
  //   - `?snapshots=1` (runs DB reads — gating it prevents unauthenticated,
  //     unbounded DB I/O from the public internet; reviewer Issue 1)
  // The top-level `status` stays public for uptime monitors and the smoke test.
  const bearer = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  const authorized = Boolean(expected) && safeEqual(bearer, `Bearer ${expected}`);
  if (authorized) {
    body.checks = checks;
    if (dbCheck.error) {
      body.databaseError = dbCheck.error;
    }
    if (new URL(request.url).searchParams.get("snapshots") === "1") {
      body.snapshots = await snapshotFreshness(new Date());
    }
  }

  return NextResponse.json(body, { status: 200 });
}
