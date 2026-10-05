"use client";

import { problemFrom } from "@/ideal/api/errors";
import type { ProblemModel } from "@/ideal/model";
import { ProblemState } from "@/ideal/ui/atoms";
import { browserNavigation } from "@/lib/browserNavigation";
import { loginPath } from "@/lib/loginPath";
import { PlanningError } from "@/lib/planningTransport";

/** The viewer's role may not open this route; the server did not read it. */
export const FORBIDDEN_ROUTE: ProblemModel = {
  kind: "forbidden",
  code: "403",
  title: "この画面は、あなたの役割では開けません",
  body: "権限のある業務だけを表示します。URLや識別子を書き換えてもサーバー側で拒否されます。",
  action: "今日へ",
};

/** A route that could not be read. Nothing was changed, so every action is a reload,
 * a sign-in or a way back to the entry. */
export default function RouteProblem({ status, detail, forbiddenRoute = false }: { status: number; detail: string; forbiddenRoute?: boolean }) {
  const problem = forbiddenRoute ? FORBIDDEN_ROUTE : problemFrom(new PlanningError(status, detail), "read");
  const act = () => {
    if (forbiddenRoute) browserNavigation.replace("/workspace/home");
    else if (problem.kind === "unauthenticated") browserNavigation.replace(loginPath(browserNavigation.pathAndSearch(), "expired"));
    else browserNavigation.reload();
  };
  return <ProblemState problem={problem} onAction={act} />;
}
