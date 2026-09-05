import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/db";
import { describeEspnCredentialCoverage, getAccountCredentialAge } from "@/lib/leagues";
import { readOrUninitialised } from "@/db/missingRelation";
import { ChangePasswordForm, DeleteAccountForm, SignOutButton } from "./AccountForms";
import { EspnSignInForm, type EspnCoverageRow } from "./EspnSignInForm";
import { formatCredentialAge } from "./credentialAge";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const user = await requireUser();
  if (!user) redirect("/login");

  // Existence and AGE only. Nothing on this page decrypts a credential, because
  // nothing on this page displays one.
  //
  // Wrapped because `accountCredentials` is created by ONE token-gated operator
  // action (`POST /api/admin/init-db`) and nothing applies that DDL
  // automatically on Postgres. A deployment can therefore be running a build
  // that knows about the table before the database has been told, and an
  // unhandled "relation does not exist" here would 500 the whole page — taking
  // change-password and delete-account down with a feature neither depends on.
  //
  // `ready: false` is NOT rendered as "nothing saved yet". That would be a false
  // statement about storage the user cannot write to.
  const espn = await readOrUninitialised(
    async () => ({
      ready: true,
      age: await getAccountCredentialAge(getDb(), user.id),
      coverage: await describeEspnCredentialCoverage(getDb(), user.id)
    }),
    { ready: false, age: null, coverage: [] as EspnCoverageRow[] }
  );

  // requireUser() already returns the persisted email/name straight from the
  // users row (it has to read it to validate the session generation), so the
  // separate canonical-row query this page used to run is redundant — and it
  // no longer needs its own existence check, because a deleted user cannot get
  // past requireUser() at all.

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 24 }}>
        <header>
          <h1 style={{ color: "var(--cream)", margin: 0, fontSize: "var(--text-xl)" }}>Account</h1>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            Manage how you sign in. Passwords are hashed with scrypt. Changing your password signs you out everywhere, on every device.
          </p>
        </header>

        <section style={panel}>
          <h2 style={h2}>Profile</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: 0 }}>
            <dt style={dt}>Email</dt>
            <dd style={dd}>{user.email ?? "—"}</dd>
            <dt style={dt}>Name</dt>
            <dd style={dd}>{user.name ?? <span style={{ color: "var(--muted)" }}>(not set)</span>}</dd>
            <dt style={dt}>User ID</dt>
            <dd style={dd}>
              <code style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>{user.id}</code>
            </dd>
          </dl>
          <div style={{ marginTop: 16 }}>
            <SignOutButton />
          </div>
        </section>

        <section style={panel}>
          <h2 style={h2}>ESPN sign-in</h2>
          <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12, fontSize: "var(--text-sm)" }}>
            One cookie pair for every ESPN league on this account. Encrypted at rest with AES-256-GCM
            and never sent back to your browser.
          </p>
          <EspnSignInForm
            savedAt={formatCredentialAge(espn.age?.rotatedAt ?? null)}
            coverage={espn.coverage}
            storageReady={espn.ready}
          />
        </section>

        <section style={panel}>
          <h2 style={h2}>Change password</h2>
          <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12, fontSize: "var(--text-sm)" }}>
            8+ characters. Your current password is required to confirm.
          </p>
          <ChangePasswordForm />
        </section>

        <section style={{ ...panel, borderColor: "rgba(227,94,94,0.3)" }}>
          <h2 style={{ ...h2, color: "var(--red, #e35e5e)" }}>Danger zone</h2>
          <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12, fontSize: "var(--text-sm)" }}>
            Deleting your account also deletes every connected league and any encrypted credentials.
          </p>
          <DeleteAccountForm />
        </section>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  padding: 24,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)"
};

const h2: React.CSSProperties = { color: "var(--cream)", marginTop: 0, fontSize: "var(--text-base)" };

const dt: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--text-xs)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  alignSelf: "center"
};

const dd: React.CSSProperties = { color: "var(--cream)", margin: 0, fontSize: "var(--text-base)" };
