import { NextResponse } from "next/server";
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

  const driver = getDriver();
  if (driver !== "postgres") {
    return NextResponse.json({ ok: true, driver, note: "no-op on non-postgres driver" });
  }

  const db = getDb() as unknown as PgExec;
  await db.execute(INIT_SQL);
  return NextResponse.json({ ok: true, driver, applied: true });
}
