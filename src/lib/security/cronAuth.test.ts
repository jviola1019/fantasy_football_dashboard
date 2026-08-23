import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { requireCronAuth } from "./cronAuth";

/**
 * The cron gate: one implementation, and a structural guarantee that every cron
 * route uses it.
 *
 * Audit 2026-08-22, P3. The gate was COPY-PASTED into all seven cron routes and
 * covered by a single parameterised test. Seven copies of a security check is
 * seven chances for one to drift, and a parameterised test over a hard-coded
 * list of routes cannot notice the eighth route somebody adds without one.
 *
 * So there are two kinds of test here: behavioural ones for the gate itself,
 * and a FILE SCAN that fails if any route under src/app/api/cron does not call
 * it. The second is the one that survives new code being written.
 */
const req = (headers: Record<string, string> = {}): Request =>
  new Request("https://example.test/api/cron/whatever", { headers });

describe("requireCronAuth", () => {
  const saved = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "the-real-secret";
  });

  // Restored at suite teardown so a thrown assertion cannot leave a test secret
  // in the environment for the files that run after this one.
  afterAll(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("allows a correct Bearer token", () => {
    expect(requireCronAuth(req({ authorization: "Bearer the-real-secret" }))).toBeNull();
  });

  it("rejects a missing Authorization header with 403", async () => {
    const denied = requireCronAuth(req());
    expect(denied?.status).toBe(403);
    expect(await denied!.json()).toEqual({ error: "forbidden" });
  });

  it("rejects a wrong token", () => {
    expect(requireCronAuth(req({ authorization: "Bearer wrong" }))?.status).toBe(403);
  });

  it("rejects the right secret without the Bearer prefix", () => {
    // The comparison is against the WHOLE header value, not a parsed token.
    expect(requireCronAuth(req({ authorization: "the-real-secret" }))?.status).toBe(403);
  });

  it("rejects a token that merely starts with the secret", () => {
    expect(requireCronAuth(req({ authorization: "Bearer the-real-secret-extra" }))?.status).toBe(403);
  });

  it("rejects a prefix of the correct token", () => {
    // Unequal lengths must be refused, not throw: timingSafeEqual throws on
    // buffers of different length, and this input is attacker-controlled.
    expect(() => requireCronAuth(req({ authorization: "Bearer the-real" }))).not.toThrow();
    expect(requireCronAuth(req({ authorization: "Bearer the-real" }))?.status).toBe(403);
  });

  it("refuses the work with 503 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const denied = requireCronAuth(req({ authorization: "Bearer anything" }));
    expect(denied?.status).toBe(503);
    // Not 403: an unconfigured deployment has a different problem from an
    // unauthorized caller, and the operator needs to be able to tell them apart.
    expect(await denied!.json()).toEqual({ error: "CRON_SECRET is not set" });
  });

  it("does not fall back to allowing when CRON_SECRET is an empty string", () => {
    process.env.CRON_SECRET = "";
    expect(requireCronAuth(req({ authorization: "Bearer " }))?.status).toBe(503);
  });
});

describe("every cron route is behind the shared gate", () => {
  const cronDir = fileURLToPath(new URL("../../app/api/cron", import.meta.url));

  const routeFiles = readdirSync(cronDir)
    .map((entry) => join(cronDir, entry))
    .filter((p) => statSync(p).isDirectory())
    .map((dir) => join(dir, "route.ts"));

  it("finds the cron routes at all (so an empty scan cannot pass vacuously)", () => {
    // Without this, a wrong path would make every assertion below trivially
    // true -- the failure mode this whole audit is named after.
    expect(routeFiles.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of routeFiles) {
    const name = file.split(/[\/]/).slice(-2)[0];

    it(`${name} calls requireCronAuth`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("requireCronAuth(request)");
    });

    it(`${name} does not hand-roll the comparison`, () => {
      // A route that reads CRON_SECRET itself has forked the gate, whatever it
      // does with it afterwards.
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/process\.env\.CRON_SECRET/);
    });
  }
});
