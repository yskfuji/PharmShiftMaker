import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusPill } from "@/ideal/ui/atoms";
import TaskDisclosure from "@/features/workspace/shared/TaskDisclosure";
import TaskJump from "@/features/workspace/shared/TaskJump";
import { inContentFrame } from "./partsFrame";

// From a count in a route's header to the task that answers it. The button opens the task,
// brings it into view and puts the focus on its summary; nothing is sent.
function Story() {
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>実績の状態と次の操作</h2><p>冒頭の件数から、その件数に対応する操作へ進みます（合成の表示例）。</p></div>
      <div className="ideal-v3-badge-action"><StatusPill tone="warn">照合の記録がない実績 1件</StatusPill><TaskJump target="task-jump-story-review">照合を記録する</TaskJump></div>
    </section>
    <section className="ideal-panel" aria-labelledby="task-jump-story-next">
      <h2 id="task-jump-story-next">次の操作</h2>
      <div className="ideal-v3-task-list">
        <TaskDisclosure id="task-jump-story-review" tone="primary" summary="照合内容を記録する" hint="実績と公開した勤務を比べた内容を記録します。"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>
        <TaskDisclosure summary="登録済みの実績を訂正する" hint="登録済みの実績を直し、新しい版として保存します。"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>
      </div>
    </section>
  </div>;
}

const meta = {
  title: "Ideal UI v3/Parts/TaskJump",
  component: Story,
  decorators: [inContentFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const Jump: StoryOf = { name: "01 件数から操作へ" };
