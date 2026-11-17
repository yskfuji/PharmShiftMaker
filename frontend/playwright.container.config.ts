import {defineConfig} from '@playwright/test';
import base from './playwright.remediation.config';
// Dedicated externally started synthetic services, bridged by the owned runner.
export default defineConfig({...base,webServer:undefined});
