import {defineConfig,devices} from '@playwright/test';
import base from './playwright.planning.config';
export default defineConfig({...base,testDir:'./tests/completion-e2e',reporter:[['list'],['json',{outputFile:'../audit/completion-2026-09-22/browser-results.json'}]],projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}]});
