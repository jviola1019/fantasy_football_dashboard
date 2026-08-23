import { describe, expect, it } from "vitest";
import { deriveAppData } from "./derive";
import { fixtureEnvelope } from "../fixtures";
import type { RAEEnvelope, PlayerMarketRecord } from "../governance";

/**
 * Which players each route is looking at (audit 2026-08-23).
 *
 * This is the season-mirror rule the whole Sprint 5 data model rests on, and it
 * had one incidental assertion covering it. It decides what the market-facing
 * routes SHOW:
 *
 *   pre-draft   the whole league universe — nobody is rostered yet, so every
 *               player is a draft candidate
 *   post-draft  free agents only — a rostered player is not a waiver target,
 *               and listing them is how a waiver panel starts recommending
 *               somebody else's starter
 *   unknown     the user's own roster, because guessing between the two would
 *               put a confident wrong pool in front of the reader
 *
 * Getting this wrong is silent: every panel still renders, the numbers are all
 * real, and they answer a different question than the one on screen.
 */
const player = (id: string, over: Partial<PlayerMarketRecord> = {}): PlayerMarketRecord =>
  ({
    id,
    name: id,
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
    byeWeek: 7,
    sources: [],
    ...over
  }) as unknown as PlayerMarketRecord;

const envelopeWith = (over: Partial<RAEEnvelope>): RAEEnvelope =>
  ({ ...fixtureEnvelope(), ...over }) as RAEEnvelope;

const roster = [player("mine-1"), player("mine-2")];
const universe = [player("mine-1"), player("mine-2"), player("fa-1"), player("fa-2"), player("fa-3")];
const freeAgents = [player("fa-1"), player("fa-2"), player("fa-3")];

describe("market pool follows the draft state", () => {
  it("PRE-draft shows the whole league universe", () => {
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: universe, freeAgents, draftState: "pre" })
    );
    expect(d.marketPool.map((p) => p.id).sort()).toEqual(universe.map((p) => p.id).sort());
  });

  it("POST-draft shows free agents only, never a rostered player", () => {
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: universe, freeAgents, draftState: "post" })
    );
    expect(d.marketPool.map((p) => p.id).sort()).toEqual(freeAgents.map((p) => p.id).sort());
    // The decisive assertion: a waiver panel must not offer a player who is
    // already on a team.
    for (const owned of roster) {
      expect(d.marketPool.some((p) => p.id === owned.id)).toBe(false);
    }
  });

  it("UNKNOWN draft state falls back to the user's own roster, not a guess", () => {
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: universe, freeAgents, draftState: "unknown" })
    );
    expect(d.marketPool.map((p) => p.id).sort()).toEqual(roster.map((p) => p.id).sort());
  });

  it("keeps the universe and free-agent pools separately addressable", () => {
    // /players reads the universe and /waivers reads the market pool; collapsing
    // them would make one of those two routes wrong whichever way it collapsed.
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: universe, freeAgents, draftState: "post" })
    );
    expect(d.universePool).toHaveLength(universe.length);
    expect(d.freeAgentPool).toHaveLength(freeAgents.length);
    expect(d.players).toHaveLength(roster.length);
  });

  it("degrades to the roster when no universe was built", () => {
    // No players snapshot / no rankings means no universe. Showing an empty
    // market would read as "no free agents available", which is a claim.
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: null, freeAgents: null, draftState: "pre" })
    );
    expect(d.marketPool.map((p) => p.id).sort()).toEqual(roster.map((p) => p.id).sort());
  });
});

describe("bye week survives the derivation", () => {
  it("reaches every pool, so the draft board can read it", () => {
    const d = deriveAppData(
      envelopeWith({ records: roster, leagueUniverse: universe, freeAgents, draftState: "pre" })
    );
    for (const pool of [d.players, d.universePool, d.marketPool]) {
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.every((p) => p.byeWeek === 7)).toBe(true);
    }
  });

  it("is present on the shipped fixture catalog", () => {
    const d = deriveAppData(fixtureEnvelope());
    expect(d.players.every((p) => typeof p.byeWeek === "number")).toBe(true);
  });
});
