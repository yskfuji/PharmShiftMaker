import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Fact } from "@/features/workspace/shared/records/facts";
import RecordEditor from "@/features/workspace/shared/records/RecordEditor";
import { LiveProvider, liveFrom } from "@/features/workspace/shell/WorkspaceRuntime";
import { syntheticContext } from "@/features/workspace/showcase/synthetic/context";
import { syntheticRequest } from "@/features/workspace/showcase/synthetic/transport";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { inPartsFrame } from "./partsFrame";

// A fictitious record kind on the editor every record kind shares: choose, enter, confirm.
// A fictitious server answers; nothing is sent.
type Rule = { rule_id: string; hours: number };
const facts = (rule: Rule): Fact[] => [{ label: "1日に相当する時間数", text: `${rule.hours}時間` }];
const stored: Rule = { rule_id: "synthetic-rule-1", hours: 8 };

function Story({ appendOnly, refuse }: { appendOnly: boolean; refuse: boolean }) {
  const live = useMemo(() => liveFrom(syntheticContext("ADMIN"), { client: createIdealClient("storybook-synthetic", syntheticRequest()), mutate: createMutator("storybook-synthetic"), refresh: async () => undefined, isSynthetic: true }), []);
  return <LiveProvider live={live}><RecordEditor<Rule, { revision: number }>
    noun="取得規則" contentTitle="規則の内容を入力する" appendOnly={appendOnly}
    records={[{ key: stored.rule_id, revision: 2, payload: stored, label: "合成の規則（1日8時間）" }]}
    create={() => ({ rule_id: "synthetic-rule-new", hours: 8 })}
    facts={facts}
    fields={({ value, onChange }) => <>
      <label htmlFor="story-rule-hours">1日に相当する時間数</label>
      <input id="story-rule-hours" className="ideal-input" type="number" min={1} step={1} required value={Number.isFinite(value.hours) ? value.hours : ""} onChange={(event) => onChange({ hours: event.target.valueAsNumber })} />
    </>}
    mutation={(rule) => `record:story:${rule.rule_id}`}
    send={async (body) => { if (refuse) throw new PlanningError(409, "conflict"); return { revision: body.expected_revision + 1 }; }}
    readCurrent={async () => ({ revision: 2, payload: stored })}
    notified="誰にも通知されません。保存の記録は監査の履歴に残ります。"
    risk={(revision) => (revision ? `保存時にサーバーが第${revision}版と照合します。` : "保存時にサーバーが、まだ登録されていないことを照合します。")}
    refusedChange="変更できない項目を変えるときは、新しい規則として登録してください。" /></LiveProvider>;
}

const meta = {
  title: "Ideal UI v3/Parts/RecordEditor",
  component: Story,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const ChooseAndChange: StoryOf = { name: "01 対象を選んで登録・変更", args: { appendOnly: false, refuse: false } };
export const AppendOnly: StoryOf = { name: "02 追記のみの記録", args: { appendOnly: true, refuse: false } };
export const RefusedChange: StoryOf = { name: "03 サーバーが変更を受け付けない", args: { appendOnly: false, refuse: true } };
