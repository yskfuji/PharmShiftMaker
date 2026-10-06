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
import { STEPS_HEADING, TASK_GROUPS, type TaskKind } from "./tasks";

/** The form of each task. What a task is called, what its line says and where it stands are
 * declared in ./tasks. */
const EDITORS: Record<TaskKind, ComponentType<EditorProps>> = {
  person: PersonEditor, employment: EmploymentEditor, contract: ContractEditor, capability: CapabilityEditor, capability_amendment: CapabilityAmendmentEditor,
  employer: EmployerEditor, establishment: EstablishmentEditor, management_model: ManagementModelEditor,
  agreement: AgreementEditor, rule_review: RuleReviewEditor, rule_decision: RuleDecisionEditor, accounting_transition: AccountingTransitionEditor,
  site_attribution_decision: SiteAttributionDecisionEditor, annual_calendar: AnnualCalendarEditor,
};

/**
 * What can be done next: the steps of adding a person, and one task per record kind. A
 * task is closed until it is opened; a step opens its task on a new record and moves focus
 * to the task's content step. Which task was started by a step is the only state here.
 * A step's start is the way to a task, not a form of its own: the start carries the arrow
 * of a control that leads down the page, and the task it opens carries the step's number as
 * its tag (./tasks).
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
  return <div className="ideal-v3-record ideal-v3-contracts-next">
    <section aria-labelledby={STEPS_HEADING}>
      <h3 id={STEPS_HEADING} className="ideal-v3-heading ideal-v3-section-nav__target" tabIndex={-1}>新しい職員を追加する手順</h3>
      <NewStaffSteps roster={roster} onStart={start} />
      <p className={held ? "ideal-v3-callout ideal-v3-callout--warn" : "ideal-note"} role="status">{held ? "入力中で保存していない内容があります。その操作を保存するか、「入力を破棄する」で取り消してから、手順を始めてください。" : ""}</p>
    </section>
    {TASK_GROUPS.map((group) => <section key={group.id} aria-labelledby={`contracts-next-${group.id}-title`}>
      <h3 id={`contracts-next-${group.id}-title`} className="ideal-v3-heading">{group.title}</h3>
      {group.id === "staff" && chosen && <p className="ideal-note">職員の記録は、選択中の{personName(roster, chosen)}さんのものに絞っています。新しく登録する記録の対象職員にも、この職員が入ります。全員の記録から選ぶには、「現在の状態」で職員の選択を解除してください。</p>}
      <div className="ideal-v3-task-list">{group.tasks.map(({ kind, summary, hint, step }) => {
        const Editor = EDITORS[kind];
        return <TaskDisclosure key={kind} summary={summary} hint={hint} tag={step} tone="routine" ref={(element) => { if (element) tasks.current.set(kind, element); else tasks.current.delete(kind); }}>
          <Editor key={starts[kind] ?? 0} roster={roster} personId={chosen} opening={starts[kind] ? { initialTarget: "new", focusOnMount: true } : undefined} />
        </TaskDisclosure>;
      })}</div>
    </section>)}
    <p className="ideal-v3-callout">保存した記録は、計画の入力には自動で反映されません。計画に使うには、<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の「前提・取込」</WorkspaceLink>で、契約・資格から勤務候補を再導出してください。</p>
  </div>;
}
