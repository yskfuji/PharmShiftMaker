import type { Draft, InputLatest } from "@/ideal/api/client";
import type { Seed } from "../../shared/seed";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import DraftEditor from "./DraftEditor";

export type DraftSource = {
  candidates: NonNullable<InputLatest["snapshot"]["candidates"]>;
  inputRevision: number;
  inputHash: string;
  publicationVersion: number;
  /** The month the input plans, YYYY-MM: where the schedule opens after publishing. */
  period: string;
  /** The plan the URL names; null when it names none. */
  draftId: string | null;
  /** What the server read for that plan; null when the URL names none. */
  draft: Seed<Draft> | null;
};

/** One plan: its assignments edited, checked by the server and published, in that order. */
export default function DraftsView({ data, ctx }: { data: DraftSource; ctx: RouteContext }) {
  return <div className="ideal-stack">
    {data.draftId && data.draft
      // Another plan is another edit: the island starts again from its seed.
      ? <DraftEditor key={data.draftId} source={data} draftId={data.draftId} seed={data.draft} scopeName={ctx.scope.display_name} />
      : <section className="ideal-empty"><h2>確認する案が指定されていません</h2><WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/compare").route}>案比較へ</WorkspaceLink></section>}
  </div>;
}
