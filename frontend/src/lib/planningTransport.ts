import {API_BASE_URL} from './apiTarget';
import {currentLocation, loginPath} from './loginPath';

export class PlanningError extends Error {
  constructor(public readonly status: number, detail: string) {super(`${status}: ${detail}`);}
}

/** One editing identity, one retry journal. No cross-page/account global cache. */
export function createPlanningTransport(identity: string) {
  const keys = new Map<string, string>();
  return async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (method !== 'GET' && (/^\/(jobs|drafts)(\/|\?)/.test(path) || /^\/publications\/[^/]+\/cancel/.test(path))) {
      const data = (body ?? {}) as Record<string, unknown>;
      if (!data.idempotency_key) {
        const fingerprint = JSON.stringify({identity, path, method, data});
        let key = keys.get(fingerprint);
        if (!key) {key = crypto.randomUUID(); keys.set(fingerprint, key);}
        body = {...data, idempotency_key: key};
      }
    }
    const response = await fetch(`${API_BASE_URL}/planning${path}`, {method, credentials:'include', cache:'no-store',
      headers: {'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    if (!response.ok) {
      if (response.status === 401) window.location.assign(loginPath(currentLocation()));
      throw new PlanningError(response.status, response.status === 401 ? 'ログインし直してください。' : await response.text());
    }
    return response.json() as Promise<T>;
  };
}
