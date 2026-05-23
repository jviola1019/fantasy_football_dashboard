import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";

export const runtime = "nodejs";

type DatabaseStatus = "ok" | "unreachable" | "not-initialized";

interface HealthChecks {
  authSecret: boolean;
  credentialEncryptionKey: boolean;
  databaseUrl: boolean;
  database: DatabaseStatus;
}

interface HealthResponse {
  status: "ok" | "degraded";
  checks: HealthChecks;
  // Present only when `database` is not "ok". Includes the postgres-js
  // error code and a redacted message — the actual cause (auth failure,
  // DNS, TLS, etc.) instead of a generic "unreachable" bucket. Anything
  // resembling a connection string is scrubbed before being returned.
  databaseError?: string;
}

interface CheckResult {
  status: DatabaseStatus;
  error?: string;
}

// Scrub any postgres URL or password-looking token from an error string
// before it leaves the server, so this endpoint stays safe to leave public.
function redact(raw: string): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgres://[REDACTED]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .slice(0, 300);
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const db = getDb();
    // A trivial read against the users table — presence confirms schema is initialized.
    await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return { status: "ok" };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
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
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    const detail = code ? `[${code}] ${raw}` : raw;
    return { status: "unreachable", error: redact(detail) };
  }
}

export async function GET(): Promise<Response> {
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

  const body: HealthResponse = { status, checks };
  if (dbCheck.error) {
    body.databaseError = dbCheck.error;
  }

  return NextResponse.json(body, { status: 200 });
}
