import { defineRoute } from "../../shell/routeTypes";
import TodayView from "./TodayView";

export default defineRoute({
  key: "operations/today",
  names: "planning",
  read: (api, ctx) => api.dailyOperations(ctx.scope.scope_id, ctx.day),
  View: TodayView,
});
