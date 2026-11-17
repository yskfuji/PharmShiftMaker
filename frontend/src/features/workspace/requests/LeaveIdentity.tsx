export type LeaveIdentityFields={person_name?:string|null;employer_name?:string|null;granted_on?:string|null};
export function leaveOwner(value:LeaveIdentityFields){return `${value.person_name||'職員名未確認'} ／ ${value.employer_name||'雇用主名未登録'}`;}
export function leaveGrant(value:LeaveIdentityFields){return `${leaveOwner(value)} ／ 付与日 ${value.granted_on||'未確認'}`;}
export function LeaveReference({kind,value}:{kind:string;value:string}){return <details className="text-sm"><summary>識別情報</summary><p className="break-all">{kind}：{value}</p></details>;}
