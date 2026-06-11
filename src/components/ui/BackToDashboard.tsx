import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Persistent back-out control. Rendered at the top of every non-homepage page
// so users always have a single-click path out — particularly important from
// /login (where the topbar isn't visible) and /settings/* (where the dashboard
// chrome is replaced by a simple settings layout). The default points at "/"
// (onboarding home — reachable anonymously), so the default label says "Home";
// pass href="/dashboard" label="Dashboard" from authenticated contexts (UX-08).
export function BackToDashboard({
  href = "/",
  label = "Home",
  className
}: {
  href?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={`Back to ${label}`}
      style={style}
    >
      <ArrowLeft size={14} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

// Inline styles keep this component dependency-free from Tailwind config and
// the existing settings-page CSS variables, so it slots in anywhere.
// SOLID colors (not translucent / token-dependent) so the contrast is
// unambiguous on any page background — a translucent bg composites over an
// indeterminate parent and axe scored cream-on-gray at 1.98:1.
const style: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  color: "#f0ece4",
  background: "#18222f",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  textDecoration: "none",
  letterSpacing: 0.2,
  whiteSpace: "nowrap",
  transition: "border-color 120ms ease, background 120ms ease"
};
