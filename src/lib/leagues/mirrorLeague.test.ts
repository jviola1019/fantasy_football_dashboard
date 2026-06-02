import { describe, expect, it } from "vitest";
import { resolveSleeperSeasonMirror, resolveEspnSeasonMirror } from "./mirrorLeague";

describe("resolveSleeperSeasonMirror", () => {
  it("Case A — completed league derives the next season as upcoming", () => {
    expect(resolveSleeperSeasonMirror("complete", "2025", "prev-123", "2026")).toEqual({
      completed: "2025",
      upcoming: "2026"
    });
  });

  it("Case B — pre-draft league WITH a predecessor reports the prior season as completed", () => {
    expect(resolveSleeperSeasonMirror("pre_draft", "2026", "prev-123", "2026")).toEqual({
      completed: "2025",
      upcoming: "2026"
    });
  });

  it("Case C — brand-new pre-draft league with NO history has no completed season", () => {
    expect(resolveSleeperSeasonMirror("pre_draft", "2026", null, "2026")).toEqual({
      completed: null,
      upcoming: "2026"
    });
  });

  it("in_season leagues report no completed history", () => {
    expect(resolveSleeperSeasonMirror("in_season", "2026", "prev", "2026")).toEqual({
      completed: null,
      upcoming: "2026"
    });
  });

  it("falls back to currentSeason when the league season is missing", () => {
    expect(resolveSleeperSeasonMirror("drafting", null, null, "2026")).toEqual({
      completed: null,
      upcoming: "2026"
    });
  });
});

describe("resolveEspnSeasonMirror", () => {
  it("post-draft league mirrors into the next season", () => {
    expect(resolveEspnSeasonMirror(2025, "post")).toEqual({ completed: "2025", upcoming: "2026" });
  });

  it("pre-draft league has no completed history", () => {
    expect(resolveEspnSeasonMirror(2026, "pre")).toEqual({ completed: null, upcoming: "2026" });
    expect(resolveEspnSeasonMirror(2026, "unknown")).toEqual({ completed: null, upcoming: "2026" });
  });
});
