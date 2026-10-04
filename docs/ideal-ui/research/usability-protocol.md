# Controlled usability evaluation protocol

Recruit 30 consenting participants: 10 administrators, 10 department leaders
and 10 pharmacists. Within each role assign five to AB and five to BA order.
Use equivalent months and different synthetic staff data in the two conditions.
The facilitator may clarify the task wording but may not teach the interface.

Record one row per participant, condition and task in
`participant-results-template.csv`. “Independent success” excludes facilitator
intervention. Mark a critical error when a participant confirms publication,
leave, swap, account-linking or erasure for the wrong subject/version/scope.
Capture elapsed time only for successful attempts; preserve timeout separately.

After each task capture SEQ (1–7). After each condition capture NASA-TLX and
VisAWI-S according to their scoring instructions. Do not merge aesthetics and
usability into one score. Record device, assistive technology, experience and
order, but exclude directly identifying information from the analysis file.

The pre-registered pass rules are those in `acceptance-matrix.md`. Report Wilson
95% intervals for proportions, participant-paired bootstrap 95% intervals for
continuous differences, effect sizes and AB/BA order strata. If confirmatory
hypothesis tests are added, list the family before inspection and apply Holm's
step-down correction. Ten people per role is formative evidence, not population
proof.
