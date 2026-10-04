import {defineConfig,devices} from '@playwright/test';
const output=process.env.PHARMSHIFT_VISUAL_OUTPUT??'../audit/remediation-2026-09-22/browser-linux-r2';
export default defineConfig({
 testDir:'./tests/remediation-e2e',workers:1,timeout:60000,retries:0,
 outputDir:output+'/artifacts',
 reporter:[['list'],['json',{outputFile:output+'/results.json'}]],
 use:{baseURL:process.env.PHARMSHIFT_E2E_FRONTEND_ORIGIN??'https://127.0.0.1:18511',ignoreHTTPSErrors:true,locale:'ja-JP',timezoneId:'Asia/Tokyo',trace:process.env.E2E_RETAIN_ALL==='1'?'on':'retain-on-failure',screenshot:process.env.E2E_RETAIN_ALL==='1'?'on':'only-on-failure'},
 projects:[{name:'chromium-linux',use:{...devices['Desktop Chrome']}},{name:'firefox-linux',use:{...devices['Desktop Firefox']}},{name:'webkit-linux',use:{...devices['Desktop Safari']}}],
});
