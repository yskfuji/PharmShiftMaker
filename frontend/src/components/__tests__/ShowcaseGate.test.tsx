import { isValidElement } from 'react';

jest.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (to: string) => { throw new Error('REDIRECT ' + to); },
}));
jest.mock('@/components/ideal/IdealWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ideal/providers/ApiWorkspaceProvider', () => ({ __esModule: true, default: () => null }));

import ShowcasePage from '@/app/showcase/[screen]/page';
import ShowcaseIndexPage from '@/app/showcase/page';
import PreviewPage from '@/app/preview/[screen]/page';
import PreviewIndexPage from '@/app/preview/page';

const params = (screen: string) => ({ params: Promise.resolve({ screen }) });
const saved = { IDEAL_SHOWCASE: process.env.IDEAL_SHOWCASE, IDEAL_PREVIEW: process.env.IDEAL_PREVIEW };
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test('the showcase answers 404 unless IDEAL_SHOWCASE=1 (production default)', async () => {
  delete process.env.IDEAL_SHOWCASE;
  await expect(ShowcasePage(params('home'))).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => ShowcaseIndexPage()).toThrow('NEXT_NOT_FOUND');
  process.env.IDEAL_SHOWCASE = 'true';
  await expect(ShowcasePage(params('home'))).rejects.toThrow('NEXT_NOT_FOUND');
});

test('with the flag the showcase renders known screens only', async () => {
  process.env.IDEAL_SHOWCASE = '1';
  expect(isValidElement(await ShowcasePage(params('schedule')))).toBe(true);
  await expect(ShowcasePage(params('unknown'))).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => ShowcaseIndexPage()).toThrow('REDIRECT /showcase/home');
});

test('the API preview answers 404 unless IDEAL_PREVIEW=1 and offers only the ideal screens', async () => {
  const preview = (screen: string) => PreviewPage({ params: Promise.resolve({ screen }), searchParams: Promise.resolve({}) });
  delete process.env.IDEAL_PREVIEW;
  process.env.IDEAL_SHOWCASE = '1'; // the showcase flag does not open the preview
  await expect(preview('home')).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => PreviewIndexPage()).toThrow('NEXT_NOT_FOUND');
  process.env.IDEAL_PREVIEW = '1';
  expect(isValidElement(await preview('schedule'))).toBe(true);
  // every ideal screen is wired to the API now; an unknown one is still not found
  expect(isValidElement(await preview('governance'))).toBe(true);
  await expect(preview('no-such-screen')).rejects.toThrow('NEXT_NOT_FOUND');
  expect(() => PreviewIndexPage()).toThrow('REDIRECT /preview/home');
});
