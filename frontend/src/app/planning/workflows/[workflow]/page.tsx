import type {Metadata} from 'next';
import BusinessWorkflow from '@/components/BusinessWorkflow';
import {workflowPages,type WorkflowPage} from '@/lib/workflowAccess';
import NotFound,{NOT_FOUND_METADATA} from '@/app/not-found';

// An unknown workflow name shows the not-found view rendered here on the server (see app/not-found.tsx).
export default async function WorkflowRoute({params}:{params:Promise<{workflow:string}>}){
  const {workflow}=await params;
  if(!Object.hasOwn(workflowPages,workflow))return <NotFound/>;
  return <BusinessWorkflow page={workflow as WorkflowPage}/>;
}

export async function generateMetadata({params}:{params:Promise<{workflow:string}>}):Promise<Metadata>{
  const {workflow}=await params;
  return Object.hasOwn(workflowPages,workflow)?{title:workflowPages[workflow as WorkflowPage]}:NOT_FOUND_METADATA;
}
