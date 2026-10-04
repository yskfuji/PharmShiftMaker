import type { Preview } from '@storybook/nextjs-vite';
import { useEffect } from 'react';

import '@fontsource-variable/noto-sans-jp';
import '../src/styles/tokens.css';
import '../src/app/globals.css';
import { installFetchMock, type FetchRoute } from './fetchMock';

// The page's body classes (src/app/layout.tsx), so a story renders on the same canvas.
const BODY = ['font-sans', 'min-h-screen', 'bg-canvas', 'text-fg', 'antialiased'];

const preview: Preview = {
  globalTypes: {
    theme: {
      description: '配色（data-theme）',
      toolbar: { title: '配色', items: [{ value: 'system', title: 'システムに従う' }, { value: 'light', title: '明るい' }, { value: 'dark', title: '暗い' }] },
    },
  },
  initialGlobals: { theme: 'system' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error', options: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } } },
  },
  // One synthetic fetch per story, removed after it (the returned function is the cleanup).
  beforeEach: ({ parameters }) => installFetchMock((parameters.fetchRoutes ?? []) as FetchRoute[]),
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme as string;
      useEffect(() => {
        document.body.classList.add(...BODY);
        document.documentElement.lang = 'ja';
        if (theme === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
      }, [theme]);
      return <Story />;
    },
  ],
};

export default preview;
