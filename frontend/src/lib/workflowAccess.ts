export const workflowPages = {
  contracts: '契約・制度', outside: '兼業・派遣照合', leave: '休暇',
  actuals: '実績', privacy: '個人情報管理', recovery: '復旧状況',
} as const;
export type WorkflowPage = keyof typeof workflowPages;


/**
 * Who may open each business workflow (the API checks again on every request).
 * Contracts and recovery are administrator work; actuals are for administrators and
 * leaders; the others are open to every member.
 */
export function canOpenWorkflow(page: WorkflowPage, role: string): boolean {
  if (page === 'contracts' || page === 'recovery') return role === 'ADMIN';
  if (page === 'actuals') return role === 'ADMIN' || role === 'LEADER';
  return true;
}

/** Display-only descriptions. Authorization remains in canOpenWorkflow and the API. */
export const workflowPurpose: Record<WorkflowPage, string> = {
  contracts: '職員と雇用関係を選び、契約・資格・協定・制度の適用期間と根拠を確認します。',
  outside: '本人の申告と管理者の原本照合を分け、差戻しから確認結果まで追跡します。',
  leave: '休暇の請求・判断、残高、取得実績を確認します。予約は実取得と区別します。',
  actuals: '原本を取り込み、公開勤務との対応・行別エラー・差分を確認して記録します。',
  privacy: '本人対応、保存・保全、コピーの確認、消去結果と残存を管理します。',
  recovery: '遮断理由と復旧段階、適用制御、照合結果を確認します。実復元は運用CLIで行います。',
};
