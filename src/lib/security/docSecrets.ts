// Detects high-entropy literals that sit on the same line as a secret keyword.
// Pure, dependency-free, and unit-tested; the CLI lives in scripts/check-doc-secrets.ts.

const SECRET_KEYWORDS =
  /(AUTH_SECRET|CREDENTIAL_ENCRYPTION_KEY|DB_INIT_TOKEN|x-init-token|CRON_SECRET|[A-Z][A-Z0-9_]*SECRET|[A-Z][A-Z0-9_]*TOKEN|[A-Z][A-Z0-9_]*API_KEY|PASSWORD|PRIVATE_KEY)/;

// base64 of >=24 chars (32 raw bytes => 43-44 chars) OR hex of >=32 chars
const TOKEN_RE = /[A-Za-z0-9+/]{24,}={0,2}|[a-fA-F0-9]{32,}/g;

const ALLOW_SUBSTRINGS = [
  "your-",
  "example",
  "placeholder",
  "xxxx",
  "<",
  "randombytes",
  "ci-auth-secret",
  "do-not-use",
  "generate",
  "openssl",
];

export interface Leak {
  line: number;
  keyword: string;
  token: string; // redacted preview, never the full secret
}

// A real 24+ char random secret draws on ~20-30 distinct characters. Synthetic
// test dummies are low-entropy: a single repeated char (`AAAA…`) or a short
// repeating block (`CQkJCQkJ…`, base64 of repeated 0x09 bytes) use very few.
function isLowEntropy(token: string): boolean {
  const core = token.replace(/=+$/, "");
  return new Set(core).size <= 6;
}

function isAllowed(token: string, lineLower: string): boolean {
  if (ALLOW_SUBSTRINGS.some((a) => lineLower.includes(a))) return true;
  if (isLowEntropy(token)) return true;
  return false;
}

export function findSecretLeaks(text: string): Leak[] {
  const leaks: Leak[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const kw = raw.match(SECRET_KEYWORDS);
    if (!kw) return;
    const lower = raw.toLowerCase();
    const tokens = raw.match(TOKEN_RE) ?? [];
    for (const t of tokens) {
      if (t.length < 24) continue;
      if (isAllowed(t, lower)) continue;
      leaks.push({
        line: i + 1,
        keyword: kw[0],
        token: `${t.slice(0, 6)}…(${t.length} chars)`,
      });
    }
  });
  return leaks;
}

/**
 * Which tracked files the secret guard scans: shippable docs/config/env where a
 * real production secret could leak (`*.md`, `*.json`, `*.env*`). Internal
 * planning/spec artifacts under `docs/superpowers/` are excluded — they
 * legitimately contain illustrative secret-detection examples and are not a
 * deploy/runtime surface.
 */
export function isScannableDocPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("docs/superpowers/")) return false;
  return /\.(md|json)$/i.test(p) || /(^|\/)\.env/i.test(p);
}

export function scanFiles(
  paths: string[],
  read: (p: string) => string
): Record<string, Leak[]> {
  const result: Record<string, Leak[]> = {};
  for (const p of paths) {
    const leaks = findSecretLeaks(read(p));
    if (leaks.length) result[p] = leaks;
  }
  return result;
}
