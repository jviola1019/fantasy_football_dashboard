/**
 * Headshot URL resolution. Returns an ordered list of sources the
 * <PlayerHeadshot/> component tries in sequence. When all sources fail (or
 * none are configured), the component falls back to a deterministic initials
 * avatar so we never render a wrong-player image.
 *
 * Why ordered fallback rather than a single URL: production live data sources
 * (Sleeper, ESPN) sometimes serve 404s for the same player at different CDNs.
 * Trying Sleeper first then ESPN is robust without ever silently mapping the
 * wrong face to the wrong name — every source is keyed by the *same* canonical
 * player identifier we trust.
 */

export interface HeadshotSourcesInput {
  /** Sleeper canonical player_id. Preferred when present. */
  sleeperId?: string | null;
  /** ESPN canonical player id. Used only when Sleeper is unavailable. */
  espnId?: string | number | null;
}

const SLEEPER_HEADSHOT_BASE = "https://sleepercdn.com/content/nfl/players/thumb";
const ESPN_HEADSHOT_BASE = "https://a.espncdn.com/i/headshots/nfl/players/full";

/**
 * Build the ordered list of headshot URLs to try for a given player.
 * The first present URL is preferred. Empty array means "no sources" →
 * render the initials avatar.
 */
export function getHeadshotSources(input: HeadshotSourcesInput): string[] {
  const out: string[] = [];
  if (input.sleeperId && /^\d+$/.test(String(input.sleeperId))) {
    out.push(`${SLEEPER_HEADSHOT_BASE}/${input.sleeperId}.jpg`);
  }
  if (input.espnId != null && /^\d+$/.test(String(input.espnId))) {
    out.push(`${ESPN_HEADSHOT_BASE}/${input.espnId}.png`);
  }
  return out;
}

/** Convenience: first source, or null when nothing is available. */
export function primaryHeadshot(input: HeadshotSourcesInput): string | null {
  const sources = getHeadshotSources(input);
  return sources[0] ?? null;
}
