import { defineRoute } from "../../shell/routeTypes";
import { governanceApi } from "../api";
import { privacyOf, type PrivacyData } from "./model";
import PrivacyView from "./PrivacyView";

export default defineRoute<PrivacyData>({
  key: "governance/privacy",
  // The privacy purpose: the context reads no publication and no notification, so the route
  // stays reachable while an approved use restriction blocks the ordinary planning reads.
  names: "privacy",
  // One read: the requests the viewer may see, and for an administrator the retention
  // rules, the holds and the scope's people. A person's control, a copy plan, the joint
  // decisions and the backfill candidates are read when their task asks for them.
  read: async (api, ctx) => privacyOf(await governanceApi(api).privacy(ctx.scope.scope_id)),
  View: PrivacyView,
});
