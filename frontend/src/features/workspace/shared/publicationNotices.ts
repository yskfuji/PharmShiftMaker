/** The kinds of notice whose `publication_id` and `version` are a publication's own: a
 * publication, and the approval of an absence or swap case, which publishes the changed
 * schedule as a new version and puts that publication into its notice
 * (application/planning.py, publish; application/ideal_workflows.py, approve_change_case:
 * `published["publication_id"]`, `published["version"]`). No other kind the server sends
 * carries a publication; a cancellation's `version` is the number of the period's head. */
export const PUBLICATION_NOTICES: ReadonlySet<string> = new Set(["schedule.published", "change.approved"]);
