"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerWithCredentials, signInWithCredentials } from "./actions";

type Mode = "signin" | "register";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const emailValid = EMAIL_REGEX.test(email);
  const passwordValid = password.length >= 8;
  const showEmailHint = emailTouched && !emailValid && email.length > 0;
  const showPasswordHint = passwordTouched && !passwordValid && password.length > 0;
  const canSubmit = emailValid && passwordValid && !pending;

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      // Server actions throw NEXT_REDIRECT on success; we never observe ok=true.
      // Only render errors here.
      const result =
        mode === "signin"
          ? await signInWithCredentials(formData)
          : await registerWithCredentials(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/settings/leagues");
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="login-form" noValidate>
      {mode === "register" && (
        <div className="login-field">
          <label htmlFor="name" className="login-label">Name (optional)</label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            className="login-input"
          />
        </div>
      )}

      <div className="login-field">
        <label htmlFor="email" className="login-label">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={`login-input${showEmailHint ? " login-input-invalid" : ""}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          aria-invalid={showEmailHint ? "true" : "false"}
          aria-describedby={showEmailHint ? "email-hint" : undefined}
        />
        {showEmailHint ? (
          <p id="email-hint" className="field-hint field-hint-error">
            Enter a valid email address.
          </p>
        ) : null}
      </div>

      <div className="login-field">
        <div className="login-label-row">
          <label htmlFor="password" className="login-label">Password</label>
          <span className="login-label-aux" aria-hidden>{password.length}/8+</span>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={`login-input${showPasswordHint ? " login-input-invalid" : ""}`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setPasswordTouched(true)}
          aria-invalid={showPasswordHint ? "true" : "false"}
          aria-describedby={showPasswordHint ? "password-hint" : undefined}
        />
        {showPasswordHint ? (
          <p id="password-hint" className="field-hint field-hint-error">
            At least 8 characters.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="login-submit"
      >
        {pending ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        className="login-switch"
        onClick={() => {
          setMode(mode === "signin" ? "register" : "signin");
          setError(null);
        }}
      >
        {mode === "signin" ? "Need an account? Register" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
