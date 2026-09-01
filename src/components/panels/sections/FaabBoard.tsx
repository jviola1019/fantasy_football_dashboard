import type { RAEEnvelope } from "@/lib/governance";
import { myFaabBudget } from "@/lib/leagues/faab";
import { DataUnavailable } from "../../ui/DataUnavailable";
import { BarChart } from "@/components/charts/BarChart";

/**
 * Every team's remaining free-agent acquisition budget.
 *
 * S4. `/waivers` said *"Free-agent acquisition budgets not connected — no real
 * budget data is integrated yet"* while `fetchLive` was extracting exactly that
 * field for both platforms and the lifecycle cron was firing `faab-depleted`
 * alerts on it. The panel was describing the app's own state incorrectly, in the
 * conservative direction, which is the failure mode a "never hide unavailable
 * data" rule is least likely to catch.
 *
 * The whole league is shown rather than only the user's own budget, because a
 * budget is only meaningful against the field: $40 is a strong position if the
 * next-richest team has $12 and a weak one if three teams still hold $100. Both
 * platforms return every team's spend in the payload already fetched, so this
 * costs no extra call.
 */
export function FaabBoard({ envelope }: { envelope?: RAEEnvelope }) {
  const state = envelope?.faab ?? null;

  if (!state) {
    return (
      <div className="faab-board">
        <div className="section-label">FAAB (FREE-AGENT BUDGET)</div>
        <DataUnavailable
          title="This league does not use FAAB"
          description="Read from the league's own settings: Sleeper must report waiver_type 2 (FAAB bidding), ESPN must report isUsingAcquisitionBudget. Neither did, so this league runs rolling or reverse-standings waivers and has no budget to show. Sleeper sends waiver_budget: 100 for every league whether or not it is used, so a bar drawn from that alone would be fiction."
        />
      </div>
    );
  }

  const mine = myFaabBudget(state);
  const shown = state.budgets.length;
  // The field a manager is actually bidding against: everyone except them.
  const others = state.budgets.filter((b) => !b.isMine);
  const richestRival = others.length > 0 ? others[0]! : null;

  return (
    <div className="faab-board" data-testid="faab-board">
      <div className="section-label">FAAB (FREE-AGENT BUDGET)</div>

      {mine ? (
        <p className="faab-lede">
          <b className="faab-mine-amount">${mine.remaining}</b> of ${mine.total} left
          {richestRival ? (
            <>
              {" "}
              · the richest rival holds <b>${richestRival.remaining}</b>
            </>
          ) : null}
        </p>
      ) : (
        // D-D's sibling case: without a resolved identity nothing may be marked
        // as the user's, so the board is shown without a "you" row rather than
        // attributing the first team's budget to them.
        <p className="small-note faab-lede">
          Your own team could not be identified in this league, so no row is marked as yours. Set
          your username in league settings to see your budget against the field.
        </p>
      )}

      {/* The shared bar primitive (S5). This panel had its own copy of the
          label/track/value grid; `BarChart` is now the one bar idiom in the
          product, so a change to how a bar reads happens once. */}
      <BarChart
        items={state.budgets.map((b) => ({
          label: b.teamName,
          value: b.remaining,
          valueLabel: `$${b.remaining}`,
          note: b.isMine ? "· you" : undefined,
          emphasis: b.isMine,
          ariaLabel: `${b.teamName}: $${b.remaining} of $${b.total} remaining`
        }))}
        max={state.total}
        ariaLabel="Remaining free-agent budget by team"
      />

      <p className="small-note faab-prov">
        Live from the league&rsquo;s own waiver settings — {shown} of {state.teamCount} team
        {state.teamCount === 1 ? "" : "s"}
        {shown < state.teamCount
          ? "; the rest reported budgets that did not add up and were left out rather than drawn"
          : ""}
        . Starting budget ${state.total} each.
      </p>
    </div>
  );
}
