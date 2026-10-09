"use client";

import { regimeLabel } from "@/lib/regimeLabels";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { CheckField, SelectField, WholeNumberField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type ContractPayload, type RecordSaved } from "../../api";
import { contractFacts } from "../facts";
import { ENGAGEMENT, TIME_CATEGORY, WEEKDAY_OPTIONS, agreementLabel, contractLabel, employerName, ofPerson, periodText, personOptions } from "../model";
import { ChoiceGroup, OneOfField, PeriodFields, SecondsField, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

const REGIMES = ["general", "variable", "flex", "exempt"].map((value) => ({ value, label: regimeLabel(value) }));
const entries = <K extends string>(labels: Record<K, string>) => (Object.entries(labels) as Array<[K, string]>).map(([value, label]) => ({ value, label }));

const newContract = (scopeId: string, personId: string): ContractPayload => {
  const [facility_id, department_id] = scopeId.split("/");
  return {
    revision_id: crypto.randomUUID(), relationship_id: "", person_id: personId, employer_id: "", facility_id, department_id, start: "", end: "",
    engagement: "direct", fixed_term: false, time_category: "full_time", regime: "general",
    evidence: { ...EMPTY_RECORD_EVIDENCE }, regime_evidence: { ...EMPTY_RECORD_EVIDENCE }, dispatch_evidence: null, dispatch_tasks: [],
    external_work_confirmed: false, allowed_weekdays: [0, 1, 2, 3, 4, 5, 6], allowed_kinds: [],
    period_min_seconds: 0, period_max_seconds: 0, contractual_week_seconds: 144000, rest_seconds: 0, max_consecutive_days: 6, overtime_agreement_id: null,
  };
};

/** Registers or revises one contract revision of a person in this department: the
 * employment relationship it belongs to, its period, the terms that bound the person's
 * duties and the evidence of each. */
export default function ContractEditor({ roster, personId, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<ContractPayload, RecordSaved>
    noun="契約" contentTitle="契約の内容と根拠を入力する"
    records={ofPerson(roster.contracts, personId).map((item) => ({ ...item, label: contractLabel(roster, item.payload) }))}
    create={() => newContract(live.scopeId, personId)}
    facts={(payload) => contractFacts(roster, payload)}
    fields={({ value, onChange }) => {
      // The person's employment revisions first, then their contracts: one entry per relationship.
      const own = [...roster.employments, ...roster.contracts].map((item) => item.payload).filter((item) => item.person_id === value.person_id);
      const relationships = Array.from(new Map(own.map((item) => [item.relationship_id, item])).values());
      const kinds = Array.from(new Set([...roster.duties.map((duty) => duty.kind), ...(value.allowed_kinds ?? [])]));
      const tasks = Array.from(new Set([...roster.duties.map((duty) => duty.task), ...(value.dispatch_tasks ?? [])]));
      const saved = roster.agreements.filter((item) => item.revision > 0);
      const agreements = [
        ...saved.map((item) => ({ value: item.key, label: agreementLabel(roster, item.payload) })),
        ...(value.overtime_agreement_id && !saved.some((item) => item.key === value.overtime_agreement_id) ? [{ value: value.overtime_agreement_id, label: "現在の契約に指定された協定" }] : []),
      ];
      return <>
        <SelectField label="対象職員" value={value.person_id} options={personOptions(roster)} onChange={(person_id) => onChange({ person_id, relationship_id: "", employer_id: "" })} />
        <SelectField label="適用する雇用関係" value={value.relationship_id} options={relationships.map((item) => ({ value: item.relationship_id, label: `${employerName(roster, item.employer_id)}（${periodText(item.start, item.end)}）` }))}
          onChange={(relationship_id) => { const source = own.find((item) => item.relationship_id === relationship_id); if (source) onChange({ relationship_id, employer_id: source.employer_id }); }} />
        <p className="ideal-note">契約は、いま表示している施設・部署のものとして登録します。</p>
        <PeriodFields start={value.start} end={value.end} onChange={onChange} />
        <OneOfField label="雇用形態" value={value.engagement} options={entries(ENGAGEMENT)} onChange={(engagement) => onChange({ engagement })} />
        <CheckField label="有期契約" checked={value.fixed_term} onChange={(fixed_term) => onChange({ fixed_term })} />
        <OneOfField label="勤務時間区分" value={value.time_category} options={entries(TIME_CATEGORY)} onChange={(time_category) => onChange({ time_category })} />
        <OneOfField label="労働時間制度" value={value.regime} options={REGIMES.some((option) => option.value === value.regime) ? REGIMES : [...REGIMES, { value: value.regime, label: regimeLabel(value.regime) }]} onChange={(regime) => onChange({ regime })} />
        <ChoiceGroup legend="勤務できる曜日" sorted options={WEEKDAY_OPTIONS.map((option) => ({ value: option.value, label: option.label.slice(0, 1) }))} selected={value.allowed_weekdays} onChange={(allowed_weekdays) => onChange({ allowed_weekdays })} />
        <ChoiceGroup legend="勤務できる種類" options={kinds.map((kind) => ({ value: kind, label: kind }))} selected={value.allowed_kinds} onChange={(allowed_kinds) => onChange({ allowed_kinds })} empty="入力版に勤務の種類がありません。" />
        <SecondsField label="対象期間の契約下限" value={value.period_min_seconds} onChange={(period_min_seconds) => onChange({ period_min_seconds })} />
        <SecondsField label="対象期間の契約上限" value={value.period_max_seconds} onChange={(period_max_seconds) => onChange({ period_max_seconds })} />
        <SecondsField label="週の所定労働時間" value={value.contractual_week_seconds} onChange={(contractual_week_seconds) => onChange({ contractual_week_seconds })} />
        <SecondsField label="勤務間休息時間" value={value.rest_seconds} onChange={(rest_seconds) => onChange({ rest_seconds })} />
        <WholeNumberField label="最大連続勤務日数" value={value.max_consecutive_days} onChange={(max_consecutive_days) => onChange({ max_consecutive_days })} />
        <CheckField label="兼業の有無と勤務情報を確認した" checked={value.external_work_confirmed} onChange={(external_work_confirmed) => onChange({ external_work_confirmed })} />
        <SelectField label="適用する協定（任意）" required={false} value={value.overtime_agreement_id ?? ""} options={agreements} onChange={(chosen) => onChange({ overtime_agreement_id: chosen || null })} />
        {value.engagement === "agency" && <ChoiceGroup legend="派遣を認める業務" options={tasks.map((task) => ({ value: task, label: task }))} selected={value.dispatch_tasks ?? []} onChange={(dispatch_tasks) => onChange({ dispatch_tasks })} empty="入力版に業務がありません。" />}
        <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
        <RecordEvidenceFields name="労働時間制度の確認" value={value.regime_evidence} onChange={(patch) => onChange({ regime_evidence: { ...value.regime_evidence, ...patch } })} />
        {value.engagement === "agency" && <RecordEvidenceFields name="派遣の適用根拠" value={value.dispatch_evidence ?? EMPTY_RECORD_EVIDENCE}
          onChange={(patch) => onChange({ dispatch_evidence: { ...(value.dispatch_evidence ?? EMPTY_RECORD_EVIDENCE), ...patch } })} />}
        <p className="ideal-note">労働時間制度や上限が契約として成り立つかどうか、協定や派遣の根拠が足りるかどうかは、サーバーが検証で判定します。</p>
      </>;
    }}
    // Entry slips, not judgements: a period that runs forward, and a kind of duty to work.
    slip={(payload) => runsForward(payload) ?? (payload.allowed_kinds?.length ? null : "勤務できる種類を1つ以上選んでください。")}
    mutation={(payload) => `record:contract:${payload.revision_id}`}
    send={(body) => api.saveContract(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.contracts.find((item) => item.key === payload.revision_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("契約")} saved={savedNotice("契約")}
    refusedChange="登録済みの契約の対象職員は変えられません。別の職員の契約は、新しく登録してください。" {...opening} />;
}
