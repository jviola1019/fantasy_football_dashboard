import { describe, expect, it } from "vitest";
import { deploymentHosts, resolveLoginOrigin } from "./loginRedirect";

/**
 * The login redirect had to be rebuilt because `request.nextUrl` is rewritten
 * from AUTH_URL by next-auth, which sent preview visitors to PRODUCTION's login
 * page and made sign-in unreachable on every preview deployment.
 *
 * The first attempt at rebuilding it trusted `x-forwarded-host` outright and was
 * MEASURED to be an open redirect: `evil.com:99999` produced
 * `Location: http://evil.com/login`. So the hostile cases below are not
 * hypothetical — they are the bug this module was written the second time to
 * avoid.
 */
const allow = (...hosts: string[]) => new Set(hosts);

describe("the allowlist comes from the operator, not the request", () => {
  it("collects every Vercel-provided host", () => {
    const hosts = deploymentHosts({
      VERCEL_URL: "app-abc123.vercel.app",
      VERCEL_BRANCH_URL: "app-git-branch-team.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "rae.example.com"
    });
    expect([...hosts].sort()).toEqual([
      "app-abc123.vercel.app",
      "app-git-branch-team.vercel.app",
      "rae.example.com"
    ]);
  });

  it("is empty off Vercel, which is what keeps local and CI behaviour unchanged", () => {
    expect(deploymentHosts({}).size).toBe(0);
    expect(deploymentHosts({ VERCEL_URL: "" }).size).toBe(0);
  });

  it("normalises case, whitespace, a scheme and a trailing path", () => {
    // Vercel supplies a bare host today. Stripping anyway costs nothing and
    // beats silently never matching if that ever changes.
    const hosts = deploymentHosts({ VERCEL_URL: "  HTTPS://App-ABC.vercel.app/  " });
    expect([...hosts]).toEqual(["app-abc.vercel.app"]);
  });
});

describe("an allowed host is honoured", () => {
  it("returns it, defaulting to https because Vercel terminates TLS", () => {
    expect(
      resolveLoginOrigin({
        headerHost: "app-abc123.vercel.app",
        forwardedProto: null,
        allowed: allow("app-abc123.vercel.app")
      })
    ).toEqual({ host: "app-abc123.vercel.app", protocol: "https:" });
  });

  it("matches case-insensitively, since Host case is not significant", () => {
    expect(
      resolveLoginOrigin({
        headerHost: "App-ABC123.Vercel.App",
        forwardedProto: "https",
        allowed: allow("app-abc123.vercel.app")
      })?.host
    ).toBe("app-abc123.vercel.app");
  });

  it("downgrades to http only on an explicit claim, and only for an allowed host", () => {
    expect(
      resolveLoginOrigin({
        headerHost: "localhost:3000",
        forwardedProto: "http",
        allowed: allow("localhost:3000")
      })?.protocol
    ).toBe("http:");
  });

  it("takes the first proto when a chain of proxies appended to the header", () => {
    expect(
      resolveLoginOrigin({
        headerHost: "app.vercel.app",
        forwardedProto: "https, http",
        allowed: allow("app.vercel.app")
      })?.protocol
    ).toBe("https:");
  });
});

describe("anything not on the allowlist is ignored, not sanitised", () => {
  it("refuses the exact payload that made the first attempt an open redirect", () => {
    expect(
      resolveLoginOrigin({
        headerHost: "evil.com:99999",
        forwardedProto: null,
        allowed: allow("app-abc123.vercel.app")
      })
    ).toBeNull();
  });

  it("refuses a well-formed hostile host — a regex could never have caught this", () => {
    expect(
      resolveLoginOrigin({ headerHost: "evil.com", forwardedProto: null, allowed: allow("good.com") })
    ).toBeNull();
  });

  it("refuses a comma-joined header instead of picking an entry", () => {
    // Which entry is authoritative depends on hop count. Guessing is how the
    // allowlist gets bypassed by appending an allowed host to a hostile one.
    expect(
      resolveLoginOrigin({
        headerHost: "evil.com,good.com",
        forwardedProto: null,
        allowed: allow("good.com", "evil.com,good.com")
      })
    ).toBeNull();
  });

  it("refuses userinfo, embedded paths and a scheme", () => {
    for (const host of ["user@good.com", "good.com/../x", "https://good.com", "good.com\@evil.com"]) {
      expect(
        resolveLoginOrigin({ headerHost: host, forwardedProto: null, allowed: allow("good.com") })
      ).toBeNull();
    }
  });

  it("returns null for a missing or blank header rather than inventing a host", () => {
    expect(resolveLoginOrigin({ headerHost: null, forwardedProto: null, allowed: allow("a.com") })).toBeNull();
    expect(resolveLoginOrigin({ headerHost: "  ", forwardedProto: null, allowed: allow("a.com") })).toBeNull();
  });

  it("returns null when the allowlist is empty, whatever the header says", () => {
    // Off Vercel this is every request, and it is why local dev, CI and
    // Playwright are untouched by this change.
    expect(
      resolveLoginOrigin({ headerHost: "anything.example", forwardedProto: "https", allowed: allow() })
    ).toBeNull();
  });
});
