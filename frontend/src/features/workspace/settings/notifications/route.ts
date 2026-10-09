import { defineRoute } from "../../shell/routeTypes";
import NotificationsView from "./NotificationsView";

export default defineRoute({
  key: "settings/notifications",
  names: "none",
  // The viewer's notifications are part of every route's context (the shell counts them),
  // so this route reads nothing of its own. `null`: they could not be read, and the context
  // has reported it; then the view claims nothing.
  read: async (_api, ctx) => (ctx.notificationsRead ? ctx.notifications : null),
  View: NotificationsView,
});
