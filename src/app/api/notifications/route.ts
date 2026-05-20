import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dismissNotificationForUser, listNotificationsForUser } from "@/lib/lifecycle/notifications";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const notifications = await listNotificationsForUser(session.user.id);
  return NextResponse.json({ notifications });
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const ok = await dismissNotificationForUser(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
