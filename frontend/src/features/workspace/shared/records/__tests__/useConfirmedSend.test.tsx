import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { conflictOutcome, useConfirmedSend } from "../useConfirmedSend";

type Body = { version: number; approved: boolean };
function setup(send: (body: Body, key: string) => Promise<{ version: number }>, readCurrent: () => Promise<{ version: number } | null> = async () => ({ version: 5 })) {
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(syntheticContext("LEADER"), { client: createIdealClient("test", async () => { throw new Error("not used"); }), mutate: createMutator("test", () => `key-${++keys}`), refresh });
  const wrapper = ({ children }: { children: ReactNode }) => <LiveProvider live={live}>{children}</LiveProvider>;
  const hook = renderHook(() => useConfirmedSend<Body, { version: number }, { version: number }>({ name: "request-decision:r1", send, readCurrent }), { wrapper });
  return { hook, refresh };
}
const body: Body = { version: 4, approved: true };

test("a change that is done reads the route again and resolves to the answer", async () => {
  const send = jest.fn(async () => ({ version: 5 }));
  const { hook, refresh } = setup(send);
  let result: unknown;
  await act(async () => { result = await hook.result.current.run(body); });
  expect(result).toEqual({ done: true, result: { version: 5 } });
  expect(send).toHaveBeenCalledWith(body, "key-1");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(hook.result.current.outcome).toEqual({ kind: "idle" });
});

test("a 409 reads what the server holds now and becomes a conflict its owner describes; nothing is sent again by itself", async () => {
  const send = jest.fn(async () => { throw new PlanningError(409, "Request changed"); });
  const { hook, refresh } = setup(send);
  await act(async () => { expect(await hook.result.current.run(body)).toEqual({ done: false }); });
  expect(hook.result.current.outcome).toEqual({ kind: "conflict", current: { version: 5 } });
  expect(send).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(conflictOutcome(hook.result.current.outcome, (current) => ({ currentRevision: current?.version ?? null, rows: [{ label: "版", base: "第4版", current: `第${current?.version}版`, proposed: "第4版" }] })))
    .toEqual({ kind: "conflict", currentRevision: 5, rows: [{ label: "版", base: "第4版", current: "第5版", proposed: "第4版" }] });
  act(() => hook.result.current.clear());
  expect(hook.result.current.outcome).toEqual({ kind: "idle" });
});

test("an unknown outcome keeps the key for the identical body; a definite refusal carries the server's message", async () => {
  let attempts = 0;
  const send = jest.fn(async () => { attempts += 1; if (attempts === 1) throw new PlanningError(503, "down"); if (attempts === 2) return { version: 5 }; throw new PlanningError(422, JSON.stringify({ detail: "公開済みの計画に含まれる申請は変更できません。" })); });
  const { hook, refresh } = setup(send);
  await act(async () => { await hook.result.current.run(body); });
  expect(hook.result.current.outcome.kind).toBe("unknown");
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.run(body); });
  expect(send.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["key-1", "key-1"]);
  await act(async () => { await hook.result.current.run({ version: 5, approved: false }); });
  expect(hook.result.current.outcome).toMatchObject({ kind: "refused", problem: { code: "422", body: "公開済みの計画に含まれる申請は変更できません。" }, fields: [] });
  expect(conflictOutcome(hook.result.current.outcome, () => ({ currentRevision: null, rows: [] })).kind).toBe("refused");
});

test("a conflict whose current state cannot be read is said as a refusal, and the same change can be tried again", async () => {
  const { hook } = setup(async () => { throw new PlanningError(409, "conflict"); }, async () => { throw new PlanningError(503, "down"); });
  await act(async () => { await hook.result.current.run(body); });
  expect(hook.result.current.outcome).toMatchObject({ kind: "refused", problem: { code: "409" } });
});
