import { defineRoute } from "../../shell/routeTypes";
import { settingsApi } from "../api";
import FlextimeView from "./FlextimeView";
import { settlementOrNotYet, type FlextimeData } from "./model";

export default defineRoute<FlextimeData>({
  key: "settings/flextime",
  names: "none",
  // The facility's adoptions and participants, with what the server lets the viewer do with
  // each, are the route. The settlement is a part of the view: it is computed from the
  // latest registered input version of the scope (the one the URL names with `?input=`,
  // when it names one), which the server resolves itself. When there is no such version
  // yet, the section says so; when the read fails otherwise, the rest is still shown. The
  // impact of a confirmation is read by its task.
  read: async (api, ctx, optional) => {
    const flex = settingsApi(api);
    const scope = ctx.scope.scope_id;
    const [listing, settlement] = await Promise.all([
      flex.flexAdoptions(scope),
      optional("フレックスタイム制の清算", settlementOrNotYet(ctx.selectedInputHash ? flex.flexSettlementsOf(scope, ctx.selectedInputHash) : flex.flexSettlements(scope))),
    ]);
    return { listing, settlement };
  },
  View: FlextimeView,
});
