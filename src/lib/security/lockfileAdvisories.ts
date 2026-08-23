// Fails the build when package-lock.json resolves a package version that a known
// security advisory covers. Pure, stdlib-only, and unit-tested; the CLI lives in
// scripts/check-lockfile-advisories.ts.
//
// Why this exists (audit 2026-08-06 F-001/F-006): `dependency-review` only runs on
// pull requests and only sees the PR *diff*, so a lockfile that was clean when it
// merged silently becomes vulnerable the moment a new advisory is published against
// an already-resolved version. That is exactly what happened here — a PR passed on
// 2026-07-09 and nine Next.js advisories landed on 2026-07-22 against the very
// version it had just locked in. This guard pins the *floor* so the regression
// cannot recur unnoticed, independent of any GitHub-side feature being enabled.

/** A package's minimum non-vulnerable version, with the advisories that set it. */
export interface AdvisoryFloor {
  /** Lowest version that is NOT covered by the listed advisories. */
  minVersion: string;
  /** GHSA identifiers that this floor remediates. */
  advisories: readonly string[];
  /** Why the floor sits here, for the next reader. */
  note: string;
}

/**
 * Floors are deliberately hand-maintained rather than fetched at test time: the
 * guard has to work offline and in CI without network or GitHub token access, and
 * a floor that silently moves is not a regression test. Raise a floor only with the
 * advisory IDs that justify it.
 */
export const ADVISORY_FLOORS: Readonly<Record<string, AdvisoryFloor>> = {
  next: {
    minVersion: "16.2.11",
    advisories: [
      "GHSA-m99w-x7hq-7vfj", // DoS in App Router using Server Actions (high)
      "GHSA-6gpp-xcg3-4w24", // Middleware/Proxy bypass, Turbopack + single locale (high)
      "GHSA-89xv-2m56-2m9x", // SSRF in Server Actions on custom servers (high)
      "GHSA-p9j2-gv94-2wf4", // SSRF in rewrites via attacker-controlled host (high)
      "GHSA-955p-x3mx-jcvp", // Unauthenticated disclosure of Server Function endpoints
      "GHSA-4633-3j49-mh5q", // Cache confusion, invalid UTF-8 request bodies
      "GHSA-68g3-v927-f742", // Cache confusion of response bodies
      "GHSA-4c39-4ccg-62r3", // Unbounded Server Action payload (Edge)
      "GHSA-q8wf-6r8g-63ch" // DoS in Image Optimization via SVG
    ],
    note:
      "All nine were published 2026-07-22 against >=16.0.0 <16.2.11. We ship >=16.3.0 " +
      "because only 16.3.x pins a patched sharp (^0.35.3) and bundles a patched " +
      "postcss (8.5.23); 16.2.12 still carries the vulnerable versions of both."
  },
  "next-auth": {
    minVersion: "5.0.0-beta.32",
    advisories: [
      "GHSA-8fpg-xm3f-6cx3", // config errors can make existence-based auth checks FAIL OPEN (critical)
      "GHSA-7rqj-j65f-68wh", // homoglyph '@' bypass in email normalizer (critical)
      "GHSA-xmf8-cvqr-rfgj", // getToken() throws on malformed Bearer header (high)
      "GHSA-x445-f3h2-j279" // OAuth state/nonce/PKCE cookies not bound to provider
    ],
    note:
      "The fail-open advisory lands directly on this app's authorization path, where " +
      "an errored auth object is truthy. Do not relax this floor."
  },
  "@auth/core": {
    minVersion: "0.41.3",
    advisories: ["GHSA-7rqj-j65f-68wh", "GHSA-xmf8-cvqr-rfgj", "GHSA-x445-f3h2-j279"],
    note: "Transitive via next-auth and @auth/drizzle-adapter; both pin 0.41.3."
  },
  postcss: {
    minVersion: "8.5.23",
    advisories: [
      "GHSA-r28c-9q8g-f849", // path traversal via sourceMappingURL auto-loading (high)
      "GHSA-6g55-p6wh-862q", // arbitrary file read via sourceMappingURL (high)
      "GHSA-fxqj-rqcc-2cmp", // incomplete fix of the above
      "GHSA-qx2v-qp2m-jg93" // XSS via unescaped </style> in stringify output
    ],
    note: "Applies to the root install AND to the copy nested under next/."
  },
  sharp: {
    minVersion: "0.35.0",
    advisories: ["GHSA-f88m-g3jw-g9cj"],
    note: "Inherited libvips CVEs (2026-33327/33328/35590/35591). Reached via next's optionalDependencies."
  }
};

/** One resolved lockfile entry that violates a floor. */
export interface LockfileViolation {
  path: string;
  name: string;
  version: string;
  minVersion: string;
  advisories: readonly string[];
}

/** Minimal shape of the parts of package-lock.json (v3) we read. */
export interface LockfileShape {
  packages?: Record<string, { version?: string } | undefined>;
}

/**
 * Compares semver-ish versions including prerelease tags, which matters because
 * next-auth ships as `5.0.0-beta.NN` and a naive string compare puts beta.31
 * after beta.4. Returns <0, 0, or >0.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore = "", aPre = ""] = a.split("-", 2);
  const [bCore = "", bPre = ""] = b.split("-", 2);

  const aParts = aCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bParts = bCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // Per semver, a version WITH a prerelease is lower than the same core without one.
  if (aPre === "" && bPre === "") return 0;
  if (aPre === "") return 1;
  if (bPre === "") return -1;

  const aIds = aPre.split(".");
  const bIds = bPre.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i += 1) {
    const x = aIds[i];
    const y = bIds[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** The package name for a lockfile key like `node_modules/next/node_modules/postcss`. */
export function packageNameFromLockPath(path: string): string | null {
  const marker = "node_modules/";
  const idx = path.lastIndexOf(marker);
  if (idx === -1) return null;
  const name = path.slice(idx + marker.length);
  return name.length > 0 ? name : null;
}

/**
 * Every resolved entry that sits below its advisory floor. Checks *all* nested
 * copies, not just the top-level one — the vulnerable postcss in the pre-fix tree
 * was `node_modules/next/node_modules/postcss`, which a top-level-only check misses.
 */
export function findLockfileViolations(
  lock: LockfileShape,
  floors: Readonly<Record<string, AdvisoryFloor>> = ADVISORY_FLOORS
): LockfileViolation[] {
  const violations: LockfileViolation[] = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const version = entry?.version;
    if (!version) continue;
    const name = packageNameFromLockPath(path);
    if (!name) continue;
    const floor = floors[name];
    if (!floor) continue;
    if (compareVersions(version, floor.minVersion) < 0) {
      violations.push({
        path,
        name,
        version,
        minVersion: floor.minVersion,
        advisories: floor.advisories
      });
    }
  }
  return violations;
}
