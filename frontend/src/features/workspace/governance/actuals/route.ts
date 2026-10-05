import { defineRoute } from "../../shell/routeTypes";
import { governanceApi } from "../api";
import ActualsView from "./ActualsView";
import { actualsOf, type ActualsData } from "./model";

export default defineRoute<ActualsData>({
  key: "governance/actuals",
  names: "none",
  // One read: the registered actuals with their revision and whether a reconciliation note
  // exists, the names of the scope's people and what the server lets the viewer do. Of the
  // workflow context nothing else is kept; the published duties, the employment revisions
  // and the scheduled hours a recording task needs are read when that task is opened.
  read: async (api, ctx) => actualsOf(await governanceApi(api).actualsContext(ctx.scope.scope_id)),
  View: ActualsView,
});
