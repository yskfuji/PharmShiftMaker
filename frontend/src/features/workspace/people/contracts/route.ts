import { defineRoute } from "../../shell/routeTypes";
import { peopleApi } from "../api";
import ContractsView from "./ContractsView";
import { rosterOf, type Roster } from "./model";

export default defineRoute<Roster>({
  key: "people/contracts",
  names: "roster",
  // One read: the records staged over the latest input version, with the server's staging
  // issues. Of the workflow context only what the route shows is kept (the leave ledger,
  // demands, publications and actuals it also returns are not). What a task needs beyond
  // that (a rule's impact, the current version after a conflict) is read by the task.
  read: async (api, ctx) => rosterOf(await peopleApi(api).rosterContext(ctx.scope.scope_id)),
  View: ContractsView,
});
