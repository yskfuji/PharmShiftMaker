import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ConfirmSurface, { type ConfirmOutcome } from "@/features/workspace/shared/ConfirmSurface";
import { changedFacts, threeWayRows, type Fact } from "@/features/workspace/shared/records/facts";
import { useRecordSave, type RecordVersion } from "@/features/workspace/shared/records/useRecordSave";
import { useStepFocus } from "@/features/workspace/shared/useStepFocus";
import { LiveProvider, liveFrom } from "@/features/workspace/shell/WorkspaceRuntime";
import { syntheticContext } from "@/features/workspace/showcase/synthetic/context";
import { syntheticRequest } from "@/features/workspace/showcase/synthetic/transport";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { inPartsFrame } from "./partsFrame";

// A fictitious record saved by a fictitious server that answers as chosen. It shows the
// hook, the confirmation surface and the step focus working together; nothing is sent.
type Payload = { count: number };
type Body = { expected_revision: number; payload: Payload };
type Answer = "saved" | "conflict" | "unknown" | "refused";
const facts = (payload: Payload): Fact[] => [{ label: "必須の配置人数", text: `${payload.count}名` }];

function Task({ answer }: { answer: Answer }) {
  const steps = useStepFocus<"content">();
  const [base, setBase] = useState<RecordVersion<Payload>>({ revision: 3, payload: { count: 1 } });
  const [count, setCount] = useState(2);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const record = useRecordSave<Payload, Body, { revision: number }>({
    name: "record:story",
    send: async (body) => {
      setSent((old) => [...old, body.idempotency_key.slice(0, 8)]);
      if (answer === "conflict" && body.expected_revision === 3) throw new PlanningError(409, "conflict");
      if (answer === "unknown" && sent.length === 0) throw new PlanningError(503, "down");
      if (answer === "refused") throw new PlanningError(422, JSON.stringify({ detail: "合成の検証で止まりました。" }));
      return { revision: body.expected_revision + 1 };
    },
    readCurrent: async () => ({ revision: 4, payload: { count: 5 } }),
  });
  const proposed = { count };
  const outcome: ConfirmOutcome = record.outcome.kind === "conflict"
    ? { kind: "conflict", currentRevision: record.outcome.current?.revision ?? null, rows: threeWayRows(facts(base.payload), record.outcome.current ? facts(record.outcome.current.payload) : null, facts(proposed)) }
    : record.outcome;
  return <div className="ideal-stack">
    <h4 {...steps.heading("content")}>1. 内容</h4>
    {!confirming && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(""); setConfirming(true); }}>
      <label htmlFor="story-count">必須の配置人数</label>
      <input id="story-count" className="ideal-input" type="number" min={0} step={1} required value={count} onChange={(event) => setCount(Number(event.target.value))} />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">保存内容を確認する</button></div>
    </form>}
    {confirming && <ConfirmSurface title="2. 保存前の確認" level={4} changes={changedFacts(facts(base.payload), facts(proposed))} version={{ from: base.revision, to: base.revision + 1 }}
      notified="誰にも通知されません。" risk={`保存時にサーバーが第${base.revision}版と照合します。`} outcome={outcome} busy={record.busy} confirmLabel="この内容で保存する"
      onConfirm={() => void record.save({ expected_revision: base.revision, payload: proposed }).then((result) => { if (result.saved) { setBase({ revision: result.result.revision, payload: proposed }); setConfirming(false); setDone(`第${result.result.revision}版として保存しました。`); steps.moveTo("content"); } })}
      onBack={() => { record.clear(); setConfirming(false); steps.moveTo("content"); }}
      onReviewed={() => { if (record.outcome.kind === "conflict" && record.outcome.current) setBase(record.outcome.current); record.clear(); }} />}
    <p className="ideal-done" role="status">{done}</p>
    <p className="ideal-note">送信した受付キー（先頭8文字）：{sent.join("、") || "まだありません"}</p>
  </div>;
}

function Story({ answer }: { answer: Answer }) {
  const live = useMemo(() => liveFrom(syntheticContext("ADMIN"), { client: createIdealClient("storybook-synthetic", syntheticRequest()), mutate: createMutator("storybook-synthetic"), refresh: async () => undefined, isSynthetic: true }), []);
  return <LiveProvider live={live}><Task answer={answer} /></LiveProvider>;
}

const meta = {
  title: "Ideal UI v3/Parts/RecordSave",
  component: Story,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Story>;

export default meta;
type StoryOf = StoryObj<typeof meta>;

export const Saved: StoryOf = { name: "01 保存できる", args: { answer: "saved" } };
export const Conflict: StoryOf = { name: "02 競合 → 三者比較 → 確認し直す", args: { answer: "conflict" } };
export const UnknownOutcome: StoryOf = { name: "03 結果不明 → 同じキーで再送", args: { answer: "unknown" } };
export const Refused: StoryOf = { name: "04 サーバーが拒否", args: { answer: "refused" } };
