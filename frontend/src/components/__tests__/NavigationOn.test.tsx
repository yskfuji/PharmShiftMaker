import { render, screen, within } from '@testing-library/react';
import { isValidElement } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import GlobalNavigation from '@/components/GlobalNavigation';
import { NavigationFlagsProvider } from '@/components/NavigationFlags';
import LoginPage from '@/app/login/page';
import WorkspacePage from '@/app/workspace/[screen]/page';
import WorkspaceIndexPage from '@/app/workspace/page';

// With IDEAL_UI=1 the ideal UI is the entry: its home is the landing page, it is listed
// first in the primary navigation, and /workspace/<screen> exists. Off, none of it does.
jest.mock('@/components/IdentityProvider', () => ({ IdentityDisplay: () => <span>合成 花子</span> }));
// The per-route pipeline reads on the server (cookies, server-side fetch); this test is about
// the flag and the routing, so the pipeline itself is replaced.
jest.mock('@/features/workspace/shell/WorkspaceRoutePage', () => ({ __esModule: true, default: () => null }));
jest.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

const saved = process.env.IDEAL_UI;
afterEach(() => { if (saved === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = saved; });
const page = (screen: string) => WorkspacePage({ params: Promise.resolve({ screen }), searchParams: Promise.resolve({}) });

test('on: landing page, first navigation item and every ideal screen', async () => {
  process.env.IDEAL_UI = '1';
  expect((await LoginPage({})).props.redirectPath).toBe('/workspace/home');
  // an explicit return path still wins
  expect((await LoginPage({ searchParams: Promise.resolve({ redirectTo: '/planning' }) })).props.redirectPath).toBe('/planning');
  render(<NavigationFlagsProvider idealUi><AppLayout currentPath="/planning"><p>本文</p></AppLayout></NavigationFlagsProvider>);
  for (const nav of screen.getAllByRole('navigation', { name: '主な画面' })) {
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/workspace/home', '/dashboard', '/planning', '/planning/workflows', '/settings']);
  }
  expect(isValidElement(await page('operations'))).toBe(true);
  await expect(page('no-such-screen')).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => WorkspaceIndexPage()).toThrow('REDIRECT /workspace/home');
});

test('off: no entry, no navigation item, no route', async () => {
  delete process.env.IDEAL_UI;
  const { container } = render(<GlobalNavigation current="/planning" />);
  expect(container.querySelector('a[href="/workspace/home"]')).toBeNull();
  await expect(page('home')).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => WorkspaceIndexPage()).toThrow('NEXT_NOT_FOUND');
  process.env.IDEAL_UI = 'true'; // only "1" turns it on
  await expect(page('home')).rejects.toThrow('NEXT_NOT_FOUND');
});
