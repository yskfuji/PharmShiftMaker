import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/*
 * DIAGNOSTIC ONLY. The workspace's structural checks with a Chromium started on this
 * machine, for iteration while a screen is being repaired:
 *
 *   npx playwright test -c playwright.visual-local.config.ts structure-counter optical-pinned
 *   VISUAL_STORYBOOK_URL=http://127.0.0.1:6006 VISUAL_THEMES=light \
 *     npx playwright test -c playwright.visual-local.config.ts storybook-v3-open
 *
 * It is not evidence. The formal run is playwright.visual-linux.config.ts: the pinned
 * browser container, three engines, and the committed baselines. Rendering here differs
 * from that container (fonts, scrollbars), nothing ties a run to a verified build, and no
 * screenshot is compared (lib/audit.ts compares only in the project named chromium-linux).
 * Output goes outside the repository unless VISUAL_OUTPUT says otherwise.
 */
const output = process.env.VISUAL_OUTPUT ?? join(tmpdir(), 'pharmshift-visual-local');

export default defineConfig({
  testDir: './tests/visual',
  testMatch: ['**/structure-counter.pw.ts', '**/optical-pinned.pw.ts', '**/storybook-v3*.pw.ts'],
  fullyParallel: true,
  workers: Number(process.env.VISUAL_WORKERS ?? 2),
  retries: 0,
  timeout: 120_000,
  outputDir: join(output, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  updateSnapshots: 'none',
  use: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: 'light', screenshot: 'off', trace: 'off' },
  projects: [{ name: 'chromium-local', use: { ...devices['Desktop Chrome'] } }],
});
