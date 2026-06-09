import { describe, it, expect } from "vitest";
import { evaluateRoute, evaluateAll, SMOKE_ROUTES, type RouteSpec } from "./smokeRoutes";

const ok: RouteSpec = { path: "/dashboard", expect: { kind: "ok" } };
const redir: RouteSpec = { path: "/settings/leagues", expect: { kind: "redirect", toContains: "/login" } };
const health: RouteSpec = { path: "/api/health", expect: { kind: "health" } };

describe("evaluateRoute", () => {
  it("passes a 2xx for an ok route and fails a 5xx", () => {
    expect(evaluateRoute(ok, { status: 200 }).ok).toBe(true);
    expect(evaluateRoute(ok, { status: 500 }).ok).toBe(false);
  });

  it("passes a 3xx redirect to the expected target and fails a 200", () => {
    expect(evaluateRoute(redir, { status: 307, location: "/login" }).ok).toBe(true);
    expect(evaluateRoute(redir, { status: 200 }).ok).toBe(false);
    expect(evaluateRoute(redir, { status: 307, location: "/elsewhere" }).ok).toBe(false);
  });

  it("passes health only on 200 + {status:'ok'}", () => {
    expect(evaluateRoute(health, { status: 200, body: '{"status":"ok"}' }).ok).toBe(true);
    expect(evaluateRoute(health, { status: 200, body: '{"status":"degraded"}' }).ok).toBe(false);
    expect(evaluateRoute(health, { status: 503, body: '{"status":"ok"}' }).ok).toBe(false);
    expect(evaluateRoute(health, { status: 200, body: "not json" }).ok).toBe(false);
  });

  it("fails closed on a missing observation (status 0)", () => {
    expect(evaluateRoute(ok, { status: 0 }).ok).toBe(false);
  });
});

describe("evaluateAll", () => {
  it("passes every route when all observations meet expectations", () => {
    const observations: Record<string, { status: number; location?: string; body?: string }> = {};
    for (const spec of SMOKE_ROUTES) {
      if (spec.expect.kind === "ok") observations[spec.path] = { status: 200 };
      else if (spec.expect.kind === "redirect") observations[spec.path] = { status: 307, location: spec.expect.toContains };
      else observations[spec.path] = { status: 200, body: '{"status":"ok"}' };
    }
    const results = evaluateAll(observations);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results).toHaveLength(SMOKE_ROUTES.length);
  });
});
