import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — RAE" };

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <div
        style={{
          background: "var(--panel)",
          padding: "32px",
          width: "min(420px, 92vw)",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.06)"
        }}
      >
        <h1 style={{ marginTop: 0, color: "var(--cream)", fontSize: 24 }}>Sign in to RAE</h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Bring your Sleeper or ESPN league. Credentials are encrypted at rest.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
