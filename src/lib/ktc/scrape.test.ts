import { describe, it, expect } from "vitest";
import { fetchKtcRankings } from "./scrape";

// Compact fixture HTML mimicking the KTC page wrapping pattern: arbitrary
// markup before/after the inline `playersArray = [...]` assignment.
function fixtureHtml(players: unknown[]): string {
  return `<html><head></head><body>
    <script>
      window.__SOMETHING = { foo: 1 };
      var playersArray = ${JSON.stringify(players)};
      // other site bootstrap...
    </script>
  </body></html>`;
}

// Build a minimal valid KTC player object matching the schema.
function ktcPlayer(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    playerName: "Test Player",
    playerID: 999,
    slug: "test-player-999",
    position: "RB",
    positionID: 2,
    team: "TST",
    rookie: false,
    age: 25,
    oneQBValues: {
      startSitValue: 5000,
      overall7DayTrend: 1,
      positional7DayTrend: 0,
      kept: 1000,
      traded: 500,
      cut: 200,
      startSitOverallRank: 50,
      startSitPositionalRank: 5
    },
    superflexValues: {
      startSitValue: 5500
    },
    ...over
  };
}

function makeFetcher(html: string): typeof fetch {
  return (async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    })) as typeof fetch;
}

describe("fetchKtcRankings", () => {
  it("parses playersArray from inline HTML and returns validated payload", async () => {
    const fetcher = makeFetcher(fixtureHtml([ktcPlayer(), ktcPlayer({ playerID: 1000 })]));
    const data = await fetchKtcRankings({ variant: "dynasty", url: "https://stub", fetcher });
    expect(data.variant).toBe("dynasty");
    expect(data.players.length).toBe(2);
    expect(data.players[0]!.playerName).toBe("Test Player");
    expect(data.players[0]!.oneQBValues.startSitValue).toBe(5000);
  });

  it("filters out PICK position entries (rookie picks have no player to grade)", async () => {
    const fetcher = makeFetcher(
      fixtureHtml([
        ktcPlayer(),
        ktcPlayer({ playerID: 2000, position: "PICK", playerName: "2026 1.01" })
      ])
    );
    const data = await fetchKtcRankings({ variant: "redraft", url: "https://stub", fetcher });
    expect(data.players.length).toBe(1);
    expect(data.players[0]!.position).toBe("RB");
  });

  it("throws a descriptive error when playersArray is absent from the HTML", async () => {
    const fetcher = makeFetcher("<html><body><p>no array here</p></body></html>");
    await expect(
      fetchKtcRankings({ variant: "dynasty", url: "https://stub", fetcher })
    ).rejects.toThrow(/did not contain playersArray/);
  });

  it("throws a descriptive error when the response is not 2xx", async () => {
    const fetcher: typeof fetch = (async () =>
      new Response("forbidden", { status: 403, statusText: "Forbidden" })) as typeof fetch;
    await expect(
      fetchKtcRankings({ variant: "dynasty", url: "https://stub", fetcher })
    ).rejects.toThrow(/HTTP failure|403/);
  });

  it("throws when playersArray exists but is not an array literal", async () => {
    const fetcher = makeFetcher(
      "<html><body><script>var playersArray = [{bad json};</script></body></html>"
    );
    await expect(
      fetchKtcRankings({ variant: "dynasty", url: "https://stub", fetcher })
    ).rejects.toThrow(/not valid JSON|did not contain/);
  });

  it("throws when payload fails schema validation (e.g. oneQBValues missing)", async () => {
    const fetcher = makeFetcher(
      fixtureHtml([
        {
          playerName: "Bad Player",
          playerID: 1,
          position: "RB"
          // oneQBValues intentionally missing
        }
      ])
    );
    await expect(
      fetchKtcRankings({ variant: "dynasty", url: "https://stub", fetcher })
    ).rejects.toThrow(/failed schema validation/);
  });
});
