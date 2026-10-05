import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import TaskDisclosure, { OnDemandTask, useOnDemand } from "@/features/workspace/shared/TaskDisclosure";
import { PlanningError } from "@/lib/planningTransport";
import { inPartsFrame } from "./partsFrame";

// The tasks of a route's "next action": closed until opened. The second and third share one
// fictitious read, made when either is first opened; nothing is sent.
function Story({ answer }: { answer: "ready" | "refused" }) {
  const resource = useOnDemand(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (answer === "refused") throw new PlanningError(403, "Administrator membership required");
    return ["2026-04-01 付与 10日", "2025-04-01 付与 10日"];
  });
  return <div className="ideal-stack">
    <TaskDisclosure summary="申告を取り下げる"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>
    <OnDemandTask summary="付与日数を訂正する（管理者）" resource={resource}>{(rows) => <ul className="ideal-note-list">{rows.map((row) => <li key={row}>{row}</li>)}</ul>}</OnDemandTask>
    <OnDemandTask summary="取得の記録を取り消す（管理者）" resource={resource}>{(rows) => <p className="ideal-note">同じ読取りを共有しています：{rows.length}件</p>}</OnDemandTask>
  </div>;
}

const meta = {
  title: "Ideal UI v3/Parts/TaskDisclosure",
  component: Story,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const Ready: StoryOf = { name: "01 開くと読み込む", args: { answer: "ready" } };
export const Refused: StoryOf = { name: "02 読取りが拒否された", args: { answer: "refused" } };
