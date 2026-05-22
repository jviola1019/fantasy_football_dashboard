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
}

async function checkDatabase(): Promise<DatabaseStatus> {
  try {
    const db = getDb();
    // A trivial read against the users table — presence confirms schema is initialized.
    await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return "ok";
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    // Postgres: 'relation "users" does not exist'
    // SQLite: 'no such table: users'
    if (
      msg.includes('relation "users" does not exist') ||
      msg.includes("no such table") ||
      msg.includes("no such table: users")
    ) {
      return "not-initialized";
    }
    // Connection failures, auth errors, DNS, etc.
    return "unreachable";
  }
}

export async function GET(): Promise<Response> {
  const checks: HealthChecks = {
    authSecret: Boolean(process.env.AUTH_SECRET?.trim()),
    credentialEncryptionKey: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY?.trim()),
    databaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    database: await checkDatabase()
  };

  const status: "ok" | "degraded" =
    checks.authSecret &&
    checks.credentialEncryptionKey &&
    checks.databaseUrl &&
    checks.database === "ok"
      ? "ok"
      : "degraded";

  const body: HealthResponse = { status, checks };

  return NextResponse.json(body, { status: 200 });
}
