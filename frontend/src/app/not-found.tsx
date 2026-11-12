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
  return <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 focus:outline-none sm:py-16">
    <div className="space-y-5 rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-fg-muted">PharmShiftMaker</p>
      <h1 className="text-2xl font-bold text-fg">ページが見つかりません</h1>
      <p className="text-fg-muted">アドレスが間違っているか、ページが移動した可能性があります。下の「主な画面」から目的の画面を選んでください。</p>
      <p><a className="ui-button ui-button-primary inline-flex min-h-11 items-center rounded-control px-4 font-semibold no-underline" href="/planning">勤務計画・公開へ</a></p>
      <GlobalNavigation current="" className="border-t border-line pt-4" />
    </div>
  </main>;
}
