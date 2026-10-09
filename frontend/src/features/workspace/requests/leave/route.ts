import { defineRoute } from "../../shell/routeTypes";
import { requestsApi } from "../api";
import LeaveView, { type LeaveData } from "./LeaveView";
import { ledgerState, ownSources } from "./model";

export default defineRoute<LeaveData>({
  key: "requests/leave",
  names: "planning",
  // The requests the server lets the viewer see are the route. The ledger (balances, the
  // five-day obligation, findings) and the viewer's own grants and leave rules are parts of
  // the view: when one cannot be read, the rest is still shown and nothing is claimed about
  // it. What only the ledger tasks need is read when a task is opened.
  read: async (api, ctx, optional) => {
    const requests = requestsApi(api);
    const scope = ctx.scope.scope_id;
    const [rows, report, records] = await Promise.all([
      requests.leaveRequests(scope),
      optional("年休台帳", requests.leaveReport(scope)),
      optional("年休の付与・規則", requests.records(scope)),
    ]);
    return { requests: rows, ledger: report && ledgerState(report), sources: records && ownSources(records, ctx.scope.person_id) };
  },
  View: LeaveView,
});
