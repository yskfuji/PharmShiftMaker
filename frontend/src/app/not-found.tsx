import type { Metadata } from 'next';
import GlobalNavigation from '@/components/GlobalNavigation';

// Also used by routes that answer an unknown parameter with this page themselves (see
// planning/workflows/[workflow] and schedule/[year]/[month]): a notFound() thrown inside a
// dynamic segment is sent as an empty page that only scripts fill in (Next.js 16, observed
// 2026-09-28), so those routes render this view on the server instead (status 200, noindex).
export const NOT_FOUND_METADATA: Metadata = { title: 'ページが見つかりません', robots: { index: false, follow: false } };
export const metadata: Metadata = NOT_FOUND_METADATA;

/** Unknown addresses and invalid parameters (e.g. a workflow name or month that does not exist). */
export default function NotFound() {
  return <main id="main" tabIndex={-1} className="mx-auto max-w-3xl space-y-4 p-6 focus:outline-none">
    <GlobalNavigation current="" className="border-b pb-2" />
    <h1 className="text-2xl font-bold">ページが見つかりません</h1>
    <p>アドレスが間違っているか、ページが移動した可能性があります。上の「主な画面」から目的の画面を選んでください。</p>
    <p><a className="inline-flex min-h-11 items-center underline" href="/planning">勤務計画・公開へ</a></p>
  </main>;
}
