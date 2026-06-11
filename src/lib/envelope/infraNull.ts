/**
 * `.catch` handler for snapshot/external reads on the envelope path.
 *
 * The snapshot store already returns `null` for every LEGITIMATE-absence case
 * (no rows yet, payload fails validation) — so a rejection reaching one of
 * these catches is infrastructure-shaped by construction: missing table, bad
 * credentials, connection timeout, provider API break. Returning `null` keeps
 * the UI's honest "unavailable" rendering; the log keeps the operator from
 * months of blindness (the opportunity_snapshots lesson: the bug wasn't the
 * missing table, it was that nothing ever said the table was missing).
 *
 * Logs once per key per process — the envelope is request-cached and hot, so
 * an unconditional log would spam every request during an outage.
 */
const logged = new Set<string>();

export function infraNull(key: string): (err: unknown) => null {
  return (err) => {
    if (!logged.has(key)) {
      logged.add(key);
      console.error(`[envelope] ${key} read failed (infrastructure error, not data absence):`, err);
    }
    return null;
  };
}

export function resetInfraLogForTests(): void {
  logged.clear();
}
