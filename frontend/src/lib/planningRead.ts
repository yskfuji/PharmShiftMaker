import {API_BASE_URL} from './apiTarget';

export class PlanningReadError extends Error {
  constructor(public readonly status: number) {
    const messages: Record<number, string> = {
      401: 'ログインし直してください。', 403: 'この部署の情報を見る権限がありません。',
      409: '情報が更新されています。再読込してください。', 422: '対象の部署・期間を確認してください。',
      423: '利用制限中です。管理者に確認してください。', 503: '現在情報を取得できません。復旧後に再読込してください。',
    };
    super(messages[status] ?? '情報を取得できませんでした。接続を確認して再試行してください。');
  }
}

export async function planningRead<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(`${API_BASE_URL}/planning${path}`, {credentials: 'include', cache: 'no-store', signal}); }
  catch (error) {if(signal?.aborted)throw error;throw new PlanningReadError(0);}
  if (!response.ok) throw new PlanningReadError(response.status);
  try {return await response.json() as T;} catch {throw new PlanningReadError(502);}
}
