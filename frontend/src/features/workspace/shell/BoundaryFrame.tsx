import type { ReactNode } from "react";

/**
 * The frame of the workspace's own not-found and error pages. It has no navigation and reads
 * nothing: these pages are shown when the route, and so the viewer's context, is unknown.
 * It keeps the page's single heading and the workspace's styles; the way on is the one link
 * the page itself offers.
 */
export default function BoundaryFrame({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ideal-v3-app ideal-v3-app--bare">
    <main id="main" tabIndex={-1} className="ideal-v3-main">
      <header className="ideal-v3-page-head"><div className="ideal-v3-title-block"><span className="ideal-eyebrow">PharmShiftMaker</span><h1>{title}</h1></div></header>
      <div className="ideal-v3-content"><section className="ideal-v3-boundary">{children}</section></div>
    </main>
  </div>;
}
