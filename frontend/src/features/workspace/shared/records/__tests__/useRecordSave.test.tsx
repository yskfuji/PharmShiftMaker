import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { useRecordSave, type RecordVersion } from "../useRecordSave";

type Payload = { id: string; count: number };
type Body = { expected_revision: number; payload: Payload; input_hash: string };
type Saved = { key: string; revision: number };
const body: Body = { expected_revision: 2, payload: { id: "r1", count: 3 }, input_hash: "hash-12" };

function Harness({ send, readCurrent, seen }: { send: (body: Body & { idempotency_key: string }) => Promise<Saved>; readCurrent: () => Promise<RecordVersion<Payload> | null>; seen: (value: unknown) => void }) {
  const record = useRecordSave<Payload, Body, Saved>({ name: "record:test:r1", send, readCurrent });
  return <>
    <button type="button" disabled={record.busy} onClick={() => void record.save(body).then(seen)}>保存</button>
    <button type="button" onClick={() => void record.save({ ...body, expected_revision: 5 }).then(seen)}>現在版へ保存</button>
    <button type="button" onClick={record.clear}>閉じる</button>
    <output>{JSON.stringify(record.outcome)}</output>
  </>;
}

function mount(send: jest.Mock, readCurrent: jest.Mock = jest.fn(async () => null), refresh: jest.Mock = jest.fn(async () => undefined)) {
  const ctx = syntheticContext("ADMIN");
  const live = liveFrom(ctx, { client: createIdealClient("test", async () => { throw new Error("not used"); }), mutate: createMutator("test"), refresh });
  const seen = jest.fn();
  render(<LiveProvider live={live}><Harness send={send} readCurrent={readCurrent} seen={seen} /></LiveProvider>);
  const outcome = () => JSON.parse(screen.getByRole("status").textContent!) as { kind: string } & Record<string, unknown>;
  return { refresh, seen, outcome, readCurrent };
}
const save = () => act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存" })); });

test("a save sends the body with one key, reads the route again and resolves to the server's answer", async () => {
  const send = jest.fn(async () => ({ key: "k", revision: 3 }));
  const { refresh, seen, outcome, readCurrent } = mount(send);
  await save();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ ...body, idempotency_key: expect.any(String) });
  expect(seen).toHaveBeenLastCalledWith({ saved: true, result: { key: "k", revision: 3 } });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(outcome()).toEqual({ kind: "idle" });
  expect(readCurrent).not.toHaveBeenCalled();
});

test("a record is saved even when the route cannot be read again afterwards", async () => {
  const send = jest.fn(async () => ({ key: "k", revision: 3 }));
  const { seen, outcome } = mount(send, undefined, jest.fn(async () => { throw new Error("read failed"); }));
  await save();
  expect(seen).toHaveBeenLastCalledWith({ saved: true, result: { key: "k", revision: 3 } });
  expect(outcome()).toEqual({ kind: "idle" });
});

test("after an unknown outcome the same body goes out again with the same key", async () => {
  const send = jest.fn<Promise<Saved>, [Body & { idempotency_key: string }]>()
    .mockRejectedValueOnce(new PlanningError(503, "down")).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ key: "k", revision: 3 });
  const { refresh, seen, outcome } = mount(send);
  await save();
  expect(outcome()).toMatchObject({ kind: "unknown", problem: { kind: "unknown", code: "503", title: "結果を確認できません" } });
  expect(seen).toHaveBeenLastCalledWith({ saved: false });
  expect(refresh).not.toHaveBeenCalled();
  await save();
  expect(outcome()).toMatchObject({ kind: "unknown", problem: { code: "NET" } });
  await save();
  expect(outcome()).toEqual({ kind: "idle" });
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  expect(send.mock.calls[2][0]).toEqual(send.mock.calls[0][0]);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a conflict reads the current version for a three-way review; the next body has a new key", async () => {
  const send = jest.fn<Promise<Saved>, [Body & { idempotency_key: string }]>().mockRejectedValueOnce(new PlanningError(409, "{\"detail\":\"conflict\"}")).mockResolvedValue({ key: "k", revision: 6 });
  const current = { revision: 5, payload: { id: "r1", count: 9 } };
  const { refresh, seen, outcome, readCurrent } = mount(send, jest.fn(async () => current));
  await save();
  expect(readCurrent).toHaveBeenCalledTimes(1);
  expect(outcome()).toEqual({ kind: "conflict", current });
  expect(seen).toHaveBeenLastCalledWith({ saved: false });
  // The view behind the review is read again too; nothing was saved or rebased.
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "現在版へ保存" })); });
  await waitFor(() => expect(outcome()).toEqual({ kind: "idle" }));
  expect(send.mock.calls[1][0]).toMatchObject({ expected_revision: 5 });
  expect(send.mock.calls[1][0].idempotency_key).not.toBe(send.mock.calls[0][0].idempotency_key);
});

test("a conflict on a record that is gone, and one whose current version cannot be read", async () => {
  const send = jest.fn(async () => { throw new PlanningError(409, "conflict"); });
  const readCurrent = jest.fn<Promise<RecordVersion<Payload> | null>, []>().mockResolvedValueOnce(null).mockRejectedValueOnce(new PlanningError(503, "down"));
  const { outcome } = mount(send, readCurrent);
  await save();
  expect(outcome()).toEqual({ kind: "conflict", current: null });
  await save();
  // Said as the conflict it is; the same save can be tried again, and reads again.
  expect(outcome()).toMatchObject({ kind: "refused", problem: { kind: "conflict", code: "409" }, fields: [] });
});

test("a refusal carries the server's message, and the fields when the server names them", async () => {
  const list = JSON.stringify({ detail: [{ loc: ["body", "input_hash"], msg: "String should match pattern", type: "string_pattern_mismatch" }, { loc: ["body", "payload", "count"], msg: "Input should be a valid integer" }, { msg: 12 }] });
  const send = jest.fn<Promise<Saved>, [Body & { idempotency_key: string }]>()
    .mockRejectedValueOnce(new PlanningError(422, JSON.stringify({ detail: "Target cannot be lower than required minimum" })))
    .mockRejectedValueOnce(new PlanningError(422, list)).mockRejectedValueOnce(new PlanningError(403, "Planning permission required"));
  const { refresh, outcome } = mount(send);
  await save();
  expect(outcome()).toEqual({ kind: "refused", fields: [], problem: { kind: "validation", code: "422", title: "サーバーの検証で止まりました", body: "Target cannot be lower than required minimum", action: "内容を見直す" } });
  await save();
  expect(outcome()).toMatchObject({ kind: "refused", fields: [{ field: "input_hash", message: "String should match pattern" }, { field: "payload.count", message: "Input should be a valid integer" }] });
  // A definite refusal ended the attempt: the next one is a new change.
  expect(send.mock.calls[1][0].idempotency_key).not.toBe(send.mock.calls[0][0].idempotency_key);
  await save();
  expect(outcome()).toMatchObject({ kind: "refused", problem: { kind: "forbidden", code: "403" }, fields: [] });
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  expect(outcome()).toEqual({ kind: "idle" });
});
