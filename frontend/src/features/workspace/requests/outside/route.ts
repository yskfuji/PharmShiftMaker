import { defineRoute } from "../../shell/routeTypes";
import { requestsApi } from "../api";
import OutsideView from "./OutsideView";

export default defineRoute({
  key: "requests/outside",
  names: "planning",
  // The declarations the server lets the viewer see, with the employers and sites they may
  // name and what the server answers the viewer for a change of each declaration.
  read: (api, ctx) => requestsApi(api).declarationContext(ctx.scope.scope_id),
  View: OutsideView,
});
