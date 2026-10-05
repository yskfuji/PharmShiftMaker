import { defineRoute } from "../../shell/routeTypes";
import GenerateView, { type GenerateData } from "./GenerateView";

export default defineRoute<GenerateData>({
  key: "plan/generate",
  names: "none",
  // The input version the three plans are made from. Jobs are started and followed by
  // the island; none exists before the planner asks for them.
  read: async (api, ctx) => {
    const input = await api.inputLatest(ctx.scope.scope_id);
    return { revision: input.input_revision, inputHash: input.input_hash, stale: input.stale };
  },
  View: GenerateView,
});
