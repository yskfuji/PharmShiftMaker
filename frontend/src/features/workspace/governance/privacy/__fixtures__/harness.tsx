// What the tests of the privacy route share: the route's view over the real typed client
// with a recording transport, and the ways a test opens a task and reads its confirmation.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole } from "@/ideal/types";
import type { RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { PrivacyCase, PrivacyListing } from "../../api";
import { privacyOf, type PrivacyData } from "../model";
import route from "../route";
import { HOLD, PEOPLE, POLICY } from "./bodies";

export type Call = { method: string; path: string; body: unknown };
export const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
export const READ = `/compliance/privacy?${SCOPE}`;
export const NOBODY = "誰にも通知されません。";

const request = (kind: string, person: string, status: string, revision: number, next: string[], required: string[] = [], history: PrivacyCase["payload"]["decision_history"] = undefined): PrivacyCase =>
  ({ case_id: `case-${kind}`, revision, status, payload: { person_id: person, kind, reason: `合成の${kind}`, ...(history ? { decision_history: history } : {}) }, allowed_next: next, result_reference_required: required });
export const VERIFIED_CASE = request("erase", "p1", "VERIFIED", 2, ["APPROVED", "REJECTED"], [], [{ expected_revision: 1, status: "VERIFIED", reason: "本人確認済み", result_reference: null, identity_evidence: { reference: "ID-1", status: "verified", verified_by: "確認者" } }]);
export const APPROVED_CASE = request("access", "p2", "APPROVED", 3, ["COMPLETED", "RELEASED"], ["COMPLETED"]);
export const CLOSED_CASE = request("rectify", "p1", "REJECTED", 2, []);
/** The listing as the API gives it to an administrator. */
export const listing = (over: Partial<PrivacyListing> = {}): PrivacyListing => ({
  cases: [VERIFIED_CASE, APPROVED_CASE, CLOSED_CASE], rules: [{ key: "rule-1", revision: 1, payload: POLICY }], holds: [HOLD], people: PEOPLE, ...over,
});

/** The real typed client over a recording transport, so paths and bodies are the real ones. */
export function api(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createIdealClient("test", async <T,>(path: string, method = "GET", body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call) as T;
  });
  return { calls, client };
}
export function tree(answer: (call: Call) => unknown, role: IdealRole, over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext(role), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const View = route.View;
  return { calls, refresh, ctx, node: (value: PrivacyData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
export async function mount(answer: (call: Call) => unknown = () => ({}), value: PrivacyListing = listing(), role: IdealRole = "ADMIN", over: Partial<RouteContext> = {}) {
  const { node, ...rest } = tree(answer, role, over);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(privacyOf(value))); });
  return { ...rest, show: (next: PrivacyListing) => view.rerender(node(privacyOf(next))) };
}

export const task = (summary: string) => screen.getByText(summary, { selector: "summary" }).closest("details")!;
export const open = async (summary: string) => { const details = task(summary); details.open = true; await act(async () => { fireEvent(details, new Event("toggle")); }); return details; };
export const field = (summary: string, label: string | RegExp) => within(task(summary)).getByLabelText(label);
export const set = (summary: string, label: string | RegExp, value: string) => fireEvent.change(field(summary, label), { target: { value } });
export const choose = async (summary: string, label: string | RegExp, value: string) => { await act(async () => { set(summary, label, value); }); };
export const tick = (summary: string, label: string | RegExp) => fireEvent.click(field(summary, label));
export const press = async (summary: string, name: string | RegExp) => { await act(async () => { fireEvent.click(within(task(summary)).getByRole("button", { name })); }); };
export const surface = (summary: string) => task(summary).querySelector(".ideal-confirm") as HTMLElement | null;
export const line = (summary: string, term: string) => within(surface(summary)!).getByText(term, { selector: "dt" }).parentElement!;
export const changes = (summary: string) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
export const listed = (summary: string, name: string) => within(within(task(summary)).getByRole("list", { name })).getAllByRole("listitem").map((item) => item.textContent);
export const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
export const keyed = (body: object, key = 1) => ({ ...body, idempotency_key: `idempotency-key-${key}` });
export const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
export const done = (summary: string) => { const all = within(task(summary)).getAllByRole("status"); return all[all.length - 1]; };
