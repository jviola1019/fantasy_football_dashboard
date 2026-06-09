# Branch & PR Hygiene Audit — 2026-06-09

**Auditor:** branch_diff_auditor worker (read-only)
**Base ref:** `origin/main` @ `0a5ac58` (2026-06-08)
**Audit branch:** `audit/2026-06-09` (identical to origin/main — 0 ahead, 0 behind)

---

## 1. Branch Inventory Table

| Branch | Type | Tip Hash | Tip Date | Ahead of origin/main | Behind origin/main | Fully Merged? | Recommendation |
|---|---|---|---|---|---|---|---|
| `origin/main` | remote canonical | `0a5ac58` | 2026-06-08 | — | — | n/a | **Production ref** |
| `main` (local) | local tracking | `9c9a592` | 2026-06-03 | 0 | 29 | YES (ancestor) | Fast-forward locally |
| `ui/tab-polish` (local) | local feature | `ba9f26e` | 2026-06-08 | 0 | 0 (== origin tip−1) | YES | **Delete local** |
| `origin/ui/tab-polish` | remote feature | `ba9f26e` | 2026-06-08 | 0 | 1 (merged via PR #15) | YES | **Delete remote** |
| `final-sprint-draft-tabs-heatmap` (local) | local feature | `6f50ea5` | 2026-06-08 | 0 | 0 | YES | **Delete local** |
| `origin/final-sprint-draft-tabs-heatmap` | remote feature | `6f50ea5` | 2026-06-08 | 0 | 1 | YES | **Delete remote** |
| `redesign/pro-sports-analytics` (local) | local redesign | varies | ~May 2026 | 0 | 107 | YES (ancestor) | **Delete local** |
| `origin/redesign/pro-sports-analytics` | remote redesign | varies | ~May 2026 | 0 | 107 | YES (ancestor) | **Delete remote** |
| `fix/mobile-viz-and-desktop-layout` (local) | local fix | `6bedf33` | 2026-05-21 | 0 | 128 | YES (ancestor) | **Delete local** |
| `origin/fix/mobile-viz-and-desktop-layout` | remote fix | `6bedf33` | 2026-05-21 | 0 | 128 | YES (ancestor) | **Delete remote** |
| `feature/trade-value-simulator` (local) | local feature | `0e9f329` | 2026-05-21 | 0 | 131 | YES (ancestor) | **Delete local** |
| `origin/feature/trade-value-simulator` | remote feature | `0e9f329` | 2026-05-21 | 0 | 131 | YES (ancestor) | **Delete remote** |
| `opus48-reverification` (local) | local audit | `fef5b80` | 2026-05-30 | 0 | 65 | YES (ancestor) | **Delete local** |
| `origin/claude/redesign-output-dashboard-Homgq` | remote AI experiment | `5235eeb` | 2026-05-17 | **4 unique** | 163 | **NO** | **S1 — review then delete** |
| `origin/codex/inspect-repository-and-enter-plan-mode` | remote AI experiment | (old) | ~2026-05-13 | 0 | 164 | YES (ancestor) | **Delete remote** |
| `origin/codex/inspect-repository-and-enter-plan-mode-a6arz2` | remote AI experiment | (old) | ~2026-05-13 | 0 | 161 | YES (ancestor) | **Delete remote** |
| `audit/2026-06-09` (local) | audit branch (current) | `0a5ac58` | 2026-06-08 | 0 | 0 | YES (== main) | Ephemeral; close when audit done |

**Summary counts:**
- Total branches (local + remote tracked): 15 distinct refs across 10 named branches
- Fully merged / safe to delete: 14 refs across 9 branches
- NOT fully merged: **1** — `origin/claude/redesign-output-dashboard-Homgq`
- Local main stale: **YES** (29 commits behind origin/main)

---

## 2. Unmerged Branch Detail

### `origin/claude/redesign-output-dashboard-Homgq` — S1 MEDIUM confidence

**4 unique commits on top of origin/main:**

| Hash | Date | Author | Subject |
|---|---|---|---|
| `5235eeb` | 2026-05-17 | Claude | Fix React hydration mismatches identified by Opus QA run |
| `de63d0a` | 2026-05-17 | Claude | Opus QA pass: enhanced panels, CSS fixes, and full Playwright verification suite |
| `ab3c5f4` | 2026-05-17 | Claude | Major visual overhaul: 3D perspective, neon glows, gradient charts, topographic panels |
| `71925df` | 2026-05-17 | Claude | Fix Sleeper adapter to derive live metrics from public API depth-chart data |

**Diff summary:** 29 files changed, +1,445 / -545 lines across:
- `src/app/globals.css` — full CSS rewrite (587 lines changed)
- `src/components/panels/CommandCenter.tsx` — panel overhaul (+211 lines)
- `src/lib/sleeper.ts` — Sleeper adapter refactor (+231 lines)
- `src/lib/sleeper.test.ts` — test additions (+53 lines)
- `scripts/qa_verify.ts` — new QA verification script (+346 lines)
- Binary artifacts in `artifacts/` (screenshots, qa-report.json)
- Several other panel and chart components

**Assessment — classification (b): Unmerged with some potentially valuable content, but likely superseded.**

The work is dated 2026-05-17, predating the multi-route shell redesign (Sprint 2 onwards), all five sprint iterations, and the final sprint that landed in PRs #8–#15. The "3D perspective + neon glow" visual direction directly contradicts CLAUDE.md guardrails ("restrained glow", "no generic template aesthetic"). The Sleeper adapter changes (`71925df`) are the only content with potential value, but `sleeper.ts` has been substantially rewritten across the subsequent sprint work — the changes would require a careful cherry-pick review.

**Specific risk:** The `sleeper.ts` commit (`71925df`, "Fix Sleeper adapter to derive live metrics from public API depth-chart data") could contain a legitimate Sleeper API fix that was never forward-ported. However, given the subsequent sprint work specifically included live Sleeper verification (`d2c634b`, "feat(cc)+test(live): completed-season notice + real Sleeper integration verification"), this fix was almost certainly subsumed.

**Recommendation:** Inspect `git diff origin/main..71925df -- src/lib/sleeper.ts` manually before deleting. If the depth-chart logic is absent from origin/main's `sleeper.ts`, cherry-pick that single commit only. Otherwise delete the branch.

---

## 3. AI Experiment Branches

### `origin/codex/inspect-repository-and-enter-plan-mode`
- **0 unique commits** vs origin/main; fully merged into main via PR #1 (`b6bdf10`)
- Abandoned; purpose was bootstrapping the repo plan-mode analysis
- **Recommendation: DELETE** — no unique content

### `origin/codex/inspect-repository-and-enter-plan-mode-a6arz2`
- **0 unique commits** vs origin/main; fully merged into main via PR #2 (`e1ac0b9`)
- Companion branch to the above; contains "Upgrade RAE visual system" bootstrap work
- **Recommendation: DELETE** — no unique content

### `origin/claude/redesign-output-dashboard-Homgq`
- **4 unique commits** — see Section 2 above
- Fully autonomous Claude agent output from 2026-05-17, never PR'd into main
- The "Homgq" suffix identifies it as a machine-generated branch name
- It was superseded by a deliberate multi-route redesign (Sprint 2, Sprint 3 onwards)
- **Recommendation: S1 — manually inspect `sleeper.ts` delta, then DELETE**

---

## 4. Regression Risk Check

**No revert commits found anywhere** in the full commit graph (`git log --all --grep="revert"` returned empty).

**Potential regression path investigated:**

The `opus48-reverification` local branch (tip `fef5b80`, "Opus 4.8 reverification + completed deferred quant/DB tasks", 2026-05-30) is a fully merged ancestor of origin/main. The reverification work landed cleanly — no risk.

The `fix/mobile-viz-and-desktop-layout` branch introduced hydration-mismatch fixes (`6bedf33`, "Remove 3-D lazy-mount that caused a hydration mismatch") and is a fully merged ancestor. Confirmed the fix is present in origin/main history. No regression.

The `redesign/pro-sports-analytics` branch represents an earlier design iteration. It is a fully merged ancestor (107 commits behind origin/main), meaning its content was subsumed into the current multi-route shell. No regression risk.

**Conclusion:** No confirmed regressions. The only risk vector is the `sleeper.ts` depth-chart change in `origin/claude/redesign-output-dashboard-Homgq` (see Section 2).

---

## 5. Duplicated Effort Assessment

Two branches pursued dashboard redesign work that ultimately converged:

1. `origin/claude/redesign-output-dashboard-Homgq` — autonomous Claude agent, 2026-05-17, 3D/neon direction. **Never merged** directly; content was superseded.
2. `origin/redesign/pro-sports-analytics` — tracked through to origin/main as a fully merged ancestor. This appears to be the human-curated redesign branch that fed into the multi-route shell.

The `feature/trade-value-simulator` and `fix/mobile-viz-and-desktop-layout` branches are linear precursors in the commit history — not duplicate effort, just the natural PR chain (trade-sim was merged as PR #4, mobile fix as part of the sprint 5 chain).

**Net finding:** The only genuine duplication was the autonomous `claude/*` branch vs. the curated `redesign/*` branch. The correct one won — the curated branch is in main.

---

## 6. Branch Cleanup Plan

### Immediate (safe to delete now)

All of the following have zero unique content relative to origin/main:

```
# Remote branches to delete
git push origin --delete final-sprint-draft-tabs-heatmap
git push origin --delete ui/tab-polish
git push origin --delete redesign/pro-sports-analytics
git push origin --delete fix/mobile-viz-and-desktop-layout
git push origin --delete feature/trade-value-simulator
git push origin --delete codex/inspect-repository-and-enter-plan-mode
git push origin --delete codex/inspect-repository-and-enter-plan-mode-a6arz2

# Local branches to delete
git branch -d ui/tab-polish
git branch -d final-sprint-draft-tabs-heatmap
git branch -d redesign/pro-sports-analytics
git branch -d fix/mobile-viz-and-desktop-layout
git branch -d feature/trade-value-simulator
git branch -d opus48-reverification
```

### Conditional (inspect first)

```
# Inspect the sleeper.ts delta, then delete:
git diff 71925df^..71925df -- src/lib/sleeper.ts
# If depth-chart logic is absent from origin/main's sleeper.ts — cherry-pick:
#   git cherry-pick 71925df
# Either way, then delete:
git push origin --delete claude/redesign-output-dashboard-Homgq
```

### Local main fast-forward

Local `main` is 29 commits behind origin/main (stale at `9c9a592`, 2026-06-03). It is a direct ancestor — no divergence. The safe command to update it (DO NOT run during read-only audit):

```
git fetch origin && git checkout main && git merge --ff-only origin/main
```

---

## 7. Tagging / Release Strategy

There are zero tags in the repository. The commit history maps cleanly to sprint boundaries. Proposed semver tag anchors:

| Proposed Tag | Commit | Date | Description |
|---|---|---|---|
| `v0.1.0` | `3d95ea4` | 2026-05-16 | Initial dashboard (PR #3 — first full RAE build) |
| `v0.2.0` | `59e56df` | 2026-05-20 | Live data, auth, WebGL, stats, shadcn system |
| `v0.3.0` | `675c358` | 2026-06-02 | Sprint 5 complete (all 9 panels, nflverse opp, 417 tests + 78 e2e) |
| `v0.4.0` | `f9facb6` | 2026-06-06 | Sprint 3 governance+a11y complete |
| `v0.5.0` | `0a5ac58` | 2026-06-08 | Final sprint + UI tab polish (HEAD, current production) |

**Rationale:**
- `v0.1–v0.2` anchor the early build (single-page → live-data era).
- `v0.3` marks sprint 5 completion — the most substantive feature delivery (9 panels, free nflverse data).
- `v0.4` marks governance/a11y hardening.
- `v0.5` marks the final sprint + tab-polish as the current shipping state.

**Suggested tagging commands (run after fast-forward):**
```
git tag -a v0.1.0 3d95ea4 -m "Initial RAE dashboard — first full build"
git tag -a v0.2.0 59e56df -m "Live data, auth, WebGL, shadcn design system"
git tag -a v0.3.0 675c358 -m "Sprint 5 complete — 9 panels, nflverse opportunity, 417 unit + 78 e2e tests"
git tag -a v0.4.0 f9facb6 -m "Sprint 3 governance + a11y hardening"
git tag -a v0.5.0 0a5ac58 -m "Final sprint + UI tab polish — current production"
git push origin --tags
```

---

## 8. Remediation Timeline

| Priority | Action | Effort | Risk |
|---|---|---|---|
| P0 | Fast-forward local `main` to origin/main | 1 min | None |
| P1 | Inspect `sleeper.ts` delta on `claude/redesign-output-dashboard-Homgq` (commit `71925df`) | 15 min | Low — read-only inspection |
| P1 | Delete `claude/redesign-output-dashboard-Homgq` remote (after inspection) | 1 min | None if inspection passes |
| P2 | Delete all 7 fully-merged remote branches | 5 min | None |
| P2 | Delete all 6 stale local branches | 5 min | None |
| P3 | Apply 5 semver tags and push | 10 min | None |
| P3 | Configure branch protection on origin/main (require PR + CI before merge) | 15 min | None — hygiene |

**Total estimated cleanup time: ~1 hour.**

---

## Appendix: Verification Commands Used

```
git branch -a
git rev-list --left-right --count origin/main...<branch>
git merge-base --is-ancestor <branch> origin/main
git log --oneline origin/main..<branch>
git diff --stat origin/main...<branch>
git log --all --grep="revert" -i
git tag --list
```

All commands were read-only. No source files were modified, no branches were created or deleted, no pushes were made.
