import { defineRoute } from "../../shell/routeTypes";
import AbsenceConsentView from "./AbsenceConsentView";

export default defineRoute({
  key: "settings/absence-consent",
  names: "none",
  read: (api, ctx) => api.scopeSettings(ctx.scope.scope_id),
  View: AbsenceConsentView,
});
