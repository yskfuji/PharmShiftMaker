import { defineRoute } from "../../shell/routeTypes";
import MembershipsView from "./MembershipsView";

export default defineRoute({
  key: "people/memberships",
  names: "roster",
  read: (api, ctx) => api.memberships(ctx.scope.scope_id, false),
  View: MembershipsView,
});
