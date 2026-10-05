import { defineRoute } from "../../shell/routeTypes";
import SwapView from "./SwapView";

export default defineRoute({
  key: "requests/swap",
  names: "planning",
  // The cases the server lets the viewer see. Options for a duty are read on demand.
  read: (api, ctx) => api.changeCases(ctx.scope.scope_id),
  View: SwapView,
});
