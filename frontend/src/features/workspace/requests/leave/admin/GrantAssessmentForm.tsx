"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../../shared/ConfirmSurface";
import { changedFacts, type Fact } from "../../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../../shared/useStepFocus";
import useUnsavedNavigation from "../../../shared/useUnsavedNavigation";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type GrantAssessmentBody, type GrantAssessmentContext, type GrantAssessmentReport } from "../../api";
import { DayField, SelectField, TextField, WholeNumberField } from "../../../shared/records/fields";

type Basis = "weekly" | "annual" | "shift_actual";
type Draft = {
  account: string; months: number; hours: number; minutes: number; seconds: number; basis: Basis; days: number;
  actualPeriod: "first_six_months" | "previous_year"; actualDays: number; guidelineDays: number | null; guidanceReference: string;
  attended: number; denominator: number; reference: string; verifier: string; cycleBasis: string; cycleReference: string; cycleChecked: boolean;
};
const EMPTY: Draft = { account: "", months: NaN, hours: NaN, minutes: 0, seconds: 0, basis: "weekly", days: NaN, actualPeriod: "first_six_months", actualDays: NaN, guidelineDays: null, guidanceReference: "", attended: NaN, denominator: NaN, reference: "", verifier: "", cycleBasis: "", cycleReference: "", cycleChecked: false };
const BASIS: Record<Basis, string> = { weekly: "週の所定日数", annual: "年の所定日数", shift_actual: "シフト制で所定日数を定めがたい（労働日数の実績）" };
const PERIOD = { first_six_months: "雇入れから6か月", previous_year: "前年" };
const STATUS: Record<string, string> = { pass: "照合一致", mismatch: "付与原本との不一致：人事確認が必要です" };
/** The address to link to, when the value of the response is an absolute https URL; null
 * for anything else (another scheme, a relative address, text), which is shown as text. */
export function sourceLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
const number = (value: number | null) => (value !== null && Number.isFinite(value) ? String(value) : "（なし）");

/**
 * Compares one imported grant with the statutory table, from what HR confirmed about
 * service, attendance and scheduled work. The server computes and judges; this form only
 * collects the confirmed inputs, and shows the server's result or its refusal. Nothing is
 * granted or refused by an assessment.
 */
export default function GrantAssessmentForm({ context, name, reload }: { context: GrantAssessmentContext; name: (personId: string) => string; reload: () => Promise<GrantAssessmentContext | null> }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [assessmentId, setAssessmentId] = useState("");
  // The source the confirmation was opened against (the one read last, after a reviewed
  // conflict); null while entering.
  const [against, setAgainst] = useState<GrantAssessmentContext | null>(null);
  const confirming = against !== null;
  const [rebased, setRebased] = useState(false);
  const [result, setResult] = useState<GrantAssessmentReport | null>(null);
  const send = useConfirmedSend<GrantAssessmentBody, GrantAssessmentReport, GrantAssessmentContext>({
    name: `grant-assessment:${draft.account}`,
    send: (body, key) => api.assessGrant(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: reload,
  });
  useUnsavedNavigation(JSON.stringify(draft) !== JSON.stringify(EMPTY));
  const patch = (next: Partial<Draft>) => { setDraft((old) => ({ ...old, ...next })); setResult(null); };
  const account = context.accounts.find((item) => item.account_id === draft.account);
  // A grant given in advance or in parts is assessed with the whole series HR names.
  const cycle = account?.grant_cycle_id ? context.accounts.filter((item) => item.grant_cycle_id === account.grant_cycle_id && item.person_id === account.person_id && item.employer_id === account.employer_id) : [];
  const grantLabel = (item: GrantAssessmentContext["accounts"][number]) => `${name(item.person_id)}／付与日 ${item.granted_on}／取込済みの法定付与 ${item.statutory_days}日`;
  const shift = draft.basis === "shift_actual";
  const evidence = (reference: string) => ({ reference, verified_by: draft.verifier, status: "verified" });
  const payload: Record<string, unknown> | null = account ? {
    account_id: account.account_id, person_id: account.person_id, employer_id: account.employer_id,
    basis_date: cycle.length ? draft.cycleBasis : account.granted_on,
    completed_service_months: draft.months, scheduled_week_seconds: draft.hours * 3600 + draft.minutes * 60 + draft.seconds,
    schedule_basis: draft.basis, scheduled_week_days: draft.basis === "weekly" ? draft.days : null, scheduled_year_days: draft.basis === "annual" ? draft.days : null,
    ...(shift ? { actual_work_days: draft.actualDays, actual_period: draft.actualPeriod, guideline_year_days: draft.guidelineDays, ...(draft.guidanceReference ? { guidance_confirmation: evidence(draft.guidanceReference) } : {}) } : {}),
    attendance_days: draft.attended, attendance_denominator: draft.denominator, evidence: evidence(draft.reference),
    ...(cycle.length ? { cycle_account_ids: cycle.map((item) => item.account_id), cycle_evidence: evidence(draft.cycleReference) } : {}),
    assessment_id: assessmentId,
  } : null;
  const facts: Fact[] = account ? [
    { label: "照合する付与", text: grantLabel(account) },
    { label: "付与基準日", text: (cycle.length ? draft.cycleBasis : account.granted_on) || "（なし）" },
    ...(cycle.length ? [{ label: "照合する付与系列", text: cycle.map((item) => `${item.granted_on}（法定 ${item.statutory_days}日）`).join("、") }, { label: "系列全体の人事原本参照", text: draft.cycleReference || "（なし）", verbatim: true as const }] : []),
    { label: "確認済み勤続月数", text: number(draft.months) },
    { label: "週の所定労働時間", text: `${number(draft.hours)}時間${draft.minutes}分${draft.seconds}秒` },
    { label: "所定日数の基準", text: BASIS[draft.basis] },
    ...(shift ? [{ label: "実績の期間", text: PERIOD[draft.actualPeriod] }, { label: "労働日数の実績", text: number(draft.actualDays) }, { label: "目安となる労働日数", text: number(draft.guidelineDays) }, { label: "改正前の基準日での人事の確認記録", text: draft.guidanceReference || "（なし）", verbatim: true as const }]
      : [{ label: draft.basis === "weekly" ? "週の所定労働日数" : "年の所定労働日数", text: number(draft.days) }]),
    { label: "出勤率（分子／分母）", text: `${number(draft.attended)}／${number(draft.denominator)}` },
    { label: "付与照合の原本参照", text: draft.reference || "（なし）", verbatim: true },
    { label: "付与照合の確認者", text: draft.verifier || "（なし）", verbatim: true },
  ] : [];
  const link = result ? sourceLink(result.source) : null;
  const source = (value: GrantAssessmentContext | null) => (value ? `原本の第${value.source_revision}版・未解消の差異 ${value.findings.length}件` : "（なし）");

  async function save() {
    if (!payload || !against) return;
    const answer = await send.run({ payload, input_hash: against.input_hash, expected_revision: against.source_revision });
    if (!answer.done) return;
    setResult(answer.result); setDraft(EMPTY); setAgainst(null); setRebased(false);
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("content")}>1. 人事が確認した内容を入力する</h4>
    {context.findings.length > 0 && <p className="ideal-note" role="status">サーバーは、付与の訂正履歴に未解消の差異を {context.findings.length} 件報告しています。照合を受け付けるかどうかは、送信時にサーバーが判定します。</p>}
    {!confirming && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setResult(null); setAssessmentId(crypto.randomUUID()); setRebased(false); setAgainst(context); }}>
      <p className="ideal-note">勤続・出勤率・所定勤務は人事が確認した値を入力します。付与の自動登録や請求の自動拒否は行いません。</p>
      <SelectField label="照合する付与ロット" value={draft.account} options={context.accounts.map((item) => ({ value: item.account_id, label: grantLabel(item) }))} onChange={(next) => patch({ account: next })} />
      {cycle.length > 0 && <fieldset className="ideal-fieldset">
        <legend>前倒し・分割付与の系列照合</legend>
        <ul role="list" className="ideal-note-list">{cycle.map((item) => <li key={item.account_id}>{item.granted_on}：法定 {item.statutory_days} 日</li>)}</ul>
        <DayField label="人事が確認した付与基準日" value={draft.cycleBasis} onChange={(cycleBasis) => patch({ cycleBasis })} />
        <TextField label="系列全体の人事原本参照" value={draft.cycleReference} onChange={(cycleReference) => patch({ cycleReference })} />
        <div className="ideal-inline-field">
          <span className="ideal-check-target"><input id={`${id}-cycle`} type="checkbox" required checked={draft.cycleChecked} onChange={(event) => patch({ cycleChecked: event.target.checked })} /></span>
          <label htmlFor={`${id}-cycle`}>表示された系列に未取込・未確認の付与がないことを原本と照合しました</label>
        </div>
      </fieldset>}
      <WholeNumberField label="確認済み勤続月数" value={draft.months} onChange={(months) => patch({ months })} />
      <WholeNumberField label="週の所定労働時間" value={draft.hours} onChange={(hours) => patch({ hours })} />
      <WholeNumberField label="週の所定労働時間の端数（分）" value={draft.minutes} onChange={(minutes) => patch({ minutes })} />
      <WholeNumberField label="週の所定労働時間の端数（秒）" value={draft.seconds} onChange={(seconds) => patch({ seconds })} />
      <SelectField label="所定日数の基準" value={draft.basis} options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} onChange={(basis) => patch({ basis: basis as Basis })} />
      {shift ? <fieldset className="ideal-fieldset">
        <legend>シフト制の労働日数の実績</legend>
        <SelectField label="実績の期間" value={draft.actualPeriod} options={Object.entries(PERIOD).map(([value, label]) => ({ value, label }))} onChange={(actualPeriod) => patch({ actualPeriod: actualPeriod as Draft["actualPeriod"] })} />
        <WholeNumberField label="労働日数の実績（人事確認済み）" value={draft.actualDays} onChange={(actualDays) => patch({ actualDays })} />
        <WholeNumberField label="目安となる労働日数（定めがある場合のみ・年間に換算した日数）" required={false} value={draft.guidelineDays} onChange={(days) => patch({ guidelineDays: Number.isFinite(days) ? days : null })} />
        <TextField label="改正前の基準日にこの方法を使ったことの人事の確認記録（該当する場合のみ）" required={false} value={draft.guidanceReference} onChange={(guidanceReference) => patch({ guidanceReference })} />
        <p className="ideal-note">実績の日数の範囲と、確認記録が必要かどうか・使えるかどうかは、サーバーが基準日から判定します。</p>
      </fieldset> : <WholeNumberField label={draft.basis === "weekly" ? "週の所定労働日数" : "年の所定労働日数"} value={draft.days} onChange={(days) => patch({ days })} />}
      <WholeNumberField label="出勤率の分子（人事確認済み日数）" value={draft.attended} onChange={(attended) => patch({ attended })} />
      <WholeNumberField label="出勤率の分母（人事確認済み日数）" value={draft.denominator} onChange={(denominator) => patch({ denominator })} />
      <TextField label="付与照合の原本参照" value={draft.reference} onChange={(reference) => patch({ reference })} />
      <TextField label="付与照合の確認者" value={draft.verifier} onChange={(verifier) => patch({ verifier })} />
      <div className="ideal-actions">
        <button type="submit" className="ideal-button ideal-button--primary">照合の内容を確認する</button>
        <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { setDraft(EMPTY); setResult(null); steps.moveTo("content"); }}>入力を破棄する</button>
      </div>
    </form>}
    {against && <ConfirmSurface level={4} title="2. 照合前の確認"
      changes={changedFacts(null, facts)} version={{ from: 0, to: 0 }}
      versionText="記録の版は作られません。照合結果は送信の受付記録として残り、付与や請求は変わりません。"
      notified="誰にも通知されません。照合結果は受付記録として残りますが、監査の履歴には表示されません（受付記録は時刻を持たないため）。"
      risk={`送信前の時点では検出されていません。送信時にサーバーが、付与原本が第${against.source_revision}版のままであることと、訂正履歴に未解消の差異がないことを照合します。違っていれば照合せず、競合として知らせます。`}
      outcome={conflictOutcome(send.outcome, (now) => ({ currentRevision: now?.source_revision ?? null, rows: [
        { label: "照合に使う付与原本", base: source(against), current: source(now), proposed: source(against) },
        ...facts.map((fact) => ({ label: fact.label, base: "（なし）", current: "（なし）", proposed: fact.text, ...(fact.verbatim && { verbatim: true as const }) })),
      ] }))} busy={send.busy}
      confirmLabel="この内容で照合して記録する"
      onConfirm={() => void save()} onBack={() => { send.clear(); setAgainst(null); setRebased(false); steps.moveTo("content"); }}
      onReviewed={() => { if (send.outcome.kind === "conflict" && send.outcome.current) setAgainst(send.outcome.current); send.clear(); setRebased(true); }}>
      {rebased && <p className="ideal-note" role="status">読み直した付与原本（第{against.source_revision}版）に対する照合として確認し直します。付与の内容が変わっていないか確かめて、もう一度送信してください。</p>}
    </ConfirmSurface>}
    {result && <div className="ideal-done" role="status">
      <p><strong>サーバーの照合結果：{STATUS[result.status] ?? "この条件では未確認：人事確認が必要です"}</strong></p>
      <p>表による法定付与：{result.expected_statutory_days ?? "未算定"}日／原本：{result.imported_statutory_days}日</p>
      {result.guidance?.basis_before_revision && !result.guidance.confirmed && <p>サーバーは、基準日が留意事項の改正（{result.guidance.version}）より前で、人事の確認記録がないと答えています。{result.computed_status && `計算上の判定：${result.computed_status === "pass" ? "一致" : "不一致"}`}</p>}
      {link
        ? <p><a className="ideal-inline-link" href={link} rel="noreferrer">サーバーが照合に使った付与表（厚生労働省）</a></p>
        : <p>サーバーが照合に使った付与表：{String(result.source ?? "（なし）")}</p>}
    </div>}
  </div>;
}
