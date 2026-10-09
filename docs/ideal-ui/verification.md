# Verification record — 2026-10-07

All browser fixtures, exported artifacts and screenshots use synthetic people,
facilities and work records. A passing automated row is evidence for that row
only; it is not a WCAG conformance claim, a security proof or a real-user result.
It is also not a statement that the screens were looked at and found in order:
in the third run the automated audits reported no finding on screens that the
owner of the product then found to look unstyled (see "Visual repair of the
workspace and the fourth formal run" below).

The table gives the results for the final application source after the visual
repair of 2026-10-06 (fourth formal run, 2026-10-07; commit `587e6c34` of the
pull-request branch). Dates in this document are Japan time unless a time is
marked UTC. Where the fourth run changed a figure, the row also keeps the
figure of the third run (2026-10-06), which describes the final source of the
2026-10-05 restructuring, before the visual repair; "Browser verification of
the restructured source" below describes that run and the two before it. A row
that was not run again says so and keeps the earlier figure, which describes an
earlier source. One step of the fourth run failed: `npm audit`, in the
dependency row.

| Check | Result |
|---|---|
| Python unit/API/PostgreSQL regression | Fourth run: 1,558 passed and 17 conditional skips; failures 0, errors 0 (isolated PostgreSQL). Third run, before the visual repair: 1,492 passed and 17 skips. |
| Frontend Jest | Fourth run: 115 suites, 1,052 tests and 8 snapshots passed. Third run, before the visual repair: 104 suites, 932 tests and 8 snapshots. |
| TypeScript | `tsc --noEmit` passed (fourth run). |
| Frontend ESLint | 0 errors and 0 warnings (fourth run). |
| Next.js production build | Node 24.21.0, Next.js 16.3.8, React 19.3; Webpack production build passed, on the workstation and in the Linux container whose build the browser matrices used. |
| Static Storybook | Storybook 10.6.0; offline build passed with 267 v3 stories (52 role-route, 150 route-state, 31 representative and 34 for shared parts). Third run, before the visual repair: 256 v3 stories, of which 23 for shared parts. |
| Public API contracts | 31 OpenAPI/Pydantic models match their normalized TypeScript declarations (fourth run). |
| Structure, contract, diagram and wording tests | Fourth run: 196 passed in eight test files: `tests/test_workspace_v3_structure.py` (every rule and its mutations, now with the stylesheet and link rules described below), `tests/test_workspace_v3_labels.py` (new), the use-case contract, the regenerated ER/state/screen-API/sequence diagrams, the navigation graph and the public-tree policy. Third run, before the visual repair: 130 passed. |
| ORM/PostgreSQL ER comparison | 41 business ORM tables and 41 observed business tables; observed PostgreSQL also has the expected `alembic_version` table; semantic difference count 0. Recorded before the 2026-10-05 restructuring; the observation of PostgreSQL was not re-run on the final commit. |
| U01–U29 complete browser journeys | Fourth run: 261/261 first attempts passed: 29 journeys × Chromium/Firefox/WebKit × 320/768/1440px, real API and one disposable PostgreSQL schema per case; retry 0, source/contract/build drift 0. The audits inside the journeys (369 audits, 123 per engine, each with axe, the optical audit and, new in this run, the structural checks) reported 0 axe violations, 0 optical findings, 0 undetermined checks and 0 structural findings. The third run, before the visual repair, was also 261/261, without the structural checks. |
| U25 and U29 destructive journeys | Part of the matrix above, 9/9 each: U25 erases a dedicated synthetic person, U29 erases planning inputs past their retention; each journey checks the erasure through the API afterwards. |
| U26 restore boundary | The browser journey (read-only UI) is part of the matrix above, 9/9. The separate isolated PostgreSQL drill (13 checks, `PASS_WITH_STATED_SCOPE`) was recorded before the 2026-10-05 restructuring and was not re-run. |
| Established product unchanged | Fourth run: the base commit of the restructuring and the final source were built and photographed under the same conditions: 114 images of the established screens, difference 0, and the same tests pass and fail as on the base (five visual tests fail on both, with the same messages, see below; because of them the visual runner itself exited with status 1 in all nine of its runs, on the base as on the final source). The third run had the same result on its source. |
| Existing flag-OFF matrix | Fourth run: 267/267 selected legacy cases passed against the frozen source and production build; retry 0, failed/unexecuted 0, source/build drift 0. |
| Flag-ON entry | Fourth run: 9/9 cases passed (the entry of `/workspace` with `IDEAL_UI=1`, three widths, three engines). |
| Role-route optical matrix | Fourth run: 156/156 role-route tests passed, in 24 invocations (eight per engine, see "Fourth formal run" below). Each test covers four appearances at 320/768/1440px: 1,872 of 1,872 conditions audited. Optical findings, undetermined checks, structural findings, skips and flaky results 0. Third run, before the visual repair and without the structural checks: 155/156, with 1,862 of 1,872 conditions audited; the one failure was the full-page capture of one Chromium test, a limit of the test environment (its `/tmp` filled up), as established below; a supplementary run of the whole matrix with a larger `/tmp` passed 156/156 with all 1,872 conditions audited and was not counted as the formal result of that run. |
| Route-state stories | Fourth run: 450/450 (150 generated stories, 25 routes × 6 common states, in each of the three engines) passed the presence and semantic-label check at 390px; the two states that show the route's own content (ready and empty, 50 per engine) also passed the structural checks. This is not a full optical audit. Third run: 150/150 in Chromium only, without the structural checks. |
| Representative stories | Fourth run: 75/75 passed (25 stories × 3 engines), 900 conditions, in 12 invocations; optical findings, undetermined checks, structural findings, skips and flaky results 0. Third run: 75/75, without the structural checks. |
| Shared-part stories (new) | Fourth run: 27/27 tests passed (9 per engine), in 9 invocations: the 34 stories of the workspace's shared parts at four appearances and three widths, 408 conditions per engine; optical findings, undetermined checks and structural findings 0. |
| Routes with every task open (new) | Fourth run: 25/25 passed in Chromium; the 50 tests of the other two engines are skipped by design. 50 conditions (25 routes × 320 and 1440px, light theme); across them `<details>` elements were opened 144 times, none stayed closed and no read went unanswered; optical findings, undetermined checks and structural findings 0. No focus check, nothing typed or submitted. |
| Counter-examples of the detectors (new) | Fourth run: 99/99 passed (33 per engine, five spec files): for each failing check a page that has the defect must be reported and its correction must not. |
| Static review gallery | 233 synthetic stories × 390/1024/1920px = 699 Chromium images; automated axe and horizontal-overflow findings 0. Recorded before the 2026-10-05 restructuring; the gallery was not regenerated, and it shows neither the rebuilt nor the repaired screens. Representative human review remains pending. |
| Dependency vulnerability audit | Fourth run: registry-backed `pip-audit` of the 46 locked Python packages: 0 known vulnerabilities. **`npm audit` failed**: both invocations exited with status 1 (production graph, threshold moderate: 2 high advisories; full graph, threshold high: the same 2 high and 21 moderate). Open at the time of this record; the dependency update is tracked separately. See "Fourth formal run" below. Third run (2026-10-05 19:29 UTC), same commands and same lockfile: 0 findings. Update, 2026-10-07: a lockfile-only change (`sharp` 0.35.5, `source-map-js` 1.2.2, `babel-plugin-istanbul` 8.0.2) was merged into the public `main` as pull request #16; both `npm audit` invocations exit 0 locally, and the public CI of that pull request passed, including the job that runs them. The browser matrices were not run on the updated lockfile, and the fourth run's record above is not rewritten. |
| Dependency license audit | 46 Python distributions and the npm lockfile graph were classified; no unclassified license remained in the recorded reports. Recorded before the 2026-10-05 restructuring; not re-run on the final commit. |
| Independent review | Of the state before the restructuring: 0 high, 0 medium and 1 low finding (the displayed role in the anonymous audit timeline; see `independent-review-v3.md`). Of the restructuring: four rounds by a separate reviewing agent, see "Independent review of the restructuring" below; at the end 0 high and 0 medium findings were open. Of the visual repair: three looks at screenshots and four code reviews, all by AI review agents and none by a person, see "Reviews of the repair" below; the last two commits of the repair were not reviewed, and no screenshots were looked at independently after the fourth round. |

The three paragraphs below describe the runs of 2026-10-04, before the
restructuring. They are kept as history and do not describe the table above.

(Recorded before the 2026-10-05 restructuring.) The accepted U01–U27 matrix records exactly one first attempt per case, and the
parent runner verified and removed only the schema it created. A preceding
diagnostic run completed 242/243 cases: WebKit at 320px dropped one Japanese
character sent by the test helper at a 1 ms interval. That run is retained as a
failure and is not counted as a pass. After changing the helper to one deliberate
15 ms keyboard sequence with focus commit, the full 243-case matrix was started
again and passed without retry. U25 additionally records an erasure receipt per
engine and width. U26 deliberately keeps restore execution out of the Web UI;
the separate operational drill covers backup restore, access restriction,
erasure replay and non-resurrection in its stated synthetic scope.

(Recorded before the 2026-10-05 restructuring.) The role-route audit uses the same generated route contract and production
feature components as the workspace. A completed run comprises 156 Playwright
tests, each executing 12 conditions (light, dark, system-light and system-dark
at 320, 768 and 1440px). The separate gallery is a review aid, not an additional
browser matrix or a substitute for assistive-technology and human review.

(Recorded before the 2026-10-05 restructuring.) The build, U01–U27 run and optical audit each froze their executable inputs and
recorded source/build hashes. The only source change after the final production
build and optical audit was the E2E keyboard helper described above; application,
rendering and build inputs remained byte-identical. Failed setup or pre-fix runs
are retained outside the package but are not counted as passes.

## Structural independence from the established screens

Status: **enforced by `tests/test_workspace_v3_structure.py`** since the
restructuring of 2026-10-05. The inspection of 2026-10-04 below is kept as
history. The structure test is evidence about the source only; the browser
evidence for the restructured source and the independent review are in the
two sections "Browser verification of the restructured source" and
"Independent review of the restructuring" below. Those two sections describe
the first three formal runs. The visual repair that followed, the fourth formal
run and what the first three runs did not show are in "Visual repair of the
workspace and the fourth formal run".

### What the inspection of 2026-10-04 found (history)

The v3 design requires each of the 25 workspace routes to be a purpose-built
screen. It must not show an established screen inside the new shell, whether
through an iframe, a wrapper, a conditional branch or a renamed component. A
search of `frontend/src/features/workspace` and `frontend/src/app/workspace` for
the established component names (`LegacyFeature`, `PlanningWorkspace`,
`PlanningRequests`, `CompliancePanel`, `ActualWorkflow`, `FlexAdoptionSettings`)
found nothing. That search was not sufficient: the v3 restructuring had moved
those implementations under `features/workspace`, renamed them, and left a
re-export at the established path. Each was therefore compared, line by line,
with the last revision before that restructuring (that revision is not part of
the public history). The percentage is the share of the earlier component's
non-blank, non-import, non-comment lines that appeared unchanged in the module
as it was on 2026-10-04.

| Established component | Module on 2026-10-04 | Unchanged lines | Rendered by the workspace on 2026-10-04 |
|---|---|---|---|
| `CompliancePanel` | `shared/ComplianceWorkspace` | 73% | `requests/leave`, `requests/outside`, `people/contracts`, `governance/privacy` |
| `ActualWorkflow` | `governance/ActualReconciliation` | 98% | `governance/actuals` |
| `FlexAdoptionSettings` | `settings/FlexTimeSettings` | 100% | `settings/flextime` |
| `PlanningWorkspace` | `planning/PlanningStudio` | 98% | Not rendered; established `/planning` only |
| `PlanningRequests` | `requests/LeaveRequestWorkspace` | 16% | `requests/leave`; treated as rewritten, shared with the established `/requests` route |

Findings of that inspection:

- The inspection reported six routes that showed a carried-over established
  implementation through `frontend/src/ideal/screens/live/IntegratedFeatureView.tsx`.
  The count was one short: there were seven such embeddings. The seventh was the
  required-staffing editor of `plan/input`, which rendered the established
  `ContractWorkflow` with `group="demand"`. One module, `ComplianceWorkspace`,
  served four routes by switching on a `section` value.
- Four components under `features/workspace` linked to established URLs
  (`/planning`, `/planning/workflows/…`, `/settings`) rather than to a workspace
  route: `people/ContractWorkflow`, `people/NewStaffTaskList`,
  `planning/WorkflowNavigation` and `settings/FlexTimeSettings`.
- Thirty of the 33 component files under `features/workspace` were Client
  Components, and the route content was selected inside a Client Component. The
  route pages and the shell were Server Components.
- From `frontend/src/app/workspace` nine screen modules under `ideal/screens`
  were reached; all routes other than home and schedule were selected by one
  Client Component, `IntegratedFeatureView`; seven
  `features/workspace/<purpose>/index.ts` files re-exported an `ideal/screens`
  screen under a purpose name; two compatibility re-exports at established paths
  were reached (`components/ContextLink`, `components/PublicationExport`); and the
  shared link component accepted `/dashboard`, `/planning` and `/settings` as
  destinations.
- `components/ideal/IdealWorkspace`, the earlier monolithic workspace, was not
  reached. Storybook and the routes reached the same screen modules.

The U01–U27 journeys and the optical matrix in the table above were recorded
against those screens. They showed that the routes worked, not that the routes
were purpose-built.

### What was done

- Each of the 25 routes of `docs/ideal-ui/usecases.json` has one definition,
  `features/workspace/<purpose>/<view>/route.ts`: its own read boundary on the
  server and its own view (a Server Component), with Client Components only for
  the parts that are operated. Not every route reads from the API for itself:
  `settings/appearance` reads nothing, and `plan/publications` and
  `settings/notifications` show what the mandatory context (who is signed in,
  the scope, the publications and the viewer's notifications) has already read.
  The other 22 routes read their own data in their definition. `features/workspace/shell/routes.ts` registers them under a type that
  requires exactly one definition per route key. `/workspace/<screen>` and
  `/workspace/<screen>/<view>` delegate only to the per-route pipeline; the
  earlier pipeline (the client-side provider, `WorkspaceContent` and the server
  read `loadInitialWorkspace`) is removed from the workspace and from its
  Storybook showcase.
- Seven screens were rebuilt instead of carried over: the required-staffing
  editor of `plan/input`, `requests/leave`, `requests/outside`,
  `people/contracts`, `governance/actuals`, `settings/flextime` and
  `governance/privacy`.
- The other 18 routes were not rebuilt: they were moved. Their code was split
  out of the v3-era modules under `ideal/screens` into `features/workspace`.
  Because `/preview` and `/showcase` are kept as a v1/v2 compatibility showcase,
  the earlier copies remain under `ideal/screens`. That screen code therefore
  exists twice and is maintained separately.
- The publication export control of `schedule` and `plan/publications` was
  first carried over: `shared/ExportPublication` was a reformatted copy of the
  established `PublicationExport` (the same statements in the same order under
  other names). The independent review found this, and the control was then
  rebuilt as a protocol adapter (`shared/api.ts`, `shared/publicationExport.ts`)
  and an island on the workspace runtime. The measured figures are in "What the
  structure test cannot detect" below.
- `/workspace` has its own `not-found.tsx` and `error.tsx`, which use workspace
  parts only. Before, an unknown workspace URL and a failed workspace route were
  shown by the application's root pages, which belong to the established product.
- Two capabilities were added as use cases: U28 (the person's own half-day and
  hourly leave claim) and U29 (erasure of planning inputs past their retention).
  The contract now has 29 use cases on the same 25 routes.
- The server reads gained fields, all additive: `allowed_next` and
  `result_reference_required` on privacy cases; `settlement_starts` and `actions`
  on flex adoptions and enrolments; `actions.change` on outside declarations;
  `reviewed` on listed actuals; `applicable_cases` on subject controls;
  `will_process` on each target of a copy preview, a copy inventory and a
  subject control's inventory, and `targets` (copy and `will_process`) on the
  subject-erasure plan; and the new read endpoint
  `GET /planning/compliance/erasure-candidates` with `erasable` on the erasure
  preview.
- Links between workspace routes are built by
  `features/workspace/shell/WorkspaceLink`: the destination is a route path of the
  generated contract, there is no free `href` and no return URL, and only the
  scope, period, publication, change case and person travel with it (a planning
  route may also name an input version and plans). Corrected on 2026-10-07: the
  person travels only to the five routes that look at one (`PERSON_ROUTES` in
  `shell/workspaceHref.ts`: the four people screens and the privacy-purpose
  route, the routes whose definition declares `names: "roster"` or
  `"privacy"`; the structure test keeps the two lists equal). A link to any
  other route carries no person, named or inherited, so the frame's links to
  the schedule, the plan or the settings drop it. On the four routes that
  narrow to the person (account links, onboarding and offboarding, contracts
  and qualifications, personal data) a band (`shared/SelectedPersonBand`)
  names the person, says that the signed-in account is unchanged, and leads
  to the same route without the person (`person: null`, a plain anchor).
  This correction was verified partially: Jest, the type check, the lint, the
  static structure rules and the local Storybook detectors; the browser
  journeys of the formal run (U09, U20, U25) were not run again on it.
- The established product's implementations were moved out of
  `features/workspace`: 30 files, of which 28 went back to
  `frontend/src/components` and two, used only by the v1/v2 showcase
  (`PlanningRouteViews` and `WorkspaceContent`), to `ideal/screens/live`. These
  30 files are identical to the base commit of this work (the last commit
  before the restructuring of 2026-10-05) except for import lines. They are not
  identical to the pre-v3 components: the inspection table above gives the
  share of unchanged lines for five of them. The adapter wrapper
  `.ideal-v3-purpose` was removed from the three planning views that still had
  it.
- `/preview` and `/showcase` are kept as a v1/v2 compatibility showcase. They
  render the earlier monolithic `IdealWorkspace` and the screens under
  `ideal/screens`, share no screen with `/workspace`, and are not v3 evidence.

### Browser verification of the restructured source

Rules set before the first run: each matrix runs once on the final application
source, without retries; a matrix that fails is recorded as failed and is not
repeated on the same source; a fix makes a new source, on which everything runs
again from the start. The runners freeze the hashes of the executable sources
and of the build, and report drift. All browsers are the Chromium, Firefox and
WebKit of Playwright 1.56.1 in a Linux container. The journeys use the real API
and one disposable PostgreSQL schema per engine and width; the Storybook
matrices and the comparison below use fixed synthetic data.

There were three formal runs, each on a different source. (Added 2026-10-07: a
fourth formal run followed the visual repair, on a fourth source; it is
described in "Fourth formal run" below and is not part of this list. In this
section and the next, "the final source" means the final source of the
restructuring, the source of the third run.)

1. First candidate (2026-10-05). The comparison with the base passed. The
   journeys failed: 245/261 (Chromium 87/87, Firefox 81/87, WebKit 77/87). Two
   causes, both introduced by the restructuring. (a) After a save the route was
   read again with `router.refresh()`; when a document navigation started while
   that read was under way, Firefox and WebKit failed the request and the router
   answered by navigating to the current address, which cancelled the navigation
   (12 cases: U05 and U07). (b) In WebKit a chosen option longer than its
   `select`, and a disclosure that was a grid item, widened the page (4 cases:
   U20, U21, U29 at 320 or 768px). The run stopped there. Fixes: the read is now
   a Server Action that only asks for the route to be rendered again, and two
   CSS rules; U05 gained two "navigate while the read is under way" cases.
2. Second candidate (2026-10-05). Comparison with the base passed; journeys
   261/261; flag-OFF 267/267; flag-ON entry 9/9; route-state stories 150/150;
   representative stories 75/75 (900 conditions); Jest, type check, lint,
   builds, contracts and the full Python suite (1,479 passed, 17 skipped)
   passed. The role-route matrix ended at 155/156: in Chromium the full-page
   evidence screenshot of one story (`people/contracts`, administrator, light,
   1440px) failed with a browser protocol error ("Unable to capture
   screenshot") after two of its twelve conditions had been audited without a
   finding. It was not an optical finding; the same story passed in Firefox and
   WebKit, and the same route passed in Chromium in the representative matrix.
   Under the rules the result stays 155/156 and the matrix was not repeated.
   A separate diagnostic ran that one story three times in Chromium (3/3
   passed); it is not counted. The cause was found after run 3, see below.
3. Final source (2026-10-06). The independent review of the fixes of run 1 found
   that a read of the route that got no answer was reported nowhere (see the
   next section). The correction changed the application, so everything ran
   again from the start on the new source. Comparison with the base passed (114 images, difference 0); journeys 261/261; flag-OFF 267/267; flag-ON entry 9/9; route-state stories 150/150; representative stories 75/75 (900 conditions); Jest (104 suites, 932 tests), type check, lint, builds, contracts and the full Python suite (1,492 passed, 17 skipped) passed. The role-route matrix again ended at 155/156, with 1,862 of 1,872 conditions audited and no optical finding: the same Chromium test failed at the same capture as in run 2. It was not repeated.

The one role-route failure of runs 2 and 3 is a limit of the test environment,
not a finding about the workspace. It was the same test in both runs: the 36th
of the Chromium project, at the same capture. The role-route configuration
records a trace for every test (`trace: 'retain-on-failure'`), the browser
server keeps those records in the container's `/tmp` for as long as a worker's
browser connection lasts, and one worker runs the 52 tests of a project over one
connection. The container's `/tmp` was a 512MiB tmpfs; the Chromium project needs
about 700MiB, and the limit was reached during the 36th test, where the
full-page capture then failed. Diagnostic runs of the Chromium project (52
tests, not counted) in separate containers established this: a new container
configured like the first failed at the same test (51/52, `/tmp` at 489MiB of
512MiB when it failed); one with `--init` and 2GB of shared memory failed the
same way (51/52; shared memory stayed unused); one that differed only in a 2GB
`/tmp` passed (52/52, `/tmp` peaking at 702MiB). Terminated processes that the
container's init process does not reap had accumulated and were suspected
first; they were not the cause. Earlier records of this matrix ran the
Chromium project in four parts, which stays below the limit. How the full
`/tmp` leads to the failed capture inside Chromium was not examined.

A supplementary run then repeated the whole role-route matrix once, on the final source, in a container that differed from the formal one only in a 2GB `/tmp`: 156/156, all 1,872 conditions audited, optical findings and undetermined checks 0, no retry. It did not go through the formal runner (which is bound to the first container), so the source hashes were computed with the runner's own function before and after and were equal to those of the build. It is recorded as supplementary and does not replace the formal 155/156. It also showed that every engine needs more than 512MiB there (Chromium 691MiB, Firefox 914MiB, WebKit 638MiB), although Firefox and WebKit passed 52/52 in the formal runs; what happened in those two engines when `/tmp` was full was not examined, so their formal results stand on the audits, which completed for all their conditions.

How "established product unchanged" was checked. The committed baseline images
of the established product date from 2026-09-30 and no longer match it (the
product name changed since), and the visual runner's PostgreSQL mode names a
container that does not exist in this environment. So the base commit of this
work and the final source were built side by side and photographed under the
same conditions with the runner's SQLite synthetic fixture: 114 images of the
established screens (19 subjects, three widths, light and dark, Chromium).
Acceptance was a difference of 0 images and the same passing and failing tests
as the base. Five visual tests fail on the base for reasons that predate this
work and fail identically on the final source; they count neither as a pass nor
as a failure of this work: the text-spacing check of the sign-in page, the
established planning flow, and the three tests of the v1/v2 showcase and
`/preview`. Images taken without the runner's stabilisation differ between two
runs of the same source by the same small amounts (nine pixels at a focus
corner; an image height that depends on the moment of capture) and were not
used for the decision.

The 48 entry images of the workspace (`ideal-workspace-admin-*`) were
regenerated for the restructured workspace and withdrawn on the same day
(`docs/design-system/baseline-log.md`): the workspace now takes "today" from
the server, so three of its screens depend on the day of capture, and the audit
timeline of the fixture does not order two simultaneous events stably. The
committed 48 images therefore still show the earlier structure, and the test
that compares them (`frontend/tests/visual/ideal.pw.ts`) is not part of the
evidence. The workspace is checked visually by the Storybook matrices (fixed
synthetic data) and by the optical audit at the end of every journey.

Correction, 2026-10-07: "checked visually" in the sentence above overstated
what those checks do. They measure contrast, focus indicators, target size,
overflow at 320px and text spacing, and the journeys add axe. They do not judge
how a screen looks, and until the visual repair the Storybook matrices judged
nothing inside a closed `<details>`. In the third run none of them reported a
finding on the screens that the owner of the product then reported as looking
unstyled. See "What the owner saw, and what the earlier record did not show"
below.

Not verified in a browser: Safari and Firefox on macOS (all runs used the Linux
builds of the engines); the operations that only Jest covers, namely five tasks
of `governance/privacy` (registering an external copy, confirming a processor's
handling, the preservation decision, the joint erasure decision and reconciling
an operator reference; the fixture has no shared or external copy), some
administrator forms of `requests/leave`, ten of the fourteen record editors of
`people/contracts` and the enrolment forms of `settings/flextime`.

Added 2026-10-07: this list still holds after the fourth run. The new matrix
that opens every task renders these forms in Chromium and audits them as they
stand when opened, but it types nothing and submits nothing, so the operations
themselves remain covered by Jest only.

### Independent review of the restructuring

Each round was done by a separate reviewing agent that was given the diff and
the files, not the author's reasoning, and that could not change the source. It
is not a review by a person.

| Round | Subject | Findings | Outcome |
|---|---|---|---|
| 1 | The whole restructuring | High 2, both in documents (results recorded before the restructuring were stated as final); Medium 12 | All corrected. Among the Medium findings: the export control was a reformatted copy of the established one (rebuilt, see the table of token runs below); a route the role may not open read the roster before refusing; the people list sent records to the browser that the screen does not show; `/workspace` used the established not-found and error pages; the erasure confirmation divided its targets by inference in the browser (the server now says which targets it will process) |
| 2 | The corrections of round 1 | Medium 3 (the erasure plan could be executed before its copies were read again; a per-person tally used a plain object keyed by `person_id`; the acceptance matrix still showed earlier results as passed); Low 8 | All corrected |
| 3 | The corrections after the first formal run, including the Server Action | High 0; Medium 1 (a read of the route that got no answer was swallowed whatever the reason); Low 4 | The Medium finding and the gaps of the structure rule were corrected; the other Low findings are in "Known limits" |
| 4 | That correction, with two follow-ups | Medium 2 (after an answered first read a failed second read was still not reported; the notice spoke of a save although the route is also read again after a refused one); Low 7. First follow-up: the first Medium finding was not resolved for the order in which the framework really sends the requests. Second follow-up: resolved; High 0, Medium 0, Low 1 | Corrected; the last Low finding and the notes are in "Known limits" |

Round 3 also answered whether the Server Action is a way to workspace data for
someone who is not signed in or for another origin. Its answer, from reading
the application and the framework's source and not from requests sent to a
running server: no. The action takes no argument, reads nothing and returns
nothing; what comes back is the route rendered for the caller's own cookies,
which is what a GET of the same address returns; the proxy sends a caller
without a session cookie to the sign-in page; the framework refuses an action
whose `Origin` does not match the forwarded host; and the answer is not
cacheable.

### What the structure test enforces

`tests/test_workspace_v3_structure.py` resolves relative imports, the `@/`
alias and bare specifiers that the tsconfig `baseUrl` (`./src`) resolves
(`components/X`, `ideal/screens/X`). The import graph starts from every file
under `frontend/src/app/workspace` (the pages, the layout, `not-found.tsx` and
`error.tsx`) and from the Storybook showcase. The test fails when any of the
following is found. Each rule has at least one mutation in
the same file that is applied in memory and must make the rule fail.

- A transitive import of an established module: anything under `ideal/screens`,
  under `components/` (other than `components/ui`, the theme toggle and the
  sign-in identity provider), under `app/` outside `app/workspace`, or of the
  earlier pipeline (the earlier providers, their model conversion and their
  synthetic data).
- A link or navigation to an established URL (`/dashboard`, `/planning`,
  `/settings`, `/requests`, `/schedule`, `/preview`, `/showcase`), or a literal
  `/workspace…` URL outside the shell.
- A route of the contract without exactly one `route.ts` in the directory of its
  key, a definition beside the contract, a key that does not match its
  directory, a registry that is not total, or a view that is a Client Component
  or `async`.
- A module with `"use client"` that reaches `shell/server` at run time.
- A Server Action of the workspace that is more than a request to render the
  current route again. The workspace has one, `shell/actions/refreshRoute`.
  A module under `shell/actions` must be, comments apart, the `"use server"`
  directive, `import { refresh } from "next/cache"` and functions without
  parameters and without a result whose whole body is `refresh();`. The test
  also fails when the directive appears in any other module that a workspace
  URL or the showcase can load, or when a Client Component reaches the action
  by an import, directly or through another module (the server-rendered route
  hands it over as a prop).
- A screen module that the showcase reaches and the routes do not, or the
  reverse.
- A render of a cross-purpose established screen (`ComplianceWorkspace`,
  `ContractWorkflow`, `ActualReconciliation`, `FlexTimeSettings`,
  `LeaveRequestWorkspace`, `PlanningStudio`, under these or their established
  names) or of the established export control, or a class name that is not the
  workspace's own
  (`ideal-v3-purpose`, `workflow-*`, `ui-*` and utility classes; `sr-only` is
  the exception).
- An import of an established component or of an `ideal/screens` module by any
  file under `features/workspace`, tests included; a source file under
  `features/workspace` that no workspace route or showcase loads; or a
  re-export of a workspace module at an established path other than the shared
  unsaved-changes guard.
- `/preview` or `/showcase` no longer stating that it is a v1/v2 compatibility
  route, or the workspace reaching `IdealWorkspace`.
- `app/workspace` without its own `not-found.tsx` or `error.tsx`, or an
  `error.tsx` that is not a Client Component.
- A README that states the earlier gap, or that does not state what is enforced.

The reach of the test is the imports from `app/workspace`. The root layout
(`app/layout.tsx`) wraps every page of the application, the workspace's
included. Its session plumbing (the identity provider and boundary, the session
controls, the route focus, the unsaved-navigation boundary and the navigation
flags) is shared with the established product and is outside the test's reach.

### What the structure test cannot detect

It does not measure similarity, so it cannot detect an established screen that
is copied under another name. That needs a reviewer's comparison. Line-level
identity alone cannot detect a reformatted copy, so the comparison uses token
runs as well: a file is split into identifiers, numbers, runs of non-ASCII
text and single punctuation characters (the three quote characters count as
one), and the figure is the share of the established file's runs of 12
consecutive tokens that occur in the new files.

The rebuild work measured the share of each established component's non-blank,
non-import, non-comment lines that appear unchanged in the rebuilt screen:

| Rebuilt screen | Compared with | Unchanged lines |
|---|---|---|
| Required-staffing editor of `plan/input` | `ContractWorkflow` | 1.0% |
| `requests/leave` and `requests/outside` | the eight established components they replace | 1.3–5.3% per component |
| `people/contracts` | four established components | 0.9% |
| `governance/actuals` | the two established components it replaces | 9.1% and 7.1% |
| `settings/flextime` | the two established components it replaces | 8.0% and 12.8% |
| `governance/privacy` | the established implementation it replaces | 0 of 245 lines |
| Publication export control, as first carried over | `PublicationExport` | 4 of 38 lines; 38.6% of its 998 12-token runs |
| Publication export control, rebuilt | `PublicationExport` | 4 of 38 lines; 9.4% of its 998 12-token runs |

For actuals and flextime the unchanged lines are mostly closing brackets; the
lines that build a request payload are identical on purpose, because the API is
the same. For the export control the four lines are closing brackets and the
closing tag in both versions, which is why the line figure did not show that
the first version was a reformatted copy; the token-run figure did. In the
rebuilt control the 94 remaining runs are the options of the request that
returns the file (method, credentials, cache and content type: 37 runs), the
SHA-256 digest written as hexadecimal (19), the props of the component, which
its two callers pass (14), the two response headers that are read (11), the
extension of the file name (7), the type of the registered artifact (4) and two
single runs. It sends the same two requests on purpose. The token-run figures
were measured for the export control only. All figures in this table were
measured by the rebuild work and have not been repeated by an independent
reviewer.

The test also does not show that a screen works, is usable or is accessible.
Class names chosen through a lookup table are not read by the class-name rule.

Added 2026-10-07: nor does it show that a screen looks finished. The rules
added to the same file during the visual repair (a stylesheet rule for every
class, the scope and the scale of the workspace's stylesheets, no value read by
a Server Component from a client module, links only to declared transitions)
and what each of them cannot see are described in "Checks added by the repair"
below.

### Known limits found in review and not changed

- `GET /planning/compliance/erasure-candidates` recomputes the inventory for
  every planning input of the scope on each read.
- A paid-leave claim is not checked against the leave policy when it is sent.
  At that time the server checks only the form of the claim and that the grant
  is the person's own. The units offered on screen come from the policy the
  server returned, and the ledger reconciliation finds an inconsistency when
  the claim is reviewed and applied to the plan. The screen says so.
- After a change the route is read again by a Server Action. When the server
  answers but cannot read the route, the route's read problem is shown in place
  of the route, the success message included. When the request gets no answer,
  the route stays as it was and an alert above it says that the content was not
  read again, with a button that loads the document. Limits of that alert:
  - A request that never settles reports nothing, and the operation that waits
    for it stays busy; there is no time limit. The same holds for a failed
    request that is followed by one that never settles.
  - A request that fails within 1.5 seconds after the document began to leave
    is taken for the browser cancelling the page's requests and is not
    reported. If the user then stops that navigation, the page stays as it was
    without the alert. Where a browser does not fire `beforeunload`, the alert
    can appear on a page that is leaving.
  - When a navigation inside the workspace brings another read while a request
    is under way and that request fails, the alert is shown although that read
    is usually newer than the change.
  - The alert is brought into view once without moving the focus, so the page
    jumps to its top, also when a conflict was just shown further down.
  - A reverse proxy in front of the frontend has to forward the host the browser
    used, as `Host` or `X-Forwarded-Host`, with the port when it is not the
    default. The framework refuses a Server Action whose `Origin` host differs
    from it (unless it is listed in `serverActions.allowedOrigins`); every read of
    this kind then fails and the alert appears after every save. The default of
    nginx, `Host: $proxy_host`, does not forward it.
- Firefox and WebKit: after a save, a click on a link of the shell's navigation
  while the read is under way, followed at once by a document navigation (the
  scope form, sign-out, a plain link), can still end on the page being left.
  The framework reads the route again by itself after a Server Action that a
  navigation displaced, and that read has the fallback the Server Action was
  introduced to avoid. The path was identified while correcting the first
  formal run and again from the framework's source in review round 3; no
  journey covers it. The two U05 cases that guard the corrected behaviour start a
  document navigation directly, and they are meaningful only in Firefox and
  WebKit: Chromium keeps a page's requests until the new document commits, so
  it passed before the correction as well.
- `.ideal-v3-app select { contain: paint; }` makes every `select` of the
  workspace a stacking context. The focus ring of a control less than six
  pixels away could be painted under a neighbouring `select`; no audit reported
  it, and it was not looked for by eye.
- An identifier named in a workspace URL (`publication`, `case`, `person`) must
  begin with a letter or a digit, so that a value can never be `.` or `..` in a
  request path. The backend does not restrict the characters of a `person_id`:
  a person, case or publication whose identifier begins with `_`, `-`, `.` or
  `:` cannot be selected through the URL (the address is refused with 422),
  and a link of the workspace that carries such an identifier leads to that
  refusal.
- A person whose identifier is exactly `__proto__` is shown by that identifier
  instead of a name in the parts of the workspace that run in the browser:
  React omits a property of that name when it hands the server's names to the
  browser. Nothing is mis-attributed, and the server-side reads are unaffected.

Added 2026-10-07: the limits found during the visual repair and the fourth
formal run are listed in "Known limits found in the repair and not changed"
below. The limits above were not changed by the repair.

### Conditions for describing the workspace as independent

- No transitive dependency from the workspace on an established screen
  implementation, and no business navigation from it to an established URL:
  enforced by the structure test.
- Each of the 25 routes has its own view and its own data-read boundary, with no
  route-wide switch and no form serving several purposes: enforced by the
  structure test for the structure; the line comparison above covers renamed
  copies.
- Storybook and the real-API screens use the same views and differ only in the
  data adapter: enforced by the structure test.
- With `IDEAL_UI` OFF the established URLs and screens are retained, and with it
  ON nothing falls back to an established screen: the second half is enforced by
  the structure test; the flag-OFF regression passed (267/267), and the
  established screens were photographed unchanged against the base.
- All use cases pass as complete journeys through the real API and an isolated
  PostgreSQL, and the flag-OFF regression, authorization, conflict, idempotency,
  erasure, role-route and optical checks pass without retry: journeys 261/261,
  flag-OFF 267/267, role-route 155/156 on the final source, each in
  one attempt; see "Browser verification of the restructured source" for the
  two runs before it and for what was not verified. (Added 2026-10-07: "the
  final source" here is that of the third run. On the final source after the
  visual repair the fourth run had journeys 261/261, flag-OFF 267/267 and
  role-route 156/156, each in one attempt, and its `npm audit` step failed; see
  "Fourth formal run".)
- The ER, state, screen/API and sequence diagrams regenerate from the
  implementation, and routes, roles, states, transitions and test identifiers
  are generated from `usecases.json` rather than edited by hand: checked by
  `tests/test_er_fresh.py`, `tests/test_ideal_usecase_contract.py` and
  `tests/test_navigation_graph.py`.

## Visual repair of the workspace and the fourth formal run

Status: **repaired on the pull-request branch; the fourth formal run was made
once on the final source (commit `587e6c34`); one step of that run, `npm audit`,
failed and is open.** The repair changes how the 25 workspace routes look and
how each screen is arranged. Every review named in this section was made by an
AI review agent that was given artefacts (screenshots, or a diff and the
files), not by a person. This record contains no assessment of the repaired
screens by a person.

### What the owner saw, and what the earlier record did not show

After the third formal run the owner of the product looked at the workspace and
reported that parts of the screens looked unstyled, "like text typed into a word
processor", beginning with the four people routes (`people/directory`,
`people/memberships`, `people/lifecycle` and `people/contracts`). No automated
audit of the third run had reported a finding on those routes. (The one failed
test of that run was on `people/contracts`, and it was a failed capture, not a
finding.)

Before anything was changed, an AI agent of the repair work looked at
screenshots of all 25 routes (light theme at 1440 and 320px; dark at 1440px for
seven routes). Among the things it reported:

- buttons whose label wrapped one character per line (`people/lifecycle`);
- headings at body weight, and tables without a frame or a header fill;
- 16px text beside tables and notes of 12–13px in the same panel;
- values shown as the server wrote them: enumeration codes such as
  `AWAITING_CONSENT` and `LEADER`, and ISO 8601 timestamps;
- the button that cancels a publication, shown as plain text.

It graded the routes D (broken) 1, C (looks unfinished) 8, B (rough spots) 16
and A 0. The D was `people/lifecycle`. The grades are that agent's own scale
for the look of a screen; they are not a usability result.

The cause in the code had two parts. The workspace wrote class names for which
no stylesheet had a rule: six were found (`ideal-button--danger`,
`ideal-confirm`, `ideal-field-label`, `ideal-partial-problems`,
`ideal-case-summary` and `ideal-v3-case-decision`), and their elements kept the
defaults of the browser reset. And elements relied on rules that the shared
stylesheet scopes to another frame of the product and that therefore do not
apply inside the workspace: the stepper of the planning routes, for example,
got its five columns only under `.ideal-app`.

Why the audits had not reported any of this. The optical audit measures text
and non-text contrast, focus indicators, 24px targets, overflow at 320px and
text spacing; the journeys add axe. None of these judges whether a layout is
well formed, whether the text sizes follow one scale, whether related things
are grouped, or whether a heading agrees with what stands under it. What is
inside a closed `<details>` is not rendered, and the workspace keeps its forms
inside closed `<details>`, so a form was audited only where a journey opened
it. The workspace was not compared with baseline images either (they were
withdrawn, see above).

Limit of the earlier record, stated plainly: wherever this document, the
acceptance matrix, the README or the changelog says of the first three runs
that the optical audit had zero findings, or that the role-route, state or
representative matrix passed, it means that the measured conditions passed. It
did not mean that anyone had looked at the screens, and it was not evidence
that they looked finished.

### What was changed

The owner set the scope: all 25 routes; the look and the arrangement inside
each screen; no new route and no change to the API or to a business rule.

- **Backend:** unchanged. The diff of `src/` between the source of the third
  formal run and the final source is empty.
- **Routes and use cases:** still 25 routes and 29 use cases; no route was
  added or removed and no route's roles changed. In the use-case contract the
  short label or the description of 15 routes was reworded, and 10 transitions
  were added to 7 use cases for links that the screens have (see the link rule
  below). The API client modules (`frontend/src/ideal/api`, `frontend/src/lib`)
  are unchanged.
- **Stylesheets:** a new set, `frontend/src/styles/workspace/*.css` (11 files),
  loaded by the workspace layout and by Storybook only. `scale.css` defines
  five text sizes, two weights and one measure; `primitives.css` gives
  headings, facts, tables, buttons, links, callouts, pills and disclosures
  their look; the other files lay out the shell and one purpose each. Every
  selector starts with `.ideal-v3-app`, the workspace's frame. In the shared
  `globals.css` only rules of the workspace's shell (`.ideal-v3-…`) were
  changed.
- **Shared parts** under `frontend/src/features/workspace/shared/`: a task
  (a `<details>`) now declares a tone (primary, routine, information only, or
  cannot be undone), a one-line hint and, required for a task that cannot be
  undone, a tag in words, so that the tone is not told by colour alone; a
  button that leads from a count in a header to the task that answers it
  (`TaskJump`) and buttons to the sections of a long route (`SectionNav`); a
  line above a table that says which columns run on, only while they do
  (`TableScrollCue`); dates that are not broken inside themselves (`DateText`)
  and names joined by a slash that break between the names (`SoftBreaks`);
  short fields side by side (`FieldRow`); one form for identifiers
  (`Identifiers`); a sentence under a button that cannot be pressed yet
  (`WhyDisabled`); and `format.ts` and `labels.ts`, which word a code or a time
  for a reader and show a code they do not know as 「未対応の値」 instead of
  the code.
- **Screens:** all 25 routes were reworked, in four rounds; the reviews made
  after each round are listed below. The planning routes lost their second, in-view stepper
  (the shell's process navigation is the only one). The month table of the
  schedule is now shown from 601px (before: from 1181px); below that the day
  view is shown.
- **Size of the change:** 116 commits and 250 files between the commit that
  recorded the third run in these documents and the final source, 202 of the
  files under `frontend/src/features/workspace` (48 of those are tests and
  fixtures). Between the source of the third run and that commit only documents
  and a secret-scan allowlist had changed.

What is more than look and arrangement: the links the screens gained (for
example from a count to what it counts, and from a notice to the schedule it
names), the width at which the month table appears, and the corrections of
behaviour listed under "Defects found during the repair". Request bodies,
idempotency keys and expected-version fields were reported unchanged by code
reviews 3 and 4 for the ranges they read (rounds 3 and 4); the correction of
the draft re-check, made after code review 4, deliberately changes which
version that request names. For rounds 1 and 2 this record has no such
statement, because the notes of code reviews 1 and 2 were not kept.

### Checks added by the repair

The aim was that the class of defect the owner saw now fails a test. The checks
report computed facts. They do not judge whether a screen is usable or well
composed.

**Structural checks in the browser** (`frontend/tests/visual/lib/structure.ts`),
one read-only evaluation of the rendered workspace frame. A report of one of
these fails the calling test:

| Check | Fails when |
|---|---|
| `squeezed-label`, `squeezed-text` | a text is laid out on three or more lines that average at most three characters, or an unspaced text averages at most one and a half characters per line; or a button narrower than 6em has a wrapped label |
| `bare-heading` | a heading in the route's content has a font weight below 600 |
| `bare-table` | a table has neither a frame (three bordered sides) nor a header fill unlike its rows, or stands less than 8px under the previous table |
| `bare-list` | a list of two or more items has no marker, no row gap of its own and no item with a border, padding, fill or layout of its own |
| `bare-definition-list` | all terms and values of a definition list are equal in colour, weight and size |
| `variantless-button` | a workspace button has a transparent background and no border, or another button in the route's content cannot be told from the text around it |
| `text-floor` | reading text in the route's content is smaller than 12px |
| `link-colour` | a link that is not a button, a row or a card has another colour than the workspace's link colour |
| `machine-value` | a text contains an ISO 8601 date and time, an `UPPER_SNAKE` value, one of a fixed list of enumeration words, or the word "API" |

Recorded as advisories and metrics, which never fail a test: a label that wraps
without being squeezed, narrow text, a heading less than 4px from what follows,
more than four sizes of running text in a panel, a fourth nested surface, a
page longer than three viewports at 1440px or eight at 320px, and content that
starts below 420px at 320px.

What these checks do not detect:

- Meaning. A heading that names the wrong section, two cards that say the same
  thing, a sentence that is hard to read or untrue, or the order of things on a
  screen are invisible to them.
- Alignment, empty space, rhythm, and where a line breaks. Only the squeeze
  thresholds above are measured; a line that begins with a closing bracket or a
  long-vowel mark is not reported.
- Anything inside a closed `<details>` (see the open-task matrix below).
- Machine values outside the patterns: `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` and
  `HH:MM` are accepted as the format of the record tables; an event kind such
  as `schedule.published` and an unknown capital word are advisories only;
  text inside `code`, inside a disclosure that exists to show identifiers, and
  inside an element marked `data-verbatim` (what a person typed, shown back) is
  not judged.
- Text under 12px in the cells of the timetable and in the shell, and a light
  heading in the shell, are advisories, not failures.

Where the structural checks run:

| Spec | What it judges | Engines |
|---|---|---|
| `storybook-v3-roles.pw.ts`, `storybook-v3.pw.ts` | the 52 role-route and 25 representative stories, closed, four appearances × three widths: the optical audit and, new, the structural checks | Chromium, Firefox, WebKit |
| `storybook-v3-states.pw.ts` | 150 state stories at 390px: presence and labels; the structural checks for the ready and empty states only | Chromium, Firefox, WebKit |
| `storybook-v3-parts.pw.ts` (new) | every story under "Ideal UI v3/Parts/", read from the build's index: the optical audit and the structural checks, four appearances × three widths | Chromium, Firefox, WebKit |
| `storybook-v3-open.pw.ts` (new) | the 25 routes with every `<details>` opened: contrast, target size, overflow at 320px, text spacing and the structural checks, light theme, 320 and 1440px | Chromium only, by design |
| `structure-counter.pw.ts` (new) | for each failing check, a page with the defect that must be reported and its correction that must not; the designed markup, which must pass whole | Chromium, Firefox, WebKit |
| `optical-pinned.pw.ts` (new) | counter-examples for the change to the optical audit described below | Chromium, Firefox, WebKit |
| the three journey specs (`finishAudit`) | the screen at the end of each journey: axe, the optical audit and, new, the structural checks | Chromium, Firefox, WebKit |

Limits of the open-task matrix, which the spec states itself: Chromium only,
the light theme, 320 and 1440px; no keyboard walk, so the focus check is not
run in the opened state; nothing is typed or submitted, so a confirmation
surface, a refusal and a saved state are not reached; a read that the stories'
synthetic transport cannot answer leaves its task without a form and is an
advisory naming the path, not a pass. In Firefox and WebKit the opened state is
audited only where a journey opens a task.

The optical audit itself was changed in one respect. Text under a
`position: sticky` cell of the same table, when the table's own scroll region
has been scrolled, used to be reported as undetermined, which blocked every
audit of a scrolled table above 820px. It is now treated as not shown, like
text scrolled out of its region, and is judged where a part of it still shows
beside the pinned cell. Every other covering is still undetermined.

**Static rules** in `tests/test_workspace_v3_structure.py`, each with mutations
or counter-strings in the same file:

- Every class the workspace writes has a rule: a selector in `globals.css` or
  in a workspace stylesheet names it, and a class built from a template has a
  rule for each declared value. Not seen: a class glued to an interpolation,
  and whether a rule that exists is enough to make the element look finished.
- Every selector of a workspace stylesheet starts with `.ideal-v3-app` (or the
  document-level forms of it) and does not leave the frame through a sibling
  combinator; `font-size` and `border-radius` take only variables of the scale
  or `inherit` (a radius also `50%`), declared in `scale.css` alone; `@import`
  is `index.css`'s alone. Not seen: a selector that leaves the frame through
  `:has()` on the document, which is allowed by design; the values that
  `scale.css` itself declares; `@keyframes` blocks and the values of other
  properties.
- A module without `"use client"` takes only components from a module with it
  and only renders them. In a Server Components build a constant read that way
  is a reference to the module, not the value, although Jest and Storybook show
  it working; one such read (the target of a jump button) was found and moved
  during the repair. Not seen, among others: a value named like a component
  that is only handed on, a use through another local name, `require()` and
  `import()`.
- A link from one route to another names a transition that the use-case
  contract declares. Not seen: a link in a shared part. The rule is loose in
  two ways that code review 3 noted and that were not changed: it does not look
  at the direction, and it accepts a link when one use case names both ends,
  even if neither is that use case's own route. The 10 transitions were added
  to the contract during the repair, in which the screens also gained links;
  code review 3 remarked of three of them that the contract had been fitted to
  links that existed. The rule therefore binds the code to the contract less
  than its name suggests.

`tests/test_workspace_v3_labels.py` (new) compares the frontend's words for
recorded events with the server: every area and first part of a kind the
server knows has a word, and every kind worded in the frontend occurs in the
server's code. It is also loose, as code review 3 noted: it takes every string
literal of the server's code that has the form of a kind as one the server
emits, so it does not prove that a kind is emitted.

### Reviews of the repair

All of these were made by AI review agents. None was made by a person.

Looks at screenshots. The screenshots were diagnostic captures of synthetic
stories in a local Chromium, not of a verified build. By the plan of the
repair a reviewer was given the screenshots of the state after a round, a
checklist and the purpose of each route, and not the images from before the
repair, the code or the author's grades. The third reviewer also had the notes
of the second look and reported the state of each of its findings.

| Look | After | Grades of the 25 routes | What the reviewer saw |
|---|---|---|---|
| 1 | round 1 | A 0, B 9, C 16, D 0 | light theme at 1440 and 320px for all routes; dark at 1440px for 14 routes; 768px for 10 routes |
| 2 | round 2 | A 3, B 14, C 8, D 0 | light theme at 1440 and 320px for all routes (a few short tiles unread); the opened state of the 15 routes that have one; dark at 1440px for 12 routes; 768px for 11 routes |
| 3 | round 3 | A 3, B 12, C 10, D 0 | 135 of the 600 image files; no full-page image; dark for the four people routes and the schedule only; 768px for the people routes and two others |

The grades are not one series. The grades before the repair (D 1, C 8, B 16)
came from an agent of the repair work; the three looks came from separate
agents with their own instructions, and the third applied a stricter rule than
the second: a route with any finding the reviewer rated "should fix" is a C.
The fall from 14 B to 12 B between looks 2 and 3 is therefore not evidence that
the screens got worse, and the rise before it is not a measurement either.

On the owner's original point, the third look reported for each of the four
people routes that no unstyled part remained. It graded `people/directory` and
`people/lifecycle` B and `people/memberships` and `people/contracts` C.
`people/contracts` had the only finding of that look rated "must fix": at 320px
a table that is closed by default had lines holding only a dash or a bracket.
Round 4 answered that finding and others of the third look. **No independent
look of this kind (all routes, graded) was made after round 4.** After round 4
the author agent looked at Chromium captures of its own changes, and AI agents
of the second pre-flight looked at captures in Firefox and WebKit for
differences between the engines (see the limits below).

Code reviews of the repair. Each reviewer was given a diff and the files and
could not change the source.

| Review | Range | Findings | Outcome |
|---|---|---|---|
| 1 | round 1 | The notes were not kept; the counts by severity cannot be stated | A commit made after it closes gaps that "an independent review found" in two of the static rules (stylesheet scope and scale; values read from client modules). What else the review reported is not recorded |
| 2 | round 2 | The notes were not kept. The commits that answer it carry 13 labels: High 1, Medium 3, Low 9; whether the review listed more is not recorded | Each of the 13 has a commit. The High finding is the first defect in the next section; the Medium findings were statements on screen that did not match what the server does |
| 3 | round 3 (121 files) | High 1, Medium 3, Low 10 | The High (four text pins of journey U22 not updated after a rewording), the three Medium and eight Low findings were corrected. Left: the looseness of the two test rules described above, and one unverified note about server code that this work does not change, which is outside this record |
| 4 | round 4 (64 files) | High 0, Medium 2, Low 11 | Both Medium and nine Low findings were answered in one commit (`b716dffe`). Left: a step's number tag is not drawn once its task is open, and the looseness of the two test rules |

Review 3 read the whole diff and ran the two Python test files and the type
check; it ran neither Jest nor a browser. Review 4 also ran the workspace's
Jest suites (63 suites, 745 tests) in a copy and reproduced four of its
findings there against a stand-in server; it ran no browser. **The last two
commits of the repair** (`b716dffe`, which answers review 4, and `587e6c34`,
which answers the second pre-flight) **were not reviewed by a separate agent.**
They were checked by the author's own gates and by the fourth formal run.

### Defects found during the repair

These are defects of behaviour or of statement, not of look. Each was verified
in the history of the branch.

- **The comparison of plans named a figure by the opposite of what it counts.**
  Before the repair the column was headed 「希望」 and showed the server's
  `preferences_met` / total, and the route's description called it wishes
  fulfilled; round 2 of the repair added an explanation that said "wishes that
  came true". The server counts a preference when an assigned duty overlaps it,
  and the preferences are wishes not to work: fewer is better. Code review 2
  found it. Since round 3 the column is 「勤務が重なった希望」 and says that
  fewer is better.
- **A server validation that returned findings was shown as an unknown
  outcome.** In the draft editor a re-check that the server answered with
  findings was passed through the path for a request whose answer never came.
  This was so before the repair. Since round 4 it is shown as the server's
  answer, with the number of findings.
- **The re-check of a draft plan checked the server's current version, not the
  version on the screen.** The defect was in the restructured source, before
  the repair. If someone else had saved the plan since the screen read it, the
  re-check read and validated the newer version, and the screen then offered
  to publish under the table of the older one. The server still required the
  version and the review hash of the publication request to match the plan, so
  what would have been published was a version the server had validated, but
  not the one shown. Code review 4 found it and reproduced it in Jest against
  a stand-in server, not on a running server with two people. Corrected in
  `b716dffe`: the re-check names the version on the screen; when the server
  refuses that version, the plan is read again and shown, unchecked. The same
  commit withdraws an earlier confirmation when a later check finds something
  (a state introduced by the correction of the previous item, in which the
  screen said both "cannot be published" and offered to publish). The
  corrections are covered by Jest; the journeys press the re-check only where
  nobody else has saved, and no journey covers the concurrent case.
- **A file refused in the browser on import was shown as an unknown outcome.**
  A file over 5MB, or one that is not JSON, never leaves the browser, but the
  refusal was shown as a change whose outcome is unknown. It is now said as a
  refusal of the file. A file still being read when another is chosen no
  longer sets the confirmation or the refusal.
- **An approval notice lost its publication during round 3 and got it back in
  round 4.** Before the repair a notice that carried a publication showed that
  publication's version. Round 2 made it a link to that version's schedule.
  Round 3 restricted version and link to the notice of a publication, on the
  premise that no other notice carries one. The server puts the publication
  that an approval creates into the approval's notice, so a person who receives
  only that notice (someone the approval took off duty, with no duty in the new
  version) lost the version and the way to the changed schedule. Code review 3
  found it; round 4 restored it.

### Pre-flight runs (not formal)

Two runs were made before the formal one, to find what would fail. They are
development checks and are not counted as formal results.

1. On commit `9933f996` (after round 3). Journeys 252/261: all nine cases of
   U22 failed, in every engine and width, at the same place. The repair had
   reworded the heading and two rows of a flextime card and the journey's four
   text pins had not followed (code review 3 found the same by reading the
   diff). With the four pins corrected in a temporary copy, U22 passed 8/9 and failed
   in WebKit at 320px for another reason: WebKit's device takes screenshots at
   twice the CSS size, and the page, 17,075 CSS px tall at 320px, then exceeds
   the 32,767px one screenshot can hold. The capture failed, not a check. The
   other steps of this pre-flight passed: flag-OFF 267/267, flag-ON 9/9, the
   comparison with the base (114 images, difference 0), the Storybook matrices
   in a separate container with a 3GB `/tmp`, Jest (114 suites, 1,032 tests)
   and the full Python suite (1,558 passed, 17 skipped). Fixes, in round 4: the
   four pins, and the journeys' evidence screenshot is taken in CSS pixels.
2. On commit `34d79106` (after round 4). Journeys 261/261 in the three engines,
   U22 included. Storybook matrices in a separate container with a 3GB `/tmp`:
   role-route 156/156, representative 75/75, parts 27/27, states 450/450, open
   25/25, counter-examples 99/99. Not run in this pre-flight: flag-OFF, flag-ON,
   the comparison with the base, the gates and the Python suite. This pre-flight
   also captured the routes in the Linux builds of WebKit and Firefox and had
   them looked at by AI agents (see the limits below), and it measured how much
   of `/tmp` each matrix needs (see the split below). Two changes followed it:
   the answer to code review 4 (`b716dffe`) and break opportunities in names
   joined by a slash (`587e6c34`).

### Fourth formal run

Source: commit `587e6c34`, the final application source. Time: 2026-10-06
15:10–19:00 UTC (2026-10-07 in Japan). Rules as for the earlier runs: each step
once, no retry, a failure is recorded as a failure. Browsers: the Chromium,
Firefox and WebKit of Playwright 1.56.1 in a Linux container. All data is
synthetic.

| Step | Result |
|---|---|
| Jest | 115 suites, 1,052 tests, 8 snapshots passed |
| `tsc --noEmit`, ESLint | passed, no output |
| Structure, contract, diagram and wording tests (eight files) | 196 passed |
| ruff, black (430 files), mypy (127 source files) | passed |
| Public API contracts | 31 models match |
| Markdown link check | passed (41 files) |
| Full Python suite, isolated PostgreSQL | 1,558 passed, 17 skipped, failures 0, errors 0 |
| Linux build for the matrices, Storybook build, production build | passed; 309 stories in the build, 267 of them v3 |
| Established product against the base commit of the restructuring | 114 images, difference 0; same passing and failing tests and same failure messages on both sides |
| Journeys U01–U29 | 261/261 (29 use cases × 3 engines × 3 widths), 87 per engine and per width, retry 0, drift 0 |
| Flag-OFF matrix | 267/267, failed 0, unexecuted 0, drift 0 |
| Flag-ON entry | 9/9 |
| Storybook: role-route | 156/156; 1,872 conditions audited |
| Storybook: representative | 75/75; 900 conditions |
| Storybook: shared parts | 27/27; 1,224 conditions |
| Storybook: states | 450/450; structural checks on 150 of them |
| Storybook: every task open | 25/25 in Chromium; 50 skipped by design in Firefox and WebKit |
| Storybook: counter-examples | 99/99 |
| `pip-audit` (46 locked packages) | no known vulnerabilities |
| **`npm audit`** | **failed: both invocations exited with status 1** |

Across the Storybook matrices and the journeys: optical findings 0,
undetermined checks 0, structural findings 0, axe violations 0, failed tests 0,
flaky 0. Not failures, and recorded: axe reported "incomplete" items in the
journeys (7 in Chromium, 7 in Firefox, 9 in WebKit; the journeys judge
violations only), and the structural checks recorded advisories, for example
in the role-route matrix 44 wrapped labels and 16 page lengths per engine and
48, 112 and 48 headings close to their content in Chromium, Firefox and
WebKit. The Firefox surplus was not analysed in this run; in the first
pre-flight the whole surplus was a gap measured as 4.0px against the limit of
4px.

The `npm audit` failure. `npm audit --omit=dev --audit-level=moderate` reported
two advisories of severity high in the production graph: `sharp` below 0.35.5
(installed 0.35.4, an optional dependency of Next.js; GHSA-wq5f-xc86-pv6w) and
`source-map-js` 1.0.0–1.2.1 (installed 1.2.1; GHSA-68fv-2mgg-jv7q).
`npm audit --audit-level=high` over the full graph reported the same two and 21
of severity moderate in development-only dependencies of Jest. Both commands
exited with status 1 and were not run again. `frontend/package.json` and the
lockfile are identical on the base commit and on the final source, and the same
two commands reported zero findings in the third run (2026-10-05 19:29 UTC). So
the installed dependencies are the same and the advisory data changed; when
the advisories were published was not checked. This work did not introduce
them and did not fix them. They are open at the time of this record; the
dependency update is tracked separately.

Update, 2026-10-07 (not part of the run): the lockfile-only update named in the
row above was merged into `main` as pull request #16 (the pull request also
regenerated the SBOM and the third-party licence manifest that the public CI
checks against the lockfile, and added to `.gitleaks.toml` the allowlist for the
fixed test strings that this branch already had). Before the merge, both
`npm audit` invocations, Jest (1,052 tests), `tsc`, ESLint and the production
build passed on that lockfile on the workstation, and every job of the public CI
of the pull request passed, including its Playwright job. No browser matrix of
this record was run on that lockfile.

The Storybook matrices were split into 48 invocations of the visual runner:
role-route in eight parts per engine (24), representative in four per engine
(12), shared parts in three per engine (9), and states, open and
counter-examples in one each. The reason is the limit found after the third
run: the browser container's `/tmp` is a 512MiB tmpfs, the browser server keeps
the trace records of a connection there until the connection ends, and on this
source one connection needs about 0.8–1.2GiB for the role-route matrix and
0.4–0.7GiB for the representative matrix, depending on the engine (measured in
the second pre-flight). `/tmp` is released when a connection ends. In the
fourth run it peaked at 225MiB. A completeness check compared the tests of the
48 invocations with the list of each matrix taken without a split: for all six
matrices no test was missing, none was extra and none ran twice; each test has
one result; all 48 invocations report the same source hashes and no drift.

The five visual tests that fail on the base and on the final source are the
ones named for the earlier runs: the text-spacing check of the sign-in page at
320px, the established planning flow, and the three tests of the v1/v2
showcase and `/preview`. They are outside this result. Of those three, the two
showcase tests take no image before they fail, on either side, so this
comparison contains no image of the showcase; the five images of `/preview`
are identical on both sides. The audit helpers under
`frontend/tests/visual` are not identical on the two sides (the optical audit
changed, as described above); the audit attachments of the established screens
were therefore compared as well and are identical on both sides (396
attachments, and 10 of `/preview`).

Deviations from "each step once, in one piece", recorded as they happened:

- A smoke step ran first and is not formal: 12 journeys in Chromium and 3 in
  WebKit at 320px, all passed. They are not counted in any figure above.
- The production build that the journey runner uses was the one made for the
  smoke step from the same commit a few minutes earlier; it was not built
  again. Its fingerprint (317 files) was the same before and after the
  production-build gate that ran in between, and the journey runner recorded
  the same build identity before and after the journeys and no drift.
- The gate script was stopped by the agent running it after Jest had finished,
  to stay within a time limit of the tooling, and started again from the type
  check. The Jest result is that of the one completed run. The type check had
  run for five seconds without output when it was stopped and was started
  again; every later gate ran once.
- The first start of the flag-OFF step was stopped before any case ran: the
  frontend server did not start, because the development TLS files it reads
  from a temporary location were gone. They were copied again from the
  repository's development certificate (compared and identical), the step was
  started again, and the copy was deleted afterwards.
- For the comparison with the base, the base's dependencies were cloned from
  the final source's installed copy instead of installed with `npm ci`, after
  checking that `package.json` and the lockfile are identical. The second and
  third runs had used `npm ci`.
- Not run again in the fourth run, as in the third: the observation of
  PostgreSQL for the ER comparison, the isolated restore drill, the licence
  audit and the static review gallery.

### Partial verification of the person-selection change (2026-10-09)

After the fourth run the owner asked why the links of the onboarding screen
opened a screen narrowed to one staff member, and the answer was changed in code:
the person named by `?person=` now travels only between the five routes that look
at a person, four of them show a band that says whom the screen is narrowed to,
that the signed-in account is unchanged and how to clear the narrowing, and the
route-state matrix of Storybook has four new `selected-person` states. This is the
commit range from `09203885` to `a0143dd3` of the working branch (on top of
`587e6c34`), under "2026-10-07" in `CHANGELOG.md`. The owner chose to verify it
partly. The fourth run is **not** repeated for it: the table of the fourth run
describes `587e6c34`.

What was run, on commit `a0143dd3`, each check once, no retry, in the same Linux
container and with the same runners as the fourth run:

| Check | Result |
|---|---|
| Builds (deep-runner build; Linux build with Storybook, 313 stories: the 309 of the fourth run and the 4 new states) | passed |
| Jest | 116 suites, 1,063 tests, 8 snapshots passed |
| `tsc --noEmit`, ESLint | passed, no output |
| Structure, contract, diagram and wording tests (eight files) | 199 passed (the new rule that `PERSON_ROUTES` equals the routes declaring `names: "roster"` or `"privacy"`, with two mutations, is included) |
| Journeys U09, U20, U25 (the use cases that open the person routes), 3 engines × widths 320, 768, 1440 | 27/27 passed; 0 failed, 0 skipped, 0 flaky, no retry; source drift: none (1,796 frozen files); axe violations 0, optical findings 0 and undecidable 0, structure findings 0 over 189 audits |
| Storybook matrices through the visual runner, 18 invocations (the `/tmp` of the container cannot hold a whole matrix) | roles 54/54, representative 39/39, states 462/462 (the 4 new states × 3 engines = 12 of them), open 25/25 in Chromium (50 skipped by design in the other two engines), counter-examples 99/99; in all 679 expected, 0 unexpected, 50 skipped, 0 flaky; structure and optical findings 0; one source hash for all 18; completeness against the unsplit lists: missing 0, extra 0, twice 0; `/tmp` of the container at most 195,420K of 524,288K |

The matrices of this run contain only the parts that hold the five person routes
(each of the five routes ran once in each engine in roles, representative and
states, and once in Chromium in open) and the stories of other routes that share those parts. The
shared-parts matrix was not run, because the band is not a shared-parts story.

What these checks do not show about the band. The `states` specification judges
only that a state exists and is labelled, and the other matrices open the routes
without naming a person, so none of them puts the band through the structure and
optical detectors. For that, the author ran the same detector functions over the
four new states in the local Chromium, light and dark, 1440 and 320, closed and
opened, with a specification kept outside the repository: structure findings 0,
optical findings 0, undecidable 0. This is not a result of the runner above.

Looking at the band in WebKit and Firefox (Linux builds). The four new states
were captured at 320 and 1440, light and dark, in both engines (48 conditions
with Chromium for comparison); the geometry of each was measured in the page
(no overflow, no clipping, no overlap of the three paragraphs of the band), and
nine of the images were opened and looked at, among them the band of
memberships, contracts and privacy at 320 in light and dark. At 320 the clear
link takes two lines of about equal length in all three engines, with no last
line of one character; at 1440 it takes one. Not good: WebKit and Firefox break
the first paragraph inside words (「記録だ／けを表示し」, where Chromium breaks
between phrases), and at 320 all engines break a name inside the name
(「佐藤／美咲」). On the privacy route the band is followed by the route's
existing paragraph 「請求の対象として選択中の職員：…」, so the same person
appears twice; the existing paragraph is read verbatim by journey U25 and was
kept. The images were looked at by the person running the check, not by a
separate reviewer.

A defect found by hand in the real preview and fixed (commit `feca9b10`): the
task links of an onboarding case named the case's person, and for a new hire
who has no record yet the person is not in the route's roster, so the
destination refused the person and showed 「見つかりません」. The link now names a
person only when the roster the route was given holds them; otherwise it opens
the route for everyone, where the first step of 「新しい職員を追加する手順」
registers the person. This is covered by a Jest test and is not covered by a
journey.

What was not run for this change: the full Python tests (the diff of `src/` from
`587e6c34` is empty and the only changed test file is
`tests/test_workspace_v3_structure.py`), ruff, black, mypy, the contract and link
checks, the production and Storybook gate builds, the flag-OFF and flag-ON runs,
the comparison with the base commit, the dependency audits, the shared-parts
matrix, the roles and representative parts that hold no person route, and any
check on macOS Safari or Firefox. No AI review agent read the diff of this change
and none looked at its screenshots; the review of the repair in this record
ends before it. A later commit (`ce341988`) only brings the lockfile update and
its generated files into the working branch; no browser check was run after it.

### Journey assertions changed since the third formal run

The three journey specs changed in the lines below and in no other. The
classification is that of code review 4, checked against the diff of
`frontend/tests/remediation-e2e` between the source of the third formal run
and the final source. No assertion about behaviour was changed.

| Journey | Change | Kind |
|---|---|---|
| all (`finishAudit` in the three specs) | the structural findings of the final screen must be empty | assertion added |
| all (`finishAudit` in the three specs) | the evidence screenshot is taken in CSS pixels (`scale: 'css'`) | evidence only |
| U15 | the day view replaces the month table at 600px and below, before at 1180px and below | layout pin, follows a deliberate change of the layout |
| U16 | 「ケース版 N」 → 「第N版」 | wording pin |
| U18 | heading 「外観と動き」 → 「配色」 | wording pin |
| U20 | 「サーバーの検証で不整合なし」 → 「記録の検証：不整合なし」; the sentence about earlier versions, which named the API, replaced by one that points to the audit history | wording pins (2) |
| U22 | the name of the adoption card (two pins); "registered by / confirmed by" read from two rows instead of one line (two pins, stricter: number and order are now checked) | wording pins (4) |
| U23 | the sentence about the viewer's permission, for two roles | wording pins (2) |
| U24 | 「この画面が受け取るのは現在の版だけ」 → 「この画面に表示できるのは現在の版の内容だけ」 | wording pin |

### Known limits found in the repair and not changed

- **No human evaluation.** The moderated evaluation with 30 participants, the
  VoiceOver and NVDA sessions and the performance measurement under realistic
  conditions have still not been done. Nothing in this section shows that the
  workspace is usable or accessible. `IDEAL_UI` stays OFF by default.
- **The last state was not reviewed independently.** No graded look at the
  screenshots of all routes after round 4, and no code review of the last two
  commits.
- **Firefox and WebKit are the Linux builds in a container** (Playwright
  1.56.1). Safari and Firefox on macOS were not checked.
- **Line breaking in Firefox and WebKit.** The workspace asks the browser to
  break headings, summaries and button labels between phrases; only Chromium
  does that. In the other two engines lines break inside words more often, and
  short last lines are common. The second pre-flight found, at 320px, lines
  that began with a long-vowel mark or held a closing bracket alone in tables
  of `requests/leave` and `people/contracts`. The last commit offers a break
  after each slash and before each opening bracket in such names. A long name
  without a slash or a bracket in a narrow cell can still break before a
  long-vowel mark (seen in Firefox in the account-link table). This record has
  no capture of the routes in Firefox and WebKit after the last commit, and the
  automated matrices do not measure where a line breaks.
- **Other differences seen in the Linux builds in the second pre-flight**, by
  AI agents looking at captures: in WebKit the date and time fields are empty
  boxes without a format hint, a `select` keeps a look close to the engine's
  default, and at 320px the text of two process tabs touches the tab's border;
  in Firefox the header row and the first column of a table do not appear
  bold, and at 320px the end of a date-and-time field does not fit its box.
  None of these was changed. No horizontal overflow was measured in any of the
  186 captured conditions.
- **The opened state is audited by the detectors in Chromium only**, in the
  light theme at 320 and 1440px, without a focus check and without typing.
- **Several pages are long, and some grew.** Heights of the closed route in
  diagnostic captures (local Chromium, light theme, synthetic stories), before
  the repair → on the final source:

  | Route | 1440px | 320px |
  |---|---|---|
  | `people/contracts` | 4,345 → 3,692px | 5,639 → 6,829px |
  | `people/memberships` | 900 → 1,098px | 1,125 → 1,652px |
  | `governance/privacy` | 2,225 → 2,926px | 3,171 → 4,401px |
  | `settings/flextime` | 2,765 → 3,047px | 4,178 → 5,596px |
  | `plan/compare` | 970 → 1,471px | 1,435 → 2,701px |

  With every task open, the three longest routes on the final source are
  between 7,572 and 8,177px at 1440px and between 11,523 and 11,602px at
  320px. Page length is an advisory of the structural checks, not a failure.
- **Items of the reviews that were deliberately left:**
  - `governance/audit` shows the record type of each event as the server's
    code (for example `schedule.published`) beside its words;
  - periods and times are written in two forms (`2026-10-12 08:30` in record
    tables, 「10月12日（月）08:30–17:30」 elsewhere);
  - on `plan/publications` the filled primary button is the export;
  - on `people/contracts` the number tag of a step is not drawn once the task
    it leads to is open;
  - the two test rules described above (links to declared transitions; kinds
    the server emits) can be satisfied loosely.
- **Lists.** The workspace's note lists have `list-style: none` and carry
  `role="list"`, because Safari with VoiceOver is reported not to announce a
  list without a marker as a list. This was not checked with a screen reader.
- **The draft re-check under concurrent saving** is covered by Jest only (see
  "Defects found during the repair").
- **`npm audit`:** two high advisories were open at the fourth run (see "Fourth
  formal run"); the lockfile update that clears them is described there under
  "Update, 2026-10-07" and was not covered by the browser matrices.

## Pending evaluations

The following human and field evaluations remain pending and therefore block
**production adoption**, but do not by themselves block publication of the
source repository with `IDEAL_UI` OFF by default:

- the moderated 30-participant AB/BA evaluation;
- VoiceOver and NVDA sessions using the supplied protocol;
- human 200%/400% zoom and forced-colors sign-off on target platforms;
- production-like field p75 LCP, INP and CLS.

The repository-publication gate additionally requires a clean committed source
tree, a history-free public export, and secret, license and file-size scans of
that exact export. `independent-review-v3.md` records the independent review of
the state before the 2026-10-05 restructuring; it is not a review of the
restructured source. The review of the restructuring itself is the section
"Independent review of the restructuring" above; it was done by a reviewing
agent, and a final release review by a person remains open.
Exact-export and package results are recorded in the
accompanying manifests rather than inferred from this source-tree report.

The visual repair of 2026-10-06 and the fourth formal run change nothing in
this list. The reviews of the repair were made by AI review agents from
screenshots and diffs; none of them is one of the evaluations above, and no
person's assessment of the repaired screens is recorded. The two high `npm
audit` advisories reported in the fourth run are open.

`IDEAL_UI` therefore remains OFF by default.
