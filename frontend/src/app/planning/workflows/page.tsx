import {getLegacyIdentityContext} from '@/lib/identity-server';
import type { Metadata } from 'next';
import WorkflowIndex from '@/components/WorkflowIndex';

export const metadata: Metadata = { title: '業務管理' };

export default async function WorkflowIndexPage() {
  const role=(await getLegacyIdentityContext())?.effective_role ?? 'UNAVAILABLE';
  return <WorkflowIndex canReadLegacyQuotas={['LEADER','ADMIN','DEVELOPER'].includes(role)} />;
}
