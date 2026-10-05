"use client";

import { newStaffProgress, type StaffStep, type StepStatus } from "@/lib/newStaffProgress";
import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf } from "../../shell/routeTypes";
import type { Roster } from "./model";
import { useSelectedPerson } from "./Selection";

/** The record tasks a step can start. */
export type StartKind = "person" | "employer" | "establishment" | "employment" | "contract" | "capability";

const TITLE: Record<StaffStep, string> = {
  person: "職員の氏名を登録する",
  site: "雇用主と事業場を用意する（施設で一度だけ）",
  employment: "雇用関係を登録する",
  contract: "契約を登録する",
  capability: "担当できる業務（資格）を登録する",
  reflect: "計画の入力に反映する",
};
const STARTS: Record<Exclude<StaffStep, "reflect">, Array<{ kind: StartKind; text: string }>> = {
  person: [{ kind: "person", text: "氏名の登録を始める" }],
  site: [{ kind: "employer", text: "雇用主の登録を始める" }, { kind: "establishment", text: "事業場の登録を始める" }],
  employment: [{ kind: "employment", text: "雇用関係の登録を始める" }],
  contract: [{ kind: "contract", text: "契約の登録を始める" }],
  capability: [{ kind: "capability", text: "資格の登録を始める" }],
};
const STATUS: Record<StepStatus, { text: string; tone: "good" | "info" | "neutral" }> = {
  done: { text: "記録あり", tone: "good" },
  todo: { text: "記録なし", tone: "info" },
  blocked: { text: "前の手順が先", tone: "neutral" },
  elsewhere: { text: "計画の画面で行う", tone: "neutral" },
};

/**
 * The order in which a new person's records depend on each other, with what exists for the
 * chosen person. A step says only whether its record exists (not whether it is valid: that
 * is the server's validation) and starts the task that registers it. It is a list to work
 * from, not a forced sequence: every task can also be opened below.
 */
export default function NewStaffSteps({ roster, onStart }: { roster: Roster; onStart: (kind: StartKind) => void }) {
  const { personId } = useSelectedPerson();
  const person = roster.people.find((item) => item.key === personId);
  const payloads = <P,>(records: Array<{ payload: P }>) => records.map((item) => item.payload as P & Record<string, unknown>);
  const steps = newStaffProgress({
    people: roster.people.map((item) => item.payload), sites: payloads(roster.establishments), employments: payloads(roster.employments),
    contracts: payloads(roster.contracts), capabilities: payloads(roster.capabilities),
  }, person ? personId : "");
  return <>
    <p className="ideal-note">{person
      ? `${person.payload.name}さんについて、どの記録があるかを表示しています。`
      : "まだ登録していない新しい職員の手順です。氏名を登録した後、「現在の状態」の職員一覧でその職員を選ぶと、その職員の記録の有無を表示します。"}
      記録は1件ずつ保存され、途中でやめても保存済みの分は残ります。記録が条件を満たすかどうかは、サーバーの検証結果で確認してください。</p>
    <ol className="ideal-task-list" aria-label="新しい職員を追加する手順">{steps.map((state, index) => <li key={state.step} className={state.status === "done" ? "is-done" : state.status === "todo" ? "is-current" : undefined}>
      <span aria-hidden="true">{state.status === "done" ? "✓" : index + 1}</span>
      <div>
        <strong>{index + 1}. {TITLE[state.step]}</strong>
        <StatusPill tone={STATUS[state.status].tone}>{STATUS[state.status].text}</StatusPill>
        {state.reason && <small>{state.reason}</small>}
        {state.step === "reflect"
          ? <small>登録しただけでは、計画の入力には入りません。<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の「前提・取込」</WorkspaceLink>で入力を再導出します。</small>
          : state.status !== "blocked" && <div className="ideal-actions">{STARTS[state.step].map((start) => <button key={start.kind} type="button" className="ideal-button ideal-button--secondary" onClick={() => onStart(start.kind)}>{start.text}</button>)}</div>}
      </div>
    </li>)}</ol>
  </>;
}
