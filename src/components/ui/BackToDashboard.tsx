import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Persistent back-to-dashboard control. Rendered at the top of every non-
// homepage page so users always have a single-click path out — particularly
// important from /login (where the topbar isn't visible) and /settings/*
// (where the dashboard chrome is replaced by a simple settings layout).
export function BackToDashboard({
  href = "/",
  label = "Dashboard",
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
const style: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--cream, #f5e7c4)",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  textDecoration: "none",
  letterSpacing: 0.2,
  whiteSpace: "nowrap",
  transition: "border-color 120ms ease, background 120ms ease"
};
