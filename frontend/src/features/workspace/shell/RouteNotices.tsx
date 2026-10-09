"use client";

import { useEffect, useState } from "react";
import { browserNavigation } from "@/lib/browserNavigation";
import type { PartialProblem } from "./routeTypes";
import { useLive } from "./WorkspaceRuntime";

/** What happened just before this route was shown, and what could not be read for it. */
export default function RouteNotices({ partial }: { partial: PartialProblem[] }) {
  const live = useLive();
  const [flash, setFlash] = useState<ReturnType<typeof browserNavigation.takeFlash>>(null);
  useEffect(() => setFlash(browserNavigation.takeFlash()), []);
  return <>
    {flash === "change-approved" && <p className="ideal-done" role="status">承認し、新しい公開版を作成しました。勤務表で変更を確認できます。</p>}
    {flash === "plan-published" && <p className="ideal-done" role="status">計画を新しい公開版として公開しました。勤務表で直前版との差分を確認できます。</p>}
    {flash === "publication-cancelled" && <p className="ideal-done" role="status">公開を取り消し、通知を記録しました。</p>}
    {partial.length > 0 && <section className="ideal-partial-problems" role="status" aria-labelledby="partial-problems-title">
      <h2 id="partial-problems-title">一部の情報を更新できませんでした</h2>
      <p>取得できた情報は表示しています。判断前に不足箇所を確認してください。</p>
      <ul>{partial.map((item) => <li key={`${item.resource}:${item.status}`}><strong>{item.resource}</strong>（{item.status}）: {item.detail}</li>)}</ul>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void live.refresh()}>不足情報を再読込み</button>
    </section>}
  </>;
}
