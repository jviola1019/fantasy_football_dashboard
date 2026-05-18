"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerWithCredentials, signInWithCredentials } from "./actions";

type Mode = "signin" | "register";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  color: "var(--cream)",
  fontSize: 14
};
const labelStyle: React.CSSProperties = { color: "var(--muted)", fontSize: 12, display: "block", marginBottom: 4 };
const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--amber)",
  color: "#000",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer"
};

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result =
        mode === "signin"
          ? await signInWithCredentials(formData)
          : await registerWithCredentials(formData);
      if (result.ok) {
        router.push("/settings/leagues");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
      {mode === "register" && (
        <div>
          <label htmlFor="name" style={labelStyle}>Name (optional)</label>
          <input id="name" name="name" autoComplete="name" style={inputStyle} />
        </div>
      )}
      <div>
        <label htmlFor="email" style={labelStyle}>Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" style={inputStyle} />
      </div>
      <div>
        <label htmlFor="password" style={labelStyle}>Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          style={inputStyle}
        />
      </div>
      {error ? <p style={{ color: "var(--red)", margin: 0, fontSize: 13 }}>{error}</p> : null}
      <button type="submit" disabled={pending} style={{ ...buttonStyle, opacity: pending ? 0.7 : 1 }}>
        {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "register" : "signin");
          setError(null);
        }}
        style={{
          background: "transparent",
          color: "var(--blue)",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          padding: 0
        }}
      >
        {mode === "signin" ? "Need an account? Register" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
