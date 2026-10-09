import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ScheduleChangeCase } from "@/ideal/types";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { TYPED, shownTimes, unmarked } from "../../../shared/__fixtures__/typed";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";
import { operationVerbs } from "../verbs";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => { jest.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const duty = (id: string, person: string, day: number) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央", start: `2026-10-${day}T08:30:00+09:00`, end: `2026-10-${day}T17:15:00+09:00` });
const caseRow = (over: Partial<ScheduleChangeCase>): ScheduleChangeCase => ({
  case_id: "c-ready", scope_id: "synthetic/clinical-pharmacy", publication_id: "synthetic-publication-12", kind: "ABSENCE", status: "READY", version: 3,
  affected_assignments: [duty("d1", "synthetic-pharmacist", 13)], proposed_assignments: [duty("r1", "synthetic-admin", 13)],
  validation: { findings: [], publishable: true, required_consent_person_ids: [], consented_person_ids: [], replacement_duty_ids: ["r1"] },
  evidence: {}, created_by: "synthetic-pharmacist", created_at: "2026-10-12T07:00:00+09:00", updated_at: "2026-10-12T07:30:00+09:00", approval_action: "RECOMMEND", can_reject: true, ...over,
});
const ready = caseRow({});
const asking = caseRow({ case_id: "c-ask", kind: "SWAP", status: "AWAITING_CONSENT", version: 2, approval_action: null, can_reject: false,
  validation: { findings: [], required_consent_person_ids: ["synthetic-leader"], consented_person_ids: [], replacement_duty_ids: [] } });
const independent = caseRow({ case_id: "c-independent", status: "AWAITING_INDEPENDENT_APPROVAL", version: 4, approval_action: "APPROVE" });
const approved = caseRow({ case_id: "c-approved", status: "APPROVED", version: 5, approval_action: null, can_reject: false });
const options = { publication_id: "synthetic-publication-12", publication_version: 12, duty_id: "synthetic-duty-1", kind: "ABSENCE", consent_required: false, options: [
  { option_id: "o1", affected_assignment_ids: ["synthetic-duty-1"], proposed_assignment_ids: ["x1"], counterpart: { person_id: "synthetic-admin", display_name: null }, duty: { start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00", kind: "日勤", task: "病棟", location: "本館" }, publishable: true, finding_count: 0 },
  { option_id: "o2", affected_assignment_ids: ["synthetic-duty-1"], proposed_assignment_ids: ["x2"], counterpart: { person_id: "synthetic-leader", display_name: null }, duty: { start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00", kind: "日勤", task: "病棟", location: "本館" }, publishable: false, finding_count: 2 },
] };

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

async function mount(data: ScheduleChangeCase[], answer: (call: Call) => unknown = () => options, over: Partial<RouteContext> = {}, role: IdealRole = "LEADER") {
  const ctx = { ...syntheticContext(role), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: ScheduleChangeCase[]) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(tree(data)); });
  return { calls, refresh, show: (value: ScheduleChangeCase[]) => view.rerender(tree(value)) };
}

function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "本人から連絡" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "TEL-1012" } });
}
const EVIDENCE = { reason: "本人から連絡", reference: "TEL-1012" };
const detail = () => screen.getByRole("article");
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");

test("the route reads the scope's change cases and nothing else", async () => {
  const { calls, client } = api(() => [ready]);
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: [ready] });
  expect(calls).toEqual([{ method: "GET", path: `/change-cases?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("planning");
});

test("the showcase shows the open cases, and the route's own words when there are none", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="operations" view="cases" role="LEADER" />);
  const list = await screen.findByRole("list", { name: "ケース一覧" });
  expect(within(list).getAllByRole("button").map((item) => item.textContent)).toEqual([
    "勤務交換 · 同意待ち高橋 葵、鈴木 悠斗第2版 · 10月12日（月）08:30", "欠勤 · 承認待ち高橋 葵、佐藤 美咲第3版 · 10月12日（月）08:30",
  ]);
  // The first case is the one being decided; the leader is asked for their consent there.
  expect(detail()).toHaveTextContent("選んだケースの内容（第2版）");
  // Who has consented and who has not yet are told apart by name.
  expect(detail()).toHaveTextContent("同意 1 / 2（同意済み：高橋 葵／まだ：鈴木 悠斗）");
  // Before the buttons: one line for each action the server offers, and no other.
  expect(Array.from(detail().querySelectorAll(".ideal-v3-case-effects dt")).map((item) => item.textContent)).toEqual(["「同意する」", "「同意しない」", "「責任者として却下」", "「取り下げる」"]);
  expect(detail()).not.toHaveTextContent("新しい公開版を作って公開します");
  // What moves the case forward comes first; what ends it follows, in a group of its own.
  expect(within(detail()).getAllByRole("button").map((item) => item.textContent)).toEqual(["同意する", "同意しない", "責任者として却下", "取り下げる"]);
  expect(within(detail()).getByRole("button", { name: "同意する" }).closest(".ideal-v3-case-closing")).toBeNull();
  expect(Array.from(detail().querySelectorAll(".ideal-v3-case-closing button")).map((item) => item.textContent)).toEqual(["同意しない", "責任者として却下", "取り下げる"]);
  // The group is named and says in words that a case it ends cannot be reopened; its buttons
  // are the destructive outline, and the one filled button is the one that moves the case on.
  const closing = detail().querySelector<HTMLElement>(".ideal-v3-case-closing")!;
  expect(closing.firstElementChild).toHaveTextContent("再開できませんこのケースを終える操作");
  expect(closing.querySelector(".ideal-pill--danger")).toHaveTextContent("再開できません");
  expect(within(closing).getAllByRole("button").map((item) => item.className)).toEqual(Array(3).fill("ideal-button ideal-button--danger"));
  expect(within(detail()).getByRole("button", { name: "同意する" })).toHaveClass("ideal-button--primary");
  // Opened, a verb that ends the case says so first, and the button that confirms it is the
  // filled destructive one; a verb that moves the case on confirms with the primary button.
  fireEvent.click(within(closing).getByRole("button", { name: "取り下げる" }));
  expect(detail().querySelector(".ideal-v3-case-effect")).toHaveTextContent(/^再開できません。このケースを取り下げて終わりにします。/);
  expect(within(detail()).getByRole("button", { name: "取り下げる" })).toHaveClass("ideal-button--danger", "is-final");
  fireEvent.click(within(detail()).getByRole("button", { name: "やめる" }));
  fireEvent.click(within(detail()).getByRole("button", { name: "同意する" }));
  expect(within(detail()).getByRole("button", { name: "同意する" })).toHaveClass("ideal-button--primary");
  expect(detail().querySelector(".ideal-v3-case-effect__final")).toBeNull();
  fireEvent.click(within(detail()).getByRole("button", { name: "やめる" }));
  expect(within(panel("欠勤を記録して代わりを決める")).getByLabelText("勤務").querySelectorAll("option")).toHaveLength(3);
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="operations" view="cases" role="LEADER" state="empty" />);
  expect(await screen.findByText("いま対応が必要なケースはありません。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "欠勤を記録して代わりを決める" })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the verbs offered follow what the server says about the case", () => {
  expect(operationVerbs(ready, "synthetic-leader")).toEqual(["recommend", "reject", "withdraw"]);
  expect(operationVerbs(independent, "synthetic-leader")).toEqual(["approve", "reject", "withdraw"]);
  expect(operationVerbs(asking, "synthetic-leader")).toEqual(["consent", "decline", "withdraw"]);
  expect(operationVerbs(asking, "synthetic-admin")).toEqual(["withdraw"]);
  // An earlier server names no approval step: a ready case is then approved directly.
  expect(operationVerbs({ ...ready, approval_action: undefined, can_reject: undefined }, "synthetic-leader")).toEqual(["approve", "withdraw"]);
});

test("only open cases are listed, and the case the URL names is the one decided", async () => {
  const { show } = await mount([ready, asking, approved], undefined, { selectedCaseId: "c-ask" });
  expect(within(screen.getByRole("list", { name: "ケース一覧" })).getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: /勤務交換 · 同意待ち/ })).toHaveAttribute("aria-pressed", "true");
  expect(detail()).toHaveTextContent("選んだケースの内容（第2版）");
  // Drawn from what the route reads next, not from a copy kept here.
  show([ready, { ...asking, version: 7 }]);
  expect(detail()).toHaveTextContent("選んだケースの内容（第7版）");
  fireEvent.click(screen.getByRole("button", { name: /欠勤 · 承認待ち/ }));
  expect(detail()).toHaveTextContent("選んだケースの内容（第3版）");
  expect(detail()).toHaveTextContent("外す高橋 葵 · 10月13日（火） 08:30–17:15");
  expect(detail()).toHaveTextContent("入る佐藤 美咲 · 10月13日（火） 08:30–17:15");
});

test("before a button is pressed the case says what each offered action does, and the opened action says it again", async () => {
  await mount([independent]);
  const effects = () => Array.from(detail().querySelectorAll(".ideal-v3-case-effects > div")).map((item) => [item.querySelector("dt")!.textContent, item.querySelector("dd")!.textContent]);
  // One line per verb the server allows, in the order of the buttons; none for a verb that is not offered.
  expect(effects().map(([name]) => name)).toEqual(["「承認して新しい公開版を作る」", "「責任者として却下」", "「取り下げる」"]);
  expect(effects()[0][1]).toContain("いまの公開版は書き換えずに、この変更を入れた新しい公開版を作って公開します。");
  expect(effects()[1][1]).toContain("終わったケースは再開できません。");
  expect(effects()[2][1]).toContain("必要なら新しく申請します。");
  expect(detail()).not.toHaveTextContent("あなたの同意を記録します。");
  fireEvent.click(within(detail()).getByRole("button", { name: "取り下げる" }));
  expect(detail().querySelector(".ideal-v3-case-effects")).toBeNull();
  expect(detail().querySelector("form .ideal-v3-case-effect")).toHaveTextContent("このケースを取り下げて終わりにします。勤務表は変わりません。");
});

test("a duty whose date cannot be read stops what moves the case forward, and says why; ending the case stays possible", async () => {
  const broken = { ...asking, affected_assignments: [{ ...(asking.affected_assignments[0] as object), start: "not-a-date" }] } as ScheduleChangeCase;
  const { show } = await mount([broken], undefined, { selectedCaseId: "c-ask" });
  expect(detail()).toHaveTextContent("このケースには、日時を読み取れない勤務があります。");
  expect(within(detail()).getByRole("button", { name: "同意する" })).toBeDisabled();
  expect(within(detail()).getByRole("button", { name: "同意しない" })).toBeEnabled();
  expect(within(detail()).getByRole("button", { name: "取り下げる" })).toBeEnabled();
  // Readable dates: nothing is held and nothing is said.
  show([asking]);
  expect(detail()).not.toHaveTextContent("日時を読み取れない勤務");
  expect(within(detail()).getByRole("button", { name: "同意する" })).toBeEnabled();
});

test("a case the URL names is looked for only among the returned open cases", async () => {
  // Closed, and one that was never returned: neither is replaced by another case silently.
  for (const selectedCaseId of ["c-approved", "c-of-another-scope"]) {
    const view = await mount([ready, asking, approved], undefined, { selectedCaseId });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("指定されたケースを表示できません");
    expect(screen.queryByRole("article")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "一覧の先頭を開く" }));
    expect(detail()).toHaveTextContent("選んだケースの内容（第3版）");
    expect(view.calls).toEqual([]);
    document.body.innerHTML = "";
  }
});

test("a recommendation is sent against the case version; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount([ready, asking], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return { ...ready, status: "AWAITING_INDEPENDENT_APPROVAL", version: 4 };
  });
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  expect(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" })).toBeDisabled();
  expect(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" })).toHaveAccessibleDescription("理由と参照を3文字以上入力すると押せます。");
  fillEvidence(detail());
  expect(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" })).not.toHaveAttribute("aria-describedby");
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  expect(await within(detail()).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  // The confirmation belongs to the route, so it stays when the case leaves the list.
  expect(await screen.findByText("別担当の承認待ちにしました。")).toHaveAttribute("role", "status");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /change-cases/c-ready/recommend?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ expected_version: 3, evidence: EVIDENCE, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The evidence form is closed again and empty.
  expect(within(detail()).queryByRole("group")).toBeNull();
});

test("approval names the publication the case was opened against, then opens the schedule", async () => {
  window.history.replaceState(null, "", "/workspace/operations/cases");
  const replace = jest.spyOn(browserNavigation, "replaceWithFlash").mockImplementation(() => undefined);
  const base = syntheticContext("ADMIN");
  // The publication on screen is another period's; the case was opened against version 12.
  const onScreen = { ...base.publication!, publication_id: "pub-november", version: 3, period: "2026-11-01T00:00:00+09:00|2026-12-01T00:00:00+09:00" };
  const { calls, refresh } = await mount([independent], () => ({ publication_id: "pub-next", version: 13, input_hash: "h", case_id: "c-independent" }),
    { publication: onScreen, publications: [base.publication!, onScreen] }, "ADMIN");
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  expect(replace).toHaveBeenCalledWith("/workspace/schedule?scope=synthetic%2Fclinical-pharmacy&period=2026-10&publication=pub-next", "change-approved");
  expect(calls).toEqual([{ method: "POST", path: `/change-cases/c-independent/approve?${SCOPE}`,
    body: { expected_version: 4, expected_publication_version: 12, evidence: EVIDENCE, idempotency_key: expect.any(String) } }]);
  // The schedule is opened instead of reading this route again.
  expect(refresh).not.toHaveBeenCalled();
});

test("outside the workspace an approval is confirmed in place and the route is read again", async () => {
  const replace = jest.spyOn(browserNavigation, "replaceWithFlash").mockImplementation(() => undefined);
  const { refresh } = await mount([independent], () => ({ publication_id: "pub-next", version: 13, input_hash: "h", case_id: "c-independent" }));
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  expect(await screen.findByText("承認し、新しい公開版を作成しました。")).toHaveAttribute("role", "status");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
});

test("a case whose publication was replaced is refused here, and nothing is sent", async () => {
  const { calls, refresh } = await mount([{ ...independent, publication_id: "pub-replaced" }]);
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "承認して新しい公開版を作る" }));
  const alert = await within(detail()).findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("このケースの公開版は差し替えられました。取り下げて、現在の公開版から作り直してください。");
  expect(calls).toEqual([]);
  expect(refresh).not.toHaveBeenCalled();
});

test("the reason typed for a change to a case stays in its field: the confirmation, a conflict and the result repeat none of it", async () => {
  // A journey types reasons that hold an enumeration value and the word 「API」. They are sent, and
  // nothing on the route says them back as its own wording — before, during or after the change.
  let attempts = 0;
  const { calls } = await mount([ready], () => { if (++attempts === 1) throw new PlanningError(409, "Change case revision or status changed"); return { ...ready, status: "AWAITING_INDEPENDENT_APPROVAL", version: 4 }; });
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  fireEvent.change(within(detail()).getByLabelText(/^理由/), { target: { value: TYPED } });
  fireEvent.change(within(detail()).getByLabelText(/^参照/), { target: { value: TYPED } });
  expect(within(detail()).getByLabelText(/^理由/)).toHaveValue(TYPED);
  expect(shownTimes(document.body)).toBe(0);
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  expect(await within(detail()).findByRole("alert")).toHaveTextContent("409");
  expect(within(detail()).getByLabelText(/^理由/)).toHaveValue(TYPED);
  expect(unmarked(document.body)).toEqual([]);
  expect(shownTimes(document.body)).toBe(0);
  fireEvent.click(within(detail()).getByRole("button", { name: "別担当へ承認を依頼" }));
  expect(await screen.findByText("別担当の承認待ちにしました。")).toHaveAttribute("role", "status");
  expect((calls[1].body as { evidence: unknown }).evidence).toEqual({ reason: TYPED, reference: TYPED });
  expect(unmarked(document.body)).toEqual([]);
  expect(shownTimes(document.body)).toBe(0);
});

test("a conflict is shown on the case, keeps the evidence, and the route is not read again", async () => {
  const { calls, refresh } = await mount([ready], () => { throw new PlanningError(409, "Change case revision or status changed"); });
  fireEvent.click(within(detail()).getByRole("button", { name: "責任者として却下" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "責任者として却下" }));
  const alert = await within(detail()).findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("新しい変更があります");
  expect(within(detail()).getByLabelText(/^理由/)).toHaveValue("本人から連絡");
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /change-cases/c-ready/reject?${SCOPE}`]);
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.queryByText("責任者の却下を記録しました。")).toBeNull();
  fireEvent.click(within(detail()).getByRole("button", { name: "やめる" }));
  expect(within(detail()).queryByRole("group")).toBeNull();
});

test("an absence is recorded with a replacement the server validated, read on demand", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount([], (call) => {
    if (call.method === "GET") return options;
    if (++attempts === 1) throw new PlanningError(503, "down");
    return { ...ready, case_id: "c-new" };
  });
  const form = panel("欠勤を記録して代わりを決める");
  expect(within(form).getByText("公開版 v12 の勤務から選ぶ")).toBeInTheDocument();
  // Every duty of the publication, named from the roster the server returned.
  expect(Array.from(within(form).getByLabelText("勤務").querySelectorAll("option")).map((item) => item.textContent)).toEqual([
    "選んでください", "高橋 葵 · 10月12日（月） 08:30–17:30 · 日勤", "鈴木 悠斗 · 10月12日（月） 10:30–19:30 · 遅番",
  ]);
  expect(within(form).queryByRole("group", { name: "種類" })).toBeNull();
  expect(calls).toEqual([]);
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  expect(within(form).getByText("候補を確認しています…")).toHaveAttribute("role", "status");
  const choice = await within(form).findByRole("radio", { name: /佐藤 美咲/ });
  expect(calls).toEqual([{ method: "GET", path: `/change-cases/options?${SCOPE}&publication_id=synthetic-publication-12&duty_id=synthetic-duty-1&kind=ABSENCE`, body: undefined }]);
  expect(choice.closest("label")).toHaveTextContent("検証を通過");
  expect(within(form).getByRole("radio", { name: /鈴木 悠斗/ }).closest("label")).toHaveTextContent("指摘あり 2件");
  expect(within(form).getByRole("button", { name: "申請する" })).toBeDisabled();
  // What is still missing is said in the order of the form: the replacement, then the evidence.
  expect(within(form).getByRole("button", { name: "申請する" })).toHaveAccessibleDescription("代わりの人を選ぶと押せます（指定しないことも選べます）。");
  fireEvent.click(choice);
  expect(within(form).getByRole("button", { name: "申請する" })).toHaveAccessibleDescription("理由と参照を3文字以上入力すると押せます。");
  fillEvidence(form);
  expect(within(form).getByRole("button", { name: "申請する" })).not.toHaveAttribute("aria-describedby");
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  await waitFor(() => expect(within(form).getByText("申請しました。責任者の承認を待っています。")).toHaveAttribute("role", "status"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(posts(calls).map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /change-cases?${SCOPE}`));
  const [first, second] = posts(calls).map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ publication_id: "synthetic-publication-12", kind: "ABSENCE", affected_assignment_ids: ["synthetic-duty-1"], proposed_assignment_ids: ["x1"], evidence: EVIDENCE, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  expect(within(form).getByLabelText("勤務")).toHaveValue("");
  expect(within(form).getByLabelText(/^理由/)).toHaveValue("");
});

test("without a publication there is nothing to record an absence for", async () => {
  await mount([ready], undefined, { publication: null });
  const form = panel("欠勤を記録して代わりを決める");
  expect(within(form).getByText("公開版 —")).toBeInTheDocument();
  expect(within(form).getByText("公開版がないため、申請できる勤務がありません。")).toBeInTheDocument();
  expect(within(form).queryByRole("button")).toBeNull();
});
