# Acceptance matrix

| Layer | Acceptance requirement | Automated evidence | Human/field evidence | v3 status |
|---|---|---|---|---|
| Critical tasks | 0 critical mis-confirmations in 30 participants | API/workflow tests and browser scenarios | Moderated AB/BA study | Pending participants |
| Completion | At least 9/10 independently complete each critical role task | U01–U27 reachability matrix | Moderated study | Pending participants |
| Ease | Median SEQ ≥5/7 | Blank analysis workbook/protocol | Participant ratings | Pending participants |
| Non-inferiority | Completion not down >1 person; median time not worse >15% | Prespecified analysis | Paired AB/BA observations | Pending participants |
| Accessibility | WCAG 2.2 AA; keyboard, 200/400%, 320px, spacing, forced colors, focus, VO/NVDA | Jest plus 1,872 role-route axe/optical/reflow conditions | Manual zoom/forced-colors and assistive technology | Automated subset passed; VoiceOver/NVDA and target-platform manual sign-off pending |
| Rendering | Chromium/Firefox/WebKit at 320/768/1440 and four themes | 156 role-route tests and 1,872 conditions passed; 150 route-state stories passed; 233-story/699-image gallery generated | Representative human optical review | Automated matrix passed; representative human review pending |
| Existing behavior | Flag OFF retains the established product | 267/267 selected legacy cases, retry 0, failed/unexecuted 0, source/build drift 0 | Regression triage | Passed in the recorded synthetic environment |
| Declared use cases | U01–U27 are complete browser journeys through real API/PostgreSQL | 243/243 first-attempt cases; disposable schema per engine/width; U25 performs actual synthetic erasure | Task-level validation | Passed in the recorded synthetic environment |
| API safety | Scope authorization, expected version, idempotency, evidence, actor, four-eyes and self-lockout prevention | Python/API/PostgreSQL tests, adversarial cases and existing workflow E2E | Independent review and deployment-specific review | Automated gates passed; final release-candidate review pending |
| Erasure | Every ORM table classified; deterministic residuals and no resurrection | Inventory/copy-graph tests and subject-erasure suite; physical PostgreSQL copy triggers and erased-subject barrier verified for all four workflow case/event tables | Privacy review | Automated gates passed |
| Contracts | Public OpenAPI schemas match TypeScript | 31 models checked by `devtools/ideal_ui/check_contracts.py` | Diff review | Passed |
| Data model | ORM and observed PostgreSQL agree | 41/41 business tables; expected migration table excluded from business count; semantic difference 0 | Generated diagram review | Automated observation passed; human diagram review pending |
| Dependencies | Fixed runtime versions and no known audit findings at the recorded time | Node 24.21.0, Next 16.3.8, React 19.3, Playwright 1.56.1; registry-backed npm and Python audits found 0 known vulnerabilities | Operational patch process | Recorded dependency gate passed; continuous monitoring remains necessary |
| Performance | p75 LCP≤2.5s, INP≤200ms, CLS≤0.1 | Production build only | Production-like field telemetry | Field gate pending |
| Privacy | Synthetic data only in UI, recording and package | Public sample checks passed; package scan/checksum | Consent/retention review before real study | Exact public-export/package scan pending; real study pending |

“Pending” is not a pass. The production-adoption gate remains closed until the
human, assistive-technology and field-performance rows pass. Source-code
publication is a separate gate: it requires the automated checks, final
independent release review and exact public-export audit, while retaining
`IDEAL_UI` OFF by default.

## Multi-role increment (2026-10-28, base `048e426`)

This increment is not covered by the historical pass counts above. The canonical
entry `multirole-workflow` in `ops/acceptance-cases.json` is deliberately a diagnostic
until browser journeys and the complete privacy/rendering matrix are accepted.
It extends U01/U02/U03/U04/U09/U19/U20/U21; it does not close U25/U26.

| Contract | Implementation / reproducible check | Remaining acceptance |
|---|---|---|
| Occupation is not permission | `Person.occupation`, `Demand.required_occupation`, scoped `/planning/staff-context`; `tests/test_multirole_api.py` | Real IdP provisioning and facility records |
| Clerks do not cover pharmacist demand | Shared `domain/occupation.py` in generation and independent/manual validation; `tests/test_multirole_boundaries.py` | Full edit/copy/swap adversarial API matrix |
| Self-service remains private | STAFF follows legacy self-service paths; publication/requests filtered to linked person; clerical LEADER and pharmacist STAFF inverted-role checks | Old-membership, export and erasure lifecycle extension |
| Registration through own published roster | Product API routing with migrated PostgreSQL, real generation worker, preference refresh, review and publication | Network/TLS browser journey; tests currently use ASGI TestClient |
| Old review is invalid after occupation change | A distinct unpublished reviewed draft is rejected after person-record revision | Mutation campaign beyond this counterexample |
| Occupation and permission are visibly separate | Existing contract form and home card; `Multirole.stories.tsx` and `multirole.pw.ts` | All changed screens/states, individual image review, manual zoom/back-navigation |

No DDL migration is needed for these additive fields: occupations are stored in
existing typed JSON person records and string-valued legacy roles. Optional fields
are omitted when absent, preserving legacy input serialization and hashes. No
existing assistant is reclassified, and an unclassified legacy task does not
justify a clerical assignment. Clinical capability still requires the existing
verified, time-bounded evidence. Scheduling co-presence does not prove onsite
supervision. The UI makes no facility-compliance or statistical non-inferiority claim.

Reproduce backend diagnostic with an **isolated** `PHARMSHIFT_TEST_PG_URL` and
`python -m scripts.acceptance_pytest tests/test_multirole_boundaries.py tests/test_multirole_api.py`.
Without PostgreSQL the tests skip that variant and the acceptance wrapper rejects
the run. Images, observed schema and detailed logs are retained outside the source
worktree in the managed `audit/multirole-20261028` evidence directory; they are not
Git assets. No running environment has been switched and nothing has been pushed.


### HTTPS browser and rollback increment (2026-10-31)

Evidence is retained in the repository-level managed artifact directory
`audit/multirole-browser-20261031`; credentials, DB copies and images are not Git assets.
This remains a diagnostic increment, not authorization for the ordinary-port cutover.

- Real PostgreSQL 16.15 and verified HTTPS: Chromium completed the actual contract
  form occupation update, staff request, input refresh, generation, review,
  publication and self-only reread. Other original records and account mappings
  were prepared by real API calls; only the initial administrator mapping was
  bootstrapped. Authentication is mock and control is development mode.
- Final UI: 309 Jest tests, TypeScript, production build, Storybook build and
  21 optical cases (252 images, no skipped cases) passed. The 423 card now states
  the restriction and required response separately from a service failure.
- Three engines verified staff login and self-only published roster after reload;
  this does not represent three independent full write journeys.
- Isolated rollback used a separate restored logical-backup DB and old API/UI,
  then returned to the preserved candidate DB. Input, publication and request
  API-response hashes were unchanged. This is neither physical PITR nor a claim
  that every DB/file byte remained unchanged. The old baseline had no publication.
- Old runtime builds reused isolated candidate dependencies. The Linux image has
  Node 24.22.1, while candidate engines declares Node 26.12.1; exact release-runtime
  reproduction and ordinary-port rollback remain open acceptance gates.
- Card-image and actual-page individual reviews are separate artifacts. Internal
  codes and unfinished guidance in request/review/published screens remain known
  findings. All changed-screen state matrices, manual zoom/keyboard evaluation,
  clerical-leader browser behavior and complete privacy adversarial cases remain
  open. No statistical usability or facility-compliance conclusion is drawn.

### Node 26 and changed-screen state review (2026-10-31, continuation)

The exact `.nvmrc` version **26.12.1** now runs in the isolated Linux acceptance
container. The ordinary 18510/18511 environment was not switched. The managed
`audit/multirole-browser-20261031/NODE26_RESULT.md` records source hashes, runtime,
initial findings, retries, image references and remaining gates. The working tree
is uncommitted; a base SHA alone does not identify this candidate.

- Final r12: 326 Jest tests / 57 suites, TypeScript, lint, production build and
  Storybook build passed. Route generation is current. An existing ContractWorkflow
  test emits an `act` warning; it is retained in the log rather than suppressed.
- Node 26 rendering: r10 ran 546 tests, with no skipped, unexpected or flaky cases.
  This comprises 75 normal-route tests (900 images), 21 staff-context card tests
  (252 images) and 450 **generic state-shell** checks. The shell checks are not
  evidence that each product operation implements those states.
- Subsequent changes affect the leave screen only; r12 repeated its three-browser,
  three-width, four-theme matrix (3 tests / 36 replacement images). The other 24
  routes retain their r10 evidence. Unchanged images are individually hash-linked
  to prior original-size reviews; this is distinguished from fresh visual review.
- The actual HTTPS leave screen passed 11 intercepted endpoint states in each
  browser (33 cases, STAFF, 320px/light). These verify display and same-body retry,
  not server authorization or persistence. Endpoint failures do not simulate a
  globally invalid session. Real TLS login, self-only published roster reread and
  reload also passed in all three engines. The complete write journey was not
  rerun on this final revision.
- Review found and corrected lifecycle-button collapse, narrow names/ISO dates,
  request and ledger empty-state ambiguity, missing recovery guidance, and an
  asynchronous stale-read race. A failed Firefox capture with missing text is
  retained separately from the stable recapture. Native file-control text
  abbreviation and partially visible wide tables remain documented limitations.
- A separate nine-case horizontal-scroll check reached right-hand table columns;
  it does not prove simultaneous target/action identification or full keyboard
  navigation. No full 200/400% or assistive-technology claim is made.

`derived-state-coverage.json` is a generated index of the canonical use-case,
role and state rows, not a new requirements authority. Full feature-specific
state/role coverage, the older pending-POST/scope-change and conflict-fetch
boundaries, the final-version write journey, privacy adversarial coverage and
ordinary-port rollback/cutover remain open. Historical success counts are not
promoted to these gates. Worker/transfer/PITR acceptance is unaffected.

### Final write journey and native zoom (2026-10-31, final13)

The final13 candidate completed the actual HTTPS/PostgreSQL Chromium write journey
from clerical registration through staff request, generation, review, publication
and self-only UI/API reread. Three engines repeated authenticated readback at
320/768/1440px; all nine scoped axe scans reported zero violations. Node 26.12.1
Jest (326 tests), TypeScript, lint and production build passed. A regression
mutation restoring raw DAY was detected, followed by a passing normal control.

Nine published-staff-page images were individually reviewed at original size.
The 320px avatar edge remains clipped; a separate unpublished-period status-label
inconsistency is also open. These findings prevent a blanket visual pass. Native
Chrome 200/400% observations cover only the one-shift schedule. VoiceOver was
activated but speech/order were not verified; it was restored to off. Native
Safari, full keyboard/focus visibility, all screen states and assistive-technology
acceptance remain open. Storybook was not rebuilt after the final label change.

The original isolated DB was restored as the API target; normalized data-only
backup hashes matched and authenticated UI readback passed. This is not physical
PITR or ordinary-port rollback. Ordinary ports and data were not switched.
Detailed failures, retries, image hashes and source identity remain in the managed
local final-acceptance evidence index. Mock authentication/development control
limits apply; historical or mock successes do not close unrelated gates.

### Repository integration review (2026-10-31)

The integration branch additionally fixes publication-state labels for periods
without a publication and the narrow agenda avatar layout. The leave-request
component now invalidates in-flight work when scope, person or review permission
changes; delayed POST success, conflict responses and conflict-detail reads are
covered independently. Node 26.12.1 Jest passes 329 tests after these changes.
Final CI and targeted render evidence are recorded against the integration PR.
Native VoiceOver/Safari, full screen-state acceptance and ordinary-environment
cutover remain separate, incomplete gates. Repository merge is not deployment.
