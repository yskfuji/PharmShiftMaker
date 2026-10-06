"use client";

import { ActionStatus, useAction } from "@/ideal/live/parts";
import { useMounted } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

/** Makes a new input version from the latest requests and actuals, against the version
 * on screen (an administrator's change; the server refuses others). The request carries
 * no idempotency key: a repeat against a version that has moved on is refused. */
export default function RefreshInput({ revision, admin }: { revision: number; admin: boolean }) {
  const live = useLive();
  const mounted = useMounted();
  const action = useAction();
  return <>
    {/* Offered once it can answer: a press on a button React has not attached to is lost. */}
    {admin && mounted && <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={action.busy} onClick={() => void action.run(async () => {
      await live.client.refreshInput(live.scopeId, revision);
      await live.refresh();
      return "最新の申請・実績を反映した入力版を作りました。";
    })}>申請・実績を計画に反映</button></div>}
    <ActionStatus problem={action.problem} done={action.done} />
  </>;
}
