import type { ScheduleCalendarView } from "@/ideal/types";
import { noneWhenMissing } from "../shared/noneWhenMissing";
import { defineRoute } from "../shell/routeTypes";
import ScheduleView from "./ScheduleView";

export default defineRoute<{ calendar: ScheduleCalendarView | null }>({
  key: "schedule/index",
  names: "planning",
  // The calendar adds the changes from the previous version and the export permission.
  // Without it the selected publication's own duties are still shown.
  read: async (api, ctx, optional) => ({
    calendar: await optional("勤務表", noneWhenMissing(api.scheduleCalendar(ctx.scope.scope_id, ctx.period))),
  }),
  View: ScheduleView,
});
