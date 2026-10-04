'use client';
import {departmentRoleLabel} from '@/lib/departmentRole';
import {useEffect, useState} from 'react';
import useNavigationContext from '../useNavigationContext';
import {monthInterval} from '@/lib/calendar';
import {planningRead} from '@/lib/planningRead';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/Card';
import {errorText} from '@/lib/errorText';
import MembershipHelp from '@/components/MembershipHelp';

type Membership = {scope_id: string; role: string};
type Metric = {value: number | null; state: 'available' | 'unknown'; reason: string | null};
type Summary = {scope_id: string; period: string; role: string; visibility: string; observed_at: string;
  sources: {kind: string; id: string; version: number}[]; metrics: Record<string, Metric>};
const labels: Record<string, string> = {published_periods: '公開中の計画期間', assigned_duties: '公開勤務の割当', pending_requests: '判断待ちの休暇申請', revalidation_required: '再検証が必要な公開版'};

export default function LiveDashboard({initialPeriod}: {initialPeriod: string}) {
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [scope, setScope] = useState('');
  const [period, setPeriod] = useState(initialPeriod);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    planningRead<Membership[]>('/scopes', controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      const query=new URLSearchParams(window.location.search);
      const incoming=query.get('scope');
      const month=query.get('period');
      setMembers(rows); setScope(previous => rows.some(r => r.scope_id === previous) ? previous : rows.find(r=>r.scope_id===incoming)?.scope_id ?? rows[0]?.scope_id ?? '');
      if(month&&monthInterval(month))setPeriod(month);
    }).catch(e => {if (!controller.signal.aborted) setError(errorText(e));});
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setSummary(null); setError('');
    if (scope && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      planningRead<Summary>(`/dashboard?scope_id=${encodeURIComponent(scope)}&period=${period}`, controller.signal)
        .then(value => {if (!controller.signal.aborted) setSummary(value);})
        .catch(e => {if (!controller.signal.aborted) setError(errorText(e));});
    }
    return () => controller.abort();
  }, [scope, period, attempt]);
  useNavigationContext(scope,period);
  // Do not show a previous department/month even during the render before effect cleanup.
  const current = summary?.scope_id === scope && summary.period === period ? summary : null;
  return <section className="mt-6 space-y-6" aria-label="対象月の業務状況">
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-4">
      <label className="min-w-0">施設・部署<select className="ui-control block mt-2 min-h-11 max-w-full rounded-lg border border-control bg-surface px-3 py-2 text-fg" value={scope} onChange={e => setScope(e.target.value)}>{members?.map(m => <option key={m.scope_id} value={m.scope_id}>{m.scope_id}</option>)}</select></label>
      <label className="min-w-0">対象月<input className="ui-control block mt-2 min-h-11 max-w-full rounded-lg border border-control bg-surface px-3 py-2 text-fg" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></label>
      <p className="text-sm text-fg-muted">権限：{departmentRoleLabel(members?.find(m => m.scope_id === scope)?.role)}</p>
    </div>
    {error ? <div role="alert" className="rounded-lg border border-danger p-4"><p>{error}</p><button className="ui-button ui-button-secondary mt-3 min-h-11 rounded-lg border border-control px-4 py-2" type="button" onClick={() => setAttempt(n => n + 1)}>再読込</button></div>
      : members?.length === 0 ? <><p role="status">所属が登録されていません。管理者に確認してください。</p><MembershipHelp /></>
      : !period ? <p role="status">対象月を選択してください。</p>
      : !current ? <p role="status">業務状況を取得中…</p> : <>
        <p>{current.visibility === 'self' ? '自分の割当・申請と、所属部署の公開状況を表示しています。' : '選択した部署の公開状況・申請を表示しています。'} 件数は法令適合率や勤務負担率ではありません。</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(labels).map(([key, label]) => {
          const metric = current.metrics[key];
          return <Card key={key}><CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums">{metric?.state === 'available' && metric.value !== null ? `${metric.value}件` : '未確認'}</p>{metric?.reason && <p className="mt-2 text-sm">{metric.reason}</p>}</CardContent></Card>;
        })}</div>
        <div className="rounded-xl border border-line bg-surface p-4 space-y-3"><h2 className="text-lg font-bold">次の操作</h2>
          <div className="flex flex-wrap gap-3"><a className="underline p-2" href={`/planning?scope=${encodeURIComponent(scope)}&period=${period}`}>勤務表・公開状態を確認</a><a className="underline p-2" href={`/planning/workflows/leave?scope=${encodeURIComponent(scope)}&period=${period}`}>休暇の申請・判断</a></div>
          <p className="text-sm text-fg-muted">取得時刻：{new Date(current.observed_at).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}（日本時間）</p>
          <details><summary>集計の参照元</summary><ul className="mt-2 space-y-2">{current.sources.map(s => <li key={`${s.kind}:${s.id}`} className="break-all text-sm">{s.kind === 'publication' ? '公開版' : '申請'}：{s.id} ／版 {s.version}</li>)}</ul>{!current.sources.length && <p>対象月の該当記録はありません。</p>}</details>
        </div>
      </>}
  </section>;
}
