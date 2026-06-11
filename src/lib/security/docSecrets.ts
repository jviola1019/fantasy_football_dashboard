// Detects high-entropy literals that sit on the same line as a secret keyword.
// Pure, dependency-free, and unit-tested; the CLI lives in scripts/check-doc-secrets.ts.

const SECRET_KEYWORDS =
  /(AUTH_SECRET|CREDENTIAL_ENCRYPTION_KEY|DB_INIT_TOKEN|x-init-token|CRON_SECRET|[A-Z][A-Z0-9_]*SECRET|[A-Z][A-Z0-9_]*TOKEN|[A-Z][A-Z0-9_]*API_KEY|PASSWORD|PRIVATE_KEY)/;

// base64 of >=24 chars (32 raw bytes => 43-44 chars) OR hex of >=32 chars
const TOKEN_RE = /[A-Za-z0-9+/]{24,}={0,2}|[a-fA-F0-9]{32,}/g;

// A value assigned after a secret keyword: `KEY = value`, `KEY: value`, or a
// markdown/JSON `"value"`. Captures special-character secrets (passwords) that
// the base64/hex TOKEN_RE misses (reviewer Issue 2). Entropy-guarded below.
const ASSIGN_RE = /[:=]\s*["'`]?([^\s"'`|,}]{12,})["'`]?/g;

const ALLOW_SUBSTRINGS = [
  "your-",
  "your_",
  "example",
  "placeholder",
  "xxxx",
  "<",
  "randombytes",
  "ci-auth-secret",
  "do-not-use",
  "generate",
  "openssl",
  "replace_me",
  "replace-me",
  "changeme",
  "change-me",
  "rand_base64",
  "base64url",
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
  if (token.startsWith("$") || token.includes("${")) return true; // env-var reference
  if (isLowEntropy(token)) return true;
  return false;
}

// A non-base64/hex assigned value looks like a real secret (vs. a placeholder
// word) when it is diverse AND has a digit AND is either special-char or
// mixed-case. `MyS3cur3P@ss!2024` → true; `replacemewithsomething` → false.
function looksLikeAssignedSecret(token: string): boolean {
  if (token.length < 12) return false;
  if (new Set(token).size < 8) return false;
  if (!/\d/.test(token)) return false;
  return /[^A-Za-z0-9]/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token));
}

export function findSecretLeaks(text: string): Leak[] {
  const leaks: Leak[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const kw = raw.match(SECRET_KEYWORDS);
    if (!kw) return;
    const lower = raw.toLowerCase();
    const seen = new Set<string>();
    const push = (t: string) => {
      if (seen.has(t) || isAllowed(t, lower)) return;
      seen.add(t);
      leaks.push({ line: i + 1, keyword: kw![0], token: `${t.slice(0, 6)}…(${t.length} chars)` });
    };
    // 1. base64/hex high-entropy tokens (>=24 / >=32).
    for (const t of raw.match(TOKEN_RE) ?? []) if (t.length >= 24) push(t);
    // 2. special-character secrets assigned after the keyword (>=12, entropy-guarded).
    for (const m of raw.matchAll(ASSIGN_RE)) {
      const v = m[1];
      if (v && v.length < 24 && looksLikeAssignedSecret(v)) push(v);
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
