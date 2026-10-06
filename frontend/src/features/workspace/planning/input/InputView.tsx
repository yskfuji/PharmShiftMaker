import { useId } from "react";
import { ChevronRight } from "lucide-react";
import type { InputLatest } from "@/ideal/api/client";
import { StatusPill } from "@/ideal/ui/atoms";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import DemandSection from "./demand/DemandSection";
import type { DemandState } from "./demand/model";
import DeriveCandidates from "./DeriveCandidates";
import ImportInput from "./ImportInput";
import { periodDays } from "./period";
import RefreshInput from "./RefreshInput";

export type InputData = { input: InputLatest; demand: DemandState | null };

/** What the input version on screen holds: the counts of its own snapshot, as the server
 * registered it (GET /planning/inputs/latest). Records saved after it are not in these
 * counts; the server says so with `stale`. */
function InputSummary({ input }: { input: InputLatest }) {
  const snapshot = input.snapshot;
  const rows = [
    ["対象期間", snapshot.period ? periodDays(snapshot.period) : "未確認"],
    ["職員", `${snapshot.people.length}名`],
    ["契約", `${snapshot.contracts?.length ?? 0}件`],
    ["資格", `${snapshot.capabilities?.length ?? 0}件`],
    ["必要配置", `${snapshot.demands?.length ?? 0}件`],
    ["勤務候補", `${snapshot.candidates?.length ?? 0}件`],
  ];
  return <dl className="ideal-definition-list ideal-v3-planning-facts">{rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

/** What an original that is not confirmed means for the steps that follow, said beside the
 * table that shows the state. From the code: a demand whose evidence is not `verified` (or
 * whose confirmation expires before the demand ends) is a finding of the input
 * (validation/planning.py:51-56, :202-204); with any finding of the input the solver returns
 * BLOCKED without making a plan (optimizer/planning.py:202-206), and a plan with any finding
 * is not publishable (domain/planning.py:374-376; application/planning.py:649-651). That the
 * input is current (`stale`) says nothing of it. */
const UNCONFIRMED_DEMAND = "原本確認が「確認済み」でない必要配置（確認の有効期限が、その時間帯の終わりより前に切れるものを含みます）が入力版に1件でもあると、候補生成は案を作らずに「停止中」で終わり、公開もできません。上の「前提は最新」は、入力版を作ったあとに記録が変わっていないことだけを示し、原本確認の状態は含みません。";

/** The premises of a plan: the input version, what it holds and whether the server still
 * holds it current; the required staffing as the next input version will have it; and for
 * administrators the three ways a new input version is made (applying requests and actuals,
 * deriving candidates, importing a file). The step that follows is the filled action while
 * the server says the input is current; when it says the input is stale, deriving again is
 * (the header then reads 「再導出が必要」). */
export default function InputView({ data: { input: data, demand }, ctx }: { data: InputData; ctx: RouteContext }) {
  const id = useId();
  const admin = ctx.role === "ADMIN";
  return <div className="ideal-stack">
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">入力版 第{data.input_revision}版</span><h2>生成前提を確定</h2><p>案を作るもとになる入力版の中身と、そのあとに記録が変わっていないかを確かめます。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "再導出が必要" : "前提は最新"}</StatusPill></section>
    <section className="ideal-panel" aria-labelledby={`${id}-check`}><h2 id={`${id}-check`}>この入力版に含まれる数</h2><InputSummary input={data} />
      {data.stale
        ? <p className="ideal-v3-callout ideal-v3-callout--warn" role="alert">申請・実績または原本が更新されています。この入力版のまま生成しないでください。</p>
        : <p className="ideal-note ideal-v3-planning-input-verdict">この入力版を作ったあとに、申請・実績・契約などの記録は変わっていません（システムが確かめた結果です）。</p>}
      <RefreshInput revision={data.input_revision} admin={admin} />
    </section>
    <section className="ideal-panel ideal-v3-planning-input-demand" aria-labelledby={`${id}-demand`}><h2 id={`${id}-demand`}>必要配置・資格要件を確認・編集</h2>
      <p className="ideal-note">時間帯ごとの必要配置を、原本確認付きで登録します。下の一覧は、次に作る入力版に入る内容です（この入力版の値に、保存済みの記録を重ねています）。保存した必要配置は、新しい入力版を作るまで案の作成には使われません。</p>
      <p className="ideal-v3-callout">{UNCONFIRMED_DEMAND}</p>
      <DemandSection state={demand} inputRevision={data.input_revision} admin={admin} />
    </section>
    {admin && <div className="ideal-v3-planning-pair"><DeriveCandidates revision={data.input_revision} stale={data.stale} /><ImportInput revision={data.input_revision} /></div>}
    <div className="ideal-v3-planning-next"><p className="ideal-note">前提を確かめたら、次の工程で3つの案を作ります。</p><WorkspaceLink className={data.stale ? "ideal-button ideal-button--secondary" : "ideal-button ideal-button--primary"} route={routeOf("plan/generate").route}>前提を確認して候補生成へ <ChevronRight aria-hidden="true" /></WorkspaceLink></div>
  </div>;
}
