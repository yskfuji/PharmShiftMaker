import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ScopeSettings } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const settings = (enabled: boolean, revision: number): ScopeSettings => ({
  scope_id: "synthetic/clinical-pharmacy",
  absence_replacement_consent: { enabled, revision, history: [{ revision, enabled, reason: "運用確認", reference: "REF-1", actor: "ADMIN", at: "2026-10-01T09:00:00+09:00" }] },
});

/** The real typed client over a recording transport, so paths and bodies are the real ones. */
function api(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createIdealClient("test", async <T,>(path: string, method = "GET", body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call) as T;
  });
  return { calls, client };
}

function mount(data: ScopeSettings, answer: (call: Call) => unknown, role: IdealRole = "ADMIN") {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: ScopeSettings) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  const view = render(tree(data));
  return { calls, refresh, show: (value: ScopeSettings) => view.rerender(tree(value)) };
}

function fillEvidence() {
  fireEvent.change(screen.getByLabelText(/^理由/), { target: { value: "運用の見直し" } });
  fireEvent.change(screen.getByLabelText(/^参照/), { target: { value: "MEET-1012" } });
}

test("the route reads the scope settings and nothing else, without a roster", async () => {
  const { calls, client } = api(() => settings(false, 2));
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", partial: [] });
  expect(calls).toEqual([{ method: "GET", path: `/scope-settings?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("none");
});

test("the showcase shows the setting and its history; without a history only the setting", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="settings" view="absence-consent" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "代わりに入る人の同意" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "切り替えの履歴" })).getByText("SYNTHETIC-2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "同意を求めるようにする" })).toBeDisabled();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="settings" view="absence-consent" role="ADMIN" state="empty" />);
  expect(await screen.findByText(/切り替えは、切り替えた後に作るケースから適用されます/)).toBeInTheDocument();
  expect(screen.getByText("同意を求めない")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "切り替えの履歴" })).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("only an administrator is offered the switch; others see the state and the history", () => {
  mount(settings(true, 3), () => settings(true, 3), "LEADER");
  expect(screen.getByText("同意を求める", { selector: ".ideal-pill" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "切り替えの履歴" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});

test("the switch is sent against the revision on screen; an unknown outcome keeps its key", async () => {
  let posts = 0;
  const { calls, refresh, show } = mount(settings(false, 2), (call) => {
    if (call.method === "POST" && ++posts === 1) throw new PlanningError(503, "down");
    return settings(true, 3);
  });
  fillEvidence();
  fireEvent.click(screen.getByRole("button", { name: "同意を求めるようにする" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "同意を求めるようにする" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("同意を求めるようにしました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /scope-settings/absence-consent?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ enabled: true, expected_version: 2, evidence: { reason: "運用の見直し", reference: "MEET-1012" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The form keeps no copy of the setting: what the server reads next is what it shows.
  show(settings(true, 3));
  expect(screen.getByRole("button", { name: "同意を求めないようにする" })).toBeInTheDocument();
  expect(screen.getByLabelText(/^理由/)).toHaveValue("");
});

test("a conflict is shown in the form, keeps the evidence, and the route is not read again", async () => {
  const { refresh } = mount(settings(false, 2), () => { throw new PlanningError(409, "stale"); });
  fillEvidence();
  fireEvent.click(screen.getByRole("button", { name: "同意を求めるようにする" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(screen.getByLabelText(/^理由/)).toHaveValue("運用の見直し");
  expect(refresh).not.toHaveBeenCalled();
});
