"use client";

import { useId, useState, type ReactNode } from "react";
import { Loaded } from "@/ideal/live/parts";
import { useResource } from "@/ideal/live/useResource";
import type { MembershipRevision } from "@/ideal/types";
import { useLive } from "../shell/WorkspaceRuntime";

/**
 * The account links of the scope, under the heading of the route that shows them. `active`
 * is the route's own read. Inactive links are read only when asked for, and again whenever
 * the route's read changes (after a link or a deactivation); only the choice is kept here.
 *
 * `title` (and `lead`, where the title needs a line more) say what this route does with
 * the links; `inactiveHint` says what 「無効も表示」 adds where the links are not themselves
 * on screen; `action` is a control of the route beside the switch.
 */
export default function MembersSection({ active, title, lead, inactiveHint, action, children }: {
  active: MembershipRevision[];
  title: string;
  lead?: string;
  inactiveHint?: string;
  action?: ReactNode;
  children: (list: MembershipRevision[]) => ReactNode;
}) {
  const live = useLive();
  const hintId = useId();
  const [inactive, setInactive] = useState(false);
  const read = active.map((item) => `${item.membership_id}:${item.revision}`).join(",");
  const all = useResource(
    () => inactive ? live.client.memberships(live.scopeId, true) : Promise.resolve(null),
    inactive ? `${live.scopeId}|${read}` : "active",
  );
  // Until the wider list arrives, the active links stay on screen.
  const list = inactive ? all.data ?? (all.problem ? null : active) : active;
  return <section className="ideal-panel" aria-labelledby="members-title">
    <div className="ideal-panel__head ideal-v3-people-head">
      <div><h2 id="members-title">{title}</h2>{lead && <p>{lead}</p>}</div>
      <div className="ideal-v3-people-tools">
        {action}
        <div className="ideal-v3-people-switch">
          <label className="ideal-switch"><input type="checkbox" checked={inactive} aria-describedby={inactiveHint ? hintId : undefined} onChange={(e) => setInactive(e.target.checked)} /><span>無効も表示</span></label>
          {inactiveHint && <small id={hintId}>{inactiveHint}</small>}
        </div>
      </div>
    </div>
    <Loaded resource={{ data: list, problem: inactive ? all.problem : null, loading: inactive && all.loading, reload: () => void all.reload() }}>{children}</Loaded>
  </section>;
}
