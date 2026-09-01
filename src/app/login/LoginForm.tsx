"use client";

import { useState, useTransition } from "react";
import { registerWithCredentials, signInWithCredentials } from "./actions";
import { DEFAULT_REDIRECT } from "./constants";

type Mode = "signin" | "register";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
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
      // The actions now return normally on success (`redirect: false`), so this
      // branch IS reached -- it used to be dead, because Auth.js threw
      // NEXT_REDIRECT and Next navigated for us. See the note in actions.ts.
      const result =
        mode === "signin"
          ? await signInWithCredentials(formData)
          : await registerWithCredentials(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A FULL document navigation. Deliberate, and the Next rule is disabled
      // for it below with reasons.
      //
      // THE BUG. Sign-in worked and the app still said "Sign in". The cookie
      // was set and `/api/auth/session` returned the user, but `router.push` is
      // a CLIENT-side navigation: the React tree survives it, so
      // `SessionProvider` kept the unauthenticated session it fetched on first
      // mount and `useSession()` in the topbar stayed stale. A hard reload
      // showed the account correctly, which is what localised it.
      //
      // That is the worst kind of failure. Authentication SUCCEEDED, the
      // protected route rendered, and the one piece of chrome a user checks to
      // confirm it still offered them a "Sign in" button. Most people read that
      // as "it did not work" and try again.
      //
      // WHAT WAS TRIED. `router.refresh()` re-renders server components and
      // never touches the session endpoint. `useSession().update()` was tried
      // next and MEASURED not to fix it -- the topbar still rendered signed-out
      // after the push. Only remounting the provider against the new cookie
      // does, so that is what this does.
      //
      // Next lints against `window.location.assign` for internal destinations,
      // on the assumption that client navigation is always better. Here it is
      // provably not: the auth provider's state has to be rebuilt, and one full
      // page load at sign-in is a fair price for the app never lying about
      // whether you are signed in.
      //
      // The rule does not fire now only because the destination is an imported
      // constant rather than a literal, so it cannot analyse it statically.
      // That is a side effect of keeping the destination in one place, not a
      // reason the concern went away -- hence this note staying put.
      window.location.assign(DEFAULT_REDIRECT);
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
