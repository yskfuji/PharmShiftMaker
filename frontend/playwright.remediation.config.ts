import {defineConfig,devices} from '@playwright/test';
import base from './playwright.planning.config';
const run=process.env.E2E_RUN??'local';
const evidence=process.env.E2E_EVIDENCE_DIR??`../audit/remediation-2026-09-22/browser-${run}`;
export default defineConfig({...base,testDir:'./tests/remediation-e2e',outputDir:`${evidence}/artifacts`,
 reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]],
 use:{...base.use,baseURL:'https://127.0.0.1:18511'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
 webServer:(Array.isArray(base.webServer)?base.webServer:[]).map((server,index)=>({...server,port:index?18511:18510,
   command:index?server.command.replaceAll('18501','18511'):server.command.replace('scripts.planning_test_server','scripts.remediation_test_server'),
   env:index?{...server.env,NEXT_DIST_DIR:process.env.E2E_DIST_DIR??'.next-remediation',NEXT_PUBLIC_API_BASE_URL:'https://127.0.0.1:18510'}:server.env}))});
