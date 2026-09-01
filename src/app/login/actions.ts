"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { getDb } from "@/db";
import { createUserWithPassword } from "@/lib/users";
import { mapAuthError } from "@/lib/auth/errors";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { checkThrottle, clearAccountThrottle, recordFailure } from "@/lib/auth/throttle";
import { headers } from "next/headers";

/**
 * Best-effort client address for the per-IP throttle dimension. Vercel sets
 * x-forwarded-for; the LEFTMOST entry is the client. Returns null rather than
 * guessing when no header is present, so the account and global dimensions
 * still apply.
 */
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return h.get("x-real-ip");
}

/**
 * Shown whenever a throttle trips. Deliberately identical for "this account is
 * locked" and "this IP is locked" so the response cannot be used to probe which
 * dimension was hit, or whether the account exists at all.
 */
const THROTTLED_MESSAGE = "Too many attempts. Wait a few minutes and try again.";

// Bounds matter here, not just minimums: scrypt hashes the whole input, so an
// unbounded password on a public endpoint is a CPU/memory amplifier (audit
// F-005). Email and name are capped for the same reason.
const inputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  name: z.string().max(200).optional()
});

export type AuthActionResult = { ok: true } | { ok: false; error: string };



/**
 * The sign-in cookie is set by `signIn`; the NAVIGATION is left to the client.
 *
 * Audit 2026-08-23. Both actions used to pass `redirectTo`, which makes Auth.js
 * throw NEXT_REDIRECT and lets Next perform the navigation. That navigation is
 * CLIENT-side: the React tree survives it, so `SessionProvider` keeps the
 * unauthenticated session it fetched on first mount and `useSession()` in the
 * topbar stays stale.
 *
 * The result was the worst kind of failure. Authentication SUCCEEDED, the
 * protected route rendered, and the one piece of chrome a user checks to
 * confirm it still offered them a "Sign in" button. Most people read that as
 * "it did not work" and try again.
 *
 * It also made the form's success branch unreachable -- its own comment said
 * "we never observe ok=true" -- so any fix applied there was dead code, which
 * is how two attempts at this were measured to change nothing.
 *
 * With `redirect: false` the action returns normally, the client gets `ok:
 * true`, and it performs a full document navigation that remounts the provider
 * against the new cookie. Throttle clearing and failure recording are unchanged.
 */
export async function signInWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and an 8+ character password." };

  // Check BEFORE signIn: the timing equalizer means even an unknown account
  // costs a full scrypt derivation, so a blocked request must not reach it.
  const ip = await clientIp();
  const identifiers = { account: parsed.data.email, ip };
  const gate = await checkThrottle(identifiers);
  if (!gate.allowed) return { ok: false, error: THROTTLED_MESSAGE };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false
    });
    await clearAccountThrottle(parsed.data.email);
    return { ok: true };
  } catch (error) {
    // A successful sign-in throws a redirect; that is NOT a failed attempt.
    if (isRedirectError(error)) {
      await clearAccountThrottle(parsed.data.email);
      throw error;
    }
    await recordFailure(identifiers);
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function registerWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and an 8+ character password." };

  const ip = await clientIp();
  const identifiers = { account: parsed.data.email, ip };
  const gate = await checkThrottle(identifiers);
  if (!gate.allowed) return { ok: false, error: THROTTLED_MESSAGE };

  try {
    await createUserWithPassword(getDb(), parsed.data);
  } catch (error) {
    // Registration failures are throttled too, otherwise the endpoint below is
    // an unlimited account-existence probe.
    await recordFailure(identifiers);
    return { ok: false, error: mapAuthError(error) };
  }
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false
    });
    return { ok: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: mapAuthError(error) };
  }
}
