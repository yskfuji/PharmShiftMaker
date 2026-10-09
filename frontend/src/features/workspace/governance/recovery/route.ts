import { defineRoute } from "../../shell/routeTypes";
import RecoveryView from "./RecoveryView";

export default defineRoute({
  key: "governance/recovery",
  names: "none",
  read: (api, ctx) => api.recoveryStatus(ctx.scope.scope_id),
  View: RecoveryView,
});
