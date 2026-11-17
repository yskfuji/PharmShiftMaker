/** Only translates the backend's obligation result; never calculates legal compliance. */
export function obligationStatusLabel(status: string): string {
  switch(status) {
    case 'fulfilled': return '取得実績で充足';
    case 'overdue': return '期限経過後の未達';
    case 'at_risk': return '期限前・取得不足の見込み';
    default: return '未対応の取得義務状態・確認が必要';
  }
}
