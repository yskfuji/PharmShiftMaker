# Verification record — 2026-10-06

All browser fixtures, exported artifacts and screenshots use synthetic people,
facilities and work records. A passing automated row is evidence for that row
only; it is not a WCAG conformance claim, a security proof or a real-user result.

The table gives the results for the final application source of the 2026-10-05
restructuring (third formal run, 2026-10-06; see "Browser verification of the
restructured source" below for the two runs before it). A row that was not run
again says so and keeps the earlier figure, which describes an earlier source.

| Check | Result |
|---|---|
| Python unit/API/PostgreSQL regression | Final application source: 1,492 passed and 17 conditional skips; failures 0 (isolated PostgreSQL). |
| Frontend Jest | Final application source: 104 suites, 932 tests and 8 snapshots passed. |
| TypeScript | `tsc --noEmit` passed. |
| Frontend ESLint | 0 errors and 0 warnings. |
| Next.js production build | Node 24.21.0, Next.js 16.3.8, React 19.3; Webpack production build passed, on the workstation and in the Linux container whose build the browser matrices used. |
| Static Storybook | Storybook 10.6.0; offline build passed with 256 v3 stories (52 role-route, 150 route-state, 31 representative and 23 for shared parts). |
| Public API contracts | 31 OpenAPI/Pydantic models match their normalized TypeScript declarations. |
| Structure, contract and diagram tests | 130 passed: `tests/test_workspace_v3_structure.py` (every rule and its mutations), the use-case contract, the regenerated ER/state/screen-API/sequence diagrams and the navigation graph. |
| ORM/PostgreSQL ER comparison | 41 business ORM tables and 41 observed business tables; observed PostgreSQL also has the expected `alembic_version` table; semantic difference count 0. Recorded before the 2026-10-05 restructuring; the observation of PostgreSQL was not re-run on the final commit. |
| U01–U29 complete browser journeys | 261/261 first attempts passed: 29 journeys × Chromium/Firefox/WebKit × 320/768/1440px, real API and one disposable PostgreSQL schema per case; retry 0, source/contract/build drift 0. |
| U25 and U29 destructive journeys | Part of the matrix above, 9/9 each: U25 erases a dedicated synthetic person, U29 erases planning inputs past their retention; each journey checks the erasure through the API afterwards. |
| U26 restore boundary | The browser journey (read-only UI) is part of the matrix above, 9/9. The separate isolated PostgreSQL drill (13 checks, `PASS_WITH_STATED_SCOPE`) was recorded before the 2026-10-05 restructuring and was not re-run. |
| Established product unchanged | The base commit of the restructuring and the final source were built and photographed under the same conditions: 114 images of the established screens, difference 0, and the same tests pass and fail as on the base (five visual tests fail on both, see below). |
| Existing flag-OFF matrix | 267/267 selected legacy cases passed against the frozen source and production build; retry 0, failed/unexecuted 0, source/build drift 0. |
| Flag-ON entry | 9/9 cases passed (the entry of `/workspace` with `IDEAL_UI=1`, three widths, three engines). |
| Role-route optical matrix | 155/156 role-route tests passed. Each test covers four appearances at 320/768/1440px: 1,862 of 1,872 conditions audited. Optical findings, undetermined checks, skips and flaky results 0. The one failure is the full-page capture of one Chromium test and is a limit of the test environment (its `/tmp` filled up), as established below; a supplementary run of the whole matrix with a larger `/tmp` passed 156/156 with all 1,872 conditions audited. It is not counted as the formal result. |
| Route-state stories | 150/150 generated stories (25 routes × 6 common states) passed the Chromium presence and semantic-label check. This is not a full optical audit. |
| Representative stories | 75/75 passed (25 stories × 3 engines), 900 conditions; findings, skips and flaky results 0. |
| Static review gallery | 233 synthetic stories × 390/1024/1920px = 699 Chromium images; automated axe and horizontal-overflow findings 0. Recorded before the 2026-10-05 restructuring; the gallery was not regenerated, and it does not show the rebuilt screens. Representative human review remains pending. |
| Dependency vulnerability audit | Registry-backed `pip-audit` of the 46 locked Python packages: 0 known vulnerabilities. `npm audit` of the production graph (threshold moderate) and of the full graph (threshold high): 0 findings. |
| Dependency license audit | 46 Python distributions and the npm lockfile graph were classified; no unclassified license remained in the recorded reports. Recorded before the 2026-10-05 restructuring; not re-run on the final commit. |
| Independent review | Of the state before the restructuring: 0 high, 0 medium and 1 low finding (the displayed role in the anonymous audit timeline; see `independent-review-v3.md`). Of the restructuring: four rounds by a separate reviewing agent, see "Independent review of the restructuring" below; at the end 0 high and 0 medium findings were open. |

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
"Independent review of the restructuring" below.

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
  route may also name an input version and plans).
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

There were three formal runs, each on a different source.

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

Not verified in a browser: Safari and Firefox on macOS (all runs used the Linux
builds of the engines); the operations that only Jest covers, namely five tasks
of `governance/privacy` (registering an external copy, confirming a processor's
handling, the preservation decision, the joint erasure decision and reconciling
an operator reference; the fixture has no shared or external copy), some
administrator forms of `requests/leave`, ten of the fourteen record editors of
`people/contracts` and the enrolment forms of `settings/flextime`.

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
  two runs before it and for what was not verified.
- The ER, state, screen/API and sequence diagrams regenerate from the
  implementation, and routes, roles, states, transitions and test identifiers
  are generated from `usecases.json` rather than edited by hand: checked by
  `tests/test_er_fresh.py`, `tests/test_ideal_usecase_contract.py` and
  `tests/test_navigation_graph.py`.

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

`IDEAL_UI` therefore remains OFF by default.
