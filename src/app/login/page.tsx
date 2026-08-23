import { LoginForm } from "./LoginForm";
import { BackToDashboard } from "@/components/ui/BackToDashboard";

export const metadata = { title: "Sign in — RAE" };

/**
 * Rendered per-request so the CSP nonce can be stamped into the page's scripts
 * (audit F-007).
 *
 * This was the ONLY statically prerendered route in the app, and that is exactly
 * why it was the only one failing the CSP violation sweep: static HTML is built
 * before any request exists, so there is no per-request nonce to embed, and
 * under `strict-dynamic` every one of its script chunks was refused. Next
 * documents `connection()` / force-dynamic as the fix. The page has no cacheable
 * payload — it is a sign-in form — so nothing is lost.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        position: "relative"
      }}
    >
      <div style={{ position: "absolute", top: 16, left: 16 }}>
        <BackToDashboard />
      </div>
      <div
        style={{
          background: "var(--panel)",
          padding: "32px",
          width: "min(420px, 92vw)",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.06)"
        }}
      >
        <h1 style={{ marginTop: 0, color: "var(--cream)", fontSize: "var(--text-xl)" }}>Sign in to RAE</h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Bring your Sleeper or ESPN league. Credentials are encrypted at rest.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
