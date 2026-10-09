import { defineRoute } from "../../shell/routeTypes";
import AppearanceView from "./AppearanceView";

export default defineRoute({
  key: "settings/appearance",
  names: "none",
  read: async () => null,
  View: AppearanceView,
});
