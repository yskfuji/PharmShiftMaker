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
