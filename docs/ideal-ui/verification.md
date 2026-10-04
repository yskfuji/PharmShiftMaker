# Verification record — 2026-10-04

All browser fixtures, exported artifacts and screenshots use synthetic people,
facilities and work records. A passing automated row is evidence for that row
only; it is not a WCAG conformance claim, a security proof or a real-user result.

| Check | Result |
|---|---|
| Python unit/API/PostgreSQL regression | Final application source: 1,299 passed and 17 conditional skips; failures 0 |
| Frontend Jest | Final application source: 51 suites, 289 tests and 8 snapshots passed |
| TypeScript | `tsc --noEmit` passed |
| Frontend ESLint | 0 errors and 0 warnings |
| Next.js production build | Node 24.21.0, Next.js 16.3.8, React 19.3; Webpack production build passed |
| Static Storybook | Storybook 10.6.0; offline build passed with 233 v3 stories (52 role-route, 150 route-state, 31 representative) |
| Public API contracts | 31 OpenAPI/Pydantic models match their normalized TypeScript declarations |
| ORM/PostgreSQL ER comparison | 41 business ORM tables and 41 observed business tables; observed PostgreSQL also has the expected `alembic_version` table; semantic difference count 0 |
| U01–U27 complete browser journeys | 243/243 first attempts passed: 27 journeys × Chromium/Firefox/WebKit × 320/768/1440px; retry 0, failed use cases 0, source/contract/build drift 0 |
| U25 destructive privacy journey | 9/9; a dedicated synthetic person was erased, residual entity/revision counts were 0, tombstones remained and reintroduction was rejected |
| U26 restore boundary | Browser journey confirms read-only UI; separate isolated PostgreSQL drill passed all 13 checks, including erasure replay and non-resurrection (`PASS_WITH_STATED_SCOPE`) |
| Existing flag-OFF matrix | 267/267 selected legacy cases passed against the frozen v3 source and production build; retry 0, failed/unexecuted 0, source/build drift 0 |
| Role-route optical matrix | 156/156 role-route tests passed. Each test covered four appearances at 320/768/1440px: 1,872 conditions in total; findings, skips, flaky results and source drift 0 |
| Route-state stories | 25 routes × 6 common states = 150/150 generated stories passed the Chromium 390px presence and semantic-label check. This is not a full optical audit. |
| Static review gallery | 233 synthetic stories × 390/1024/1920px = 699 Chromium images; automated axe and horizontal-overflow findings 0. Representative human review remains pending. |
| Dependency vulnerability audit | Current registry-backed `pip-audit`: 46 Python packages and 0 known vulnerabilities. Current `npm audit`: production and full dependency graphs both 0 findings; lockfile graph 955 packages |
| Dependency license audit | 46 Python distributions and the npm lockfile graph were classified; no unclassified license remained in the recorded reports |
| Independent review | Final re-review: 0 high, 0 medium and 1 low finding. The remaining low finding is limited to the displayed role in the anonymous audit timeline: an inactive membership can still be selected as the actor's current role. It is not used for authorization and does not disclose a name or staff identifier. |

The accepted U01–U27 matrix records exactly one first attempt per case, and the
parent runner verified and removed only the schema it created. A preceding
diagnostic run completed 242/243 cases: WebKit at 320px dropped one Japanese
character sent by the test helper at a 1 ms interval. That run is retained as a
failure and is not counted as a pass. After changing the helper to one deliberate
15 ms keyboard sequence with focus commit, the full 243-case matrix was started
again and passed without retry. U25 additionally records an erasure receipt per
engine and width. U26 deliberately keeps restore execution out of the Web UI;
the separate operational drill covers backup restore, access restriction,
erasure replay and non-resurrection in its stated synthetic scope.

The role-route audit uses the same generated route contract and production
feature components as the workspace. A completed run comprises 156 Playwright
tests, each executing 12 conditions (light, dark, system-light and system-dark
at 320, 768 and 1440px). The separate gallery is a review aid, not an additional
browser matrix or a substitute for assistive-technology and human review.

The build, U01–U27 run and optical audit each froze their executable inputs and
recorded source/build hashes. The only source change after the final production
build and optical audit was the E2E keyboard helper described above; application,
rendering and build inputs remained byte-identical. Failed setup or pre-fix runs
are retained outside the package but are not counted as passes.

The following human and field evaluations remain pending and therefore block
**production adoption**, but do not by themselves block publication of the
source repository with `IDEAL_UI` OFF by default:

- the moderated 30-participant AB/BA evaluation;
- VoiceOver and NVDA sessions using the supplied protocol;
- human 200%/400% zoom and forced-colors sign-off on target platforms;
- production-like field p75 LCP, INP and CLS.

The repository-publication gate additionally requires a clean committed source
tree, a history-free public export, and secret, license and file-size scans of
that exact export. The final independent review is recorded in
`independent-review-v3.md`; exact-export and package results are recorded in the
accompanying manifests rather than inferred from this source-tree report.

`IDEAL_UI` therefore remains OFF by default.
