"use client";

import { useState, useTransition } from "react";
import type { LeagueFormat, Provenance } from "@/lib/trade/format";
import { confirmLeagueSettings } from "./actions";

/**
 * Detected-vs-confirmed league settings (audit F-010).
 *
 * Two kinds of setting live side by side here, and the distinction is the whole
 * point of the panel:
 *
 *  DETECTED — read from the platform on every refresh and shown read-only.
 *    Making these editable would let the app report settings that disagree with
 *    the league itself, which is worse than showing nothing.
 *
 *  CONFIRMED — rules NO platform publishes. Verified against a real ESPN keeper
 *    league across four seasons: draftSettings carries keeperCount and
 *    keeperOrderType but no cost field, the prior draft has zero keeper picks to
 *    infer from, and the keeper rule only began this season. The cost exists
 *    solely as a league convention, so the owner states it once.
 *
 * Surfacing the detected block also gives the operator a chance to catch a
 * misread — exactly the class of bug that let four 1QB leagues be treated as
 * superflex for months without anyone seeing it.
 */

const COST_RULES: Array<{ value: LeagueFormat["keeperCostRule"]; label: string; hint: string }> = [
  { value: "fixed-round", label: "Costs a fixed round", hint: "e.g. keeping anyone costs your 1st-round pick" },
  { value: "draft-round", label: "Costs the round they were drafted", hint: "round they went in last season" },
  { value: "escalating-round", label: "Escalating round", hint: "cost improves by a round each year kept" },
  { value: "auction-salary", label: "Auction salary", hint: "last year's salary, usually plus an increment" },
  { value: "free", label: "Free — no pick forfeited", hint: "keepers cost nothing" }
];

export function LeagueSettingsForm({
  leagueId,
  label,
  format
}: {
  leagueId: string;
  label: string;
  format: LeagueFormat | null;
}) {
  const [rule, setRule] = useState<LeagueFormat["keeperCostRule"]>(format?.keeperCostRule ?? "unknown");
  const [round, setRound] = useState<string>(format?.keeperCostRound?.toString() ?? "1");
  const [slot, setSlot] = useState<string>(format?.draftSlot?.toString() ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!format) {
    return (
      <p className="muted">
        Settings for {label} have not been read yet — refresh the league to detect them.
      </p>
    );
  }

  const isKeeper = format.leagueType === "keeper" && format.keeperCount > 0;
  const needsConfirmation = isKeeper && format.keeperCostRule === "unknown";

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await confirmLeagueSettings(formData);
      setMessage(result.ok ? "Saved." : result.error);
    });
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div className="section-label">DETECTED FROM PLATFORM</div>
        <dl style={dl}>
          <Row k="Scoring" v={`${format.scoringFormat} (${format.ppr} pt/reception)`} />
          <Row
            k="League type"
            v={format.leagueType}
            // Audit P2 §11: ESPN publishes no league-type field, so its verdict
            // is our heuristic. Showing it identically to Sleeper's declared
            // value invited the owner to trust an inference.
            provenance={format.provenance?.leagueType}
          />
          <Row k="Teams" v={String(format.numTeams)} />
          <Row
            k="Starters"
            v={`${format.starters.QB}QB ${format.starters.RB}RB ${format.starters.WR}WR ${format.starters.TE}TE` +
              (format.starters.FLEX ? ` ${format.starters.FLEX}FLEX` : "") +
              (format.starters.SUPERFLEX ? ` ${format.starters.SUPERFLEX}SFLEX` : "")}
          />
          <Row k="Roster size" v={String(format.rosterSize)} />
          {isKeeper && (
            <Row
              k="Keepers allowed"
              v={String(format.keeperCount)}
              provenance={format.provenance?.keeperCount}
            />
          )}
        </dl>
        {format.provenance?.note && (
          <p
            className="muted"
            style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber)" }}
            role="note"
          >
            {format.provenance.note}
          </p>
        )}
        <p className="muted" style={{ marginTop: 6, fontSize: "var(--text-xs)" }}>
          Read from the platform on every refresh. Items marked{" "}
          <strong>derived</strong> are inferred by RAE, not stated by the platform — check those
          first if something looks wrong.
        </p>
      </div>

      {isKeeper && (
        <form action={onSubmit} style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="leagueId" value={leagueId} />
          <div className="section-label">
            CONFIRM — NOT PUBLISHED BY THE PLATFORM
            {needsConfirmation && <span style={{ color: "var(--amber)" }}> · needed</span>}
          </div>
          <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: -4 }}>
            Neither ESPN nor Sleeper stores what a keeper costs — it is your league&apos;s own rule. Keeper
            recommendations stay switched off until you set it, because guessing a keeper cost is
            irreversible for the season.
          </p>

          <label style={lbl}>
            What does keeping a player cost?
            <select
              name="keeperCostRule"
              value={rule}
              onChange={(e) => setRule(e.target.value as LeagueFormat["keeperCostRule"])}
              style={input}
            >
              <option value="unknown">— not set —</option>
              {COST_RULES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: -6 }}>
            {COST_RULES.find((r) => r.value === rule)?.hint ?? "Pick the rule your commissioner set."}
          </p>

          {rule === "fixed-round" && (
            <label style={lbl}>
              Which round does it cost?
              <input
                name="keeperCostRound"
                type="number"
                min={1}
                max={30}
                value={round}
                onChange={(e) => setRound(e.target.value)}
                style={input}
              />
            </label>
          )}

          <label style={lbl}>
            Your first-round draft slot <span className="muted">(optional)</span>
            <input
              name="draftSlot"
              type="number"
              min={1}
              max={format.numTeams}
              placeholder={`1–${format.numTeams}`}
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              style={input}
            />
          </label>
          <p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: -6 }}>
            Used to price the exact pick a keeper costs. Left blank, the middle of the round is used and
            that assumption is shown alongside the result.
          </p>

          <button type="submit" disabled={pending} className="btn-primary" style={{ justifySelf: "start" }}>
            {pending ? "Saving…" : "Save league rules"}
          </button>
          {message && (
            <p role="status" className="muted" style={{ margin: 0 }}>
              {message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * A detected setting, tagged with how it was established.
 *
 * `platform-declared` is left unlabelled — that is the expected case, and
 * badging it everywhere would just add noise that trains people to ignore the
 * badge. Only the weaker verdicts get called out.
 */
function Row({
  k,
  v,
  provenance
}: {
  k: string;
  v: string;
  provenance?: Provenance;
}) {
  const badge =
    provenance === "derived"
      ? { text: "derived", color: "var(--amber)" }
      : provenance === "defaulted"
        ? { text: "assumed", color: "var(--amber)" }
        : provenance === "owner-confirmed"
          ? { text: "you confirmed", color: "var(--green)" }
          : provenance === "unavailable"
            ? { text: "not published", color: "var(--muted)" }
            : null;

  return (
    <>
      <dt style={dt}>{k}</dt>
      <dd style={dd}>
        {v}
        {badge && (
          <span style={{ marginLeft: 6, fontSize: "var(--text-xs)", color: badge.color }}>({badge.text})</span>
        )}
      </dd>
    </>
  );
}

const dl: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "4px 14px",
  margin: 0
};
const dt: React.CSSProperties = { color: "var(--muted)", fontSize: "var(--text-sm)" };
const dd: React.CSSProperties = { color: "var(--cream)", fontSize: "var(--text-sm)", margin: 0, fontVariantNumeric: "tabular-nums" };
const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, color: "var(--muted)", fontSize: "var(--text-sm)" };
const input: React.CSSProperties = {
  padding: "8px 10px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  color: "var(--cream)",
  minHeight: 40
};
