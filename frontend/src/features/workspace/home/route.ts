import { noneWhenMissing } from "../shared/noneWhenMissing";
import { defineRoute } from "../shell/routeTypes";
import HomeView from "./HomeView";
import type { HomeData } from "./model";

export default defineRoute<HomeData>({
  key: "home/index",
  names: "planning",
  // Every part of the home is shown beside the others: one that cannot be read is
  // reported and leaves the rest in place. A pharmacist's home shows their next duty and
  // the consents asked of them, so the scope's counts are not read for it.
  read: async (api, ctx, optional) => {
    const scope = ctx.scope.scope_id;
    const planner = ctx.role !== "PHARMACIST";
    const [calendar, dashboard, daily, stability, cases] = await Promise.all([
      optional("勤務表", noneWhenMissing(api.scheduleCalendar(scope, ctx.period))),
      planner ? optional("ホーム集計", noneWhenMissing(api.dashboard(scope, ctx.period))) : null,
      planner ? optional("当日運用", noneWhenMissing(api.dailyOperations(scope, ctx.day))) : null,
      planner ? optional("変更安定性", noneWhenMissing(api.stability(scope))) : null,
      optional("欠勤・交換", api.changeCases(scope)),
    ]);
    return { calendar, dashboard, daily, stability, cases };
  },
  View: HomeView,
});
