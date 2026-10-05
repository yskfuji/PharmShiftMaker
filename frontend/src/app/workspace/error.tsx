"use client";

import BoundaryFrame from "@/features/workspace/shell/BoundaryFrame";

/**
 * An unexpected error while a workspace route was being shown. The message is not shown (it
 * may carry internal detail); the digest lets an administrator find the server log entry.
 * Trying again renders the route again, which reads it again from the server.
 *
 * The other way on is the site's entry, not a workspace screen: an error boundary is a
 * Client Component and cannot read the server's flag, so it cannot know whether the
 * workspace exists, and it must not lead into a workspace that is off.
 */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <BoundaryFrame title="画面を表示できませんでした">
    <p role="alert">この画面を表示する途中で、予期しない問題が起きました。もう一度試すか、トップページから開き直してください。</p>
    {error.digest && <p className="ideal-note">問い合わせ番号：{error.digest}</p>}
    <div className="ideal-actions">
      <button type="button" className="ideal-button ideal-button--primary" onClick={() => reset()}>もう一度試す</button>
      <a className="ideal-button ideal-button--secondary" href="/">トップページへ</a>
    </div>
  </BoundaryFrame>;
}
