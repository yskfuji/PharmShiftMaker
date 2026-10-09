import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { PlanningError } from "@/lib/planningTransport";
import TaskDisclosure, { OnDemandTask, useOnDemand } from "../TaskDisclosure";

function Tasks({ load }: { load: () => Promise<string[]> }) {
  const resource = useOnDemand(load);
  return <>
    <OnDemandTask summary="付与を訂正する" resource={resource}>{(rows) => <p>訂正できる付与 {rows.length}件</p>}</OnDemandTask>
    <OnDemandTask summary="取得を取り消す" resource={resource}>{(rows) => <p>取り消せる記録 {rows.join("・")}</p>}</OnDemandTask>
    <button type="button" onClick={() => void resource.reload()}>保存後に読み直す</button>
  </>;
}
const open = (summary: string) => { const details = screen.getByText(summary).closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); return details; };

test("a task is closed until it is opened, and its content is the owner's", () => {
  render(<TaskDisclosure summary="申告を取り下げる"><label>取り下げる申告<input /></label></TaskDisclosure>);
  const details = screen.getByText("申告を取り下げる").closest("details")!;
  expect(details).toHaveClass("ideal-v3-disclosure");
  expect(details.open).toBe(false);
  expect(screen.getByLabelText("取り下げる申告")).not.toBeVisible();
  // What the task holds is a group named by its summary.
  details.open = true;
  expect(within(screen.getByRole("group", { name: "申告を取り下げる" })).getByLabelText("取り下げる申告")).toBeInTheDocument();
});

test("a task without a look is an ordinary one: no hint, no tag, nothing described", () => {
  render(<TaskDisclosure summary="申告を取り下げる"><p>内容</p></TaskDisclosure>);
  const summary = screen.getByText("申告を取り下げる", { selector: "summary" });
  const frame = summary.closest("details")!.parentElement!;
  expect(frame).toHaveClass("ideal-v3-task", "ideal-v3-task--routine");
  expect(frame.querySelector(".ideal-v3-task__hint")).toBeNull();
  expect(summary).not.toHaveAttribute("aria-describedby");
  expect(summary.closest("details")).not.toHaveAttribute("id");
});

test("the hint and the tag are beside the summary, not in it: its text and name stay the same", () => {
  render(<>
    <TaskDisclosure id="task-erase" tone="danger" tag="消去は取り消せません" hint="保存期限を過ぎた入力を消去します。" summary="旧勤務入力を消去する"><p>内容</p></TaskDisclosure>
    <TaskDisclosure tone="primary" hint="請求を承認するか却下します。" summary="請求を判断する"><p>内容</p></TaskDisclosure>
    <TaskDisclosure tone="info" summary="過去時点を照会する"><p>内容</p></TaskDisclosure>
  </>);
  const summary = screen.getByText("旧勤務入力を消去する", { selector: "summary" });
  const details = summary.closest("details")!;
  const frame = details.parentElement!;
  expect(summary.textContent).toBe("旧勤務入力を消去する");
  expect(summary.childElementCount).toBe(0);
  expect(details).toHaveAttribute("id", "task-erase");
  expect(frame).toHaveClass("ideal-v3-task", "ideal-v3-task--danger");
  const hint = frame.querySelector(":scope > .ideal-v3-task__hint")!;
  expect(details.contains(hint)).toBe(false);
  expect(hint).toHaveTextContent("消去は取り消せません保存期限を過ぎた入力を消去します。");
  // The tone is told in words, not by colour alone.
  expect(within(hint as HTMLElement).getByText("消去は取り消せません")).toHaveClass("ideal-pill", "ideal-pill--danger");
  expect(summary).toHaveAccessibleDescription("消去は取り消せません 保存期限を過ぎた入力を消去します。");
  expect(screen.getByText("請求を判断する", { selector: "summary" })).toHaveAccessibleDescription("請求を承認するか却下します。");
  expect(screen.getByText("請求を判断する", { selector: "summary" }).closest(".ideal-v3-task")).toHaveClass("ideal-v3-task--primary");
  expect(screen.getByText("過去時点を照会する", { selector: "summary" }).closest(".ideal-v3-task")).toHaveClass("ideal-v3-task--info");
  // What a journey looks for is still exactly one element per summary text.
  expect(screen.getAllByText("旧勤務入力を消去する")).toHaveLength(1);
  expect(screen.getByRole("group", { name: "旧勤務入力を消去する", hidden: true })).toBeInTheDocument();
});

test("an open danger task says that it cannot be undone as its first line, under the summary; the closed tag stays the one element with the tag as its text", () => {
  render(<>
    <TaskDisclosure tone="danger" tag="消去は取り消せません" hint="保存期限を過ぎた入力を消去します。" summary="旧勤務入力を消去する"><p>内容</p></TaskDisclosure>
    <TaskDisclosure tone="primary" tag="管理者" hint="請求を承認するか却下します。" summary="請求を判断する"><p>内容</p></TaskDisclosure>
    <TaskDisclosure summary="申告を取り下げる"><p>内容</p></TaskDisclosure>
  </>);
  const summary = screen.getByText("旧勤務入力を消去する", { selector: "summary" });
  const details = summary.closest("details")!;
  const frame = details.parentElement!;
  // In the task's body, directly after the summary and before the group of its fields; never in the summary.
  const warning = summary.nextElementSibling!;
  expect(warning).toHaveClass("ideal-v3-task__warning");
  expect(warning.nextElementSibling).toBe(within(details).getByRole("group", { name: "旧勤務入力を消去する", hidden: true }));
  expect(warning.textContent).toBe("消去は取り消せません。実行すると元に戻せません。内容を確かめてから進めてください。");
  expect(summary.childElementCount).toBe(0);
  // Closed, the body is not shown, so the tag is on screen once (beside the summary); open, the
  // style sheet stops drawing that line (primitives.css) and the strip is the one that shows.
  expect(warning).not.toBeVisible();
  expect(within(frame as HTMLElement).getAllByText("消去は取り消せません")).toHaveLength(1);
  expect(within(frame as HTMLElement).getByText("消去は取り消せません")).toHaveClass("ideal-pill--danger");
  details.open = true;
  expect(warning).toBeVisible();
  // The summary is described by its tag and its hint in both states.
  expect(summary).toHaveAccessibleDescription("消去は取り消せません 保存期限を過ぎた入力を消去します。");
  // Only what cannot be undone has the strip: a tag of another tone is a word beside the closed summary.
  for (const name of ["請求を判断する", "申告を取り下げる"]) expect(screen.getByText(name, { selector: "summary" }).closest(".ideal-v3-task")!.querySelector(".ideal-v3-task__warning")).toBeNull();
});

test("a task that reads on demand takes the same look", () => {
  const Reading = () => { const resource = useOnDemand(async () => ["g1"]); return <OnDemandTask id="task-grant" tone="danger" tag="取り消せません" hint="付与を取り消します。" summary="付与を取り消す" resource={resource}>{(rows) => <p>{rows.length}件</p>}</OnDemandTask>; };
  render(<Reading />);
  const summary = screen.getByText("付与を取り消す", { selector: "summary" });
  expect(summary.closest("details")).toHaveAttribute("id", "task-grant");
  expect(summary.closest("details")!.parentElement).toHaveClass("ideal-v3-task", "ideal-v3-task--danger");
  expect(summary).toHaveAccessibleDescription("取り消せません 付与を取り消します。");
  // The strip of an open danger task comes before whatever the read has to say.
  expect(summary.nextElementSibling).toHaveClass("ideal-v3-task__warning");
  expect(summary.nextElementSibling).toHaveTextContent("取り消せません。実行すると元に戻せません。内容を確かめてから進めてください。");
  expect(summary.nextElementSibling!.nextElementSibling).toHaveTextContent("開くと、この操作に必要な記録を読み込みます。");
});

test("a control elsewhere on the route can open a task through its ref", () => {
  let details: HTMLDetailsElement | null = null;
  render(<TaskDisclosure summary="契約を登録する" ref={(element) => { details = element; }}><p>契約の内容</p></TaskDisclosure>);
  expect(details).toBe(screen.getByText("契約を登録する").closest("details"));
  details!.open = true;
  expect(screen.getByText("契約の内容")).toBeVisible();
});

test("what only a task needs is read when a task is first opened, once for the tasks that share it", async () => {
  const load = jest.fn(async () => ["g1", "g2"]);
  render(<Tasks load={load} />);
  expect(load).not.toHaveBeenCalled();
  expect(screen.getAllByText("開くと、この操作に必要な記録を読み込みます。")).toHaveLength(2);
  const first = open("付与を訂正する");
  expect(within(first).getByRole("status")).toHaveTextContent("この操作に必要な記録を読み込んでいます。");
  expect(await within(first).findByText("訂正できる付与 2件")).toBeInTheDocument();
  open("取得を取り消す");
  expect(screen.getByText("取り消せる記録 g1・g2")).toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
  // Read again on demand; what was read stays on screen meanwhile.
  fireEvent.click(screen.getByRole("button", { name: "保存後に読み直す" }));
  expect(screen.getByText("訂正できる付与 2件")).toBeInTheDocument();
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
});

test("a read that fails is the task's own problem and can be tried again", async () => {
  let fail = true;
  const load = jest.fn(async () => { if (fail) throw new PlanningError(403, "Administrator membership required"); return ["g1"]; });
  render(<Tasks load={load} />);
  const details = open("付与を訂正する");
  expect(await within(details).findByRole("alert")).toHaveTextContent("403この画面は表示できません");
  expect(within(details).queryByText(/訂正できる付与/)).toBeNull();
  fail = false;
  fireEvent.click(within(details).getByRole("button", { name: "もう一度読み込む" }));
  expect(await within(details).findByText("訂正できる付与 1件")).toBeInTheDocument();
  expect(within(details).queryByRole("alert")).toBeNull();
});

describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML has the summary and no field; a task opened there stays open, gets its content and reads what it needs", async () => {
    const load = jest.fn(async () => ["g1"]);
    const node = <><TaskDisclosure summary="申告を取り下げる"><label>取り下げる申告<input /></label></TaskDisclosure><Tasks load={load} /></>;
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container).toHaveTextContent("この操作を準備しています。");
    const plain = within(container).getByText("申告を取り下げる").closest("details")!;
    const reading = within(container).getByText("付与を訂正する").closest("details")!;
    plain.open = true; reading.open = true;
    await act(async () => { root = hydrateRoot(container, node); });
    expect(plain.open).toBe(true);
    expect(within(plain).getByLabelText("取り下げる申告")).toBeVisible();
    expect(await within(reading).findByText("訂正できる付与 1件")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
