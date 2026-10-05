import type { PlanComparison } from "@/ideal/types";
import type { Seed } from "../../shared/seed";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import Stepper from "../Stepper";
import CompareDrafts from "./CompareDrafts";

export type CompareData = {
  /** The plans the URL lists, in its order. */
  draftIds: string[];
  /** The input they are compared against. */
  inputHash: string;
  /** What the server read for them; null when the URL lists no plan. */
  comparison: Seed<PlanComparison> | null;
};

/** The plans the URL lists, compared by the server with one definition. */
export default function CompareView({ data }: { data: CompareData }) {
  return <div className="ideal-stack">
    <Stepper current={2} />
    {data.comparison
      // Another choice of plans is another comparison: the island starts again from its seed.
      ? <CompareDrafts key={`${data.inputHash}|${data.draftIds.join(",")}`} draftIds={data.draftIds} inputHash={data.inputHash} seed={data.comparison} />
      : <section className="ideal-empty"><h2>比較する案が指定されていません</h2><p>候補生成から3案を作成してください。</p><WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/generate").route}>候補生成へ</WorkspaceLink></section>}
  </div>;
}
