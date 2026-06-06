import type { RAEEnvelope } from "@/lib/governance";

/**
 * Progressive-disclosure of the model's assumptions + any metrics that lack a
 * free data source. A native <details> so it works without JS and is keyboard
 * accessible. Mounted in the governance banner so EVERY route exposes its
 * assumptions on demand (blueprint: "model assumptions visible").
 */
export function AssumptionsDrawer({ sourceState }: { sourceState: RAEEnvelope["sourceState"] }) {
  const { assumptions, missingFields } = sourceState;
  if (assumptions.length === 0 && missingFields.length === 0) return null;
  return (
    <details className="gov-assume">
      <summary className="gov-assume-summary">
        Assumptions &amp; data gaps ({assumptions.length + (missingFields.length > 0 ? 1 : 0)})
      </summary>
      <div className="gov-assume-body">
        {assumptions.length > 0 && (
          <ul className="gov-assume-list">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
        {missingFields.length > 0 && (
          <p className="gov-assume-missing">
            <b>No free data source yet:</b> {missingFields.join(", ")} — rendered as &quot;—&quot;, never invented.
          </p>
        )}
      </div>
    </details>
  );
}
