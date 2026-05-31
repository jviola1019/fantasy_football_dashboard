/**
 * Shared diagnostic-output helpers for API/cron routes.
 *
 * Consolidated from six near-identical copies (health + five cron routes) that
 * had silently drifted on truncation length (300 vs 400). Keeping one source
 * means a future tweak to the redaction patterns applies everywhere at once.
 */

/**
 * Strip secrets from an error message before it is returned in a diagnostic
 * response body. Redacts Postgres connection strings and `password=` pairs, then
 * truncates so a huge driver error can't flood the response.
 */
export function redact(raw: string, max = 400): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgres://[REDACTED]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .slice(0, max);
}

/**
 * Walk an error's `cause` chain (bounded to 5 hops, cycle-safe) to surface the
 * root cause — driver/network errors often wrap the real failure several layers
 * deep.
 */
export function unwrap(err: unknown): unknown {
  let cur = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    const next = (cur as { cause: unknown }).cause;
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}
