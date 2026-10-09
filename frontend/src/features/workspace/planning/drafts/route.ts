import { seedOf } from "../../shared/seed";
import { defineRoute } from "../../shell/routeTypes";
import DraftsView, { type DraftSource } from "./DraftsView";

export default defineRoute<DraftSource>({
  key: "plan/drafts",
  // The candidate duties are shown with the names of the people they belong to.
  names: "planning",
  // The input the plan was made from (its candidate duties and the versions a publication
  // is checked against; the same request that gives the context its names), and the plan
  // the URL names. A plan the API refuses is shown in its panel, where it can be read again.
  read: async (api, ctx) => {
    const draftId = ctx.selectedDraftIds[0] ?? null;
    const [input, draft] = await Promise.all([
      api.inputLatest(ctx.scope.scope_id),
      draftId ? seedOf(api.draft(ctx.scope.scope_id, draftId)) : null,
    ]);
    return {
      candidates: input.snapshot.candidates ?? [],
      inputRevision: input.input_revision,
      inputHash: input.input_hash,
      publicationVersion: input.publication_version,
      period: input.snapshot.period.start.slice(0, 7),
      draftId,
      draft,
    };
  },
  View: DraftsView,
});
