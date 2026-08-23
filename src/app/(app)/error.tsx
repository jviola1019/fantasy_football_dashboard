"use client";

/**
 * Route-level error boundary for every `(app)` route. Catches render/data errors
 * in the shell subtree and shows an honest recovery surface (no fabricated data,
 * no blank screen) with a retry. `digest` is the server-side error id.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-xl border border-rae-red/40 bg-card/60 p-6 text-center">
      <h2 className="text-base font-bold uppercase tracking-[0.06em] text-rae-red">Something went wrong</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        This view hit an error loading its data. Nothing was fabricated to hide it — the panel failed cleanly. Try
        again, or head back to your dashboard.
      </p>
      {error.digest ? <p className="mt-2 text-xs text-muted-foreground">Error id: {error.digest}</p> : null}
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-rae-amber px-4 py-2 text-sm font-bold text-background transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-rae-blue/50"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
