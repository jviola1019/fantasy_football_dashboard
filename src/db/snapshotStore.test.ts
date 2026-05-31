import { beforeEach, describe, expect, it } from "vitest";
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
    await new Promise((r) => setTimeout(r, 5));
    await s.insert("src-a", { a: 2, b: "y" });
    const pruned = await s.pruneOlderThan("src-a", 0); // keep nothing → both eligible
    expect(pruned).toBeGreaterThanOrEqual(2);
    expect(await s.getLatest("src-a")).toBeNull();
  });

  it("validates the payload on insert (throws on schema violation)", async () => {
    const s = store();
    // @ts-expect-error — deliberately wrong shape to exercise runtime validation
    await expect(s.insert("src-a", { a: "not-a-number", b: "x" })).rejects.toThrow();
  });

  it("returns null (does not throw) when a stored payload fails validation", async () => {
    // Insert a row whose payload does not match PayloadSchema using a store with
    // a permissive schema, then read it back through the strict store.
    const permissive = makeSnapshotStore<unknown>({
      table: "players_snapshots",
      tableKey: "playersSnapshots",
      schema: z.unknown()
    });
    await permissive.insert("src-a", { totally: "different" });
    expect(await store().getLatest("src-a")).toBeNull();
  });
});
