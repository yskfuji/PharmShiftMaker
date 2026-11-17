import {defineConfig} from '@playwright/test';
import base from './playwright.remediation.config';
const destination=process.env.E2E_EVIDENCE_DIR;
if(!destination)throw new Error('Set a new E2E_EVIDENCE_DIR for this acceptance run');
export default defineConfig({...base,outputDir:`${destination}/artifacts`,
 reporter:[['list'],['json',{outputFile:`${destination}/results.json`}]],
 webServer:(Array.isArray(base.webServer)?base.webServer:[]).map((server,index)=>({...server,
 env:index?server.env:{...server.env,PHARMSHIFT_E2E_GRANT_SERIES:'1'}}))});
