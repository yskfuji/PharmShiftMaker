import { defineRoute } from "../../shell/routeTypes";
import DirectoryView from "./DirectoryView";
import { directoryOf } from "./model";

export default defineRoute({
  key: "people/directory",
  names: "roster",
  read: async (api, ctx, optional) => {
    const scope = ctx.scope.scope_id;
    const [memberships, context, cases] = await Promise.all([
      api.memberships(scope, false),
      api.directoryRecords(scope),
      // The directory only summarises a person's cases; without them it is still usable.
      optional("入職・退職", api.lifecycleCases(scope)),
    ]);
    // Only the people and their two counts leave the server; the rest of the context does not.
    return { memberships, records: directoryOf(context), cases: cases ?? [] };
  },
  View: DirectoryView,
});
