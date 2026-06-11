import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetDbForTests } from "./index";
import { makeSnapshotStore } from "./snapshotStore";

const PayloadSchema = z.object({ a: z.number(), b: z.string() });
type Payload = z.infer<typeof PayloadSchema>;

function store() {
  return makeSnapshotStore<Payload>({
    table: "players_snapshots",
    tableKey: "playersSnapshots",
    schema: PayloadSchema
  });
}

describe("makeSnapshotStore", () => {
  beforeEach(() => {
    resetDbForTests();
  });

  it("returns null when no snapshot exists for the source", async () => {
    expect(await store().getLatest("src-a")).toBeNull();
  });

  it("insert + getLatest round-trips the validated payload", async () => {
    const s = store();
    const inserted = await s.insert("src-a", { a: 1, b: "x" });
    expect(inserted.sizeBytes).toBeGreaterThan(0);
    expect(inserted.payload).toEqual({ a: 1, b: "x" });

    const read = await s.getLatest("src-a");
    expect(read).not.toBeNull();
    expect(read!.payload).toEqual({ a: 1, b: "x" });
    expect(read!.id).toBe(inserted.id);
  });

  it("getLatest returns the freshest row for the source", async () => {
    const s = store();
    await s.insert("src-a", { a: 1, b: "old" });
    await new Promise((r) => setTimeout(r, 30));
    const newer = await s.insert("src-a", { a: 2, b: "new" });
    const read = await s.getLatest("src-a");
    expect(read!.id).toBe(newer.id);
    expect(read!.payload.b).toBe("new");
  });

  it("isolates rows by source key", async () => {
    const s = store();
    await s.insert("src-a", { a: 1, b: "a" });
    await s.insert("src-b", { a: 2, b: "b" });
    expect((await s.getLatest("src-a"))!.payload.b).toBe("a");
    expect((await s.getLatest("src-b"))!.payload.b).toBe("b");
  });

  it("pruneOlderThan deletes eligible rows and returns the count", async () => {
    const s = store();
    await s.insert("src-a", { a: 1, b: "x" });
    await s.insert("src-a", { a: 2, b: "y" });
    // Sleep so the prune cutoff (Date.now()) is strictly AFTER both rows'
    // fetchedAt — otherwise a same-millisecond insert+prune on a fast runner
    // leaves the newest row (fetchedAt == cutoff, not < cutoff) un-pruned.
    await new Promise((r) => setTimeout(r, 12));
    const pruned = await s.pruneOlderThan("src-a", 0); // keep nothing → both eligible
    expect(pruned).toBeGreaterThanOrEqual(2);
    expect(await s.getLatest("src-a")).toBeNull();
  });

  it("validates the payload on insert (throws on schema violation)", async () => {
    const s = store();
    // @ts-expect-error — deliberately wrong shape to exercise runtime validation
    await expect(s.insert("src-a", { a: "not-a-number", b: "x" })).rejects.toThrow();
  });

  // Every snapshot table must round-trip against the in-memory test schema —
  // exercising only playersSnapshots is how the missing opportunity_snapshots
  // table went unnoticed (its reads are .catch(() => null)'d in envelope/load).
  it("insert + getLatest round-trips on every snapshot tableKey", async () => {
    const pairs = [
      ["players_snapshots", "playersSnapshots"],
      ["rankings_snapshots", "rankingsSnapshots"],
      ["ktc_snapshots", "ktcSnapshots"],
      ["projections_snapshots", "projectionsSnapshots"],
      ["news_snapshots", "newsSnapshots"],
      ["opportunity_snapshots", "opportunitySnapshots"]
    ] as const;
    for (const [table, tableKey] of pairs) {
      const s = makeSnapshotStore<Payload>({ table, tableKey, schema: PayloadSchema });
      await s.insert("src-a", { a: 1, b: table });
      const read = await s.getLatest("src-a");
      expect(read?.payload.b, `round-trip failed for ${table}`).toBe(table);
    }
  });

  it("returns null (does not throw) when a stored payload fails validation — but logs it", async () => {
    // Insert a row whose payload does not match PayloadSchema using a store with
    // a permissive schema, then read it back through the strict store. The null
    // keeps the UI honest ("unavailable"); the log keeps the OPERATOR honest —
    // "rows exist but fail validation" must not read identically to "no data"
    // (tightening a snapshot Zod schema would otherwise silently blank a panel).
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const permissive = makeSnapshotStore<unknown>({
        table: "players_snapshots",
        tableKey: "playersSnapshots",
        schema: z.unknown()
      });
      await permissive.insert("src-a", { totally: "different" });
      expect(await store().getLatest("src-a")).toBeNull();
      expect(errSpy).toHaveBeenCalledOnce();
      expect(String(errSpy.mock.calls[0]![0])).toContain("players_snapshots");
      expect(String(errSpy.mock.calls[0]![0])).toContain("failed payload validation");
    } finally {
      errSpy.mockRestore();
    }
  });
});
