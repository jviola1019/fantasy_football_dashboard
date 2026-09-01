import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerNews } from "./PlayerNews";
import { FaabBoard } from "./FaabBoard";
import type { RAEEnvelope } from "@/lib/governance";

/**
 * The first render tests in this repository.
 *
 * S4. `@testing-library/react` has been a dependency with ZERO `.test.tsx`
 * files consuming it, so no component had a render test of any kind, and the
 * only per-panel coverage was an e2e run — which in CI hits an EMPTY database
 * and therefore only ever exercises the unavailable state. The populated branch
 * of every panel has been shipping unverified.
 *
 * `react-dom/server` closes that without adding a dependency: these are plain
 * function components with no hooks and no browser APIs, so static markup is
 * the whole render.
 */

const envelope = (over: Partial<RAEEnvelope> = {}) =>
  ({ generatedAt: "2026-09-01T12:00:00.000Z", ...over }) as unknown as RAEEnvelope;

describe("PlayerNews renders real headlines", () => {
  const populated = envelope({
    playerNews: {
      "sleeper:4046": [
        {
          articleId: 1,
          headline: "Aaron Donald misses practice as planned",
          publishedAt: "2026-09-01T09:00:00.000Z",
          url: "https://www.espn.com/nfl/story/_/id/1"
        },
        {
          articleId: 2,
          headline: "An article with no web link",
          publishedAt: "2026-08-30T12:00:00.000Z",
          url: null
        }
      ]
    },
    playerNewsMeta: {
      source: "ESPN NFL news",
      fetchedAt: "2026-09-01T09:20:00.000Z",
      articleCount: 50,
      coveredPlayers: 77
    }
  });

  const html = renderToStaticMarkup(
    <PlayerNews playerId="sleeper:4046" playerName="Aaron Donald" envelope={populated} />
  );

  it("prints the headline text itself", () => {
    expect(html).toContain("Aaron Donald misses practice as planned");
  });

  it("links out to ESPN safely, in a new tab", () => {
    expect(html).toContain('href="https://www.espn.com/nfl/story/_/id/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders an unlinked article as text rather than a dead anchor", () => {
    expect(html).toContain("An article with no web link");
    // Two items, exactly one anchor.
    expect(html.match(/<a /g) ?? []).toHaveLength(1);
  });

  it("states each article's age against the envelope's own render instant", () => {
    // 12:00 render, 09:00 publication -> 3h. Computed from `generatedAt` rather
    // than Date.now(), so server and client agree and there is no hydration
    // drift on an otherwise deterministic page.
    expect(html).toContain("3h ago");
    expect(html).toContain("2d ago");
    // Case-insensitive: `renderToStaticMarkup` emits the JSX prop name verbatim
    // as `dateTime=`, and HTML attribute names are ASCII case-insensitive, so
    // the browser parses it as `datetime`. Asserting the lowercase form exactly
    // would fail on markup that is correct.
    expect(html).toMatch(/datetime="2026-09-01T09:00:00\.000Z"/i);
  });

  it("states provenance: how many articles, how many matched, how old", () => {
    expect(html).toContain("50 articles");
    expect(html).toContain("77 players");
    expect(html).toContain("2h ago"); // 09:20 snapshot against a 12:00 render
  });

  it("says so when the player has no coverage, rather than rendering blank", () => {
    const out = renderToStaticMarkup(
      <PlayerNews playerId="sleeper:9999" playerName="Nobody" envelope={populated} />
    );
    expect(out).toContain("No ESPN article in the current snapshot mentions Nobody");
  });

  it("says so when no snapshot is cached at all", () => {
    const out = renderToStaticMarkup(
      <PlayerNews playerId="sleeper:4046" playerName="Aaron Donald" envelope={envelope()} />
    );
    expect(out).toContain("News feed not loaded");
  });

  it("finds a player by bare id too, so no caller can repeat D-A", () => {
    const out = renderToStaticMarkup(
      <PlayerNews playerId="4046" playerName="Aaron Donald" envelope={populated} />
    );
    expect(out).toContain("misses practice as planned");
  });
});

describe("FaabBoard renders dollars", () => {
  const withFaab = envelope({
    faab: {
      total: 100,
      teamCount: 3,
      budgets: [
        { teamId: "3", teamName: "charlie", isMine: false, total: 100, remaining: 100, ratio: 1 },
        { teamId: "1", teamName: "jviola1019", isMine: true, total: 100, remaining: 63, ratio: 0.63 },
        { teamId: "2", teamName: "Bob", isMine: false, total: 100, remaining: 20, ratio: 0.2 }
      ]
    }
  });

  const html = renderToStaticMarkup(<FaabBoard envelope={withFaab} />);

  it("leads with the user's own budget in dollars, not a ratio", () => {
    expect(html).toContain("$63");
    expect(html).toContain("of $100 left");
    expect(html).not.toContain("0.63");
  });

  it("names the richest rival, which is what decides a bid", () => {
    expect(html).toContain("the richest rival holds");
  });

  it("draws every team and marks exactly one as yours", () => {
    // Asserted through what a READER perceives — one row annotated "you", and
    // one labelled bar per team — rather than through class names, which S5
    // legitimately renamed when the panel adopted the shared BarChart.
    expect(html.match(/of \$100 remaining/g) ?? []).toHaveLength(3);
    expect(html.match(/· you/g) ?? []).toHaveLength(1);
  });

  it("gives every bar a text alternative", () => {
    expect(html).toContain('aria-label="Bob: $20 of $100 remaining"');
  });

  it("discloses coverage and the starting budget", () => {
    expect(html).toContain("3 of 3 team");
    expect(html).toContain("Starting budget $100 each");
  });

  it("discloses when a team was dropped for incoherent numbers", () => {
    const partial = envelope({
      faab: {
        total: 100,
        teamCount: 10,
        budgets: [
          { teamId: "1", teamName: "Me", isMine: true, total: 100, remaining: 63, ratio: 0.63 }
        ]
      }
    });
    expect(renderToStaticMarkup(<FaabBoard envelope={partial} />)).toContain(
      "did not add up and were left out"
    );
  });

  it("marks nobody as yours when identity is unresolved", () => {
    const anon = envelope({
      faab: {
        total: 100,
        teamCount: 1,
        budgets: [
          { teamId: "1", teamName: "Someone", isMine: false, total: 100, remaining: 63, ratio: 0.63 }
        ]
      }
    });
    const out = renderToStaticMarkup(<FaabBoard envelope={anon} />);
    expect(out).toContain("Your own team could not be identified");
    expect(out).not.toContain("· you");
  });

  it("names the settings it read when the league does not use FAAB", () => {
    const out = renderToStaticMarkup(<FaabBoard envelope={envelope()} />);
    expect(out).toContain("This league does not use FAAB");
    expect(out).toContain("waiver_type 2");
  });
});
