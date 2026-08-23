import { NextResponse } from "next/server";
import { safeEqual } from "../timingSafe";

/**
 * The Bearer-token gate every cron route sits behind.
 *
 * Audit 2026-08-22, P3. This block was COPY-PASTED into all seven cron routes,
 * identically, and covered by a single parameterised test. Seven copies of a
 * security check is seven chances for one to drift -- to lose the `!expected`
 * branch, to compare with `===` instead of `safeEqual`, or simply to be
 * forgotten on the eighth route somebody adds. `cronAuth.test.ts` asserts by
 * FILE SCAN that every route under `src/app/api/cron` calls this function, so
 * a new route cannot ship without the gate.
 *
 * Returns a Response to send when the request is NOT authorized, and `null`
 * when it is. Callers read it as: `const denied = requireCronAuth(request);
 * if (denied) return denied;`
 *
 * 503 when CRON_SECRET is unset is deliberate and is not a fallback to "allow":
 * an unconfigured deployment must refuse the work rather than run it for
 * anyone who asks.
 */
export function requireCronAuth(request: Request): Response | null {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Constant-time
  // compare: a short-circuiting one leaks the secret byte by byte to anyone
  // who can time the endpoint.
  if (!safeEqual(auth ?? "", `Bearer ${expected}`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}
