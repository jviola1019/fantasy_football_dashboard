/**
 * Turn an HTTP status into something a person can act on — without printing the
 * URL that produced it.
 *
 * TWO DEFECTS THIS EXISTS TO FIX, both found on 2026-09-02.
 *
 * 1. **The failure string is user-visible, and it contained the full URL.**
 *    `fetchWithEnvelope` built `HTTP ${status} from ${url}`, and
 *    `GovernancePanel.tsx` renders `sourceState.failure` verbatim as "Adapter
 *    note: …". For an ESPN request that URL is
 *    `.../seasons/2026/segments/0/leagues/<LEAGUE ID>?view=mSettings`, so a
 *    private league identifier was being painted onto the page and into any
 *    screenshot of it. CLAUDE.md's rule is "never expose private league
 *    credentials"; a league id is not a password, and it is not ours to publish
 *    either.
 *
 * 2. **A 401 read like a bug when it is a routine, fixable event.** ESPN's
 *    `espn_s2` cookie expires — that is ESPN's auth design and nothing this
 *    product stores can prevent it. The one thing that helps is saying so in
 *    the words that describe the remedy, instead of showing a status code.
 *
 * The host is kept because "which service failed" is exactly what a reader needs
 * and it is not sensitive. Everything after the host is dropped.
 */

/** Host only — no path, no query, no ids. Falls back to a fixed string. */
export function safeOrigin(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the upstream service";
  }
}

/**
 * A sentence for a failed request, chosen by status and by who owns the fix.
 *
 * `credentialed` says whether this request carried user credentials. A 401 on an
 * anonymous endpoint is an upstream change; the same status on a credentialed
 * one is almost always an expired cookie, and telling the user to re-paste
 * cookies they never entered would be worse than saying nothing.
 */
export function describeHttpFailure(
  status: number,
  url: string,
  opts: { credentialed?: boolean; service?: string } = {}
): string {
  const where = opts.service ?? safeOrigin(url);
  if (status === 401 || status === 403) {
    return opts.credentialed
      ? `${where} rejected the stored credentials (HTTP ${status}). ESPN's espn_s2 and SWID ` +
          `cookies expire; paste fresh ones in Settings → Leagues to restore this league.`
      : `${where} refused the request (HTTP ${status}). This endpoint needs credentials this ` +
          `app does not hold.`;
  }
  if (status === 404) {
    return `${where} has no such resource (HTTP 404). The league id or season may be wrong, or the league may be private.`;
  }
  if (status === 429) return `${where} is rate-limiting this app (HTTP 429). It will retry.`;
  if (status >= 500) return `${where} returned a server error (HTTP ${status}).`;
  return `${where} returned HTTP ${status}.`;
}

/**
 * Replace any absolute URL in a message with its host.
 *
 * Node's fetch rejects with messages that quote the request back —
 * `"request to https://…/leagues/1546190?view=mSettings failed, reason: …"` —
 * and `fetchWithEnvelope` puts that message into `sourceState.failure`, which
 * `GovernancePanel` renders. The reason is worth keeping; the path is not.
 */
export function redactUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s"')]+/g, (m) => safeOrigin(m));
}
