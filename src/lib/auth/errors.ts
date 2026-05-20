/**
 * Map any auth-pipeline error into a user-readable string. The contract:
 *   1. Never echoes raw `error.message` — Auth.js internals, Drizzle stack
 *      traces, and Node TLS errors must not reach the UI.
 *   2. Always returns a non-empty string ending in a period.
 *   3. Class of failure is stable so e2e tests can assert verbatim copy.
 */
export function mapAuthError(error: unknown): string {
  if (error == null) return "Something went wrong. Try again.";
  const tag = errorTag(error);
  switch (tag) {
    case "CredentialsSignin":
      return "Email or password is incorrect.";
    case "AccessDenied":
      return "This account is locked. Contact support.";
    case "EmailSignin":
    case "Verification":
      return "That sign-in link expired. Request a new one.";
    case "CallbackRouteError":
    case "OAuthSignin":
    case "OAuthCallbackError":
      return "Sign-in failed. Try again in a moment.";
    case "DuplicateEmail":
      return "An account with that email already exists.";
    case "PasswordTooShort":
      return "Password must be at least 8 characters.";
    case "InvalidEmail":
      return "Enter a valid email address.";
    case "Network":
      return "Connection error. Check your internet.";
    case "ConfigurationError":
      return "We're having trouble signing you in. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

export type AuthErrorTag =
  | "CredentialsSignin"
  | "AccessDenied"
  | "EmailSignin"
  | "Verification"
  | "CallbackRouteError"
  | "OAuthSignin"
  | "OAuthCallbackError"
  | "DuplicateEmail"
  | "PasswordTooShort"
  | "InvalidEmail"
  | "Network"
  | "ConfigurationError"
  | "Unknown";

/**
 * Inspect an unknown error and decide which mapped class it belongs to.
 * Pure function — no I/O, no logging.
 */
export function errorTag(error: unknown): AuthErrorTag {
  if (error == null) return "Unknown";

  // Auth.js v5 errors expose a `type` (string) and may also embed the type in
  // `message` or `name`.
  const obj = typeof error === "object" ? (error as Record<string, unknown>) : null;
  const candidates = [
    obj && typeof obj.type === "string" ? (obj.type as string) : null,
    obj && typeof obj.code === "string" ? (obj.code as string) : null,
    obj && typeof obj.name === "string" ? (obj.name as string) : null,
    obj && typeof obj.message === "string" ? (obj.message as string) : null,
    typeof error === "string" ? error : null
  ].filter((s): s is string => Boolean(s));

  const blob = candidates.join(" ").toLowerCase();

  if (blob.includes("credentialssignin")) return "CredentialsSignin";
  if (blob.includes("accessdenied")) return "AccessDenied";
  if (blob.includes("oauthcallback")) return "OAuthCallbackError";
  if (blob.includes("oauthsignin")) return "OAuthSignin";
  if (blob.includes("callbackrouteerror") || blob.includes("authrouteerror")) return "CallbackRouteError";
  if (blob.includes("emailsignin")) return "EmailSignin";
  if (blob.includes("verification")) return "Verification";

  // Application-layer custom errors
  if (blob.includes("already exists") || blob.includes("unique constraint")) return "DuplicateEmail";
  if (blob.includes("password must be") || blob.includes("at least 8")) return "PasswordTooShort";
  if (blob.includes("invalid email")) return "InvalidEmail";

  // Network / fetch
  if (
    blob.includes("fetch failed") ||
    blob.includes("network") ||
    blob.includes("econnrefused") ||
    blob.includes("etimedout") ||
    blob.includes("abort")
  ) {
    return "Network";
  }

  if (blob.includes("server configuration") || blob.includes("missing secret")) {
    return "ConfigurationError";
  }

  return "Unknown";
}
