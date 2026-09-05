import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE POPULATED BRANCH, WHICH e2e CANNOT REACH.
 *
 * `e2e/17-account-flows.spec.ts` registers a fresh user, so it only ever sees
 * the "no ESPN sign-in saved" state. Every claim this component makes once a
 * pair EXISTS — its age, which leagues it authenticates, and what Remove would
 * cost — is unreachable from there without real ESPN cookies, and would ship
 * unverified. That is the exact gap `vitest.config.ts` documents for panels.
 *
 * `react-dom/server` renders the initial state without a browser. `useRouter`
 * is the only thing that needs standing in for; `useState`/`useTransition`
 * render their initial values server-side, which is the state under test.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  saveEspnSignInAction: vi.fn(),
  removeEspnSignInAction: vi.fn()
}));

const { EspnSignInForm } = await import("./EspnSignInForm");

const row = (label: string, origin: "account" | "league-override" | null, id = label) => ({
  leagueId: id,
  label,
  origin
});

describe("EspnSignInForm, with a pair saved", () => {
  const html = renderToStaticMarkup(
    <EspnSignInForm
      savedAt="12 days ago"
      coverage={[
        row("Dynasty Warriors", "account"),
        row("Money League", "account"),
        row("Other Login", "league-override")
      ]}
    />
  );

  it("states the age, because ESPN never says when a cookie expires", () => {
    expect(html).toContain("12 days ago");
  });

  it("counts what the pair authenticates, and what it does not", () => {
    expect(html).toContain("2 leagues");
    // The override is excluded from the count AND the verb agrees with it.
    // "1 league use their own cookies" is what this replaced.
    expect(html).toContain("1 league uses its own cookies instead.");
  });

  it("conjugates the override clause for more than one", () => {
    const many = renderToStaticMarkup(
      <EspnSignInForm
        savedAt="1 day ago"
        coverage={[
          row("A", "account"),
          row("B", "league-override"),
          row("C", "league-override")
        ]}
      />
    );
    expect(many).toContain("2 leagues use their own cookies instead.");
    expect(many).toContain("Authenticates 1 league;");
  });

  it("names the covered leagues, so Remove is not a blind confirmation", () => {
    expect(html).toContain("Dynasty Warriors");
    expect(html).toContain("Money League");
    // The overridden league is NOT listed as covered: removing this pair does
    // not affect it, and implying otherwise would overstate the damage.
    expect(html).not.toMatch(/<li>Other Login<\/li>/);
  });

  it("offers Replace and Remove rather than an editable field", () => {
    expect(html).toContain("Replace sign-in");
    expect(html).toContain("Remove sign-in");
    // No input is rendered at all until Replace is pressed — there is nothing
    // for a browser or an extension to autofill into.
    expect(html).not.toContain('id="accountEspnS2"');
  });

  it("renders no cookie value, because it is never given one", () => {
    // The component's API cannot leak a secret: it takes an age string and a
    // list of labels. This pins that, so a later "show the current SWID"
    // convenience has to change the signature and be noticed.
    expect(html).not.toMatch(/espn_s2=/i);
    expect(html).not.toMatch(/SWID=/);
  });
});

describe("EspnSignInForm, when the table does not exist yet", () => {
  // `accountCredentials` is created by ONE token-gated operator action and
  // nothing applies that DDL automatically on Postgres, so a deployment can run
  // a build that knows about the table before the database has been told.
  const html = renderToStaticMarkup(
    <EspnSignInForm savedAt={null} coverage={[]} storageReady={false} />
  );

  it("says the schema is not applied, rather than 'nothing saved'", () => {
    // The distinction is the point. Both states show no cookies, but one means
    // "add yours" and the other means "you cannot, and here is why" — and the
    // wrong one invites a paste into storage that is not there.
    expect(html).toContain("cannot be saved yet");
    expect(html).toContain("has not had its schema applied");
    expect(html).not.toContain("No ESPN sign-in saved");
  });

  it("renders no form at all, so nothing can be typed into a void", () => {
    expect(html).not.toContain('id="accountEspnS2"');
    expect(html).not.toContain('id="accountSwid"');
    expect(html).not.toContain("Save ESPN sign-in");
  });

  it("tells the reader it is not their fault, what still works, and what to do", () => {
    // An error that only says something is broken leaves the reader with no
    // next move. This one names the cause, the unaffected path, and the fix.
    expect(html).toContain("Nothing is wrong with your account");
    expect(html).toContain("Sleeper leagues work normally");
    expect(html).toContain("Applying the Postgres schema");
  });

  it("defaults to ready, so every existing caller keeps the normal render", () => {
    const normal = renderToStaticMarkup(<EspnSignInForm savedAt={null} coverage={[]} />);
    expect(normal).toContain("No ESPN sign-in saved");
    expect(normal).not.toContain("cannot be saved yet");
  });
});

describe("EspnSignInForm, with nothing saved", () => {
  it("opens straight into the form and says nothing is stored", () => {
    const html = renderToStaticMarkup(<EspnSignInForm savedAt={null} coverage={[]} />);
    expect(html).toContain("No ESPN sign-in saved");
    expect(html).toContain('id="accountEspnS2"');
    expect(html).toContain("Save ESPN sign-in");
    expect(html).not.toContain("Remove sign-in");
  });

  it("warns when leagues are already stranded without one", () => {
    // Reached by removing the pair while ESPN leagues exist. Silence here would
    // leave a dashboard full of "unavailable" with the cause one page away and
    // unmentioned.
    const html = renderToStaticMarkup(
      <EspnSignInForm savedAt={null} coverage={[row("Dynasty Warriors", null)]} />
    );
    expect(html).toContain("1 league currently cannot load ESPN data");
  });

  it("keeps both fields as password inputs", () => {
    const html = renderToStaticMarkup(<EspnSignInForm savedAt={null} coverage={[]} />);
    const inputs = html.match(/<input[^>]*id="account(EspnS2|Swid)"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).toContain('type="password"');
  });
});
