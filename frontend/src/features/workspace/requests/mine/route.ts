import { defineRoute } from "../../shell/routeTypes";
import MineView from "./MineView";

export default defineRoute({
  key: "requests/mine",
  names: "planning",
  // The cases the server lets the viewer see. Options for a duty are read on demand.
  read: (api, ctx) => api.changeCases(ctx.scope.scope_id),
  View: MineView,
});
