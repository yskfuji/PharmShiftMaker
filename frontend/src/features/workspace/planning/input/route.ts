import { defineRoute } from "../../shell/routeTypes";
import { planningApi } from "../api";
import { demandState } from "./demand/model";
import InputView, { type InputData } from "./InputView";

export default defineRoute<InputData>({
  key: "plan/input",
  names: "none",
  // The latest input version of the scope, then the required staffing registered for that
  // version. The staffing is a part of the view: when it cannot be read, the premises are
  // still shown. Of the workflow context only what the staffing editor needs is kept.
  read: async (api, ctx, optional) => {
    const scope = ctx.scope.scope_id;
    const input = await api.inputLatest(scope);
    const context = await optional("必要配置", planningApi(api).demandContext(scope, input.input_hash));
    return { input, demand: context && demandState(context, input.input_hash) };
  },
  View: InputView,
});
