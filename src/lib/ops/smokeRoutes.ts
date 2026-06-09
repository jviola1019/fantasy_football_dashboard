// Route expectations for the production smoke test. Pure + unit-tested; the CLI
// that actually performs the HTTP probes lives in scripts/smoke-vercel.ts.

export type Expectation =
  | { kind: "ok" } // expect a 2xx
  | { kind: "redirect"; toContains: string } // expect a 3xx whose Location contains a substring
  | { kind: "health" }; // expect 200 + JSON { status: "ok" }

export interface RouteSpec {
  path: string;
  expect: Expectation;
}

/**
 * The public surface a healthy deployment must serve. The `(app)` routes are
 * publicly reachable with labeled demo data; the `settings/*` routes are
 * auth-gated and must redirect anonymous callers to /login.
 */
export const SMOKE_ROUTES: RouteSpec[] = [
  { path: "/", expect: { kind: "ok" } },
  { path: "/login", expect: { kind: "ok" } },
  { path: "/dashboard", expect: { kind: "ok" } },
  { path: "/players", expect: { kind: "ok" } },
  { path: "/analytics", expect: { kind: "ok" } },
  { path: "/draft", expect: { kind: "ok" } },
  { path: "/waivers", expect: { kind: "ok" } },
  { path: "/trades", expect: { kind: "ok" } },
  { path: "/reports", expect: { kind: "ok" } },
  { path: "/mock-draft", expect: { kind: "ok" } },
  { path: "/settings/leagues", expect: { kind: "redirect", toContains: "/login" } },
  { path: "/settings/account", expect: { kind: "redirect", toContains: "/login" } },
  { path: "/api/health", expect: { kind: "health" } },
];

export interface Observed {
  status: number;
  location?: string | null;
  body?: string | null;
}

export interface RouteResult {
  path: string;
  ok: boolean;
  detail: string;
}

export function evaluateRoute(spec: RouteSpec, obs: Observed): RouteResult {
  const e = spec.expect;
  if (e.kind === "ok") {
    const ok = obs.status >= 200 && obs.status < 300;
    return { path: spec.path, ok, detail: ok ? `${obs.status}` : `expected 2xx, got ${obs.status}` };
  }
  if (e.kind === "redirect") {
    const is3xx = obs.status >= 300 && obs.status < 400;
    const loc = obs.location ?? "";
    const ok = is3xx && loc.includes(e.toContains);
    return {
      path: spec.path,
      ok,
      detail: ok
        ? `${obs.status} → ${loc}`
        : `expected 3xx → *${e.toContains}*, got ${obs.status} → ${loc || "(no Location)"}`,
    };
  }
  // health
  let bodyOk = false;
  try {
    bodyOk = !!obs.body && JSON.parse(obs.body).status === "ok";
  } catch {
    bodyOk = false;
  }
  const ok = obs.status === 200 && bodyOk;
  return {
    path: spec.path,
    ok,
    detail: ok ? `200 status:ok` : `expected 200 + {status:"ok"}, got ${obs.status} body=${(obs.body ?? "").slice(0, 40)}`,
  };
}

export function evaluateAll(observations: Record<string, Observed>): RouteResult[] {
  return SMOKE_ROUTES.map((spec) =>
    evaluateRoute(spec, observations[spec.path] ?? { status: 0 })
  );
}
