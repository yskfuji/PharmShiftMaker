"use server";
import {getAuthToken} from './auth';
import {API_BASE_URL} from './apiTarget';
import {ensureHttpsDispatcher} from './httpsDispatcher';
import {parseIdentity} from './identity';

export async function getVerifiedIdentity() {
  ensureHttpsDispatcher();
  const token=await getAuthToken();
  const response=await fetch(`${API_BASE_URL}/auth/me`,{cache:'no-store',headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`本人情報を確認できません（HTTP ${response.status}）`);
  return parseIdentity(await response.json());
}

/** Old unscoped APIs project one department membership; never call this an account identity. */
export async function getLegacyIdentityContext() {
  ensureHttpsDispatcher();
  const token=await getAuthToken();
  const response=await fetch(`${API_BASE_URL}/auth/legacy-context`,{cache:'no-store',headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(15000)});
  if(response.status===403)return null;
  if(!response.ok) throw new Error(`互換管理の対象を確認できません（HTTP ${response.status}）`);
  const body=await response.json();
  if(typeof body.person_id!=='string'||!['ADMIN','DEVELOPER','LEADER','PHARMACIST'].includes(body.effective_role))throw new Error('Invalid legacy context');
  return body as {person_id:string;effective_role:string};
}
