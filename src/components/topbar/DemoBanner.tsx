"use client";

import { useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "rae.demoBanner.dismissed";

/**
 * Read sessionStorage via useSyncExternalStore — the canonical React pattern
 * for client-only state. Avoids the hydration-mismatch lint warning that the
 * older useEffect+useState pattern triggers.
 */
function subscribeToSessionStorage(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function getStoredDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Slim banner shown above the dashboard whenever the envelope is fixture-mode.
 * Makes it unambiguous that the rendered tiles are demo data, not the user's
 * own league. Dismissable per browser-session via sessionStorage.
 */
export function DemoBanner({ visible }: { visible: boolean }) {
  const stored = useSyncExternalStore(
    subscribeToSessionStorage,
    getStoredDismissed,
    () => false
  );
  const [localDismissed, setLocalDismissed] = useState(false);
  const dismissed = stored || localDismissed;

  if (!visible || dismissed) return null;

  return (
    <div className="demo-banner" role="status" aria-live="polite">
      <strong className="demo-banner-tag">DEMO DATA</strong>
      <span className="demo-banner-msg">
        These tiles use a curated fixture catalog, not your league.{" "}
        <a className="demo-banner-cta" href="/settings/leagues">
          Add a league →
        </a>
      </span>
      <button
        type="button"
        className="demo-banner-close"
        aria-label="Dismiss demo notice for this session"
        onClick={() => {
          try {
            sessionStorage.setItem(STORAGE_KEY, "1");
          } catch {
            // ignore — private mode
          }
          setLocalDismissed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
