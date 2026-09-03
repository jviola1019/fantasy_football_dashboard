"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { buttonStyle, inputStyle, labelStyle } from "../formStyles";
import { changePasswordAction, deleteAccountAction } from "./actions";


export function ChangePasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "error"; message?: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setStatus({ kind: "idle" });
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await changePasswordAction(formData);
      if (result.ok) {
        form.reset();
        setStatus({ kind: "ok", message: "Password updated." });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
      <div>
        <label htmlFor="currentPassword" style={labelStyle}>
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          style={inputStyle}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label htmlFor="newPassword" style={labelStyle}>
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" style={labelStyle}>
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
        </div>
      </div>
      {status.kind === "error" && status.message ? (
        <p role="alert" aria-live="polite" style={{ color: "var(--red, #e35e5e)", margin: 0, fontSize: "var(--text-sm)" }}>{status.message}</p>
      ) : null}
      {status.kind === "ok" && status.message ? (
        <p role="status" aria-live="polite" style={{ color: "var(--green, #6fd07f)", margin: 0, fontSize: "var(--text-sm)" }}>{status.message}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        style={{
          ...buttonStyle,
          background: "var(--amber)",
          color: "#000",
          opacity: pending ? 0.7 : 1
        }}
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          // See UserMenu: Auth.js resolves its redirect against AUTH_URL, which
          // sent preview users to production. Navigate here instead.
          await signOut({ redirect: false });
          // See UserMenu: a client navigation leaves the provider holding a
          // session it just discarded.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload is required to rebuild the auth provider
          window.location.assign("/");
        });
      }}
      style={{
        ...buttonStyle,
        background: "transparent",
        color: "var(--cream)",
        border: "1px solid rgba(255,255,255,0.18)",
        opacity: pending ? 0.7 : 1
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function DeleteAccountForm() {
  const [status, setStatus] = useState<{ kind: "idle" | "error"; message?: string }>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  // Double-confirm guard before the server action even runs — defense in
  // depth alongside the typed-DELETE + current-password checks server-side.
  const [showForm, setShowForm] = useState(false);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setStatus({ kind: "idle" });
    const form = event.currentTarget;
    const formData = new FormData(form);
    // Server action will redirect to / on success, so the form never sees
    // a return value in the success case.
    startTransition(async () => {
      const result = await deleteAccountAction(formData);
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        style={{
          ...buttonStyle,
          background: "transparent",
          color: "var(--red, #e35e5e)",
          border: "1px solid rgba(227,94,94,0.4)"
        }}
      >
        Delete account…
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
      <p style={{ color: "var(--red, #e35e5e)", margin: 0, fontSize: "var(--text-sm)" }}>
        This permanently deletes your account, every league you&apos;ve connected, and any encrypted
        league credentials. Cannot be undone.
      </p>
      <div>
        <label htmlFor="deleteCurrentPassword" style={labelStyle}>
          Current password
        </label>
        <input
          id="deleteCurrentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor="confirmDelete" style={labelStyle}>
          Type <code>DELETE</code> to confirm
        </label>
        <input
          id="confirmDelete"
          name="confirm"
          type="text"
          required
          autoComplete="off"
          placeholder="DELETE"
          style={inputStyle}
        />
      </div>
      {status.kind === "error" && status.message ? (
        <p style={{ color: "var(--red, #e35e5e)", margin: 0, fontSize: "var(--text-sm)" }}>{status.message}</p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
            setStatus({ kind: "idle" });
          }}
          style={{
            ...buttonStyle,
            background: "transparent",
            color: "var(--cream)",
            border: "1px solid rgba(255,255,255,0.18)"
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          style={{
            ...buttonStyle,
            background: "var(--red, #e35e5e)",
            color: "#fff",
            opacity: pending ? 0.7 : 1
          }}
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </button>
      </div>
    </form>
  );
}
