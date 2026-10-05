import { defineRoute } from "../../shell/routeTypes";
import AuditView from "./AuditView";

export default defineRoute({
  key: "governance/audit",
  names: "none",
  // The newest page of every category. A chosen category and older pages are read on demand.
  read: (api, ctx) => api.timeline(ctx.scope.scope_id, null, null),
  View: AuditView,
});
