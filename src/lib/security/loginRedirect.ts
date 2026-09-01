/**
 * Where to send an anonymous visitor to sign in — on the host they actually
 * asked for, without trusting a header to say which.
 *
 * WHY THIS IS NOT A ONE-LINER.
 *
 * Audit 2026-08-23. The proxy used to redirect to
 * `new URL("/login", request.nextUrl.origin)`, and `request.nextUrl` is NOT the
 * URL the browser requested: next-auth rewrites it from `AUTH_URL` before the
 * handler runs. On a Vercel preview with `AUTH_URL` pinned to the production
 * host, an anonymous visit to `/settings/leagues` redirected to PRODUCTION's
 * login page. You would sign in there, come back to the preview, and still be
 * anonymous, because the session cookie belongs to a different host. Sign-in was
 * unreachable on every preview deployment, silently, and the e2e test asserting
 * "the URL matches /login" passed the entire time — it never looked at origin.
 *
 * The obvious fix is to rebuild the origin from `x-forwarded-host`. That was
 * tried and MEASURED to be an open redirect: with the header set to
 * `evil.com:99999` the response was `Location: http://evil.com/login`. A regex
 * that only rejects malformed hosts cannot reject a well-formed hostile one —
 * the whole point of the header is that it comes from outside.
 *
 * So the header is only honoured when it names a host the OPERATOR has already
 * declared, via Vercel's own system environment variables. Those are not
 * attacker-supplied, so there is no redirect surface. Anything else falls back
 * to the previous behaviour rather than failing the request: a user who cannot
 * reach the login page is worse off than one who reaches the wrong copy of it.
 */

/**
 * Hosts this deployment may redirect to, from Vercel's system environment.
 *
 * - `VERCEL_URL` — this deployment's own URL. On a preview this is the host the
 *   bug was sending people away from, so it is the one that matters.
 * - `VERCEL_BRANCH_URL` — the branch alias.
 * - `VERCEL_PROJECT_PRODUCTION_URL` — the production domain.
 *
 * Absent off Vercel, and absent if the project turns system variables off. Both
 * cases yield an empty set and the previous behaviour, which is correct: without
 * `AUTH_URL` there was never anything to correct.
 */
export function deploymentHosts(env: Record<string, string | undefined>): ReadonlySet<string> {
  const hosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((h): h is string => typeof h === "string" && h.length > 0)
    .map((h) => h.trim().toLowerCase())
    // Vercel gives these WITHOUT a scheme. Strip one anyway rather than silently
    // never matching if that ever changes.
    .map((h) => h.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  return new Set(hosts);
}

export interface LoginOriginInput {
  /** `x-forwarded-host`, else `host`. Untrusted. */
  headerHost: string | null;
  /** `x-forwarded-proto`. Untrusted, and only consulted for an allowed host. */
  forwardedProto: string | null;
  /** Hosts the operator declared — see `deploymentHosts`. */
  allowed: ReadonlySet<string>;
}

/**
 * The host and protocol to use, or `null` to keep whatever the caller had.
 *
 * `null` is the safe answer and the common one: off Vercel there is nothing to
 * correct, and `request.nextUrl` is already right.
 */
export function resolveLoginOrigin(
  input: LoginOriginInput
): { host: string; protocol: "http:" | "https:" } | null {
  const raw = input.headerHost?.trim().toLowerCase();
  if (!raw) return null;
  // A comma-joined list means something upstream appended to the header. Which
  // entry is authoritative depends on hop count, so refuse to guess.
  if (raw.includes(",")) return null;
  if (!input.allowed.has(raw)) return null;

  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  // Vercel terminates TLS, so an allowed deployment host is https. Only an
  // explicit http claim downgrades it, and only for a host already allowed.
  return { host: raw, protocol: proto === "http" ? "http:" : "https:" };
}
