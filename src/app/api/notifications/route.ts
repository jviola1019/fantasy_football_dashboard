import { NextResponse } from "next/server";
import { dismissNotificationForUser, listNotificationsForUser } from "@/lib/lifecycle/notifications";
import { requireUser } from "@/lib/auth/requireUser";

export const runtime = "nodejs";

/**
 * Audit 2026-08-06 F-004: these handlers trusted `session.user.id` straight from
 * a stateless JWT, so a revoked or deleted-user token still read and dismissed
 * notifications. `requireUser()` re-validates the session generation against the
 * database on every request.
 */
export async function GET(): Promise<Response> {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const notifications = await listNotificationsForUser(user.id);
  return NextResponse.json({ notifications });
}

export async function DELETE(request: Request): Promise<Response> {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const ok = await dismissNotificationForUser(user.id, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
