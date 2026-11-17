import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/nextjs-vite';

// Local rendering environment only (docs/design-system/README.md):
// - started on 127.0.0.1 (package.json `storybook`), never exposed or published;
// - telemetry off; no addon that uploads (no Chromatic);
// - the static build goes outside the repository and is checked for .env values
//   (CVE-2025-68429 affected static builds; 10.6.0 includes the fix).
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  // No environment variables are passed into the stories except the API base,
  // which the fetch mock answers (it never reaches a real server).
  env: (config) => ({ ...Object.fromEntries(Object.entries(config ?? {}).filter(([key]) => key === 'NODE_ENV')),
    NEXT_PUBLIC_API_BASE_URL: 'https://api.storybook.invalid' }),
  // Stories live outside src/ (and outside tsconfig's include), so the `@/` alias is stated here.
  viteFinal: async (vite) => ({
    ...vite,
    resolve: { ...vite.resolve, alias: [...toArray(vite.resolve?.alias), { find: /^@\//, replacement: `${fileURLToPath(new URL('../src/', import.meta.url))}` }] },
  }),
};

function toArray(alias: unknown): { find: string | RegExp; replacement: string }[] {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias as Record<string, string>).map(([find, replacement]) => ({ find, replacement }));
}

export default config;
