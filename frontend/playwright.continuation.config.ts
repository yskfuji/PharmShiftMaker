import {defineConfig} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import base from './playwright.remediation-linux.config';
const run=process.env.E2E_RUN;
if(!run||!/^[-a-zA-Z0-9_]+$/.test(run))throw new Error('A unique E2E_RUN is required');
const output=path.resolve(__dirname,'../audit/continuation-2026-09-22',`browser-${run}`);
if(process.env.PHARMSHIFT_EVIDENCE_RESERVED!==run||!fs.existsSync(output))throw new Error('Use the evidence-reserving visual runner');
export default defineConfig({...base,outputDir:output+'/artifacts',
 reporter:[['list'],['json',{outputFile:output+'/results.json'}]],
 use:{...base.use,locale:'ja-JP',timezoneId:'Asia/Tokyo'},
});
