"use client";
import GlobalNavigation from '@/components/GlobalNavigation';

/**
 * An unexpected error while showing a page. The message is not shown (it may carry
 * internal detail); the digest lets an administrator find the server log entry.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10 focus:outline-none sm:py-16">
    <div className="space-y-5 rounded-card border border-line bg-surface p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-fg-muted">PharmShiftMaker</p>
      <h1 className="text-2xl font-bold text-fg">画面を表示できませんでした</h1>
      <p role="alert" className="text-fg-muted">予期しない問題が起きました。もう一度試すか、下の「主な画面」から選び直してください。</p>
      {error.digest && <p className="text-sm text-fg-muted">問い合わせ番号：{error.digest}</p>}
      <button type="button" className="ui-button ui-button-secondary min-h-11 rounded-control border px-4" onClick={() => reset()}>もう一度試す</button>
      <GlobalNavigation current="" className="border-t border-line pt-4" />
    </div>
  </main>;
}
