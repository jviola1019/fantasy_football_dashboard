import { describe, expect, it } from "vitest";
import { systems } from "@/components/RaeApp";
import { fixturePlayers } from "./fixtures";
import { RAEEnvelopeSchema } from "./governance";
import { fixtureEnvelope } from "./fixtures";

describe("RAE visual/product contract", () => {
  it("locks the product to exactly five top-level systems", () => {
    expect(systems).toEqual(["Command Center", "Market Intelligence", "Player Universe", "Narrative Engine", "Nexus Simulator"]);
    expect(systems).toHaveLength(5);
  });

  it("keeps roster and player imagery as validated remote metadata, not committed binary assets", () => {
    expect(fixturePlayers).toHaveLength(8);
    for (const player of fixturePlayers) {
      expect(player.rosterSlot).toBeTruthy();
      expect(player.status).toMatch(/active|questionable|out|ir|bye|unknown/);
      expect(player.imageUrl).toMatch(/^https?:\/\/a\.espncdn\.com\/i\/headshots\/nfl\/players\/full\/\d+\.png$/);
      expect(player.imageSource).toContain("ESPN headshot CDN");
    }
  });

  it("validates the upgraded fixture envelope with roster and image fields", () => {
    const parsed = RAEEnvelopeSchema.parse(fixtureEnvelope());
    expect(parsed.records[0]?.imageUrl).toContain("espncdn.com");
    expect(parsed.records[0]?.rosterSlot).toBe("WR1");
  });
});
