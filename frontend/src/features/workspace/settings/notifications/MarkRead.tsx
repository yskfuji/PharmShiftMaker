"use client";

import { InlineProblem, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";

/** Confirms one notification. The request has no body, and repeating it changes nothing
 * more, so it carries no idempotency key. A refusal is shown beside the button. */
export default function MarkRead({ eventId }: { eventId: string }) {
  const live = useLive();
  const action = useAction();
  return <>
    <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void action.run(async () => {
      await live.client.markNotificationRead(live.scopeId, eventId);
      await live.refresh();
    })}>確認しました</button>
    {action.problem && <InlineProblem problem={action.problem} />}
  </>;
}
