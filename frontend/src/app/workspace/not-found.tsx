import type { Metadata } from "next";
import BoundaryFrame from "@/features/workspace/shell/BoundaryFrame";
import { routeOf } from "@/features/workspace/shell/routeTypes";
import WorkspaceLink from "@/features/workspace/shell/WorkspaceLink";
import { idealUiEnabled } from "@/lib/featureFlags";

export const metadata: Metadata = { title: "ページが見つかりません", robots: { index: false, follow: false } };

/**
 * An address under /workspace that names no screen or view of the route contract, and every
 * address under /workspace while the workspace is off (IDEAL_UI is not 1). The pages answer
 * both with notFound(), so the response is a 404.
 *
 * On: the workspace's own frame and one link, to the workspace's entry. Off: the workspace
 * does not exist, so the page leads neither into it nor into another product's screens; it
 * names the site's entry and nothing else.
 */
export default function WorkspaceNotFound() {
  if (!idealUiEnabled()) {
    return <main id="main" tabIndex={-1} className="ideal-v3-plain">
      <h1>ページが見つかりません</h1>
      <p>アドレスが間違っているか、ページが移動した可能性があります。</p>
      <p><a href="/">トップページへ</a></p>
    </main>;
  }
  return <BoundaryFrame title="ページが見つかりません">
    <p>このアドレスの画面はありません。アドレスが間違っているか、画面が移動した可能性があります。</p>
    <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("home/index").route}>今日へ</WorkspaceLink></div>
  </BoundaryFrame>;
}
