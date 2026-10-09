import RouteNotices from "./RouteNotices";
import RouteProblem from "./RouteProblem";
import type { RouteContext, RouteDefinition, RouteState } from "./routeTypes";

/** One route as the viewer sees it: its own problem, or its notices and its view. The
 * same frame is used with the real API and with synthetic data. */
export default function RouteFrame<T>({ definition, state, ctx }: { definition: RouteDefinition<T>; state: RouteState<T>; ctx: RouteContext }) {
  if (state.kind === "problem") return <RouteProblem status={state.status} detail={state.detail} />;
  const View = definition.View;
  return <>
    <RouteNotices partial={state.partial} />
    <View data={state.data} ctx={ctx} />
  </>;
}
