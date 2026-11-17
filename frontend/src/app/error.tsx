"use client";
import GlobalNavigation from '@/components/GlobalNavigation';

/**
 * An unexpected error while showing a page. The message is not shown (it may carry
 * internal detail); the digest lets an administrator find the server log entry.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" tabIndex={-1} className="mx-auto max-w-3xl space-y-4 p-6 focus:outline-none">
    <GlobalNavigation current="" className="border-b pb-2" />
    <h1 className="text-2xl font-bold">画面を表示できませんでした</h1>
    <p role="alert">予期しない問題が起きました。もう一度試すか、主な画面から選び直してください。</p>
    {error.digest && <p className="text-sm">問い合わせ番号：{error.digest}</p>}
    <button type="button" className="ui-button ui-button-secondary min-h-11 rounded-control border px-4" onClick={() => reset()}>もう一度試す</button>
  </main>;
}
