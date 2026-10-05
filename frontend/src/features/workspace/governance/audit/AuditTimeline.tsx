"use client";

import { useId, useState } from "react";
import { stamp } from "@/ideal/live/format";
import { ActionStatus, Loaded, useAction } from "@/ideal/live/parts";
import { useResource } from "@/ideal/live/useResource";
import type { AuditEntry, AuditTimelinePage } from "@/ideal/types";
import { useLive } from "../../shell/WorkspaceRuntime";
import { CATEGORY, eventLabel } from "./labels";

/** `first` is the route's own read. Choosing a category and asking for older pages are
 * reads on demand; only the choice and the pages added to it are kept here. */
export default function AuditTimeline({ first }: { first: AuditTimelinePage }) {
  const live = useLive();
  const id = useId();
  const [category, setCategory] = useState("");
  const [more_, setMore] = useState<{ key: string; pages: AuditEntry[][]; cursor: string | null } | null>(null);
  const chosen = useResource(
    () => category ? live.client.timeline(live.scopeId, null, category) : Promise.resolve(null),
    `${live.scopeId}|${category}`,
  );
  // Until the chosen category arrives, the page already on screen stays.
  const page = category ? chosen.data ?? (chosen.problem ? null : first) : first;
  // Older pages belong to the first page they were asked from.
  const key = `${live.scopeId}|${category}|${page?.next_cursor ?? ""}`;
  const extra = more_ && more_.key === key ? more_ : null;
  const cursor = extra ? extra.cursor : page?.next_cursor ?? null;
  const more = useAction();
  const entries = [...(page?.entries ?? []), ...(extra?.pages.flat() ?? [])];
  return <section className="ideal-panel" aria-labelledby={`${id}-title`}>
    <div className="ideal-panel__head"><div><span className="ideal-eyebrow">計画の通知から</span><h2 id={`${id}-title`}>監査タイムライン</h2></div>
      <label className="ideal-inline-field" htmlFor={`${id}-category`}>種類<select id={`${id}-category`} className="ideal-input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">すべて</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    <Loaded resource={{ data: page, problem: category ? chosen.problem : null, loading: Boolean(category) && chosen.loading, reload: () => void chosen.reload() }}>{(shown) => <>
      {entries.length ? <ol className="ideal-timeline">{entries.map((e, index) => <li key={`${e.at}-${e.kind}-${index}`}><span /><div><strong>{eventLabel(e.kind)}</strong>
        <p>{CATEGORY[e.category]} · {e.actor_role ?? "役割不明"} · 関係した人 {e.subject_count === null ? "—" : `${e.subject_count}名`}{e.version === null ? "" : ` · 版 ${e.version}`}</p><small>記録種別 <code>{e.kind}</code></small></div><time dateTime={e.at}>{stamp(e.at)}</time></li>)}</ol>
        : <p className="ideal-note">記録はありません。</p>}
      {cursor && <button type="button" className="ideal-button ideal-button--secondary" disabled={more.busy} onClick={() => void more.run(async () => {
        const next = await live.client.timeline(live.scopeId, cursor, category || null);
        setMore({ key, pages: [...(extra?.pages ?? []), next.entries], cursor: next.next_cursor });
      })}>さらに読み込む</button>}
      <ActionStatus problem={more.problem} done={null} />
      <ul className="ideal-note-list">{shown.limits.map((l) => <li key={l}>{l}</li>)}</ul>
    </>}</Loaded>
  </section>;
}
