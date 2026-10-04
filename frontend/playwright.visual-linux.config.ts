import { defineConfig, devices } from '@playwright/test';

/*
 * Visual and optical audit (docs/design-system/README.md). Browsers run in the
 * labelled Linux container (mcr.microsoft.com/playwright:v1.56.1-noble) on
 * ws://127.0.0.1:18526, the same image the formal acceptance uses, so screenshots
 * are reproducible. The container reaches the host's loopback servers through
 * exposeNetwork: Storybook static build on 18530, the synthetic app on 18531.
 * Screenshot baselines (chromium only) live in tests/visual/__screenshots__ and are
 * rewritten only with VISUAL_BASELINE_UPDATE=1 (reason recorded in
 * docs/design-system/baseline-log.md). Optical checks run in all three engines.
 */
const output = process.env.VISUAL_OUTPUT ?? 'tests/visual/.output';
const connect = { wsEndpoint: process.env.VISUAL_BROWSER_WS ?? 'ws://127.0.0.1:18526', exposeNetwork: '<loopback>' };

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  workers: Number(process.env.VISUAL_WORKERS ?? 1),
  retries: 0,
  timeout: 120_000,
  outputDir: output + '/artifacts',
  reporter: [['list'], ['json', { outputFile: output + '/results.json' }]],
  updateSnapshots: process.env.VISUAL_BASELINE_UPDATE === '1' ? 'all' : 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', scale: 'css' } },
  use: { ignoreHTTPSErrors: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: 'light', connectOptions: connect,
    screenshot: 'off', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-linux', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-linux', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-linux', use: { ...devices['Desktop Safari'] } },
  ],
});
