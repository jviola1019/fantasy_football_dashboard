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

function isAllowed(token: string, lineLower: string): boolean {
  if (ALLOW_SUBSTRINGS.some((a) => lineLower.includes(a))) return true;
  // all-same-character dummies like AAAA...=
  if (/^(.)\1+={0,2}$/.test(token)) return true;
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
