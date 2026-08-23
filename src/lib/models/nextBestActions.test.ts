import { describe, expect, it } from "vitest";
import { deriveNextBestActions } from "./nextBestActions";
import type { PlayerMarketRecord } from "@/lib/governance";

/**
 * The recommendation list on `/dashboard` — the answer to "what should I do
 * next?" — had no tests. It lived inside the panel component, where the only
 * way to exercise it was to render React.
 *
 * That matters more than a normal coverage gap, because this is the one place
 * RAE tells a user to DO something. CLAUDE.md forbids fabricating data; a
 * recommendation invented from nothing is the same offence in a louder voice.
 * The property under test throughout is that every action traces to a real
 * field, and that the list is EMPTY when nothing crosses a threshold rather
 * than padded to look busy.
 */
const p = (over: Partial<PlayerMarketRecord> & { name: string }): PlayerMarketRecord =>
  ({
    id: `p-${over.name}`,
    position: "RB",
    team: "AAA",
    perceivedValue: 50,
    trueValue: 50,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    rosterSlot: "RB",
    status: "active",
    sources: [],
    ...over
  }) as unknown as PlayerMarketRecord;

describe("deriveNextBestActions", () => {
  it("returns NOTHING when nothing crosses a threshold", () => {
    // A healthy roster and a flat market produce no urgent move. The honest
    // output is an empty list; padding it would train the reader to ignore it.
    const flat = [p({ name: "A" }), p({ name: "B" })];
    expect(deriveNextBestActions({ roster: flat, market: [] })).toEqual([]);
  });

  it("puts availability risk first, ahead of any market edge", () => {
    // An unavailable starter costs points THIS week; a market edge costs points
    // eventually. The ordering is a deliberate severity claim, not incidental.
    const actions = deriveNextBestActions({
      roster: [p({ name: "Hurt Guy", status: "out" })],
      market: [p({ name: "Hyped Guy", trendingMomentum: 90, perceivedValue: 90, trueValue: 20 })]
    });
    expect(actions[0]?.title).toContain("Hurt Guy");
    expect(actions[0]?.tone).toBe("risk");
  });

  it("ranks out/IR above questionable", () => {
    const actions = deriveNextBestActions({
      roster: [p({ name: "Maybe", status: "questionable" }), p({ name: "Definitely Out", status: "out" })],
      market: []
    });
    expect(actions[0]?.title).toContain("Definitely Out");
  });

  it("caps availability actions at two so one bad week cannot fill the panel", () => {
    const roster = ["A", "B", "C", "D"].map((name) => p({ name, status: "out" }));
    const risks = deriveNextBestActions({ roster, market: [] }).filter((a) => a.tone === "risk");
    expect(risks).toHaveLength(2);
  });

  it("sends every action to a route where the user can actually act", () => {
    const actions = deriveNextBestActions({
      roster: [p({ name: "Hurt", status: "out" })],
      market: [
        p({ name: "Hyped", trendingMomentum: 90, perceivedValue: 95, trueValue: 30 }),
        p({ name: "Sleeper", trendingMomentum: 0, perceivedValue: 20, trueValue: 90 })
      ]
    });
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.href).toMatch(/^\/(waivers|trades|draft)$/);
      expect(a.detail.length).toBeGreaterThan(0); // every action states its basis
    }
  });

  it("points a PRE-draft user at the draft, not the waiver wire", () => {
    const market = [p({ name: "Target", trueValue: 95 })];
    const pre = deriveNextBestActions({ roster: [], market, draftState: "pre" });
    const post = deriveNextBestActions({ roster: [], market, draftState: "post" });
    expect(pre.at(-1)?.href).toBe("/draft");
    expect(post.at(-1)?.href).toBe("/waivers");
  });

  it("prefers observed USAGE over consensus value when usage exists", () => {
    // Protocols 1-3 refuted the consensus-derived valuation; protocols 4-5
    // validated in-season usage. When usage is present it should decide the top
    // market target, and the detail line should say so.
    const market = [
      p({ name: "High Value No Usage", trueValue: 99, opportunity: 0 }),
      p({ name: "High Usage", trueValue: 40, opportunity: 88 })
    ];
    const target = deriveNextBestActions({ roster: [], market }).at(-1);
    expect(target?.title).toContain("High Usage");
    expect(target?.detail).toMatch(/snap usage/);
  });

  it("falls back to value, and says value, when no usage is available", () => {
    const market = [p({ name: "Best Value", trueValue: 99 }), p({ name: "Worse", trueValue: 10 })];
    const target = deriveNextBestActions({ roster: [], market }).at(-1);
    expect(target?.title).toContain("Best Value");
    expect(target?.detail).toMatch(/value/);
    expect(target?.detail).not.toMatch(/snap usage/);
  });

  it("never recommends selling a player the market is not actually hyping", () => {
    // The sell-high rule requires hype to exceed the edge by a margin. Without
    // the threshold every player becomes a "sell high", which is advice-shaped
    // noise rather than advice.
    const market = [p({ name: "Fairly Priced", trendingMomentum: 5, perceivedValue: 50, trueValue: 50 })];
    const sells = deriveNextBestActions({ roster: [], market }).filter((a) => a.tone === "sell");
    expect(sells).toEqual([]);
  });

  it("survives an empty roster and an empty market without inventing anything", () => {
    expect(deriveNextBestActions({ roster: [], market: [] })).toEqual([]);
    expect(deriveNextBestActions({ roster: [], market: [], draftState: "unknown" })).toEqual([]);
  });
});
