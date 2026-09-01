import type { PlayerNewsIndex, PlayerNewsItem } from "./newsMatch";

/**
 * Headlines for one record, tolerant of either id form.
 *
 * Deliberately in its OWN module, away from `newsMatch.ts`, purely for bundle
 * reasons: this is the only part of the news pipeline a client component calls,
 * and `newsMatch.ts` imports zod to declare the schemas the envelope validates
 * against. A runtime import of that module from `PlayerNews.tsx` — which is
 * pulled into the client graph by `PlayerUniverse`'s `"use client"` — would ship
 * the whole of zod to the browser for the three lines below. The type import
 * above is erased at compile time and costs nothing.
 *
 * The normalisation itself is the same one `newsScoreFor` and
 * `trendingMomentumFromProxy` apply. Audit finding D-A was a lookup that did NOT
 * apply it, against a map keyed the other way, which silently returned nothing
 * for every player in the catalog. `buildPlayerNewsIndex` keys by record id so
 * the common case needs no normalisation at all; this covers the rest.
 */
export function newsForPlayer(
  recordId: string,
  index: PlayerNewsIndex | null | undefined
): PlayerNewsItem[] {
  if (!index) return [];
  const bare = recordId.startsWith("sleeper:") ? recordId.slice("sleeper:".length) : recordId;
  return index[recordId] ?? index[`sleeper:${bare}`] ?? [];
}
