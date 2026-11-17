/** API display contract; global roles are not department memberships. */
export type VerifiedIdentity = {
  user_id: string;
  display_name: string | null;
  global_role: 'ADMIN' | 'DEVELOPER' | 'LEADER' | 'PHARMACIST';
  identifier_kind: 'login_id' | 'account_id';
};
export function parseIdentity(value: unknown): VerifiedIdentity {
  const v = value as Partial<VerifiedIdentity> | null;
  if (!v || typeof v.user_id !== 'string' || !v.user_id ||
      !(v.display_name === null || typeof v.display_name === 'string') ||
      !['ADMIN','DEVELOPER','LEADER','PHARMACIST'].includes(v.global_role ?? '') ||
      !['login_id','account_id'].includes(v.identifier_kind ?? '')) throw new Error('Invalid identity response');
  return v as VerifiedIdentity;
}
