"use client";

import { useRef, useState, type ComponentType } from "react";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TaskDisclosure from "../../shared/TaskDisclosure";
import { hasUnsavedChanges } from "../../shared/useUnsavedNavigation";
import { routeOf } from "../../shell/routeTypes";
import AccountingTransitionEditor from "./editors/AccountingTransitionEditor";
import AgreementEditor from "./editors/AgreementEditor";
import AnnualCalendarEditor from "./editors/AnnualCalendarEditor";
import CapabilityAmendmentEditor from "./editors/CapabilityAmendmentEditor";
import CapabilityEditor from "./editors/CapabilityEditor";
import ContractEditor from "./editors/ContractEditor";
import EmployerEditor from "./editors/EmployerEditor";
import EmploymentEditor from "./editors/EmploymentEditor";
import EstablishmentEditor from "./editors/EstablishmentEditor";
import ManagementModelEditor from "./editors/ManagementModelEditor";
import type { EditorProps } from "./editors/parts";
import PersonEditor from "./editors/PersonEditor";
import RuleDecisionEditor from "./editors/RuleDecisionEditor";
import RuleReviewEditor from "./editors/RuleReviewEditor";
import SiteAttributionDecisionEditor from "./editors/SiteAttributionDecisionEditor";
import { personName, type Roster } from "./model";
import NewStaffSteps, { type StartKind } from "./NewStaffSteps";
import { useSelectedPerson } from "./Selection";

type Task = { kind: string; summary: string; Editor: ComponentType<EditorProps> };
/** One task per record kind, grouped by what the record is about. */
const GROUPS: Array<{ id: string; title: string; tasks: Task[] }> = [
  { id: "staff", title: "職員の記録を登録・改定する", tasks: [
    { kind: "person", summary: "職員を登録・氏名を訂正する", Editor: PersonEditor },
    { kind: "employment", summary: "雇用関係を登録・改定する", Editor: EmploymentEditor },
    { kind: "contract", summary: "契約を登録・改定する", Editor: ContractEditor },
    { kind: "capability", summary: "資格・監督条件を登録する", Editor: CapabilityEditor },
    { kind: "capability_amendment", summary: "資格の取消・失効を記録する", Editor: CapabilityAmendmentEditor },
  ] },
  { id: "facility", title: "施設の記録を登録・変更する", tasks: [
    { kind: "employer", summary: "雇用主を登録・変更する", Editor: EmployerEditor },
    { kind: "establishment", summary: "事業場を登録・変更する", Editor: EstablishmentEditor },
    { kind: "management_model", summary: "兼業の管理モデルを登録・変更する", Editor: ManagementModelEditor },
  ] },
  { id: "rules", title: "規則・協定・判断を登録・変更する", tasks: [
    { kind: "agreement", summary: "36協定を登録・変更する", Editor: AgreementEditor },
    { kind: "rule_review", summary: "規則の適用確認を登録・変更する", Editor: RuleReviewEditor },
    { kind: "rule_decision", summary: "改定規則の公開判断を記録する", Editor: RuleDecisionEditor },
    { kind: "accounting_transition", summary: "制度切替の集計条件を登録・変更する", Editor: AccountingTransitionEditor },
    { kind: "site_attribution_decision", summary: "事業場間の時間外の帰属の判断を登録・変更する", Editor: SiteAttributionDecisionEditor },
    { kind: "annual_calendar", summary: "1年単位の変形労働時間制のカレンダーを登録・変更する", Editor: AnnualCalendarEditor },
  ] },
];

/**
 * What can be done next: the steps of adding a person, and one task per record kind. A
 * task is closed until it is opened; a step opens its task on a new record and moves focus
 * to the task's content step. Which task was started by a step is the only state here.
 */
export default function NextActions({ roster }: { roster: Roster }) {
  const { personId } = useSelectedPerson();
  const tasks = useRef(new Map<string, HTMLDetailsElement>());
  // How often a step has started each task: a start opens the task on a new record.
  const [starts, setStarts] = useState<Partial<Record<string, number>>>({});
  const [held, setHeld] = useState(false);
  function start(kind: StartKind) {
    // A task with entries that are not saved is not replaced.
    if (hasUnsavedChanges()) { setHeld(true); return; }
    setHeld(false);
    const details = tasks.current.get(kind);
    if (details) details.open = true;
    setStarts((old) => ({ ...old, [kind]: (old[kind] ?? 0) + 1 }));
  }
  const chosen = roster.people.some((item) => item.key === personId) ? personId : "";
  return <div className="ideal-v3-record">
    <section aria-labelledby="contracts-next-steps-title">
      <h3 id="contracts-next-steps-title" className="ideal-v3-heading">新しい職員を追加する手順</h3>
      <NewStaffSteps roster={roster} onStart={start} />
      <p className="ideal-note" role="status">{held ? "入力中で保存していない内容があります。その操作を保存するか、「入力を破棄する」で取り消してから、手順を始めてください。" : ""}</p>
    </section>
    {GROUPS.map((group) => <section key={group.id} aria-labelledby={`contracts-next-${group.id}-title`}>
      <h3 id={`contracts-next-${group.id}-title`} className="ideal-v3-heading">{group.title}</h3>
      {group.id === "staff" && chosen && <p className="ideal-note">職員の記録は、選択中の{personName(roster, chosen)}さんのものに絞っています。新しく登録する記録の対象職員にも、この職員が入ります。全員の記録から選ぶには、「現在の状態」で職員の選択を解除してください。</p>}
      {group.tasks.map(({ kind, summary, Editor }) => <TaskDisclosure key={kind} summary={summary} ref={(element) => { if (element) tasks.current.set(kind, element); else tasks.current.delete(kind); }}>
        <Editor key={starts[kind] ?? 0} roster={roster} personId={chosen} opening={starts[kind] ? { initialTarget: "new", focusOnMount: true } : undefined} />
      </TaskDisclosure>)}
    </section>)}
    <p className="ideal-note">保存した記録は、計画の入力には自動で反映されません。計画に使うには、<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の「前提・取込」</WorkspaceLink>で、契約・資格から勤務候補を再導出してください。</p>
  </div>;
}
