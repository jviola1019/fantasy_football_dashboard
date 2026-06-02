import { describe, expect, it } from "vitest";
import { detectSleeperDraftState, detectEspnDraftState, anyRosterNonEmpty } from "./draftState";
import type { PlayerMarketRecord } from "../governance";

const P = (id: string): PlayerMarketRecord => ({ id } as PlayerMarketRecord);

describe("detectSleeperDraftState", () => {
  it("maps league.status authoritatively", () => {
    expect(detectSleeperDraftState("pre_draft", null, false)).toBe("pre");
    expect(detectSleeperDraftState("drafting", null, false)).toBe("pre");
    expect(detectSleeperDraftState("in_season", null, true)).toBe("post");
    expect(detectSleeperDraftState("complete", null, true)).toBe("post");
  });

  it("falls back to the draft object's status when league status is absent", () => {
    expect(detectSleeperDraftState(null, "complete", false)).toBe("post");
    expect(detectSleeperDraftState(null, "pre_draft", false)).toBe("pre");
    expect(detectSleeperDraftState("", "drafting", true)).toBe("pre");
  });

  it("infers from roster fill when no status is usable", () => {
    expect(detectSleeperDraftState(null, null, false)).toBe("pre"); // empty ⇒ undrafted
    expect(detectSleeperDraftState(null, null, true)).toBe("post");
  });

  it("is case-insensitive", () => {
    expect(detectSleeperDraftState("COMPLETE", null, true)).toBe("post");
    expect(detectSleeperDraftState("Pre_Draft", null, false)).toBe("pre");
  });
});

describe("detectEspnDraftState", () => {
  it("returns unknown with no teams", () => {
    expect(detectEspnDraftState([], 16)).toBe("unknown");
  });

  it("treats mostly-empty rosters as pre-draft", () => {
    const rosters = [[], [], [P("a")]]; // median 0
    expect(detectEspnDraftState(rosters, 16)).toBe("pre");
  });

  it("treats filled rosters as post-draft", () => {
    const full = Array.from({ length: 12 }, () => Array.from({ length: 16 }, (_, i) => P(`p${i}`)));
    expect(detectEspnDraftState(full, 16)).toBe("post");
  });

  it("uses roster presence when expected size is unknown", () => {
    expect(detectEspnDraftState([[P("a")], [P("b")]], 0)).toBe("post");
    expect(detectEspnDraftState([[], []], 0)).toBe("pre");
  });
});

describe("anyRosterNonEmpty", () => {
  it("is true iff any roster has a player", () => {
    expect(anyRosterNonEmpty([[], []])).toBe(false);
    expect(anyRosterNonEmpty([[], [P("a")]])).toBe(true);
  });
});
