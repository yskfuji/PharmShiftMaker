"use client";

import { useState, type ReactNode } from "react";
import { Loaded } from "@/ideal/live/parts";
import { useResource } from "@/ideal/live/useResource";
import type { MembershipRevision } from "@/ideal/types";
import { useLive } from "../shell/WorkspaceRuntime";

/** The account links of the scope. `active` is the route's own read. Inactive links are
 * read only when asked for, and again whenever the route's read changes (after a link or
 * a deactivation); only the choice is kept here. */
export default function MembersSection({ active, children }: { active: MembershipRevision[]; children: (list: MembershipRevision[]) => ReactNode }) {
  const live = useLive();
  const [inactive, setInactive] = useState(false);
  const read = active.map((item) => `${item.membership_id}:${item.revision}`).join(",");
  const all = useResource(
    () => inactive ? live.client.memberships(live.scopeId, true) : Promise.resolve(null),
    inactive ? `${live.scopeId}|${read}` : "active",
  );
  // Until the wider list arrives, the active links stay on screen.
  const list = inactive ? all.data ?? (all.problem ? null : active) : active;
  return <section className="ideal-panel" aria-labelledby="members-title">
    <div className="ideal-panel__head"><div><span className="ideal-eyebrow">本人アカウント</span><h2 id="members-title">紐付け</h2></div>
      <label className="ideal-switch"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /><span>無効も表示</span></label></div>
    <Loaded resource={{ data: list, problem: inactive ? all.problem : null, loading: inactive && all.loading, reload: () => void all.reload() }}>{children}</Loaded>
  </section>;
}
