"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { confirmOutcome } from "../../shared/records/confirmOutcome";
import { changedFacts } from "../../shared/records/facts";
import { CheckField, DayField, TextField, WholeNumberField } from "../../shared/records/fields";
import { useRecordSave, type RecordVersion } from "../../shared/records/useRecordSave";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type RetentionPolicy, type RetentionRule, type RetentionRuleBody, type RuleSaved } from "../api";
import { ANCHORS, CATEGORIES, anchorLabel, categoryLabel, ruleFacts, ruleOf } from "./model";

type Draft = { purpose: string; days: number | null; minimum: number | null; from: string; until: string; owner: string; review: string; reference: string; reviewer: string; verified: boolean };
const draftOf = (policy: RetentionPolicy | undefined): Draft => ({
  purpose: policy?.purpose ?? "", days: policy?.retention_days ?? null, minimum: policy?.legal_minimum_days ?? null, from: policy?.effective_from ?? "", until: policy?.effective_until ?? "",
  owner: policy?.owner ?? "", review: policy?.next_review ?? "", reference: policy?.evidence.reference ?? "", reviewer: "", verified: false,
});

/**
 * Adds the next revision of one retention rule: choose the data kind and the anchor the
 * period counts from, enter the rule and its evidence, confirm. Each data kind can hold one
 * rule per anchor; each is revised on its own. Whether the period is long enough and the
 * evidence sufficient is the server's check.
 */
export default function ReviseRule({ rules }: { rules: RetentionRule[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [target, setTarget] = useState<{ category: string; anchor: string } | null>(null);
  const [choice, setChoice] = useState({ category: "", anchor: "" });
  const [draft, setDraft] = useState<Draft>(draftOf(undefined));
  const [base, setBase] = useState<RecordVersion<RetentionPolicy> | null | undefined>(undefined);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const record = useRecordSave<RetentionPolicy, RetentionRuleBody, RuleSaved>({
    name: `retention-rule:${target?.category}:${target?.anchor}`,
    send: (body) => api.saveRetentionRule(live.scopeId, body),
    readCurrent: async () => {
      const now = target && ruleOf((await api.privacy(live.scopeId)).rules, target.category, target.anchor);
      return now ? { revision: now.revision, payload: now.payload } : null;
    },
  });
  const current = target ? ruleOf(rules, target.category, target.anchor) : null;
  useUnsavedNavigation(Boolean(target) && JSON.stringify(draft) !== JSON.stringify(draftOf(current?.payload)));
  const policy = (): RetentionPolicy | null => (target ? {
    category: target.category, purpose: draft.purpose, anchor: target.anchor, retention_days: draft.days ?? NaN, legal_minimum_days: draft.minimum ?? NaN,
    effective_from: draft.from, effective_until: draft.until, owner: draft.owner, next_review: draft.review,
    evidence: { reference: draft.reference, status: draft.verified ? "verified" : "unverified", verified_by: draft.reviewer || null },
  } : null);

  function open(category: string, anchor: string) {
    setTarget({ category, anchor }); setDraft(draftOf(ruleOf(rules, category, anchor)?.payload)); setBase(undefined); setRebased(false); setDone(null); record.clear();
    steps.moveTo("content");
  }
  function discard() { setTarget(null); setChoice({ category: "", anchor: "" }); setBase(undefined); setRebased(false); record.clear(); steps.moveTo("target"); }
  function leave() { setBase(undefined); setRebased(false); record.clear(); steps.moveTo("content"); }
  async function save() {
    const payload = policy();
    if (base === undefined || !payload) return;
    const result = await record.save({ expected_revision: base?.revision ?? 0, payload });
    if (!result.saved) return;
    setTarget(null); setChoice({ category: "", anchor: "" }); setBase(undefined); setRebased(false);
    setDone(`保存規則の改定を第${result.result.revision}版として記録しました。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (record.outcome.kind !== "conflict") return;
    const now = record.outcome.current;
    record.clear(); setBase(now); setRebased(true);
  }

  const proposed = policy();
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 改定する保存規則を選ぶ</h3>
    <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); open(choice.category, choice.anchor); }}>
      <label htmlFor={`${id}-category`}>対象データ種別</label>
      <select id={`${id}-category`} className="ideal-input" required disabled={Boolean(target)} value={choice.category} onChange={(event) => setChoice({ ...choice, category: event.target.value })}>
        <option value="">選んでください</option>
        {Object.entries(CATEGORIES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <label htmlFor={`${id}-anchor`}>保存期間の起算</label>
      <select id={`${id}-anchor`} className="ideal-input" required disabled={Boolean(target)} value={choice.anchor} onChange={(event) => setChoice({ ...choice, anchor: event.target.value })}>
        <option value="">選んでください</option>
        {Object.entries(ANCHORS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      {!target && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">この規則の内容を入力する</button></div>}
    </form>
    {target && base === undefined && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 規則と根拠を入力する</h3>
      <p className="ideal-note">{categoryLabel(target.category)}・{anchorLabel(target.anchor)}：{current ? `現在は第${current.revision}版です。` : "まだ登録されていません。"}期間はデータ種別ごとに根拠を照合してください。確認済みでない規則では、サーバーは消去を実行しません。</p>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); record.clear(); setBase(current ? { revision: current.revision, payload: current.payload } : null); }}>
        <label htmlFor={`${id}-purpose`}>利用目的</label>
        <textarea id={`${id}-purpose`} className="ideal-input" required value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} />
        <WholeNumberField label="保存日数" value={draft.days} onChange={(days) => setDraft({ ...draft, days })} />
        <WholeNumberField label="根拠を確認した法定最低保存日数" value={draft.minimum} onChange={(minimum) => setDraft({ ...draft, minimum })} />
        <DayField label="適用開始日" value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
        <DayField label="適用終了日（この日を含まない）" value={draft.until} onChange={(until) => setDraft({ ...draft, until })} />
        <TextField label="更新担当者" value={draft.owner} onChange={(owner) => setDraft({ ...draft, owner })} />
        <DayField label="次回確認日" value={draft.review} onChange={(review) => setDraft({ ...draft, review })} />
        <TextField label="保存根拠・条項" value={draft.reference} onChange={(reference) => setDraft({ ...draft, reference })} />
        <TextField label="保存根拠の確認者" required={false} value={draft.reviewer} onChange={(reviewer) => setDraft({ ...draft, reviewer })} />
        <CheckField label="今回の適用範囲・期間・根拠を確認した" checked={draft.verified} onChange={(verified) => setDraft({ ...draft, verified })} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">改定の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={discard}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {target && base !== undefined && proposed && <ConfirmSurface title="3. 改定前の確認"
      changes={changedFacts(base ? ruleFacts(base.payload) : null, ruleFacts(proposed))}
      version={{ from: base?.revision ?? 0, to: (base?.revision ?? 0) + 1 }}
      notified="誰にも通知されません。改定の記録（規則の版・操作者・時刻）は監査の履歴に残ります。"
      risk={`記録前の時点では検出されていません。記録時にサーバーが、この規則が${base ? `第${base.revision}版のままであること` : "まだ登録されていないこと"}、保存日数が法定の最低保存日数を下回らないこと、適用期間が正しいことを照合します。違っていれば記録せず、競合または拒否として知らせます。1件の規則だけを記録するため、一部だけが記録されることはありません。`}
      outcome={confirmOutcome(record.outcome, ruleFacts, base ? ruleFacts(base.payload) : null, ruleFacts(proposed))}
      busy={record.busy} confirmLabel="この内容で改定を記録する"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <p className="ideal-note">規則を登録しても、記録は自動では消去されません。消去は、対象ごとの確認と実行の操作で行います。{target.category === "control" && "制御記録は再作成の防止と復元時の照合に使われるため、必要性と参照関係の個別判断を残してください。"}</p>
      {rebased && <p className="ideal-note" role="status">{base ? `現在の第${base.revision}版` : "現在の未登録の状態"}に対する改定として確認し直します。変更内容を確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
