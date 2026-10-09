import type { WorkspaceNotification } from "@/ideal/types";
import { defineRoute } from "../../shell/routeTypes";
import PublicationsView from "./PublicationsView";

export default defineRoute<{ notices: WorkspaceNotification[] | null }>({
  key: "plan/publications",
  names: "none",
  // The publications and the viewer's notifications are part of every route's context, so
  // this route reads nothing of its own. Without the notifications (the context has
  // reported that) the publications are still shown and can be cancelled.
  read: async (_api, ctx) => ({ notices: ctx.notificationsRead ? ctx.notifications : null }),
  View: PublicationsView,
});
