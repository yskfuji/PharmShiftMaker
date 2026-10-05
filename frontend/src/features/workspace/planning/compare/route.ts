import { noneWhenMissing } from "../../shared/noneWhenMissing";
import { seedOf } from "../../shared/seed";
import { defineRoute } from "../../shell/routeTypes";
import CompareView, { type CompareData } from "./CompareView";

export default defineRoute<CompareData>({
  key: "plan/compare",
  names: "none",
  // The comparison of the plans the URL lists, against the input it names or, when it names
  // none, the latest input (read only then). Without plans in the URL nothing is read. A
  // comparison the API refuses is shown in its panel, where it can be read again.
  read: async (api, ctx, optional) => {
    const draftIds = ctx.selectedDraftIds;
    if (!draftIds.length) return { draftIds, inputHash: "", comparison: null };
    const inputHash = ctx.selectedInputHash
      ?? (await optional("入力版", noneWhenMissing(api.inputLatest(ctx.scope.scope_id))))?.input_hash
      ?? "";
    return { draftIds, inputHash, comparison: await seedOf(api.comparison(ctx.scope.scope_id, inputHash, draftIds)) };
  },
  View: CompareView,
});
