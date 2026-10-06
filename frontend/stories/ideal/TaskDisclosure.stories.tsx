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

// How a task presents itself: the one the route points at, an ordinary one, one that only
// shows something, and one that cannot be undone (its tag says so in words).
function Tones() {
  return <div className="ideal-stack">
    <TaskDisclosure tone="primary" summary="請求を判断する" hint="受け付けた請求を承認するか、理由を付けて却下します。"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>
    <TaskDisclosure summary="保存規則を登録する" hint="記録の種類ごとの保存期間を登録します。"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>
    <TaskDisclosure tone="info" summary="過去時点の台帳を照会する" hint="指定した時点の台帳を表示します。何も変更しません。"><p className="ideal-note">開くと、照会の条件が表示されます（合成の表示例）。</p></TaskDisclosure>
    <TaskDisclosure tone="danger" tag="消去は取り消せません" summary="保存期限を過ぎた旧勤務入力を消去する" hint="保存期限を過ぎた勤務入力を、確認のうえ消去します。"><p className="ideal-note">開くと、消去の対象と確認が表示されます（合成の表示例）。</p></TaskDisclosure>
    <TaskDisclosure summary="説明のない操作"><p className="ideal-note">説明を付けていない従来の呼び出しです（合成の表示例）。</p></TaskDisclosure>
    <details className="ideal-v3-disclosure"><summary>包みのない開閉欄</summary><p className="ideal-note">部品を通さずに書かれた開閉欄です（合成の表示例）。</p></details>
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>識別情報</summary><p className="ideal-note">採用の識別子：synthetic-adoption-1</p></details>
  </div>;
}

// The tasks of one group side by side where there is room; an open task takes the row.
function TwoColumns() {
  const tasks = [
    { name: "雇用契約を登録・改定する", hint: "職員の雇用契約を新しく登録するか、内容を改定します。" },
    { name: "所定労働時間を登録する", hint: "契約ごとの所定労働時間を登録します。" },
    { name: "資格を登録する", hint: "職員の資格と有効期間を登録します。" },
    { name: "資格の取消・失効を記録する", hint: "資格が取り消された日、または失効した日を記録します。" },
    { name: "36協定を登録する", hint: "事業場の36協定と適用期間を登録します。" },
  ];
  return <div className="ideal-v3-record">
    <section aria-labelledby="task-list-story-a">
      <h3 id="task-list-story-a" className="ideal-v3-heading">職員の記録</h3>
      <div className="ideal-v3-task-list">{tasks.map((task) => <TaskDisclosure key={task.name} summary={task.name} hint={task.hint}><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure>)}</div>
    </section>
    <section aria-labelledby="task-list-story-b">
      <h3 id="task-list-story-b" className="ideal-v3-heading">1つだけの操作</h3>
      <div className="ideal-v3-task-list"><TaskDisclosure tone="primary" summary="採用を確認する（影響の確認）" hint="登録された採用の内容と影響を確かめて、確認を記録します。"><p className="ideal-note">開くと、この操作の入力欄が表示されます（合成の表示例）。</p></TaskDisclosure></div>
    </section>
  </div>;
}

// What cannot be undone, closed and open. Closed: the tag and the description beside the
// summary. Open: neither is drawn there; the tag leads a strip under the summary's band, as
// the first line of what the task holds. The third reads on demand and takes the same look.
function Irreversible() {
  const resource = useOnDemand(async () => ["2026-04-01 付与 10日"]);
  const form = <div className="ideal-form"><label htmlFor="irreversible-story-target">消去する入力版</label><select id="irreversible-story-target" className="ideal-input" defaultValue=""><option value="">選んでください</option><option value="12">入力 第12版（2026-10-01 〜 2026-11-01）</option></select></div>;
  return <div className="ideal-v3-task-list">
    <TaskDisclosure tone="danger" tag="取り消せません" summary="採用を終了する" hint="開始した採用を、将来の清算期間の初日で終えます。"><p className="ideal-note">閉じた状態の表示例です（合成の表示例）。</p></TaskDisclosure>
    <TaskDisclosure id="irreversible-story-open" tone="danger" tag="消去は取り消せません" summary="保存期限を過ぎた旧勤務入力を消去する" hint="保存期限を過ぎた勤務入力を、確認のうえ消去します。">{form}</TaskDisclosure>
    <OnDemandTask id="irreversible-story-read" tone="danger" tag="取り消せません" summary="付与を取り消す（管理者）" hint="誤って記録した付与を取り消します。" resource={resource}>{(rows) => <ul className="ideal-note-list">{rows.map((row) => <li key={row}>{row}</li>)}</ul>}</OnDemandTask>
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
export const FourTones: StoryOf = { name: "03 四つの調子", render: () => <Tones />, play: async ({ canvasElement }) => { const first = canvasElement.querySelector("details"); if (first) first.open = true; } };
export const TaskList: StoryOf = { name: "04 二列の一覧", render: () => <TwoColumns /> };
export const NoWayBack: StoryOf = { name: "05 取り消せない操作（閉じた状態と開いた状態）", render: () => <Irreversible />, play: async ({ canvasElement }) => { for (const id of ["irreversible-story-open", "irreversible-story-read"]) { const task = canvasElement.querySelector<HTMLDetailsElement>(`#${id}`); if (task) task.open = true; } } };
