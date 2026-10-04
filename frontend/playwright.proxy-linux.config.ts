import {defineConfig,devices} from '@playwright/test';
// S03 production-like check: TLS-terminating nginx on the host name pharmshift.test
// (same origin for pages and /api), Secure cookies, the 15-minute idle limit shortened
// to 60 seconds for the run. The browsers run in a Docker container on the proxy's network.
const output=process.env.PHARMSHIFT_PROXY_OUTPUT??'../audit/decisions-2026-09-27-r2/proxy-browser';
export default defineConfig({
 testDir:'./tests/proxy-e2e',workers:1,timeout:240000,retries:0,
 outputDir:output+'/artifacts',
 reporter:[['list'],['json',{outputFile:output+'/results.json'}]],
 use:{baseURL:'https://pharmshift.test:18540',ignoreHTTPSErrors:true,locale:'ja-JP',timezoneId:'Asia/Tokyo',trace:'on'},
 projects:[
  // Playwright disables the back/forward cache by default; it is enabled here so the
  // sign-out check meets the cache that real browsers use.
  {name:'chromium-linux',use:{...devices['Desktop Chrome'],launchOptions:{ignoreDefaultArgs:['--disable-back-forward-cache']}}},
  {name:'firefox-linux',use:{...devices['Desktop Firefox']}},
  {name:'webkit-linux',use:{...devices['Desktop Safari']}},
 ],
});
