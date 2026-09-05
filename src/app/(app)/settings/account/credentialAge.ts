/**
 * How old a stored credential is, in words.
 *
 * ESPN cookies expire and ESPN does not tell anyone when. Age is therefore the
 * only signal a client has for "these probably stopped working", which is why
 * it is shown at all rather than a bare "connected" tick — a tick would claim a
 * liveness this app cannot observe without spending the credential.
 *
 * `now` is a parameter so the output is a function of its inputs and can be
 * tested at a fixed instant. Reading the clock inside would make the only
 * interesting cases untestable, and the rule against hardcoded timestamps cuts
 * the other way here: the age must be DERIVED at render, never baked in.
 */
export function formatCredentialAge(rotatedAt: Date | null, now: Date = new Date()): string | null {
  if (!rotatedAt) return null;
  const ms = now.getTime() - rotatedAt.getTime();
  // A clock skew between the app server and the database can put `rotatedAt` a
  // little in the future. "in -3 days" is worse than saying it just happened.
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return plural(minutes, "minute") + " ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour") + " ago";
  const days = Math.floor(hours / 24);
  return plural(days, "day") + " ago";
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
