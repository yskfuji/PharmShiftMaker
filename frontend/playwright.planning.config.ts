import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const root=path.resolve(__dirname,'..');
const localNode=path.join(root,'tools/node24/node_modules/node/bin/node');
const node=fs.existsSync(localNode)?localNode:process.execPath;
const python=process.env.E2E_PYTHON??path.join(root,'.venv/bin/python');
export default defineConfig({
  testDir:'./tests/planning-e2e',workers:1,timeout:60000,retries:0,
  reporter:[['list'],['json',{outputFile:'../audit/implementation-2026-09-21/browser-results.json'}]],
  use:{baseURL:'https://127.0.0.1:18501',ignoreHTTPSErrors:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:[
    {command:`"${python}" -m scripts.planning_test_server`,cwd:root,port:18500,reuseExistingServer:false,timeout:30000},
    {command:`"${node}" scripts/start-https-server.mjs --hostname 127.0.0.1 --port 18501`,cwd:__dirname,port:18501,reuseExistingServer:false,timeout:30000,
     env:{NEXT_DIST_DIR:'.next-planning-audit',NEXT_PUBLIC_API_BASE_URL:'https://127.0.0.1:18500',NEXT_SSL_CERT_PATH:path.join(root,'certs/localhost-cert.pem'),NEXT_SSL_KEY_PATH:path.join(root,'certs/localhost-key.pem'),NEXT_TELEMETRY_DISABLED:'1'}},
  ],
});
