"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import ContextLink from "@/features/workspace/shared/ContextLink";
import type { LiveApi } from "../../live/context";
import { stamp } from "../../live/format";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, Loaded, useAction } from "../../live/parts";
import { useResource } from "../../live/useResource";
import type { AuditEntry, LifecycleCase, MembershipRevision } from "../../types";
import { StatusPill } from "../shared";

const ROLE: Record<string, string> = { ADMIN: "システム管理者", LEADER: "薬剤部責任者", PHARMACIST: "薬剤師" };
const TASK: Record<string, string> = {
  contract: "雇用契約の確認", qualification: "資格の確認", membership: "本人アカウントの紐付け", candidate_generation: "勤務候補の生成",
  contract_end: "契約終了の確認", candidate_exclusion: "勤務候補からの除外", balance_review: "休暇残高の確認", membership_deactivation: "アカウントの無効化",
};

/** People: account links, and onboarding/offboarding cases (administrators). */
export function LivePeople({ live, view = "directory" }: { live: LiveApi; view?: "directory" | "memberships" | "lifecycle" }) {
  const [inactive, setInactive] = useState(false);
  const [selected, setSelected] = useState<string | null>(live.selectedPersonId);
  const members = useResource(() => live.client.memberships(live.scopeId, inactive), `${live.scopeId}|${inactive}`);
  const cases = useResource(() => live.client.lifecycleCases(live.scopeId), live.scopeId);
  const directory = useResource<DirectoryContext>(
    () => view === "directory"
      ? live.client.request<DirectoryContext>(`/compliance/workflow-context?scope_id=${encodeURIComponent(live.scopeId)}`)
      : Promise.resolve({ people: [], contracts: [], capabilities: [], records: [] }),
    `${live.scopeId}|${view}`,
  );
  return (
    <div className="ideal-stack">
      {(view === "directory" || view === "memberships") && <section className="ideal-panel" aria-labelledby="members-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">本人アカウント</span><h2 id="members-title">紐付け</h2></div>
          <label className="ideal-switch"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /><span>無効も表示</span></label></div>
        <Loaded resource={members}>{(list) => <>
          {view === "directory" ? <Loaded resource={directory}>{(records) => <PeopleDirectory live={live} list={list} cases={cases.data ?? []} records={records} selected={selected} onSelect={setSelected} />}</Loaded> : <MemberTable live={live} list={list} selectedPersonId={live.selectedPersonId} onChanged={() => void members.reload()} />}
          {view === "memberships" && <details className="ideal-v3-disclosure"><summary>本人アカウントを紐付ける</summary><LinkForm live={live} initialPersonId={live.selectedPersonId} onChanged={() => void members.reload()} /></details>}
        </>}</Loaded>
      </section>}
      {view === "lifecycle" && <section className="ideal-panel" aria-labelledby="lifecycle-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">入職・退職</span><h2 id="lifecycle-title">手続きのケース</h2></div></div>
        <Loaded resource={cases}>{(list) => <>
          {(live.selectedPersonId ? list.filter((c) => c.person_id === live.selectedPersonId) : list).length ? <div className="ideal-lifecycle-list">{(live.selectedPersonId ? list.filter((c) => c.person_id === live.selectedPersonId) : list).map((c) => <LifecycleCard key={c.case_id} live={live} c={c} onChanged={() => void cases.reload()} />)}</div> : <p className="ideal-note">{live.selectedPersonId ? "選択した職員に進行中の手続きはありません。" : "進行中の手続きはありません。"}</p>}
          <details className="ideal-v3-disclosure"><summary>新しい入職・退職手続きを始める</summary><LifecycleForm live={live} initialPersonId={live.selectedPersonId} onChanged={() => void cases.reload()} /></details>
        </>}</Loaded>
      </section>}
    </div>
  );
}

type DirectoryContext = {
  people: Array<{ person_id: string; name: string }>;
  contracts: Array<Record<string, unknown>>;
  capabilities: Array<Record<string, unknown>>;
  records: Array<{ kind: string; entity_id: string; revision: number; payload: Record<string, unknown> }>;
};

function PeopleDirectory({ live, list, cases, records, selected, onSelect }: { live: LiveApi; list: MembershipRevision[]; cases: LifecycleCase[]; records: DirectoryContext; selected: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const people = Array.from(new Map([
    ...live.people.map((person) => [person.person_id, person] as const),
    ...records.people.map((person) => [person.person_id, person] as const),
    ...list.map((item) => [item.person_id, { person_id: item.person_id, name: live.nameOf(item.person_id) }] as const),
  ]).values());
  const filtered = people.filter((person) => `${person.name} ${person.person_id}`.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")));
  const current = people.find((item) => item.person_id === selected) ?? (selected ? null : people[0]);
  if (!current) return selected
    ? <section className="ideal-note" role="alert"><h3>指定された職員を表示できません</h3><p>この施設・部署で参照できないか、所属状態が変わりました。</p>{people[0] && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => onSelect(people[0].person_id)}>職員一覧から選び直す</button>}</section>
    : <p className="ideal-note">表示できる職員はいません。</p>;
  const memberships = list.filter((item) => item.person_id === current.person_id);
  const contracts = [...records.contracts, ...records.records.filter((row) => row.kind === "contract").map((row) => row.payload)].filter((item) => item.person_id === current.person_id);
  const capabilities = [...records.capabilities, ...records.records.filter((row) => row.kind === "capability").map((row) => row.payload)].filter((item) => item.person_id === current.person_id);
  const lifecycle = cases.filter((item) => item.person_id === current.person_id);
  return <div className="ideal-v3-master-detail">
    <div><label className="ideal-field-label" htmlFor="people-directory-search">職員を検索</label><input id="people-directory-search" type="search" className="ideal-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="氏名又は職員ID" /><p role="status">{filtered.length}名を表示</p>
      <ul className="ideal-v3-master" aria-label="職員一覧">{filtered.map((item) => { const membership = list.find((row) => row.person_id === item.person_id && row.active); return <li key={item.person_id}><button type="button" aria-pressed={item.person_id === current.person_id} onClick={() => onSelect(item.person_id)}><span className="ideal-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{membership ? `${ROLE[membership.role]} · 有効` : "本人アカウント未紐付け"}</small></span><ChevronRight aria-hidden="true" /></button></li>; })}</ul></div>
    <article className="ideal-v3-detail" aria-live="polite"><span className="ideal-eyebrow">選択中の職員</span><h3>{current.name}</h3><dl className="ideal-definition-list"><div><dt>本人アカウント</dt><dd>{memberships.length ? memberships.map((item) => `${ROLE[item.role]}・${item.active ? "有効" : "無効"}（版${item.revision}）`).join("、") : "未紐付け"}</dd></div><div><dt>契約</dt><dd>{contracts.length ? `${contracts.length}件（原本記録あり）` : "登録なし"}</dd></div><div><dt>資格</dt><dd>{capabilities.length ? `${capabilities.length}件（原本記録あり）` : "登録なし"}</dd></div><div><dt>入職・退職</dt><dd>{lifecycle.length ? lifecycle.map((item) => `${item.kind === "ONBOARD" ? "入職" : "退職"}・${item.status}`).join("、") : "進行中の手続きなし"}</dd></div></dl><nav aria-label="選択職員の詳細"><ContextLink href={`/workspace/people/memberships?person=${encodeURIComponent(current.person_id)}`}>本人アカウント</ContextLink><ContextLink href={`/workspace/people/contracts?person=${encodeURIComponent(current.person_id)}`}>契約・資格</ContextLink><ContextLink href={`/workspace/people/lifecycle?person=${encodeURIComponent(current.person_id)}`}>入職・退職</ContextLink></nav></article>
  </div>;
}

function MemberTable({ live, list, selectedPersonId, onChanged }: { live: LiveApi; list: MembershipRevision[]; selectedPersonId: string | null; onChanged: () => void }) {
  const visible = selectedPersonId ? list.filter((member) => member.person_id === selectedPersonId) : list;
  if (!visible.length) return <p className="ideal-note">{selectedPersonId ? "選択した職員の紐付けはありません。" : "紐付けはありません。"}</p>;
  const activeAdmins = list.filter((member) => member.active && member.role === "ADMIN").length;
  return <div className="ideal-table-wrap" role="region" aria-label="紐付けの一覧" tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">職員</th><th scope="col">役割</th><th scope="col">アカウント</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
    <tbody>{visible.map((m) => <tr key={m.membership_id}>
      <td>{live.nameOf(m.person_id)}</td><td>{ROLE[m.role]}</td><td>{m.subject}</td>
      <td><StatusPill tone={m.active ? "good" : "neutral"}>{m.active ? "有効" : "無効"}</StatusPill> 版{m.revision}</td>
      <td>{m.active && <Deactivate live={live} m={m} onChanged={onChanged} blockedReason={
        m.person_id === live.personId ? "自分自身の所属は無効にできません。別の管理者に依頼してください。"
          : m.role === "ADMIN" && activeAdmins === 1 ? "最後の有効な管理者は無効にできません。"
            : null
      } />}</td>
    </tr>)}</tbody>
  </table></div>;
}

function Deactivate({ live, m, onChanged, blockedReason }: { live: LiveApi; m: MembershipRevision; onChanged: () => void; blockedReason: string | null }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  if (blockedReason) return <span className="ideal-note">{blockedReason}</span>;
  if (!open) return <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setOpen(true)}>無効にする</button>;
  return <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { expected_version: m.revision, evidence };
    await live.mutate(`deactivate:${m.membership_id}`, body, (key) => live.client.deactivateMembership(live.scopeId, m.membership_id, { ...body, idempotency_key: key }));
    setOpen(false); onChanged(); return "無効にしました。";
  }); }}>
    <EvidenceFields value={evidence} onChange={setEvidence} legend="無効にする根拠" />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>無効にする</button>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setOpen(false)}>やめる</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}

function LinkForm({ live, initialPersonId, onChanged }: { live: LiveApi; initialPersonId: string | null; onChanged: () => void }) {
  const id = useId();
  const [form, setForm] = useState({ issuer: "", subject: "", person_id: initialPersonId ?? "", role: "PHARMACIST" as "ADMIN" | "LEADER" | "PHARMACIST" });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const people = live.people.map((person) => person.person_id);
  return <form className="ideal-form" aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { ...form, expected_version: 0, evidence };
    await live.mutate("link-membership", body, (key) => live.client.linkMembership(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE); onChanged(); return "紐付けました。";
  }); }}>
    <h3 id={`${id}-title`}>アカウントを紐付ける</h3>
    <label htmlFor={`${id}-issuer`}>発行者（issuer）</label><input id={`${id}-issuer`} className="ideal-input" required minLength={3} value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
    <label htmlFor={`${id}-subject`}>アカウント（subject）</label><input id={`${id}-subject`} className="ideal-input" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
    <label htmlFor={`${id}-person`}>職員</label>
    <input id={`${id}-person`} className="ideal-input" required list={`${id}-people`} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })} />
    <datalist id={`${id}-people`}>{people.map((p) => <option key={p} value={p}>{live.nameOf(p)}</option>)}</datalist>
    <label htmlFor={`${id}-role`}>役割</label>
    <select id={`${id}-role`} className="ideal-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <EvidenceFields value={evidence} onChange={setEvidence} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>紐付ける</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}

function LifecycleCard({ live, c, onChanged }: { live: LiveApi; c: LifecycleCase; onChanged: () => void }) {
  const tasks = c.tasks;
  const done = tasks.filter((t) => t.status === "COMPLETED").length;
  const [task, setTask] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  return <article>
    <span className={`ideal-avatar ${c.kind === "OFFBOARD" ? "is-offboard" : ""}`}>{live.nameOf(c.person_id).slice(0, 1)}</span>
    <div className="ideal-lifecycle-list__main">
      <div><strong>{live.nameOf(c.person_id)}</strong><StatusPill tone={c.status === "READY" ? "good" : "info"}>{c.kind === "ONBOARD" ? "入職" : "退職"} · {c.status === "READY" ? "すべて完了" : "進行中"}</StatusPill></div>
      <p>{c.effective_date} · 版{c.version}</p>
      <div className="ideal-progress" role="progressbar" aria-label={`${live.nameOf(c.person_id)}のタスク進捗`} aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={done}><span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
      <ul className="ideal-task-list">{tasks.map((t) => <li key={t.key} className={t.status === "COMPLETED" ? "is-done" : ""}><span>{t.status === "COMPLETED" ? "✓" : "・"}</span><span><strong>{TASK[t.key] ?? t.key}</strong><small>{t.completed_at ? `完了 ${stamp(t.completed_at)}` : "未完了"}</small></span>
        {t.status !== "COMPLETED" && t.can_complete && task !== t.key && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(t.key)}>確認を記録 <ChevronRight aria-hidden="true" /></button>}
        {t.status !== "COMPLETED" && t.source === "SYSTEM" && <ContextLink className="ideal-inline-link" href={lifecycleTaskHref(t.key, live.scopeId, c.person_id)}>正本を開く <ChevronRight aria-hidden="true" /></ContextLink>}
        {t.blocked_reason && <small>{t.blocked_reason}</small>}</li>)}</ul>
      {task && <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
        const body = { task_key: task, expected_version: c.version, evidence };
        await live.mutate(`task:${c.case_id}:${task}`, body, (key) => live.client.attestTask(live.scopeId, c.case_id, task, { expected_version: body.expected_version, evidence: body.evidence, idempotency_key: key }));
        setTask(null); setEvidence(EMPTY_EVIDENCE); onChanged(); return "完了にしました。";
      }); }}>
        <EvidenceFields value={evidence} onChange={setEvidence} legend={`「${TASK[task] ?? task}」の完了の根拠`} />
        <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>完了にする</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(null)}>やめる</button></div>
      </form>}
      <ActionStatus problem={action.problem} done={action.done} />
    </div>
  </article>;
}

function lifecycleTaskHref(task: string, scopeId: string, personId?: string): string {
  const params = new URLSearchParams({ scope: scopeId });
  if (personId) params.set("person", personId);
  const scope = `?${params.toString()}`;
  if (["contract", "qualification", "contract_end"].includes(task)) return `/workspace/people/contracts${scope}`;
  if (["membership", "membership_deactivation"].includes(task)) return `/workspace/people/memberships${scope}`;
  return `/workspace/plan/input${scope}`;
}

function LifecycleForm({ live, initialPersonId, onChanged }: { live: LiveApi; initialPersonId: string | null; onChanged: () => void }) {
  const id = useId();
  const [form, setForm] = useState({ person_id: initialPersonId ?? "", kind: "ONBOARD" as "ONBOARD" | "OFFBOARD", effective_date: "" });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  return <form className="ideal-form" aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { ...form, evidence };
    await live.mutate("create-lifecycle", body, (key) => live.client.createLifecycle(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE); onChanged(); return "手続きを始めました。";
  }); }}>
    <h3 id={`${id}-title`}>手続きを始める</h3>
    <label htmlFor={`${id}-person`}>職員ID</label><input id={`${id}-person`} className="ideal-input" required value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })} />
    <fieldset className="ideal-fieldset ideal-fieldset--inline"><legend>種類</legend>
      {(["ONBOARD", "OFFBOARD"] as const).map((k) => <label key={k} className="ideal-radio"><input type="radio" name={`${id}-kind`} checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />{k === "ONBOARD" ? "入職" : "退職"}</label>)}</fieldset>
    <label htmlFor={`${id}-date`}>発効日</label><input id={`${id}-date`} type="date" className="ideal-input" required value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
    <EvidenceFields value={evidence} onChange={setEvidence} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>始める</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}

/** Settings: the absence consent switch (administrators change it; others see it). */
export function LiveSettings({ live }: { live: LiveApi }) {
  const settings = useResource(() => live.client.scopeSettings(live.scopeId), live.scopeId);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const admin = live.role === "ADMIN";
  return <div className="ideal-stack">
    <Loaded resource={settings}>{(s) => {
      const consent = s.absence_replacement_consent;
      return <section className="ideal-panel" aria-labelledby="consent-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">欠勤の運用</span><h2 id="consent-title">代わりに入る人の同意</h2></div>
          <StatusPill tone={consent.enabled ? "good" : "neutral"}>{consent.enabled ? "同意を求める" : "同意を求めない"}</StatusPill></div>
        <p>{consent.enabled
          ? "欠勤の代わりに指名された人が同意してから、責任者が承認します。薬剤師も自分の勤務の代わりを指名できます。"
          : "責任者が代わりを決め、同意は求めません。薬剤師は代わりを指名できません。"}
          切り替えは、切り替えた後に作るケースから適用されます（作成済みのケースは変わりません）。</p>
        {admin && <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
          const body = { enabled: !consent.enabled, expected_version: consent.revision, evidence };
          await live.mutate("absence-consent", body, (key) => live.client.setAbsenceConsent(live.scopeId, { ...body, idempotency_key: key }));
          setEvidence(EMPTY_EVIDENCE);
          await settings.reload();
          await live.refresh();
          return body.enabled ? "同意を求めるようにしました。" : "同意を求めないようにしました。";
        }); }}>
          <EvidenceFields value={evidence} onChange={setEvidence} legend="切り替える根拠" />
          <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>{consent.enabled ? "同意を求めないようにする" : "同意を求めるようにする"}</button></div>
          <ActionStatus problem={action.problem} done={action.done} />
        </form>}
        {consent.history && consent.history.length > 0 && <div className="ideal-table-wrap" role="region" aria-label="切り替えの履歴" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">版</th><th scope="col">設定</th><th scope="col">理由</th><th scope="col">参照</th><th scope="col">変更者</th><th scope="col">日時</th></tr></thead>
          <tbody>{consent.history.map((h) => <tr key={h.revision}><td>{h.revision}</td><td>{h.enabled ? "同意を求める" : "求めない"}</td><td>{h.reason}</td><td>{h.reference}</td><td>{h.actor}</td><td>{stamp(h.at)}</td></tr>)}</tbody>
        </table></div>}
      </section>;
    }}</Loaded>
  </div>;
}

const CATEGORY: Record<string, string> = { change: "欠勤・交換", membership: "紐付け", lifecycle: "入職・退職", schedule: "計画・公開", request: "申請", compliance: "管理記録", privacy: "個人情報", other: "その他" };

const EVENT_LABEL: Record<string, string> = {
  "compliance.scope_setting": "欠勤同意設定を変更",
  "schedule.published": "勤務表を公開",
  "schedule.cancelled": "公開版を取り消し",
  "change.absence.created": "欠勤ケースを登録",
  "change.swap.created": "勤務交換を申請",
  "change.absence.consented": "欠勤の代替勤務に同意",
  "change.swap.consented": "勤務交換に同意",
  "change.absence.declined": "欠勤の代替勤務を辞退",
  "change.swap.declined": "勤務交換を辞退",
  "change.recommended": "変更ケースを承認候補として推薦",
  "change.approved": "変更ケースを承認",
  "change.rejected": "変更ケースを却下",
  "change.withdrawn": "変更申請を取り下げ",
  "membership.linked": "本人アカウントを紐付け",
  "membership.deactivated": "本人アカウントの紐付けを無効化",
  "lifecycle.created": "入退職手続きを開始",
  "lifecycle.task_completed": "入退職タスクを完了",
};

function eventLabel(kind: string): string {
  if (EVENT_LABEL[kind]) return EVENT_LABEL[kind];
  const [area, action] = kind.split(".");
  const subject = CATEGORY[area] ?? "管理記録";
  const actions: Record<string, string> = {
    created: "を作成", updated: "を更新", approved: "を承認", rejected: "を却下",
    imported: "を取込", corrected: "を訂正", published: "を公開", cancelled: "を取消",
    completed: "を完了", read: "を確認", erased: "を消去",
  };
  return `${subject}${actions[action] ?? "を記録"}`;
}

/** Governance: the audit timeline, and links to the existing administration pages. */
export function LiveGovernance({ live }: { live: LiveApi }) {
  const id = useId();
  const [category, setCategory] = useState("");
  const [more_, setMore] = useState<{ key: string; pages: AuditEntry[][]; cursor: string | null } | null>(null);
  const key = `${live.scopeId}|${category}`;
  // The first page is the read itself (a newer read wins); later pages belong to it.
  const first = useResource(() => live.client.timeline(live.scopeId, null, category || null), key);
  const extra = more_ && more_.key === key ? more_ : null;
  const cursor = extra ? extra.cursor : first.data?.next_cursor ?? null;
  const more = useAction();
  const entries = [...(first.data?.entries ?? []), ...(extra?.pages.flat() ?? [])];
  return <div className="ideal-stack">
    <div className="ideal-grid ideal-grid--3">
      {[{ href: "/workspace/governance/privacy", title: "個人情報", body: "開示・訂正・消去とコピーの管理" }, { href: "/workspace/governance/recovery", title: "復旧", body: "復元と保護状態の確認" }, { href: "/workspace/governance/actuals", title: "実績照合", body: "取込・差分・確定の記録" }].map((item) =>
        <article className="ideal-governance-card" key={item.href}><h2>{item.title}</h2><p>{item.body}</p><ContextLink className="ideal-link ideal-link--target" href={item.href}>{item.title}を開く <ChevronRight aria-hidden="true" /></ContextLink></article>)}
    </div>
    <section className="ideal-panel" aria-labelledby={`${id}-title`}>
      <div className="ideal-panel__head"><div><span className="ideal-eyebrow">計画の通知から</span><h2 id={`${id}-title`}>監査タイムライン</h2></div>
        <label className="ideal-inline-field" htmlFor={`${id}-category`}>種類<select id={`${id}-category`} className="ideal-input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">すべて</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <Loaded resource={first}>{(page) => <>
        {entries.length ? <ol className="ideal-timeline">{entries.map((e, index) => <li key={`${e.at}-${e.kind}-${index}`}><span /><div><strong>{eventLabel(e.kind)}</strong>
          <p>{CATEGORY[e.category]} · {e.actor_role ?? "役割不明"} · 関係した人 {e.subject_count === null ? "—" : `${e.subject_count}名`}{e.version === null ? "" : ` · 版 ${e.version}`}</p><small>記録種別 <code>{e.kind}</code></small></div><time dateTime={e.at}>{stamp(e.at)}</time></li>)}</ol>
          : <p className="ideal-note">記録はありません。</p>}
        {cursor && <button type="button" className="ideal-button ideal-button--secondary" disabled={more.busy} onClick={() => void more.run(async () => {
          const next = await live.client.timeline(live.scopeId, cursor, category || null);
          setMore({ key, pages: [...(extra?.pages ?? []), next.entries], cursor: next.next_cursor });
        })}>さらに読み込む</button>}
        <ActionStatus problem={more.problem} done={null} />
        <ul className="ideal-note-list">{page.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      </>}</Loaded>
    </section>
  </div>;
}
