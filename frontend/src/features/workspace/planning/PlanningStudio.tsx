"use client";
import {departmentRoleLabel} from '@/lib/departmentRole';
import {confirmDiscardChanges} from '@/features/workspace/shared/useUnsavedNavigation';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';

import { useEffect, useRef, useState, useMemo } from 'react';
import LeaveRequestWorkspace from '@/features/workspace/requests/LeaveRequestWorkspace';
import {Button} from '@/components/ui/Button';
import WorkflowNavigation from '@/features/workspace/planning/WorkflowNavigation';
import MonthlySchedule from '@/features/workspace/planning/MonthlySchedule';
import PublicationExport from '@/features/workspace/planning/PublicationExport';
import ContractWorkflow from '@/features/workspace/people/ContractWorkflow';
import FlexSettlementPanel from '@/features/workspace/planning/FlexSettlementPanel';
import {diagnosticText,findingStatus,findingText} from '@/lib/findingText';
import {regimeLabel} from '@/lib/regimeLabels';
import {createPlanningTransport, PlanningError} from '@/lib/planningTransport';
import {monthInterval, overlapsDisplay, publicationCalendar} from '@/lib/calendar';
import {errorText} from '@/lib/errorText';
import MembershipHelp from '@/features/workspace/planning/MembershipHelp';

type Duty = { duty_id: string; person_id: string; kind: string; start: string; end: string; task: string; location: string };
type Contract = { revision_id: string; person_id: string; engagement: string; time_category: string; regime: string; start: string; end: string; evidence: {status: string}; regime_evidence: {status: string} };
type Snapshot = { period: {start: string; end: string}; people: {person_id: string; name: string}[]; contracts: Contract[]; candidates: Duty[]; leaves: {allocation_id: string}[]; facility_id?: string; department_id?: string; demands?: unknown[]; employments?: {person_id: string; start: string; end: string; working_time_system?: string}[] };
/** A parsed file awaiting the administrator's confirmation; nothing is sent before that. */
type ImportPreview = {name: string; snapshot: Record<string, unknown>; scope: string; period: {start: string; end: string} | null; people: number; candidates: number; demands: number; added: string[]; removed: string[];
  /** The input the differences were computed against; registration requires it to be the latest. */
  base: {hash: string; period: {start: string; end: string}} | null};
type Input = { input_hash: string; input_revision: number; publication_version: number; snapshot: Snapshot; stale: boolean };
type Period = {input_hash: string; period: {start: string; end: string}; stale: boolean};
type Scope = {person_id: string; scope_id: string; role: string; input_revision: number};
type Finding = {rule_id: string; status: string; message: string};
type Draft = {draft_id: string; version: number; input_hash: string; status: string; proposal: {duty_ids: string[]; leave_ids: string[]}; review_hash: string | null};
type Publication = {validation_status:string;publication_id: string; version: number; period: string; assignments: Duty[]};
type Job = {job_id: string; status: string; result?: {draft_id?: string; diagnostics?: string[]; validation?: {findings: Finding[]}}};
type Notice = {event_id: string; publication_id: string; version: number; kind: string; read: boolean};

export default function PlanningStudio({routeView}:{routeView?:'input'|'drafts'|'publications'}={}) {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopesLoaded, setScopesLoaded] = useState(false);
  const [viewMonth, setViewMonth] = useState('');
  const [publicationsLoading, setPublicationsLoading] = useState(false);
  const [publicationsLoaded, setPublicationsLoaded] = useState(false);
  const [scope, setScope] = useState('');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [inputLoading, setInputLoading] = useState(false);
  // The department whose latest input has been read: a file is compared with it,
  // so the picker waits until the read for the selected department has finished.
  const [inputScope, setInputScope] = useState('');
  const [input, setInput] = useState<Input | null>(null);
  const generation=useRef<{hash:string;key:string}|null>(null);
  const derivation=useRef<{fingerprint:string;key:string}|null>(null);
  const [deriveReason,setDeriveReason]=useState('');
  const [deriveReference,setDeriveReference]=useState('');
  const [draftConflict,setDraftConflict]=useState<{base:Draft;current:Draft;proposed:string[]}|null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const current = scopes.find(s => s.scope_id === scope);
  const request = useMemo(() => createPlanningTransport(`${scope}:${current?.person_id ?? ''}:${current?.role ?? ''}`), [scope, current?.person_id, current?.role]);
  const bootstrapRequest = useMemo(() => createPlanningTransport('membership-read'), []);
  const canEdit = current?.role === 'ADMIN' || current?.role === 'LEADER';
  // A link from another page may target a section that renders only after loading; move to it once.
  const arrivedAtHash = useRef(false);
  useEffect(() => {
    if (arrivedAtHash.current || typeof window === 'undefined' || !window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target) { arrivedAtHash.current = true; target.scrollIntoView(); }
  });
  const displayPeriod = input?.snapshot.period ?? monthInterval(viewMonth);
  const calendarPublications = publicationCalendar(publications,displayPeriod);
  const publishedDuties = calendarPublications.all;
  const hasPublication = publications.some(p=>{
    const [start,end]=p.period.split('|');
    return !displayPeriod || overlapsDisplay({start,end},displayPeriod) || p.assignments.some(d=>overlapsDisplay(d,displayPeriod));
  });
  // People whose flextime employment overlaps the planning period (shown without timed duties).
  const flexPeople = input ? Array.from(new Set((input.snapshot.employments ?? []).filter(e => e.working_time_system === 'flex'
    && new Date(e.start) < new Date(input.snapshot.period.end) && new Date(input.snapshot.period.start) < new Date(e.end)).map(e => e.person_id))) : [];
  const query = `?scope_id=${encodeURIComponent(scope)}`;
  const draftDirty = !!draft && JSON.stringify([...selected].sort()) !== JSON.stringify([...draft.proposal.duty_ids].sort());
  // The cancellation reason and a previewed file are unsaved work as well.
  const dirty = draftDirty || !!cancelReason.trim() || !!preview;
  const statusLabels: Record<string,string> = {QUEUED:'受付済み',RUNNING:'計算中',OPTIMAL:'最適性を確認した案',FEASIBLE:'実行可能な案（最適性は未証明）',UNKNOWN:'判定できませんでした',INFEASIBLE:'登録条件では作成できません',MODEL_INVALID:'計算モデルの確認が必要です',CANCELLED:'中止',BLOCKED:'未確認・未対応の条件があります'};
  const running = job?.status === 'QUEUED' || job?.status === 'RUNNING';
  const dateText = (value: string) => new Date(value).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'});
  const personName = (id: string) => input?.snapshot.people.find(p => p.person_id === id)?.name ?? id;
  // The file's own name for a person it adds; the identifier only when the file has no name.
  const addedName = (id: string) => { const people = preview && Array.isArray(preview.snapshot.people) ? preview.snapshot.people as Record<string, unknown>[] : []; const name = people.find(p => p && p.person_id === id)?.name; return typeof name === 'string' && name ? name : id; };
  const shortList = (items: string[]) => items.slice(0, 20).join('、') + (items.length > 20 ? `ほか${items.length - 20}人` : '');

  useUnsavedNavigation(dirty);
  // A preview compared with another input is stale once the displayed input changes.
  useEffect(() => { setPreview(prev => prev && prev.base?.hash !== input?.input_hash ? null : prev); }, [input?.input_hash]);
 useEffect(() => {
   let active=true;
   const params=new URLSearchParams(window.location.search);
   const wanted=params.get('period')??'';
   setViewMonth(monthInterval(wanted)?wanted:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date()));
   bootstrapRequest<Scope[]>('/scopes').then(value => {if(!active)return;setScopes(value);setScopesLoaded(true);const desired=params.get('scope');setScope(value.find(row=>row.scope_id===desired)?.scope_id ?? value[0]?.scope_id ?? '');}).catch(e => {if(active)setError(errorText(e));});
   return ()=>{active=false;};
 }, [bootstrapRequest]);
  useEffect(() => {
    if (!scope) return;
    let active = true;
    setInput(null);setDraft(null);setJob(null);setFindings([]);setSelected([]);setPublications([]);setNotices([]);setPeriods([]);setDraftConflict(null);setError('');
    setPublicationsLoading(true);setPublicationsLoaded(false);
    request<Publication[]>(`/publications${query}`).then(v => {if(active){setPublications(v);setPublicationsLoaded(true);}}).catch(e => {if(active)setError(errorText(e));}).finally(()=>{if(active)setPublicationsLoading(false);});
    request<Notice[]>(`/notifications${query}`).then(v => {if(active)setNotices(v);}).catch(e => {if(active)setError(errorText(e));});
    if(canEdit) {
      setInputLoading(true);
      void (async () => {
        const options = await request<Period[]>(`/inputs${query}`);
        if (!active) return;
        setPeriods(options);
        const wanted = new URLSearchParams(window.location.search).get('period');
        const chosen = wanted && /^\d{4}-(0[1-9]|1[0-2])$/.test(wanted)
          ? options.find(p => new Date(p.period.start).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}) === wanted) : undefined;
        const value = await request<Input>(`/inputs/latest${query}${chosen?'&input_hash='+encodeURIComponent(chosen.input_hash):''}`);
        if (active) {setInput(value); if(wanted&&!chosen)setMessage('指定月の計画期間がないため、最新の登録期間を表示しています。対象期間を確認してください。');}
      })().catch(e => {if(active)setError(errorText(e));}).finally(() => {if(active){setInputLoading(false);setInputScope(scope);}});
    }
    return () => {active = false;};
  }, [scope, canEdit, query, request]);
  useEffect(() => {
    if (!running || !job) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await request<Job>(`/jobs/${job.job_id}${query}`);
        if (!active) return;
        if(next.result?.draft_id) {
          const proposal = await request<Draft>(`/drafts/${next.result.draft_id}${query}`);
          if(active) {setDraft(proposal);setSelected(proposal.proposal.duty_ids);}
        }
        if(active) {
          if(next.result?.validation) setFindings(next.result.validation.findings);
          setJob(next);
        }
      } catch(e) { if(active)setError(errorText(e)); }
    }, 1000);
    return () => {active=false;clearInterval(timer);};
  }, [running, job, query, request]);

  async function act(action: () => Promise<void>) {
    setBusy(true);setError('');setMessage('');
    try { await action(); } catch(e) {setError(errorText(e));} finally {setBusy(false);}
  }
  async function generate() {
    if(!input) return;
    if(generation.current?.hash!==input.input_hash)generation.current={hash:input.input_hash,key:crypto.randomUUID()};
    const operation=generation.current;
    const previous=await request<{job:Job|null}>(`/jobs/by-key${query}&idempotency_key=${encodeURIComponent(operation.key)}`);
    const next=previous.job??await request<Job>(`/jobs${query}`, 'POST', {input_hash:input.input_hash,idempotency_key:operation.key,budget_seconds:25});
    setJob(next);setDraft(null);setFindings([]);
    if(next.result?.draft_id){const saved=await request<Draft>(`/drafts/${next.result.draft_id}${query}`);setDraft(saved);setSelected(saved.proposal.duty_ids);}
    generation.current=null;
  }
  async function deriveCandidates() {
    if(!input) return;
    const body={expected_version:input.input_revision,evidence:{reason:deriveReason.trim(),reference:deriveReference.trim()}};
    const fingerprint=JSON.stringify(body);
    if(derivation.current?.fingerprint!==fingerprint)derivation.current={fingerprint,key:crypto.randomUUID()};
    await request(`/candidates/derive${query}`,'POST',{...body,idempotency_key:derivation.current.key});
    derivation.current=null;setDeriveReason('');setDeriveReference('');
    setPeriods(await request<Period[]>(`/inputs${query}`));
    setInput(await request<Input>(`/inputs/latest${query}`));setDraft(null);setJob(null);setFindings([]);
    setMessage('承認済みの契約・資格から、新しい不変の計画入力版を作成しました。');
  }
  async function saveDraft() {
    if(!draft) return;
    if(draftConflict)return;
    let next:Draft;try{next=await request<Draft>(`/drafts/${draft.draft_id}${query}`, 'PUT', {version: draft.version, proposal: {...draft.proposal, duty_ids: selected}});}catch(e){if(e instanceof PlanningError && e.status === 409){const latest=await request<Draft>(`/drafts/${draft.draft_id}${query}`);setDraftConflict({base:draft,current:latest,proposed:[...selected]});}throw e;}
    setDraft(next);setFindings([]);setMessage('変更を保存しました。再度確認してください。');
  }
  async function review() {
    if(!draft) return;
    const result = await request<{findings: Finding[]; publishable: boolean; review_hash: string | null}>(`/drafts/${draft.draft_id}/review${query}`, 'POST', {version: draft.version});
    setFindings(result.findings);setDraft({...draft,review_hash:result.review_hash});
    setMessage(result.publishable ? '確認した入力と規則の範囲で検証を通過しました。内容を確認して公開できます。' : '公開できません。違反・未確認・未対応の条件を確認してください。');
  }
  async function publish() {
    if(!draft || !input) return;
    const currentVersion = input.publication_version;
    await request(`/drafts/${draft.draft_id}/publish${query}`, 'POST', {version: draft.version, expected_publication_version: currentVersion,
      input_hash: draft.input_hash,review_hash: draft.review_hash,idempotency_key: `publish-${draft.draft_id}-${draft.version}`});
    setDraft({...draft,status:'PUBLISHED'});
    setPublications(await request<Publication[]>(`/publications${query}`));
    setNotices(await request<Notice[]>(`/notifications${query}`));
    setInput(await request<Input>(`/inputs/latest${query}&input_hash=${input.input_hash}`));
    setMessage('確認した案を公開しました。');
  }
  async function previewFile(file: File | undefined) {
    if(!file) return;
    if(file.size > 5*1024*1024) throw new Error('取込ファイルは5MB以内にしてください。');
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error('取込ファイルを JSON として読めません。'); }
    if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('取込ファイルの形式が勤務入力ではありません。');
    const snapshot = parsed as Record<string, unknown>;
    const list = (key: string) => Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]).filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
    const people = list('people').map(p => String(p.person_id ?? ''));
    const known = (input?.snapshot.people ?? []).map(p => p.person_id);
    const period = snapshot.period && typeof snapshot.period === 'object' ? snapshot.period as {start: string; end: string} : null;
    setPreview({name: file.name, snapshot, scope: `${String(snapshot.facility_id ?? '')}/${String(snapshot.department_id ?? '')}`, period,
      people: people.length, candidates: list('candidates').length, demands: list('demands').length,
      added: people.filter(id => !known.includes(id)), removed: known.filter(id => !people.includes(id)),
      base: input ? {hash: input.input_hash, period: input.snapshot.period} : null});
    setMessage('取込ファイルの内容を表示しました。確認してから登録してください。');
  }
  async function registerPreview() {
    if(!preview || preview.scope !== scope) return;
    // The differences were shown against one input; register only if it is still the department's latest.
    let latest: Input | null = null;
    try { latest = await request<Input>(`/inputs/latest${query}`); } catch { latest = null; }
    if((latest?.input_hash ?? null) !== (preview.base?.hash ?? null)) {
      setPreview(null);
      throw new Error('比較した入力が部署の最新版ではない、または更新されました。最新の計画期間を表示してから、取り込み直してください。');
    }
    // The server compares with the department's revision, which requests and
    // actuals also advance (the displayed input is then marked for refresh).
    const department = (await request<Scope[]>('/scopes')).find(s => s.scope_id === scope);
    await request(`/inputs${query}`, 'POST', {snapshot: preview.snapshot, expected_revision: department?.input_revision ?? latest?.input_revision ?? 0});
    setPreview(null);
    setInput(await request<Input>(`/inputs/latest${query}`));setPeriods(await request<Period[]>(`/inputs${query}`));setDraft(null);setMessage('入力を登録しました。根拠の確認状態を確認してください。');
  }
  return <div className="planning ideal-v3-planning space-y-6" data-route-view={routeView ?? 'legacy'}>
    {!routeView&&current&&<WorkflowNavigation role={current.role} scope={scope} period={canEdit&&input?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).format(new Date(input.snapshot.period.start)):viewMonth} />}
    <label className="block">施設・部署 <select className="ui-control block" value={scope} onChange={e=>{if(confirmDiscardChanges('未保存の変更を破棄して部署を切り替えますか？')){setScope(e.target.value);setPreview(null);setCancelReason('');}}} disabled={busy || running}>
      {scopes.map(s=><option key={s.scope_id} value={s.scope_id}>{s.scope_id}</option>)}
    </select></label>
    {canEdit && periods.length > 0 && <label className="block">計画期間 <select className="ui-control block" value={input?.input_hash ?? ''} disabled={busy || running} onChange={e=>{if(!confirmDiscardChanges('未保存の変更を破棄して計画期間を切り替えますか？'))return;const hash=e.target.value;setPreview(null);setCancelReason('');void act(async()=>{setInput(await request<Input>(`/inputs/latest${query}&input_hash=${hash}`));setDraft(null);setDraftConflict(null);setJob(null);setFindings([]);});}}>
      {periods.map(p=><option key={p.input_hash} value={p.input_hash}>{dateText(p.period.start)}〜{dateText(p.period.end)}{p.stale?'（再確認が必要）':''}</option>)}
    </select></label>}
    {!error&&!scopesLoaded && <p role="status">所属と操作権限を読み込み中…</p>}
    {scopesLoaded&&!scopes.length && <><p>利用可能な所属がありません。管理者による本人と所属権限の登録が必要です。</p><MembershipHelp/></>}
    {current&&!canEdit&&<label className="block">表示する月（本人の公開勤務）<input type="month" className="ui-control block" value={viewMonth} onChange={e=>setViewMonth(e.target.value)}/></label>}
    {error && <p role="alert" className="rounded border border-danger p-3 whitespace-pre-wrap">{error}</p>}
    {draftConflict&&<section role="alert" className="workflow-panel border p-3"><h3>勤務案の更新競合</h3><p>編集開始時（第{draftConflict.base.version}版）：{draftConflict.base.proposal.duty_ids.join('、')}</p><p>現在（第{draftConflict.current.version}版）：{draftConflict.current.proposal.duty_ids.join('、')}</p><p>編集中：{draftConflict.proposed.join('、')}</p><button className="ui-button ui-button-secondary" onClick={()=>{setDraft(draftConflict.current);setSelected(draftConflict.proposed);setDraftConflict(null);setMessage('三つの内容を確認しました。保持した勤務案を保存してから再検証してください。');}}>三つの勤務案を確認して編集を続ける</button></section>}
    <p role="status" aria-live="polite">{message}</p>
    {publicationsLoading&&<p role="status">公開勤務を取得中…</p>}
    {canEdit&&inputLoading&&<p role="status">表示する計画期間を取得中…</p>}
    {publicationsLoaded&&!publicationsLoading&&current&&displayPeriod&&(!canEdit||(!inputLoading&&inputScope===scope)) && <MonthlySchedule key={scope+':'+(input?.input_hash??viewMonth)} people={input?.snapshot.people??[]} duties={draft?.status==='DRAFT'&&input?input.snapshot.candidates.filter(d=>selected.includes(d.duty_id)):publishedDuties} previous={calendarPublications.comparison} fixedDuties={draft?.status==='DRAFT'?calendarPublications.fixed:[]} period={displayPeriod} draft={draft?.status==='DRAFT'} published={hasPublication} flexPeople={flexPeople} />}
    {current?.role === 'ADMIN' && <label className="block border p-4">契約・配置・勤務候補の登録ファイルを取り込む
      <input className="ui-control block w-full" type="file" accept=".json,application/json" disabled={busy || running || inputLoading || inputScope !== scope || !!preview} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void act(()=>previewFile(file));}} />
      <span className="block text-sm">原本から確認した情報を登録してください。未確認の制度を自動で適合扱いにはしません。</span>
    </label>}
    {preview && <section aria-label="取込ファイルの確認" className="workflow-panel border p-4 space-y-2 min-w-0 break-words [overflow-wrap:anywhere]">
      <h3 className="font-semibold">取込ファイルの確認：{preview.name}</h3>
      <p>ファイルの施設・部署：{preview.scope}／選択中：{scope}</p>
      {preview.scope !== scope && <p role="alert">選択中の部署と異なるため、登録できません。正しい部署を選ぶか、ファイルを確認してください。</p>}
      <p>計画期間：{preview.period ? `${dateText(preview.period.start)}〜${dateText(preview.period.end)}` : '記載なし'}</p>
      <p>比較した入力：{preview.base ? `${dateText(preview.base.period.start)}〜${dateText(preview.base.period.end)}` : 'なし（この部署の最初の入力）'}{preview.base && preview.period && (preview.base.period.start !== preview.period.start || preview.base.period.end !== preview.period.end) ? '（ファイルと期間が異なります）' : ''}</p>
      <p>職員 {preview.people}人（追加 {preview.added.length}人・現在の入力にない／削除 {preview.removed.length}人）・勤務候補 {preview.candidates}件・必要配置 {preview.demands}件</p>
      {preview.added.length > 0 && <p>追加される職員：{shortList(preview.added.map(addedName))}</p>}
      {preview.removed.length > 0 && <p>現在の入力から外れる職員：{shortList(preview.removed.map(personName))}</p>}
      <button className="ui-button ui-button-secondary" disabled={busy || preview.scope !== scope} onClick={()=>void act(registerPreview)}>この内容で登録する</button>
      <button className="ui-button ui-button-secondary ml-2" disabled={busy} onClick={()=>{setPreview(null);setMessage('取込を取り消しました。');}}>取込を取り消す</button>
    </section>}
    {current && <nav aria-label="勤務表内の移動" className="workflow-section-nav">{canEdit&&input&&<a href="#contract-heading">契約・必要配置と生成</a>}{canEdit&&draft&&<a href="#draft-heading">勤務案の確認・公開</a>}<a href="#published-heading">公開済み勤務</a><a href="#notices-heading">通知</a></nav>}
    {current && canEdit && <section aria-label="現在の計画状態" className="workflow-panel rounded-xl border border-line bg-surface p-4 space-y-3">
      <p>権限：{departmentRoleLabel(current.role)} ／ 対象：{scope}</p>
      <ol className="grid gap-3 sm:grid-cols-3" aria-label="生成から公開まで">
        <li className="rounded-lg bg-canvas p-3"><strong>1. 勤務案</strong><p>{running?'計算中':draft?'作成済み':'未作成'}</p></li>
        <li className="rounded-lg bg-canvas p-3"><strong>2. 検証・確認</strong><p>{draftDirty?'未保存の変更あり':draft?.review_hash?'現在版の確認済み':'未確認'}</p></li>
        <li className="rounded-lg bg-canvas p-3"><strong>3. 公開</strong><p>{!draft?'作業中の案なし':draft.status==='PUBLISHED'?'この案を公開済み':'この案は未公開'}</p></li>
      </ol>
      {!draft && <p className="text-sm">作業中の案はありません。公開済み勤務は上の月間勤務表で確認できます。</p>}
      {draft && <p className="text-sm">作業中の案：版 {draft.version}。公開済み勤務は下の一覧で確認できます。</p>}
    </section>}
    {!routeView&&scope && current && <LeaveRequestWorkspace scope={scope} personId={current.person_id} canReview={canEdit} onChanged={()=>{if(canEdit)void request<Input>(`/inputs/latest${query}`).then(setInput).catch(e=>setError(errorText(e)));}} />}
    {canEdit && input && <section aria-labelledby="contract-heading" className="space-y-3">
      <h2 id="contract-heading" className="text-xl font-semibold">契約と適用期間</h2>
      <p>{dateText(input.snapshot.period.start)} 〜 {dateText(input.snapshot.period.end)}</p>
      {input.stale && <p role="alert">実績や申請が更新されています。情報を反映して再確認してください。</p>}
      {current?.role === 'ADMIN' && <div className="workflow-panel space-y-2 border p-3">
        <button className="ui-button ui-button-secondary" disabled={busy || running} onClick={()=>void act(async()=>{await request(`/inputs/refresh${query}`,'POST',{expected_revision:input.input_revision,input_hash:input.input_hash});setPeriods(await request<Period[]>(`/inputs${query}`));setInput(await request<Input>(`/inputs/latest${query}`));setDraft(null);setMessage('最新の申請・実績・休暇残数を反映しました。');})}>申請・実績を計画に反映</button>
        <h3 className="font-semibold">契約・資格から勤務候補を再導出</h3>
        <p>元の入力版は上書きせず、新しい入力版を作ります。承認済み記録だけがサーバーで反映されます。</p>
        <label className="block">再導出する理由（必須）<input className="ui-control block w-full" value={deriveReason} onChange={event=>setDeriveReason(event.target.value)} /></label>
        <label className="block">根拠の参照（必須）<input className="ui-control block w-full" value={deriveReference} onChange={event=>setDeriveReference(event.target.value)} /></label>
        <button className="ui-button ui-button-secondary" disabled={busy||running||!deriveReason.trim()||!deriveReference.trim()} onClick={()=>void act(deriveCandidates)}>新しい入力版を作る</button>
      </div>}
      <div className="overflow-auto" tabIndex={0} role="region" aria-label="契約一覧（横スクロール可能）"><table className="ui-data-table w-full min-w-[40rem] border text-left"><caption className="sr-only">職員の契約と確認状態</caption><thead><tr>{['職員','雇用','勤務区分','制度','適用期間','根拠確認'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
      {input.snapshot.contracts.map(c=><tr key={c.revision_id} className="border-t"><td className="p-2">{personName(c.person_id)}</td><td>{c.engagement === 'agency'?'派遣':'直接雇用'}</td><td>{c.time_category === 'part_time'?'短時間':'常勤'}</td><td>{regimeLabel(c.regime)}</td><td>{dateText(c.start)}〜{dateText(c.end)}</td><td>{c.evidence.status === 'verified' && c.regime_evidence.status === 'verified'?'確認済み':'未確認'}</td></tr>)}
      </tbody></table></div>
      {flexPeople.length>0 && <FlexSettlementPanel scope={scope} inputHash={input.input_hash} />}
      <details><summary>必要配置の登録・訂正</summary><ContractWorkflow scope={scope} inputHash={input.input_hash} group="demand" onChanged={()=>request<Input>(`/inputs/latest${query}&input_hash=${encodeURIComponent(input.input_hash)}`).then(setInput).catch(e=>setError(errorText(e)))}/></details>
      <Button variant="default" className="h-auto min-h-11 whitespace-normal" disabled={busy || running || input.stale} onClick={()=>void act(generate)}>勤務案を生成</Button>
      {job && <p role="status">生成状態：{statusLabels[job.status] ?? job.status}</p>}
      {job?.result?.diagnostics?.map((d,i)=><p key={i}>{findingText(diagnosticText(d))}</p>)}
      {running && <button className="ui-button ui-button-secondary" onClick={()=>void act(async()=>{await request(`/jobs/${job.job_id}/cancel${query}`,'POST');setJob({...job,status:'CANCELLED'});})}>生成を中止</button>}
    </section>}
    {canEdit && draft && input && <section aria-labelledby="draft-heading" className="space-y-3">
      <h2 id="draft-heading" className="text-xl font-semibold">勤務案の確認・編集（版 {draft.version}）</h2>
      <div className="overflow-auto max-h-96"><table className="ui-data-table w-full text-left"><thead><tr><th>割当</th><th>職員</th><th>開始</th><th>終了</th><th>業務・場所</th></tr></thead><tbody>
        {input.snapshot.candidates.map((d,index)=>{const rowId=`draft-duty-${index}`;return <tr key={d.duty_id} className="border-t"><td><input className="ui-choice" type="checkbox" aria-labelledby={`${rowId}-person ${rowId}-start`} checked={selected.includes(d.duty_id)} disabled={busy || draft.status !== 'DRAFT'} onChange={e=>setSelected(old=>e.target.checked?[...old,d.duty_id]:old.filter(id=>id!==d.duty_id))}/></td><td id={`${rowId}-person`}>{personName(d.person_id)}</td><td id={`${rowId}-start`}>{dateText(d.start)}</td><td>{dateText(d.end)}</td><td>{d.task}・{d.location}{new Date(d.start)>=new Date(input.snapshot.period.end)?'（先読み用の暫定配置）':''}</td></tr>;})}
      </tbody></table></div>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy || !draftDirty || draft.status !== 'DRAFT'} onClick={()=>void act(saveDraft)}>編集を保存</Button>
        <Button variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy || draftDirty || draft.status !== 'DRAFT'} onClick={()=>void act(review)}>内容を検証・確認</Button>
        <Button variant="default" className="h-auto min-h-11 whitespace-normal" disabled={busy || draftDirty || !draft.review_hash || draft.status !== 'DRAFT'} onClick={()=>void act(publish)}>確認した案を公開</Button>
      </div>
      {draftDirty && <p>未保存の変更があります。保存すると以前の確認は解除されます。</p>}
      <ul>{findings.map((f,i)=><li key={i} className="border rounded-control p-3">{findingStatus(f.status)}：{findingText(f.message)}（{f.rule_id}）</li>)}</ul>
    </section>}
    <section aria-labelledby="published-heading"><h2 id="published-heading" className="text-xl font-semibold">公開済み勤務</h2>
      <p className="text-sm">この一覧は全期間の公開版です。上の月間勤務表は選択した期間だけを表示します。</p>
      {publicationsLoaded&&!publicationsLoading&&publications.length === 0 && <p>公開済みの勤務表はありません。</p>}
      {canEdit && <label className="block">公開取消の理由・勤務変更の調整記録<input className="ui-control block w-full" value={cancelReason} onChange={e=>setCancelReason(e.target.value)} /></label>}
      {publications.map(p=><details key={p.publication_id} className="border p-3"><summary>公開版 {p.version}：{p.assignments.length} 件{p.validation_status === 'revalidation_required'?'（入力更新により再確認が必要）':''}</summary><ul>{p.assignments.map(d=><li key={d.duty_id}>{personName(d.person_id)}：{dateText(d.start)}〜{dateText(d.end)} {d.task}</li>)}</ul>
      {canEdit && <PublicationExport key={`${scope}-${p.publication_id}`} scope={scope} publication={p.publication_id} version={p.version} />}
      {canEdit && <Button variant="destructive" className="h-auto min-h-11 whitespace-normal" disabled={busy || !cancelReason.trim()} onClick={()=>void act(async()=>{await request(`/publications/${p.publication_id}/cancel${query}`,'POST',{expected_version:p.version,reason:cancelReason});setPublications(await request<Publication[]>(`/publications${query}`));setNotices(await request<Notice[]>(`/notifications${query}`));if(input)setInput(await request<Input>(`/inputs/latest${query}&input_hash=${input.input_hash}`));setCancelReason('');setMessage('公開を取り消しました。通知と調整記録を確認してください。');})}>理由を記録して公開取消</Button>}</details>)}
    </section>
    <section aria-labelledby="notices-heading"><h2 id="notices-heading" className="text-xl font-semibold">公開通知</h2>{notices.map(n=><p key={n.event_id}>{n.kind === 'schedule.cancelled' ? '公開取消' : '公開'} 版 {n.version} {n.read?'確認済み':<button className="ui-button ui-button-secondary underline" onClick={()=>void act(async()=>{await request(`/notifications/${n.event_id}/read${query}`,'POST');setNotices(await request<Notice[]>(`/notifications${query}`));})}>確認しました</button>}</p>)}</section>
  </div>;
}
