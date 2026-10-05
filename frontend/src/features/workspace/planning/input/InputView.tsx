import { useId } from "react";
import { ChevronRight } from "lucide-react";
import type { InputLatest } from "@/ideal/api/client";
import { StatusPill } from "@/ideal/ui/atoms";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import Stepper from "../Stepper";
import DemandSection from "./demand/DemandSection";
import type { DemandState } from "./demand/model";
import DeriveCandidates from "./DeriveCandidates";
import ImportInput from "./ImportInput";
import RefreshInput from "./RefreshInput";

export type InputData = { input: InputLatest; demand: DemandState | null };

function InputSummary({ input }: { input: InputLatest }) {
  const snapshot = input.snapshot;
  const rows = [
    ["対象期間", snapshot.period ? `${snapshot.period.start.slice(0, 10)}〜${snapshot.period.end.slice(0, 10)}` : "未確認"],
    ["職員", `${snapshot.people.length}名`],
    ["契約", `${snapshot.contracts?.length ?? 0}件`],
    ["資格", `${snapshot.capabilities?.length ?? 0}件`],
    ["必要配置", `${snapshot.demands?.length ?? 0}件`],
    ["勤務候補", `${snapshot.candidates?.length ?? 0}件`],
  ];
  return <dl className="ideal-definition-list">{rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

/** The premises of a plan: the input version and whether it is still current, the
 * required staffing, and for administrators the three ways a new input version is made
 * (applying requests and actuals, deriving candidates, importing a file). */
export default function InputView({ data: { input: data, demand }, ctx }: { data: InputData; ctx: RouteContext }) {
  const id = useId();
  const admin = ctx.role === "ADMIN";
  return <div className="ideal-stack">
    <Stepper current={0} />
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">入力版 {data.input_revision}</span><h2>生成前提を確定</h2><p>入力元、契約・資格、必要配置、古い版の有無を一つずつ確認します。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "再導出が必要" : "前提は最新"}</StatusPill></section>
    <section className="ideal-panel" aria-labelledby={`${id}-check`}><h2 id={`${id}-check`}>前提チェック</h2><InputSummary input={data} />
      {data.stale && <p className="ideal-note" role="alert">申請・実績または原本が更新されています。この入力版のまま生成しないでください。</p>}
      <RefreshInput revision={data.input_revision} admin={admin} />
    </section>
    <details className="ideal-v3-disclosure"><summary>必要配置・資格要件を確認・編集</summary><div className="ideal-panel"><p>対象入力版に対する時間帯別の必要配置を、原本確認付きで登録します。登録後は入力版を再導出してください。</p><DemandSection state={demand} inputRevision={data.input_revision} admin={admin} /></div></details>
    {admin && <DeriveCandidates revision={data.input_revision} />}
    {admin && <ImportInput revision={data.input_revision} />}
    <WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/generate").route}>前提を確認して候補生成へ <ChevronRight aria-hidden="true" /></WorkspaceLink>
  </div>;
}
