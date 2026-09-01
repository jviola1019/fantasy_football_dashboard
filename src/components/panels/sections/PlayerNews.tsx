import type { RAEEnvelope } from "@/lib/governance";
import { newsForPlayer } from "@/lib/espn/newsLookup";
import { DataUnavailable } from "../../ui/DataUnavailable";
import { relativeAge } from "@/lib/utils";

/**
 * The headlines behind the "Trending" number.
 *
 * S4. `news-refresh` has written ESPN's NFL feed to `news_snapshots` every
 * morning since May, and the loader reduced it to one momentum score per player
 * and dropped the articles on the floor. The reader saw a figure derived from
 * real, attributable, timestamped reporting with no way to see what it was
 * derived FROM — the shape of thing the guardrails call a black-box
 * recommendation.
 *
 * Nothing here is generated. Every line is an ESPN headline, its own publication
 * timestamp, and its own link.
 */
export function PlayerNews({
  playerId,
  playerName,
  envelope
}: {
  playerId: string;
  playerName: string;
  envelope?: RAEEnvelope;
}) {
  const meta = envelope?.playerNewsMeta ?? null;
  const items = newsForPlayer(playerId, envelope?.playerNews);
  // Ages are stated against the envelope's own render instant, not `Date.now()`
  // — one declared reference point, and no server/client hydration drift.
  const now = envelope?.generatedAt ?? null;

  return (
    <div className="player-news" data-testid="player-news">
      <div className="section-label">
        PLAYER NEWS{meta ? <span className="player-news-src"> · {meta.source}</span> : null}
      </div>

      {!meta ? (
        <DataUnavailable
          title="News feed not loaded"
          description="No ESPN news snapshot is cached for this request, so no headlines are shown. The news-refresh cron writes one daily; until it has run there is nothing to attribute."
        />
      ) : items.length === 0 ? (
        <p className="small-note player-news-empty" role="status">
          No ESPN article in the current snapshot mentions {playerName}. Coverage is not the same as
          relevance — a starter can go a week without a headline.
        </p>
      ) : (
        <ul className="player-news-list">
          {items.map((item) => {
            const age = now ? relativeAge(item.publishedAt, now) : null;
            return (
              <li key={item.articleId} className="player-news-item">
                {item.url ? (
                  <a
                    className="player-news-headline"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.headline}
                    <span className="sr-only"> (opens on espn.com in a new tab)</span>
                  </a>
                ) : (
                  // ESPN occasionally publishes an article with no web link.
                  // Text, not a dead anchor.
                  <span className="player-news-headline">{item.headline}</span>
                )}
                {age ? (
                  <time className="player-news-age" dateTime={item.publishedAt}>
                    {age}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {meta ? (
        <p className="small-note player-news-prov">
          {meta.articleCount} article{meta.articleCount === 1 ? "" : "s"} in the snapshot, matched to{" "}
          {meta.coveredPlayers} player{meta.coveredPlayers === 1 ? "" : "s"} by Sleeper&rsquo;s{" "}
          <code>espn_id</code>. Snapshot taken{" "}
          {now ? (relativeAge(meta.fetchedAt, now) ?? "at an unknown time") : "at an unknown time"}.
          Times shown are each article&rsquo;s publication timestamp, or its last-modified time when
          ESPN omits one.
        </p>
      ) : null}
    </div>
  );
}
