"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ShowcaseState } from "@/ideal/types";
import { LoadingState } from "@/ideal/ui/atoms";
import RouteFrame from "../shell/RouteFrame";
import RouteProblem from "../shell/RouteProblem";
import type { AnyRouteDefinition } from "../shell/routes";
import { readRoute, type RouteState } from "../shell/routeTypes";
import { LiveProvider, liveFrom } from "../shell/WorkspaceRuntime";
import { syntheticContext } from "./synthetic/context";
import { syntheticRequest } from "./synthetic/transport";

const PROBLEM_STATUS = { failure: 503, conflict: 409 } as const;

/**
 * The same route definition, read function, frame and view as production. Only the
 * transport differs, and the common states are injected into the route's own state model
 * instead of replacing the screen with a generic panel.
 */
export default function ShowcaseRoute({ definition, role, state }: { definition: AnyRouteDefinition; role: IdealRole; state: ShowcaseState }) {
  const empty = state === "empty";
  const ctx = useMemo(() => syntheticContext(role, empty), [role, empty]);
  const client = useMemo(() => createIdealClient("storybook-synthetic", syntheticRequest(empty, role)), [empty, role]);
  const mutate = useMemo(() => createMutator("storybook-synthetic"), []);
  const [result, setResult] = useState<RouteState<unknown> | null>(null);
  const read = useCallback(async () => {
    setResult(await readRoute(definition, client, ctx));
  }, [definition, client, ctx]);
  useEffect(() => {
    if (state === "ready" || state === "empty") void read();
  }, [state, read]);
  const live = useMemo(() => liveFrom(ctx, { client, mutate, refresh: read, isSynthetic: true }), [ctx, client, mutate, read]);

  if (state === "forbidden") return <RouteProblem status={403} detail="" forbiddenRoute />;
  if (state === "failure" || state === "conflict") return <RouteProblem status={PROBLEM_STATUS[state]} detail="合成の状態表示です。" />;
  if (state === "loading" || result === null) return <LoadingState />;
  return <LiveProvider live={live}><RouteFrame definition={definition} state={result} ctx={ctx} /></LiveProvider>;
}
