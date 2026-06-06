import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { ChangePasswordForm, DeleteAccountForm, SignOutButton } from "./AccountForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account — RAE" };

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Read the canonical user row so we display the persisted email/name rather
  // than whatever the JWT happens to carry, in case those drift later.
  const db = getDb();
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, session.user.id)).limit(1);
  const user = rows[0];
  if (!user) redirect("/login");

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 24 }}>
        <header>
          <h1 style={{ color: "var(--cream)", margin: 0, fontSize: 24 }}>Account</h1>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            Manage how you sign in. Passwords are hashed with scrypt; sessions use JWT cookies.
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
              <code style={{ color: "var(--muted)", fontSize: 12 }}>{user.id}</code>
            </dd>
          </dl>
          <div style={{ marginTop: 16 }}>
            <SignOutButton />
          </div>
        </section>

        <section style={panel}>
          <h2 style={h2}>Change password</h2>
          <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12, fontSize: 13 }}>
            8+ characters. Your current password is required to confirm.
          </p>
          <ChangePasswordForm />
        </section>

        <section style={{ ...panel, borderColor: "rgba(227,94,94,0.3)" }}>
          <h2 style={{ ...h2, color: "var(--red, #e35e5e)" }}>Danger zone</h2>
          <p style={{ color: "var(--muted)", marginTop: 4, marginBottom: 12, fontSize: 13 }}>
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

const h2: React.CSSProperties = { color: "var(--cream)", marginTop: 0, fontSize: 16 };

const dt: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  alignSelf: "center"
};

const dd: React.CSSProperties = { color: "var(--cream)", margin: 0, fontSize: 14 };
