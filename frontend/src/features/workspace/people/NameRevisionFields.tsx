"use client";

/** Only name-revision input presentation; backend owns evidence validation. */
export default function NameRevisionFields({value, onChange}: {
  value: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const category = String(value.name_change_category ?? 'initial');
  const dated = category === 'surname_change' || category === 'court_permitted_change';
  const optional = (key: string, text: string) => onChange({[key]: text || undefined});
  return <fieldset className="workflow-fieldset border p-3 space-y-2">
    <legend>氏名の改定</legend>
    <label className="block">氏名改定の事由区分
      <select className="ui-control block w-full" value={category}
        onChange={event => onChange({name_change_category: event.target.value})}>
        <option value="initial">初回登録</option><option value="surname_change">婚姻等による氏の変更</option>
        <option value="court_permitted_change">許可を受けた氏名変更</option><option value="clerical_correction">誤記の訂正</option>
      </select>
    </label>
    <label className="block">戸籍・薬剤師名簿上の正式氏名（任意）
      <input className="ui-control block w-full" value={String(value.legal_name ?? '')}
        onChange={event => optional('legal_name', event.target.value)}/>
    </label>
    <label className="block">旧姓・旧氏名（読点区切り・任意）
      <input className="ui-control block w-full" value={Array.isArray(value.former_names) ? value.former_names.join('、') : ''}
        onChange={event => onChange({former_names: event.target.value.split(/[、,，]/).map(item => item.trim()).filter(Boolean)})}/>
    </label>
    <label className="block">適用開始日{dated ? '（必須）' : '（任意）'}
      <input type="date" className="ui-control block w-full" required={dated}
        value={String(value.effective_on ?? '')} onChange={event => optional('effective_on', event.target.value)}/>
    </label>
    <label className="block">薬剤師名簿の確認状況
      <select className="ui-control block w-full" value={String(value.pharmacist_registry_status ?? 'not_required')}
        onChange={event => onChange({pharmacist_registry_status: event.target.value})}>
        <option value="not_required">対象外</option><option value="pending_30day_filing">届出・書換の確認待ち</option>
        <option value="verified">確認済み</option>
      </select>
    </label>
    {!dated && value.pharmacist_registry_status !== 'verified' && <label className="block">
      <input type="checkbox" checked={Boolean(value.evidence)} onChange={event => onChange({evidence: event.target.checked ? {reference: '', status: 'unverified', verified_by: null, valid_until: null} : undefined})}/>
      氏名改定の根拠を記録する
    </label>}
    <p>氏名の変更と職種・操作権限の変更は別です。変更の根拠と確認状況を記録してください。</p>
  </fieldset>;
}
