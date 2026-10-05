import { defineRoute } from "../../shell/routeTypes";
import LifecycleView from "./LifecycleView";

export default defineRoute({
  key: "people/lifecycle",
  names: "roster",
  read: (api, ctx) => api.lifecycleCases(ctx.scope.scope_id),
  View: LifecycleView,
});
