"use client";

import { useEffect, useState } from "react";
import {
  WORKSPACE_CONTEXT_CHANGED,
  type WorkspaceContextChangedDetail,
} from "@/ideal/providers/contextEvent";

type PublicationSummary = WorkspaceContextChangedDetail["publication"];

export default function WorkspaceContextSummary({ period, publication }: {
  period?: string;
  publication: PublicationSummary;
}) {
  const [current, setCurrent] = useState({ period, publication });

  useEffect(() => setCurrent({ period, publication }), [period, publication]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceContextChangedDetail>).detail;
      if (!detail) return;
      setCurrent((old) => ({
        period: detail.period ?? old.period,
        publication: detail.publication,
      }));
    };
    window.addEventListener(WORKSPACE_CONTEXT_CHANGED, changed);
    return () => window.removeEventListener(WORKSPACE_CONTEXT_CHANGED, changed);
  }, []);

  return <dl>
    <div><dt>対象期間</dt><dd>{current.period ?? "未選択"}</dd></div>
    <div><dt>公開版</dt><dd>{current.publication ? `v${current.publication.version}` : "未公開"}</dd></div>
    <div><dt>検証状態</dt><dd>{current.publication ? current.publication.validation_status === "revalidation_required" ? "再検証が必要" : "公開時に検証済み" : "—"}</dd></div>
  </dl>;
}
