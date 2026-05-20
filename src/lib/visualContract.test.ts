import { describe, expect, it } from "vitest";
import { systems } from "@/components/RaeApp";
import { fixturePlayers } from "./fixtures";
import { RAEEnvelopeSchema } from "./governance";
import { fixtureEnvelope } from "./fixtures";

describe("RAE visual/product contract", () => {
  it("locks the product to exactly nine top-level systems (six core + lifecycle trio)", () => {
    expect(systems).toEqual([
      "Command Center",
      "Market Intelligence",
      "Player Universe",
      "Narrative Engine",
      "Nexus Simulator",
      "Draft Intelligence",
      "Pre-Draft",
      "Waiver Wire",
      "Trade Center"
    ]);
    expect(systems).toHaveLength(9);
  });

  it("keeps roster and player imagery as validated remote metadata, not committed binary assets", () => {
    expect(fixturePlayers).toHaveLength(8);
    for (const player of fixturePlayers) {
      expect(player.rosterSlot).toBeTruthy();
      expect(player.status).toMatch(/active|questionable|out|ir|bye|unknown/);
      // Primary fixture headshots now route through Sleeper's CDN keyed by
      // canonical Sleeper player_id; ESPN CDN is a fallback chain consumer.
      expect(player.imageUrl).toMatch(/^https:\/\/sleepercdn\.com\/content\/nfl\/players\/thumb\/\d+\.jpg$/);
      expect(player.imageSource).toContain("Sleeper headshot CDN");
    }
  });

  it("validates the upgraded fixture envelope with roster and image fields", () => {
    const parsed = RAEEnvelopeSchema.parse(fixtureEnvelope());
    expect(parsed.records[0]?.imageUrl).toContain("sleepercdn.com");
    expect(parsed.records[0]?.rosterSlot).toBe("WR1");
  });

  it("Puka Nacua's headshot routes to the canonical Sleeper id (regression: previously rendered Justin Fields' ESPN id)", () => {
    const puka = fixturePlayers.find((p) => p.id === "puka-nacua");
    expect(puka).toBeDefined();
    // Sleeper id 9493 = Puka Nacua, verified 2026-05-19. ESPN id 4362887 was
    // the previous (wrong) value; it must never appear here.
    expect(puka!.imageUrl).toContain("/9493.jpg");
    expect(puka!.imageUrl).not.toContain("4362887");
  });
});
