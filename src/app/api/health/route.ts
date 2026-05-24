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

// Drizzle wraps the driver's real failure as the `cause` of a generic
// "Failed query" error. Walk the cause chain (bounded to avoid loops)
// to surface the postgres-js error that actually explains what went wrong.
function unwrap(err: unknown): unknown {
  let cur = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    const next = (cur as { cause: unknown }).cause;
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
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
