import { afterEach, describe, expect, it, vi } from "vitest";
import { infraNull, resetInfraLogForTests } from "./infraNull";

describe("infraNull", () => {
  afterEach(() => {
    resetInfraLogForTests();
    vi.restoreAllMocks();
  });

  it("returns null so the UI keeps its honest-unavailable rendering", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await Promise.reject(new Error("no such table: opportunity_snapshots")).catch(infraNull("opportunity"));
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain("opportunity");
  });

  it("logs only once per key per process (request-cached hot path must not spam)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = infraNull("players");
    await Promise.reject(new Error("boom")).catch(handler);
    await Promise.reject(new Error("boom")).catch(handler);
    await Promise.reject(new Error("boom")).catch(infraNull("players"));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("logs separately for distinct keys", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await Promise.reject(new Error("a")).catch(infraNull("rankings"));
    await Promise.reject(new Error("b")).catch(infraNull("news"));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
