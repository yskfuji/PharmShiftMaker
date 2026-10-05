import {defineConfig, devices} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(__dirname,'..');
const destination=process.env.E2E_EVIDENCE_DIR;
if(!destination)throw new Error('Set a new E2E_EVIDENCE_DIR for this acceptance run');
const localNode=path.join(root,'tools/node24/node_modules/node/bin/node');
const node=fs.existsSync(localNode)?localNode:process.execPath;
const python=process.env.E2E_PYTHON??path.join(root,'.venv/bin/python');
const frontendOrigin='https://127.0.0.1:18541';
const tlsCert=process.env.PHARMSHIFT_E2E_TLS_CERT??path.join(root,'certs/localhost-cert.pem');
const tlsKey=process.env.PHARMSHIFT_E2E_TLS_KEY??path.join(root,'certs/localhost-key.pem');
const tlsCa=process.env.PHARMSHIFT_E2E_CA_CERT??tlsCert;
const browserWs=process.env.PW_TEST_CONNECT_WS_ENDPOINT;
const remoteBrowser=browserWs?{connectOptions:{wsEndpoint:browserWs,exposeNetwork:process.env.PW_TEST_CONNECT_EXPOSE_NETWORK??'<loopback>'}}:{};
const pythonPath=[path.join(root,'src'),root,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);

export default defineConfig({
  testDir:'./tests/remediation-e2e',workers:1,timeout:120_000,retries:0,
  reporter:[['list'],['json',{outputFile:`${destination}/results.json`}]],
  outputDir:`${destination}/artifacts`,
  use:{baseURL:frontendOrigin,ignoreHTTPSErrors:true,locale:'ja-JP',timezoneId:'Asia/Tokyo',trace:'retain-on-failure',screenshot:'only-on-failure',...remoteBrowser},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}},
  ],
  webServer:[
    {command:`"${python}" -m scripts.remediation_test_server`,cwd:root,port:18540,reuseExistingServer:false,timeout:30_000,
      env:{PYTHONPATH:pythonPath,PHARMSHIFT_E2E_PORT:'18540',PHARMSHIFT_E2E_FRONTEND_ORIGIN:frontendOrigin,PHARMSHIFT_E2E_PUBLICATION:'1',PHARMSHIFT_E2E_GRANT_SERIES:'1',PHARMSHIFT_E2E_OBSERVATION_TIME:'2026-01-05T09:00:00+09:00',PHARMSHIFT_E2E_TLS_CERT:tlsCert,PHARMSHIFT_E2E_TLS_KEY:tlsKey,PHARMSHIFT_E2E_FLEX:process.env.PHARMSHIFT_E2E_FLEX??'0',PHARMSHIFT_E2E_ACTUAL:process.env.PHARMSHIFT_E2E_ACTUAL??'0',PHARMSHIFT_E2E_PARTIAL_DAY_LEAVE:process.env.PHARMSHIFT_E2E_PARTIAL_DAY_LEAVE??'0',PHARMSHIFT_E2E_EXPIRED_INPUT:process.env.PHARMSHIFT_E2E_EXPIRED_INPUT??'0',PHARMSHIFT_E2E_DEEP:process.env.PHARMSHIFT_E2E_DEEP??'0',PHARMSHIFT_E2E_WORKER_DELAY_SECONDS:process.env.PHARMSHIFT_E2E_WORKER_DELAY_SECONDS??'0',PHARMSHIFT_ERASURE_MANIFEST_KEY:process.env.PHARMSHIFT_E2E_DEEP==='1'?'synthetic-e2e-manifest-key-32-bytes-long':'',PHARMSHIFT_E2E_ERASURE_RECEIPT:process.env.PHARMSHIFT_E2E_ERASURE_RECEIPT??''}},
    {command:`"${node}" scripts/start-https-server.mjs --hostname 127.0.0.1 --port 18541`,cwd:__dirname,port:18541,reuseExistingServer:false,timeout:30_000,
      env:{NEXT_DIST_DIR:process.env.E2E_DIST_DIR??'.next-ideal-integration',NEXT_PUBLIC_API_BASE_URL:'https://127.0.0.1:18540',NEXT_SSL_CERT_PATH:tlsCert,NEXT_SSL_KEY_PATH:tlsKey,NODE_EXTRA_CA_CERTS:tlsCa,NEXT_TELEMETRY_DISABLED:'1',IDEAL_UI:process.env.E2E_IDEAL_UI==='0'?'0':'1'}},
  ],
});
