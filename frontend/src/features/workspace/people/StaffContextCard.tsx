"use client";

import {useEffect, useState} from 'react';
import {API_BASE_URL} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
import {occupationOptions} from './OccupationField';

type Context = {
  person_id: string;
  permission: string;
  occupation: string | null;
  occupation_status: 'recorded' | 'unknown';
};
const permissions: Record<string, string> = {
  ADMIN: '管理者', LEADER: '責任者', STAFF: '職員', PHARMACIST: '職員（旧権限）',
};

export default function StaffContextCard({scopeId}: {scopeId: string}) {
  const [result, setResult] = useState<{scope: string; context?: Context; error?: string} | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/planning/staff-context?scope_id=${encodeURIComponent(scopeId)}`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          const messages: Record<number, string> = {
            401: 'サインインの有効期限が切れています。再度サインインしてください。',
            403: 'この部署の職種・権限を確認する権限がありません。所属を管理者に確認してください。',
            423: '利用制限中のため、職種・権限を表示できません。管理者に制限状態を確認し、対応後に再取得してください。',
            503: '職種・権限を現在取得できません。時間をおいて再取得してください。',
          };
          throw new Error(messages[response.status] ?? `職種・権限の取得に失敗しました（${response.status}）`);
        }
        return response.json();
      })
      .then((context: Context) => {
        if (!context || typeof context.person_id !== 'string'
          || !Object.hasOwn(permissions, context.permission)
          || !['recorded', 'unknown'].includes(context.occupation_status)
          || (context.occupation !== null && !occupationOptions.some(o => o.value === context.occupation))) {
          throw new Error('職種・権限の応答を確認できません');
        }
        if (!controller.signal.aborted) setResult({scope: scopeId, context});
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({scope: scopeId, error: errorText(error)});
      });
    return () => controller.abort();
  }, [scopeId, attempt]);
  const current = result?.scope === scopeId ? result : null;
  return (
    <section className="ideal-panel" aria-label="あなたの職種と操作権限">
      <h2>あなたの職種と操作権限</h2>
      {current?.context ? (
        <dl className="ideal-grid ideal-grid--2">
          <div><dt>職種</dt><dd>{occupationOptions.find(o => o.value === current.context?.occupation)?.label ?? '未確認'}</dd></div>
          <div><dt>操作権限</dt><dd>{permissions[current.context.permission]}</dd></div>
        </dl>
      ) : <p role="status">{current?.error ?? '職種と操作権限を確認しています…'}</p>}
      {current?.error && (
        <button className="ideal-button ideal-button--secondary" onClick={() => {
          setResult(null);
          setAttempt(n => n + 1);
        }}>再取得する</button>
      )}
      <p className="ideal-note">担当できる業務は、職種だけでなく、確認済みの資格・担当条件と有効期間に基づいて決まります。</p>
    </section>
  );
}
