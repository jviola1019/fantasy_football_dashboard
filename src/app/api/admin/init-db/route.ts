import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, getDriver } from "@/db";
import { INIT_SQL } from "@/db/schema-pg";

export const runtime = "nodejs";

interface PgExec {
  execute: (q: unknown) => Promise<unknown>;
}

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("x-init-token");
  const expected = process.env.DB_INIT_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "DB_INIT_TOKEN is not set" }, { status: 503 });
  }
  if (token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const driver = getDriver();
    if (driver !== "postgres") {
      return NextResponse.json({ ok: true, driver, note: "no-op on non-postgres driver" });
    }

    const db = getDb() as unknown as PgExec;
    // postgres.js sends a single command per query, so the multi-statement DDL
    // must be split and each statement applied on its own.
    const statements = INIT_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
    return NextResponse.json({ ok: true, driver, applied: statements.length });
  } catch (err) {
    // This route is token-gated, so returning the detail to the caller is safe
    // and makes a failed Postgres bootstrap diagnosable without log spelunking.
    return NextResponse.json(
      { error: "init failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
