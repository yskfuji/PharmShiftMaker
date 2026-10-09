import { defineRoute } from "../../shell/routeTypes";
import CasesView from "./CasesView";

export default defineRoute({
  key: "operations/cases",
  names: "planning",
  // Every case of the scope; the view keeps the open ones. Options for a duty are read on demand.
  read: (api, ctx) => api.changeCases(ctx.scope.scope_id),
  View: CasesView,
});
