import { describe, expect, it } from "vitest";
import { safeOrigin, describeHttpFailure, redactUrls } from "./httpFailure";
import { fetchWithEnvelope } from "./http";
import { z } from "zod";

/**
 * `sourceState.failure` is RENDERED TO THE USER — `GovernancePanel.tsx` prints
 * it verbatim as "Adapter note: …". So it is user-facing copy with the same
 * obligations as any other string on the page: it must not leak a private
 * identifier, and it must say something the reader can act on.
 *
 * It did neither. `HTTP ${status} from ${url}` put the ESPN league id, in the
 * URL path, onto the page and into every screenshot of it — and a 401 is not a
 * bug report, it is "your cookies expired", which is a thing a person can fix in
 * thirty seconds if anybody tells them.
 */
const ESPN_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1546190?view=mSettings";
const LEAGUE_ID = "1546190";

describe("safeOrigin", () => {
  it("keeps the host and drops everything that identifies the request", () => {
    expect(safeOrigin(ESPN_URL)).toBe("lm-api-reads.fantasy.espn.com");
    expect(safeOrigin(ESPN_URL)).not.toContain(LEAGUE_ID);
    expect(safeOrigin(ESPN_URL)).not.toContain("seasons");
  });

  it("does not throw on something that is not a URL", () => {
    expect(safeOrigin("not a url")).toBe("the upstream service");
  });
});

describe("describeHttpFailure names the remedy, not the status", () => {
  it("tells a credentialed 401 to re-paste the cookies", () => {
    const msg = describeHttpFailure(401, ESPN_URL, { credentialed: true });
    expect(msg).toContain("espn_s2");
    expect(msg).toContain("Settings");
    expect(msg).not.toContain(LEAGUE_ID);
  });

  it("does NOT tell an anonymous 401 to re-paste cookies nobody entered", () => {
    // The distinction matters: on an endpoint this app calls without
    // credentials, a 401 is an upstream change, and instructing the user to fix
    // their cookies would send them to a settings page that cannot help.
    const msg = describeHttpFailure(401, "https://api.sleeper.app/v1/state/nfl");
    expect(msg).not.toContain("espn_s2");
    expect(msg).toContain("credentials this app does not hold");
  });

  it("distinguishes 404, 429 and 5xx", () => {
    expect(describeHttpFailure(404, ESPN_URL)).toMatch(/league id or season/i);
    expect(describeHttpFailure(429, ESPN_URL)).toMatch(/rate-limiting/i);
    expect(describeHttpFailure(503, ESPN_URL)).toMatch(/server error/i);
  });

  it("never includes the path, on any status", () => {
    for (const status of [400, 401, 403, 404, 418, 429, 500, 503]) {
      const msg = describeHttpFailure(status, ESPN_URL, { credentialed: true });
      expect(msg, `status ${status} leaked the path`).not.toContain(LEAGUE_ID);
      expect(msg).not.toContain("/apis/v3/");
    }
  });
});

describe("redactUrls", () => {
  it("strips a URL out of a thrown fetch message but keeps the reason", () => {
    // Node's real shape.
    const raw = `request to ${ESPN_URL} failed, reason: connect ETIMEDOUT`;
    const out = redactUrls(raw);
    expect(out).not.toContain(LEAGUE_ID);
    expect(out).toContain("connect ETIMEDOUT");
    expect(out).toContain("lm-api-reads.fantasy.espn.com");
  });

  it("leaves a message with no URL alone", () => {
    expect(redactUrls("The operation was aborted")).toBe("The operation was aborted");
  });
});

describe("fetchWithEnvelope end to end", () => {
  const schema = z.object({ ok: z.boolean() });

  it("puts an actionable message, and no league id, in sourceState.failure", async () => {
    const res = await fetchWithEnvelope({
      url: ESPN_URL,
      schema,
      source: "ESPN league",
      ttlSeconds: 60,
      credentialed: true,
      fetcher: async () => new Response("", { status: 401 })
    });
    expect(res.data).toBeNull();
    expect(res.source.failure).toBeTruthy();
    expect(res.source.failure!).not.toContain(LEAGUE_ID);
    expect(res.source.failure!).toMatch(/espn_s2/);
  });

  it("redacts the URL when the fetch throws", async () => {
    const res = await fetchWithEnvelope({
      url: ESPN_URL,
      schema,
      source: "ESPN league",
      ttlSeconds: 60,
      retries: 1,
      fetcher: async () => {
        throw new Error(`request to ${ESPN_URL} failed, reason: socket hang up`);
      }
    });
    expect(res.source.failure!).not.toContain(LEAGUE_ID);
    expect(res.source.failure!).toContain("socket hang up");
  });

  it("would have failed before the fix", () => {
    // Canary for the whole file: the old format string is reconstructed here so
    // the test proves the hazard was real rather than hypothetical.
    const old = `HTTP 401 from ${ESPN_URL}`;
    expect(old).toContain(LEAGUE_ID);
  });
});
