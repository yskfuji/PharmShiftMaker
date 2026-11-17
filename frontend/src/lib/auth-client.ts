"use client";
import {API_BASE_URL} from './apiTarget';
/** Explicit person/role projection for old unscoped APIs, never account display. */
export async function getLegacyClientContext(signal?: AbortSignal) {
  const response=await fetch(`${API_BASE_URL}/auth/legacy-context`,{credentials:'include',cache:'no-store',signal});
  if(!response.ok) throw new Error(`互換管理の対象を確認できません（HTTP ${response.status}）`);
  const body=await response.json();
  if(typeof body.person_id!=='string'||!body.person_id)throw new Error('Invalid legacy person');
  return {personId:body.person_id as string};
}
